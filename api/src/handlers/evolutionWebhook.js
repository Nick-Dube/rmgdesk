'use strict';
// POST /integrations/evolution/task-status
// Called by MRI Evolution workflows for tasks raised by RMG Desk. Not behind Cognito: the caller proves itself
// with a shared token (Authorization: Bearer <token>) kept in Secrets Manager.
//
// Two kinds of call, from two workflows:
//   status (task workflow, on TA_STATUS change)       event (F_EVENTS workflow, on insert)
//     ASSIGNED  -> "assigned" (with the team)            Arrived, Started -> "engineer attending" (also ends a pause)
//     COMPLETE  -> "resolved" with Evolution's notes      Paused           -> "on hold", reason from the event comment
//     CANCELLED -> "cancelled"                           others           -> internal timeline note
//     ACTIVE    -> internal timeline note
//     HISTORY   -> ignored (Evolution's own 90-day clean-up)
//
// Engineers' phones sync events in batches, so calls can arrive out of order. An event or status older than
// the last one applied to the request is noted, not applied. COMPLETE and CANCELLED always apply.
// Every call is stored in integration_inbound; the same update sent twice is applied once.
// Responses: 200 applied/noted/duplicate/ignored, 400 bad payload, 401 bad token, 404 no matching request.

const crypto = require('crypto');
const { z } = require('zod');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { query, withTransaction } = require('../lib/db');
const { notify } = require('../lib/queue');
const { OPEN } = require('../lib/workflow');

const MAX_BODY = 64 * 1024;
const ATTEND_EVENTS = ['ARRIVED', 'STARTED', 'RESUMED'];
const PAUSE_EVENTS = ['PAUSED'];

const secrets = new SecretsManagerClient({});
let tokenCache;
let tokenAt = 0;

async function expectedToken() {
  if (process.env.EVOLUTION_WEBHOOK_TOKEN) return process.env.EVOLUTION_WEBHOOK_TOKEN; // tests only
  if (!tokenCache || Date.now() - tokenAt > 5 * 60 * 1000) {
    const res = await secrets.send(new GetSecretValueCommand({ SecretId: process.env.EVOLUTION_WEBHOOK_SECRET_ARN }));
    tokenCache = res.SecretString.trim();
    tokenAt = Date.now();
  }
  return tokenCache;
}

