'use strict';
// End-to-end handler tests against a real MySQL database with the migrations applied.
// Runs only when DB_USER is set, e.g.:
//   DB_HOST=127.0.0.1 DB_USER=rmgadmin DB_PASSWORD=... DB_SSL=false npm test
// Uses tickets without attachments in a non-Evolution category, so no AWS calls are made.

const test = require('node:test');
const assert = require('node:assert/strict');

const enabled = Boolean(process.env.DB_USER);

const event = (routeKey, { sub, email, name, body, pathParameters, query } = {}) => ({
  routeKey,
  headers: { 'user-agent': 'node-test' },
  body: body ? JSON.stringify(body) : undefined,
  pathParameters,
  queryStringParameters: query,
  requestContext: { authorizer: { jwt: { claims: { sub, email, name, email_verified: 'true' } } } },
});

test('helpdesk API end to end', { skip: !enabled && 'set DB_USER to run against a database' }, async (t) => {
  const { query, closePool } = require('../src/lib/db');
  const me = require('../src/handlers/me').handler;
  const reference = require('../src/handlers/reference').handler;
  const tickets = require('../src/handlers/tickets').handler;

  const stamp = Date.now();
  const alice = { sub: `00000000-0000-4000-8000-${String(stamp).slice(-12)}`, email: `alice.${stamp}@rmg.co.uk`, name: 'Alice Test' };
  const bob = { sub: `00000000-0000-4000-9000-${String(stamp).slice(-12)}`, email: `bob.${stamp}@rmg.co.uk`, name: 'Bob Test' };
  const stranger = { sub: `00000000-0000-4000-a000-${String(stamp).slice(-12)}`, email: `eve.${stamp}@gmail.com`, name: 'Eve' };

  try {
    await t.test('first sign-in creates an RMG requester', async () => {
      const res = await me(event('GET /me', alice));
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.user.role, 'requester');
      assert.equal(body.user.organisation.code, 'RMG');
    });

    await t.test('unknown domains are refused', async () => {
      const res = await me(event('GET /me', stranger));
      assert.equal(res.statusCode, 403);
    });

    let ref;
    await t.test('reference data has the agreed lists', async () => {
      const res = await reference(event('GET /reference', alice));
      ref = JSON.parse(res.body);
      assert.equal(ref.categories.length, 49);
      assert.equal(ref.buildings.length, 22);
      assert.equal(ref.priorities.length, 4);
    });

    let ticketId;
    await t.test('raising a Grounds ticket routes it to RMG grounds', async () => {
      const grounds = ref.categories.find((c) => c.label === 'Grounds');
      const building = ref.buildings.find((b) => b.name === 'Queens House');
      const res = await tickets(
        event('POST /tickets', {
          ...alice,
          body: {
            buildingId: building.id,
            categoryId: grounds.id,
            priority: 'P3',
            title: 'Fallen branch on the path',
            description: 'A large branch is blocking the path to the east entrance.',
            locationText: 'Path by the east entrance',
          },
        }),
      );
      assert.equal(res.statusCode, 201, res.body);
      const body = JSON.parse(res.body);
      assert.match(body.reference, /^RMG-\d{6}$/);
      ticketId = body.id;
      const row = (await query('SELECT sl.code FROM tickets t JOIN service_lines sl ON sl.id = t.service_line_id WHERE t.id = ?', [ticketId]))[0];
      assert.equal(row.code, 'RMG_GROUNDS');
    });

    await t.test('validation errors come back field by field', async () => {
      const res = await tickets(event('POST /tickets', { ...alice, body: { priority: 'P1' } }));
      assert.equal(res.statusCode, 400);
      assert.ok(JSON.parse(res.body).details.length >= 4);
    });

    await t.test('the requester sees the ticket and can comment', async () => {
      const list = JSON.parse((await tickets(event('GET /tickets', { ...alice, query: { scope: 'mine' } }))).body);
      assert.ok(list.tickets.some((x) => x.id === ticketId));
      const c = await tickets(event('POST /tickets/{id}/comments', { ...alice, pathParameters: { id: String(ticketId) }, body: { body: 'Still there this morning.' } }));
      assert.equal(c.statusCode, 201);
      const detail = JSON.parse((await tickets(event('GET /tickets/{id}', { ...alice, pathParameters: { id: String(ticketId) } }))).body);
      assert.deepEqual(detail.events.map((e) => e.type), ['created', 'comment']);
    });

    await t.test('requesters cannot add internal notes', async () => {
      const res = await tickets(
        event('POST /tickets/{id}/comments', { ...alice, pathParameters: { id: String(ticketId) }, body: { body: 'secret', isInternal: true } }),
      );
      assert.equal(res.statusCode, 403);
    });

    await t.test('another requester cannot see it', async () => {
      const res = await tickets(event('GET /tickets/{id}', { ...bob, pathParameters: { id: String(ticketId) } }));
      assert.equal(res.statusCode, 404);
    });

    await t.test('a grounds agent sees it in their queue', async () => {
      await me(event('GET /me', bob));
      const bobId = (await query('SELECT id FROM users WHERE email = ?', [bob.email]))[0].id;
      await query("UPDATE users SET role = 'agent' WHERE id = ?", [bobId]);
      await query("INSERT INTO user_scopes (user_id, service_line_id) SELECT ?, id FROM service_lines WHERE code = 'RMG_GROUNDS'", [bobId]);
      const res = await tickets(event('GET /tickets', { ...bob, query: { scope: 'queue', status: 'open' } }));
      const body = JSON.parse(res.body);
      assert.ok(body.tickets.some((x) => x.id === ticketId));
    });
  } finally {
    await closePool();
  }
});

test('new-ticket emails are worked out and recorded (email switched off)', { skip: !enabled && 'set DB_USER to run against a database' }, async () => {
  process.env.EMAIL_MODE = 'off';
  const { query, closePool } = require('../src/lib/db');
  const { ticketCreated } = require('../src/handlers/notifier')._internal;
  try {
    const t = (
      await query(
        `SELECT t.id FROM tickets t JOIN categories c ON c.id = t.category_id WHERE c.label = 'Grounds' ORDER BY t.id DESC LIMIT 1`,
      )
    )[0];
    assert.ok(t, 'needs the Grounds ticket from the end-to-end test');
    await ticketCreated(t.id);
    const notes = await query("SELECT body FROM ticket_events WHERE ticket_id = ? AND type = 'email_sent' ORDER BY id", [t.id]);
    assert.equal(notes.length, 2, 'team email and requester confirmation');
    assert.match(notes[0].body, /mwroblewski@rmg\.co\.uk/);
    assert.match(notes[0].body, /dfhayler@rmg\.co\.uk \(cc\)/);
    assert.match(notes[1].body, /@rmg\.co\.uk/);
  } finally {
    await closePool();
  }
});
