// supabase/migrations/__tests__/new-migrations.test.cjs
//
// Acceptance for the 2026-08-22 migrations, against a real PostgreSQL engine
// (PGlite). Companion to migration.test.cjs, same conventions.
//
// It answers three questions that reading SQL cannot:
//   1. does it apply at all, on a database that only has the core tables?
//   2. is it idempotent -- does a second apply succeed unchanged?
//   3. does the behaviour it promises actually happen?
//
// Question 3 is the one that matters for F-10. The whole point of
// campaign_creators is that a dangling creator id becomes impossible, so the
// test seeds a dangling id on purpose and insists it is gone afterwards.
//
//   node supabase/migrations/__tests__/new-migrations.test.cjs

const fs = require('fs');
const path = require('path');

let PGlite;
try {
  ({ PGlite } = require('@electric-sql/pglite'));
} catch {
  console.error('SKIP: @electric-sql/pglite is not installed.  npm i -D @electric-sql/pglite');
  process.exit(0);
}

const S = __dirname;
const MIG = path.join(__dirname, '..');
const read = p => fs.readFileSync(p, 'utf8');

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};

const TIKTOK = '20260604000000_tiktok_integration.sql';
const CAMPCR = '20260822000003_campaign_creators.sql';
const LEDGER = '20260822000004_payout_ledger.sql';
const SIGNUP = '20260822000006_signup_pending_role.sql';

async function fresh() {
  const db = await PGlite.create();
  await db.exec(read(S + '/fixture_schema.sql'));
  return db;
}

const one = async (db, sql) => (await db.query(sql)).rows[0];

// ---------------------------------------------------------------------------

async function applies(file) {
  console.log('\n' + file);
  const db = await fresh();

  try {
    await db.exec(read(path.join(MIG, file)));
    R(true, 'applies to a fresh database');
  } catch (e) {
    R(false, 'applies to a fresh database', e.message.slice(0, 300));
    await db.close();
    return null;
  }

  try {
    await db.exec(read(path.join(MIG, file)));
    R(true, 'is idempotent (applies a second time)');
  } catch (e) {
    R(false, 'is idempotent (applies a second time)', e.message.slice(0, 300));
  }

  return db;
}

async function tiktokShape(db) {
  for (const t of ['creator_social_accounts', 'creator_videos', 'video_metrics']) {
    const r = await one(db, "select to_regclass('public." + t + "') is not null as ok");
    R(r.ok, 'creates ' + t);
  }

  // The ON CONFLICT arbiter the OAuth callback depends on.
  const u = await one(db,
    "select count(*)::int as n from pg_constraint " +
    "where conrelid = 'public.creator_social_accounts'::regclass and contype = 'u'");
  R(u.n > 0, 'creator_social_accounts has a unique constraint for ON CONFLICT', u.n + ' found');

  // The tokens must not be reachable through a view meant for the browser.
  const v = await one(db, "select to_regclass('public.creator_social_accounts_safe') is not null as ok");
  if (v.ok) {
    const cols = await db.query(
      "select column_name from information_schema.columns " +
      "where table_name = 'creator_social_accounts_safe'");
    // Match secret-BEARING columns only. A first pass used /token/i and
    // reported token_expires_at and refresh_token_expires_at as leaks; those
    // are timestamps, and the connections UI needs them to tell a creator when
    // to reconnect. Naming a harmless column a critical leak is the failure
    // mode this whole harness exists to prevent, so the rule names the three
    // columns that actually carry secret material.
    const SECRET_COL = /^(access_token|refresh_token)(_encrypted)?$/i;
    const leaked = cols.rows.map(r => r.column_name).filter(c => SECRET_COL.test(c));
    R(leaked.length === 0, 'the safe view exposes no token-bearing column',
      leaked.length ? 'LEAKS: ' + leaked.join(', ')
                    : 'timestamps only: ' + cols.rows.map(r => r.column_name)
                        .filter(c => /token/i.test(c)).join(', '));
  } else {
    R(false, 'a browser-safe view exists', 'creator_social_accounts_safe not found');
  }

  const rls = await db.query(
    "select relname, relrowsecurity from pg_class " +
    "where relname in ('creator_social_accounts','creator_videos','video_metrics')");
  const off = rls.rows.filter(r => !r.relrowsecurity).map(r => r.relname);
  R(off.length === 0, 'RLS is enabled on all three tables',
    off.length ? 'OFF: ' + off.join(', ') : 'all on');
}

