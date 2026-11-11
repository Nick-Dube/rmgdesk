'use strict';
// SQS consumer: sends the emails for a newly raised ticket.
//   - "new request" to the routing rule's recipients (to/cc), with photos embedded
//   - "your request has been logged" to the requester, except for MRI Evolution categories,
//     where Evolution sends its own confirmation
// Each email is recorded in email_messages and on the ticket timeline (internal). A message that SQS
// delivers twice does not send twice: an email already recorded as sent for the ticket is skipped.

const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { query } = require('../lib/db');
const { s3 } = require('../lib/aws');
const { resolveRecipients, deliver } = require('../lib/email/send');
const templates = require('../lib/email/templates');

const INLINE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MAX_INLINE_PHOTOS = 4;
const MAX_INLINE_BYTES = 6 * 1024 * 1024; // keep the whole email comfortably small

function log(level, message, extra = {}) {
  console.log(JSON.stringify({ level, message, ...extra }));
}

async function loadTicket(ticketId) {
  const rows = await query(
    `SELECT t.*, s.code AS site_code, s.name AS site_name, b.name AS building_name, c.label AS category_label,
            sl.name AS service_line_name, sl.is_evolution_linked,
            u.full_name AS requester_name, u.email AS requester_email
       FROM tickets t
       JOIN sites s ON s.id = t.site_id
       JOIN buildings b ON b.id = t.building_id
       JOIN categories c ON c.id = t.category_id
       LEFT JOIN service_lines sl ON sl.id = t.service_line_id
       LEFT JOIN users u ON u.id = t.requester_id
      WHERE t.id = ?`,
    [ticketId],
  );
  return rows[0];
}

async function loadRecipients(ruleId) {
  if (!ruleId) return { to: [], cc: [] };
  const rows = await query(
    `SELECT COALESCE(u.email, r.email) AS email, r.kind
       FROM routing_recipients r
       LEFT JOIN users u ON u.id = r.user_id AND u.status IN ('active', 'invited')
      WHERE r.routing_rule_id = ?`,
    [ruleId],
  );
  return {
    to: rows.filter((r) => r.kind === 'to').map((r) => r.email),
    cc: rows.filter((r) => r.kind === 'cc').map((r) => r.email),
  };
}

/** Photos to embed: images only, up to 4 and 6 MB in total. Everything else is counted, not attached. */
async function loadPhotos(ticketId) {
  const files = await query(
    'SELECT id, s3_key, file_name, content_type, size_bytes FROM attachments WHERE ticket_id = ? ORDER BY id',
    [ticketId],
  );
  const photos = [];
  let bytes = 0;
  for (const f of files) {
    const fits = INLINE_TYPES.has(f.content_type) && photos.length < MAX_INLINE_PHOTOS && bytes + f.size_bytes <= MAX_INLINE_BYTES;
    if (!fits) continue;
    const obj = await s3.send(new GetObjectCommand({ Bucket: process.env.ATTACHMENTS_BUCKET, Key: f.s3_key }));
    const content = Buffer.from(await obj.Body.transformToByteArray());
    bytes += content.length;
    photos.push({ cid: `photo${f.id}@rmgdesk`, fileName: f.file_name, contentType: f.content_type, content });
  }
  return { photos, otherFileCount: files.length - photos.length };
}

async function alreadySent(ticketId, template) {
  const rows = await query(
    "SELECT id FROM email_messages WHERE ticket_id = ? AND template = ? AND status IN ('sent', 'delivered') LIMIT 1",
    [ticketId, template],
  );
  return Boolean(rows[0]);
}

async function sendOne({ ticket, template, to, cc, replyTo, render, attachments }) {
  if (await alreadySent(ticket.id, template)) return;

  const recipients = resolveRecipients({ to, cc });
  if (!recipients.intended.to.length) {
    log('warn', 'No recipients for email', { ticketId: ticket.id, template });
    await query(
      "INSERT INTO ticket_events (ticket_id, type, body, is_internal) VALUES (?, 'email_sent', ?, TRUE)",
      [ticket.id, `No email sent (${template}): no recipients are set up for this category.`],
    );
    return;
  }

  const email = render(recipients.banner);
  const result = await deliver(recipients, { replyTo, subject: email.subject, html: email.html, text: email.text, attachments });
  const shownTo = [...recipients.intended.to, ...recipients.intended.cc.map((a) => `${a} (cc)`)].join(', ');

  if (recipients.mode === 'off') {
    await query("INSERT INTO ticket_events (ticket_id, type, body, is_internal) VALUES (?, 'email_sent', ?, TRUE)", [
      ticket.id,
      `Email not sent (${template}): emails are switched off. It would have gone to ${shownTo}.`,
    ]);
    return;
  }

  await query(
    `INSERT INTO email_messages (ticket_id, direction, template, to_addresses, subject, ses_message_id, status)
     VALUES (?, 'out', ?, ?, ?, ?, ?)`,
    [
      ticket.id,
      template,
      recipients.redirected ? `${recipients.to.join(', ')} (redirected; intended: ${shownTo})` : shownTo,
      (result.subject || email.subject).slice(0, 300),
      result.messageId || null,
      result.sent ? 'sent' : 'failed',
    ],
  );

  const note = result.sent
    ? `Email sent (${template === 'service_line_new_ticket' ? 'new request' : 'confirmation'}) to ${shownTo}${recipients.redirected ? ` - TEST MODE: redirected to ${recipients.to.join(', ')}` : ''}.`
    : `Email not sent (${template}): ${result.reason}.`;
  await query("INSERT INTO ticket_events (ticket_id, type, body, is_internal) VALUES (?, 'email_sent', ?, TRUE)", [ticket.id, note]);
  log('info', 'email', { ticketId: ticket.id, template, sent: result.sent, redirected: recipients.redirected, messageId: result.messageId });
}

async function ticketCreated(ticketId) {
  const ticket = await loadTicket(ticketId);
  if (!ticket) {
    log('warn', 'Ticket not found for notification', { ticketId });
    return;
  }
  const appUrl = process.env.APP_URL || 'https://app.rmgdesk.com';
  const { photos, otherFileCount } = await loadPhotos(ticket.id);
  const routing = await loadRecipients(ticket.routing_rule_id);

  // 1. The team that owns the category. Replies go straight to the requester.
  await sendOne({
    ticket,
    template: 'service_line_new_ticket',
    to: routing.to,
    cc: routing.cc,
    replyTo: ticket.requester_email,
    attachments: photos,
    render: (banner) => templates.serviceLineNewTicket({ ticket, appUrl, photos, otherFileCount, banner }),
  });

  // 2. The requester, unless MRI Evolution is sending its own confirmation for this category.
  if (!ticket.is_evolution_linked && ticket.requester_email) {
    await sendOne({
      ticket,
      template: 'requester_confirmation',
      to: [ticket.requester_email],
      cc: [],
      replyTo: null,
      attachments: [],
      render: (banner) => templates.requesterConfirmation({ ticket, appUrl, photos, otherFileCount, banner }),
    });
  }
}

exports.handler = async (event) => {
  const batchItemFailures = [];
  for (const record of event.Records || []) {
    try {
      const msg = JSON.parse(record.body);
      if (msg.type === 'ticket.created') await ticketCreated(msg.ticketId);
      else log('warn', 'Unknown notification type', { type: msg.type });
    } catch (err) {
      log('error', 'Notification failed', { error: err.message, stack: err.stack, body: record.body });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
};

exports._internal = { ticketCreated, loadRecipients };
