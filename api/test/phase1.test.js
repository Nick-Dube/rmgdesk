'use strict';
// Phase 1: the ticket lifecycle, status emails, auto-close, the admin console and insights.
// Unit tests always run; the database tests run when DB_USER is set (see integration.test.js).
// Cognito calls are replaced with recorders, and no queue URLs are set, so nothing leaves the machine.

const test = require('node:test');
const assert = require('node:assert/strict');
const workflow = require('../src/lib/workflow');

const enabled = Boolean(process.env.DB_USER);

// ------------------------------------------------------------------ workflow rules (no database)
test('workflow: who can do what, from where', () => {
  const agent = { id: 2, worksTickets: true, seesAll: false, serviceLineIds: [7] };
  const requester = { id: 1, worksTickets: false, seesAll: false, serviceLineIds: [] };
  const t = { id: 9, requester_id: 1, service_line_id: 7, assignee_id: null, status: 'new' };

  assert.deepEqual(workflow.allowedActions(requester, t), ['withdraw']);
  assert.ok(workflow.allowedActions(agent, t).includes('acknowledge'));
  assert.ok(!workflow.allowedActions(agent, t).includes('reopen'));
  assert.deepEqual(workflow.allowedActions(agent, { ...t, status: 'resolved' }), ['reopen']);
  assert.deepEqual(workflow.allowedActions(requester, { ...t, status: 'resolved' }), ['confirm_fixed', 'not_fixed']);
  assert.deepEqual(workflow.allowedActions({ ...agent, serviceLineIds: [3] }, t), [], 'another team cannot work it');
  assert.ok(workflow.allowedActions({ ...agent, serviceLineIds: [3] }, { ...t, assignee_id: 2 }).includes('resolve'), 'unless it is assigned to them');

  assert.equal(workflow.plan(agent, t, 'assign', { assigneeId: 2 }).nextStatus, 'assigned');
  assert.equal(workflow.plan(agent, { ...t, status: 'attending' }, 'assign', { assigneeId: 2 }).nextStatus, 'attending');
  assert.equal(workflow.plan(agent, { ...t, status: 'on_hold', attended_at: new Date() }, 'resume', {}).nextStatus, 'attending');
  assert.equal(workflow.plan(agent, { ...t, status: 'on_hold' }, 'resume', {}).nextStatus, 'triaged');
  assert.throws(() => workflow.plan(requester, t, 'resolve', { note: 'x' }), (e) => e.status === 403);
  assert.throws(() => workflow.plan(agent, { ...t, status: 'closed' }, 'resolve', { note: 'x' }), (e) => e.status === 409);
  assert.throws(() => workflow.plan(agent, t, 'resolve', {}), /Describe what was done/);
  assert.throws(() => workflow.plan(agent, t, 'hold', { reason: '  ' }), /on hold/);
  assert.throws(() => workflow.plan(agent, t, 'fly', {}), (e) => e.status === 400);
});

test('workflow: working days skip weekends', () => {
  // Monday 16 Nov 2026, 3 working days back: Wednesday 11 Nov.
  assert.equal(workflow.workingDaysBefore(new Date('2026-11-16T07:00:00Z'), 3).toISOString().slice(0, 10), '2026-11-11');
  // Wednesday 18 Nov, 3 back: Friday 13 Nov.
  assert.equal(workflow.workingDaysBefore(new Date('2026-11-18T07:00:00Z'), 3).toISOString().slice(0, 10), '2026-11-13');
});