async function campaignCreatorsBehaviour() {
  console.log('\n' + CAMPCR + ' -- behaviour');
  const db = await fresh();

  // Seed BEFORE the migration: one real creator and one id naming nothing.
  // The dangling id is the corruption F-10 exists to describe.
  await db.exec(
    "insert into auth.users(id) values ('11111111-1111-1111-1111-111111111111');" +
    "insert into public.clients(id, name) values ('c1111111-1111-1111-1111-111111111111', 'Acme');" +
    "insert into public.creators(id, name) values ('a1111111-1111-1111-1111-111111111111', 'Real Creator');" +
    "insert into public.campaigns(id, name, client_id, assigned_creators) values (" +
    "  'ca111111-1111-1111-1111-111111111111', 'Launch'," +
    "  'c1111111-1111-1111-1111-111111111111'," +
    "  array['a1111111-1111-1111-1111-111111111111'," +
    "        'dead0000-0000-0000-0000-000000000000']::uuid[]);");

  try {
    await db.exec(read(path.join(MIG, CAMPCR)));
  } catch (e) {
    R(false, 'applies over pre-existing dangling data', e.message.slice(0, 300));
    await db.close();
    return;
  }
  R(true, 'applies over pre-existing dangling data');

  const rows = await db.query('select creator_id::text from public.campaign_creators');
  R(rows.rows.length === 1 && rows.rows[0].creator_id.startsWith('a1111111'),
    'backfill keeps the real assignment and refuses the dangling one',
    rows.rows.length + ' row(s)');

  const arr = await one(db,
    "select coalesce(array_length(assigned_creators,1),0)::int as n, " +
    "       coalesce(array_to_string(assigned_creators, ','),'') as ids " +
    "from public.campaigns where id = 'ca111111-1111-1111-1111-111111111111'");
  R(arr.n === 1 && arr.ids.indexOf('dead0000') === -1,
    'the dangling id is scrubbed from campaigns.assigned_creators', '[' + arr.ids + ']');

  // Junction -> array mirror.
  await db.exec(
    "insert into public.creators(id, name) values ('a2222222-2222-2222-2222-222222222222', 'Second');" +
    "insert into public.campaign_creators(campaign_id, creator_id) values " +
    "  ('ca111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222');");
  const after = await one(db,
    "select coalesce(array_length(assigned_creators,1),0)::int as n " +
    "from public.campaigns where id = 'ca111111-1111-1111-1111-111111111111'");
  R(after.n === 2, 'inserting an assignment mirrors into the array', 'n=' + after.n);

  await db.exec("delete from public.campaign_creators " +
                "where creator_id = 'a2222222-2222-2222-2222-222222222222'");
  const afterDel = await one(db,
    "select coalesce(array_length(assigned_creators,1),0)::int as n " +
    "from public.campaigns where id = 'ca111111-1111-1111-1111-111111111111'");
  R(afterDel.n === 1, 'deleting an assignment mirrors into the array', 'n=' + afterDel.n);

  // Array -> junction compatibility path (src/App.js still writes the array).
  await db.exec(
    "update public.campaigns " +
    "   set assigned_creators = array['a1111111-1111-1111-1111-111111111111'," +
    "                                 'a2222222-2222-2222-2222-222222222222']::uuid[] " +
    " where id = 'ca111111-1111-1111-1111-111111111111'");
  const back = await one(db, 'select count(*)::int as n from public.campaign_creators');
  R(back.n === 2, 'a direct array write is reconciled into campaign_creators', 'n=' + back.n);

  // The core F-10 promise: a dangling id can no longer be introduced at all.
  await db.exec(
    "update public.campaigns " +
    "   set assigned_creators = array['a1111111-1111-1111-1111-111111111111'," +
    "                                 'beef0000-0000-0000-0000-000000000000']::uuid[] " +
    " where id = 'ca111111-1111-1111-1111-111111111111'");
  const guard = await one(db,
    "select coalesce(array_to_string(assigned_creators, ','),'') as ids " +
    "from public.campaigns where id = 'ca111111-1111-1111-1111-111111111111'");
  R(guard.ids.indexOf('beef0000') === -1,
    'a dangling id written to the array is rejected, not stored', '[' + guard.ids + ']');

  // And the FK does the real work when a creator is deleted.
  await db.exec("delete from public.creators where id = 'a1111111-1111-1111-1111-111111111111'");
  const cascaded = await one(db,
    "select count(*)::int as n from public.campaign_creators " +
    "where creator_id = 'a1111111-1111-1111-1111-111111111111'");
  R(cascaded.n === 0, 'deleting a creator cascades the assignment away', 'n=' + cascaded.n);

  const arrFinal = await one(db,
    "select coalesce(array_to_string(assigned_creators, ','),'') as ids " +
    "from public.campaigns where id = 'ca111111-1111-1111-1111-111111111111'");
  R(arrFinal.ids.indexOf('a1111111') === -1,
    'and the array follows the cascade -- no resurrected id', '[' + arrFinal.ids + ']');

  await db.close();
}

