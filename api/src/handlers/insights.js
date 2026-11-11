'use strict';
// GET /insights?days=30|90|365 - the numbers behind the Insights page, for staff and viewers.
// Everything is limited to the tickets the caller may see (a team lead sees their teams; superusers see all).
//
//   summary      open now, raised and resolved in the period, average days to resolve, reopen rate, satisfaction
//   backlog      open requests by age, by status and by priority
//   trend        raised and resolved per month, last 12 months
//   bySite, byCategory, byServiceLine
//   repeats      the same category in the same building 3+ times in the period: candidates for a permanent fix
//   rootCauses   why things broke, from the resolution form

const { z } = require('zod');
const { wrap, json, HttpError } = require('../lib/http');
const { query } = require('../lib/db');
const { resolveUser, visibilityFilter } = require('../lib/users');
const { OPEN } = require('../lib/workflow');

const IN_OPEN = `t.status IN (${OPEN.map(() => '?').join(',')})`;

exports.handler = wrap(async (event) => {
  const user = await resolveUser(event);
  if (!user.seesAll && !user.worksTickets) throw new HttpError(403, 'Insights are for helpdesk staff and viewers.');
  const { days } = z
    .object({ days: z.coerce.number().int().refine((d) => [30, 90, 365].includes(d), 'Choose 30, 90 or 365 days.').optional().default(90) })
    .parse(event.queryStringParameters || {});

  const vis = visibilityFilter(user);
  const V = vis.sql;
  const P = vis.params;
  const since = `t.created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ${days} DAY)`; // days is one of three integers

  const [summary, ageing, byStatus, byPriority, trend, bySite, byCategory, byServiceLine, repeats, rootCauses] = await Promise.all([
    query(
      `SELECT
         SUM(${IN_OPEN}) AS openNow,
         SUM(${IN_OPEN} AND t.priority = 'P1') AS openP1,
         SUM(${since}) AS raised,
         SUM(t.resolved_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ${days} DAY)) AS resolved,
         AVG(CASE WHEN t.resolved_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ${days} DAY)
                  THEN TIMESTAMPDIFF(MINUTE, t.created_at, t.resolved_at) END) / 1440 AS avgDaysToResolve,
         SUM(${since} AND t.reopen_count > 0) AS reopened,
         AVG(CASE WHEN ${since} THEN t.satisfaction END) AS satisfaction,
         SUM(${since} AND t.satisfaction IS NOT NULL) AS ratings
       FROM tickets t WHERE ${V}`,
      [...OPEN, ...OPEN, ...P],
    ),
    query(
      `SELECT CASE
                WHEN t.created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY) THEN 'Under 1 day'
                WHEN t.created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 3 DAY) THEN '1 to 3 days'
                WHEN t.created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 7 DAY) THEN '3 to 7 days'
                WHEN t.created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 30 DAY) THEN '1 to 4 weeks'
                ELSE 'Over 4 weeks' END AS bucket,
              COUNT(*) AS n
         FROM tickets t WHERE ${IN_OPEN} AND ${V} GROUP BY bucket`,
      [...OPEN, ...P],
    ),
    query(`SELECT t.status, COUNT(*) AS n FROM tickets t WHERE ${IN_OPEN} AND ${V} GROUP BY t.status`, [...OPEN, ...P]),
    query(`SELECT t.priority, COUNT(*) AS n FROM tickets t WHERE ${IN_OPEN} AND ${V} GROUP BY t.priority ORDER BY t.priority`, [...OPEN, ...P]),
    query(
      `SELECT m.month, SUM(m.raised) AS raised, SUM(m.resolved) AS resolved FROM (
         SELECT DATE_FORMAT(t.created_at, '%Y-%m') AS month, 1 AS raised, 0 AS resolved FROM tickets t
          WHERE t.created_at >= DATE_SUB(DATE_FORMAT(CURRENT_DATE, '%Y-%m-01'), INTERVAL 11 MONTH) AND ${V}
         UNION ALL
         SELECT DATE_FORMAT(t.resolved_at, '%Y-%m'), 0, 1 FROM tickets t
          WHERE t.resolved_at >= DATE_SUB(DATE_FORMAT(CURRENT_DATE, '%Y-%m-01'), INTERVAL 11 MONTH) AND ${V}
       ) m GROUP BY m.month ORDER BY m.month`,
      [...P, ...P],
    ),
    query(
      `SELECT s.name AS label, COUNT(*) AS raised, SUM(${IN_OPEN}) AS open
         FROM tickets t JOIN sites s ON s.id = t.site_id
        WHERE ${since} AND ${V} GROUP BY s.id, s.name ORDER BY raised DESC`,
      [...OPEN, ...P],
    ),
    query(
      `SELECT c.label, COUNT(*) AS raised, SUM(${IN_OPEN}) AS open
         FROM tickets t JOIN categories c ON c.id = t.category_id
        WHERE ${since} AND ${V} GROUP BY c.id, c.label ORDER BY raised DESC LIMIT 12`,
      [...OPEN, ...P],
    ),
    query(
      `SELECT COALESCE(sl.name, 'Not routed') AS label, COUNT(*) AS raised, SUM(${IN_OPEN}) AS open,
              AVG(TIMESTAMPDIFF(MINUTE, t.created_at, t.resolved_at)) / 1440 AS avgDaysToResolve
         FROM tickets t LEFT JOIN service_lines sl ON sl.id = t.service_line_id
        WHERE ${since} AND ${V} GROUP BY sl.id, sl.name ORDER BY raised DESC`,
      [...OPEN, ...P],
    ),
    query(
      `SELECT b.name AS building, s.code AS siteCode, c.label AS category, COUNT(*) AS n,
              MAX(t.created_at) AS lastRaised, MAX(t.id) AS lastTicketId
         FROM tickets t JOIN buildings b ON b.id = t.building_id JOIN sites s ON s.id = t.site_id JOIN categories c ON c.id = t.category_id
        WHERE ${since} AND t.status <> 'cancelled' AND ${V}
        GROUP BY b.id, b.name, s.code, c.id, c.label HAVING COUNT(*) >= 3
        ORDER BY n DESC, lastRaised DESC LIMIT 15`,
      [...P],
    ),
    query(
      `SELECT COALESCE(t.root_cause, 'not_recorded') AS cause, COUNT(*) AS n
         FROM tickets t WHERE t.resolved_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ${days} DAY) AND ${V}
        GROUP BY cause ORDER BY n DESC`,
      [...P],
    ),
  ]);

  const s = summary[0] || {};
  const num = (v, dp = 0) => (v === null || v === undefined ? null : Number(Number(v).toFixed(dp)));
  const order = ['Under 1 day', '1 to 3 days', '3 to 7 days', '1 to 4 weeks', 'Over 4 weeks'];

  return json(200, {
    days,
    scope: user.seesAll ? 'all' : 'teams',
    summary: {
      openNow: num(s.openNow) || 0,
      openP1: num(s.openP1) || 0,
      raised: num(s.raised) || 0,
      resolved: num(s.resolved) || 0,
      avgDaysToResolve: num(s.avgDaysToResolve, 1),
      reopenRate: s.raised ? num((100 * s.reopened) / s.raised, 1) : null,
      satisfaction: num(s.satisfaction, 1),
      ratings: num(s.ratings) || 0,
    },
    backlog: {
      ageing: order.map((bucket) => ({ label: bucket, n: num(ageing.find((a) => a.bucket === bucket)?.n) || 0 })),
      byStatus: byStatus.map((r) => ({ label: r.status, n: num(r.n) })),
      byPriority: byPriority.map((r) => ({ label: r.priority, n: num(r.n) })),
    },
    trend: trend.map((r) => ({ month: r.month, raised: num(r.raised), resolved: num(r.resolved) })),
    bySite: bySite.map((r) => ({ label: r.label, raised: num(r.raised), open: num(r.open) })),
    byCategory: byCategory.map((r) => ({ label: r.label, raised: num(r.raised), open: num(r.open) })),
    byServiceLine: byServiceLine.map((r) => ({ label: r.label, raised: num(r.raised), open: num(r.open), avgDaysToResolve: num(r.avgDaysToResolve, 1) })),
    repeats: repeats.map((r) => ({ ...r, n: num(r.n) })),
    rootCauses: rootCauses.map((r) => ({ cause: r.cause, n: num(r.n) })),
  });
});
