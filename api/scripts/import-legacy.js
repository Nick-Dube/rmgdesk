#!/usr/bin/env node
'use strict';
// Import the old helpdesk's Google Sheet export (Tasks tab) into RMG Desk as history.
//
//   node scripts/import-legacy.js "<path to .xlsx>"            dry run: reads everything, writes nothing, prints a report
//   node scripts/import-legacy.js "<path to .xlsx>" --apply    imports the rows not imported before
//
// Connects through the database tunnel. Environment: DB_USER, DB_PASSWORD, DB_HOST (127.0.0.1), DB_PORT (3307),
// DB_NAME (rmgdesk), DB_SSL ("skip-verify" through the tunnel, the default; "false" for a local MySQL).
//
// What an imported request looks like:
//   reference LEG-017690 (the sheet's Sequence) · source "legacy" · no requester (the old form kept none)
//   text decoded where the old form stored it HTML-encoded (&amp;apos; -> ')
//   department as typed, tidied (spacing, case, obvious typos) · building from the "NMM ~ Queens House" label
//   category by the old form's name; three retired categories are kept as inactive categories
//   team from today's routing for that category · status "closed" (outcome not recorded), or "cancelled"
//   for the rows the sheet marks as raised by bots · times converted from UK time to UTC
// Safe to run again: rows already imported (same LEG- reference) are skipped, so a later export tops up.

const path = require('path');
const ExcelJS = require('exceljs');
const mysql = require('mysql2/promise');
const { fromLondon } = require('../src/lib/time');

const file = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!file) {
  console.error('Usage: node scripts/import-legacy.js "<file.xlsx>" [--apply]');
  process.exit(1);
}

// Rows the sheet leaves without a building, keyed by Sequence -> the building's old form label.
// Add a line here to import one; otherwise it is skipped and listed in the report.
const BUILDING_FIXES = {
  // 17557: 'NMM ~ Sammy Ofer Wing',   // "Ocean Court Figurehead": confirm the building, then remove the //
};

// Retired categories: which current category's team handled them (for team-level insights).
const TEAM_FROM = {
  Pest: 'Pests - Mice & Other',
  'Security: Locks & Keys': 'Security: Access Control, Locks, Keys and Maglock',
  Learning: 'Engagement',
};

// Departments: obvious misspellings. Spacing and capitals are tidied automatically.
const DEPARTMENT_FIXES = {
  conservaiton: 'Conservation',
  'visitors experience': 'Visitor Experience',
  'library & archive': 'Library & Archive',
};
const BOT = 'cancelled - raised by bot';

// The old form stored some text HTML-encoded, sometimes twice ("Santa&amp;apos;s"): decode until it settles.
const ENTITIES = { amp: '&', apos: "'", quot: '"', lt: '<', gt: '>', nbsp: ' ' };
function decode(v) {
  let s = String(v ?? '');
  for (let i = 0; i < 3; i++) {
    const next = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    });
    if (next === s) break;
    s = next;
  }
  return s;
}
const tidy = (v) => decode(v).replace(/\s+/g, ' ').trim();

