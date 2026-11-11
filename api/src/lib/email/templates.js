'use strict';
// RMG Desk email templates. Each returns { subject, html, text }.
// ctx.ticket is the ticket row joined with site, building, category, service line and requester
// (see handlers/notifier.js loadTicket). ctx.photos are the images embedded in the email.

const { esc, escMultiline, priorityBadge, section, rows, paragraph, button, buttonPair, callout, photoGrid, shell } = require('./layout');

const LONDON = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function when(value) {
  return value ? LONDON.format(new Date(value)) : '';
}

function ticketUrl(ctx) {
  return `${ctx.appUrl}/ticket/?id=${ctx.ticket.id}`;
}

function firstName(full) {
  return String(full || '').trim().split(/\s+/)[0] || 'there';
}

function oneLine(value, max = 80) {
  const s = String(value || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function locationRows(t) {
  return rows([
    ['Site:', esc(t.site_name)],
    ['Building:', esc(t.building_name)],
    ['Location:', esc(t.location_text)],
  ]);
}

function descriptionRows(t) {
  return rows([
    ['Problem:', `<strong>${esc(t.title)}</strong>`],
    ['Category:', esc(t.category_label)],
    ['Description:', escMultiline(t.description)],
  ]);
}

function plainDetails(t, extra = []) {
  return [
    `RMG Job Ref: ${t.reference}`,
    `Priority: ${t.priority}`,
    ...extra,
    '',
    `Site: ${t.site_name}`,
    `Building: ${t.building_name}`,
    t.location_text ? `Location: ${t.location_text}` : null,
    '',
    `Problem: ${t.title}`,
    `Category: ${t.category_label}`,
    `Description:\n${t.description}`,
  ].filter((l) => l !== null);
}

/** To the team that owns the category (the routing rule's recipients). */
function serviceLineNewTicket(ctx) {
  const t = ctx.ticket;
  const url = ticketUrl(ctx);
  const others = ctx.otherFileCount || 0;
  const kind = ctx.kind || 'New request';
  const subject = `[${t.reference}] ${t.priority} ${kind}: ${oneLine(t.title, 70)} - ${t.site_code} ${t.building_name}`;

  const photosBlock = ctx.photos.length
    ? photoGrid(ctx.photos) +
      (others ? paragraph(`Plus ${others} more file${others === 1 ? '' : 's'} (video or document), available on RMG Desk.`, { top: 8 }) : '')
    : paragraph(others ? `${others} file${others === 1 ? ' was' : 's were'} attached (video or document), available on RMG Desk.` : 'No photos were attached.');

  const body = [
    paragraph('Hello,', { top: 28, size: 16, colour: '#22272e' }),
    paragraph(
      ctx.intro ||
        `A new request has been raised on RMG Desk for <strong>${esc(t.service_line_name || 'the helpdesk')}</strong>. Please see the details below.`,
    ),
    ctx.note ? callout(`<strong>${esc(ctx.noteLabel || 'Note')}:</strong><br>${escMultiline(ctx.note)}`, '#b54708', '#fffaeb') : '',
    t.priority === 'P1'
      ? paragraph(
          '<strong style="color:#b42318;">Priority 1:</strong> immediate health and safety or security risk. Please respond straight away.',
        )
      : '',
    section('&#128203;', 'Request'),
    rows([
      ['RMG Job Ref:', `<strong style="color:#0b2545;">${esc(t.reference)}</strong>`],
      ['Priority:', priorityBadge(t.priority)],
      ['Raised:', esc(when(t.created_at))],
    ]),
    section('&#128205;', 'Work Location'),
    locationRows(t),
    section('&#128736;', 'Work Description'),
    descriptionRows(t),
    section('&#128100;', 'Requestor'),
    rows([
      ['Requested By:', esc(t.requester_name)],
      ['Email:', t.requester_email ? `<a href="mailto:${esc(t.requester_email)}" style="color:#0a58ca;">${esc(t.requester_email)}</a>` : ''],
      ['Phone:', esc(t.contact_phone)],
      ['Department:', esc(t.department_name)],
    ]),
    section('&#128247;', 'Photos'),
    photosBlock,
    button(url, 'Open in RMG Desk'),
    paragraph('No RMG Desk login? Reply to this email to contact the requester directly.', { top: 10, size: 13, colour: '#7a828e' }),
  ].join('');

  const html = shell({
    title: subject,
    subtitle: ctx.subtitle || 'New Task Request',
    preheader: `${t.priority} at ${t.site_code} ${t.building_name}: ${oneLine(t.title)}`,
    banner: ctx.banner || '',
    body,
    footer: 'Sent automatically by RMG Desk for Royal Museums Greenwich. Replies go to the requester.',
  });

  const text = [
    `${kind} on RMG Desk for ${t.service_line_name || 'the helpdesk'}`,
    '',
    ...(ctx.note ? [`${ctx.noteLabel || 'Note'}: ${ctx.note}`, ''] : []),
    ...plainDetails(t, [`Raised: ${when(t.created_at)}`]),
    '',
    `Requested by: ${t.requester_name} <${t.requester_email}>`,
    t.contact_phone ? `Phone: ${t.contact_phone}` : null,
    t.department_name ? `Department: ${t.department_name}` : null,
    '',
    ctx.photos.length || others ? `Attachments: ${ctx.photos.length + others}` : 'No photos were attached.',
    '',
    `Open in RMG Desk: ${url}`,
  ]
    .filter((l) => l !== null)
    .join('\n');

  return { subject, html, text };
}

/** To the person who raised it. Not sent for MRI Evolution categories: Evolution sends its own confirmation. */
function requesterConfirmation(ctx) {
  const t = ctx.ticket;
  const url = ticketUrl(ctx);
  const subject = `${t.reference}: your request has been logged - ${oneLine(t.title, 70)}`;
  const attached = (ctx.photos.length || 0) + (ctx.otherFileCount || 0);

  const body = [
    paragraph(`Hi <strong>${esc(firstName(t.requester_name))}</strong>,`, { top: 28, size: 16, colour: '#22272e' }),
    paragraph(
      `Thank you. Your request has been logged and sent to <strong>${esc(t.service_line_name || 'the helpdesk team')}</strong>. You can follow its progress on RMG Desk.`,
    ),
    section('&#128203;', 'Your Request'),
    rows([
      ['RMG Job Ref:', `<strong style="color:#0b2545;">${esc(t.reference)}</strong>`],
      ['Priority:', priorityBadge(t.priority)],
      ['Raised:', esc(when(t.created_at))],
      ['Sent to:', esc(t.service_line_name)],
      ['Attachments:', attached ? `${attached} file${attached === 1 ? '' : 's'}` : ''],
    ]),
    section('&#128205;', 'Work Location'),
    locationRows(t),
    section('&#128736;', 'Work Description'),
    descriptionRows(t),
    button(url, 'View your request'),
    paragraph('<strong>In an emergency,</strong> or if anyone is at risk, call Security Control on <strong>6555</strong>.', { top: 22 }),
    paragraph('Kind regards,<br><strong>RMG Helpdesk</strong>', { top: 22, colour: '#22272e' }),
  ].join('');

  const html = shell({
    title: subject,
    subtitle: 'Your request has been logged',
    preheader: `${t.reference} sent to ${t.service_line_name || 'the helpdesk'}: ${oneLine(t.title)}`,
    banner: ctx.banner || '',
    body,
    footer: 'This is an automatic email from RMG Desk. Please do not reply.',
  });

  const text = [
    `Hi ${firstName(t.requester_name)},`,
    '',
    `Your request has been logged and sent to ${t.service_line_name || 'the helpdesk team'}.`,
    '',
    ...plainDetails(t, [`Raised: ${when(t.created_at)}`]),
    '',
    `View your request: ${url}`,
    '',
    'In an emergency, or if anyone is at risk, call Security Control on 6555.',
    '',
    'RMG Helpdesk',
  ].join('\n');

  return { subject, html, text };
}

const ROOT_CAUSE_WORDS = {
  wear_and_tear: 'Wear and tear',
  user_damage: 'Accidental damage',
  design_fault: 'Design fault',
  installation_fault: 'Installation fault',
  supplier_fault: 'Supplier fault',
  weather: 'Weather',
  vandalism: 'Vandalism',
  unknown: 'Not known',
};

/**
 * To the requester when their request changes in a way they need to know about.
 * ctx.status: 'resolved' (asks "is it fixed?"), 'on_hold' or 'cancelled'. ctx.note: what the team wrote.
 */
function requesterStatusUpdate(ctx) {
  const t = ctx.ticket;
  const url = ticketUrl(ctx);
  const hi = paragraph(`Hi <strong>${esc(firstName(t.requester_name))}</strong>,`, { top: 28, size: 16, colour: '#22272e' });
  const summary = [
    section('&#128203;', 'Your Request'),
    rows([
      ['RMG Job Ref:', `<strong style="color:#0b2545;">${esc(t.reference)}</strong>`],
      ['Problem:', `<strong>${esc(t.title)}</strong>`],
      ['Where:', esc([t.site_name, t.building_name, t.location_text].filter(Boolean).join(', '))],
      ['Raised:', esc(when(t.created_at))],
    ]),
  ];
  const signOff = paragraph('Kind regards,<br><strong>RMG Helpdesk</strong>', { top: 22, colour: '#22272e' });
  let subject;
  let subtitle;
  let body;
  let text;

  if (ctx.status === 'resolved') {
    const yes = `${url}&confirm=yes`;
    const no = `${url}&confirm=no`;
    subject = `${t.reference}: completed - is it fixed? ${oneLine(t.title, 60)}`;
    subtitle = 'Your request has been completed';
    body = [
      hi,
      paragraph(`<strong>${esc(t.service_line_name || 'The helpdesk team')}</strong> have marked your request as complete.`),
      callout(`<strong>What was done</strong><br>${escMultiline(ctx.note)}`, '#067647', '#ecfdf3'),
      ...summary,
      paragraph('<strong>Is it fixed?</strong> Please let us know. If it is not, the request goes straight back to the team.', { top: 24 }),
      buttonPair({ href: yes, label: 'Yes, it is fixed' }, { href: no, label: 'No, still a problem' }),
      paragraph('If we do not hear from you, the request will close automatically after 3 working days.', { top: 8, size: 13, colour: '#7a828e' }),
      signOff,
    ];
    text = [
      `Hi ${firstName(t.requester_name)},`,
      '',
      `${t.service_line_name || 'The helpdesk team'} have marked your request ${t.reference} as complete.`,
      '',
      `What was done: ${ctx.note}`,
      '',
      `Problem: ${t.title}`,
      `Where: ${[t.site_name, t.building_name, t.location_text].filter(Boolean).join(', ')}`,
      '',
      `Yes, it is fixed: ${yes}`,
      `No, still a problem: ${no}`,
      '',
      'If we do not hear from you, the request will close automatically after 3 working days.',
      '',
      'RMG Helpdesk',
    ];
  } else if (ctx.status === 'on_hold') {
    subject = `${t.reference}: on hold - ${oneLine(t.title, 70)}`;
    subtitle = 'Your request is on hold';
    body = [
      hi,
      paragraph('Your request is on hold for the moment. We will let you know when work starts again.'),
      callout(`<strong>Reason:</strong> ${escMultiline(ctx.note)}`, '#b54708', '#fffaeb'),
      ...summary,
      button(url, 'View your request'),
      signOff,
    ];
    text = [`Hi ${firstName(t.requester_name)},`, '', `Your request ${t.reference} is on hold.`, `Reason: ${ctx.note}`, '', `Problem: ${t.title}`, '', `View your request: ${url}`, '', 'RMG Helpdesk'];
  } else if (ctx.status === 'cancelled') {
    subject = `${t.reference}: cancelled - ${oneLine(t.title, 70)}`;
    subtitle = 'Your request has been cancelled';
    body = [
      hi,
      paragraph('Your request has been cancelled by the helpdesk team.'),
      callout(`<strong>Reason:</strong> ${escMultiline(ctx.note)}`, '#475467', '#f2f4f7'),
      ...summary,
      paragraph('If the problem is still there, reply on RMG Desk or raise a new request.', { top: 18 }),
      button(url, 'View your request'),
      signOff,
    ];
    text = [`Hi ${firstName(t.requester_name)},`, '', `Your request ${t.reference} has been cancelled.`, `Reason: ${ctx.note}`, '', `Problem: ${t.title}`, '', `View your request: ${url}`, '', 'RMG Helpdesk'];
  } else {
    throw new Error(`No requester email for status ${ctx.status}`);
  }

  const html = shell({
    title: subject,
    subtitle,
    preheader: `${t.reference}: ${oneLine(ctx.note || t.title)}`,
    banner: ctx.banner || '',
    body: body.join(''),
    footer: 'This is an automatic email from RMG Desk. Please do not reply; use the buttons or RMG Desk instead.',
  });
  return { subject, html, text: text.join('\n') };
}

/** To someone who has just been assigned a request. */
function assigneeNotice(ctx) {
  const t = ctx.ticket;
  const url = ticketUrl(ctx);
  const subject = `[${t.reference}] ${t.priority} Assigned to you: ${oneLine(t.title, 70)} - ${t.site_code} ${t.building_name}`;
  const body = [
    paragraph(`Hi <strong>${esc(firstName(ctx.assignee.full_name))}</strong>,`, { top: 28, size: 16, colour: '#22272e' }),
    paragraph(`${esc(ctx.assignedBy || 'The helpdesk')} has assigned this request to you.`),
    section('&#128203;', 'Request'),
    rows([
      ['RMG Job Ref:', `<strong style="color:#0b2545;">${esc(t.reference)}</strong>`],
      ['Priority:', priorityBadge(t.priority)],
      ['Raised:', esc(when(t.created_at))],
      ['Requested By:', esc(t.requester_name)],
      ['Phone:', esc(t.contact_phone)],
    ]),
    section('&#128205;', 'Work Location'),
    locationRows(t),
    section('&#128736;', 'Work Description'),
    descriptionRows(t),
    button(url, 'Open in RMG Desk'),
  ].join('');
  const html = shell({
    title: subject,
    subtitle: 'Assigned to you',
    preheader: `${t.priority} at ${t.site_code} ${t.building_name}: ${oneLine(t.title)}`,
    banner: ctx.banner || '',
    body,
    footer: 'Sent automatically by RMG Desk for Royal Museums Greenwich.',
  });
  const text = [`${ctx.assignedBy || 'The helpdesk'} has assigned this request to you.`, '', ...plainDetails(t), '', `Open in RMG Desk: ${url}`].join('\n');
  return { subject, html, text };
}

module.exports = { esc, serviceLineNewTicket, requesterConfirmation, requesterStatusUpdate, assigneeNotice, ROOT_CAUSE_WORDS, when };
