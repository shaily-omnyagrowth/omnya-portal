// api/admin/config-test.js
//
// POST /api/admin/config-test
//
// The "Test connections" button on System Config (spec 0001, AC-10).
// config-status can only say a key is well formed; this proves it works, with
// one read only call per provider, all in parallel, 5 s each:
//
//   upstash        PING
//   stripe         GET /v1/balance  (proves the key, and that it is accepted)
//   resend         GET /domains
//   resend_domain  the domain of RESEND_FROM_EMAIL is in that list as verified
//
// Each result is ok, restricted_key (the provider accepted the key but it may
// not do this read: a Stripe restricted key without balance access, a Resend
// sending only key), or failed, with the provider's error code or HTTP status.
//
// SECRET SAFETY: no provider message is passed through. Stripe's "Invalid API
// Key provided: sk_live_****abcd" carries the last four characters of the key,
// so only codes and statuses leave this function.
//
// POST, not GET, so a prefetch or a crawler never fires provider calls.
// Rate limited before auth and fail closed in production (5 per 60 s).
//
// Auth: owner only.

const { applyCors } = require('../_utils/cors');
const { Errors, sendOk } = require('../_utils/errors');
const { applyRateLimit } = require('../_utils/rateLimit');
const { requireOwner } = require('../_lib/adminGuard');

const TIMEOUT_MS = 5000;

async function timedFetch(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    let body = null;
    try { body = await resp.json(); } catch { /* not JSON */ }
    return { resp, body, ms: Date.now() - started };
  } catch (err) {
    return { error: err && err.name === 'AbortError' ? 'timeout' : 'network_error', ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

const env = (name) => {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : null;
};

const notConfigured = (provider) => ({ provider, result: 'failed', code: 'not_configured', ms: 0 });

async function testUpstash() {
  const url = env('UPSTASH_REDIS_REST_URL');
  const token = env('UPSTASH_REDIS_REST_TOKEN');
  if (!url || !token) return notConfigured('upstash');
  const r = await timedFetch(`${url.replace(/\/+$/, '')}/ping`, { headers: { Authorization: `Bearer ${token}` } });
  if (r.error) return { provider: 'upstash', result: 'failed', code: r.error, ms: r.ms };
  if (r.resp.ok && r.body && r.body.result === 'PONG') return { provider: 'upstash', result: 'ok', code: null, ms: r.ms };
  return { provider: 'upstash', result: 'failed', code: `http_${r.resp.status}`, ms: r.ms };
}

async function testStripe() {
  const key = env('STRIPE_SECRET_KEY');
  if (!key) return notConfigured('stripe');
  const r = await timedFetch('https://api.stripe.com/v1/balance', { headers: { Authorization: `Bearer ${key}` } });
  if (r.error) return { provider: 'stripe', result: 'failed', code: r.error, ms: r.ms };
  if (r.resp.ok) return { provider: 'stripe', result: 'ok', code: null, ms: r.ms };
  const code = (r.body && r.body.error && r.body.error.code) || `http_${r.resp.status}`;
  // 403: the key is real but restricted away from balance reads.
  return { provider: 'stripe', result: r.resp.status === 403 ? 'restricted_key' : 'failed', code, ms: r.ms };
}

// Returns the domains call result plus the parsed list for the domain check.
async function testResend() {
  const key = env('RESEND_API_KEY');
  if (!key) return { result: notConfigured('resend'), domains: null };
  const r = await timedFetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${key}` } });
  if (r.error) return { result: { provider: 'resend', result: 'failed', code: r.error, ms: r.ms }, domains: null };
  if (r.resp.ok) {
    const list = (r.body && Array.isArray(r.body.data)) ? r.body.data : [];
    return { result: { provider: 'resend', result: 'ok', code: null, ms: r.ms }, domains: list };
  }
  const name = r.body && r.body.name;
  const restricted = (r.resp.status === 401 || r.resp.status === 403) && name === 'restricted_api_key';
  return {
    result: { provider: 'resend', result: restricted ? 'restricted_key' : 'failed', code: name || `http_${r.resp.status}`, ms: r.ms },
    domains: null,
  };
}

function senderDomain() {
  const from = env('RESEND_FROM_EMAIL');
  if (!from) return null;
  const named = from.match(/<([^<>]+)>/);
  const addr = (named ? named[1] : from).trim();
  const at = addr.lastIndexOf('@');
  return at > 0 ? addr.slice(at + 1).toLowerCase() : null;
}

function checkSenderDomain(resend) {
  const domain = senderDomain();
  if (!domain) return { provider: 'resend_domain', result: 'failed', code: 'from_address_not_configured', ms: 0 };
  if (!resend.domains) {
    // Could not list domains, so the check cannot run; say why in the same terms.
    return { provider: 'resend_domain', result: resend.result.result === 'restricted_key' ? 'restricted_key' : 'failed',
      code: resend.result.code, ms: 0 };
  }
  const match = resend.domains.find((d) => String(d.name || '').toLowerCase() === domain);
  if (!match) return { provider: 'resend_domain', result: 'failed', code: 'domain_not_found', ms: 0 };
  if (match.status !== 'verified') return { provider: 'resend_domain', result: 'failed', code: `domain_${match.status || 'unknown'}`, ms: 0 };
  return { provider: 'resend_domain', result: 'ok', code: null, ms: 0 };
}

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  const blocked = await applyRateLimit(req, res, {
    failClosed: true,
    max: 5,
    windowSecs: 60,
    endpoint: 'admin-config-test',
  });
  if (blocked) return;

  const authCtx = await requireOwner(req, res);
  if (!authCtx) return;

  const [upstash, stripe, resend] = await Promise.all([testUpstash(), testStripe(), testResend()]);

  return sendOk(res, {
    results: [upstash, stripe, resend.result, checkSenderDomain(resend)],
    checkedAt: new Date().toISOString(),
  });
};

// Exported for tests/config-rules.test.cjs.
module.exports.senderDomain = senderDomain;
