'use strict';
// Sending email through Amazon SES (v2 API) as a raw MIME message, so photos can be embedded.
//
// EMAIL_MODE controls who actually receives mail:
//   live      - the real recipients
//   redirect  - everything goes to EMAIL_REDIRECT_TO instead, with a banner listing who it would have gone to
//   off       - nothing is sent (logged only)
// Production starts in "redirect" until the pilot, so testing never emails RMG staff or contractors.

const MailComposerModule = require('nodemailer/lib/mail-composer');
const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');
const { redirectBanner } = require('./layout');

const MailComposer = MailComposerModule.default || MailComposerModule;
const ses = new SESv2Client({});

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

function cleanList(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list || []) {
    const a = String(raw || '').trim().toLowerCase();
    if (EMAIL_RE.test(a) && !seen.has(a)) {
      seen.add(a);
      out.push(a);
    }
  }
  return out;
}

function mode() {
  return (process.env.EMAIL_MODE || 'redirect').toLowerCase();
}

/**
 * Work out who will really receive an email. Returns the actual to/cc, the intended ones, whether it was
 * redirected, and the banner HTML to show in the email when it was.
 */
function resolveRecipients({ to, cc }) {
  const intended = { to: cleanList(to), cc: cleanList(cc).filter((a) => !cleanList(to).includes(a)) };
  const m = mode();
  if (m === 'live') return { mode: m, intended, to: intended.to, cc: intended.cc, redirected: false, banner: '' };
  if (m === 'off') return { mode: m, intended, to: [], cc: [], redirected: false, banner: '' };
  const target = cleanList([process.env.EMAIL_REDIRECT_TO]);
  return { mode: 'redirect', intended, to: target, cc: [], redirected: true, banner: redirectBanner(intended) };
}

function buildRaw({ from, to, cc, replyTo, subject, html, text, attachments }) {
  const mail = new MailComposer({
    from,
    to,
    cc: cc && cc.length ? cc : undefined,
    replyTo: replyTo || undefined,
    subject,
    text,
    html,
    attachments: (attachments || []).map((a) => ({
      filename: a.fileName,
      content: a.content,
      contentType: a.contentType,
      cid: a.cid,
      contentDisposition: 'inline',
    })),
    headers: { 'X-Auto-Response-Suppress': 'OOF, AutoReply' },
  });
  return mail.compile().build();
}

/**
 * Send one email. recipients comes from resolveRecipients(). Returns { sent, messageId } or { sent: false, reason }.
 */
async function deliver(recipients, { replyTo, subject, html, text, attachments }) {
  if (recipients.mode === 'off') return { sent: false, reason: 'EMAIL_MODE is off' };
  if (!recipients.to.length) return { sent: false, reason: 'no valid recipients' };

  const finalSubject = recipients.redirected ? `[TEST] ${subject}` : subject;
  const raw = await buildRaw({
    from: process.env.EMAIL_FROM || 'RMG Helpdesk <no-reply@rmgdesk.com>',
    to: recipients.to,
    cc: recipients.cc,
    replyTo,
    subject: finalSubject,
    html,
    text,
    attachments,
  });
  const res = await ses.send(
    new SendEmailCommand({
      FromEmailAddress: process.env.EMAIL_FROM || 'RMG Helpdesk <no-reply@rmgdesk.com>',
      Destination: { ToAddresses: recipients.to, CcAddresses: recipients.cc },
      Content: { Raw: { Data: raw } },
      ...(process.env.SES_CONFIGURATION_SET ? { ConfigurationSetName: process.env.SES_CONFIGURATION_SET } : {}),
    }),
  );
  return { sent: true, messageId: res.MessageId, subject: finalSubject };
}

module.exports = { resolveRecipients, deliver, buildRaw, cleanList };
