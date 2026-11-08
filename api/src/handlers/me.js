'use strict';
// GET /me - the signed-in user's profile and permissions. Also links or creates the user on first sign-in.

const { wrap, json } = require('../lib/http');
const { query } = require('../lib/db');
const { resolveUser, publicProfile } = require('../lib/users');

exports.handler = wrap(async (event) => {
  const user = await resolveUser(event);
  const org = (await query('SELECT code, name FROM organisations WHERE id = ?', [user.organisation_id]))[0];
  return json(200, { user: { ...publicProfile(user), organisation: org } });
});
