// tests/rate-limit.test.cjs
//
// api/_utils/rateLimit.js, offline (spec 0001):
//
//   AC-12  one pipeline request: SET key 0 EX <window> NX, then INCR; every
//          element of the response checked; the window always expires
//   AC-11  failClosed routes answer 503 rate_limit_unavailable in production
//          when Upstash is unset, erroring, slow or unreachable, before auth;
//          other routes, and every route on preview, are let through
//
// Plus the rollout itself: every route the spec lists passes failClosed: true
// and calls the limiter before its auth guard, and the routes that must stay
// open do not.
//
//   node tests/rate-limit.test.cjs

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const API = path.join(ROOT, 'api');

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};

// Quiet the limiter's own warnings; the assertions say what matters.
console.warn = () => {};
console.error = () => {};

const FAIL_CLOSED = [
  'send-email.js', 'admin/users/create.js', 'admin/users/deactivate.js', 'admin/users/restore.js',
  'admin/users/role.js', 'payment-managers/grant.js', 'payment-managers/revoke.js', 'payments/void.js',
  'payouts/create-batch.js', 'payouts/export.js', 'payouts/generate.js', 'payouts/mark-paid.js',
  'payouts/reconcile.js', 'payouts/stripe-transfer.js', 'withdrawals/request.js', 'withdrawals/approve.js',
  'withdrawals/reject.js', 'creators/payment-method.js', 'stripe/connect-url.js', 'admin/config-test.js',
];
const STAY_OPEN = [
  'admin/audit.js', 'admin/config-status.js', 'admin/users/index.js', 'analytics/manual-sync.js',
  'creator/view-count.js', 'earnings/recalculate.js', 'earnings/summary.js', 'withdrawals/index.js',
  'integrations/tiktok/sync.js',
];

function fakeRes() {
  const out = { code: null, body: null, headers: {} };
  const res = {
    setHeader: (k, v) => { out.headers[String(k).toLowerCase()] = v; return res; },
    status: (c) => { out.code = c; return res; },
    json: (b) => { out.body = b; return res; },
    send: (b) => { out.body = typeof b === 'string' ? JSON.parse(b) : b; return res; },
    end: () => res,
  };
  return { res, out };
}
const req = (over = {}) => ({ method: 'POST', headers: { 'x-forwarded-for': '203.0.113.7' }, query: {}, body: {}, ...over });

const realFetch = global.fetch;
let fetchImpl = null;
const fetchCalls = [];
global.fetch = (url, init) => { fetchCalls.push({ url: String(url), init }); return fetchImpl(url, init); };
const json = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });

function setEnv(over) {
  for (const k of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'VERCEL_ENV']) delete process.env[k];
  Object.assign(process.env, over);
}
const UPSTASH = { UPSTASH_REDIS_REST_URL: 'https://good-bird-1.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'tok_abcdefghijklmnopqrstuvwxyz' };

const { applyRateLimit } = require(path.join(API, '_utils', 'rateLimit.js'));

async function limit(opts) {
  const { res, out } = fakeRes();
  const blocked = await applyRateLimit(req(), res, { endpoint: 'test', ...opts });
  return { blocked, ...out };
}

(async () => {
  // ------------------------------------------------------------ AC-12
  console.log('\nOne pipeline, window always set (AC-12)');
  setEnv({ ...UPSTASH, VERCEL_ENV: 'production' });
  fetchCalls.length = 0;
  fetchImpl = () => json(200, [{ result: 'OK' }, { result: 1 }]);
  let r = await limit({ max: 3, windowSecs: 60 });
  const call = fetchCalls[0];
  const sent = call && JSON.parse(call.init.body);
  R(fetchCalls.length === 1 && call.url === 'https://good-bird-1.upstash.io/pipeline', 'exactly one request, to /pipeline');
  R(sent && sent.length === 2 && JSON.stringify(sent[0].slice(2)) === JSON.stringify(['0', 'EX', '60', 'NX']) && sent[0][0] === 'SET' &&
    sent[1][0] === 'INCR' && sent[0][1] === sent[1][1], 'SET key 0 EX 60 NX, then INCR the same key', JSON.stringify(sent));
  R(!JSON.stringify(sent).includes('EXPIRE'), 'no EXPIRE … NX (needs Redis 7)');
  R(r.blocked === false, 'count 1 of 3 is allowed');

  fetchImpl = () => json(200, [{ result: null }, { result: 4 }]);
  r = await limit({ max: 3, windowSecs: 60 });
  R(r.blocked && r.code === 429 && r.headers['retry-after'] === '60', 'count 4 of 3: 429 with Retry-After');

  // ------------------------------------------------------------ AC-11 limiter
  console.log('\nUnavailable means 503 in production for failClosed (AC-11)');
  const UNAVAILABLE = [
    ['an {error} element in a 200 response', () => json(200, [{ result: 'OK' }, { error: 'ERR max requests limit exceeded' }])],
    ['a non 2xx answer', () => json(500, { error: 'boom' })],
    ['a network error', () => Promise.reject(new TypeError('fetch failed'))],
    ['a response that is not two elements', () => json(200, { result: 'OK' })],
  ];
  for (const [label, impl] of UNAVAILABLE) {
    fetchImpl = impl;
    const closed = await limit({ failClosed: true });
    const open = await limit({});
    R(closed.blocked && closed.code === 503 && closed.body.code === 'rate_limit_unavailable' && open.blocked === false,
      `${label}: failClosed 503, others pass`);
  }

  fetchImpl = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
  });
  const t0 = Date.now();
  const slow = await limit({ failClosed: true });
  const took = Date.now() - t0;
  R(slow.code === 503 && took >= 1900 && took < 3500, 'a slow Upstash times out at 2 s and fails closed', `${took} ms`);

  setEnv({ VERCEL_ENV: 'production' });
  r = await limit({ failClosed: true });
  R(r.code === 503, 'Upstash env unset in production: failClosed 503');
  r = await limit({});
  R(r.blocked === false, 'Upstash env unset in production: other routes pass');
  setEnv({ VERCEL_ENV: 'preview' });
  r = await limit({ failClosed: true });
  R(r.blocked === false, 'Upstash env unset on preview: failClosed routes pass too');
  setEnv({ ...UPSTASH, VERCEL_ENV: 'preview' });
  fetchImpl = () => json(500, {});
  r = await limit({ failClosed: true });
  R(r.blocked === false, 'Upstash erroring on preview: passes with a warning');

  // ------------------------------------------------------------ AC-11 handlers
  console.log('\nOn real handlers (AC-11)');
  setEnv({ VERCEL_ENV: 'production' });
  const withdraw = require(path.join(API, 'withdrawals', 'request.js'));
  const summary = require(path.join(API, 'earnings', 'summary.js'));
  const run = async (h, method) => { const { res, out } = fakeRes(); await h(req({ method }), res); return out; };
  const methodOf = (file) => (fs.readFileSync(path.join(API, file), 'utf8').match(/req\.method\s*!==\s*'([A-Z]+)'/) || [])[1] || 'POST';
  let w = await run(withdraw, methodOf('withdrawals/request.js'));
  let s = await run(summary, methodOf('earnings/summary.js'));
  R(w.code === 503, 'production, Upstash unset: withdrawals/request answers 503 with no token at all (limiter before auth)', `got ${w.code}`);
  R(s.code !== 503, 'production, Upstash unset: earnings/summary is not 503', `got ${s.code}`);
  setEnv({ VERCEL_ENV: 'preview' });
  w = await run(withdraw, methodOf('withdrawals/request.js'));
  s = await run(summary, methodOf('earnings/summary.js'));
  R(w.code !== 503 && s.code !== 503, 'preview, Upstash unset: both pass the limiter', `${w.code}/${s.code}`);

  // ------------------------------------------------------------ rollout
  console.log('\nRollout across api/ (AC-11)');
  const GUARD = /await\s+require(Role|Auth|Owner|PaymentPermission)\s*\(/;
  const badClosed = [];
  for (const f of FAIL_CLOSED) {
    const src = fs.readFileSync(path.join(API, f), 'utf8');
    const lim = src.search(/await\s+applyRateLimit\s*\(/);
    const guard = src.search(GUARD);
    const callText = lim >= 0 ? src.slice(lim, src.indexOf(')', lim) + 1) : '';
    if (lim < 0) badClosed.push(`${f}: no limiter`);
    else if (!/failClosed:\s*true/.test(callText)) badClosed.push(`${f}: no failClosed: true`);
    else if (guard >= 0 && guard < lim) badClosed.push(`${f}: auth runs before the limiter`);
  }
  R(badClosed.length === 0, `${FAIL_CLOSED.length} sensitive routes fail closed, limiter before auth`, badClosed.join('; '));
  const badOpen = STAY_OPEN.filter((f) => /failClosed:\s*true/.test(fs.readFileSync(path.join(API, f), 'utf8')));
  R(badOpen.length === 0, `${STAY_OPEN.length} routes stay open (config-status must load to show the limiter red)`, badOpen.join(', '));

  global.fetch = realFetch;
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { process.stdout.write('\nHARNESS ERROR: ' + (e && e.stack) + '\n'); process.exit(2); });
