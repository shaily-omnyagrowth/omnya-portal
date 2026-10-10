// api/_utils/rateLimit.js
//
// Upstash Redis-backed rate limiter for Vercel serverless functions.
//
// Usage:
//   const { applyRateLimit } = require('../_utils/rateLimit');
//   const blocked = await applyRateLimit(req, res, { max: 10, windowSecs: 60 });
//   if (blocked) return; // 429 (or 503) already sent
//
// Uses the Upstash REST API directly — no SDK required.
//
// FIXED WINDOW, not sliding: the first hit opens a window of `windowSecs` and
// every hit in it counts against `max`. One pipeline request does
//
//   SET key 0 EX <window> NX     open the window, with its expiry, if absent
//   INCR key                     count this hit (INCR keeps the TTL)
//
// so the expiry is set in the same round trip as the count. The old version
// sent EXPIRE as a separate fire-and-forget call after INCR; when that call
// was lost the key never expired and the caller stayed locked out forever
// (spec 0001, AC-12). `EXPIRE … NX` would also work but needs Redis 7.
//
// WHEN UPSTASH IS UNAVAILABLE (env unset, non 2xx, an error element in the
// pipeline response, network error, 2 s timeout):
//   * routes that pass `failClosed: true` answer 503 in production
//     (VERCEL_ENV=production), so payouts, withdrawals, user admin and email
//     cannot be hammered while the limiter is down (spec 0001, AC-11);
//   * every other route, and every route on preview and local, is let
//     through with a warning, as before.
// On a failClosed route, call this BEFORE the auth guard, so the 503 never
// depends on who is calling.

const TIMEOUT_MS = 2000;

let _warnedMissingEnv = false;

/**
 * Apply fixed-window rate limiting.
 *
 * @param {object} req
 * @param {object} res
 * @param {object} opts
 * @param {number} [opts.max=20]           - Max requests per window
 * @param {number} [opts.windowSecs=60]    - Window size in seconds
 * @param {string} [opts.endpoint]         - Optional label for key namespacing
 * @param {string} [opts.userId]           - Optional authenticated user id
 * @param {boolean} [opts.failClosed=false] - 503 in production when the limiter is unavailable
 * @returns {Promise<boolean>} true = blocked (429/503 already sent), false = allowed
 */
async function applyRateLimit(req, res, opts = {}) {
  const { max = 20, windowSecs = 60, endpoint = 'default', userId, failClosed = false } = opts;

  const enforce = failClosed === true && process.env.VERCEL_ENV === 'production';

  // Every "the limiter could not decide" path goes through here.
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

  const restUrl   = process.env.UPSTASH_REDIS_REST_URL;
  const restToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!restUrl || !restToken) {
    if (enforce) return unavailable('UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set');
    if (!_warnedMissingEnv) {
      _warnedMissingEnv = true;
      console.warn(
        '[rateLimit] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set — ' +
        'rate limiting disabled for this environment.'
      );
    }
    return false;
  }

  // Build a composite key: endpoint + user id (if authed) + IP
  const ip =
    ((req.headers['x-forwarded-for'] || '').split(',')[0] || '').trim() ||
    (req.socket && req.socket.remoteAddress) ||
    'unknown';

  const keyParts = ['rl', endpoint];
  if (userId) keyParts.push(`u:${userId}`);
  keyParts.push(`ip:${ip}`);
  const key = keyParts.join(':');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let count;
  try {
    const resp = await fetch(`${restUrl.replace(/\/+$/, '')}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${restToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        ['SET', key, '0', 'EX', String(windowSecs), 'NX'],
        ['INCR', key],
      ]),
      signal: controller.signal,
    });

    if (!resp.ok) return unavailable(`Upstash pipeline answered HTTP ${resp.status}`);

    // Upstash answers 200 with one { result } or { error } per command. A 200
    // is not success on its own: check every element.
    const body = await resp.json();
    if (!Array.isArray(body) || body.length !== 2) {
      return unavailable('Upstash pipeline response was not a two element array');
    }
    const failed = body.find((el) => !el || typeof el !== 'object' || el.error);
    if (failed) {
      return unavailable(`Upstash pipeline command failed: ${(failed && failed.error) || 'malformed element'}`);
    }

    count = Number(body[1].result);
    if (!Number.isFinite(count)) return unavailable('Upstash INCR returned a non numeric count');
  } catch (err) {
    return unavailable(
      err && err.name === 'AbortError'
        ? `Upstash did not answer within ${TIMEOUT_MS} ms`
        : `Upstash request failed: ${err && err.message}`
    );
  } finally {
    clearTimeout(timer);
  }

  if (count > max) {
    res.setHeader('Retry-After', String(windowSecs));
    res.status(429).json({
      error: 'Too many requests. Please try again later.',
      retryAfterSeconds: windowSecs,
    });
    return true; // blocked
  }

  return false; // allowed
}

module.exports = { applyRateLimit };
