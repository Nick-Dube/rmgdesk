'use strict';
// Tickets API
//   POST /tickets                 raise a ticket (routes it, attaches photos, queues MRI Evolution if needed)
//   GET  /tickets?scope=&status=  list tickets the caller may see
//   GET  /tickets/{id}            one ticket with its timeline and attachments
//   POST /tickets/{id}/comments   add a comment (or an internal note, for staff)

const { HeadObjectCommand, CopyObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { SendMessageCommand } = require('@aws-sdk/client-sqs');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { wrap, json, parseBody, HttpError } = require('../lib/http');
const { query, withTransaction } = require('../lib/db');
const { resolveUser, visibilityFilter } = require('../lib/users');
const { createTicketSchema, commentSchema, listQuerySchema, MAX_UPLOAD_BYTES } = require('../lib/validation');
const { s3, sqs } = require('../lib/aws');

const BUCKET = () => process.env.ATTACHMENTS_BUCKET;
const OPEN_STATUSES = ['new', 'triaged', 'assigned', 'attending', 'made_safe', 'on_hold', 'reopened'];

function log(level, message, extra = {}) {
  console.log(JSON.stringify({ level, message, ...extra }));
}

// ------------------------------------------------------------------ routing
async function findRoutingRule(conn, categoryId, siteId) {
  const rows = await conn.q(
    `SELECT rr.id, rr.service_line_id, sl.is_evolution_linked
       FROM routing_rules rr
       JOIN service_lines sl ON sl.id = rr.service_line_id AND sl.active = TRUE
      WHERE rr.category_id = ?
        AND (rr.site_id IS NULL OR rr.site_id = ?)
        AND rr.effective_from <= CURRENT_DATE
        AND (rr.effective_to IS NULL OR rr.effective_to >= CURRENT_DATE)
      ORDER BY rr.site_id IS NULL, rr.effective_from DESC
      LIMIT 1`,
    [categoryId, siteId],
  );
  return rows[0] || null;
}

// ------------------------------------------------------------------ create
async function createTicket(event, user) {
  const input = createTicketSchema.parse(parseBody(event));

  // Every attachment must be one this user uploaded, and must really exist in the bucket.
  const ownPrefix = `uploads/${user.id}/`;
  const files = [];
  for (const a of input.attachments) {
    if (!a.key.startsWith(ownPrefix) || a.key.includes('..')) throw new HttpError(400, 'One of the attachments is not valid.');
    let head;
    try {
      head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET(), Key: a.key }));
    } catch {
      throw new HttpError(400, `"${a.fileName}" did not finish uploading. Please attach it again.`);
    }
    if (head.ContentLength > MAX_UPLOAD_BYTES) throw new HttpError(400, `"${a.fileName}" is larger than 50 MB.`);
    files.push({ ...a, size: head.ContentLength, contentType: head.ContentType || a.contentType });
  }

  const result = await withTransaction(async (conn) => {
    const building = (await conn.q('SELECT id, site_id FROM buildings WHERE id = ? AND active = TRUE', [input.buildingId]))[0];
    if (!building) throw new HttpError(400, 'Please choose a building from the list.');
    const category = (await conn.q('SELECT id, label FROM categories WHERE id = ? AND active = TRUE', [input.categoryId]))[0];
    if (!category) throw new HttpError(400, 'Please choose a category from the list.');

    const rule = await findRoutingRule(conn, category.id, building.site_id);

    const ins = await conn.q(
      `INSERT INTO tickets
         (requester_id, organisation_id, department_name, site_id, building_id, location_text, category_id,
          service_line_id, routing_rule_id, priority, status, title, description, contact_phone, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?)`,
      [
        user.id,
        user.organisation_id,
        input.departmentName,
        building.site_id,
        building.id,
        input.locationText,
        category.id,
        rule ? rule.service_line_id : null,
        rule ? rule.id : null,
        input.priority,
        input.title,
        input.description,
        input.contactPhone,
        /Mobi|Android|iPhone/i.test(event.headers?.['user-agent'] || '') ? 'mobile' : 'web',
      ],
    );
    const ticketId = ins.insertId;
    const reference = `RMG-${String(ticketId).padStart(6, '0')}`;
    await conn.q('UPDATE tickets SET reference = ? WHERE id = ?', [reference, ticketId]);

    const created = await conn.q(
      "INSERT INTO ticket_events (ticket_id, actor_id, type, data) VALUES (?, ?, 'created', ?)",
      [ticketId, user.id, JSON.stringify({ priority: input.priority, category: category.label, routed: Boolean(rule) })],
    );
    await conn.q("INSERT INTO ticket_followers (ticket_id, user_id, reason) VALUES (?, ?, 'requester')", [ticketId, user.id]);

    // Move each upload from the temporary prefix to the ticket's own folder.
    for (const f of files) {
      const finalKey = `tickets/${ticketId}/${f.key.split('/').pop()}`;
      await s3.send(
        new CopyObjectCommand({ Bucket: BUCKET(), Key: finalKey, CopySource: `${BUCKET()}/${encodeURIComponent(f.key)}` }),
      );
      await conn.q(
        `INSERT INTO attachments (ticket_id, event_id, s3_key, file_name, content_type, size_bytes, stage, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, 'report', ?)`,
        [ticketId, created.insertId, finalKey, f.fileName, f.contentType, f.size, user.id],
      );
    }

    let jobId = null;
    if (rule && rule.is_evolution_linked) {
      const job = await conn.q(
        "INSERT INTO integration_jobs (ticket_id, target, action, status) VALUES (?, 'evolution', 'raise_task', 'queued')",
        [ticketId],
      );
      jobId = job.insertId;
    }
    if (!rule) {
      await conn.q(
        "INSERT INTO ticket_events (ticket_id, type, body, is_internal) VALUES (?, 'sla', 'No routing rule matched this category. Vertex helpdesk to triage.', TRUE)",
        [ticketId],
      );
    }
    return { ticketId, reference, jobId };
  });

  // After commit: tidy temporary uploads and hand off to MRI Evolution. Failures here never lose the ticket.
  for (const f of files) {
    s3.send(new DeleteObjectCommand({ Bucket: BUCKET(), Key: f.key })).catch(() => {});
  }
  if (result.jobId) {
    try {
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: process.env.INTEGRATIONS_QUEUE_URL,
          MessageBody: JSON.stringify({ type: 'evolution.raise_task', jobId: result.jobId, ticketId: result.ticketId }),
        }),
      );
    } catch (err) {
      log('error', 'Could not queue the MRI Evolution job; it stays queued for the reconciliation job', {
        ticketId: result.ticketId,
        jobId: result.jobId,
        error: err.message,
      });
    }
  }

  log('info', 'ticket created', { ticketId: result.ticketId, reference: result.reference, userId: user.id });
  return json(201, { id: result.ticketId, reference: result.reference });
}

