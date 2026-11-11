'use strict';
// Admin console API, for RMG and Vertex superusers. One route, ANY /admin/{proxy+}:
//
//   GET    /admin/options                       organisations, roles this admin may give, service lines, sites, categories
//   GET    /admin/users?q=&status=&role=&org=   people
//   POST   /admin/users                         invite someone (creates their login and emails a temporary password)
//   GET    /admin/users/{id}                    one person, with their history
//   PATCH  /admin/users/{id}                    change name, phone, organisation, role, teams, email settings
//   POST   /admin/users/{id}/suspend            block sign-in for now (reversible)
//   POST   /admin/users/{id}/reactivate         undo a suspension or offboarding
//   POST   /admin/users/{id}/offboard           leaver: block sign-in, remove from teams, unassign their open requests
//   POST   /admin/users/{id}/reset-mfa          new phone: they set up two-step verification again at next sign-in
//   POST   /admin/users/{id}/resend-invite      new temporary password, before their first sign-in
//   GET    /admin/routing                       who receives each category
//   POST   /admin/routing/rules                 route a category (or a category at one site)
//   PUT    /admin/routing/rules/{id}            change the team or the email recipients (keeps the old rule for history)
//   GET    /admin/announcements                 banners shown on the home page and the request form
//   POST   /admin/announcements
//   PATCH  /admin/announcements/{id}
//   DELETE /admin/announcements/{id}
//   GET    /admin/audit?entity=&entityId=&before=   everything changed in the console
//
// Guard rails: RMG superusers cannot change Vertex people or give Vertex roles; nobody can change their
// own role, organisation or status. Every change is written to the audit log.

const { z } = require('zod');
const { wrap, json, parseBody, HttpError } = require('../lib/http');
const { query, withTransaction } = require('../lib/db');
const { resolveUser, ROLES } = require('../lib/users');
const { cognito } = require('../lib/cognito');
const audit = require('../lib/audit');

const ADMIN_ROLES = [ROLES.RMG_SUPERUSER, ROLES.VERTEX_SUPERUSER];
const VERTEX_ROLES = [ROLES.VERTEX_HELPDESK, ROLES.VERTEX_SUPERUSER];
const OPEN = ['new', 'triaged', 'assigned', 'attending', 'made_safe', 'on_hold', 'reopened'];

const ROLE_INFO = [
  { code: 'requester', label: 'Requester', description: 'Raises requests and follows their own.' },
  { code: 'agent', label: 'Agent', description: 'Works requests for their teams.' },
  { code: 'lead', label: 'Team lead', description: 'Works and assigns requests for their teams.' },
  { code: 'viewer', label: 'Viewer', description: 'Sees every request and the insights, changes nothing.' },
  { code: 'rmg_superuser', label: 'RMG superuser', description: 'Everything, plus the admin console for RMG and partner people.' },
  { code: 'vertex_helpdesk', label: 'Vertex helpdesk', description: 'Works every request on the estate.' },
  { code: 'vertex_superuser', label: 'Vertex superuser', description: 'Everything, including Vertex people.' },
];

function log(level, message, extra = {}) {
  console.log(JSON.stringify({ level, message, ...extra }));
}

// ------------------------------------------------------------------ permissions
async function orgCode(id) {
  const rows = await query('SELECT code FROM organisations WHERE id = ?', [id]);
  return rows[0] ? rows[0].code : null;
}

function rolesFor(admin) {
  return admin.role === ROLES.VERTEX_SUPERUSER ? ROLE_INFO : ROLE_INFO.filter((r) => !VERTEX_ROLES.includes(r.code));
}

/** May this admin change this person at all? */
async function assertCanManage(admin, target) {
  if (admin.role === ROLES.VERTEX_SUPERUSER) return;
  if (VERTEX_ROLES.includes(target.role) || (await orgCode(target.organisation_id)) === 'VERTEX') {
    throw new HttpError(403, 'Vertex people are managed by Vertex superusers.');
  }
}