function sameToken(given, expected) {
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

const reply = (statusCode, body) => ({ statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const log = (level, message, extra = {}) => console.log(JSON.stringify({ level, message, ...extra }));

const text = (max) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const upper = (max) => text(max).transform((v) => (v ? v.toUpperCase() : null));
const id = z.union([z.string(), z.number()]).optional().nullable().transform((v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim()));
// Dates: ISO 8601. With a zone (2026-11-14T10:05:00Z or +01:00) they are taken as given. Without one
// (2026-11-14T10:05:00, as Evolution workflows send them) they are UK local time, GMT or BST.
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/;
const london = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
/** Minutes London is ahead of UTC at this instant (0 in winter, 60 in summer). */
function londonOffset(ms) {
  const f = Object.fromEntries(london.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return (Date.UTC(+f.year, +f.month - 1, +f.day, +f.hour, +f.minute, +f.second) - Math.floor(ms / 1000) * 1000) / 60000;
}
function fromLondon(y, mo, d, h, mi, s) {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  let utc = wall - londonOffset(wall) * 60000;
  utc = wall - londonOffset(utc) * 60000; // second pass settles the hour the clocks change
  return new Date(utc);
}
function parseWhen(v) {
  if (!v) return null;
  const m = LOCAL.exec(String(v).trim());
  const d = m ? fromLondon(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0)) : new Date(v);
  return Number.isNaN(d.getTime()) || d.getUTCFullYear() < 2015 ? null : d;
}
const when = z.string().optional().nullable().transform(parseWhen);

const payloadSchema = z
  .object({
    reqId: text(40),
    taskId: id, // the task number (TA_TASK_ID); the events workflow may send only taskSeq
    taskSeq: id,
    status: upper(40), // a status call
    oldStatus: upper(40),
    event: upper(60), // an event call
    eventSeq: id,
    eventAt: when,
    statusAt: when,
    attendedAt: when,
    completedAt: when,
    resource: text(200),
    comments: text(5000),
    priority: text(40),
  })
  .passthrough()
  .refine((p) => p.status || p.event, { message: 'Send a status or an event', path: ['status'] })
  .refine((p) => p.taskId || p.taskSeq, { message: 'Send taskId or taskSeq', path: ['taskId'] })
  .refine((p) => (p.taskId ? p.taskId.length <= 40 : true) && (p.taskSeq ? p.taskSeq.length <= 40 : true), { message: 'Too long', path: ['taskId'] });

/** Store the call. Returns its id, or false when this exact update was already received. */
async function record(run, row) {
  try {
    const res = await run(
      `INSERT INTO integration_inbound (source, dedupe_key, ticket_id, external_ref, status, event_at, result, detail, payload)
       VALUES ('evolution', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.key, row.ticketId ?? null, row.taskId ?? null, row.status ?? null, row.eventAt ?? null, row.result, row.detail ?? null, row.payload],
    );
    return res.insertId;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return false;
    throw err;
  }
}
const oneOff = (key) => `${key}#${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
const iso = (d) => (d ? d.toISOString() : 'none');

exports.handler = async (event) => {
  // ---- who is calling
  const auth = event.headers?.authorization || event.headers?.Authorization || '';
  const given = auth.replace(/^Bearer\s+/i, '');
  if (!given || !sameToken(given, await expectedToken())) {
    log('warn', 'Evolution webhook: bad or missing token', { ip: event.requestContext?.http?.sourceIp });
    return reply(401, { error: 'unauthorised' });
  }

  // ---- what they sent
  let raw = event.body || '';
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  if (raw.length > MAX_BODY) return reply(413, { error: 'payload too large' });
  let p;
  try {
    p = payloadSchema.parse(JSON.parse(raw));
  } catch (err) {
    const detail = err.issues ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : 'body is not valid JSON';
    await record(query, { key: oneOff('rejected'), result: 'rejected', detail: detail.slice(0, 500), payload: raw.slice(0, 20000) });
    return reply(400, { error: 'bad payload', detail });
  }
  const payload = raw.slice(0, 60000);
  const kind = p.event ? 'event' : 'status';
  const label = p.event || p.status; // what Evolution reported, for notes and the log
  // When it happened. For the dedupe key, the same completion sent twice has the same finish time.
  const at =
    kind === 'event'
      ? p.eventAt || p.statusAt
      : p.status === 'COMPLETE'
        ? p.completedAt || p.statusAt
        : p.statusAt || p.attendedAt;
  const key = kind === 'event' ? `ev:${p.eventSeq || `${p.taskSeq || p.taskId}:${label}:${iso(at)}`}` : `st:${p.taskSeq || p.taskId}:${label}:${iso(at)}`;

  // HISTORY is Evolution's own clean-up of completed tasks: nothing to do, and not worth a row.
  if (kind === 'status' && p.status === 'HISTORY') return reply(200, { result: 'ignored', detail: 'HISTORY is not sent to RMG Desk' });

  // ---- which request
  const ref = p.reqId && /^RMG-\d+$/i.test(p.reqId) ? p.reqId.toUpperCase() : null;
  if (!ref && !p.taskId) {
    await record(query, { key: oneOff(key), taskId: p.taskSeq, status: label, eventAt: at, result: 'unmatched', detail: 'No RMG- Req ID and no task number', payload });
    return reply(404, { result: 'unmatched', error: 'Send an RMG- reqId (or the task number as taskId)' });
  }
  const found = await query(
    ref ? 'SELECT id FROM tickets WHERE reference = ?' : 'SELECT id FROM tickets WHERE evolution_task_no = ? ORDER BY id DESC LIMIT 1',
    [ref || p.taskId],
  );
  if (!found[0]) {
    await record(query, { key: oneOff(key), taskId: p.taskId || p.taskSeq, status: label, eventAt: at, result: 'unmatched', detail: `No request for ${ref || `task ${p.taskId}`}`, payload });
    log('warn', 'Evolution webhook: no matching request', { reqId: p.reqId, taskId: p.taskId, label });
    return reply(404, { result: 'unmatched', error: `No RMG Desk request matches ${ref || `task ${p.taskId}`}` });
  }
  const ticketId = found[0].id;

  // ---- apply it
  const after = [];
  const outcome = await withTransaction(async (conn) => {
    const t = (await conn.q('SELECT id, reference, status, evolution_task_no, attended_at FROM tickets WHERE id = ? FOR UPDATE', [ticketId]))[0];
    const inboundId = await record(conn.q, { key, ticketId, taskId: p.taskId || p.taskSeq, status: label, eventAt: at, result: 'noted', payload });
    if (!inboundId) return { result: 'duplicate', reference: t.reference, status: t.status };

    if (!t.evolution_task_no && p.taskId) await conn.q('UPDATE tickets SET evolution_task_no = ? WHERE id = ?', [p.taskId, ticketId]);

    const data = { source: 'evolution', kind, taskId: p.taskId || p.taskSeq, evolution: label, from: t.status, resource: p.resource, at: at ? at.toISOString() : null };
    const open = OPEN.includes(t.status);
    const now = new Date();
    const engineer = p.resource ? `Engineer: ${p.resource}` : null;

    // Has something newer already been applied? (Phones sync in batches, so events can arrive late.)
    const newer = at
      ? (await conn.q("SELECT 1 FROM integration_inbound WHERE ticket_id = ? AND result = 'applied' AND event_at > ? AND id <> ? LIMIT 1", [ticketId, at, inboundId])).length > 0
      : false;

    const change = async (to, sets, params, body, action, extra = {}) => {
      await conn.q(`UPDATE tickets SET status = ?, ${sets.join(', ')} WHERE id = ?`, [to, ...params, ticketId]);
      const ev = await conn.q("INSERT INTO ticket_events (ticket_id, type, body, data) VALUES (?, 'status_changed', ?, ?)", [
        ticketId,
        body,
        JSON.stringify({ ...data, to, action, ...extra }),
      ]);
      return ev.insertId;
    };

    let result = 'applied';
    let detail;

    if (kind === 'status' && p.status === 'COMPLETE' && open) {
      const note = p.comments || `Completed by Vertex (MRI Evolution task ${p.taskId}).`;
      const done = p.completedAt || now;
      const evId = await change(
        'resolved',
        ['resolved_at = ?', 'resolution_note = ?', 'hold_reason = NULL', 'attended_at = COALESCE(attended_at, ?)', 'acknowledged_at = COALESCE(acknowledged_at, ?)'],
        [done, note, p.attendedAt || done, p.attendedAt || done],
        [note, engineer].filter(Boolean).join('\n\n'),
        'resolve',
      );
      after.push({ type: 'ticket.status', ticketId, eventId: evId, status: 'resolved', fromEvolution: true });
      detail = 'resolved';
    } else if (kind === 'status' && p.status === 'CANCELLED' && open) {
      const evId = await change('cancelled', ['closed_at = ?', "closed_reason = 'cancelled'"], [at || now], p.comments || `Cancelled in MRI Evolution (task ${p.taskId}).`, 'cancel');
      after.push({ type: 'ticket.status', ticketId, eventId: evId, status: 'cancelled', fromEvolution: true });
      detail = 'cancelled';
    } else if (kind === 'status' && p.status === 'ASSIGNED' && ['new', 'triaged', 'reopened'].includes(t.status) && !newer) {
      await change('assigned', ['acknowledged_at = COALESCE(acknowledged_at, ?)'], [at || now], p.resource ? `Assigned to ${p.resource} in MRI Evolution.` : 'Assigned to an engineer in MRI Evolution.', 'evolution_assigned');
      detail = 'assigned';
    } else if (kind === 'event' && ATTEND_EVENTS.includes(p.event) && ['new', 'triaged', 'assigned', 'reopened', 'on_hold'].includes(t.status) && !newer) {
      const resumed = t.status === 'on_hold';
      await change(
        'attending',
        ['hold_reason = NULL', 'attended_at = COALESCE(attended_at, ?)', 'acknowledged_at = COALESCE(acknowledged_at, ?)'],
        [at || now, at || now],
        resumed ? ['Work resumed.', engineer].filter(Boolean).join(' ') : engineer,
        resumed ? 'resume' : 'attending',
      );
      detail = resumed ? 'resumed' : 'attending';
    } else if (kind === 'event' && PAUSE_EVENTS.includes(p.event) && OPEN.includes(t.status) && t.status !== 'on_hold' && !newer) {
      const reason = (p.comments || 'Paused by the engineer').replace(/\s+/g, ' ').slice(0, 120);
      await change('on_hold', ['hold_reason = ?'], [reason], [reason, engineer].filter(Boolean).join('. '), 'hold');
      detail = 'on hold';
    } else {
      // Nothing for RMG Desk to change (or the request has already moved on): keep it on the timeline for staff.
      const why = !open ? ` The request is already ${t.status.replace('_', ' ')}, so nothing changed.` : newer ? ' A later update has already been applied, so nothing changed.' : '';
      const what = kind === 'event' ? `MRI Evolution event on task ${p.taskId || t.evolution_task_no || p.taskSeq}: ${label}.` : `MRI Evolution task ${p.taskId} is now ${label}.`;
      await conn.q("INSERT INTO ticket_events (ticket_id, type, body, data, is_internal) VALUES (?, 'integration', ?, ?, TRUE)", [
        ticketId,
        `${what}${why}${p.comments && kind === 'event' ? ` ${p.comments.slice(0, 500)}` : ''}`,
        JSON.stringify(data),
      ]);
      result = open && !newer ? 'noted' : 'ignored';
      detail = !open ? `already ${t.status}` : newer ? 'out of order' : 'timeline note';
    }

    await conn.q('UPDATE integration_inbound SET result = ?, detail = ? WHERE id = ?', [result, detail, inboundId]);
    return { result, detail, reference: t.reference, status: result === 'applied' ? (await conn.q('SELECT status FROM tickets WHERE id = ?', [ticketId]))[0].status : t.status };
  });

  for (const msg of after) await notify(msg);
  log('info', 'Evolution webhook', { ticketId, taskId: p.taskId, kind, label, ...outcome });
  return reply(200, outcome);
};

exports._internal = { parseWhen };
