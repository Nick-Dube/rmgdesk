'use strict';
// Building blocks for RMG Desk emails. Same look as the MRI Evolution templates in docs/evolution-emails:
// tables and inline styles only (no <style> block), so classic Outlook, new Outlook, Outlook on the web,
// Gmail and Apple Mail all render it the same way.

const FONT = "font-family:'Segoe UI',Calibri,Arial,Helvetica,sans-serif;";
const NAVY = '#0a3a78';

/** Escape text for HTML. Every value that comes from a ticket or a user must go through this. */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape, and keep the requester's line breaks. */
function escMultiline(value) {
  return esc(value).replace(/\r?\n/g, '<br>');
}

const PRIORITY_COLOUR = { P1: '#b42318', P2: '#b54708', P3: '#175cd3', P4: '#475467' };

function priorityBadge(priority) {
  const colour = PRIORITY_COLOUR[priority] || '#475467';
  return `<span style="${FONT}font-size:14px;font-weight:bold;color:#ffffff;background-color:${colour};padding:2px 8px;">${esc(priority)}</span>`;
}

function section(icon, title) {
  return `
      <tr>
        <td style="padding:26px 32px 0 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="${FONT}font-size:18px;line-height:24px;font-weight:bold;color:#0b2545;padding:0 0 8px 0;border-bottom:2px solid #e6eaf0;">${icon}&nbsp; ${esc(title)}</td>
            </tr>
          </table>
        </td>
      </tr>`;
}

/** rows: [label, htmlValue] pairs. Values must already be escaped (use esc / escMultiline). Empty values are skipped. */
function rows(pairs) {
  const body = pairs
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(
      ([label, value]) => `
            <tr>
              <td width="150" valign="top" style="width:150px;${FONT}font-size:15px;line-height:22px;font-weight:bold;color:#3a4250;padding:5px 12px 5px 0;">${esc(label)}</td>
              <td valign="top" style="${FONT}font-size:15px;line-height:22px;color:#3a4250;padding:5px 0;">${value}</td>
            </tr>`,
    )
    .join('');
  return `
      <tr>
        <td style="padding:12px 32px 0 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${body}
          </table>
        </td>
      </tr>`;
}

function paragraph(html, { top = 14, size = 15, colour = '#3a4250' } = {}) {
  return `
      <tr>
        <td style="padding:${top}px 32px 0 32px;${FONT}font-size:${size}px;line-height:23px;color:${colour};">${html}</td>
      </tr>`;
}

/** A button that works in classic Outlook too (VML), with a normal link everywhere else. */
function button(href, label) {
  const url = esc(href);
  return `
      <tr>
        <td style="padding:24px 32px 0 32px;">
          <!--[if mso]>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:44px;v-text-anchor:middle;width:240px;" arcsize="10%" stroke="f" fillcolor="${NAVY}">
            <w:anchorlock/><center style="color:#ffffff;font-family:Segoe UI,Arial,sans-serif;font-size:15px;font-weight:bold;">${esc(label)}</center>
          </v:roundrect>
          <![endif]-->
          <!--[if !mso]><!-- -->
          <a href="${url}" style="display:inline-block;background-color:${NAVY};color:#ffffff;${FONT}font-size:15px;font-weight:bold;line-height:44px;text-align:center;text-decoration:none;width:240px;border-radius:4px;">${esc(label)}</a>
          <!--<![endif]-->
        </td>
      </tr>`;
}

