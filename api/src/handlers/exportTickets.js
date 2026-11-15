'use strict';
// POST /tickets/export  { filters: {...same as GET /tickets/search...}, sort, dir, format: 'xlsx' | 'csv' }
// Builds the file of every request that matches (up to 100,000), saves it in S3 under exports/<user>/ and
// returns a link that downloads it for the next 15 minutes. The bucket deletes exports after a day.
// Going through S3 means the file size is not limited by the API's 6 MB response limit.

const ExcelJS = require('exceljs');
const { PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { wrap, json, parseBody, HttpError } = require('../lib/http');
const { query } = require('../lib/db');
const { resolveUser } = require('../lib/users');
const { s3 } = require('../lib/aws');
const search = require('../lib/search');

const MAX_ROWS = 100000;
const london = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'short', timeStyle: 'short' });
const ukText = (d) => (d ? london.format(new Date(d)).replace(',', '') : '');
/** Excel has no time zones: give it the UK wall-clock time as a date it will format. */
function ukDate(d) {
  if (!d) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(d))
      .map((p) => [p.type, p.value]),
  );
  return new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second));
}

const STATUS = { new: 'New', triaged: 'Acknowledged', assigned: 'Assigned', attending: 'Engineer attending', made_safe: 'Made safe', on_hold: 'On hold', resolved: 'Resolved', closed: 'Closed', reopened: 'Reopened', cancelled: 'Cancelled' };

function columns(staff) {
  const cols = [
    { header: 'Reference', key: 'reference', width: 13 },
    { header: 'Raised', key: 'createdAt', width: 17, date: true },
    { header: 'Status', key: 'status', width: 18, map: (v) => STATUS[v] || v },
    { header: 'Priority', key: 'priority', width: 9 },
    { header: 'Title', key: 'title', width: 50 },
    { header: 'Description', key: 'description', width: 70 },
    { header: 'Site', key: 'site', width: 26 },
    { header: 'Building', key: 'building', width: 24 },
    { header: 'Location', key: 'location', width: 30 },
    { header: 'Category', key: 'category', width: 28 },
    { header: 'Team', key: 'team', width: 30 },
    { header: 'Department', key: 'department', width: 24 },
    { header: 'Requester', key: 'requester', width: 22 },
  ];
  if (staff) cols.push({ header: 'Requester email', key: 'requesterEmail', width: 30 }, { header: 'Phone', key: 'phone', width: 16 });
  cols.push(
    { header: 'Assigned to', key: 'assignee', width: 22 },
    { header: 'Acknowledged', key: 'acknowledgedAt', width: 17, date: true },
    { header: 'Attended', key: 'attendedAt', width: 17, date: true },
    { header: 'Resolved', key: 'resolvedAt', width: 17, date: true },
    { header: 'Closed', key: 'closedAt', width: 17, date: true },
    { header: 'Closed reason', key: 'closedReason', width: 14 },
    { header: 'What was done', key: 'resolutionNote', width: 50 },
    { header: 'Cause', key: 'rootCause', width: 18, map: (v) => (v ? v.replace(/_/g, ' ') : '') },
    { header: 'Rating', key: 'satisfaction', width: 8 },
    { header: 'Times reopened', key: 'reopenCount', width: 10 },
    { header: 'MRI Evolution task', key: 'evolutionTaskNo', width: 14 },
    { header: 'Source', key: 'source', width: 10, map: (v) => (v === 'legacy' ? 'Old form' : 'RMG Desk') },
  );
  return cols;
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  // Leading = + - @ would run as a formula in Excel: prefix with an apostrophe.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

exports.handler = wrap(async (event) => {
  const user = await resolveUser(event);
  const body = parseBody(event);
  const format = body.format === 'csv' ? 'csv' : 'xlsx';
  const where = search.buildWhere(user, body.filters || {});
  const order = search.buildOrder({ sort: body.sort, dir: body.dir });

  const count = Number((await query(`SELECT COUNT(*) AS n ${search.FROM} WHERE ${where.sql}`, where.params))[0].n);
  if (!count) throw new HttpError(400, 'Nothing matches these filters.');
  if (count > MAX_ROWS) throw new HttpError(400, `That is ${count.toLocaleString('en-GB')} requests. Narrow the filters to ${MAX_ROWS.toLocaleString('en-GB')} or fewer.`);

  const rows = await query(
    `SELECT t.reference, t.created_at AS createdAt, t.status, t.priority, t.title, t.description, s.name AS site,
            b.name AS building, t.location_text AS location, c.label AS category, sl.name AS team, t.department_name AS department,
            u.full_name AS requester, u.email AS requesterEmail, t.contact_phone AS phone, a.full_name AS assignee,
            t.acknowledged_at AS acknowledgedAt, t.attended_at AS attendedAt, t.resolved_at AS resolvedAt, t.closed_at AS closedAt,
            t.closed_reason AS closedReason, t.resolution_note AS resolutionNote, t.root_cause AS rootCause,
            t.satisfaction, t.reopen_count AS reopenCount, t.evolution_task_no AS evolutionTaskNo, t.source
       ${search.FROM}
      WHERE ${where.sql}
      ORDER BY ${order.order}`,
    where.params,
  );

  const cols = columns(user.worksTickets);
  const stamp = ukText(new Date()).replace(/[/: ]/g, (c) => (c === ' ' ? '-' : c === '/' ? '-' : '')).slice(0, 15);
  const fileName = `RMG Desk requests ${stamp}.${format}`;
  let bodyBytes;
  let contentType;

  if (format === 'csv') {
    const lines = [cols.map((c) => csvCell(c.header)).join(',')];
    for (const r of rows) lines.push(cols.map((c) => csvCell(c.date ? ukText(r[c.key]) : c.map ? c.map(r[c.key]) : r[c.key])).join(','));
    bodyBytes = Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8'); // the BOM makes Excel read UTF-8
    contentType = 'text/csv; charset=utf-8';
  } else {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'RMG Desk';
    const ws = wb.addWorksheet('Requests', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width, style: c.date ? { numFmt: 'dd/mm/yyyy hh:mm' } : undefined }));
    for (const r of rows) {
      const out = {};
      for (const c of cols) out[c.key] = c.date ? ukDate(r[c.key]) : c.map ? c.map(r[c.key]) : r[c.key] ?? null;
      ws.addRow(out);
    }
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2545' } };
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    bodyBytes = Buffer.from(await wb.xlsx.writeBuffer());
    contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }

  const key = `exports/${user.id}/${Date.now()}.${format}`;
  await s3.send(new PutObjectCommand({ Bucket: process.env.ATTACHMENTS_BUCKET, Key: key, Body: bodyBytes, ContentType: contentType }));
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: process.env.ATTACHMENTS_BUCKET, Key: key, ResponseContentDisposition: `attachment; filename="${fileName}"` }),
    { expiresIn: 900 },
  );
  console.log(JSON.stringify({ level: 'info', message: 'export', userId: user.id, rows: rows.length, format, bytes: bodyBytes.length }));
  return json(200, { url, fileName, rows: rows.length });
});

exports._internal = { csvCell, columns };
