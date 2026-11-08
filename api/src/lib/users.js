'use strict';
// Who is calling, and what may they do? Cognito proves identity; MySQL holds role and scope.

const { query } = require('./db');
const { HttpError } = require('./http');

const ROLES = {
  REQUESTER: 'requester',
  AGENT: 'agent',
  LEAD: 'lead',
  VIEWER: 'viewer',
  RMG_SUPERUSER: 'rmg_superuser',
  VERTEX_HELPDESK: 'vertex_helpdesk',
  VERTEX_SUPERUSER: 'vertex_superuser',
};

/** Roles that may see every ticket on the estate. */
const SEES_ALL = new Set([ROLES.VIEWER, ROLES.RMG_SUPERUSER, ROLES.VERTEX_HELPDESK, ROLES.VERTEX_SUPERUSER]);
/** Roles that may work tickets (update, internal notes). */
const WORKS_TICKETS = new Set([ROLES.AGENT, ROLES.LEAD, ROLES.RMG_SUPERUSER, ROLES.VERTEX_HELPDESK, ROLES.VERTEX_SUPERUSER]);

function claimsFrom(event) {
  const claims = event?.requestContext?.authorizer?.jwt?.claims;
  if (!claims || !claims.sub) throw new HttpError(401, 'Please sign in again.');
  return claims;
}

/**
 * Find the caller's user record, linking or creating it on first sign-in:
 *  1. already linked by Cognito sub;
 *  2. invited by an admin (row exists with this email, no sub yet) - link it;
 *  3. email domain belongs to an organisation that allows self sign-up - create a Requester.
 */
async function resolveUser(event) {
  const claims = claimsFrom(event);
  const sub = String(claims.sub);
  const email = String(claims.email || '').toLowerCase();

  let rows = await query('SELECT * FROM users WHERE cognito_sub = ?', [sub]);
  let user = rows[0];

  if (!user) {
    if (!email || String(claims.email_verified) !== 'true') {
      throw new HttpError(403, 'Please verify your email address before using the helpdesk.');
    }
    rows = await query('SELECT * FROM users WHERE email = ? AND cognito_sub IS NULL', [email]);
    if (rows[0]) {
      await query("UPDATE users SET cognito_sub = ?, status = IF(status = 'invited', 'active', status) WHERE id = ?", [
        sub,
        rows[0].id,
      ]);
    } else {
      const domain = email.split('@')[1] || '';
      const orgs = await query(
        'SELECT id FROM organisations WHERE allow_self_signup = TRUE AND active = TRUE AND FIND_IN_SET(?, email_domains) > 0',
        [domain],
      );
      if (!orgs[0]) {
        throw new HttpError(403, 'Your account has not been given access to the RMG Helpdesk yet. Please ask the RMG Estates team.');
      }
      const name = String(claims.name || email.split('@')[0]).slice(0, 120);
      await query(
        "INSERT INTO users (cognito_sub, email, full_name, organisation_id, role, status) VALUES (?, ?, ?, ?, 'requester', 'active')",
        [sub, email, name, orgs[0].id],
      );
    }
    rows = await query('SELECT * FROM users WHERE cognito_sub = ?', [sub]);
    user = rows[0];
  }

  if (user.status === 'suspended' || user.status === 'disabled') {
    throw new HttpError(403, 'Your helpdesk access has been suspended. Please contact the RMG Estates team.');
  }

  // Record sign-in activity at most every 15 minutes, to avoid a write per request.
  const last = user.last_sign_in_at ? new Date(user.last_sign_in_at).getTime() : 0;
  if (Date.now() - last > 15 * 60 * 1000) {
    await query('UPDATE users SET last_sign_in_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [user.id]);
  }

  const scopes = await query('SELECT service_line_id, site_id FROM user_scopes WHERE user_id = ?', [user.id]);
  user.serviceLineIds = scopes.filter((s) => s.service_line_id).map((s) => s.service_line_id);
  user.siteIds = scopes.filter((s) => s.site_id).map((s) => s.site_id);
  user.seesAll = SEES_ALL.has(user.role);
  user.worksTickets = WORKS_TICKETS.has(user.role);
  return user;
}

/** SQL fragment + params restricting tickets (aliased t) to what this user may see. */
function visibilityFilter(user) {
  if (user.seesAll) return { sql: '1 = 1', params: [] };
  const parts = ['t.requester_id = ?', 'EXISTS (SELECT 1 FROM ticket_followers f WHERE f.ticket_id = t.id AND f.user_id = ?)'];
  const params = [user.id, user.id];
  if (user.worksTickets && user.serviceLineIds.length) {
    parts.push(`t.service_line_id IN (${user.serviceLineIds.map(() => '?').join(',')})`);
    params.push(...user.serviceLineIds);
  }
  return { sql: `(${parts.join(' OR ')})`, params };
}

function publicProfile(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    organisationId: user.organisation_id,
    seesAll: user.seesAll,
    worksTickets: user.worksTickets,
    serviceLineIds: user.serviceLineIds,
  };
}

module.exports = { ROLES, resolveUser, visibilityFilter, publicProfile };
