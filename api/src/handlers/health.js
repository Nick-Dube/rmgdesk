'use strict';
// Unauthenticated liveness check: GET /health

exports.handler = async () => ({
  statusCode: 200,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ ok: true, service: 'rmgdesk-api', env: process.env.ENV_NAME, time: new Date().toISOString() }),
});
