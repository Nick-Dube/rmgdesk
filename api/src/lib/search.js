'use strict';
// Searching requests: the filters the requests table and the export share.
// Everything is limited to what the caller may see (visibilityFilter), so a requester only finds their own.

const { z } = require('zod');
const { visibilityFilter } = require('./users');
const { OPEN } = require('./workflow');
const { fromLondon } = require('./time');

const STATUSES = ['new', 'triaged', 'assigned', 'attending', 'made_safe', 'on_hold', 'resolved', 'closed', 'reopened', 'cancelled'];
const list = (allowed) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : []))
    .refine((v) => v.every((x) => allowed.includes(x)), 'Unknown value');
const ids = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0) : []));
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .optional();
const text = (max) => z.string().trim().max(max).optional().transform((v) => v || undefined);

const filterSchema = z.object({
  q: text(200), // reference, or words in the title, description or location
  requester: text(120),
  from: day, // UK dates, inclusive
  to: day,
  site: ids,
  building: ids,
  category: ids,
  team: ids,
  department: text(120),
  status: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : []))
    .refine((v) => v.every((x) => STATUSES.includes(x) || x === 'open' || x === 'done'), 'Unknown status'),
  priority: list(['P1', 'P2', 'P3', 'P4']),
  source: z.enum(['all', 'live', 'legacy']).optional().default('all'),
  assignee: z
    .string()
    .optional()
    .refine((v) => !v || v === 'me' || v === 'none' || /^\d+$/.test(v), 'Unknown assignee'),
});

const SORTS = {
  created: 't.created_at',
  reference: 't.id',
  priority: 't.priority',
  status: 't.status',
  building: 'b.name',
  category: 'c.label',
  department: 't.department_name',
};

const pageSchema = z.object({
  sort: z.enum(Object.keys(SORTS)).optional().default('created'),
  dir: z.enum(['asc', 'desc']).optional().default('desc'),
  page: z.coerce.number().int().min(1).max(100000).optional().default(1),
  pageSize: z.coerce.number().int().min(10).max(100).optional().default(50),
});

/** The joins every search uses. */
const FROM = `FROM tickets t
  JOIN sites s ON s.id = t.site_id
  JOIN buildings b ON b.id = t.building_id
  JOIN categories c ON c.id = t.category_id
  LEFT JOIN service_lines sl ON sl.id = t.service_line_id
  LEFT JOIN users u ON u.id = t.requester_id
  LEFT JOIN users a ON a.id = t.assignee_id`;

/** Turn query-string filters into a WHERE clause. Throws a ZodError on bad input. */
function buildWhere(user, raw) {
  const f = filterSchema.parse(raw || {});
  const where = [];
  const params = [];
  const vis = visibilityFilter(user);
  where.push(vis.sql);
  params.push(...vis.params);
  const inList = (col, values) => {
    where.push(`${col} IN (${values.map(() => '?').join(',')})`);
    params.push(...values);
  };

  if (f.q) {
    const ref = /^(RMG|LEG)?-?0*(\d{1,7})$/i.exec(f.q.replace(/\s+/g, ''));
    if (ref) {
      // A reference: RMG-000123, LEG-017690, 123
      const n = ref[2].padStart(6, '0');
      const prefix = ref[1] ? ref[1].toUpperCase() : null;
      if (prefix) {
        where.push('t.reference = ?');
        params.push(`${prefix}-${n}`);
      } else {
        where.push('(t.reference IN (?, ?) OR t.evolution_task_no = ?)');
        params.push(`RMG-${n}`, `LEG-${n}`, ref[2]);
      }
    } else {
      where.push('(t.title LIKE ? OR t.description LIKE ? OR t.location_text LIKE ? OR t.reference LIKE ?)');
      const like = `%${f.q}%`;
      params.push(like, like, like, like);
    }
  }
  if (f.requester) {
    where.push('(u.full_name LIKE ? OR u.email LIKE ?)');
    params.push(`%${f.requester}%`, `%${f.requester}%`);
  }
  if (f.from) {
    const [y, m, d] = f.from.split('-').map(Number);
    where.push('t.created_at >= ?');
    params.push(fromLondon(y, m, d));
  }
  if (f.to) {
    const [y, m, d] = f.to.split('-').map(Number);
    where.push('t.created_at < ?');
    params.push(fromLondon(y, m, d + 1)); // to the end of that day
  }
  if (f.site.length) inList('t.site_id', f.site);
  if (f.building.length) inList('t.building_id', f.building);
  if (f.category.length) inList('t.category_id', f.category);
  if (f.team.length) inList('t.service_line_id', f.team);
  if (f.department) {
    where.push('t.department_name LIKE ?');
    params.push(`%${f.department}%`);
  }
  if (f.status.length) {
    const wanted = new Set(f.status.flatMap((x) => (x === 'open' ? OPEN : x === 'done' ? ['resolved', 'closed', 'cancelled'] : [x])));
    inList('t.status', [...wanted]);
  }
  if (f.priority.length) inList('t.priority', f.priority);
  if (f.source === 'live') where.push("t.source <> 'legacy'");
  if (f.source === 'legacy') where.push("t.source = 'legacy'");
  if (f.assignee === 'me') {
    where.push('t.assignee_id = ?');
    params.push(user.id);
  } else if (f.assignee === 'none') {
    where.push('t.assignee_id IS NULL');
  } else if (f.assignee) {
    where.push('t.assignee_id = ?');
    params.push(Number(f.assignee));
  }
  return { sql: where.join(' AND '), params };
}

function buildOrder(raw) {
  const p = pageSchema.parse(raw || {});
  const col = SORTS[p.sort];
  // Always end on the id, so pages are stable when many rows share a value.
  const order = `${col} ${p.dir.toUpperCase()}${col === 't.id' ? '' : `, t.id ${p.dir.toUpperCase()}`}`;
  return { order, ...p };
}

module.exports = { FROM, buildWhere, buildOrder, STATUSES };
