// tests/token-security.test.cjs
//
// Acceptance for F-3 (token encryption) and F-4 (token refresh).
//
// Everything here runs offline. `refreshIfNeeded` takes its Supabase client,
// its clock and its threshold as options, so the whole refresh decision tree is
// exercised without a network call and without a database -- which is what
// makes it worth running on every change rather than once by hand.
//
// The provider calls themselves are driven through a stubbed global.fetch, so
// "does it attempt a refresh" and "what does it do when the provider says no"
// are real assertions rather than inspection.
//
//   node tests/token-security.test.cjs

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

// ---------------------------------------------------------------------------
// ENCRYPTION_KEY
//
// The crypto is key-agnostic, so an unset key must not stop us proving that
// encryption works -- but it must not be swallowed either. If .env does not
// carry a usable key we mint an ephemeral one for this run and record an
// environment gap, reported separately at the end. Same treatment the harness
// already gives RESEND_API_KEY: an environment gap is not an application bug,
// and it is not a pass either.
// ---------------------------------------------------------------------------
const envGaps = [];
{
  const k = (process.env.ENCRYPTION_KEY || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(k)) {
    envGaps.push(
      'ENCRYPTION_KEY is ' + (k ? 'set but not 64 hex chars (' + k.length + ' chars)' : 'unset') +
      ' in .env, so a real key was NOT exercised. Every stored OAuth token is ' +
      'encrypted with this key: if production is in the same state, ' +
      'api/_utils/encryption.js throws on connect and no social account can be ' +
      'linked at all. Generate one with:\n' +
      '      node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
    process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('hex');
  }
}

const { encrypt, decrypt } = require(path.join(ROOT, 'api/_utils/encryption'));
const social = require(path.join(ROOT, 'api/_utils/socialAccounts'));
const { refreshIfNeeded, strategyFor } = require(path.join(ROOT, 'api/_utils/tokenRefresh'));

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};
const throws = (fn, label, matcher) => {
  try { fn(); R(false, label, 'it did NOT throw'); }
  catch (e) {
    const ok = !matcher || matcher.test(e.message);
    R(ok, label, ok ? e.message.slice(0, 70) : 'wrong error: ' + e.message.slice(0, 70));
  }
};

