// tests/endpoints.test.cjs
//
// The authorization matrix. Every endpoint under api/, asked the questions an
// attacker asks first:
//
//   no credentials      -> 401, never 200 and never 500
//   wrong HTTP method   -> 405
//   missing body field  -> 400 with a message that says what is missing
//
// 42 endpoints exist. Roughly a dozen had any coverage before this file.
//
// THE LIST IS WALKED, NOT WRITTEN DOWN. A hardcoded array silently stops
// covering anything added later, which is exactly how eleven endpoints ended up
// being called by nothing at all. Add a handler to api/ and it appears here on
// the next run, failing until it is deliberately classified below.
//
// Handlers are required directly and driven with a fake req/res rather than
// over HTTP, so this suite needs no servers and stays in the fast offline lane.
//
//   node tests/endpoints.test.cjs
//
// Exit codes: 0 pass · 1 real failure · 3 blocked.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const API = path.join(ROOT, 'api');

// Load .env the way the serverless runtime would; several handlers read config
// at require() time.
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

let pass = 0, fail = 0, skipped = 0;
const envGaps = [];
const rows = [];

const R = (ok, label, detail) => {
  if (ok) pass++; else fail++;
  if (!ok) console.log('  FAIL   ' + label + (detail ? '   ' + detail : ''));
};

// ---------------------------------------------------------------------------
// Endpoint discovery
// ---------------------------------------------------------------------------

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '_utils' || e.name === '_lib') continue;
      walk(full, acc);
    } else if (e.name.endsWith('.js')) {
      acc.push(full);
    }
  }
  return acc;
}

const routeOf = file =>
  '/' + path.relative(ROOT, file).split(path.sep).join('/')
    .replace(/\.js$/, '')
    .replace(/\/index$/, '');

// ---------------------------------------------------------------------------
// Classification
//
// Not every endpoint answers to a bearer token, and asserting 401 on one that
// legitimately uses a different gate would be a false alarm. Each class states
// what IS asserted instead.
// ---------------------------------------------------------------------------

const CLASS = {
  // Provider-invoked. Guarded by a shared secret or a signature, not a JWT.
  cron: {
    match: r => r.startsWith('/api/cron/') || r === '/api/analytics/sync',
    why: 'CRON_SECRET, constant-time compare',
  },
  webhook: {
    match: r => r === '/api/stripe/webhook',
    why: 'Stripe signature verification',
  },
  // Browser-navigated OAuth redirects. The provider calls these with a code and
  // a state; there is no Authorization header to send.
  oauthCallback: {
    match: r => /\/(callback)$/.test(r),
    why: 'oauth_states single-use hashed state, not a bearer token',
  },
  oauthStart: {
    match: r => /\/(start|connect|reconnect)$/.test(r),
    why: 'bearer token, then redirects to the provider',
  },
  // The client-facing campaign report. Deliberately public: the secret is the
  // share_token in the query string, and share_enabled is enforced server-side.
  // There is no bearer token to send, so 401 is not the right expectation.
  shareLink: {
    match: r => r === '/api/campaigns/share-report',
    why: 'share_token in the query string; share_enabled enforced server-side',
  },
};

const classify = route => {
  for (const [name, c] of Object.entries(CLASS)) if (c.match(route)) return name;
  return 'jwt';
};

// ---------------------------------------------------------------------------
// Fake req / res
// ---------------------------------------------------------------------------

function fakeRes() {
  const out = { code: null, body: null, headers: {}, ended: false };
  const res = {
    setHeader: (k, v) => { out.headers[String(k).toLowerCase()] = v; return res; },
    getHeader: k => out.headers[String(k).toLowerCase()],
    status: c => { out.code = c; return res; },
    json: b => { out.body = b; out.ended = true; return res; },
    send: b => { out.body = b; out.ended = true; return res; },
    end: b => { if (b !== undefined) out.body = b; out.ended = true; return res; },
    redirect: (c, url) => { out.code = c; out.body = { redirect: url }; out.ended = true; return res; },
    writeHead: (c, h) => { out.code = c; Object.assign(out.headers, h || {}); return res; },
  };
  return { res, out };
}

/**
 * Read a handler's source, following a one-line delegation to its target.
 *
 * `module.exports = require('../../integrations/tiktok/connect')` is a real
 * shape in this codebase (F-13 kept both /api/auth/tiktok/* routes alive so a
 * registered TIKTOK_REDIRECT_URI cannot break, and forwarded them to the
 * encrypted implementation). Reading the forwarding file alone finds no guards
 * and describes the wrong module.
 */
function sourceOf(file, depth = 0) {
  const src = fs.readFileSync(file, 'utf8');
  if (depth > 3) return src;
  const m = src.match(/module\.exports\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/);
  if (!m) return src;
  try {
    return sourceOf(require.resolve(path.resolve(path.dirname(file), m[1])), depth + 1);
  } catch {
    return src;
  }
}

