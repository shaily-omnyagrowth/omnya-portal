// tests/rate-limit-live.test.cjs
//
// Proves the rate limiter really rejects in production (spec 0001, AC-13).
//
// Sends up to 31 unauthenticated GET /api/admin/config-status calls to
// APP_BASE_URL, one after another. That route allows 30 per 60 s per IP, and
// its limiter runs before auth, so a working limiter answers 401 thirty times
// and then 429 with Retry-After. If no 429 arrives, the limiter is failing
// open in production (Upstash unset or broken), and this suite reports FAILED,
// never BLOCKED: that is a real production defect, not a missing migration.
//
// It reaches production, so it needs APP_BASE_URL (https, not localhost) in
// the environment or .env. Without one it prints SKIP and exits 0.
//
// SIDE EFFECT: the IP running this is locked out of config-status for up to
// 60 s afterwards. Nothing else is affected (each route has its own key).
//
//   node tests/rate-limit-live.test.cjs

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAX_CALLS = 31;

function envValue(name) {
  if (process.env[name]) return process.env[name].trim();
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return null;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[1] === name) return m[2].trim();
  }
  return null;
}

(async () => {
  const base = envValue('APP_BASE_URL');
  let url = null;
  try { url = base ? new URL(base) : null; } catch { url = null; }
  if (!url || url.protocol !== 'https:' || /^(localhost|127\.0\.0\.1)$/.test(url.hostname)) {
    console.log('\nSKIP: set APP_BASE_URL to the production https URL to run the live 429 check (spec 0001, AC-13).\n');
    process.exit(0);
  }

  const target = `${base.replace(/\/+$/, '')}/api/admin/config-status`;
  console.log(`\nLive rate limit check against ${target}`);
  console.log('  WARNING: this IP will be locked out of config-status for up to 60 s afterwards.\n');

  const statuses = [];
  let got429 = null;
  for (let i = 1; i <= MAX_CALLS; i++) {
    let resp;
    try {
      resp = await fetch(target, { method: 'GET', redirect: 'manual' });
    } catch (e) {
      console.log(`  FAIL   call ${i} did not reach production: ${e.message}`);
      console.log('\n  0 passed, 1 failed\n');
      process.exit(1);
    }
    statuses.push(resp.status);
    if (resp.status === 429) { got429 = { call: i, retryAfter: resp.headers.get('retry-after') }; break; }
  }

  let pass = 0, fail = 0;
  const R = (ok, label, detail) => {
    console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
    if (ok) pass++; else fail++;
  };

  const summary = Object.entries(statuses.reduce((a, s) => ({ ...a, [s]: (a[s] || 0) + 1 }), {}))
    .map(([s, n]) => `${n}x${s}`).join(', ');
  R(Boolean(got429), `a 429 arrives within ${MAX_CALLS} calls`,
    got429 ? `at call ${got429.call}` : `none (${summary}): the limiter is failing open in production`);
  R(Boolean(got429 && got429.retryAfter), 'the 429 carries Retry-After', got429 ? `Retry-After: ${got429.retryAfter}` : '');
  const before = got429 ? statuses.slice(0, -1) : statuses;
  R(before.length > 0 && before.every((s) => s === 401), 'every earlier call is 401 (the limiter runs before auth)', summary);

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
