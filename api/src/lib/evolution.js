'use strict';
// Building the request for the MRI Evolution "RMGRaiseTask" workflow.
//
// The format is what the workflow's nodes read with SelectSingleNode("/body/<element>").InnerText:
// a <body> root and lower-case element names, the same as the Integrately step has sent since 2021,
// plus <reqid>, which the workflow copies into the task's Req ID (aEvolutionService.CallId).
// A missing element makes the workflow fail, so never drop one, and do not rename elements without
// changing the workflow first. Content-Type must be text/xml.
//
// <image> goes into the task's TaskItem field, which Evolution's emails use as the "view your request"
// link, so it always carries the link to the ticket (photos are private and need a sign-in).

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

/** t: the ticket row joined with site, building, category and requester (see evolutionWorker.loadTicket). */
function buildRaiseTaskXml(t, appUrl, options = {}) {
  // Req ID = optional prefix + helpdesk reference, e.g. "RMG-000123". Evolution's email workflows act on
  // Req IDs starting with "RMG-". The optional "reqIdPrefix" in the Evolution secret is normally blank.
  const reqId = `${options.reqIdPrefix || ''}${t.reference}`;
  const ticketUrl = `${appUrl}/ticket/?id=${t.id}`;
  // The description is sent as written: the workflow itself appends the <image> link and the location
  // to the task's long description, and the Req ID carries the RMG reference.
  const description = t.description;
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
    `<description>${xmlEscape(description)}</description>` +
    `<image>${xmlEscape(ticketUrl)}</image>` +
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