// A Supabase stand-in that records what would have been written.
function fakeSupabase() {
  const writes = [];
  return {
    writes,
    from(table) {
      return {
        update(values) {
          return {
            eq(col, val) {
              writes.push({ table, values, col, val });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 21, 12, 0, 0);

function account(over) {
  return Object.assign({
    id: 'acc-1',
    platform: 'youtube',
    access_token_encrypted: encrypt('ya29.real-access-token'),
    refresh_token_encrypted: encrypt('1//refresh-token'),
    token_expires_at: new Date(NOW + 60 * DAY).toISOString(),
    updated_at: new Date(NOW - 30 * DAY).toISOString(),
    created_at: new Date(NOW - 30 * DAY).toISOString(),
    connection_status: 'connected',
    metadata: {},
  }, over || {});
}

// ---------------------------------------------------------------------------

function cryptoRoundTrip() {
  console.log('\nF-3 -- AES-256-GCM round trip');

  const secret = 'ya29.a0AfB_by' + 'x'.repeat(180);
  const ct = encrypt(secret);
  R(ct !== secret && !ct.includes(secret.slice(0, 24)),
    'ciphertext does not contain the plaintext', ct.slice(0, 24) + '...');
  R(decrypt(ct) === secret, 'decrypt(encrypt(x)) === x');

  const a = encrypt(secret), b = encrypt(secret);
  R(a !== b, 'the same plaintext encrypts differently each time (random IV)');
  R(decrypt(a) === decrypt(b), 'and both still decrypt to the same value');

  R(encrypt(null) === null && encrypt('') === null, 'null / empty encrypt to null');
  R(decrypt(null) === null && decrypt('') === null, 'null / empty decrypt to null');

  // Tamper one byte of the ciphertext body. GCM must refuse it rather than
  // hand back plausible-looking garbage.
  const buf = Buffer.from(ct, 'base64');
  buf[buf.length - 1] ^= 0x01;
  throws(() => decrypt(buf.toString('base64')),
    'a tampered ciphertext throws instead of returning garbage');

  // Tamper the auth tag itself.
  const buf2 = Buffer.from(ct, 'base64');
  buf2[13] ^= 0xff;
  throws(() => decrypt(buf2.toString('base64')), 'a tampered GCM auth tag throws');
}

function safeProjection() {
  console.log('\nF-3 -- the token columns cannot reach a browser');

  const leaked = social.SAFE_COLUMNS.filter(c => social.TOKEN_COLUMNS.includes(c));
  R(leaked.length === 0, 'SAFE_COLUMNS names no token column',
    leaked.length ? 'LEAKS ' + leaked.join(', ') : social.SAFE_COLUMNS.length + ' safe columns');

  throws(() => social.assertNoTokenColumns('*'),
    'the guard rejects a select of *', /TOKEN LEAK GUARD/);
  throws(() => social.assertNoTokenColumns('id, platform, access_token'),
    'the guard rejects an explicit access_token', /TOKEN LEAK GUARD/);
  throws(() => social.assertNoTokenColumns(['id', 'refresh_token_encrypted']),
    'the guard rejects refresh_token_encrypted', /TOKEN LEAK GUARD/);
  R(social.assertNoTokenColumns(social.SAFE_SELECT) === true,
    'the guard accepts the real SAFE_SELECT');

  // The live CHECK constraint rejects platform='meta'; the Meta flow has to
  // land somewhere storable.
  R(social.storagePlatform('meta') === 'facebook',
    "the 'meta' flow label maps onto the storable 'facebook' platform");
  for (const p of social.PLATFORMS) {
    R(social.storagePlatform(p) === p, `'${p}' maps to itself`);
  }
}

async function refreshDecisions() {
  console.log('\nF-4 -- when a token is refreshed, and when it is left alone');

  const origFetch = global.fetch;
  let calls = 0;
  try {
    // 1. Comfortably fresh: no network, current token handed straight back.
    global.fetch = async () => { calls++; throw new Error('should not be called'); };
    calls = 0;
    let r = await refreshIfNeeded(account(), { supabase: fakeSupabase(), now: NOW });
    R(r.status === 'fresh' && calls === 0, 'a token 60 days out is left alone', 'status=' + r.status);
    R(r.accessToken === 'ya29.real-access-token', 'and the caller still gets a usable token');

    // 2. No token at all.
    r = await refreshIfNeeded(account({ access_token_encrypted: null }),
      { supabase: fakeSupabase(), now: NOW });
    R(r.status === 'no_token' && r.accessToken === null, 'a row with no token reports no_token');

    // 3. Unknown platform: reported, not crashed.
    r = await refreshIfNeeded(account({ platform: 'myspace', token_expires_at: new Date(NOW + DAY).toISOString() }),
      { supabase: fakeSupabase(), now: NOW });
    R(r.status === 'unsupported', 'an unknown platform reports unsupported', 'status=' + r.status);

    // 4. Expiring inside the threshold: it must actually try.
    calls = 0;
    global.fetch = async () => {
      calls++;
      return {
        ok: true, status: 200,
        json: async () => ({ access_token: 'ya29.NEW-token', expires_in: 3600 }),
        text: async () => '{}',
      };
    };
    const sb = fakeSupabase();
    r = await refreshIfNeeded(account({ token_expires_at: new Date(NOW + DAY).toISOString() }),
      { supabase: sb, now: NOW });
    R(calls > 0, 'a token expiring tomorrow triggers a provider call', calls + ' fetch(es)');
    R(r.status === 'refreshed' && r.accessToken === 'ya29.NEW-token',
      'the refreshed token is returned', 'status=' + r.status);

    const w = sb.writes[0];
    R(!!w && w.table === 'creator_social_accounts', 'the new token is persisted');
    R(!!w && typeof w.values.access_token_encrypted === 'string'
          && w.values.access_token_encrypted !== 'ya29.NEW-token',
      'and it is persisted ENCRYPTED, not in plaintext');
    R(!!w && decrypt(w.values.access_token_encrypted) === 'ya29.NEW-token',
      'and the stored ciphertext decrypts back to the new token');
    R(!!w && w.values.connection_status === 'connected' && w.values.last_error === null,
      'a successful refresh clears any previous error');

    // 5. Provider refuses: flag for reauth, keep the row, do not throw.
    global.fetch = async () => ({
      ok: false, status: 400,
      json: async () => ({ error: 'invalid_grant' }),
      text: async () => '{"error":"invalid_grant"}',
    });
    const sb2 = fakeSupabase();
    r = await refreshIfNeeded(account({ token_expires_at: new Date(NOW + DAY).toISOString() }),
      { supabase: sb2, now: NOW });
    R(r.status === 'failed', 'a refused refresh reports failed rather than throwing', 'status=' + r.status);
    const w2 = sb2.writes[0];
    R(!!w2 && w2.values.connection_status === social.STATUS_REAUTH,
      'the row is flagged ' + social.STATUS_REAUTH + ', not deleted');
    R(!!w2 && typeof w2.values.last_error === 'string' && w2.values.last_error.length > 0,
      'and the reason is recorded for the UI', String(w2 && w2.values.last_error).slice(0, 50));
    R(social.needsReauth({ connection_status: social.STATUS_REAUTH }) === true,
      'needsReauth() reports that row as needing the creator');

    // 6. Instagram's 24h rule: a young token must not be reported as broken.
    calls = 0;
    global.fetch = async () => { calls++; throw new Error('should not be called'); };
    r = await refreshIfNeeded(account({
      platform: 'instagram',
      token_expires_at: new Date(NOW + DAY).toISOString(),
      updated_at: new Date(NOW - 60 * 60 * 1000).toISOString(),
      metadata: { token_issued_at: new Date(NOW - 60 * 60 * 1000).toISOString() },
    }), { supabase: fakeSupabase(), now: NOW });
    R(r.status === 'fresh' && calls === 0,
      'an Instagram token younger than 24h is left alone, not flagged', 'status=' + r.status);

    // 7. Strategy routing.
    R(strategyFor({ platform: 'youtube' }).name === 'google', 'youtube routes to the Google strategy');
    R(strategyFor({ platform: 'tiktok' }).name === 'tiktok', 'tiktok routes to the TikTok strategy');
    R(strategyFor({ platform: 'facebook' }).name === 'meta', 'facebook routes to the Meta strategy');
    R(strategyFor({ platform: 'instagram', metadata: {} }).name === 'instagram',
      'a native Instagram login routes to the Instagram strategy');
    R(strategyFor({ platform: 'instagram', metadata: { provider: 'meta' } }).name === 'meta',
      'an Instagram account connected through Meta routes to the Meta strategy');
  } finally {
    global.fetch = origFetch;
  }
}

// ---------------------------------------------------------------------------
// The nightly sweep.
// ---------------------------------------------------------------------------

function fakeRes() {
  const out = { code: 200, body: null, headers: {} };
  const res = {
    setHeader: (k, v) => { out.headers[k] = v; return res; },
    status: c => { out.code = c; return res; },
    json: b => { out.body = b; return res; },
    send: b => { out.body = b; return res; },
    end: () => res,
  };
  return { res, out };
}

const cronReq = (secret, method) => ({
  method: method || 'GET',
  headers: secret === null ? {} : { authorization: `Bearer ${secret}` },
  query: {},
  body: {},
});

// A Supabase stand-in whose account query ends on .lte(...), matching the cron.
function cronSupabase(accounts) {
  const writes = [];
  return {
    writes,
    from() {
      const chain = {
        select: () => chain,
        not: () => chain,
        lte: () => Promise.resolve({ data: accounts, error: null }),
        update: values => ({
          eq: (col, val) => { writes.push({ values, col, val }); return Promise.resolve({ error: null }); },
        }),
      };
      return chain;
    },
  };
}

async function cronSweep() {
  console.log('\nF-4 -- the nightly refresh sweep');

  const realSecret = process.env.CRON_SECRET;
  const realKey = process.env.ENCRYPTION_KEY;
  const realAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const origFetch = global.fetch;

  process.env.CRON_SECRET = 'test-cron-secret';
  const handler = require(path.join(ROOT, 'api/cron/refresh-oauth-tokens'));

  try {
    // 1. Auth.
    let { res, out } = fakeRes();
    await handler(cronReq('wrong-secret'), res);
    R(out.code === 401, 'a wrong cron secret is rejected', 'status=' + out.code);

    ({ res, out } = fakeRes());
    await handler(cronReq(null), res);
    R(out.code === 401, 'a missing Authorization header is rejected', 'status=' + out.code);

    ({ res, out } = fakeRes());
    await handler(cronReq('test-cron-secret', 'DELETE'), res);
    R(out.code === 405, 'an unsupported method is rejected', 'status=' + out.code);

    // 2. The dangerous failure mode.
    //
    // With no ENCRYPTION_KEY, decrypt() throws on every row and refreshIfNeeded
    // turns each throw into connection_status = reauth_required. A sweep in
    // that state would flag EVERY account in the table as broken and force the
    // entire creator base to reconnect. It has to refuse instead.
    process.env.ENCRYPTION_KEY = 'not-a-valid-key';
    ({ res, out } = fakeRes());
    await handler(cronReq('test-cron-secret'), res);
    R(out.code >= 500,
      'a malformed ENCRYPTION_KEY stops the sweep before it touches a row',
      'status=' + out.code);
    process.env.ENCRYPTION_KEY = realKey && /^[0-9a-fA-F]{64}$/.test(realKey.trim())
      ? realKey
      : require('crypto').randomBytes(32).toString('hex');
  } finally {
    global.fetch = origFetch;
    if (realSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = realSecret;
    void realAdmin;
  }
}

(async () => {
  console.log('Token security -- F-3 encryption, F-4 refresh');
  cryptoRoundTrip();
  safeProjection();
  await refreshDecisions();
  await cronSweep();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');

  if (envGaps.length) {
    console.log('\nEnvironment gaps -- not application faults, but not verified either:');
    for (const g of envGaps) console.log('  · ' + g);
  }

  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\nHARNESS ERROR:', e); process.exit(2); });
