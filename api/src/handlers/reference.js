'use strict';
// GET /reference - everything the request form needs: sites, buildings, categories, priorities, announcements.

const { wrap, json } = require('../lib/http');
const { query } = require('../lib/db');
const { resolveUser } = require('../lib/users');

const PRIORITIES = [
  {
    code: 'P1',
    label: 'Priority 1 - High',
    description: 'Immediate health and safety risk to staff or the public, major disruption to the property, or an unacceptable security risk.',
  },
  { code: 'P2', label: 'Priority 2 - Medium', description: 'Stops Royal Museums Greenwich from operating normally.' },
  { code: 'P3', label: 'Priority 3 - Low', description: "Routine matters that do not disrupt the Museum's normal business." },
  {
    code: 'P4',
    label: 'Priority 4 - Planned works',
    description: 'Requests that do not fit the other priorities, or that need more than 3 days for a permanent fix.',
  },
];

let cache; // reference data changes rarely; keep it for 5 minutes per Lambda container
let cachedAt = 0;

async function load() {
  const [sites, buildings, categories] = await Promise.all([
    query('SELECT id, code, name FROM sites ORDER BY sort_order'),
    query('SELECT id, site_id AS siteId, name FROM buildings WHERE active = TRUE ORDER BY sort_order'),
    query('SELECT id, label, default_priority AS defaultPriority FROM categories WHERE active = TRUE ORDER BY label'),
  ]);
  return { sites, buildings, categories };
}

exports.handler = wrap(async (event) => {
  await resolveUser(event);
  if (!cache || Date.now() - cachedAt > 5 * 60 * 1000) {
    cache = await load();
    cachedAt = Date.now();
  }
  const announcements = await query(
    `SELECT id, site_id AS siteId, building_id AS buildingId, message
       FROM announcements
      WHERE starts_at <= CURRENT_TIMESTAMP(3) AND (ends_at IS NULL OR ends_at > CURRENT_TIMESTAMP(3))
      ORDER BY starts_at DESC`,
  );
  return json(200, {
    ...cache,
    priorities: PRIORITIES,
    announcements,
    emergency: 'In an emergency, call Security Control on 6555.',
    helpdeskPhone: '0208 312 6708',
  });
});
