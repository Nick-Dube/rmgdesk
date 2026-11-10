'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTicketSchema, uploadRequestSchema } = require('../src/lib/validation');
const { buildRaiseTaskXml, xmlEscape, extractTaskNumber, buildEndpoint, checkEvolutionResponse } = require('../src/lib/evolution');
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

test('Evolution XML matches the format the RMGRaiseTask workflow has always received', () => {
  const xml = buildRaiseTaskXml(
    {
      id: 42,
      reference: 'RMG-000042',
      requester_name: "Tom O'Neil",
      requester_email: 'a@rmg.co.uk',
      contact_phone: '2505',
      building_legacy_label: 'NMM ~ Neptune Court',
      department_name: 'Learning & Engagement',
      category_name: 'Heating & Gas',
      priority: 'P2',
      title: 'Radiator <cold> & noisy',
      description: 'It is "cold"',
      location_text: 'Room 1 & 2',
      attachment_count: 0,
    },
    'https://app.rmgdesk.com',
  );
  assert.equal(
    xml,
    '<body><reqid>RMG-000042</reqid><name>Tom O&apos;Neil</name><email>a@rmg.co.uk</email><phone>2505</phone>' +
      '<building>NMM ~ Neptune Court</building><department>Learning and Engagement</department>' +
      '<category>Heating and Gas</category><location>Room 1 and 2</location><priority>P2</priority>' +
      '<problem>Radiator &lt;cold&gt; &amp; noisy</problem>' +
      '<description>It is &quot;cold&quot;\r\n\r\nHelpdesk ref RMG-000042: https://app.rmgdesk.com/ticket/?id=42' +
      '&#13;&#10;&#13;&#10;<![CDATA[No value present]]></description><image>No value present</image></body>',
  );
  assert.equal(xmlEscape(`'`), '&apos;');
});

test('Evolution XML carries the ticket link in the image slots when there are photos', () => {
  const xml = buildRaiseTaskXml(
    { id: 7, reference: 'RMG-000007', requester_name: 'A', requester_email: 'a@rmg.co.uk', site_code: 'CS', building_name: 'Cutty Sark',
      category_name: 'Lighting', priority: 'P3', title: 'Lamp out', description: 'x', attachment_count: 2 },
    'https://app.rmgdesk.com',
    { reqIdPrefix: 'VTX600:' },
  );
  assert.match(xml, /^<body><reqid>VTX600:RMG-000007<\/reqid><name>/);
  assert.match(xml, /<building>CS ~ Cutty Sark<\/building>/);
  assert.match(xml, /<!\[CDATA\[https:\/\/app\.rmgdesk\.com\/ticket\/\?id=7\]\]><\/description>/);
  assert.match(xml, /<image>https:\/\/app\.rmgdesk\.com\/ticket\/\?id=7<\/image>/);
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

test('an Evolution login page or redirect is never treated as success', () => {
  assert.equal(checkEvolutionResponse(200, '<Result><TaskNo>1</TaskNo></Result>').ok, true);
  assert.equal(checkEvolutionResponse(200, 'OK').ok, true);
  assert.equal(checkEvolutionResponse(302, '').ok, false);
  assert.equal(checkEvolutionResponse(500, 'error').ok, false);
  const loginPage = ' <!DOCTYPE HTML > <html dir="ltr"> <head><title> Log in to Evolution </title></head></html>';
  const verdict = checkEvolutionResponse(200, loginPage);
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /login or error page/);
});
