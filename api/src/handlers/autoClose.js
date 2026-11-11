'use strict';
// Runs every weekday morning (EventBridge schedule). Closes requests that were resolved more than
// 3 working days ago and that the requester has not confirmed or reopened. Each one gets a timeline entry.

const { query, withTransaction } = require('../lib/db');
const { workingDaysBefore } = require('../lib/workflow');

const WORKING_DAYS = 3;

function log(level, message, extra = {}) {
  console.log(JSON.stringify({ level, message, ...extra }));
}

async function closeStale(now = new Date()) {
  const cutoff = workingDaysBefore(now, WORKING_DAYS);
  const due = await query("SELECT id FROM tickets WHERE status = 'resolved' AND resolved_at < ? ORDER BY id LIMIT 500", [cutoff]);
  let closed = 0;
  for (const { id } of due) {
    const done = await withTransaction(async (conn) => {
      const res = await conn.q(
        "UPDATE tickets SET status = 'closed', closed_at = CURRENT_TIMESTAMP(3), closed_reason = 'auto_closed' WHERE id = ? AND status = 'resolved'",
        [id],
      );
      if (!res.affectedRows) return false; // the requester answered while we were working
      await conn.q("INSERT INTO ticket_events (ticket_id, type, body, data) VALUES (?, 'status_changed', ?, ?)", [
        id,
        `Closed automatically: no reply ${WORKING_DAYS} working days after it was completed.`,
        JSON.stringify({ from: 'resolved', to: 'closed', action: 'auto_close' }),
      ]);
      return true;
    });
    if (done) closed += 1;
  }
  log('info', 'auto-close finished', { cutoff: cutoff.toISOString(), due: due.length, closed });
  return { closed };
}

exports.handler = async () => closeStale();
exports._internal = { closeStale };
