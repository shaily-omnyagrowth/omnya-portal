// tests/config-status.test.cjs
//
// System Config, offline (spec 0001):
//
//   AC-7   owner only; migration rows in four states; PGRST202 names the migration
//   AC-8   every value is set / missing / placeholder / invalid with a fixed
//          reason; format rules only in production; not live platforms
//   AC-9   ready only when every required value is set and every row applied
//   AC-10  config-test: owner only, ok / restricted_key / failed, no secret material
//
// The service role client is replaced in the require cache, so the real
// requireRole runs against fake users, and the real handlers run end to end.
// No network: fetch is stubbed for config-test.
//
//   node tests/config-status.test.cjs

const path = require('path');

const ROOT = path.join(__dirname, '..');
const API = path.join(ROOT, 'api');

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};

// ------------------------------------------------------------ fakes

const USERS = {
  'tok-owner': { id: 'u-owner', role: 'owner' },
  'tok-am': { id: 'u-am', role: 'account_manager' },
  'tok-creator': { id: 'u-creator', role: 'creator' },
};
let rpcAnswer = { data: { history: [], probes: [] }, error: null };
let rpcCalls = 0;

const fakeClient = {
  auth: {
    async getUser(token) {
      const u = Object.values(USERS).find((x, i) => Object.keys(USERS)[i] === token);
      return u ? { data: { user: { id: u.id } }, error: null } : { data: null, error: { message: 'bad token' } };
    },
  },
  from() {
    let id = null;
    const q = {
      select: () => q,
      eq: (_c, v) => { id = v; return q; },
      async single() {
        const u = Object.values(USERS).find((x) => x.id === id);
        return u ? { data: { id: u.id, email: `${u.role}@example.com`, role: u.role }, error: null } : { data: null, error: { message: 'none' } };
      },
    };
    return q;
  },
  async rpc(name, args) {
    rpcCalls++;
    if (name !== 'admin_migration_status') return { data: null, error: { message: 'unexpected rpc' } };
    fakeClient.lastArgs = args;
    return rpcAnswer;
  },
};

const adminPath = require.resolve(path.join(API, '_utils', 'supabaseAdmin.js'));
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: { getSupabaseAdminClient: () => fakeClient },
};

// One fetch for the whole process. The limiter's pipeline always admits (the
// limiter has its own suite); the provider answers are set per scenario below.
const scenario = { upstash: 'ok', stripe: 'ok', resend: 'ok', domainStatus: 'verified' };
const seen = [];
const realFetch = global.fetch;
global.fetch = async (url, init) => {
  const u = String(url);
  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  if (u.endsWith('/pipeline')) return json(200, [{ result: 'OK' }, { result: 1 }]);
  seen.push({ url: u });
  if (u.includes('upstash.io')) return scenario.upstash === 'ok' ? json(200, { result: 'PONG' }) : json(401, { error: 'Unauthorized' });
  if (u.includes('api.stripe.com')) {
    if (scenario.stripe === 'ok') return json(200, { object: 'balance' });
    if (scenario.stripe === 'restricted') return json(403, { error: { code: 'secret_key_required', message: 'The provided key rk_live_****abcd does not have ...' } });
    return json(401, { error: { code: 'api_key_invalid', message: 'Invalid API Key provided: sk_live_****mnop' } });
  }
  if (u.includes('api.resend.com/domains')) {
    if (scenario.resend === 'restricted') return json(401, { statusCode: 401, name: 'restricted_api_key', message: 'This API key is restricted to only send emails' });
    return json(200, { data: [{ name: 'mail.example.com', status: scenario.domainStatus }] });
  }
  return json(404, {});
};

const BASE_ENV = { ...process.env };
for (const k of Object.keys(process.env)) {
  if (/^(UPSTASH_|STRIPE_|RESEND_|LIVE_PLATFORMS|VERCEL_ENV|TIKTOK_|INSTAGRAM_|META_|FACEBOOK_|YOUTUBE_|ENCRYPTION_KEY|CRON_SECRET|APP_BASE_URL|OWNER_NOTIFICATION_EMAIL|SUPABASE_)/.test(k)) delete process.env[k];
}

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
async function call(handler, { method = 'GET', token } = {}) {
  const { res, out } = fakeRes();
  await handler({ method, headers: token ? { authorization: `Bearer ${token}` } : {}, query: {}, body: {} }, res);
  return out;
}