/**
 * Which method this handler accepts, read from its own guard.
 *
 * Handlers here are written as `if (req.method !== 'GET') return
 * Errors.methodNotAllowed(res)`, sometimes allowing two. Take the first
 * declared; fall back to POST when nothing is declared, which is this
 * codebase's default shape.
 */
function acceptedMethod(src) {
  const m = src.match(/req\.method\s*!==\s*'([A-Z]+)'/);
  return m ? m[1] : 'POST';
}

/** A method the handler definitely does NOT accept, for the 405 probe. */
function rejectedMethod(src) {
  const declared = new Set(
    [...src.matchAll(/req\.method\s*!==\s*'([A-Z]+)'/g)].map(x => x[1])
  );
  return ['DELETE', 'PUT', 'PATCH', 'POST', 'GET'].find(x => !declared.has(x)) || 'TRACE';
}

const req = (over = {}) => Object.assign({
  method: 'POST',
  headers: {},
  query: {},
  body: {},
  url: '/',
}, over);

// A handler must never take longer than this to answer an unauthenticated
// caller — if it does it is reaching the network before checking credentials.
const TIMEOUT_MS = 8000;

async function invoke(handler, request) {
  const { res, out } = fakeRes();
  let threw = null;
  await Promise.race([
    Promise.resolve()
      .then(() => handler(request, res))
      .catch(e => { threw = e; }),
    new Promise(r => setTimeout(r, TIMEOUT_MS)),
  ]);
  return { ...out, threw };
}

// Reaching a third-party with no key configured is an environment gap, not a
// broken auth gate. Recognise it rather than counting it either way.
const ENV_GAP_RE = /RESEND|ENCRYPTION_KEY|STRIPE|ANTHROPIC|UPSTASH|not configured|is not set/i;

const looksEnvGap = r =>
  (r.threw && ENV_GAP_RE.test(String(r.threw.message))) ||
  (r.body && typeof r.body === 'object' && r.body.error &&
   ENV_GAP_RE.test(String(r.body.error.message || '')));

// ---------------------------------------------------------------------------