test('status emails render for resolved, on hold and cancelled', () => {
  const templates = require('../src/lib/email/templates');
  const ticket = {
    id: 42,
    reference: 'RMG-000042',
    title: 'Leaking tap <kitchen>',
    priority: 'P3',
    site_name: 'National Maritime Museum',
    site_code: 'NMM',
    building_name: 'NMM',
    location_text: 'Staff kitchen',
    category_label: 'Localised Plumbing',
    description: 'Dripping',
    requester_name: 'Alice Smith',
    requester_email: 'alice@rmg.co.uk',
    service_line_name: 'OCS building fabric and plumbing',
    created_at: new Date('2026-11-10T09:00:00Z'),
  };
  const resolved = templates.requesterStatusUpdate({ ticket, appUrl: 'https://app.rmgdesk.com', status: 'resolved', note: 'Washer replaced.' });
  assert.match(resolved.subject, /RMG-000042: completed - is it fixed\?/);
  assert.match(resolved.html, /ticket\/\?id=42&amp;confirm=yes/);
  assert.match(resolved.html, /ticket\/\?id=42&amp;confirm=no/);
  assert.match(resolved.html, /Leaking tap &lt;kitchen&gt;/);
  assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(resolved.html), 'no raw emoji');
  assert.match(resolved.text, /confirm=yes/);
  assert.match(templates.requesterStatusUpdate({ ticket, appUrl: 'x', status: 'on_hold', note: 'Awaiting parts' }).html, /Awaiting parts/);
  assert.match(templates.requesterStatusUpdate({ ticket, appUrl: 'x', status: 'cancelled', note: 'Duplicate' }).subject, /cancelled/);
  const assigned = templates.assigneeNotice({ ticket, appUrl: 'x', assignee: { full_name: 'Bob Jones' }, assignedBy: 'Carol' });
  assert.match(assigned.subject, /Assigned to you/);
  assert.match(assigned.html, /Carol has assigned/);
  const reopened = templates.serviceLineNewTicket({ ticket, appUrl: 'x', photos: [], kind: 'Reopened', subtitle: 'Request reopened', note: 'Still dripping', noteLabel: 'Why' });
  assert.match(reopened.subject, /\] P3 Reopened:/);
  assert.match(reopened.html, /Still dripping/);
});

// ------------------------------------------------------------------ against the database
const event = (routeKey, who, { body, pathParameters, query, method, proxy } = {}) => ({
  routeKey,
  headers: { 'user-agent': 'node-test' },
  body: body ? JSON.stringify(body) : undefined,
  pathParameters: proxy !== undefined ? { proxy } : pathParameters,
  queryStringParameters: query,
  requestContext: {
    http: { method: method || routeKey.split(' ')[0], sourceIp: '127.0.0.1', userAgent: 'node-test' },
    authorizer: { jwt: { claims: { sub: who.sub, email: who.email, name: who.name, email_verified: 'true' } } },
  },
});