const { evaluateConfig } = require(path.join(API, '_lib', 'configRules.js'));
const probes = require(path.join(API, '_lib', 'migrationProbes.js'));
const configStatus = require(path.join(API, 'admin', 'config-status.js'));
const configTest = require(path.join(API, 'admin', 'config-test.js'));

// A production environment where everything is well formed.
const GOOD = {
  VERCEL_ENV: 'production',
  SUPABASE_URL: 'https://aglikzyarmqbdmjvkvyj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJl',
  APP_BASE_URL: 'https://portal.example.com',
  ENCRYPTION_KEY: 'a'.repeat(64),
  CRON_SECRET: 'c'.repeat(40),
  UPSTASH_REDIS_REST_URL: 'https://good-bird-12345.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 't'.repeat(40),
  RESEND_API_KEY: 're_live_1234567890',
  RESEND_FROM_EMAIL: 'Omnya <hello@mail.example.com>',
  OWNER_NOTIFICATION_EMAIL: 'owner@example.com',
  STRIPE_SECRET_KEY: 'sk_live_51abcdefghijklmnop',
  STRIPE_WEBHOOK_SECRET: 'whsec_abcdef',
  LIVE_PLATFORMS: 'tiktok',
  TIKTOK_CLIENT_KEY: 'awkey123',
  TIKTOK_CLIENT_SECRET: 'secret123',
};
const varOf = (cfg, name) => cfg.groups.flatMap((g) => g.vars).find((v) => v.name === name);

