'use strict';
// The MRI Evolution status webhook, against the database (runs when DB_USER is set).

const test = require('node:test');
const assert = require('node:assert/strict');

const enabled = Boolean(process.env.DB_USER);
process.env.EVOLUTION_WEBHOOK_TOKEN = 'test-token-123';
process.env.EMAIL_MODE = 'off';

test('Evolution dates without a zone are UK local time', () => {
  const { parseWhen } = require('../src/handlers/evolutionWebhook')._internal;
  assert.equal(parseWhen('2026-11-14T10:05:00').toISOString(), '2026-11-14T10:05:00.000Z', 'winter: GMT');
  assert.equal(parseWhen('2026-07-01T10:05:00').toISOString(), '2026-07-01T09:05:00.000Z', 'summer: BST');
  assert.equal(parseWhen('2026-03-29 03:30:00').toISOString(), '2026-03-29T02:30:00.000Z', 'just after clocks go forward');
  assert.equal(parseWhen('2026-10-25T00:30:00').toISOString(), '2026-10-24T23:30:00.000Z', 'just before clocks go back');
  assert.equal(parseWhen('2026-07-01T10:05:00Z').toISOString(), '2026-07-01T10:05:00.000Z', 'with Z: as given');
  assert.equal(parseWhen('2026-07-01T10:05:00+01:00').toISOString(), '2026-07-01T09:05:00.000Z');
  assert.equal(parseWhen(''), null);
  assert.equal(parseWhen('not a date'), null);
});