async function ledgerBehaviour() {
  console.log('\n' + LEDGER + ' -- behaviour');
  const db = await fresh();

  const CREATOR = 'a1111111-1111-1111-1111-111111111111';
  const USER = '11111111-1111-1111-1111-111111111111';
  const EARN = 'e1111111-1111-1111-1111-111111111111';

  await db.exec(
    "insert into auth.users(id) values ('" + USER + "');" +
    "insert into public.user_profiles(id, email, role) values ('" + USER + "', 'o@x.com', 'owner');" +
    "insert into public.creators(id, name, user_id) values ('" + CREATOR + "', 'Creator', '" + USER + "');" +
    "insert into public.creator_earnings(id, creator_id, amount, status) values ('" + EARN + "', '" + CREATOR + "', 400.00, 'pending');");

  try {
    await db.exec(read(path.join(MIG, LEDGER)));
    R(true, 'applies to a fresh database');
  } catch (e) {
    R(false, 'applies to a fresh database', e.message.slice(0, 300));
    await db.close();
    return;
  }
  try {
    await db.exec(read(path.join(MIG, LEDGER)));
    R(true, 'is idempotent (applies a second time)');
  } catch (e) {
    R(false, 'is idempotent (applies a second time)', e.message.slice(0, 300));
  }

  // A status move must leave a trace, even from a bare UPDATE like this one.
  await db.exec("update public.creator_earnings set status = 'approved' where id = '" + EARN + "'");
  let n = await one(db, 'select count(*)::int as n from public.payout_ledger');
  R(n.n === 1, 'a bare UPDATE of status appends a ledger row', 'rows=' + n.n);

  let e = await one(db,
    "select from_status, to_status, amount_delta::float8 as d " +
    "from public.payout_ledger order by occurred_at desc limit 1");
  R(e.from_status === 'pending' && e.to_status === 'approved',
    'the transition is recorded both ends', e.from_status + ' -> ' + e.to_status);
  R(Number(e.d) === 400, 'pending -> approved credits the balance', 'delta=' + e.d);

  let bal = await one(db, "select public.payout_ledger_balance('" + CREATOR + "')::float8 as b");
  R(Number(bal.b) === 400, 'the balance is 400 after approval', 'balance=' + bal.b);

  // Paid means no longer owed, so the balance must return to zero.
  await db.exec("update public.creator_earnings set status = 'paid' where id = '" + EARN + "'");
  bal = await one(db, "select public.payout_ledger_balance('" + CREATOR + "')::float8 as b");
  R(Number(bal.b) === 0, 'approved -> paid returns the balance to zero', 'balance=' + bal.b);

  n = await one(db, 'select count(*)::int as n from public.payout_ledger');
  R(n.n === 2, 'and the earlier entry is still there -- nothing overwritten', 'rows=' + n.n);

  // Append-only, enforced against the owner connection, not just via grants.
  let blockedUpdate = false;
  try { await db.exec("update public.payout_ledger set amount_delta = 0"); }
  catch (err) { blockedUpdate = /append-only/i.test(err.message); }
  R(blockedUpdate, 'UPDATE on payout_ledger is refused');

  let blockedDelete = false;
  try { await db.exec('delete from public.payout_ledger'); }
  catch (err) { blockedDelete = /append-only/i.test(err.message); }
  R(blockedDelete, 'DELETE on payout_ledger is refused');

  // Reconciliation, while the journal and the table still agree. This has to
  // be asserted BEFORE the reversal below: a reversal deliberately moves the
  // ledger away from the table, so checking afterwards and demanding zero
  // drift would be asserting that reversals do nothing.
  let drift = await db.query('select drift::float8 as drift from public.payout_ledger_reconcile()');
  let bad = drift.rows.filter(r => Math.abs(Number(r.drift)) > 0.001);
  R(bad.length === 0, 'ledger reconciles against creator_earnings with zero drift',
    bad.length ? 'DRIFT: ' + JSON.stringify(bad) : drift.rows.length + ' creator(s) checked');

  // A correction is a new row, never an edit.
  const first = await one(db,
    "select id::text as id, amount_delta::float8 as d from public.payout_ledger " +
    "order by occurred_at asc limit 1");
  await db.query("select public.reverse_ledger_entry('" + first.id + "', 'approved in error')");
  const rev = await one(db,
    "select amount_delta::float8 as d, reason, reverses_entry_id::text as r " +
    "from public.payout_ledger where reverses_entry_id is not null");
  R(Number(rev.d) === -Number(first.d), 'the reversal negates the original amount', 'delta=' + rev.d);
  R(rev.r === first.id && rev.reason === 'approved in error',
    'and it points at what it reverses, with a reason');

  const orig = await one(db,
    "select amount_delta::float8 as d from public.payout_ledger where id = '" + first.id + "'");
  R(Number(orig.d) === Number(first.d), 'the original row is untouched', 'delta=' + orig.d);

  let doubleRev = false;
  try { await db.query("select public.reverse_ledger_entry('" + first.id + "', 'again')"); }
  catch (err) { doubleRev = /already been reversed/i.test(err.message); }
  R(doubleRev, 'reversing the same entry twice is refused');

  let noReason = false;
  try { await db.query("select public.reverse_ledger_entry('" + first.id + "', '  ')"); }
  catch (err) { noReason = /reason is required/i.test(err.message); }
  R(noReason, 'a reversal without a reason is refused');

  // And now the other half: reconciliation has to be able to SEE a divergence,
  // otherwise it is decoration. The reversal above deliberately withdrew a 400
  // approval that creator_earnings no longer reflects, so drift must now be
  // exactly -400. A reconciler that still reported zero here would be useless
  // for its actual job -- catching a status written around the trigger.
  drift = await db.query(
    "select drift::float8 as drift from public.payout_ledger_reconcile('" + CREATOR + "')");
  const d = drift.rows.length ? Number(drift.rows[0].drift) : null;
  R(d === -400, 'and reconciliation detects the divergence the reversal created',
    'drift=' + d);

  await db.close();
}