(async () => {
  // ------------------------------------------------------------ AC-8 / AC-9 rules
  console.log('\nConfig rules (AC-8, AC-9)');
  const good = evaluateConfig(GOOD);
  R(good.notReadyReasons.length === 0, 'a fully well formed production config has no reasons', good.notReadyReasons.join('; '));

  const testKey = evaluateConfig({ ...GOOD, STRIPE_SECRET_KEY: 'sk_test_51abc' });
  R(varOf(testKey, 'STRIPE_SECRET_KEY').state === 'invalid' && varOf(testKey, 'STRIPE_SECRET_KEY').reason === 'expected the live mode key',
    'a Stripe test key in production is invalid: "expected the live mode key"');
  const previewTestKey = evaluateConfig({ ...GOOD, VERCEL_ENV: 'preview', STRIPE_SECRET_KEY: 'sk_test_51abc', APP_BASE_URL: 'http://localhost:3000' });
  R(varOf(previewTestKey, 'STRIPE_SECRET_KEY').state === 'set' && varOf(previewTestKey, 'APP_BASE_URL').state === 'set',
    'on preview, format rules do not apply: just set or missing');

  const tiktokUnset = evaluateConfig({ ...GOOD, TIKTOK_CLIENT_KEY: '' });
  R(varOf(tiktokUnset, 'TIKTOK_CLIENT_KEY').state === 'missing' && tiktokUnset.notReadyReasons.some((r) => /TIKTOK_CLIENT_KEY/.test(r)),
    'LIVE_PLATFORMS=tiktok with TikTok unset: not ready');
  R(varOf(good, 'YOUTUBE_CLIENT_ID').state === 'not live' && !good.notReadyReasons.some((r) => /YOUTUBE/.test(r)),
    'YouTube unset and not live: "not live", does not block');
  R(varOf(evaluateConfig({ ...GOOD, LIVE_PLATFORMS: 'tiktok,myspace' }), 'LIVE_PLATFORMS').state === 'invalid',
    'an unknown platform in LIVE_PLATFORMS is invalid');
  R(!evaluateConfig({ ...GOOD, LIVE_PLATFORMS: '' }).notReadyReasons.some((r) => /LIVE_PLATFORMS/.test(r)),
    'LIVE_PLATFORMS is optional and never blocks');
  const fb = evaluateConfig({ ...GOOD, LIVE_PLATFORMS: 'facebook', FACEBOOK_APP_ID: '1', FACEBOOK_APP_SECRET: '2' });
  R(fb.notReadyReasons.length === 0 && varOf(fb, 'FACEBOOK_APP_ID').state === 'set', 'Facebook accepts the FACEBOOK_* pair when META_* is unset');

  const placeholder = evaluateConfig({ ...GOOD, RESEND_API_KEY: 'your-resend-api-key', CRON_SECRET: 'Your_Cron_Value' });
  R(varOf(placeholder, 'RESEND_API_KEY').state === 'placeholder' && varOf(placeholder, 'CRON_SECRET').state === 'placeholder',
    'the PLACEHOLDERS list and ^your[-_] are placeholders');

  const CASES = [
    ['SUPABASE_URL', 'http://x.supabase.co'],
    ['SUPABASE_SERVICE_ROLE_KEY', 'not-a-jwt'],
    ['APP_BASE_URL', 'https://portal.example.com/'],
    ['APP_BASE_URL', 'https://localhost'],
    ['ENCRYPTION_KEY', 'z'.repeat(64)],
    ['ENCRYPTION_KEY', 'a'.repeat(63)],
    ['CRON_SECRET', 'short'],
    ['UPSTASH_REDIS_REST_URL', 'https://redis.example.com'],
    ['UPSTASH_REDIS_REST_TOKEN', 'short'],
    ['RESEND_API_KEY', 'sk_wrong'],
    ['RESEND_FROM_EMAIL', 'not an email'],
    ['OWNER_NOTIFICATION_EMAIL', 'owner'],
    ['STRIPE_WEBHOOK_SECRET', 'abc'],
  ];
  const leaks = [];
  for (const [name, value] of CASES) {
    const v = varOf(evaluateConfig({ ...GOOD, [name]: value }), name);
    if (v.state !== 'invalid') leaks.push(`${name}=${value} -> ${v.state}`);
    if (v.reason && (v.reason.includes(value) || /\b63\b/.test(v.reason))) leaks.push(`${name} reason echoes the value or its length`);
  }
  R(leaks.length === 0, `${CASES.length} malformed values are invalid, with reasons that never echo the value or its length`, leaks.join('; '));

  // ------------------------------------------------------------ AC-7 auth
  console.log('\nOwner only (AC-7, AC-10)');
  Object.assign(process.env, GOOD, { VERCEL_ENV: 'preview' });
  for (const [who, token] of [['account manager', 'tok-am'], ['creator', 'tok-creator']]) {
    const a = await call(configStatus, { token });
    const b = await call(configTest, { method: 'POST', token });
    R(a.code === 403 && b.code === 403, `${who}: 403 from config-status and config-test`, `${a.code}/${b.code}`);
  }
  const anon = await call(configStatus, {});
  R(anon.code === 401, 'no token: 401');
  R((await call(configTest, { method: 'GET', token: 'tok-owner' })).code === 405, 'config-test refuses GET (405)');

  // ------------------------------------------------------------ AC-7 states
  console.log('\nMigrations panel (AC-7)');
  const files = Object.keys(probes.manifest).sort();
  const sent = probes.probePayload();
  const [fApplied, fBroken, fPending, fDrift] = sent.map((p) => p.file);
  rpcAnswer = {
    data: {
      history: files.filter((f) => f !== fPending && f !== fDrift).map((f) => ({ version: probes.versionOf(f) })),
      probes: sent.map((p) => ({ file: p.file, present: p.file !== fBroken && p.file !== fPending })),
    },
    error: null,
  };
  const owner = await call(configStatus, { token: 'tok-owner' });
  const d = owner.body && owner.body.data;
  const stateOf = (f) => d.migrations.rows.find((r) => r.file === f).state;
  R(owner.code === 200 && d.migrations.available, 'owner gets 200 with migration rows');
  R(d.migrations.rows.length === files.length, 'one row per manifest file', `${d.migrations.rows.length}/${files.length}`);
  R(stateOf(fApplied) === 'applied' && stateOf(fBroken) === 'broken' && stateOf(fPending) === 'pending' && stateOf(fDrift) === 'drift',
    'applied, broken, pending and drift rows come out as such');
  R(Array.isArray(fakeClient.lastArgs.probes) && fakeClient.lastArgs.probes.length === sent.length,
    'the RPC receives the manifest payload (manual and retired entries left out)');
  R(d.ready === false && [fBroken, fPending, fDrift].every((f) => d.notReadyReasons.some((r) => r.includes(f))),
    'each non applied row appears in notReadyReasons');

  const body = JSON.stringify(owner.body);
  const NOT_SECRET = new Set(['VERCEL_ENV', 'LIVE_PLATFORMS', 'SUPABASE_URL', 'APP_BASE_URL', 'UPSTASH_REDIS_REST_URL',
    'RESEND_FROM_EMAIL', 'OWNER_NOTIFICATION_EMAIL']);
  const secretValues = Object.entries(GOOD).filter(([k]) => !NOT_SECRET.has(k)).map(([, v]) => v);
  const leaked = secretValues.filter((v) => body.includes(v));
  R(leaked.length === 0, 'no configured secret value appears in the response', leaked.join(', '));

  // All applied, everything set: ready.
  const nonManual = files.filter((f) => probes.manifest[f].kind !== 'manual');
  rpcAnswer = { data: { history: files.map((f) => ({ version: probes.versionOf(f) })), probes: sent.map((p) => ({ file: p.file, present: true })) }, error: null };
  Object.assign(process.env, GOOD);
  const allGood = (await call(configStatus, { token: 'tok-owner' })).body.data;
  const manualReasons = allGood.notReadyReasons.filter((r) => /manual/.test(r));
  R(allGood.notReadyReasons.length === manualReasons.length,
    'with every value set and every row applied, only manual rows remain as reasons', allGood.notReadyReasons.join('; '));
  R(allGood.ready === (manualReasons.length === 0), 'ready is false exactly while a reason remains');
  R(nonManual.every((f) => allGood.migrations.rows.find((r) => r.file === f).state === 'applied'), 'every non manual row is applied');

  // PGRST202: the status function is not there yet.
  rpcAnswer = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.admin_migration_status(probes) in the schema cache' } };
  const noFn = (await call(configStatus, { token: 'tok-owner' })).body.data;
  R(noFn.migrations.available === false && /20261001000000_admin_migration_status\.sql/.test(noFn.migrations.hint),
    'PGRST202: the panel names migration 20261001000000');
  R(noFn.ready === false && noFn.notReadyReasons.some((r) => /20261001000000/.test(r)), 'and readiness says so');

  // ------------------------------------------------------------ AC-10 provider tests
  console.log('\nTest connections (AC-10)');
  const run = async () => (await call(configTest, { method: 'POST', token: 'tok-owner' })).body.data.results;
  const by = (rs) => Object.fromEntries(rs.map((r) => [r.provider, r]));

  let rs = by(await run());
  R(['upstash', 'stripe', 'resend', 'resend_domain'].every((p) => rs[p] && rs[p].result === 'ok'), 'all four ok when everything works');
  R(seen.some((s) => s.url === 'https://api.stripe.com/v1/balance') && seen.some((s) => s.url === 'https://api.resend.com/domains'),
    'Stripe balance and Resend domains are the reads used');

  Object.assign(scenario, { stripe: 'restricted', resend: 'restricted' });
  rs = by(await run());
  R(rs.stripe.result === 'restricted_key' && rs.resend.result === 'restricted_key' && rs.resend.code === 'restricted_api_key',
    'Stripe 403 and Resend restricted_api_key are restricted_key');

  Object.assign(scenario, { stripe: 'bad', resend: 'ok', domainStatus: 'pending', upstash: 'bad' });
  const raw = await call(configTest, { method: 'POST', token: 'tok-owner' });
  rs = by(raw.body.data.results);
  R(rs.stripe.result === 'failed' && rs.stripe.code === 'api_key_invalid', 'a bad Stripe key fails with the provider code');
  R(rs.resend_domain.result === 'failed' && rs.resend_domain.code === 'domain_pending', 'an unverified sender domain fails');
  R(rs.upstash.result === 'failed' && rs.upstash.code === 'http_401', 'a bad Upstash token fails with the HTTP status');
  const text = JSON.stringify(raw.body);
  R(!/\*\*\*\*|sk_live|rk_live|Invalid API Key/.test(text) && !text.includes(GOOD.STRIPE_SECRET_KEY),
    'no provider message or key material is returned');

  delete process.env.RESEND_API_KEY;
  rs = by(await run());
  R(rs.resend.result === 'failed' && rs.resend.code === 'not_configured', 'an unset key reports not_configured without calling out');

  R(configTest.senderDomain() === 'mail.example.com', 'reads the sender domain from "Name <addr@domain>"');

  global.fetch = realFetch;
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, BASE_ENV);

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('\nHARNESS ERROR:', e); process.exit(2); });
