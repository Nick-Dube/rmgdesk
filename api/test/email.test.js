'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const templates = require('../src/lib/email/templates');
const { resolveRecipients, buildRaw, cleanList } = require('../src/lib/email/send');

const ticket = {
  id: 124,
  reference: 'RMG-000124',
  title: 'No lights in <C5> Spur',
  description: 'All of the lighting in Spur C5 is off.\nPlease check & fix.',
  priority: 'P2',
  site_code: 'KB',
  site_name: 'Kidbrooke',
  building_name: 'Kidbrooke (Spurs)',
  location_text: 'C5 Spur',
  category_label: 'Lighting',
  service_line_name: 'OCS building fabric and plumbing',
  department_name: 'Collections Services',
  contact_phone: '02083128601',
  requester_name: 'Debbie Williams',
  requester_email: 'dwilliams@rmg.co.uk',
  created_at: '2026-11-10T23:12:00Z',
};
const ctx = { ticket, appUrl: 'https://app.rmgdesk.com', photos: [], otherFileCount: 0, banner: '' };

test('team email: subject, escaping, link and no raw user HTML', () => {
  const e = templates.serviceLineNewTicket(ctx);
  assert.equal(e.subject, '[RMG-000124] P2 New request: No lights in <C5> Spur - KB Kidbrooke (Spurs)');
  assert.ok(e.html.includes('No lights in &lt;C5&gt; Spur'));
  assert.ok(!e.html.includes('<C5>'));
  assert.ok(e.html.includes('Please check &amp; fix.'));
  assert.ok(e.html.includes('Spur C5 is off.<br>Please'));
  assert.ok(e.html.includes('https://app.rmgdesk.com/ticket/?id=124'));
  assert.ok(e.html.includes('mailto:dwilliams@rmg.co.uk'));
  assert.ok(e.html.includes('No photos were attached.'));
  assert.ok(e.html.includes('10 Nov 2026, 23:12'));
  assert.ok(!/<style/i.test(e.html), 'no style block: Outlook needs inline styles');
  assert.ok(e.text.includes('Open in RMG Desk: https://app.rmgdesk.com/ticket/?id=124'));
});

test('team email embeds photos by cid and counts other files', () => {
  const e = templates.serviceLineNewTicket({ ...ctx, photos: [{ cid: 'photo1@rmgdesk', fileName: 'leak.jpg' }], otherFileCount: 1 });
  assert.ok(e.html.includes('src="cid:photo1@rmgdesk"'));
  assert.ok(e.html.includes('Plus 1 more file (video or document)'));
});

test('P1 team email carries the urgency line', () => {
  const e = templates.serviceLineNewTicket({ ...ctx, ticket: { ...ticket, priority: 'P1' } });
  assert.ok(e.html.includes('Please respond straight away.'));
});

test('requester confirmation greets by first name and says where it went', () => {
  const e = templates.requesterConfirmation(ctx);
  assert.equal(e.subject, 'RMG-000124: your request has been logged - No lights in <C5> Spur');
  assert.ok(e.html.includes('Hi <strong>Debbie</strong>'));
  assert.ok(e.html.includes('sent to <strong>OCS building fabric and plumbing</strong>'));
  assert.ok(e.html.includes('Security Control on <strong>6555</strong>'));
});

test('recipients: live, redirect and off modes', () => {
  process.env.EMAIL_REDIRECT_TO = 'nick.dube@vertex.net';
  process.env.EMAIL_MODE = 'live';
  let r = resolveRecipients({ to: ['A@ocs.com', 'a@ocs.com', 'not-an-email'], cc: ['b@rmg.co.uk', 'a@ocs.com'] });
  assert.deepEqual(r.to, ['a@ocs.com']);
  assert.deepEqual(r.cc, ['b@rmg.co.uk']);
  assert.equal(r.redirected, false);

  process.env.EMAIL_MODE = 'redirect';
  r = resolveRecipients({ to: ['a@ocs.com'], cc: ['b@rmg.co.uk'] });
  assert.deepEqual(r.to, ['nick.dube@vertex.net']);
  assert.deepEqual(r.cc, []);
  assert.ok(r.banner.includes('a@ocs.com, b@rmg.co.uk (cc)'));

  process.env.EMAIL_MODE = 'off';
  r = resolveRecipients({ to: ['a@ocs.com'] });
  assert.deepEqual(r.to, []);
  assert.deepEqual(cleanList([' X@Y.com ']), ['x@y.com']);
});

test('raw message has HTML, text, reply-to and an inline photo', async () => {
  const raw = (
    await buildRaw({
      from: 'RMG Helpdesk <no-reply@rmgdesk.com>',
      to: ['a@ocs.com'],
      cc: [],
      replyTo: 'dwilliams@rmg.co.uk',
      subject: 'Test',
      html: '<p>hi <img src="cid:photo1@rmgdesk"></p>',
      text: 'hi',
      attachments: [{ cid: 'photo1@rmgdesk', fileName: 'leak.jpg', contentType: 'image/jpeg', content: Buffer.from('jpg') }],
    })
  ).toString();
  assert.match(raw, /Reply-To: dwilliams@rmg\.co\.uk/);
  assert.match(raw, /Content-Type: text\/plain/);
  assert.match(raw, /Content-Type: text\/html/);
  assert.match(raw, /Content-Id: <photo1@rmgdesk>/i);
  assert.match(raw, /Content-Disposition: inline/);
});
