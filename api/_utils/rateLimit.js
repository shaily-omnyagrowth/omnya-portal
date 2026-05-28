// api/_utils/rateLimit.js
//
// Upstash Redis-backed rate limiter for Vercel serverless functions.
//
// Usage:
//   const { applyRateLimit } = require('../_utils/rateLimit');
//   const blocked = await applyRateLimit(req, res, { max: 10, windowSecs: 60 });
//   if (blocked) return; // 429 already sent
//
// Gracefully degrades to no-op when UPSTASH env vars are absent (local dev).
// Uses the Upstash REST API directly — no SDK required.

let _warnedOnce = false;

function _warnOnce(msg) {
  if (!_warnedOnce) {
    console.warn(msg);
    _warnedOnce = true;
  }
}

/**
 * Apply sliding-window rate limiting.
 *
 * @param {object} req
 * @param {object} res
 * @param {object} opts
 * @param {number} [opts.max=20]         - Max requests per window
 * @param {number} [opts.windowSecs=60]  - Window size in seconds
 * @param {string} [opts.endpoint]       - Optional label for key namespacing
 * @param {string} [opts.userId]         - Optional authenticated user id
 * @returns {Promise<boolean>} true = blocked (429 already sent), false = allowed
 */
async function applyRateLimit(req, res, opts = {}) {
  const { max = 20, windowSecs = 60, endpoint = 'default', userId } = opts;

  const restUrl   = process.env.UPSTASH_REDIS_REST_URL;
  const restToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!restUrl || !restToken) {
    _warnOnce(
      '[rateLimit] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set — ' +
      'rate limiting disabled for this environment.'
    );
    return false; // fail open
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

  try {
    // INCR increments and returns the new count atomically.
    const incrResp = await fetch(`${restUrl}/incr/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${restToken}` },
    });

    if (!incrResp.ok) {
      console.warn(`[rateLimit] Upstash INCR failed (${incrResp.status}) — failing open`);
      return false;
    }

    const { result: count } = await incrResp.json();

    // Set TTL only on the first hit so the window auto-resets.
    if (count === 1) {
      // Fire-and-forget — failure here only means the key never expires,
      // which is a minor over-restriction, not a security issue.
      fetch(`${restUrl}/expire/${encodeURIComponent(key)}/${windowSecs}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${restToken}` },
      }).catch(() => {});
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
  } catch (err) {
    console.warn('[rateLimit] Unexpected Redis error — failing open:', err.message);
    return false;
  }
}

module.exports = { applyRateLimit };
