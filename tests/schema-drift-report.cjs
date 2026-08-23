// tests/schema-drift-report.cjs
//
// READ ONLY. What can the repository build, versus what production actually has?
//
// Builds the schema from supabase/SETUP_FROM_SCRATCH.sql in an in-memory
// PostgreSQL, then compares it column-by-column against the live database.
//
// Every difference is F-12 drift: a column production carries that no file in
// the repo creates, or a column the repo creates that production never got.
// The first kind is why the migration chain stops partway through — a later
// migration references a column the base script does not make.
//
// This is the concrete answer to "can we rebuild this database from the repo",
// and until it prints no missing columns, the answer is no.
//
//   node tests/schema-drift-report.cjs

const fs = require('fs');
const path = require('path');
const { loadSchema } = require('./lib/schema.cjs');

let PGlite;
try {
  ({ PGlite } = require('@electric-sql/pglite'));
} catch {
  console.error('SKIP: @electric-sql/pglite is not installed.');
  process.exit(0);
}

const ROOT = path.join(__dirname, '..');
const BASE = path.join(ROOT, 'supabase', 'SETUP_FROM_SCRATCH.sql');

const BOOTSTRAP = `
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE IF NOT EXISTS auth.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT, raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
    LANGUAGE sql STABLE AS $fn$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID $fn$;
  DO $r$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role; END IF;
  END $r$;
`;

(async () => {
  console.log('\nSchema drift — what the repo builds vs what production has\n');

  // --- the repo's version ---------------------------------------------------
  const db = await PGlite.create();
  await db.exec(BOOTSTRAP);

  try {
    await db.exec(fs.readFileSync(BASE, 'utf8'));
  } catch (e) {
    console.log('  SETUP_FROM_SCRATCH.sql FAILED to run:');
    console.log('    ' + String(e.message).split('\n')[0].slice(0, 140));
    console.log('\n  Nothing below is meaningful until it runs. Fix that first.\n');
    await db.close();
    process.exit(1);
  }
  console.log('  SETUP_FROM_SCRATCH.sql ran cleanly');

  // Then every migration, in runbook order, as far as the chain gets.
  //
  // Comparing the base script alone against production measures the wrong
  // thing: eight of the tables it appears to be "missing" are created by
  // migrations further down. The real question is whether
  // base + migrations == production.
  const MIG = path.join(ROOT, 'supabase', 'migrations');
  const ORDER = [
    '20260521000000_omnya_hardening.sql',
    '20260522000000_social_media_feature.sql',
    '20260527120000_client_system_integration.sql',
    '20260527130000_client_rls_security.sql',
    '20260528000000_security_hardening.sql',
    '20260528000001_fix_user_profiles_insert_policy.sql',
    '20260530000000_payout_system.sql',
    '20260530000001_payout_rpc_functions.sql',
    '20260530000002_stripe_connect.sql',
    '20260821000000_payout_drift_and_authz.sql',
    '20260604000000_tiktok_integration.sql',
    '20260822000002_token_migration.sql',
    '20260822000003_campaign_creators.sql',
    '20260822000004_payout_ledger.sql',
    '20260822000005_tenant_policy_reset.sql',
    '20260822000006_signup_pending_role.sql',
  ];

  let haltedAt = null, haltReason = '';
  let appliedCount = 0;
  for (const file of ORDER) {
    const full = path.join(MIG, file);
    if (!fs.existsSync(full)) continue;
    try {
      await db.exec(fs.readFileSync(full, 'utf8'));
      appliedCount++;
    } catch (e) {
      haltedAt = file;
      haltReason = String(e.message).split('\n')[0].slice(0, 120);
      // A failed statement leaves the session in an aborted transaction, where
      // every later command — including the information_schema query this
      // report exists to run — answers "current transaction is aborted". Clear
      // it so the state reached BEFORE the halt can still be inspected.
      try { await db.exec('ROLLBACK;'); } catch { /* nothing open */ }
      break;
    }
  }

  if (haltedAt) {
    console.log(`  migrations: ${appliedCount} applied, then HALTED at ${haltedAt}`);
    console.log(`              ${haltReason}`);
    console.log('  Columns listed below are what the chain still needs to get past it.');
  } else {
    console.log(`  migrations: all ${appliedCount} applied cleanly`);
  }

  const repoRows = await db.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, column_name
  `);
  await db.close();

  const repo = {};
  for (const r of repoRows.rows) {
    (repo[r.table_name] = repo[r.table_name] || new Set()).add(r.column_name);
  }

  // --- production's version -------------------------------------------------
  const live = await loadSchema();

  console.log(`  repo builds ${Object.keys(repo).length} table(s); production exposes ${Object.keys(live).length}\n`);

  // PostgREST exposes views alongside tables; those are not drift.
  const VIEWS = new Set(Object.keys(live).filter(t => /^client_safe_|_safe$|^creator_connection_status$/.test(t)));

  let missingTotal = 0, extraTotal = 0;
  const missingTables = [];

  for (const table of Object.keys(live).sort()) {
    if (VIEWS.has(table)) continue;
    const liveCols = new Set(live[table]);
    const repoCols = repo[table];

    if (!repoCols) {
      missingTables.push(table);
      continue;
    }

    const missing = [...liveCols].filter(c => !repoCols.has(c)).sort();
    const extra = [...repoCols].filter(c => !liveCols.has(c)).sort();

    if (missing.length || extra.length) {
      console.log('  ' + table);
      if (missing.length) {
        missingTotal += missing.length;
        console.log('    production has, repo does NOT build: ' + missing.join(', '));
      }
      if (extra.length) {
        extraTotal += extra.length;
        console.log('    repo builds, production does NOT have: ' + extra.join(', '));
      }
    }
  }

  if (missingTables.length) {
    console.log('\n  Tables in production that the repo does not build at all:');
    for (const t of missingTables) console.log('    · ' + t);
  }

  console.log('\n  ' + '-'.repeat(62));
  console.log(`  ${missingTotal} column(s) production has that the repo cannot create`);
  console.log(`  ${extraTotal} column(s) the repo creates that production lacks`);
  console.log(`  ${missingTables.length} table(s) missing from the repo entirely`);

  if (missingTotal === 0 && missingTables.length === 0) {
    console.log('\n  The repo can rebuild production\'s shape. Staging, branches and');
    console.log('  disaster recovery are all possible.\n');
  } else {
    console.log('\n  Until this reaches zero, the repo cannot rebuild this database:');
    console.log('  no staging, no Supabase branch, no disaster recovery, and the');
    console.log('  migration chain stops wherever it first needs a missing column.\n');
  }


  process.exit(0);
})().catch(e => { console.error('PROBE FAILED:', e.message); process.exit(2); });
