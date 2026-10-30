// api/_utils/rateLimit.js
//
// Fixed-window rate limiter backed by Postgres (public.rate_limit_hit).
//
// Usage:
//   const { applyRateLimit } = require('../_utils/rateLimit');
//   const blocked = await applyRateLimit(req, res, { max: 10, windowSecs: 60 });
//   if (blocked) return; // 429 (or 503) already sent
//
// When the limiter can't answer (error, missing function, 2 s timeout):
//   * routes with `failClosed: true` answer 503 in production (spec 0001, AC-11);
//   * every other route, and every route on preview and local, is let through.
// On a failClosed route, call this BEFORE the auth guard.
//
// Signed-in callers are counted per session (bearer token hash), anonymous callers per IP.

const crypto = require('crypto');
const { getSupabaseAdminClient } = require('./supabaseAdmin');

const TIMEOUT_MS = 2000;

/**
 * @param {object} req
 * @param {object} res
 * @param {object} opts
 * @param {number} [opts.max=20]           - Max requests per window
 * @param {number} [opts.windowSecs=60]    - Window size in seconds
 * @param {string} [opts.endpoint]         - Label for key namespacing
 * @param {string} [opts.userId]           - Optional authenticated user id
 * @param {boolean} [opts.failClosed=false] - 503 in production when the limiter is unavailable
 * @returns {Promise<boolean>} true = blocked (429/503 already sent), false = allowed
 */
async function applyRateLimit(req, res, opts = {}) {
  const { max = 20, windowSecs = 60, endpoint = 'default', userId, failClosed = false } = opts;

  const enforce = failClosed === true && process.env.VERCEL_ENV === 'production';

  const unavailable = (why) => {
    if (enforce) {
      console.error(`[rateLimit] ${endpoint}: ${why} — failing CLOSED (503)`);
      res.status(503).json({
        error: 'Rate limiting is unavailable. Please try again shortly.',
        code: 'rate_limit_unavailable',
      });
      return true;
    }
    console.warn(`[rateLimit] ${endpoint}: ${why} — failing open`);
    return false;
  };

  const ip =
    ((req.headers['x-forwarded-for'] || '').split(',')[0] || '').trim() ||
    (req.socket && req.socket.remoteAddress) ||
    'unknown';

  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const keyParts = ['rl', endpoint];
  if (userId) keyParts.push(`u:${userId}`);
  keyParts.push(bearer ? `t:${crypto.createHash('sha256').update(bearer).digest('hex').slice(0, 32)}` : `ip:${ip}`);
  const key = keyParts.join(':');

  let timer;
  let count;
  try {
    const hit = getSupabaseAdminClient().rpc('rate_limit_hit', { p_key: key, p_window_secs: windowSecs });
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ timedOut: true }), TIMEOUT_MS); });
    const { data, error, timedOut } = await Promise.race([hit, timeout]);
    if (timedOut) return unavailable(`rate_limit_hit did not answer within ${TIMEOUT_MS} ms`);
    if (error) return unavailable(`rate_limit_hit failed: ${error.message}`);
    if (typeof data !== 'number') return unavailable('rate_limit_hit returned a non numeric count');
    count = data;
  } catch (err) {
    return unavailable(`rate_limit_hit threw: ${err && err.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (count > max) {
    res.setHeader('Retry-After', String(windowSecs));
    res.status(429).json({
      error: 'Too many requests. Please try again later.',
      retryAfterSeconds: windowSecs,
    });
    return true;
  }

  return false;
}

module.exports = { applyRateLimit };
