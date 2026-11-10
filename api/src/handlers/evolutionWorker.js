'use strict';
// SQS consumer: sends Vertex-category tickets to MRI Evolution's RMGRaiseTask workflow.
// A failed message is retried by SQS (5 attempts), then lands in the dead-letter queue, which raises an alarm.
// While the secret's "enabled" flag is false, jobs are marked "skipped" so nothing reaches Evolution.

const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { query } = require('../lib/db');
const { buildRaiseTaskXml, buildEndpoint, extractTaskNumber, checkEvolutionResponse } = require('../lib/evolution');

const secrets = new SecretsManagerClient({});
let secretCache;
let secretAt = 0;

async function getEvolutionSecret() {
  if (!secretCache || Date.now() - secretAt > 5 * 60 * 1000) {
    const res = await secrets.send(new GetSecretValueCommand({ SecretId: process.env.EVOLUTION_SECRET_ARN }));
    secretCache = JSON.parse(res.SecretString);
    secretAt = Date.now();
  }
  return secretCache;
}

async function loadTicket(ticketId) {
  const rows = await query(
    `SELECT t.*, s.code AS site_code, b.name AS building_name, b.legacy_label AS building_legacy_label,
            c.name AS category_name, u.full_name AS requester_name, u.email AS requester_email,
            (SELECT COUNT(*) FROM attachments a WHERE a.ticket_id = t.id) AS attachment_count
       FROM tickets t
       JOIN sites s ON s.id = t.site_id
       JOIN buildings b ON b.id = t.building_id
       JOIN categories c ON c.id = t.category_id
       LEFT JOIN users u ON u.id = t.requester_id
      WHERE t.id = ?`,
    [ticketId],
  );
  return rows[0];
}

async function processJob(msg) {
  const job = (await query('SELECT * FROM integration_jobs WHERE id = ?', [msg.jobId]))[0];
  if (!job || job.status === 'succeeded' || job.status === 'skipped') return; // already handled: SQS can deliver twice

  const secret = await getEvolutionSecret();
  if (!secret.enabled) {
    await query("UPDATE integration_jobs SET status = 'skipped', response = 'Evolution link disabled in secret' WHERE id = ?", [job.id]);
    await query(
      "INSERT INTO ticket_events (ticket_id, type, body, is_internal) VALUES (?, 'integration', 'Not sent to MRI Evolution: the link is switched off.', TRUE)",
      [job.ticket_id],
    );
    return;
  }

  const ticket = await loadTicket(job.ticket_id);
  const appUrl = process.env.APP_URL || 'https://app.rmgdesk.com';
  const xml = buildRaiseTaskXml(ticket, appUrl, { reqIdPrefix: secret.reqIdPrefix });
  await query("UPDATE integration_jobs SET status = 'sent', attempts = attempts + 1, request = ? WHERE id = ?", [xml, job.id]);

  const res = await fetch(buildEndpoint(secret), {
    method: 'POST',
    headers: { 'content-type': 'text/xml' }, // exactly what the Integrately step sends
    body: xml,
    redirect: 'manual', // Evolution signals failure by redirecting to its error page: never follow it
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();

  const verdict = checkEvolutionResponse(res.status, text);
  if (!verdict.ok) {
    const location = res.headers.get('location');
    const detail = `${verdict.reason}\nHTTP ${res.status}${location ? `\nLocation: ${location}` : ''}\n${text}`;
    await query("UPDATE integration_jobs SET status = 'failed', response = ? WHERE id = ?", [detail.slice(0, 60000), job.id]);
    throw new Error(verdict.reason);
  }

  const taskNo = extractTaskNumber(text);
  await query("UPDATE integration_jobs SET status = 'succeeded', response = ? WHERE id = ?", [text.slice(0, 60000), job.id]);
  if (taskNo) await query('UPDATE tickets SET evolution_task_no = ? WHERE id = ?', [taskNo, job.ticket_id]);
  await query(
    "INSERT INTO ticket_events (ticket_id, type, body, data) VALUES (?, 'integration', ?, ?)",
    [job.ticket_id, taskNo ? `Logged with Vertex as task ${taskNo}.` : 'Logged with Vertex.', JSON.stringify({ taskNo })],
  );
}

exports.handler = async (event) => {
  const batchItemFailures = [];
  for (const record of event.Records || []) {
    try {
      await processJob(JSON.parse(record.body));
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', message: 'Evolution job failed', error: err.message, body: record.body }));
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
};