/** Two buttons side by side (stack on narrow phones): the main choice in navy, the other outlined. */
function buttonPair(primary, secondary) {
  const cell = (b, solid) => {
    const url = esc(b.href);
    const bg = solid ? NAVY : '#ffffff';
    const fg = solid ? '#ffffff' : NAVY;
    return `<td valign="top" style="padding:0 12px 10px 0;">
          <!--[if mso]>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:44px;v-text-anchor:middle;width:230px;" arcsize="10%" strokecolor="${NAVY}" fillcolor="${bg}">
            <w:anchorlock/><center style="color:${fg};font-family:Segoe UI,Arial,sans-serif;font-size:15px;font-weight:bold;">${esc(b.label)}</center>
          </v:roundrect>
          <![endif]-->
          <!--[if !mso]><!-- -->
          <a href="${url}" style="display:inline-block;background-color:${bg};color:${fg};border:2px solid ${NAVY};${FONT}font-size:15px;font-weight:bold;line-height:40px;text-align:center;text-decoration:none;width:226px;border-radius:4px;">${esc(b.label)}</a>
          <!--<![endif]-->
        </td>`;
  };
  return `
      <tr>
        <td style="padding:24px 20px 0 32px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="left"><tr>${cell(primary, true)}</tr></table>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="left"><tr>${cell(secondary, false)}</tr></table>
        </td>
      </tr>`;
}

/** A highlighted box with a coloured bar on the left (no emoji: some mail systems turn them into "??"). */
function callout(html, colour = NAVY, background = '#f2f6fb') {
  return `
      <tr>
        <td style="padding:18px 32px 0 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td bgcolor="${background}" style="background-color:${background};border-left:5px solid ${colour};padding:14px 18px;${FONT}font-size:15px;line-height:23px;color:#22272e;">${html}</td>
            </tr>
          </table>
        </td>
      </tr>`;
}

/** Photo thumbnails, embedded in the email (cid: links), two per row. */
function photoGrid(photos) {
  if (!photos.length) return '';
  const cells = photos.map(
    (p) => `<td width="50%" valign="top" style="width:50%;padding:6px;"><img src="cid:${esc(p.cid)}" width="248" alt="${esc(p.fileName)}" style="display:block;width:100%;max-width:248px;height:auto;border:1px solid #dfe3e8;"></td>`,
  );
  const trs = [];
  for (let i = 0; i < cells.length; i += 2) {
    trs.push(`<tr>${cells[i]}${cells[i + 1] || '<td width="50%" style="width:50%;padding:6px;">&nbsp;</td>'}</tr>`);
  }
  return `
      <tr>
        <td style="padding:8px 26px 0 26px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${trs.join('')}</table>
        </td>
      </tr>`;
}

/** The whole email: navy header, body rows, grey footer. */
function shell({ title, subtitle, preheader = '', banner = '', body, footer }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${esc(title)}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings xmlns:o="urn:schemas-microsoft-com:office:office"><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f4f6f8;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f6f8" style="background-color:#f4f6f8;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #dfe3e8;">${banner}
      <tr>
        <td align="center" bgcolor="${NAVY}" style="background-color:${NAVY};padding:22px 24px 24px 24px;">
          <div style="${FONT}font-size:26px;line-height:32px;font-weight:bold;color:#ffffff;">RMG Desk</div>
          <div style="${FONT}font-size:15px;line-height:22px;color:#c9d6ea;padding-top:4px;">${esc(subtitle)}</div>
        </td>
      </tr>${body}
      <tr>
        <td style="padding:28px 0 0 0;font-size:0;line-height:0;">&nbsp;</td>
      </tr>
      <tr>
        <td align="center" bgcolor="#f7f8fa" style="background-color:#f7f8fa;border-top:1px solid #dfe3e8;padding:16px 24px;${FONT}font-size:13px;line-height:19px;color:#7a828e;">${footer}</td>
      </tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td>
  </tr>
</table>
</body>
</html>
`;
}

/** Shown at the top while emails are redirected for testing, listing who would really have received it. */
function redirectBanner(intended) {
  const list = esc([...(intended.to || []), ...(intended.cc || []).map((a) => `${a} (cc)`)].join(', ') || 'nobody');
  return `
      <tr>
        <td bgcolor="#fef0c7" style="background-color:#fef0c7;padding:12px 24px;${FONT}font-size:13px;line-height:19px;color:#7a2e0e;">
          <strong>TEST MODE.</strong> This email was redirected to you. In live mode it would go to: ${list}
        </td>
      </tr>`;
}

module.exports = { FONT, NAVY, esc, escMultiline, priorityBadge, section, rows, paragraph, button, buttonPair, callout, photoGrid, shell, redirectBanner };