/** Is this role allowed for this organisation, and may this admin give it? */
async function assertRoleAllowed(admin, role, organisationId) {
  if (!rolesFor(admin).some((r) => r.code === role)) throw new HttpError(403, 'You cannot give that role.');
  const code = await orgCode(organisationId);
  if (!code) throw new HttpError(400, 'Choose an organisation from the list.');
  if (admin.role !== ROLES.VERTEX_SUPERUSER && code === 'VERTEX') throw new HttpError(403, 'Vertex people are managed by Vertex superusers.');
  if (VERTEX_ROLES.includes(role) && code !== 'VERTEX') throw new HttpError(400, 'Vertex roles are only for people in Vertex Services Group.');
  if (role === ROLES.RMG_SUPERUSER && code !== 'RMG') throw new HttpError(400, 'RMG superusers must be in Royal Museums Greenwich.');
}

function notSelf(admin, target, what) {
  if (admin.id === target.id) throw new HttpError(403, `You cannot ${what} yourself. Ask another superuser.`);
}

// ------------------------------------------------------------------ schemas
const optionalText = (max) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const roleEnum = z.enum(ROLE_INFO.map((r) => r.code));
const serviceLineIds = z.array(z.number().int().positive()).max(30).default([]);

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(254),
  fullName: z.string().trim().min(2, 'Enter their full name.').max(120),
  phone: optionalText(30),
  organisationId: z.number().int().positive(),
  role: roleEnum,
  serviceLineIds,
});

const editSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  phone: optionalText(30),
  organisationId: z.number().int().positive().optional(),
  role: roleEnum.optional(),
  serviceLineIds: z.array(z.number().int().positive()).max(30).optional(),
  notifyMode: z.enum(['instant', 'digest', 'off']).optional(),
});

const recipientsSchema = z
  .array(z.object({ email: z.string().trim().toLowerCase().email('Each recipient needs a valid email address.'), kind: z.enum(['to', 'cc']).default('to') }))
  .max(20)
  .refine((r) => r.some((x) => x.kind === 'to'), 'Add at least one "To" recipient.');

const ruleSchema = z.object({
  serviceLineId: z.number().int().positive(),
  recipients: recipientsSchema,
  notes: optionalText(255),
});
const newRuleSchema = ruleSchema.extend({ categoryId: z.number().int().positive(), siteId: z.number().int().positive().nullable().default(null) });

const announcementSchema = z.object({
  message: z.string().trim().min(5, 'Write the message people should see.').max(500),
  siteId: z.number().int().positive().nullable().optional().default(null),
  buildingId: z.number().int().positive().nullable().optional().default(null),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().nullable().optional().default(null),
});

const listUsersSchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['invited', 'active', 'suspended', 'disabled', 'any']).optional().default('any'),
  role: roleEnum.optional(),
  org: z.coerce.number().int().positive().optional(),
});

// ------------------------------------------------------------------ helpers
async function loadUser(id) {
  const rows = await query(
    `SELECT u.*, o.code AS organisation_code, o.name AS organisation_name, i.full_name AS invited_by_name
       FROM users u
       JOIN organisations o ON o.id = u.organisation_id
       LEFT JOIN users i ON i.id = u.invited_by
      WHERE u.id = ?`,
    [id],
  );
  if (!rows[0]) throw new HttpError(404, 'Person not found.');
  const scopes = await query(
    'SELECT sc.service_line_id AS id, sl.code, sl.name FROM user_scopes sc JOIN service_lines sl ON sl.id = sc.service_line_id WHERE sc.user_id = ? ORDER BY sl.name',
    [id],
  );
  return { ...rows[0], scopes };
}

function view(u) {
  return {
    id: u.id,
    email: u.email,
    fullName: u.full_name,
    phone: u.phone,
    organisation: { id: u.organisation_id, code: u.organisation_code, name: u.organisation_name },
    role: u.role,
    status: u.status,
    notifyMode: u.notify_mode,
    hasSignedIn: Boolean(u.cognito_sub),
    lastSignInAt: u.last_sign_in_at,
    invitedBy: u.invited_by_name || null,
    invitedAt: u.invited_at,
    createdAt: u.created_at,
    teams: u.scopes || [],
  };
}