test('Evolution status webhook', { skip: !enabled && 'set DB_USER to run against a database' }, async (t) => {
  const { query, closePool } = require('../src/lib/db');
  const webhook = require('../src/handlers/evolutionWebhook').handler;
  const me = require('../src/handlers/me').handler;
  const tickets = require('../src/handlers/tickets').handler;
  const reference = require('../src/handlers/reference').handler;
  const notifier = require('../src/handlers/notifier')._internal;

  const stamp = String(Date.now()).slice(-10);
  const who = { sub: `40000000-0000-4000-8000-00${stamp}`, email: `wendy.${stamp}@rmg.co.uk`, name: 'Wendy Webhook' };
  const ev = (routeKey, extra = {}) => ({
    routeKey,
    headers: {},
    requestContext: { http: { method: routeKey.split(' ')[0] }, authorizer: { jwt: { claims: { sub: who.sub, email: who.email, name: who.name, email_verified: 'true' } } } },
    ...extra,
  });
  const call = (body, token = 'test-token-123') =>
    webhook({ headers: { authorization: `Bearer ${token}` }, body: typeof body === 'string' ? body : JSON.stringify(body), requestContext: { http: { sourceIp: '1.2.3.4' } } });
  const read = (res) => JSON.parse(res.body);

  try {
    await me(ev('GET /me'));
    const ref = read(await reference(ev('GET /reference')));
    const raise = async (title) => {
      const res = await tickets(
        ev('POST /tickets', {
          body: JSON.stringify({
            buildingId: ref.buildings[0].id,
            categoryId: ref.categories.find((c) => c.label === 'Lighting').id,
            priority: 'P3',
            title,
            description: 'Test',
            locationText: 'Gallery 2',
          }),
        }),
      );
      const { id, reference: r } = read(res);
      return { id, ref: r };
    };

    await t.test('a wrong or missing token is refused before anything is read', async () => {
      assert.equal((await call({ reqId: 'RMG-000001', taskId: '1', status: 'COMPLETE' }, 'nope')).statusCode, 401);
      assert.equal((await webhook({ headers: {}, body: '{}' })).statusCode, 401);
    });

    await t.test('a bad payload is refused and kept for tracing', async () => {
      const res = await call('{"taskId": "', 'test-token-123');
      assert.equal(res.statusCode, 400);
      const res2 = await call({ reqId: 'RMG-000001' });
      assert.equal(res2.statusCode, 400);
      assert.match(read(res2).detail, /taskId|status/);
    });

    await t.test('an unknown request is a 404, recorded as unmatched', async () => {
      const res = await call({ reqId: 'RMG-999999', taskId: `T${stamp}`, status: 'COMPLETE' });
      assert.equal(res.statusCode, 404);
      const rows = await query("SELECT result FROM integration_inbound WHERE external_ref = ? AND result = 'unmatched'", [`T${stamp}`]);
      assert.equal(rows.length, 1);
    });

    const a = await raise('Downlights out in the gallery');
    const taskId = `9${stamp.slice(-6)}`;

    const seq = Number(stamp.slice(-7));
    const evt = (n, event, eventAt, comments) => call({ reqId: a.ref, taskSeq: seq, event, eventSeq: `${seq}${n}`, eventAt, resource: 'Dave Spark', comments });

    await t.test('ASSIGNED moves it to "assigned" and records the task number; HISTORY is ignored', async () => {
      const res = await call({ reqId: a.ref, taskId, taskSeq: seq, status: 'ASSIGNED', oldStatus: 'ACTIVE', statusAt: '2026-11-14T09:00:00Z' });
      assert.equal(res.statusCode, 200, res.body);
      assert.deepEqual([read(res).result, read(res).status], ['applied', 'assigned']);
      const row = (await query('SELECT status, evolution_task_no, acknowledged_at FROM tickets WHERE id = ?', [a.id]))[0];
      assert.equal(row.evolution_task_no, taskId);
      assert.ok(row.acknowledged_at);
      assert.equal(read(await call({ reqId: a.ref, taskId, status: 'HISTORY' })).result, 'ignored');
    });

    await t.test('Arrived means attending (and sets the attendance time); Paused puts it on hold; Started resumes it', async () => {
      assert.equal(read(await evt(1, 'Arrived', '2026-11-14T09:30:00Z')).status, 'attending');
      const row = (await query('SELECT attended_at FROM tickets WHERE id = ?', [a.id]))[0];
      assert.equal(new Date(row.attended_at).toISOString(), '2026-11-14T09:30:00.000Z');
      const held = read(await evt(2, 'Paused', '2026-11-14T10:00:00Z', 'Awaiting LED drivers from supplier'));
      assert.deepEqual([held.result, held.status], ['applied', 'on_hold']);
      assert.equal((await query('SELECT hold_reason FROM tickets WHERE id = ?', [a.id]))[0].hold_reason, 'Awaiting LED drivers from supplier');
      assert.equal(read(await evt(2, 'Paused', '2026-11-14T10:00:00Z')).result, 'duplicate', 'same event seq');
      assert.equal(read(await evt(3, 'RESUMED', '2026-11-14T10:40:00Z')).status, 'attending', 'events carry only taskSeq');
      assert.equal((await query('SELECT hold_reason FROM tickets WHERE id = ?', [a.id]))[0].hold_reason, null);
    });

    await t.test('an event that arrives after a newer one is noted, not applied', async () => {
      const late = read(await evt(4, 'Paused', '2026-11-14T10:20:00Z'));
      assert.deepEqual([late.result, late.detail, late.status], ['ignored', 'out of order', 'attending']);
      assert.equal(read(await evt(5, 'Travelling', '2026-11-14T10:50:00Z')).result, 'noted');
    });

    const completion = { reqId: a.ref, taskId, taskSeq: seq, status: 'COMPLETE', oldStatus: 'ASSIGNED', completedAt: '2026-11-14T11:05:00Z', resource: 'Dave Spark', comments: 'Replaced two failed LED drivers. All lights working.' };

    await t.test('COMPLETE resolves it with the completion notes', async () => {
      const res = await call(completion);
      assert.equal(read(res).result, 'applied');
      const row = (await query('SELECT status, resolved_at, resolution_note FROM tickets WHERE id = ?', [a.id]))[0];
      assert.equal(row.status, 'resolved');
      assert.equal(new Date(row.resolved_at).toISOString(), '2026-11-14T11:05:00.000Z');
      assert.equal(row.resolution_note, completion.comments);
      const evt = (await query("SELECT body, data, actor_id FROM ticket_events WHERE ticket_id = ? AND type = 'status_changed' ORDER BY id DESC LIMIT 1", [a.id]))[0];
      assert.match(evt.body, /Engineer: Dave Spark/);
      assert.equal(evt.actor_id, null);
      const view = read(await tickets(ev('GET /tickets/{id}', { pathParameters: { id: String(a.id) } })));
      assert.deepEqual(view.actions, ['confirm_fixed', 'not_fixed'], 'the requester can now answer "Is it fixed?"');
    });

    await t.test('the same completion sent again is applied once', async () => {
      const res = await call({ ...completion, statusAt: new Date().toISOString() });
      assert.equal(res.statusCode, 200);
      assert.equal(read(res).result, 'duplicate');
      const n = await query("SELECT COUNT(*) AS n FROM ticket_events WHERE ticket_id = ? AND JSON_EXTRACT(data, '$.action') = 'resolve'", [a.id]);
      assert.equal(Number(n[0].n), 1);
    });

    await t.test('the requester email follows EVOLUTION_COMPLETION_EMAIL', async () => {
      const evtId = (await query("SELECT id FROM ticket_events WHERE ticket_id = ? AND type = 'status_changed' ORDER BY id DESC LIMIT 1", [a.id]))[0].id;
      const sent = async () => Number((await query("SELECT COUNT(*) AS n FROM ticket_events WHERE ticket_id = ? AND type = 'email_sent' AND body LIKE '%requester_resolved%'", [a.id]))[0].n);
      delete process.env.EVOLUTION_COMPLETION_EMAIL;
      await notifier.ticketStatus({ ticketId: a.id, eventId: evtId, status: 'resolved' });
      assert.equal(await sent(), 0, 'Evolution sends its own by default');
      process.env.EVOLUTION_COMPLETION_EMAIL = 'rmgdesk';
      await notifier.ticketStatus({ ticketId: a.id, eventId: evtId, status: 'resolved' });
      assert.equal(await sent(), 1);
      delete process.env.EVOLUTION_COMPLETION_EMAIL;
    });

    await t.test('a later status on a finished request only adds a note', async () => {
      const res = await call({ ...completion, status: 'ACTIVE', completedAt: null, statusAt: '2026-11-15T08:00:00Z' });
      assert.equal(read(res).result, 'ignored');
      assert.equal((await query('SELECT status FROM tickets WHERE id = ?', [a.id]))[0].status, 'resolved');
    });

    await t.test('without a Req ID it matches on the task number; CANCELLED cancels', async () => {
      const b = await raise('Spotlight flickering in the shop');
      await call({ reqId: b.ref, taskId: `${taskId}1`, status: 'ACTIVE' });
      const res = await call({ reqId: '', taskId: `${taskId}1`, status: 'CANCELLED', statusAt: '2026-11-14T12:00:00Z', comments: 'Duplicate of task 1234' });
      assert.equal(read(res).result, 'applied');
      const row = (await query('SELECT status, closed_reason FROM tickets WHERE id = ?', [b.id]))[0];
      assert.deepEqual([row.status, row.closed_reason], ['cancelled', 'cancelled']);
    });
  } finally {
    await closePool();
  }
});
