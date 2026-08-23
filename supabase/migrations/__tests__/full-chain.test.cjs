// supabase/migrations/__tests__/full-chain.test.cjs
//
// Applies EVERY migration, in the runbook's order, to a real PostgreSQL engine.
//
// WHY THIS MATTERS MORE THAN IT LOOKS
//
// The other migration suites each apply one or two files to a fresh database.
// That proves a file is internally valid; it does not prove the set composes.
// Ordering bugs only appear in the full chain — a policy that depends on a
// function created two files later, a constraint tightened before the data is
// clean, a table renamed out from under a later reference.
//
// It also decouples verification from production access. Nine migrations are
// written and none are applied, so the payout chain has never completed
// anywhere. If the whole set applies cleanly here, the money path can be
// proven locally today instead of waiting.
//
// A failure here is a REAL defect and blocks the apply. A failure in the live
// database that does not reproduce here means the live schema has drifted from
// the repo — which is F-12, and worth knowing either way.
//
//   node supabase/migrations/__tests__/full-chain.test.cjs

const fs = require('fs');
const path = require('path');

let PGlite;
try {
  ({ PGlite } = require('@electric-sql/pglite'));
} catch {
  console.error('SKIP: @electric-sql/pglite is not installed.  npm i -D @electric-sql/pglite');
  process.exit(0);
}

const MIG = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixture_schema.sql');

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};

// The order from supabase/migrations/APPLY_20260822.md, preceded by the
// foundational set those steps assume.
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

// Deliberately excluded, and the reason is load-bearing: its creators policy
// reads campaigns while campaigns_select_scoped reads creators, and PostgreSQL
// refuses the cycle — SQLSTATE 42P17 — breaking every campaign read for every
// role. Step 20260822000005 supersedes it. Asserted at the bottom.
const EXCLUDED = '20260821000001_client_creator_visibility.sql';

// The base schema.
//
// STRUCTURAL FINDING, recorded here because this is where it surfaced:
// twelve core tables — user_profiles, creators, clients, campaigns,
// submissions, account_managers, payments, payout_batches, payout_line_items,
// creator_tokens, video_analytics, messages — are created ONLY by
// supabase/SETUP_FROM_SCRATCH.sql. No migration creates them; several ALTER
// them on the first line.
//
// So there is no path from an empty database to a working schema using
// supabase/migrations/ alone. A new environment — staging, a Supabase branch,
// a fresh dev database — cannot be built from the migration chain. That is a
// gap against the scope spec's migration-procedure requirement, and it is why
// this file loads SETUP_FROM_SCRATCH first rather than the test fixture.
const BASE = path.join(MIG, '..', 'SETUP_FROM_SCRATCH.sql');

// Exactly what a Supabase project has before ANY project SQL runs: the auth
// schema, auth.users, auth.uid(), and the three roles PostgREST uses.
//
// Deliberately NOT fixture_schema.sql. That file pre-creates public tables with
// minimal shapes for the other suites, and every definition in
// SETUP_FROM_SCRATCH.sql is `CREATE TABLE IF NOT EXISTS` — so the fixture's
// four-column payout_batches silently won that race and the script then failed
// on a column its own definition declares. The test was fighting itself.
//
// An empty database is also the honest starting point: the question is whether
// the repo can build this schema from nothing.
const BOOTSTRAP = `
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE IF NOT EXISTS auth.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT,
    raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
    LANGUAGE sql STABLE AS $fn$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID
    $fn$;
  DO $r$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role; END IF;
  END $r$;
`;

async function fresh() {
  const db = await PGlite.create();
  await db.exec(BOOTSTRAP);
  if (!fs.existsSync(BASE)) {
    throw new Error('SETUP_FROM_SCRATCH.sql is missing — nothing can build the base schema.');
  }
  await db.exec(fs.readFileSync(BASE, 'utf8'));
  return db;
}

const one = async (db, sql) => (await db.query(sql)).rows[0];