// ------------------------------------------------------------------ list
async function listTickets(event, user) {
  const q = listQuerySchema.parse(event.queryStringParameters || {});
  const where = [];
  const params = [];

  const vis = visibilityFilter(user);
  where.push(vis.sql);
  params.push(...vis.params);

  if (q.scope === 'mine') {
    where.push('t.requester_id = ?');
    params.push(user.id);
  } else if (q.scope === 'queue') {
    if (!user.worksTickets) throw new HttpError(403, 'You do not have a work queue.');
    if (!user.seesAll) {
      if (!user.serviceLineIds.length) return json(200, { tickets: [], next: null });
      where.push(`t.service_line_id IN (${user.serviceLineIds.map(() => '?').join(',')})`);
      params.push(...user.serviceLineIds);
    }
  }
  if (q.status === 'open' || q.status === 'closed') {
    where.push(`t.status ${q.status === 'open' ? 'IN' : 'NOT IN'} (${OPEN_STATUSES.map(() => '?').join(',')})`);
    params.push(...OPEN_STATUSES);
  }
  if (q.before) {
    where.push('t.id < ?');
    params.push(q.before);
  }

  // LIMIT is validated as an integer above, so it is safe to inline (prepared statements reject LIMIT ?).
  const rows = await query(
    `SELECT t.id, t.reference, t.title, t.priority, t.status, t.created_at AS createdAt, t.updated_at AS updatedAt,
            s.code AS siteCode, b.name AS building, t.location_text AS location, c.label AS category,
            sl.name AS serviceLine
       FROM tickets t
       JOIN sites s ON s.id = t.site_id
       JOIN buildings b ON b.id = t.building_id
       JOIN categories c ON c.id = t.category_id
       LEFT JOIN service_lines sl ON sl.id = t.service_line_id
      WHERE ${where.join(' AND ')}
      ORDER BY t.id DESC
      LIMIT ${q.limit + 1}`,
    params,
  );
  const next = rows.length > q.limit ? rows[q.limit - 1].id : null;
  return json(200, { tickets: rows.slice(0, q.limit), next });
}