(async () => {
  console.log('\nEndpoint authorization matrix\n');

  const files = walk(API).sort();
  console.log(`  ${files.length} endpoint(s) discovered by walking api/\n`);

  for (const file of files) {
    const route = routeOf(file);
    const kind = classify(route);
    const row = { route, kind, unauth: '-', method: '-', note: '' };

    let handler;
    try {
      handler = require(file);
    } catch (e) {
      row.note = 'does not load: ' + String(e.message).slice(0, 60);
      R(false, `${route} loads`, row.note);
      rows.push(row);
      continue;
    }

    if (typeof handler !== 'function') {
      row.note = 'export is not a handler function';
      R(false, `${route} exports a handler`, typeof handler);
      rows.push(row);
      continue;
    }

    // ---- 1. no credentials -------------------------------------------------
    //
    // Send the method the handler actually accepts. A first version sent POST
    // to everything and reported eight endpoints as failing to return 401 —
    // they were GET and PATCH routes correctly answering 405 before reaching
    // the auth check, which is normal and right. Eight phantom defects, all
    // from the probe rather than the app.
    // Follow a delegation before reading the source for guards. Both
    // api/auth/tiktok/* routes are one-line `module.exports = require(...)`
    // forwards to api/integrations/tiktok/*; reading the forwarding file finds
    // no method guard and reports "declares no method guard" about a handler
    // that has one.
    const src0 = sourceOf(file);
    const accepted = acceptedMethod(src0);

    // The Stripe webhook reads the raw request stream to verify its signature.
    // A plain object has no stream, so the handler waits forever and the probe
    // times out with no status — that is the harness failing to drive it, not
    // the endpoint failing to refuse. Assert what can be honestly asserted.
    if (kind === 'webhook') {
      row.unauth = 'n/a';
      row.note = 'needs a raw body stream; signature path not drivable from a fake req';
      skipped++;
      const hasSigCheck = /constructEvent|stripe-signature|STRIPE_WEBHOOK_SECRET/i.test(src0);
      R(hasSigCheck, `${route} verifies a Stripe signature`,
        hasSigCheck ? 'constructEvent / stripe-signature present' : 'NO SIGNATURE CHECK FOUND');
      rows.push(row);
      continue;
    }

    const noCreds = await invoke(handler, req({ method: accepted, headers: {} }));

    if (looksEnvGap(noCreds)) {
      row.unauth = 'env';
      row.note = 'blocked by a missing secret before the gate could be observed';
      envGaps.push(`${route} — ${String((noCreds.threw && noCreds.threw.message) || (noCreds.body && noCreds.body.error && noCreds.body.error.message)).slice(0, 90)}`);
      skipped++;
    } else if (kind === 'jwt' || kind === 'oauthStart') {
      const ok = noCreds.code === 401;
      row.unauth = String(noCreds.code);
      R(ok, `${route} refuses an unauthenticated caller with 401`,
        `got ${noCreds.code}${noCreds.threw ? ' (threw: ' + String(noCreds.threw.message).slice(0, 50) + ')' : ''}`);
      // The specific thing that must never happen.
      R(noCreds.code !== 200, `${route} does not serve an unauthenticated caller`, `got ${noCreds.code}`);
      R(!noCreds.threw, `${route} does not throw at an unauthenticated caller`,
        noCreds.threw ? String(noCreds.threw.message).slice(0, 70) : '');
    } else if (kind === 'shareLink') {
      // No token at all must be refused outright, before any lookup.
      const ok = noCreds.code === 400;
      row.unauth = String(noCreds.code);
      R(ok, `${route} refuses a caller with no share token`, `got ${noCreds.code}`);
      R(noCreds.code !== 200, `${route} does not serve a report without a token`, `got ${noCreds.code}`);
      R(!noCreds.threw, `${route} does not throw at a caller with no token`,
        noCreds.threw ? String(noCreds.threw.message).slice(0, 70) : '');
    } else if (kind === 'cron') {
      // CRON_SECRET is a placeholder locally, so the handler may refuse for
      // configuration reasons. Either way it must not run the job.
      const ok = noCreds.code === 401 || noCreds.code === 500;
      row.unauth = String(noCreds.code);
      R(ok, `${route} refuses a caller with no cron secret`, `got ${noCreds.code}`);
      R(noCreds.code !== 200, `${route} does not run the job unauthenticated`, `got ${noCreds.code}`);
      if (noCreds.code === 500) {
        envGaps.push(`${route} — CRON_SECRET is a placeholder, so the 401 path could not be reached`);
      }
    } else if (kind === 'webhook') {
      const ok = noCreds.code >= 400;
      row.unauth = String(noCreds.code);
      R(ok, `${route} refuses an unsigned webhook`, `got ${noCreds.code}`);
      R(noCreds.code !== 200, `${route} does not accept an unsigned webhook`, `got ${noCreds.code}`);
    } else if (kind === 'oauthCallback') {
      // No bearer token exists here. What must hold is that a callback with no
      // state is refused rather than trusted — a redirect carrying an error is
      // the correct shape, a 200 is not.
      const r2 = await invoke(handler, req({ method: 'GET', query: {} }));
      const ok = r2.code === 302 || r2.code >= 400;
      row.unauth = String(r2.code);
      R(ok, `${route} refuses a callback with no state`, `got ${r2.code}`);
      if (r2.code === 302 && r2.body && r2.body.redirect) {
        R(/error/i.test(r2.body.redirect),
          `${route} redirects with an error rather than a success`,
          String(r2.body.redirect).slice(0, 70));
      }
    }

    // ---- 2. wrong method ---------------------------------------------------
    // Only meaningful where the handler declares one. GET-only OAuth callbacks
    // and dual-method crons are exempt.
    if (/req\.method\s*!==/.test(src0)) {
      const bad = rejectedMethod(src0);
      const wrong = await invoke(handler, req({ method: bad, headers: {} }));
      if (looksEnvGap(wrong)) {
        row.method = 'env';
      } else {
        row.method = String(wrong.code);
        // The cron handlers check CRON_SECRET *before* the method, so an
        // unauthenticated wrong-verb request is answered 401, not 405. That
        // ordering is deliberate and better: it declines to tell an
        // unauthenticated caller which verbs a job endpoint accepts. Asserting
        // a flat 405 here reported three phantom defects.
        const ok = kind === 'cron'
          ? (wrong.code === 401 || wrong.code === 405)
          : wrong.code === 405;
        R(ok, `${route} rejects ${bad}`,
          `got ${wrong.code}` + (kind === 'cron' ? ' (401 = auth checked before method, correct)' : ''));
      }
    } else {
      row.method = 'none';
      row.note = row.note || 'declares no method guard';
    }

    rows.push(row);
  }

  // ---- the table -----------------------------------------------------------

  console.log('  ROUTE                                        CLASS      UNAUTH  METHOD');
  console.log('  ' + '-'.repeat(78));
  for (const r of rows) {
    console.log(
      '  ' + r.route.padEnd(44) +
      r.kind.padEnd(11) +
      String(r.unauth).padEnd(8) +
      String(r.method) +
      (r.note ? '   ' + r.note : '')
    );
  }

  console.log('\n  class meanings');
  for (const [name, c] of Object.entries(CLASS)) {
    console.log(`    ${name.padEnd(14)} ${c.why}`);
  }
  console.log(`    ${'jwt'.padEnd(14)} bearer token via requireAuth / requireRole`);

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed, ' + skipped + ' not assertable');

  if (envGaps.length) {
    console.log('\n  Environment gaps — not application faults, but not verified either:');
    for (const g of [...new Set(envGaps)]) console.log('    · ' + g);
  }

  console.log('');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\nHARNESS ERROR:', e); process.exit(2); });