test('phase 1 end to end', { skip: !enabled && 'set DB_USER to run against a database' }, async (t) => {
  process.env.EMAIL_MODE = 'off';
  const { query, closePool } = require('../src/lib/db');
  const me = require('../src/handlers/me').handler;
  const reference = require('../src/handlers/reference').handler;
  const tickets = require('../src/handlers/tickets').handler;
  const admin = require('../src/handlers/admin').handler;
  const insights = require('../src/handlers/insights').handler;
  const { closeStale } = require('../src/handlers/autoClose')._internal;
  const notifier = require('../src/handlers/notifier')._internal;
  const { cognito } = require('../src/lib/cognito');

  const calls = [];
  for (const name of Object.keys(cognito)) cognito[name] = async (...args) => calls.push([name, ...args]) && { sub: null };

  const stamp = String(Date.now()).slice(-10);
  const person = (n, domain, name) => ({ sub: `10000000-0000-4000-8${n}00-00${stamp}`, email: `${name.split(' ')[0].toLowerCase()}.${stamp}@${domain}`, name });
  const requester = person(1, 'rmg.co.uk', 'Rita Requester');
  const agent = person(2, 'rmg.co.uk', 'Gary Grounds');
  const superuser = person(3, 'rmg.co.uk', 'Sue Super');
  const vertex = person(4, 'vertex.net', 'Victor Vertex');
  const other = person(5, 'rmg.co.uk', 'Ollie Other');

  const idOf = async (p) => (await query('SELECT id FROM users WHERE email = ?', [p.email]))[0].id;
  const act = (who, id, action, input) => tickets(event('POST /tickets/{id}/actions', who, { pathParameters: { id: String(id) }, body: { action, input } }));
  const get = async (who, id) => tickets(event('GET /tickets/{id}', who, { pathParameters: { id: String(id) } }));
  const body = (res) => JSON.parse(res.body);
  const call = (who, method, proxy, opts = {}) => admin(event(`${method} /admin/{proxy+}`, who, { method, proxy, ...opts }));

  try {
    for (const p of [requester, agent, superuser, vertex, other]) await me(event('GET /me', p));
    const ids = {};
    for (const [k, p] of Object.entries({ requester, agent, superuser, vertex, other })) ids[k] = await idOf(p);
    await query("UPDATE users SET role = 'agent' WHERE id IN (?, ?)", [ids.agent, ids.other]);
    await query("INSERT INTO user_scopes (user_id, service_line_id) SELECT ?, id FROM service_lines WHERE code = 'RMG_GROUNDS'", [ids.agent]);
    await query("INSERT INTO user_scopes (user_id, service_line_id) SELECT ?, id FROM service_lines WHERE code = 'OCS'", [ids.other]);
    await query("UPDATE users SET role = 'rmg_superuser' WHERE id = ?", [ids.superuser]);
    await query("UPDATE users SET role = 'vertex_superuser' WHERE id = ?", [ids.vertex]);

    const ref = body(await reference(event('GET /reference', requester)));
    const cat = (label) => ref.categories.find((c) => c.label === label).id;
    const building = ref.buildings.find((b) => b.name === 'Queens House').id;
    const raise = async (label, title) => {
      const res = await tickets(
        event('POST /tickets', requester, {
          body: { buildingId: building, categoryId: cat(label), priority: 'P3', title, description: 'Test request', locationText: 'East lawn' },
        }),
      );
      assert.equal(res.statusCode, 201, res.body);
      return body(res).id;
    };

    let id;
    await t.test('the requester sees only "withdraw"; the team sees the staff actions', async () => {
      id = await raise('Grounds', 'Hedge overgrowing the path');
      assert.deepEqual(body(await get(requester, id)).actions, ['withdraw']);
      const view = body(await get(agent, id));
      assert.equal(view.canWork, true);
      assert.ok(view.actions.includes('acknowledge') && view.actions.includes('resolve'));
      assert.equal((await get(other, id)).statusCode, 404, 'a different team cannot even see it');
      assert.equal((await act(requester, id, 'acknowledge', {})).statusCode, 403);
    });

    await t.test('acknowledge, then assign to someone on the team', async () => {
      assert.equal(body(await act(agent, id, 'acknowledge', {})).ticket.status, 'triaged');
      assert.equal((await act(agent, id, 'acknowledge', {})).statusCode, 409, 'cannot acknowledge twice');
      const list = body(await tickets(event('GET /tickets/{id}/assignees', agent, { pathParameters: { id: String(id) } }))).assignees;
      assert.ok(list.some((a) => a.id === ids.agent));
      assert.ok(list.some((a) => a.id === ids.superuser));
      assert.ok(!list.some((a) => a.id === ids.other));
      assert.equal((await act(agent, id, 'assign', { assigneeId: ids.requester })).statusCode, 400);
      const res = body(await act(agent, id, 'assign', { assigneeId: ids.agent }));
      assert.equal(res.ticket.status, 'assigned');
      assert.equal(res.ticket.assignee.id, ids.agent);
      const mine = body(await tickets(event('GET /tickets', agent, { query: { scope: 'assigned' } })));
      assert.ok(mine.tickets.some((x) => x.id === id && x.assignee === agent.name));
    });

    await t.test('hold needs a reason; resume goes back to where it was', async () => {
      assert.equal((await act(agent, id, 'hold', {})).statusCode, 400);
      const held = body(await act(agent, id, 'hold', { reason: 'Awaiting parts' }));
      assert.equal(held.ticket.status, 'on_hold');
      assert.equal(held.ticket.holdReason, 'Awaiting parts');
      assert.equal(body(await act(agent, id, 'resume', {})).ticket.status, 'assigned');
      assert.equal(body(await act(agent, id, 'attending', { note: 'On site' })).ticket.status, 'attending');
      assert.equal(body(await act(agent, id, 'made_safe', {})).ticket.status, 'made_safe');
    });

    await t.test('resolve needs a note; the requester is emailed', async () => {
      assert.equal((await act(agent, id, 'resolve', {})).statusCode, 400);
      const res = body(await act(agent, id, 'resolve', { note: 'Hedge cut back.', rootCause: 'wear_and_tear' }));
      assert.equal(res.ticket.status, 'resolved');
      assert.equal(res.ticket.resolutionNote, 'Hedge cut back.');
      assert.deepEqual(body(await get(requester, id)).actions, ['confirm_fixed', 'not_fixed']);
      const ev = (await query("SELECT id FROM ticket_events WHERE ticket_id = ? AND type = 'status_changed' ORDER BY id DESC LIMIT 1", [id]))[0];
      await notifier.ticketStatus({ ticketId: id, eventId: ev.id, status: 'resolved' });
      await notifier.ticketStatus({ ticketId: id, eventId: ev.id, status: 'resolved' });
      const notes = await query("SELECT body FROM ticket_events WHERE ticket_id = ? AND type = 'email_sent' AND body LIKE '%requester_resolved%'", [id]);
      assert.equal(notes.length, 2, 'email off: recorded each time, never sent');
      assert.match(notes[0].body, new RegExp(requester.email.replace('.', '\\.')));
    });

    await t.test('not fixed reopens it and tells the team; fixed closes it with a rating', async () => {
      assert.equal((await act(requester, id, 'not_fixed', {})).statusCode, 400);
      const re = body(await act(requester, id, 'not_fixed', { comment: 'Still blocking the path.' }));
      assert.equal(re.ticket.status, 'reopened');
      const ev = (await query("SELECT id FROM ticket_events WHERE ticket_id = ? ORDER BY id DESC LIMIT 1", [id]))[0];
      await notifier.teamNotice('reopened', { ticketId: id, eventId: ev.id });
      const sent = await query("SELECT body FROM ticket_events WHERE ticket_id = ? AND body LIKE '%team_reopened%'", [id]);
      assert.equal(sent.length, 1);
      await act(agent, id, 'resolve', { note: 'Cut back further.' });
      const closed = body(await act(requester, id, 'confirm_fixed', { rating: 5 }));
      assert.equal(closed.ticket.status, 'closed');
      assert.equal(closed.ticket.satisfaction, 5);
      assert.equal(closed.ticket.closedReason, 'confirmed');
      const row = (await query('SELECT reopen_count FROM tickets WHERE id = ?', [id]))[0];
      assert.equal(row.reopen_count, 1);
    });

    await t.test('staff can reopen a closed request, and cancel it as a duplicate', async () => {
      assert.equal(body(await act(agent, id, 'reopen', { reason: 'Came back' })).ticket.status, 'reopened');
      assert.equal((await act(agent, id, 'cancel', { reason: 'dup', duplicateOf: 'RMG-999999' })).statusCode, 400);
      const other = await raise('Grounds', 'Hedge again, by the gate');
      const ref2 = (await query('SELECT reference FROM tickets WHERE id = ?', [other]))[0].reference;
      const res = body(await act(agent, id, 'cancel', { reason: 'Same hedge', duplicateOf: ref2 }));
      assert.equal(res.ticket.status, 'cancelled');
      assert.equal(res.ticket.closedReason, 'duplicate');
    });

    await t.test('the requester can withdraw a new request', async () => {
      const w = await raise('Grounds', 'Bench needs repainting');
      const res = body(await act(requester, w, 'withdraw', { reason: 'Not needed after all' }));
      assert.equal(res.ticket.status, 'cancelled');
      assert.equal((await act(requester, w, 'withdraw', {})).statusCode, 409);
    });

    await t.test('changing the category re-routes it; to an MRI Evolution category it queues the Evolution job', async () => {
      const r = await raise('Grounds', 'Actually a lighting problem');
      await act(agent, r, 'assign', { assigneeId: ids.agent });
      const moved = body(await act(agent, r, 'recategorise', { categoryId: cat('Cleaning'), reason: 'Wrong category' }));
      assert.equal(moved.moved, undefined, 'still visible: the agent follows it as assignee');
      assert.equal(moved.ticket.serviceLine, 'RMG cleaning and vending');
      assert.equal(moved.ticket.assignee, null, 'the new team assigns its own people');
      const evo = body(await act(superuser, r, 'recategorise', { categoryId: cat('Lighting') }));
      assert.equal(evo.ticket.isEvolutionLinked, true);
      const jobs = await query("SELECT status FROM integration_jobs WHERE ticket_id = ? AND action = 'raise_task'", [r]);
      assert.equal(jobs.length, 1);
      assert.equal((await act(superuser, r, 'priority', { priority: 'P3' })).statusCode, 400, 'same priority');
      assert.equal(body(await act(superuser, r, 'priority', { priority: 'P2', reason: 'Gallery affected' })).ticket.priority, 'P2');
    });

    await t.test('auto-close: resolved for more than 3 working days', async () => {
      const a = await raise('Grounds', 'Leaves on the steps');
      await act(agent, a, 'resolve', { note: 'Swept.' });
      await query('UPDATE tickets SET resolved_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 10 DAY) WHERE id = ?', [a]);
      const b = await raise('Grounds', 'More leaves on the steps');
      await act(agent, b, 'resolve', { note: 'Swept again.', rootCause: 'weather' });
      await closeStale();
      const rows = await query('SELECT id, status, closed_reason FROM tickets WHERE id IN (?, ?) ORDER BY id', [a, b]);
      assert.deepEqual(rows.map((x) => [x.status, x.closed_reason]), [['closed', 'auto_closed'], ['resolved', null]]);
    });

    await t.test('insights: staff and viewers only, scoped to what they see', async () => {
      assert.equal((await insights(event('GET /insights', requester, {}))).statusCode, 403);
      const all = body(await insights(event('GET /insights', superuser, { query: { days: '90' } })));
      assert.equal(all.scope, 'all');
      assert.ok(all.summary.raised >= 6);
      assert.equal(all.backlog.ageing.length, 5);
      assert.ok(all.repeats.some((r) => r.category === 'Grounds' && r.building === 'Queens House'));
      assert.ok(all.rootCauses.some((r) => r.cause === 'weather'));
      const team = body(await insights(event('GET /insights', agent, {})));
      assert.equal(team.scope, 'teams');
      assert.ok(team.summary.raised <= all.summary.raised);
      assert.equal((await insights(event('GET /insights', superuser, { query: { days: '7' } }))).statusCode, 400);
    });

    // -------------------------------------------------------------- admin console
    await t.test('admin: superusers only; RMG superusers cannot give Vertex roles', async () => {
      assert.equal((await call(agent, 'GET', 'users')).statusCode, 403);
      const opts = body(await call(superuser, 'GET', 'options'));
      assert.ok(!opts.roles.some((r) => r.code.startsWith('vertex')));
      assert.ok(!opts.organisations.some((o) => o.code === 'VERTEX'));
      const vopts = body(await call(vertex, 'GET', 'options'));
      assert.ok(vopts.roles.some((r) => r.code === 'vertex_superuser'));
    });

    let invitedId;
    const partnerEmail = `pat.${stamp}@ocs.com`;
    await t.test('admin: invite a partner agent, with guard rails', async () => {
      const opts = body(await call(superuser, 'GET', 'options'));
      const ocs = opts.organisations.find((o) => o.code === 'OCS').id;
      const ocsLine = opts.serviceLines.find((s) => s.code === 'OCS').id;
      assert.equal((await call(superuser, 'POST', 'users', { body: { email: partnerEmail, fullName: 'Pat Partner', organisationId: ocs, role: 'vertex_helpdesk' } })).statusCode, 403);
      assert.equal((await call(superuser, 'POST', 'users', { body: { email: partnerEmail, fullName: 'Pat Partner', organisationId: ocs, role: 'rmg_superuser' } })).statusCode, 400);
      const res = await call(superuser, 'POST', 'users', { body: { email: partnerEmail.toUpperCase(), fullName: 'Pat Partner', organisationId: ocs, role: 'agent', serviceLineIds: [ocsLine] } });
      assert.equal(res.statusCode, 201, res.body);
      invitedId = body(res).id;
      assert.deepEqual(calls.at(-1), ['invite', { email: partnerEmail, fullName: 'Pat Partner' }]);
      const u = body(await call(superuser, 'GET', `users/${invitedId}`)).user;
      assert.equal(u.status, 'invited');
      assert.equal(u.invitedBy, superuser.name);
      assert.deepEqual(u.teams.map((x) => x.code), ['OCS']);
      assert.equal((await call(superuser, 'POST', 'users', { body: { email: partnerEmail, fullName: 'Pat', organisationId: ocs, role: 'agent' } })).statusCode, 409);
      assert.equal((await call(superuser, 'POST', `users/${invitedId}/reset-mfa`)).statusCode, 409, 'not signed in yet');
      assert.equal((await call(superuser, 'POST', `users/${invitedId}/resend-invite`)).statusCode, 200);
      // On first sign-in the invitation links to their login and they become active.
      await me(event('GET /me', { sub: `20000000-0000-4000-8000-00${stamp}`, email: partnerEmail, name: 'Pat Partner' }));
      assert.equal(body(await call(superuser, 'GET', `users/${invitedId}`)).user.status, 'active');
    });

    await t.test('admin: edit role and teams; nobody changes their own role; Vertex people are off limits to RMG', async () => {
      const res = await call(superuser, 'PATCH', `users/${invitedId}`, { body: { role: 'lead', phone: '07700 900000' } });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(body(res).user.role, 'lead');
      assert.equal((await call(superuser, 'PATCH', `users/${ids.superuser}`, { body: { role: 'requester' } })).statusCode, 403);
      assert.equal((await call(superuser, 'PATCH', `users/${ids.superuser}`, { body: { phone: '0208 000 0000' } })).statusCode, 200, 'own phone is fine');
      assert.equal((await call(superuser, 'POST', `users/${ids.vertex}/suspend`)).statusCode, 403);
      assert.equal((await call(superuser, 'POST', `users/${ids.superuser}/offboard`)).statusCode, 403);
      const hist = body(await call(superuser, 'GET', `users/${invitedId}`)).history;
      assert.deepEqual(hist.map((h) => h.action).slice(0, 3), ['user.update', 'user.resend-invite', 'user.invite']);
    });

    await t.test('admin: suspend blocks the API at once; reactivate restores it', async () => {
      assert.equal((await call(vertex, 'POST', `users/${ids.superuser}/suspend`)).statusCode, 200);
      assert.equal(calls.at(-1)[0], 'disable');
      assert.equal((await me(event('GET /me', superuser))).statusCode, 403);
      assert.equal((await call(vertex, 'POST', `users/${ids.superuser}/reactivate`)).statusCode, 200);
      assert.equal((await me(event('GET /me', superuser))).statusCode, 200);
    });

    await t.test('admin: offboarding unassigns their open requests', async () => {
      const o = await raise('Grounds', 'Broken fence panel near gate');
      await act(agent, o, 'assign', { assigneeId: ids.agent });
      const res = body(await call(superuser, 'POST', `users/${ids.agent}/offboard`));
      assert.ok(res.unassigned >= 1);
      const row = (await query('SELECT assignee_id, status FROM tickets WHERE id = ?', [o]))[0];
      assert.equal(row.assignee_id, null);
      assert.equal(row.status, 'triaged');
      assert.equal((await me(event('GET /me', agent))).statusCode, 403);
      const scopes = await query('SELECT * FROM user_scopes WHERE user_id = ?', [ids.agent]);
      assert.equal(scopes.length, 0);
    });

    await t.test('admin: routing changes keep history and are restored', async () => {
      const routing = body(await call(superuser, 'GET', 'routing')).rules;
      const rule = routing.find((r) => r.category === 'Engagement');
      assert.ok(rule && rule.recipients.length);
      const original = { serviceLineId: rule.serviceLineId, recipients: rule.recipients.map(({ email, kind }) => ({ email, kind })), notes: rule.notes };
      assert.equal((await call(superuser, 'PUT', `routing/rules/${rule.ruleId}`, { body: { ...original, recipients: [{ email: 'x@rmg.co.uk', kind: 'cc' }] } })).statusCode, 400, 'needs a To');
      const changed = body(await call(superuser, 'PUT', `routing/rules/${rule.ruleId}`, { body: { ...original, recipients: [{ email: `new.${stamp}@rmg.co.uk`, kind: 'to' }] } }));
      const rows = await query('SELECT id, effective_to IS NOT NULL AS ended FROM routing_rules WHERE id IN (?, ?) ORDER BY id', [rule.ruleId, changed.id]);
      if (rule.effectiveFrom && new Date(rule.effectiveFrom).toISOString().slice(0, 10) < new Date().toISOString().slice(0, 10)) {
        assert.notEqual(changed.id, rule.ruleId, 'an older rule is ended, a new one starts today');
        assert.equal(Boolean(rows[0].ended), true);
      }
      const again = body(await call(superuser, 'PUT', `routing/rules/${changed.id}`, { body: original }));
      assert.equal(again.id, changed.id, "today's rule is changed in place");
      const after = body(await call(superuser, 'GET', 'routing')).rules.find((r) => r.category === 'Engagement');
      assert.deepEqual(after.recipients.map((r) => r.email).sort(), original.recipients.map((r) => r.email).sort());
      assert.equal((await call(superuser, 'POST', 'routing/rules', { body: { categoryId: rule.categoryId, siteId: null, ...original } })).statusCode, 409);
    });

    await t.test('admin: announcements appear on the request form, and the audit log records it all', async () => {
      const res = await call(superuser, 'POST', 'announcements', { body: { message: `Lift 2 out of service ${stamp}` } });
      assert.equal(res.statusCode, 201, res.body);
      const annId = body(res).id;
      const live = body(await reference(event('GET /reference', requester))).announcements;
      assert.ok(live.some((a) => a.id === annId));
      assert.equal((await call(superuser, 'DELETE', `announcements/${annId}`)).statusCode, 200);
      const log = body(await call(superuser, 'GET', 'audit')).entries;
      assert.ok(log.some((e) => e.action === 'announcement.delete'));
      assert.ok(log.some((e) => e.action === 'routing.update' && e.subject === 'Engagement'));
      assert.ok(log.some((e) => e.action === 'user.offboard' && e.subject === agent.name));
    });
  } finally {
    await closePool();
  }
});
