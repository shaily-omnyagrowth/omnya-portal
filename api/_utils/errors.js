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
};

module.exports = { sendJson, sendOk, sendError, Errors };
