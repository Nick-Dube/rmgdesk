'use strict';
// SQS consumer: sends RMG Desk's emails.
//   ticket.created   "new request" to the routing rule's recipients (photos embedded), and
//                    "your request has been logged" to the requester (not for MRI Evolution categories,
//                    where Evolution sends its own confirmation)
//   ticket.status    to the requester when their request is resolved (with "is it fixed?" buttons),
//                    put on hold or cancelled (not for MRI Evolution categories)
//   ticket.assigned  to the person just assigned
//   ticket.reopened  to the team, when a request comes back
//   ticket.rerouted  to the new team, when a request is moved to another category
// Each email is recorded in email_messages and on the ticket timeline (internal). A message that SQS
// delivers twice does not send twice: an email already recorded as sent under the same key is skipped.

const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { query } = require('../lib/db');
const { s3 } = require('../lib/aws');
const { resolveRecipients, deliver } = require('../lib/email/send');
const templates = require('../lib/email/templates');

const INLINE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MAX_INLINE_PHOTOS = 4;
const MAX_INLINE_BYTES = 6 * 1024 * 1024; // keep the whole email comfortably small

const appUrl = () => process.env.APP_URL || 'https://app.rmgdesk.com';

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
       LEFT JOIN users u ON u.id = r.user_id
      WHERE r.routing_rule_id = ?
        AND (r.user_id IS NULL OR u.status IN ('active', 'invited'))`,
    [ruleId],
  );
  return {
    to: rows.filter((r) => r.kind === 'to' && r.email).map((r) => r.email),
    cc: rows.filter((r) => r.kind === 'cc' && r.email).map((r) => r.email),
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

const LABELS = {
  service_line_new_ticket: 'new request',
  requester_confirmation: 'confirmation',
  requester_resolved: 'completed, is it fixed?',
  requester_on_hold: 'on hold',
  requester_cancelled: 'cancelled',
  assignee_notice: 'assigned',
  team_reopened: 'reopened',
  team_rerouted: 're-routed',
};

/** key: the dedupe key stored as the email's template, e.g. "requester_resolved:812" (one per timeline event). */
async function sendOne({ ticket, template, key = template, to, cc, replyTo, render, attachments }) {
  if (await alreadySent(ticket.id, key)) return;

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
      key,
      recipients.redirected ? `${recipients.to.join(', ')} (redirected; intended: ${shownTo})` : shownTo,
      (result.subject || email.subject).slice(0, 300),
      result.messageId || null,
      result.sent ? 'sent' : 'failed',
    ],
  );

  const note = result.sent
    ? `Email sent (${LABELS[template] || template}) to ${shownTo}${recipients.redirected ? ` - TEST MODE: redirected to ${recipients.to.join(', ')}` : ''}.`
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
    render: (banner) => templates.serviceLineNewTicket({ ticket, appUrl: appUrl(), photos, otherFileCount, banner }),
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
      render: (banner) => templates.requesterConfirmation({ ticket, appUrl: appUrl(), photos, otherFileCount, banner }),
    });
  }
}

async function loadEvent(ticketId, eventId) {
  if (!eventId) return null;
  const rows = await query('SELECT id, body, data, actor_id FROM ticket_events WHERE id = ? AND ticket_id = ?', [eventId, ticketId]);
  return rows[0] || null;
}

async function actorName(ev) {
  if (!ev || !ev.actor_id) return null;
  const rows = await query('SELECT full_name FROM users WHERE id = ?', [ev.actor_id]);
  return rows[0] ? rows[0].full_name : null;
}

/** Resolved, on hold or cancelled: tell the requester. MRI Evolution sends its own emails for its categories. */
async function ticketStatus({ ticketId, eventId, status }) {
  const ticket = await loadTicket(ticketId);
  if (!ticket || !ticket.requester_email) return;
  if (ticket.is_evolution_linked) return;
  if (ticket.status !== status) {
    log('info', 'Status changed again before the email went; not sending', { ticketId, wanted: status, now: ticket.status });
    return;
  }
  const ev = await loadEvent(ticketId, eventId);
  const note = status === 'resolved' ? ticket.resolution_note : (ev && ev.body) || ticket.hold_reason || '';
  const template = `requester_${status}`;
  await sendOne({
    ticket,
    template,
    key: `${template}:${eventId || 0}`,
    to: [ticket.requester_email],
    cc: [],
    replyTo: null,
    attachments: [],
    render: (banner) => templates.requesterStatusUpdate({ ticket, appUrl: appUrl(), status, note, banner }),
  });
}

async function ticketAssigned({ ticketId, assigneeId, eventId }) {
  const ticket = await loadTicket(ticketId);
  if (!ticket || ticket.assignee_id !== assigneeId) return; // reassigned again since
  const assignee = (await query("SELECT id, email, full_name, notify_mode FROM users WHERE id = ? AND status = 'active'", [assigneeId]))[0];
  if (!assignee || assignee.notify_mode === 'off') return;
  const assignedBy = await actorName(await loadEvent(ticketId, eventId));
  await sendOne({
    ticket,
    template: 'assignee_notice',
    key: `assignee_notice:${eventId || assigneeId}`,
    to: [assignee.email],
    cc: [],
    replyTo: ticket.requester_email,
    attachments: [],
    render: (banner) => templates.assigneeNotice({ ticket, appUrl: appUrl(), assignee, assignedBy, banner }),
  });
}

/** Back to the team: reopened (by the requester or staff) or moved to them from another category. */
async function teamNotice(kind, { ticketId, eventId }) {
  const ticket = await loadTicket(ticketId);
  if (!ticket) return;
  const ev = await loadEvent(ticketId, eventId);
  const who = await actorName(ev);
  const routing = await loadRecipients(ticket.routing_rule_id);
  if (ticket.assignee_id) {
    const a = (await query("SELECT email FROM users WHERE id = ? AND status = 'active'", [ticket.assignee_id]))[0];
    if (a && !routing.to.includes(a.email)) routing.to.push(a.email);
  }
  const { photos, otherFileCount } = await loadPhotos(ticket.id);
  const reopened = kind === 'reopened';
  const template = reopened ? 'team_reopened' : 'team_rerouted';
  await sendOne({
    ticket,
    template,
    key: `${template}:${eventId || 0}`,
    to: routing.to,
    cc: routing.cc,
    replyTo: ticket.requester_email,
    attachments: photos,
    render: (banner) =>
      templates.serviceLineNewTicket({
        ticket,
        appUrl: appUrl(),
        photos,
        otherFileCount,
        banner,
        kind: reopened ? 'Reopened' : 'Re-routed',
        subtitle: reopened ? 'Request reopened' : 'Request moved to your team',
        intro: reopened
          ? `This request has come back to <strong>${templates.esc(ticket.service_line_name || 'the helpdesk')}</strong>${who ? ` (reopened by ${templates.esc(who)})` : ''}. It is not fixed yet.`
          : `This request has been moved to <strong>${templates.esc(ticket.service_line_name || 'the helpdesk')}</strong>${who ? ` by ${templates.esc(who)}` : ''}. It is now yours.`,
        note: ev && ev.body,
        noteLabel: reopened ? 'Why it was reopened' : 'Reason',
      }),
  });
}

exports.handler = async (event) => {
  const batchItemFailures = [];
  for (const record of event.Records || []) {
    try {
      const msg = JSON.parse(record.body);
      if (msg.type === 'ticket.created') await ticketCreated(msg.ticketId);
      else if (msg.type === 'ticket.status') await ticketStatus(msg);
      else if (msg.type === 'ticket.assigned') await ticketAssigned(msg);
      else if (msg.type === 'ticket.reopened') await teamNotice('reopened', msg);
      else if (msg.type === 'ticket.rerouted') await teamNotice('rerouted', msg);
      else log('warn', 'Unknown notification type', { type: msg.type });
    } catch (err) {
      log('error', 'Notification failed', { error: err.message, stack: err.stack, body: record.body });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
};

exports._internal = { ticketCreated, ticketStatus, ticketAssigned, teamNotice, loadRecipients };
