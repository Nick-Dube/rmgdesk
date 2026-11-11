'use strict';
// Tickets API
//   POST /tickets                    raise a ticket (routes it, attaches photos, queues MRI Evolution and emails)
//   GET  /tickets?scope=&status=     list tickets the caller may see (scope: mine, assigned, queue, all)
//   GET  /tickets/{id}               one ticket with its timeline, attachments and the actions allowed now
//   POST /tickets/{id}/comments      add a comment (or an internal note, for staff)
//   POST /tickets/{id}/actions       change it: acknowledge, assign, attending, made_safe, hold, resume, resolve,
//                                    cancel, priority, recategorise, reopen; requester: confirm_fixed, not_fixed, withdraw
//   GET  /tickets/{id}/assignees     people who can be assigned this ticket

const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { wrap, json, parseBody, HttpError } = require('../lib/http');
const { query, withTransaction } = require('../lib/db');
const { resolveUser, visibilityFilter } = require('../lib/users');
const { createTicketSchema, commentSchema, listQuerySchema } = require('../lib/validation');
const { s3 } = require('../lib/aws');
const { notify, integrate } = require('../lib/queue');
const { checkUploads, attachUploads, tidyUploads } = require('../lib/attachments');
const workflow = require('../lib/workflow');

const BUCKET = () => process.env.ATTACHMENTS_BUCKET;
const WORKER_ROLES = ['agent', 'lead', 'rmg_superuser', 'vertex_helpdesk', 'vertex_superuser'];
const ALL_TICKET_ROLES = ['rmg_superuser', 'vertex_helpdesk', 'vertex_superuser'];

function log(level, message, extra = {}) {
  console.log(JSON.stringify({ level, message, ...extra }));
}

function ticketId(event) {
  const id = Number(event.pathParameters?.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid ticket id.');
  return id;
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
  const files = await checkUploads(user, input.attachments);

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
    const id = ins.insertId;
    const reference = `RMG-${String(id).padStart(6, '0')}`;
    await conn.q('UPDATE tickets SET reference = ? WHERE id = ?', [reference, id]);

    const created = await conn.q(
      "INSERT INTO ticket_events (ticket_id, actor_id, type, data) VALUES (?, ?, 'created', ?)",
      [id, user.id, JSON.stringify({ priority: input.priority, category: category.label, routed: Boolean(rule) })],
    );
    await conn.q("INSERT INTO ticket_followers (ticket_id, user_id, reason) VALUES (?, ?, 'requester')", [id, user.id]);
    await attachUploads(conn, { ticketId: id, eventId: created.insertId, userId: user.id, files, stage: 'report' });

    let jobId = null;
    if (rule && rule.is_evolution_linked) {
      const job = await conn.q("INSERT INTO integration_jobs (ticket_id, target, action, status) VALUES (?, 'evolution', 'raise_task', 'queued')", [id]);
      jobId = job.insertId;
    }
    if (!rule) {
      await conn.q(
        "INSERT INTO ticket_events (ticket_id, type, body, is_internal) VALUES (?, 'sla', 'No routing rule matched this category. Vertex helpdesk to triage.', TRUE)",
        [id],
      );
    }
    return { ticketId: id, reference, jobId };
  });

  // After commit: tidy uploads, then hand off. Failures here never lose the ticket.
  tidyUploads(files);
  if (result.jobId) await integrate({ type: 'evolution.raise_task', jobId: result.jobId, ticketId: result.ticketId });
  await notify({ type: 'ticket.created', ticketId: result.ticketId });

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
  } else if (q.scope === 'assigned') {
    where.push('t.assignee_id = ?');
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
    where.push(`t.status ${q.status === 'open' ? 'IN' : 'NOT IN'} (${workflow.OPEN.map(() => '?').join(',')})`);
    params.push(...workflow.OPEN);
  }
  if (q.before) {
    where.push('t.id < ?');
    params.push(q.before);
  }

  // LIMIT is validated as an integer above, so it is safe to inline (prepared statements reject LIMIT ?).
  const rows = await query(
    `SELECT t.id, t.reference, t.title, t.priority, t.status, t.created_at AS createdAt, t.updated_at AS updatedAt,
            s.code AS siteCode, b.name AS building, t.location_text AS location, c.label AS category,
            sl.name AS serviceLine, a.full_name AS assignee
       FROM tickets t
       JOIN sites s ON s.id = t.site_id
       JOIN buildings b ON b.id = t.building_id
       JOIN categories c ON c.id = t.category_id
       LEFT JOIN service_lines sl ON sl.id = t.service_line_id
       LEFT JOIN users a ON a.id = t.assignee_id
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
            sl.name AS service_line_name, sl.is_evolution_linked, u.full_name AS requester_name, u.email AS requester_email,
            a.full_name AS assignee_name
       FROM tickets t
       JOIN sites s ON s.id = t.site_id
       JOIN buildings b ON b.id = t.building_id
       JOIN categories c ON c.id = t.category_id
       LEFT JOIN service_lines sl ON sl.id = t.service_line_id
       LEFT JOIN users u ON u.id = t.requester_id
       LEFT JOIN users a ON a.id = t.assignee_id
      WHERE t.id = ? AND ${vis.sql}`,
    [id, ...vis.params],
  );
  if (!rows[0]) throw new HttpError(404, 'Ticket not found, or you do not have access to it.');
  return rows[0];
}

