// tests/rate-limit.test.cjs
//
// api/_utils/rateLimit.js, offline (spec 0001):
//
//   one rate_limit_hit call per request, keyed by endpoint, user and IP
//   AC-11  failClosed routes answer 503 rate_limit_unavailable in production
//          when the limiter errors, is slow or unreachable, before auth;
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
  'withdrawals/reject.js', 'creators/payment-method.js', 'stripe/connect-url.js',
];
const STAY_OPEN = [
  'admin/users/index.js', 'analytics/manual-sync.js',
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

// Scripted admin client: `rpcImpl` answers rate_limit_hit; `adminDown` makes the client throw like missing env.
let rpcImpl = null;
let adminDown = false;
const rpcCalls = [];
const adminId = require.resolve(path.join(API, '_utils', 'supabaseAdmin.js'));
require.cache[adminId] = {
  id: adminId, filename: adminId, loaded: true, children: [], paths: [],
  exports: {
    getSupabaseAdminClient: () => {
      if (adminDown) throw new Error('SUPABASE_URL is not set');
      return { rpc: (name, args) => { rpcCalls.push({ name, args }); return rpcImpl(name, args); } };
    },
  },
};
const answer = (data, error = null) => () => Promise.resolve({ data, error });

function setEnv(over) {
  delete process.env.VERCEL_ENV;
  Object.assign(process.env, over);
}

const { applyRateLimit } = require(path.join(API, '_utils', 'rateLimit.js'));

async function limit(opts) {
  const { res, out } = fakeRes();
  const blocked = await applyRateLimit(req(), res, { endpoint: 'test', ...opts });
  return { blocked, ...out };
}

(async () => {
  console.log('\nOne call to rate_limit_hit per request');
  setEnv({ VERCEL_ENV: 'production' });
  rpcCalls.length = 0;
  rpcImpl = answer(1);
  let r = await limit({ max: 3, windowSecs: 60 });
  const c = rpcCalls[0];
  R(rpcCalls.length === 1 && c.name === 'rate_limit_hit' && c.args.p_window_secs === 60 && c.args.p_key === 'rl:test:ip:203.0.113.7',
    'one rpc, keyed by endpoint and IP, with the window', JSON.stringify(c));
  R(r.blocked === false, 'count 1 of 3 is allowed');
  await limit({ userId: 'u1' });
  R(rpcCalls[1].args.p_key === 'rl:test:u:u1:ip:203.0.113.7', 'a user id goes into the key');

  rpcImpl = answer(4);
  r = await limit({ max: 3, windowSecs: 60 });
  R(r.blocked && r.code === 429 && r.headers['retry-after'] === '60', 'count 4 of 3: 429 with Retry-After');

  console.log('\nUnavailable means 503 in production for failClosed (AC-11)');
  const UNAVAILABLE = [
    ['an rpc error (function missing)', answer(null, { code: 'PGRST202', message: 'Could not find the function' })],
    ['a non numeric answer', answer(null)],
    ['a rejected request', () => Promise.reject(new TypeError('fetch failed'))],
  ];
  for (const [label, impl] of UNAVAILABLE) {
    rpcImpl = impl;
    const closed = await limit({ failClosed: true });
    const open = await limit({});
    R(closed.blocked && closed.code === 503 && closed.body.code === 'rate_limit_unavailable' && open.blocked === false,
      `${label}: failClosed 503, others pass`);
  }

  rpcImpl = () => new Promise(() => {});
  const t0 = Date.now();
  const slow = await limit({ failClosed: true });
  const took = Date.now() - t0;
  R(slow.code === 503 && took >= 1900 && took < 3500, 'a slow database times out at 2 s and fails closed', `${took} ms`);

  adminDown = true;
  r = await limit({ failClosed: true });
  R(r.code === 503, 'Supabase env unset in production: failClosed 503');
  r = await limit({});
  R(r.blocked === false, 'Supabase env unset in production: other routes pass');
  setEnv({ VERCEL_ENV: 'preview' });
  r = await limit({ failClosed: true });
  R(r.blocked === false, 'unavailable on preview: failClosed routes pass too');

  // ------------------------------------------------------------ AC-11 handlers
  console.log('\nOn real handlers (AC-11)');
  setEnv({ VERCEL_ENV: 'production' });
  const withdraw = require(path.join(API, 'withdrawals', 'request.js'));
  const summary = require(path.join(API, 'earnings', 'summary.js'));
  const run = async (h, method) => { const { res, out } = fakeRes(); await h(req({ method }), res); return out; };
  const methodOf = (file) => (fs.readFileSync(path.join(API, file), 'utf8').match(/req\.method\s*!==\s*'([A-Z]+)'/) || [])[1] || 'POST';
  let w = await run(withdraw, methodOf('withdrawals/request.js'));
  let s = await run(summary, methodOf('earnings/summary.js'));
  R(w.code === 503, 'production, limiter down: withdrawals/request answers 503 with no token at all (limiter before auth)', `got ${w.code}`);
  R(s.code !== 503, 'production, limiter down: earnings/summary is not 503', `got ${s.code}`);
  setEnv({ VERCEL_ENV: 'preview' });
  w = await run(withdraw, methodOf('withdrawals/request.js'));
  s = await run(summary, methodOf('earnings/summary.js'));
  R(w.code !== 503 && s.code !== 503, 'preview, limiter down: both pass the limiter', `${w.code}/${s.code}`);

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
  R(badOpen.length === 0, `${STAY_OPEN.length} routes stay open`, badOpen.join(', '));

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { process.stdout.write('\nHARNESS ERROR: ' + (e && e.stack) + '\n'); process.exit(2); });
