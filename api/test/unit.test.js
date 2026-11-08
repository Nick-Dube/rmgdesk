'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTicketSchema, uploadRequestSchema } = require('../src/lib/validation');
const { buildRaiseTaskXml, xmlEscape, extractTaskNumber, buildEndpoint } = require('../src/lib/evolution');
const { isAllowedEmail, handler: preSignUp } = require('../src/handlers/preSignUp');

test('ticket validation accepts a complete request and trims text', () => {
  const t = createTicketSchema.parse({
    buildingId: '7',
    categoryId: 3,
    priority: 'P2',
    title: '  Water dripping from ceiling  ',
    description: 'Above the Great Map, near the stairs.',
    locationText: 'Neptune Court, ground floor',
  });
  assert.equal(t.buildingId, 7);
  assert.equal(t.title, 'Water dripping from ceiling');
  assert.deepEqual(t.attachments, []);
  assert.equal(t.departmentName, null);
});

test('ticket validation rejects a short summary and an unknown priority', () => {
  const r = createTicketSchema.safeParse({ buildingId: 1, categoryId: 1, priority: 'P9', title: 'Leak', description: 'x', locationText: 'Here' });
  assert.equal(r.success, false);
  const fields = r.error.issues.map((i) => i.path[0]);
  assert.ok(fields.includes('priority'));
  assert.ok(fields.includes('title'));
});

test('uploads allow photos and short videos only', () => {
  assert.ok(uploadRequestSchema.safeParse({ fileName: 'a.jpg', contentType: 'image/jpeg', size: 1000 }).success);
  assert.equal(uploadRequestSchema.safeParse({ fileName: 'a.exe', contentType: 'application/x-msdownload', size: 1000 }).success, false);
  assert.equal(uploadRequestSchema.safeParse({ fileName: 'big.mp4', contentType: 'video/mp4', size: 60 * 1024 * 1024 }).success, false);
});

test('Evolution XML escapes user text and keeps the legacy building label', () => {
  const xml = buildRaiseTaskXml(
    {
      id: 42,
      reference: 'RMG-000042',
      requester_name: 'Ann <script>',
      requester_email: 'a@rmg.co.uk',
      building_legacy_label: 'NMM ~ Park Row Wing',
      category_name: 'Heating & Gas',
      priority: 'P2',
      title: 'Radiator cold',
      description: 'It\'s "cold" & noisy',
      location_text: 'Room 1',
    },
    'https://app.rmgdesk.com',
  );
  assert.match(xml, /<Building>NMM ~ Park Row Wing<\/Building>/);
  assert.match(xml, /<Category>Heating &amp; Gas<\/Category>/);
  assert.match(xml, /<Name>Ann &lt;script&gt;<\/Name>/);
  assert.match(xml, /<ImageUrl>https:\/\/app.rmgdesk.com\/ticket\/\?id=42<\/ImageUrl>/);
  assert.equal(xmlEscape(`'`), '&apos;');
});

test('Evolution endpoint carries the workflow name and credentials server-side', () => {
  const u = new URL(buildEndpoint({ url: 'https://example.com/workflowrest.aspx', workflow: 'RMGRaiseTask', username: 'svc', password: 'p&ss' }));
  assert.equal(u.searchParams.get('name'), 'RMGRaiseTask');
  assert.equal(u.searchParams.get('password'), 'p&ss');
  assert.equal(extractTaskNumber('<Result><TaskNo>VTX600-123</TaskNo></Result>'), 'VTX600-123');
  assert.equal(extractTaskNumber('OK'), null);
});

test('self sign-up is limited to allowed domains', async () => {
  process.env.SELF_SIGNUP_DOMAINS = 'rmg.co.uk,vertex.net';
  assert.ok(isAllowedEmail('Someone@RMG.co.uk'));
  assert.equal(isAllowedEmail('someone@ocs.com'), false);
  await assert.rejects(preSignUp({ triggerSource: 'PreSignUp_SignUp', request: { userAttributes: { email: 'x@gmail.com' } } }));
  const invited = { triggerSource: 'PreSignUp_AdminCreateUser', request: { userAttributes: { email: 'x@ocs.com' } } };
  assert.equal(await preSignUp(invited), invited);
});
