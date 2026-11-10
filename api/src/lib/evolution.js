'use strict';
// Building the request for the MRI Evolution "RMGRaiseTask" workflow.
//
// The format is exactly what the Integrately step has sent since 2021, which is what the workflow's
// XML nodes read: a <body> root, lower-case element names, no XML declaration, and the link placed
// twice (inside the description as CDATA, and in <image>), plus <reqid>, which the workflow copies
// into the task's Req ID (aEvolutionService.CallId) with SelectSingleNode("/body/reqid").
// The workflow reads every element with SelectSingleNode(...).InnerText, which fails if an element
// is missing, so never drop one. Do not rename elements without changing the workflow first.
// Content-Type must be text/xml.

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Integrately replaced "&" with "and" in these fields ("Heating & Gas" reaches Evolution as "Heating and Gas"). */
function andEscape(value) {
  return xmlEscape(String(value ?? '').replace(/&/g, 'and'));
}

/** CDATA cannot contain "]]>": split it if it ever appears. */
function cdata(value) {
  return `<![CDATA[${String(value ?? '').replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

const NO_IMAGE = 'No value present'; // what Integrately sent when the requester attached no photo

/**
 * t: the ticket row joined with site, building, category and requester (see evolutionWorker.loadTicket).
 * The helpdesk reference and a link back to the ticket go at the end of the description, so engineers
 * see them on the task. The image slots carry the ticket link when the ticket has photos (the photos
 * themselves are private and need a sign-in), and "No value present" when it has none, as before.
 */
function buildRaiseTaskXml(t, appUrl, options = {}) {
  // Req ID = optional prefix + helpdesk reference, e.g. "VTX600:RMG-000123". The prefix comes from the
  // "reqIdPrefix" value in the Evolution secret: other Evolution workflows send their emails only for
  // Req IDs starting with VTX600, so keep the prefix while those emails are wanted and blank it after.
  const reqId = `${options.reqIdPrefix || ''}${t.reference}`;
  const ticketUrl = `${appUrl}/ticket/?id=${t.id}`;
  const image = Number(t.attachment_count) > 0 ? ticketUrl : NO_IMAGE;
  const description = `${t.description}\r\n\r\nHelpdesk ref ${t.reference}: ${ticketUrl}`;
  return (
    '<body>' +
    `<reqid>${xmlEscape(reqId)}</reqid>` +
    `<name>${xmlEscape(t.requester_name)}</name>` +
    `<email>${xmlEscape(t.requester_email)}</email>` +
    `<phone>${xmlEscape(t.contact_phone || '')}</phone>` +
    `<building>${xmlEscape(t.building_legacy_label || `${t.site_code} ~ ${t.building_name}`)}</building>` +
    `<department>${andEscape(t.department_name || '')}</department>` +
    `<category>${andEscape(t.category_name)}</category>` +
    `<location>${andEscape(t.location_text || '')}</location>` +
    `<priority>${xmlEscape(t.priority)}</priority>` +
    `<problem>${xmlEscape(t.title)}</problem>` +
    `<description>${xmlEscape(description)}&#13;&#10;&#13;&#10;${cdata(image)}</description>` +
    `<image>${xmlEscape(image)}</image>` +
    '</body>'
  );
}

/** The workflow REST endpoint takes the workflow name and web service credentials as query parameters. */
function buildEndpoint(secret) {
  const url = new URL(secret.url);
  url.searchParams.set('name', secret.workflow || 'RMGRaiseTask');
  url.searchParams.set('username', secret.username);
  url.searchParams.set('password', secret.password);
  return url.toString();
}

/** Best effort: pull a task number out of the workflow's response, if it returns one. */
function extractTaskNumber(responseText) {
  const m = /<(?:TaskNo|TaskNumber|TaskID|TaskId)>\s*([^<\s]+)\s*</i.exec(responseText || '');
  return m ? m[1] : null;
}

/**
 * Decide whether Evolution really accepted the request.
 * When the workflow endpoint rejects or fails a request it does not return an error code: it redirects
 * to its error page, which then shows the "Log in to Evolution" page with HTTP 200. So a redirect, or
 * any HTML page, is a failure, never a success.
 */
function checkEvolutionResponse(status, text) {
  const body = String(text || '');
  if (status >= 300 && status < 400) {
    return { ok: false, reason: `MRI Evolution redirected the request (HTTP ${status}) instead of running the workflow` };
  }
  if (status < 200 || status >= 300) {
    return { ok: false, reason: `MRI Evolution returned HTTP ${status}` };
  }
  if (/^\s*<!DOCTYPE\s+html|^\s*<html[\s>]|Log in to Evolution/i.test(body.slice(0, 5000))) {
    return { ok: false, reason: 'MRI Evolution returned its login or error page instead of a workflow result' };
  }
  return { ok: true };
}

module.exports = { xmlEscape, andEscape, buildRaiseTaskXml, buildEndpoint, extractTaskNumber, checkEvolutionResponse };
