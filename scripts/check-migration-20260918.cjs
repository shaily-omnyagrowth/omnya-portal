// scripts/check-migration-20260918.cjs
//
// Is 20260918000000_creator_portal_fixes.sql applied to the LIVE database?
//
// Read-only. Answers from Postgres itself — each probe is a real SELECT of the
// new column (or a call to the new function) through PostgREST, which Postgres
// rejects with 42703 / PGRST202 when the object is absent. That makes it
// immune to PostgREST's schema cache being stale after DDL, which the OpenAPI
// document (what tests/lib/schema.cjs reads) is not.
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env, as the other
// scripts do. Prints no data and writes nothing.
//
//   node scripts/check-migration-20260918.cjs
//
// Exit code: 0 applied, 1 not (or partly) applied, 2 could not check.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const env = {};
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
} catch { /* fall through to the check below */ }
const URL_BASE = process.env.SUPABASE_URL || env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY || /^your-/.test(KEY)) {
  console.error('Cannot check: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set in .env');
  process.exit(2);
}

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

// Everything the migration creates that the app depends on.
const COLUMNS = [
  ['campaigns', 'sales_commission_rate'],
  ['campaigns', 'manager_commission_rate'],
  ['campaigns', 'show_client_cpm'],
  ['campaign_creators', 'status'],
  ['campaign_creators', 'commitment'],
  ['campaign_creators', 'demo_video_url'],
  ['creators', 'score_override'],
  ['creators', 'tier_override'],
  ['client_safe_campaigns', 'show_client_cpm'],
];
const RPCS = ['list_unassigned_creators'];

async function probeColumn(table, column) {
  const r = await fetch(`${URL_BASE}/rest/v1/${table}?select=${column}&limit=1`, { headers });
  if (r.ok) return { ok: true };
  const body = await r.json().catch(() => ({}));
  return { ok: false, why: `${body.code || r.status}: ${String(body.message || '').slice(0, 80)}` };
}

async function probeRpc(name) {
  // An RPC that exists but refuses this caller still proves it exists; only
  // PGRST202 ("function not found") means it is missing.
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: '{}' });
  if (r.ok) return { ok: true };
  const body = await r.json().catch(() => ({}));
  return body.code === 'PGRST202'
    ? { ok: false, why: 'PGRST202: function not found' }
    : { ok: true };
}

(async () => {
  console.log(`Checking ${new URL(URL_BASE).host} for 20260918000000_creator_portal_fixes.sql\n`);
  let missing = 0;
  for (const [t, c] of COLUMNS) {
    const r = await probeColumn(t, c);
    if (!r.ok) missing++;
    console.log(`  ${r.ok ? 'present' : 'MISSING'}   ${t}.${c}${r.ok ? '' : '   ' + r.why}`);
  }
  for (const name of RPCS) {
    const r = await probeRpc(name);
    if (!r.ok) missing++;
    console.log(`  ${r.ok ? 'present' : 'MISSING'}   rpc ${name}()${r.ok ? '' : '   ' + r.why}`);
  }
  const total = COLUMNS.length + RPCS.length;
  console.log();
  if (missing === 0) {
    console.log('APPLIED. The frontend that depends on it can be deployed.');
    process.exit(0);
  }
  if (missing === total) {
    console.log('NOT APPLIED. See supabase/migrations/APPLY_20260918.md.');
  } else {
    // The file is one transaction, so this should be impossible unless an
    // object was created or dropped by hand.
    console.log(`PARTLY APPLIED (${total - missing}/${total} present). Re-run the migration; it is idempotent.`);
  }
  process.exit(1);
})().catch((e) => { console.error('Could not check:', e.message); process.exit(2); });