(async () => {
  console.log('\nFull migration chain, in runbook order, against real PostgreSQL\n');

  const db = await fresh();
  let applied = 0;

  // Stop at the first failure. A failed statement aborts the transaction, so
  // everything after it reports "current transaction is aborted" — the first
  // version of this file turned one real error into 28 meaningless ones and
  // buried the cause at the top.
  let halted = null;

  for (const file of ORDER) {
    if (halted) { console.log('  SKIP   ' + file + '   (chain halted at ' + halted + ')'); continue; }

    const full = path.join(MIG, file);
    if (!fs.existsSync(full)) {
      R(false, file + ' exists in the repo', 'FILE MISSING — the runbook names it');
      halted = file;
      continue;
    }
    const t0 = Date.now();
    try {
      await db.exec(fs.readFileSync(full, 'utf8'));
      applied++;
      R(true, file, (Date.now() - t0) + 'ms');
    } catch (e) {
      R(false, file, String(e.message).split('\n')[0].slice(0, 160));
      halted = file;
    }
  }

  if (halted) {
    console.log('\n  Chain halted at ' + halted + '. Everything below would report');
    console.log('  the aborted transaction rather than its own result, so it is skipped.\n');
    console.log('  ' + pass + ' passed, ' + fail + ' failed\n');
    await db.close();
    process.exit(1);
  }

  console.log('\n  --- what the finished schema actually has ---\n');

  const checks = [
    ['campaign_creators exists',        "select to_regclass('public.campaign_creators') is not null as ok", r => r.ok],
    ['payout_ledger exists',            "select to_regclass('public.payout_ledger') is not null as ok", r => r.ok],
    ['creator_social_accounts exists',  "select to_regclass('public.creator_social_accounts') is not null as ok", r => r.ok],
    ['creator_videos exists',           "select to_regclass('public.creator_videos') is not null as ok", r => r.ok],
    // The Stripe migration spreads twelve columns across THREE tables —
    // 7 on creators, 4 on payments, 1 on withdrawal_requests. Asserting all
    // twelve on creators reported a phantom failure at 7.
    ['12 stripe columns, across 3 tables',
      "select count(*)::int as n from information_schema.columns " +
      "where table_schema='public' " +
      // is_stripe_payout is one of the twelve and does NOT begin with
      // 'stripe_'. Matching only that prefix counted 11 and reported a
      // phantom failure.
      "and (column_name like 'stripe_%' or column_name = 'is_stripe_payout') " +
      "and table_name in ('creators','payments','withdrawal_requests')", r => r.n === 12],
    ['earnings status CHECK present',   "select count(*)::int as n from pg_constraint where conname='creator_earnings_status_check'", r => r.n === 1],
    ['signup trigger installed',        "select count(*)::int as n from pg_trigger where tgname='on_auth_user_created' and not tgisinternal", r => r.n === 1],
    ['ledger immutability trigger',     "select count(*)::int as n from pg_trigger where tgname='trg_payout_ledger_immutable' and not tgisinternal", r => r.n === 1],
    ['creator_tokens has no policy',    "select count(*)::int as n from pg_policies where tablename='creator_tokens'", r => r.n === 0],
  ];

  for (const [label, sql, ok] of checks) {
    try {
      const row = await one(db, sql);
      R(ok(row), label, JSON.stringify(row));
    } catch (e) {
      R(false, label, e.message.slice(0, 80));
    }
  }

  // The earnings status vocabulary the payout chain depends on. Before
  // 20260821000000 the live CHECK rejects these two, which is finding N-03 and
  // the reason payout-acceptance exits 3 today.
  for (const status of ['withdrawal_requested', 'batched']) {
    try {
      // The auth.users row needs an email: inserting one now fires the N-20
      // trigger, which copies NEW.email into user_profiles.email — and that
      // column is NOT NULL. A seed without an email failed there and looked
      // like the status CHECK rejecting the value, which is a different and
      // much more alarming thing.
      await db.exec(`
        insert into auth.users(id, email)
          values ('90000000-0000-0000-0000-000000000001', 'seed@example.com')
          on conflict do nothing;
        insert into public.creators(id, name, email)
          values ('91000000-0000-0000-0000-000000000001','Seed','seed-creator@example.com')
          on conflict do nothing;
        insert into public.creator_earnings(id, creator_id, earning_type, amount, status)
        values (gen_random_uuid(), '91000000-0000-0000-0000-000000000001',
                'base_video_pay', 10, '${status}');
      `);
      R(true, `creator_earnings accepts status='${status}'`, 'N-03 closed');
    } catch (e) {
      R(false, `creator_earnings accepts status='${status}'`, e.message.slice(0, 90));
    }
  }

  await db.close();

  // --- the excluded migration, proven excluded for a reason -----------------

  console.log('\n  --- why ' + EXCLUDED + ' stays out ---\n');

  if (!fs.existsSync(path.join(MIG, EXCLUDED))) {
    R(true, 'the superseded migration is absent from the repo', 'nothing to exclude');
  } else {
    const db2 = await fresh();
    let broke = false, message = '';
    try {
      for (const f of ORDER.slice(0, ORDER.indexOf('20260822000005_tenant_policy_reset.sql'))) {
        const p = path.join(MIG, f);
        if (fs.existsSync(p)) await db2.exec(fs.readFileSync(p, 'utf8'));
      }
      await db2.exec(fs.readFileSync(path.join(MIG, EXCLUDED), 'utf8'));
      // Now try to read campaigns as a non-superuser, where RLS applies.
      await db2.exec("grant select on public.campaigns to authenticated; set role authenticated;");
      await db2.query('select count(*) from public.campaigns');
      await db2.exec('reset role;');
    } catch (e) {
      broke = /infinite recursion|42P17/i.test(e.message);
      message = String(e.message).split('\n')[0].slice(0, 110);
    }
    R(broke, 'applying it alone breaks every campaign read (42P17)',
      broke ? message : 'it did NOT break — re-check whether the exclusion is still needed');
    await db2.close();
  }

  console.log('\n  ' + applied + ' of ' + ORDER.length + ' migrations applied');
  console.log('  ' + pass + ' passed, ' + fail + ' failed\n');

  if (fail === 0) {
    console.log('  The whole set composes. The payout chain can be proven locally');
    console.log('  without waiting for anyone to touch the production database.\n');
  }

  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\nHARNESS ERROR:', e); process.exit(2); });
