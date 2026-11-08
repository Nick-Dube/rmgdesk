'use strict';
// Building the request for the MRI Evolution "RMGRaiseTask" workflow.
//
// IMPORTANT: the element names below mirror the fields the Integrately step sends today
// (Name, Email, Phone, Building, Department, Category, Location, Priority, Problem, Description,
// ImageUrl). Open the RMGRaiseTask workflow's "Get XML Values" node and make each tag here match
// exactly what it reads before enabling the link. The Req ID is new: map it to the task's
// requester reference so the completion workflows can call back with it.

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** The old form sent values like "NMM ~ Park Row Wing" and "Security Alarms": keep that shape. */
function buildRaiseTaskXml(t, appUrl) {
  const fields = {
    ReqID: t.reference,
    Name: t.requester_name,
    Email: t.requester_email,
    Phone: t.contact_phone || '',
    Building: t.building_legacy_label || `${t.site_code} ~ ${t.building_name}`,
    Department: t.department_name || '',
    Category: t.category_name,
    Location: t.location_text || '',
    Priority: t.priority,
    Problem: t.title,
    Description: t.description,
    ImageUrl: `${appUrl}/ticket/?id=${t.id}`,
  };
  const body = Object.entries(fields)
    .map(([k, v]) => `  <${k}>${xmlEscape(v)}</${k}>`)
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>\n<Request>\n${body}\n</Request>`;
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

module.exports = { xmlEscape, buildRaiseTaskXml, buildEndpoint, extractTaskNumber };
