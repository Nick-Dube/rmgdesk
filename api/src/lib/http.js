'use strict';
const { ZodError } = require('zod');

class HttpError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'The request body is not valid JSON.');
  }
}

/** Wrap a handler: turns thrown HttpErrors and validation errors into clean JSON responses. */
function wrap(fn) {
  return async (event, context) => {
    try {
      return await fn(event, context);
    } catch (err) {
      if (err instanceof HttpError) {
        return json(err.statusCode, { error: err.message, details: err.details });
      }
      if (err instanceof ZodError) {
        return json(400, {
          error: 'Some fields need attention.',
          details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
        });
      }
      console.error(JSON.stringify({ level: 'error', message: err.message, stack: err.stack, routeKey: event.routeKey }));
      return json(500, { error: 'Something went wrong. Please try again, or call the helpdesk on 0208 312 6708.' });
    }
  };
}

module.exports = { HttpError, json, parseBody, wrap };