async function getTicket(event, user, idOverride) {
  const id = idOverride || ticketId(event);
  const t = await loadVisibleTicket(id, user);
  const staff = workflow.canWork(user, t);

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
      categoryId: t.category_id,
      category: t.category_label,
      serviceLineId: t.service_line_id,
      serviceLine: t.service_line_name,
      isEvolutionLinked: Boolean(t.is_evolution_linked),
      assignee: t.assignee_id ? { id: t.assignee_id, name: t.assignee_name } : null,
      department: t.department_name,
      requester: { name: t.requester_name, email: user.worksTickets || t.requester_id === user.id ? t.requester_email : undefined },
      contactPhone: staff || t.requester_id === user.id ? t.contact_phone : undefined,
      evolutionTaskNo: user.worksTickets ? t.evolution_task_no : undefined,
      holdReason: t.hold_reason,
      resolutionNote: t.resolution_note,
      rootCause: staff ? t.root_cause : undefined,
      satisfaction: t.satisfaction,
      closedReason: t.closed_reason,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      resolvedAt: t.resolved_at,
      closedAt: t.closed_at,
    },
    isRequester: t.requester_id === user.id,
    canWork: staff,
    actions: workflow.allowedActions(user, t),
    events,
    attachments,
  });
}

// ------------------------------------------------------------------ comment
async function addComment(event, user) {
  const id = ticketId(event);
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

// ------------------------------------------------------------------ assignees
async function assigneeCandidates(t) {
  return query(
    `SELECT DISTINCT u.id, u.full_name AS name, o.name AS organisation, u.role
       FROM users u
       JOIN organisations o ON o.id = u.organisation_id
       LEFT JOIN user_scopes sc ON sc.user_id = u.id
      WHERE u.status = 'active'
        AND (u.role IN (${ALL_TICKET_ROLES.map(() => '?').join(',')})
             OR (u.role IN ('agent', 'lead') AND sc.service_line_id = ?))
      ORDER BY u.full_name`,
    [...ALL_TICKET_ROLES, t.service_line_id || 0],
  );
}

async function listAssignees(event, user) {
  const t = await loadVisibleTicket(ticketId(event), user);
  if (!workflow.canWork(user, t)) throw new HttpError(403, 'Only the team working this request can assign it.');
  return json(200, { assignees: await assigneeCandidates(t) });
}

// ------------------------------------------------------------------ actions
async function takeAction(event, user) {
  const id = ticketId(event);
  const body = parseBody(event);
  const t = await loadVisibleTicket(id, user);

  let planned;
  try {
    planned = workflow.plan(user, t, body.action, body.input);
  } catch (err) {
    if (err.status) throw new HttpError(err.status, err.message);
    throw err; // validation errors are turned into field messages by wrap()
  }
  const { action, input, nextStatus } = planned;
  const files = action === 'resolve' ? await checkUploads(user, input.attachments) : [];
  const after = []; // background work to queue once the change is committed

  await withTransaction(async (conn) => {
    // Lock the row, and make sure nobody changed the status while we were deciding.
    const current = (await conn.q('SELECT status FROM tickets WHERE id = ? FOR UPDATE', [id]))[0];
    if (current.status !== t.status) throw new HttpError(409, 'Someone else has just updated this request. Please refresh and try again.');

    const sets = ['status = ?'];
    const params = [nextStatus];
    let eventType = 'status_changed';
    let eventBody = null;
    let isInternal = false;
    const data = { from: t.status, to: nextStatus, action };

    switch (action) {
      case 'acknowledge':
        sets.push('acknowledged_at = COALESCE(acknowledged_at, CURRENT_TIMESTAMP(3))');
        break;
      case 'assign': {
        if (input.assigneeId) {
          const ok = (await assigneeCandidates(t)).some((c) => c.id === input.assigneeId);
          if (!ok) throw new HttpError(400, 'That person cannot be assigned this request.');
        }
        sets.push('assignee_id = ?', 'acknowledged_at = COALESCE(acknowledged_at, CURRENT_TIMESTAMP(3))');
        params.push(input.assigneeId);
        eventType = 'assigned';
        const name = input.assigneeId ? (await conn.q('SELECT full_name FROM users WHERE id = ?', [input.assigneeId]))[0].full_name : null;
        eventBody = name ? `Assigned to ${name}.` : 'Unassigned.';
        isInternal = true;
        data.assigneeId = input.assigneeId;
        if (input.assigneeId) {
          await conn.q(
            "INSERT INTO ticket_followers (ticket_id, user_id, reason) VALUES (?, ?, 'assignee') ON DUPLICATE KEY UPDATE reason = reason",
            [id, input.assigneeId],
          );
          if (input.assigneeId !== user.id) after.push({ type: 'ticket.assigned', ticketId: id, assigneeId: input.assigneeId });
        }
        break;
      }
      case 'attending':
        sets.push('attended_at = COALESCE(attended_at, CURRENT_TIMESTAMP(3))', 'acknowledged_at = COALESCE(acknowledged_at, CURRENT_TIMESTAMP(3))');
        eventBody = input.note;
        break;
      case 'made_safe':
        sets.push('made_safe_at = COALESCE(made_safe_at, CURRENT_TIMESTAMP(3))', 'attended_at = COALESCE(attended_at, CURRENT_TIMESTAMP(3))');
        eventBody = input.note;
        break;
      case 'hold':
        sets.push('hold_reason = ?');
        params.push(input.reason);
        eventBody = input.note ? `${input.reason}. ${input.note}` : input.reason;
        break;
      case 'resume':
        sets.push('hold_reason = NULL');
        eventBody = input.note;
        break;
      case 'resolve':
        sets.push('resolved_at = CURRENT_TIMESTAMP(3)', 'resolution_note = ?', 'root_cause = COALESCE(?, root_cause)', 'hold_reason = NULL');
        params.push(input.note, input.rootCause || null);
        eventBody = input.note;
        break;
      case 'cancel': {
        let dup = null;
        if (input.duplicateOf) {
          const ref = input.duplicateOf.toUpperCase().replace(/^(\d+)$/, (n) => `RMG-${n.padStart(6, '0')}`);
          dup = (await conn.q('SELECT id, reference FROM tickets WHERE reference = ? AND id <> ?', [ref, id]))[0];
          if (!dup) throw new HttpError(400, `No request ${ref} was found to mark this as a duplicate of.`);
        }
        sets.push('closed_at = CURRENT_TIMESTAMP(3)', 'closed_reason = ?', 'duplicate_of_id = ?');
        params.push(dup ? 'duplicate' : 'cancelled', dup ? dup.id : null);
        eventBody = dup ? `Duplicate of ${dup.reference}. ${input.reason}` : input.reason;
        break;
      }
      case 'priority':
        if (input.priority === t.priority) throw new HttpError(400, `The priority is already ${t.priority}.`);
        sets.push('priority = ?');
        params.push(input.priority);
        eventType = 'priority_changed';
        eventBody = `Priority changed from ${t.priority} to ${input.priority}.${input.reason ? ` ${input.reason}` : ''}`;
        data.priority = { from: t.priority, to: input.priority };
        break;
      case 'recategorise': {
        if (input.categoryId === t.category_id) throw new HttpError(400, 'That is already the category.');
        const category = (await conn.q('SELECT id, label FROM categories WHERE id = ? AND active = TRUE', [input.categoryId]))[0];
        if (!category) throw new HttpError(400, 'Choose a category from the list.');
        const rule = await findRoutingRule(conn, category.id, t.site_id);
        const newLine = rule ? rule.service_line_id : null;
        sets.push('category_id = ?', 'routing_rule_id = ?', 'service_line_id = ?');
        params.push(category.id, rule ? rule.id : null, newLine);
        if (newLine !== t.service_line_id) sets.push('assignee_id = NULL'); // the new team assigns its own people
        eventType = 'category_changed';
        eventBody = `Category changed from ${t.category_label} to ${category.label}.${input.reason ? ` ${input.reason}` : ''}`;
        data.category = { from: t.category_id, to: category.id };
        if (newLine !== t.service_line_id) {
          after.push({ type: 'ticket.rerouted', ticketId: id });
          if (rule && rule.is_evolution_linked) {
            const existing = await conn.q("SELECT id FROM integration_jobs WHERE ticket_id = ? AND action = 'raise_task'", [id]);
            if (!existing.length) {
              const job = await conn.q("INSERT INTO integration_jobs (ticket_id, target, action, status) VALUES (?, 'evolution', 'raise_task', 'queued')", [id]);
              after.push({ integrate: true, type: 'evolution.raise_task', jobId: job.insertId, ticketId: id });
            }
          }
        }
        break;
      }
      case 'reopen':
        sets.push('resolved_at = NULL', 'closed_at = NULL', 'closed_reason = NULL', 'reopen_count = reopen_count + 1');
        eventBody = input.reason;
        after.push({ type: 'ticket.reopened', ticketId: id });
        break;
      case 'confirm_fixed':
        sets.push('closed_at = CURRENT_TIMESTAMP(3)', "closed_reason = 'confirmed'", 'satisfaction = ?');
        params.push(input.rating || null);
        eventBody = input.comment || 'Confirmed fixed.';
        if (input.rating) data.rating = input.rating;
        break;
      case 'not_fixed':
        sets.push('resolved_at = NULL', 'reopen_count = reopen_count + 1');
        eventBody = input.comment;
        after.push({ type: 'ticket.reopened', ticketId: id });
        break;
      case 'withdraw':
        sets.push('closed_at = CURRENT_TIMESTAMP(3)', "closed_reason = 'cancelled'");
        eventBody = input.reason || 'Withdrawn by the requester.';
        break;
      default:
        throw new HttpError(400, 'Unknown action.');
    }

    params.push(id);
    await conn.q(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ?`, params);
    const ev = await conn.q('INSERT INTO ticket_events (ticket_id, actor_id, type, body, data, is_internal) VALUES (?, ?, ?, ?, ?, ?)', [
      id,
      user.id,
      eventType,
      eventBody,
      JSON.stringify(data),
      isInternal,
    ]);
    for (const msg of after) if (!msg.integrate) msg.eventId = ev.insertId; // lets the notifier send each email once
    if (files.length) await attachUploads(conn, { ticketId: id, eventId: ev.insertId, userId: user.id, files, stage: 'after' });
    if (['on_hold', 'resolved', 'cancelled'].includes(nextStatus) && nextStatus !== t.status && action !== 'withdraw') {
      after.push({ type: 'ticket.status', ticketId: id, eventId: ev.insertId, status: nextStatus });
    }
  });

  tidyUploads(files);
  for (const msg of after) {
    if (msg.integrate) await integrate({ type: msg.type, jobId: msg.jobId, ticketId: msg.ticketId });
    else await notify(msg);
  }
  log('info', 'ticket action', { ticketId: id, action, from: t.status, to: nextStatus, userId: user.id });
  const updated = await getTicket(event, user, id).catch((err) => {
    // Moving a request to another team can take it out of this person's view. The change still worked.
    if (err instanceof HttpError && err.statusCode === 404) return json(200, { moved: true, message: 'Done. The request has moved to another team.' });
    throw err;
  });
  return updated;
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
    case 'POST /tickets/{id}/actions':
      return takeAction(event, user);
    case 'GET /tickets/{id}/assignees':
      return listAssignees(event, user);
    default:
      throw new HttpError(404, 'Not found.');
  }
});

exports._internal = { findRoutingRule };
