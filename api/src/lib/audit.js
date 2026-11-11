'use strict';
// The audit log: who changed what in the admin console, with before and after values, IP and browser.

const { query } = require('./db');

/**
 * record(conn | null, event, actor, { action, entity, entityId, before, after })
 * Pass the transaction connection when the change is inside one, so the log commits (or rolls back) with it.
 */
async function record(conn, event, actor, { action, entity, entityId = null, before = null, after = null }) {
  const run = conn ? conn.q.bind(conn) : query;
  const http = event?.requestContext?.http || {};
  await run(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, before_data, after_data, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      actor ? actor.id : null,
      action,
      entity,
      entityId === null ? null : String(entityId),
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      http.sourceIp || null,
      (http.userAgent || event?.headers?.['user-agent'] || '').slice(0, 300) || null,
    ],
  );
}

module.exports = { record };