// ------------------------------------------------------------------ detail
async function loadVisibleTicket(id, user) {
  const vis = visibilityFilter(user);
  const rows = await query(
    `SELECT t.*, s.code AS site_code, s.name AS site_name, b.name AS building_name, c.label AS category_label,
            sl.name AS service_line_name, u.full_name AS requester_name, u.email AS requester_email
       FROM tickets t
       JOIN sites s ON s.id = t.site_id
       JOIN buildings b ON b.id = t.building_id
       JOIN categories c ON c.id = t.category_id
       LEFT JOIN service_lines sl ON sl.id = t.service_line_id
       LEFT JOIN users u ON u.id = t.requester_id
      WHERE t.id = ? AND ${vis.sql}`,
    [id, ...vis.params],
  );
  if (!rows[0]) throw new HttpError(404, 'Ticket not found, or you do not have access to it.');
  return rows[0];
}

async function getTicket(event, user) {
  const id = Number(event.pathParameters?.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid ticket id.');
  const t = await loadVisibleTicket(id, user);

  const events = await query(
    `SELECT e.id, e.type, e.body, e.data, e.is_internal AS isInternal, e.created_at AS createdAt,
            u.full_name AS actorName
       FROM ticket_events e
       LEFT JOIN users u ON u.id = e.actor_id
      WHERE e.ticket_id = ? ${user.worksTickets ? '' : 'AND e.is_internal = FALSE'}
      ORDER BY e.id`,
    [id],
  );
  const attachmentRows = await query(
    'SELECT id, s3_key, file_name AS fileName, content_type AS contentType, size_bytes AS size, stage, created_at AS createdAt FROM attachments WHERE ticket_id = ? ORDER BY id',
    [id],
  );
  const attachments = await Promise.all(
    attachmentRows.map(async ({ s3_key, ...a }) => ({
      ...a,
      url: await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET(), Key: s3_key }), { expiresIn: 900 }),
    })),
  );

  return json(200, {
    ticket: {
      id: t.id,
      reference: t.reference,
      title: t.title,
      description: t.description,
      priority: t.priority,
      status: t.status,
      site: { code: t.site_code, name: t.site_name },
      building: t.building_name,
      location: t.location_text,
      category: t.category_label,
      serviceLine: t.service_line_name,
      department: t.department_name,
      requester: { name: t.requester_name, email: user.worksTickets || t.requester_id === user.id ? t.requester_email : undefined },
      evolutionTaskNo: user.worksTickets ? t.evolution_task_no : undefined,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      resolvedAt: t.resolved_at,
    },
    events,
    attachments,
  });
}

// ------------------------------------------------------------------ comment
async function addComment(event, user) {
  const id = Number(event.pathParameters?.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid ticket id.');
  const input = commentSchema.parse(parseBody(event));
  if (input.isInternal && !user.worksTickets) throw new HttpError(403, 'Only helpdesk staff can add internal notes.');
  await loadVisibleTicket(id, user);
  const res = await query('INSERT INTO ticket_events (ticket_id, actor_id, type, body, is_internal) VALUES (?, ?, ?, ?, ?)', [
    id,
    user.id,
    input.isInternal ? 'internal_note' : 'comment',
    input.body,
    input.isInternal,
  ]);
  await query('UPDATE tickets SET updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [id]);
  return json(201, { id: res.insertId });
}

// ------------------------------------------------------------------ router
exports.handler = wrap(async (event) => {
  const user = await resolveUser(event);
  switch (event.routeKey) {
    case 'POST /tickets':
      return createTicket(event, user);
    case 'GET /tickets':
      return listTickets(event, user);
    case 'GET /tickets/{id}':
      return getTicket(event, user);
    case 'POST /tickets/{id}/comments':
      return addComment(event, user);
    default:
      throw new HttpError(404, 'Not found.');
  }
});

exports._internal = { findRoutingRule };