function short(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trim()}…`;
}

async function readSheet() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet('Tasks') || wb.worksheets[0];
  const header = ws.getRow(1).values.map((h) => tidy(h).toLowerCase());
  const col = (name) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`Column "${name}" not found. Columns are: ${header.filter(Boolean).join(', ')}`);
    return i;
  };
  const C = {
    date: col('date task raised'),
    building: col('building'),
    location: col('location'),
    category: col('category'),
    problem: col('problem'),
    department: col('department'),
    priority: col('priority'),
    seq: col('sequence'),
  };
  const rows = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const v = row.values;
    const cell = (i) => {
      const x = v[i];
      return x && typeof x === 'object' && !(x instanceof Date) ? x.text ?? x.result ?? x.richText?.map((r) => r.text).join('') : x;
    };
    if (!cell(C.seq) && !cell(C.problem)) return; // empty row
    rows.push({
      line: n,
      date: cell(C.date),
      building: tidy(cell(C.building)),
      location: tidy(cell(C.location)),
      category: tidy(cell(C.category)),
      problem: decode(cell(C.problem)).trim(),
      department: tidy(cell(C.department)),
      priority: tidy(cell(C.priority)).toUpperCase(),
      seq: Number(cell(C.seq)),
    });
  });
  return rows;
}

/** Excel dates arrive as JS Dates whose UTC parts are the sheet's wall-clock time (UK). */
function toUtc(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  return fromLondon(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
}

async function main() {
  const host = process.env.DB_HOST || '127.0.0.1';
  const ssl = process.env.DB_SSL || (host === '127.0.0.1' || host === 'localhost' ? 'skip-verify' : 'true');
  const db = await mysql.createConnection({
    host,
    port: Number(process.env.DB_PORT || 3307),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'rmgdesk',
    ssl: ssl === 'false' ? undefined : { rejectUnauthorized: ssl !== 'skip-verify' },
    timezone: 'Z',
    multipleStatements: false,
  });

  console.log(`Reading ${path.basename(file)} ...`);
  const rows = await readSheet();

  // Reference data
  const [buildings] = await db.query('SELECT id, site_id, legacy_label FROM buildings WHERE legacy_label IS NOT NULL');
  const byLabel = new Map(buildings.map((b) => [b.legacy_label.toLowerCase(), b]));
  const [categories] = await db.query('SELECT id, name FROM categories');
  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));
  const [rules] = await db.query(
    `SELECT category_id, service_line_id FROM routing_rules
      WHERE site_id IS NULL AND effective_from <= CURRENT_DATE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)`,
  );
  const teamOf = new Map(rules.map((r) => [r.category_id, r.service_line_id]));
  const [orgs] = await db.query('SELECT id, code, name FROM organisations');
  const orgByCode = new Map(orgs.map((o) => [o.code, o.id]));
  const rmg = orgByCode.get('RMG');
  const [done] = await db.query("SELECT reference FROM tickets WHERE source = 'legacy'");
  const already = new Set(done.map((r) => r.reference));

  // Departments: one spelling per department (the most used), plus the fixes above.
  const spellings = new Map();
  for (const r of rows) {
    if (!r.department) continue;
    const key = r.department.toLowerCase();
    const m = spellings.get(key) || new Map();
    m.set(r.department, (m.get(r.department) || 0) + 1);
    spellings.set(key, m);
  }
  const department = (raw) => {
    if (!raw) return null;
    const key = raw.toLowerCase();
    if (DEPARTMENT_FIXES[key]) return DEPARTMENT_FIXES[key];
    const best = [...spellings.get(key).entries()].sort((a, b) => b[1] - a[1])[0][0];
    return best === best.toLowerCase() ? best.replace(/\b\w/g, (c) => c.toUpperCase()) : best;
  };

  const report = { read: rows.length, alreadyImported: 0, toImport: 0, bots: 0, skipped: [], byYear: {}, departments: new Map(), retired: {} };
  const ready = [];
  for (const r of rows) {
    const reference = `LEG-${String(r.seq).padStart(6, '0')}`;
    if (!Number.isInteger(r.seq) || r.seq <= 0) {
      report.skipped.push(`row ${r.line}: no Sequence`);
      continue;
    }
    if (already.has(reference)) {
      report.alreadyImported += 1;
      continue;
    }
    const buildingLabel = r.building || BUILDING_FIXES[r.seq];
    const building = buildingLabel && byLabel.get(buildingLabel.toLowerCase());
    if (!building) {
      report.skipped.push(`Sequence ${r.seq}: ${buildingLabel ? `unknown building "${buildingLabel}"` : 'no building'} ("${short(r.problem, 60)}")`);
      continue;
    }
    const category = byName.get(r.category.toLowerCase());
    if (!category) {
      report.skipped.push(`Sequence ${r.seq}: unknown category "${r.category}" (run the migrations first?)`);
      continue;
    }
    const created = toUtc(r.date);
    if (!created) {
      report.skipped.push(`Sequence ${r.seq}: no date`);
      continue;
    }
    if (!['P1', 'P2', 'P3', 'P4'].includes(r.priority)) {
      report.skipped.push(`Sequence ${r.seq}: priority "${r.priority}"`);
      continue;
    }
    const isBot = r.department.toLowerCase() === BOT;
    const dept = isBot ? null : department(r.department);
    if (TEAM_FROM[category.name]) report.retired[category.name] = (report.retired[category.name] || 0) + 1;
    const teamCategory = TEAM_FROM[category.name] ? byName.get(TEAM_FROM[category.name].toLowerCase()) : category;
    const problem = r.problem || '(no description)';
    const firstLine = problem.split(/\r?\n/)[0].replace(/\s+/g, ' ').trim() || problem;
    const org = dept && /^benugo$/i.test(dept) ? orgByCode.get('BENUGO') : dept && /^vertex$/i.test(dept) ? orgByCode.get('VERTEX') : rmg;

    if (dept && dept !== r.department) report.departments.set(`${r.department} -> ${dept}`, (report.departments.get(`${r.department} -> ${dept}`) || 0) + 1);
    if (isBot) report.bots += 1;
    const year = created.getUTCFullYear();
    report.byYear[year] = (report.byYear[year] || 0) + 1;
    report.toImport += 1;

    ready.push({
      reference,
      seq: r.seq,
      org: org || rmg,
      dept,
      site: building.site_id,
      building: building.id,
      location: r.location ? short(r.location, 200) : null,
      category: category.id,
      team: teamCategory ? teamOf.get(teamCategory.id) ?? null : null,
      priority: r.priority,
      status: isBot ? 'cancelled' : 'closed',
      closedReason: isBot ? 'cancelled' : null,
      title: short(firstLine, 100),
      description: problem,
      created,
    });
  }

  // ---- report
  console.log('');
  console.log(`Rows read:              ${report.read}`);
  console.log(`Already imported:       ${report.alreadyImported}`);
  console.log(`To import:              ${report.toImport}  (of which raised by bots, imported as cancelled: ${report.bots})`);
  console.log(`By year:                ${Object.entries(report.byYear).map(([y, n]) => `${y}: ${n}`).join(', ') || '-'}`);
  if (Object.keys(report.retired).length) console.log(`Retired categories:     ${Object.entries(report.retired).map(([c, n]) => `${c}: ${n}`).join(', ')}`);
  if (report.departments.size) {
    console.log('Departments tidied:');
    for (const [change, n] of [...report.departments.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${change} (${n})`);
  }
  console.log(`Skipped:                ${report.skipped.length}`);
  for (const s of report.skipped) console.log(`  ${s}`);
  console.log('');

  if (!APPLY) {
    console.log('Dry run: nothing was written. Run again with --apply to import.');
    await db.end();
    return;
  }

  // ---- import, 500 at a time, each batch in its own transaction
  let imported = 0;
  for (let i = 0; i < ready.length; i += 500) {
    const batch = ready.slice(i, i + 500);
    await db.beginTransaction();
    try {
      await db.query(
        `INSERT INTO tickets (reference, requester_id, organisation_id, department_name, site_id, building_id, location_text,
           category_id, service_line_id, priority, status, title, description, source, closed_reason, closed_at, created_at, updated_at)
         VALUES ?`,
        [
          batch.map((t) => [
            t.reference, null, t.org, t.dept, t.site, t.building, t.location, t.category, t.team, t.priority, t.status,
            t.title, t.description, 'legacy', t.closedReason, t.status === 'cancelled' ? t.created : null, t.created, t.created,
          ]),
        ],
      );
      const [ids] = await db.query('SELECT id, reference FROM tickets WHERE reference IN (?)', [batch.map((t) => t.reference)]);
      const idOf = new Map(ids.map((x) => [x.reference, x.id]));
      await db.query('INSERT INTO ticket_events (ticket_id, type, body, data, created_at) VALUES ?', [
        batch.map((t) => [
          idOf.get(t.reference),
          'created',
          'Imported from the previous helpdesk form. The old form did not record who raised it.',
          JSON.stringify({ source: 'legacy', sequence: t.seq, priority: t.priority }),
          t.created,
        ]),
      ]);
      await db.commit();
      imported += batch.length;
      process.stdout.write(`\rImported ${imported} of ${ready.length}`);
    } catch (err) {
      await db.rollback();
      throw err;
    }
  }
  console.log(`\nDone. ${imported} requests imported.`);
  await db.end();
}

main().catch((err) => {
  console.error(`\nImport stopped: ${err.message}`);
  process.exit(1);
});
