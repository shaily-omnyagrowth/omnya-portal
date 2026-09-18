// api/_utils/errors.js
//
// Unified JSON response shape so the frontend can handle errors consistently.
//
//   Success: { ok: true, data?: ... }
//   Failure: { ok: false, error: { code, message, details? } }

function sendJson(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(body));
}

function sendOk(res, data, status = 200) {
  sendJson(res, status, { ok: true, data });
}

function sendError(res, status, code, message, details) {
  const body = { ok: false, error: { code, message } };
  if (details !== undefined) body.error.details = details;
  sendJson(res, status, body);
}

// PostgREST answers one of these when a query names a column that does not
// exist in the database:
//
//   42703     Postgres "undefined column"            -- a SELECT list or filter
//   PGRST204  "column not found in schema cache"      -- an INSERT / UPDATE payload
//
// Either one means a migration in supabase/migrations has not been applied to
// this database. That is a deploy-ordering problem, not a bug in the request,
// and the handler should say so rather than reporting a generic failure.
// src/App.js does the same mapping for browser-side writes (describeWriteError).
const SCHEMA_MISSING_CODES = new Set(['42703', 'PGRST204']);

function isSchemaMissing(err) {
  return Boolean(err) && SCHEMA_MISSING_CODES.has(String(err.code));
}

// Common error shorthands
const Errors = {
  unauthorized: (res, msg = 'Authentication required') =>
    sendError(res, 401, 'unauthorized', msg),
  forbidden: (res, msg = 'Not allowed') =>
    sendError(res, 403, 'forbidden', msg),
  badRequest: (res, msg, details) =>
    sendError(res, 400, 'bad_request', msg, details),
  notFound: (res, msg = 'Not found') =>
    sendError(res, 404, 'not_found', msg),
  methodNotAllowed: (res, msg = 'Method not allowed') =>
    sendError(res, 405, 'method_not_allowed', msg),
  rateLimited: (res, msg = 'Too many requests') =>
    sendError(res, 429, 'rate_limited', msg),
  internal: (res, msg = 'Internal server error', details) =>
    sendError(res, 500, 'internal', msg, details),
  // `migration` is the file name under supabase/migrations; `what` is a short
  // phrase for the missing objects, e.g. "the campaign share columns".
  schemaMissing: (res, migration, what = 'a column this action needs') =>
    sendError(res, 500, 'schema_missing',
      `The database is missing ${what}. Apply supabase/migrations/${migration}, then retry.`),
};

module.exports = { sendJson, sendOk, sendError, Errors, isSchemaMissing };