/** The pool signs in by email; before first sign-in we only know the email, afterwards the sub is reliable. */
const username = (u) => u.cognito_sub || u.email;

async function setScopes(conn, userId, ids) {
  if (ids.length) {
    const found = await conn.q(`SELECT id FROM service_lines WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    if (found.length !== new Set(ids).size) throw new HttpError(400, 'One of the teams was not found.');
  }
  await conn.q('DELETE FROM user_scopes WHERE user_id = ?', [userId]);
  for (const id of new Set(ids)) await conn.q('INSERT INTO user_scopes (user_id, service_line_id) VALUES (?, ?)', [userId, id]);
}

const snapshot = (u) => ({
  fullName: u.full_name,
  phone: u.phone,
  organisation: u.organisation_code,
  role: u.role,
  status: u.status,
  notifyMode: u.notify_mode,
  teams: (u.scopes || []).map((s) => s.code),
});

// ------------------------------------------------------------------ options
async function options(admin) {
  const [organisations, serviceLines, sites, buildings, categories] = await Promise.all([
    query('SELECT id, code, name, type FROM organisations WHERE active = TRUE ORDER BY type, name'),
    query('SELECT id, code, name, organisation_id AS organisationId, is_evolution_linked AS isEvolutionLinked FROM service_lines WHERE active = TRUE ORDER BY name'),
    query('SELECT id, code, name FROM sites ORDER BY sort_order'),
    query('SELECT id, site_id AS siteId, name FROM buildings WHERE active = TRUE ORDER BY sort_order'),
    query('SELECT id, label FROM categories WHERE active = TRUE ORDER BY label'),
  ]);
  return json(200, {
    organisations: admin.role === ROLES.VERTEX_SUPERUSER ? organisations : organisations.filter((o) => o.code !== 'VERTEX'),
    roles: rolesFor(admin),
    serviceLines: serviceLines.map((s) => ({ ...s, isEvolutionLinked: Boolean(s.isEvolutionLinked) })),
    sites,
    buildings,
    categories,
    me: { id: admin.id, role: admin.role },
  });
}

// ------------------------------------------------------------------ users
async function listUsers(event) {
  const q = listUsersSchema.parse(event.queryStringParameters || {});
  const where = ['1 = 1'];
  const params = [];
  if (q.q) {
    where.push('(u.full_name LIKE ? OR u.email LIKE ?)');
    params.push(`%${q.q}%`, `%${q.q}%`);
  }
  if (q.status !== 'any') {
    where.push('u.status = ?');
    params.push(q.status);
  }
  if (q.role) {
    where.push('u.role = ?');
    params.push(q.role);
  }
  if (q.org) {
    where.push('u.organisation_id = ?');
    params.push(q.org);
  }
  const rows = await query(
    `SELECT u.id, u.email, u.full_name AS fullName, u.role, u.status, u.cognito_sub IS NOT NULL AS hasSignedIn,
            u.last_sign_in_at AS lastSignInAt, u.invited_at AS invitedAt, o.code AS organisationCode, o.name AS organisation,
            (SELECT GROUP_CONCAT(sl.name ORDER BY sl.name SEPARATOR ', ')
               FROM user_scopes sc JOIN service_lines sl ON sl.id = sc.service_line_id WHERE sc.user_id = u.id) AS teams
       FROM users u
       JOIN organisations o ON o.id = u.organisation_id
      WHERE ${where.join(' AND ')}
      ORDER BY u.full_name
      LIMIT 500`,
    params,
  );
  const counts = await query('SELECT status, COUNT(*) AS n FROM users GROUP BY status');
  return json(200, {
    users: rows.map((r) => ({ ...r, hasSignedIn: Boolean(r.hasSignedIn) })),
    counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
  });
}

async function getUser(id) {
  const u = await loadUser(id);
  const [tickets, history] = await Promise.all([
    query(
      `SELECT SUM(requester_id = ?) AS raised, SUM(assignee_id = ? AND status IN (${OPEN.map(() => '?').join(',')})) AS assignedOpen
         FROM tickets WHERE requester_id = ? OR assignee_id = ?`,
      [id, id, ...OPEN, id, id],
    ),
    query(
      `SELECT a.id, a.action, a.before_data AS beforeData, a.after_data AS afterData, a.created_at AS createdAt, u.full_name AS actorName
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.entity = 'user' AND a.entity_id = ?
        ORDER BY a.id DESC LIMIT 50`,
      [String(id)],
    ),
  ]);
  return json(200, {
    user: view(u),
    tickets: { raised: Number(tickets[0].raised || 0), assignedOpen: Number(tickets[0].assignedOpen || 0) },
    history,
  });
}

async function inviteUser(event, admin) {
  const input = inviteSchema.parse(parseBody(event));
  await assertRoleAllowed(admin, input.role, input.organisationId);

  const existing = (await query('SELECT id, status FROM users WHERE email = ?', [input.email]))[0];
  if (existing) {
    throw new HttpError(
      409,
      existing.status === 'disabled' || existing.status === 'suspended'
        ? 'This person already has an account, which is switched off. Open them and choose Reactivate.'
        : 'This person already has an account. Open them to change their role or teams.',
      { userId: existing.id },
    );
  }

  let alreadyHadLogin = false;
  const id = await withTransaction(async (conn) => {
    const ins = await conn.q(
      `INSERT INTO users (email, full_name, phone, organisation_id, role, status, invited_by, invited_at)
       VALUES (?, ?, ?, ?, ?, 'invited', ?, CURRENT_TIMESTAMP(3))`,
      [input.email, input.fullName, input.phone, input.organisationId, input.role, admin.id],
    );
    await setScopes(conn, ins.insertId, input.serviceLineIds);
    await audit.record(conn, event, admin, {
      action: 'user.invite',
      entity: 'user',
      entityId: ins.insertId,
      after: { email: input.email, fullName: input.fullName, role: input.role, organisationId: input.organisationId, teams: input.serviceLineIds },
    });
    // Cognito last: if it fails, the database insert rolls back too.
    try {
      await cognito.invite({ email: input.email, fullName: input.fullName });
    } catch (err) {
      if (err.name !== 'UsernameExistsException') throw err;
      alreadyHadLogin = true; // they registered themselves before; the account links at their next sign-in
    }
    return ins.insertId;
  });

  log('info', 'user invited', { userId: id, by: admin.id, role: input.role });
  return json(201, {
    id,
    message: alreadyHadLogin
      ? `${input.fullName} already had a login. Their access is set up and applies the next time they sign in.`
      : `Invitation sent to ${input.email}. The temporary password is valid for 7 days.`,
  });
}

async function editUser(event, admin, id) {
  const input = editSchema.parse(parseBody(event));
  const before = await loadUser(id);
  await assertCanManage(admin, before);

  const role = input.role ?? before.role;
  const organisationId = input.organisationId ?? before.organisation_id;
  if (admin.id === id && (role !== before.role || organisationId !== before.organisation_id)) {
    throw new HttpError(403, 'You cannot change your own role or organisation. Ask another superuser.');
  }
  if (role !== before.role || organisationId !== before.organisation_id) await assertRoleAllowed(admin, role, organisationId);

  await withTransaction(async (conn) => {
    await conn.q('UPDATE users SET full_name = ?, phone = ?, organisation_id = ?, role = ?, notify_mode = ? WHERE id = ?', [
      input.fullName ?? before.full_name,
      input.phone === undefined ? before.phone : input.phone,
      organisationId,
      role,
      input.notifyMode ?? before.notify_mode,
      id,
    ]);
    if (input.serviceLineIds) await setScopes(conn, id, input.serviceLineIds);
  });
  const after = await loadUser(id);
  await audit.record(null, event, admin, { action: 'user.update', entity: 'user', entityId: id, before: snapshot(before), after: snapshot(after) });
  if (input.fullName && input.fullName !== before.full_name) await cognito.updateName(username(before), input.fullName).catch(() => {});
  return json(200, { user: view(after) });
}

async function setStatus(event, admin, id, action) {
  const target = await loadUser(id);
  await assertCanManage(admin, target);
  let message;
  const result = {};

  switch (action) {
    case 'suspend':
      notSelf(admin, target, 'suspend');
      if (target.status === 'suspended' || target.status === 'disabled') throw new HttpError(409, 'Their access is already switched off.');
      await cognito.disable(username(target));
      await query("UPDATE users SET status = 'suspended' WHERE id = ?", [id]);
      message = `${target.full_name} can no longer sign in. You can reactivate them at any time.`;
      break;

    case 'reactivate':
      if (target.status !== 'suspended' && target.status !== 'disabled') throw new HttpError(409, 'Their access is not switched off.');
      await cognito.enable(username(target));
      await query('UPDATE users SET status = ? WHERE id = ?', [target.cognito_sub ? 'active' : 'invited', id]);
      message = `${target.full_name} can sign in again.${target.status === 'disabled' ? ' Their teams were removed when they left: add them back if needed.' : ''}`;
      break;

    case 'offboard': {
      notSelf(admin, target, 'offboard');
      if (target.status === 'disabled') throw new HttpError(409, 'This person has already been offboarded.');
      await cognito.disable(username(target));
      await withTransaction(async (conn) => {
        await conn.q("UPDATE users SET status = 'disabled' WHERE id = ?", [id]);
        await conn.q('DELETE FROM user_scopes WHERE user_id = ?', [id]);
        const open = await conn.q(`SELECT id FROM tickets WHERE assignee_id = ? AND status IN (${OPEN.map(() => '?').join(',')})`, [id, ...OPEN]);
        for (const t of open) {
          await conn.q("UPDATE tickets SET assignee_id = NULL, status = IF(status = 'assigned', 'triaged', status) WHERE id = ?", [t.id]);
          await conn.q("INSERT INTO ticket_events (ticket_id, actor_id, type, body, data, is_internal) VALUES (?, ?, 'assigned', ?, ?, TRUE)", [
            t.id,
            admin.id,
            `Unassigned: ${target.full_name} has left. Please reassign.`,
            JSON.stringify({ assigneeId: null, reason: 'offboarded' }),
          ]);
        }
        result.unassigned = open.length;
      });
      const routing = await query(
        `SELECT DISTINCT c.label FROM routing_recipients r
           JOIN routing_rules rr ON rr.id = r.routing_rule_id AND (rr.effective_to IS NULL OR rr.effective_to >= CURRENT_DATE)
           JOIN categories c ON c.id = rr.category_id
          WHERE r.user_id = ? OR r.email = ?`,
        [id, target.email],
      );
      result.routingCategories = routing.map((r) => r.label);
      message =
        `${target.full_name} has been offboarded and signed out everywhere.` +
        (result.unassigned ? ` ${result.unassigned} open request${result.unassigned === 1 ? ' was' : 's were'} unassigned.` : '') +
        (routing.length ? ` They still receive emails for ${routing.length} categor${routing.length === 1 ? 'y' : 'ies'}: update Routing.` : '');
      break;
    }

    case 'reset-mfa':
      if (!target.cognito_sub) throw new HttpError(409, 'They have not signed in yet, so there is nothing to reset.');
      await cognito.resetMfa(username(target));
      message = `Two-step verification reset. ${target.full_name} will set it up again at their next sign-in.`;
      break;

    case 'resend-invite':
      if (target.status !== 'invited') throw new HttpError(409, 'They have already signed in. Use "Reset two-step verification" or ask them to use "Forgot password".');
      try {
        await cognito.resendInvite({ email: target.email });
      } catch (err) {
        if (err.name === 'UnsupportedUserStateException') throw new HttpError(409, 'They have already set their password. Ask them to use "Forgot password".');
        if (err.name === 'UserNotFoundException') {
          await cognito.invite({ email: target.email, fullName: target.full_name });
        } else throw err;
      }
      await query('UPDATE users SET invited_at = CURRENT_TIMESTAMP(3), invited_by = ? WHERE id = ?', [admin.id, id]);
      message = `A new invitation has been sent to ${target.email}.`;
      break;

    default:
      throw new HttpError(404, 'Not found.');
  }

  const after = await loadUser(id);
  await audit.record(null, event, admin, { action: `user.${action}`, entity: 'user', entityId: id, before: snapshot(target), after: { ...snapshot(after), ...result } });
  log('info', `user ${action}`, { userId: id, by: admin.id });
  return json(200, { user: view(after), message, ...result });
}

// ------------------------------------------------------------------ routing
async function listRouting() {
  const rules = await query(
    `SELECT c.id AS categoryId, c.label AS category, rr.id AS ruleId, rr.site_id AS siteId, s.name AS site,
            rr.service_line_id AS serviceLineId, sl.name AS serviceLine, sl.is_evolution_linked AS isEvolutionLinked,
            rr.effective_from AS effectiveFrom, rr.notes
       FROM categories c
       LEFT JOIN routing_rules rr ON rr.category_id = c.id AND rr.effective_from <= CURRENT_DATE
                                 AND (rr.effective_to IS NULL OR rr.effective_to >= CURRENT_DATE)
       LEFT JOIN service_lines sl ON sl.id = rr.service_line_id
       LEFT JOIN sites s ON s.id = rr.site_id
      WHERE c.active = TRUE
      ORDER BY c.label, rr.site_id IS NOT NULL, s.sort_order`,
  );
  const ids = rules.filter((r) => r.ruleId).map((r) => r.ruleId);
  const recipients = ids.length
    ? await query(
        `SELECT r.routing_rule_id AS ruleId, COALESCE(u.email, r.email) AS email, r.kind, u.full_name AS name, u.status AS userStatus
           FROM routing_recipients r LEFT JOIN users u ON u.id = r.user_id
          WHERE r.routing_rule_id IN (${ids.map(() => '?').join(',')})
          ORDER BY r.kind DESC, r.id`,
        ids,
      )
    : [];
  return json(200, {
    rules: rules.map((r) => ({
      ...r,
      isEvolutionLinked: Boolean(r.isEvolutionLinked),
      recipients: recipients
        .filter((x) => x.ruleId === r.ruleId)
        .map(({ email, kind, name, userStatus }) => ({ email, kind, name, inactive: Boolean(userStatus) && !['active', 'invited'].includes(userStatus) })),
    })),
  });
}

async function insertRecipients(conn, ruleId, recipients) {
  const seen = new Set();
  for (const r of recipients) {
    if (seen.has(r.email)) continue;
    seen.add(r.email);
    const u = (await conn.q('SELECT id FROM users WHERE email = ?', [r.email]))[0];
    // Linked to the person when they have an account, so offboarding them stops their emails.
    await conn.q('INSERT INTO routing_recipients (routing_rule_id, user_id, email, kind) VALUES (?, ?, ?, ?)', [ruleId, u ? u.id : null, r.email, r.kind]);
  }
}

async function ruleSnapshot(conn, ruleId) {
  const rule = (await conn.q('SELECT category_id, site_id, service_line_id, effective_from, effective_to, notes FROM routing_rules WHERE id = ?', [ruleId]))[0];
  const recipients = await conn.q('SELECT email, kind FROM routing_recipients WHERE routing_rule_id = ? ORDER BY id', [ruleId]);
  return { ...rule, recipients };
}

async function createRule(event, admin) {
  const input = newRuleSchema.parse(parseBody(event));
  const id = await withTransaction(async (conn) => {
    const clash = await conn.q(
      `SELECT id FROM routing_rules WHERE category_id = ? AND site_id <=> ? AND effective_from <= CURRENT_DATE
          AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)`,
      [input.categoryId, input.siteId],
    );
    if (clash.length) throw new HttpError(409, 'That category already has a rule. Edit it instead.');
    const ins = await conn.q('INSERT INTO routing_rules (category_id, service_line_id, site_id, effective_from, notes) VALUES (?, ?, ?, CURRENT_DATE, ?)', [
      input.categoryId,
      input.serviceLineId,
      input.siteId,
      input.notes,
    ]);
    await insertRecipients(conn, ins.insertId, input.recipients);
    await audit.record(conn, event, admin, { action: 'routing.create', entity: 'routing_rule', entityId: ins.insertId, after: await ruleSnapshot(conn, ins.insertId) });
    return ins.insertId;
  });
  return json(201, { id });
}

async function updateRule(event, admin, ruleId) {
  const input = ruleSchema.parse(parseBody(event));
  const result = await withTransaction(async (conn) => {
    const rule = (
      await conn.q(
        `SELECT id, category_id, site_id, effective_from = CURRENT_DATE AS fromToday FROM routing_rules
          WHERE id = ? AND effective_from <= CURRENT_DATE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE) FOR UPDATE`,
        [ruleId],
      )
    )[0];
    if (!rule) throw new HttpError(404, 'That routing rule is no longer current. Refresh the page.');
    const before = await ruleSnapshot(conn, ruleId);
    let id = ruleId;
    if (rule.fromToday) {
      // Made today: change it in place.
      await conn.q('UPDATE routing_rules SET service_line_id = ?, notes = ? WHERE id = ?', [input.serviceLineId, input.notes, ruleId]);
      await conn.q('DELETE FROM routing_recipients WHERE routing_rule_id = ?', [ruleId]);
    } else {
      // Older: end it yesterday and start a new one today, so reports show who handled what, when.
      await conn.q('UPDATE routing_rules SET effective_to = DATE_SUB(CURRENT_DATE, INTERVAL 1 DAY) WHERE id = ?', [ruleId]);
      const ins = await conn.q('INSERT INTO routing_rules (category_id, service_line_id, site_id, effective_from, notes) VALUES (?, ?, ?, CURRENT_DATE, ?)', [
        rule.category_id,
        input.serviceLineId,
        rule.site_id,
        input.notes,
      ]);
      id = ins.insertId;
    }
    await insertRecipients(conn, id, input.recipients);
    await audit.record(conn, event, admin, { action: 'routing.update', entity: 'routing_rule', entityId: id, before: { ruleId, ...before }, after: await ruleSnapshot(conn, id) });
    return { id };
  });
  return json(200, result);
}

// ------------------------------------------------------------------ announcements
async function listAnnouncements() {
  const rows = await query(
    `SELECT a.id, a.message, a.site_id AS siteId, s.name AS site, a.building_id AS buildingId, b.name AS building,
            a.starts_at AS startsAt, a.ends_at AS endsAt, u.full_name AS createdBy, a.created_at AS createdAt,
            (a.starts_at <= CURRENT_TIMESTAMP(3) AND (a.ends_at IS NULL OR a.ends_at > CURRENT_TIMESTAMP(3))) AS live
       FROM announcements a
       LEFT JOIN sites s ON s.id = a.site_id
       LEFT JOIN buildings b ON b.id = a.building_id
       LEFT JOIN users u ON u.id = a.created_by
      WHERE a.ends_at IS NULL OR a.ends_at > DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 90 DAY)
      ORDER BY live DESC, a.starts_at DESC`,
  );
  return json(200, { announcements: rows.map((r) => ({ ...r, live: Boolean(r.live) })) });
}

function checkDates(a) {
  if (a.endsAt && a.startsAt && a.endsAt <= a.startsAt) throw new HttpError(400, 'The end must be after the start.');
}

async function createAnnouncement(event, admin) {
  const input = announcementSchema.parse(parseBody(event));
  const startsAt = input.startsAt || new Date();
  checkDates({ ...input, startsAt });
  const res = await query('INSERT INTO announcements (site_id, building_id, message, starts_at, ends_at, created_by) VALUES (?, ?, ?, ?, ?, ?)', [
    input.siteId,
    input.buildingId,
    input.message,
    startsAt,
    input.endsAt,
    admin.id,
  ]);
  await audit.record(null, event, admin, { action: 'announcement.create', entity: 'announcement', entityId: res.insertId, after: { ...input, startsAt } });
  return json(201, { id: res.insertId });
}

async function updateAnnouncement(event, admin, id) {
  const before = (await query('SELECT * FROM announcements WHERE id = ?', [id]))[0];
  if (!before) throw new HttpError(404, 'Announcement not found.');
  const input = announcementSchema.parse(parseBody(event));
  const startsAt = input.startsAt || before.starts_at;
  checkDates({ ...input, startsAt });
  await query('UPDATE announcements SET site_id = ?, building_id = ?, message = ?, starts_at = ?, ends_at = ? WHERE id = ?', [
    input.siteId,
    input.buildingId,
    input.message,
    startsAt,
    input.endsAt,
    id,
  ]);
  await audit.record(null, event, admin, { action: 'announcement.update', entity: 'announcement', entityId: id, before, after: { ...input, startsAt } });
  return json(200, { id });
}

async function deleteAnnouncement(event, admin, id) {
  const before = (await query('SELECT * FROM announcements WHERE id = ?', [id]))[0];
  if (!before) throw new HttpError(404, 'Announcement not found.');
  await query('DELETE FROM announcements WHERE id = ?', [id]);
  await audit.record(null, event, admin, { action: 'announcement.delete', entity: 'announcement', entityId: id, before });
  return json(200, { id });
}

// ------------------------------------------------------------------ audit
async function listAudit(event) {
  const q = z
    .object({
      entity: z.enum(['user', 'routing_rule', 'announcement']).optional(),
      entityId: z.string().max(40).optional(),
      before: z.coerce.number().int().positive().optional(),
    })
    .parse(event.queryStringParameters || {});
  const where = ['1 = 1'];
  const params = [];
  if (q.entity) {
    where.push('a.entity = ?');
    params.push(q.entity);
  }
  if (q.entityId) {
    where.push('a.entity_id = ?');
    params.push(q.entityId);
  }
  if (q.before) {
    where.push('a.id < ?');
    params.push(q.before);
  }
  const rows = await query(
    `SELECT a.id, a.action, a.entity, a.entity_id AS entityId, a.before_data AS beforeData, a.after_data AS afterData,
            a.ip, a.created_at AS createdAt, u.full_name AS actorName,
            CASE a.entity WHEN 'user' THEN (SELECT full_name FROM users WHERE id = a.entity_id)
                          WHEN 'routing_rule' THEN (SELECT c.label FROM routing_rules r JOIN categories c ON c.id = r.category_id WHERE r.id = a.entity_id)
                          ELSE NULL END AS subject
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
      WHERE ${where.join(' AND ')}
      ORDER BY a.id DESC
      LIMIT 51`,
    params,
  );
  return json(200, { entries: rows.slice(0, 50), next: rows.length > 50 ? rows[49].id : null });
}

// ------------------------------------------------------------------ router
const idOf = (s) => {
  const n = Number(s);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, 'Not found.');
  return n;
};

exports.handler = wrap(async (event) => {
  const admin = await resolveUser(event);
  if (!ADMIN_ROLES.includes(admin.role)) throw new HttpError(403, 'The admin console is for RMG and Vertex superusers.');

  const method = event.requestContext?.http?.method || 'GET';
  const parts = String(event.pathParameters?.proxy || '').split('/').filter(Boolean);
  const [a, b, c] = parts;

  if (a === 'options' && method === 'GET') return options(admin);

  if (a === 'users') {
    if (!b && method === 'GET') return listUsers(event);
    if (!b && method === 'POST') return inviteUser(event, admin);
    const id = idOf(b);
    if (!c && method === 'GET') return getUser(id);
    if (!c && method === 'PATCH') return editUser(event, admin, id);
    if (c && method === 'POST' && parts.length === 3) return setStatus(event, admin, id, c);
  }

  if (a === 'routing') {
    if (!b && method === 'GET') return listRouting();
    if (b === 'rules' && !c && method === 'POST') return createRule(event, admin);
    if (b === 'rules' && c && method === 'PUT') return updateRule(event, admin, idOf(c));
  }

  if (a === 'announcements') {
    if (!b && method === 'GET') return listAnnouncements();
    if (!b && method === 'POST') return createAnnouncement(event, admin);
    if (b && method === 'PATCH') return updateAnnouncement(event, admin, idOf(b));
    if (b && method === 'DELETE') return deleteAnnouncement(event, admin, idOf(b));
  }

  if (a === 'audit' && method === 'GET') return listAudit(event);

  throw new HttpError(404, 'Not found.');
});