async function signupTrigger() {
  console.log('\n' + SIGNUP + ' -- behaviour');
  const db = await fresh();

  try {
    await db.exec(read(path.join(MIG, SIGNUP)));
    R(true, 'applies to a fresh database');
  } catch (e) {
    R(false, 'applies to a fresh database', e.message.slice(0, 300));
    await db.close();
    return;
  }
  try {
    await db.exec(read(path.join(MIG, SIGNUP)));
    R(true, 'is idempotent (applies a second time)');
  } catch (e) {
    R(false, 'is idempotent (applies a second time)', e.message.slice(0, 300));
  }

  // The whole point: signing up must not grant a working role.
  await db.exec(
    "insert into auth.users(id, email, raw_user_meta_data) values " +
    "('22222222-2222-2222-2222-222222222222', 'new@example.com', " +
    " '{\"requested_role\":\"creator\",\"full_name\":\"New Person\"}'::jsonb);");

  const p = await one(db,
    "select role, requested_role, full_name from public.user_profiles " +
    "where id = '22222222-2222-2222-2222-222222222222'");
  R(!!p, 'a signup still creates the profile row');
  R(p && p.role === 'pending', 'the granted role is pending, not creator', 'role=' + (p && p.role));
  R(p && p.requested_role === 'creator', 'and what they asked for is recorded',
    'requested=' + (p && p.requested_role));
  R(p && p.full_name === 'New Person', 'the name from signup metadata is kept');

  // An attacker asking for 'owner' in the signup payload must not get it, and
  // must not get it recorded as a pending request either.
  await db.exec(
    "insert into auth.users(id, email, raw_user_meta_data) values " +
    "('33333333-3333-3333-3333-333333333333', 'sneaky@example.com', " +
    " '{\"requested_role\":\"owner\"}'::jsonb);");
  const s = await one(db,
    "select role, requested_role from public.user_profiles " +
    "where id = '33333333-3333-3333-3333-333333333333'");
  R(s && s.role === 'pending', 'requesting owner still lands in pending', 'role=' + (s && s.role));
  R(s && s.requested_role === 'creator',
    'an unrecognised requested_role falls back to creator, not owner',
    'requested=' + (s && s.requested_role));

  // 'am' is the UI spelling; the database spelling is account_manager.
  await db.exec(
    "insert into auth.users(id, email, raw_user_meta_data) values " +
    "('44444444-4444-4444-4444-444444444444', 'am@example.com', " +
    " '{\"requested_role\":\"am\"}'::jsonb);");
  const a = await one(db,
    "select requested_role from public.user_profiles " +
    "where id = '44444444-4444-4444-4444-444444444444'");
  R(a && a.requested_role === 'account_manager',
    "the UI's 'am' is normalised to 'account_manager'", 'requested=' + (a && a.requested_role));

  await db.close();
}

(async () => {
  console.log('Migrations of 2026-08-22, against real PostgreSQL (PGlite)\n');

  const tdb = await applies(TIKTOK);
  if (tdb) { await tiktokShape(tdb); await tdb.close(); }

  const cdb = await applies(CAMPCR);
  if (cdb) await cdb.close();

  await campaignCreatorsBehaviour();
  await ledgerBehaviour();
  await signupTrigger();

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\nHARNESS ERROR:', e); process.exit(2); });
