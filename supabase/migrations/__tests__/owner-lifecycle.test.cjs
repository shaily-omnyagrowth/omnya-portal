// supabase/migrations/__tests__/owner-lifecycle.test.cjs
//
// Acceptance for 20260823000000_owner_lifecycle_controls.sql, against a real
// PostgreSQL engine (PGlite). Same conventions as new-migrations.test.cjs.
//
// The three questions every migration test here answers:
//   1. does it apply at all, on a database that only has the core tables?
//   2. is it idempotent -- does a second apply succeed unchanged?
//   3. does the behaviour it promises actually happen?
//
// Question 3 is the whole point. This migration's promise is that a record
// cannot be destroyed and that every sensitive change leaves a trace, so the
// tests try to destroy things and insist they fail.
//
//   node supabase/migrations/__tests__/owner-lifecycle.test.cjs

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
const read = (p) => fs.readFileSync(p, 'utf8');

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};

const LIFECYCLE = '20260823000000_owner_lifecycle_controls.sql';
const ROLLBACK  = '20260823000000_owner_lifecycle_controls.rollback.sql';

const OWNER   = '11111111-1111-1111-1111-111111111111';
const CREATOR = '22222222-2222-2222-2222-222222222222';

async function fresh() {
  const db = await PGlite.create();
  await db.exec(read(S + '/fixture_schema.sql'));

  // fixture_schema.sql is a minimal stand-in and predates this migration. Two
  // columns the audit triggers read exist in production but not in it:
  //
  //   payments.amount_owed   from the original SETUP_FROM_SCRATCH schema; the
  //                          fixture only carries the newer `amount`, and the
  //                          void trigger coalesces across both because live
  //                          rows populate one or the other.
  //   submissions.feedback   the review note the decision audit records.
  //
  // Added here rather than to the shared fixture so the other suites keep
  // testing against exactly the schema they were written for.
  await db.exec(`
    ALTER TABLE public.payments    ADD COLUMN IF NOT EXISTS amount_owed NUMERIC;
    ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS feedback    TEXT;
  `);

  return db;
}

const one = async (db, sql) => (await db.query(sql)).rows[0];
const rows = async (db, sql) => (await db.query(sql)).rows;

// The fixture's auth.uid() reads a session GUC, which is how these tests
// impersonate somebody.
const actAs = (db, uid) =>
  db.exec(uid ? `SET LOCAL ROLE NONE; SELECT set_config('request.jwt.claim.sub', '${uid}', false);`
              : `SELECT set_config('request.jwt.claim.sub', '', false);`);

async function seed(db) {
  await db.exec(`
    INSERT INTO auth.users (id) VALUES ('${OWNER}'), ('${CREATOR}')
      ON CONFLICT DO NOTHING;

    INSERT INTO public.user_profiles (id, email, full_name, role)
    VALUES ('${OWNER}',   'owner@test.com',   'Test Owner',   'owner'),
           ('${CREATOR}', 'creator@test.com', 'Test Creator', 'creator')
      ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.creators (id, user_id, name, email)
    VALUES ('33333333-3333-3333-3333-333333333333', '${CREATOR}', 'Test Creator', 'creator@test.com')
      ON CONFLICT DO NOTHING;

    INSERT INTO public.clients (id, name)
    VALUES ('44444444-4444-4444-4444-444444444444', 'Acme')
      ON CONFLICT DO NOTHING;

    INSERT INTO public.campaigns (id, name, client_id, status)
    VALUES ('55555555-5555-5555-5555-555555555555', 'Summer Push',
            '44444444-4444-4444-4444-444444444444', 'Open')
      ON CONFLICT DO NOTHING;

    INSERT INTO public.payments (id, creator_id, amount_owed, status)
    VALUES ('66666666-6666-6666-6666-666666666666',
            '33333333-3333-3333-3333-333333333333', 250.00, 'Pending')
      ON CONFLICT DO NOTHING;
  `);
}

async function main() {
  console.log('\nOwner lifecycle controls — 20260823000000\n');

  // ── 1. it applies ──────────────────────────────────────────────────────────
  let db = await fresh();
  try {
    await db.exec(read(path.join(MIG, LIFECYCLE)));
    R(true, 'the migration applies on the core schema');
  } catch (e) {
    R(false, 'the migration applies on the core schema', e.message);
    console.log(`\n${pass} passed, ${fail} failed\n`);
    process.exit(1);
  }

  // ── 2. it is idempotent ────────────────────────────────────────────────────
  try {
    await db.exec(read(path.join(MIG, LIFECYCLE)));
    R(true, 'a second apply succeeds (idempotent)');
  } catch (e) {
    R(false, 'a second apply succeeds (idempotent)', e.message);
  }

  // ── 3. structure ───────────────────────────────────────────────────────────
  const t = await one(db, `SELECT to_regclass('public.admin_audit_logs') IS NOT NULL AS ok`);
  R(t.ok, 'admin_audit_logs exists');

  const cols = await rows(db, `
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='user_profiles'
      AND column_name IN ('status','deactivated_at','deactivated_by',
                          'deactivation_reason','role_before_deactivation',
                          'role_changed_by','role_changed_at')`);
  R(cols.length === 7, 'user_profiles gained all 7 lifecycle columns', `found ${cols.length}`);

  for (const [tbl, col] of [['clients','archived_at'], ['campaigns','archived_at'],
                            ['account_managers','status'], ['payments','voided_at'],
                            ['submissions','reviewed_by']]) {
    const c = await one(db, `
      SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema='public' AND table_name='${tbl}' AND column_name='${col}'`);
    R(c.n === 1, `${tbl}.${col} exists`);
  }

  // ── 4. hard deletes are refused ────────────────────────────────────────────
  await seed(db);

  for (const [tbl, id] of [
    ['payments',  '66666666-6666-6666-6666-666666666666'],
    ['campaigns', '55555555-5555-5555-5555-555555555555'],
  ]) {
    try {
      await db.exec(`DELETE FROM public.${tbl} WHERE id='${id}'`);
      R(false, `DELETE on ${tbl} is refused`, 'the delete succeeded');
    } catch (e) {
      const named = /archive|void|never hard-deleted/i.test(e.message);
      R(named, `DELETE on ${tbl} is refused, and the error names the alternative`,
        named ? '' : e.message);
    }
  }

  // The row must still be there — a refused delete that silently removed the
  // row anyway would be the worst possible outcome.
  const still = await one(db, `SELECT count(*)::int AS n FROM public.payments WHERE id='66666666-6666-6666-6666-666666666666'`);
  R(still.n === 1, 'the refused row is still present');

  // ── 5. audit on role change ────────────────────────────────────────────────
  await actAs(db, OWNER);
  await db.exec(`UPDATE public.user_profiles SET role='am' WHERE id='${CREATOR}'`);

  let ev = await one(db, `
    SELECT action, from_value, to_value, actor_user_id, entity_label
    FROM public.admin_audit_logs WHERE entity_type='user' ORDER BY occurred_at DESC LIMIT 1`);
  R(ev && ev.action === 'role_changed', 'a role change writes an audit entry');
  R(ev && ev.from_value === 'creator' && ev.to_value === 'am',
    'the entry records both the old and the new role', ev ? `${ev.from_value} -> ${ev.to_value}` : '');
  R(ev && ev.actor_user_id === OWNER, 'the actor is auth.uid()');
  R(ev && ev.entity_label === 'creator@test.com', 'the target is denormalised onto the entry');

  // ── 6. the service-role path still gets an actor ───────────────────────────
  // auth.uid() is NULL for a service-role connection, which is how every
  // api/admin/* route reaches the database. The actor has to survive that.
  await actAs(db, null);
  await db.exec(`
    UPDATE public.user_profiles
    SET status='deactivated', role_before_deactivation=role,
        deactivated_at=now(), deactivated_by='${OWNER}',
        deactivation_reason='left the agency'
    WHERE id='${CREATOR}'`);

  ev = await one(db, `
    SELECT action, actor_user_id, reason FROM public.admin_audit_logs
    WHERE action='user_deactivated' ORDER BY occurred_at DESC LIMIT 1`);
  R(!!ev, 'deactivation writes an audit entry');
  R(ev && ev.actor_user_id === OWNER,
    'the actor survives a service-role write (auth.uid() is NULL)',
    ev ? String(ev.actor_user_id) : '');
  R(ev && ev.reason === 'left the agency', 'the reason is recorded');

  // ── 7. a deactivated user loses their role everywhere ──────────────────────
  await actAs(db, CREATOR);
  const role = await one(db, `SELECT public.current_user_role() AS r`);
  R(role.r === 'deactivated',
    'current_user_role() returns deactivated, so every RLS policy refuses them',
    `got ${role.r}`);

  // ── 8. restore returns the previous role ───────────────────────────────────
  await actAs(db, OWNER);
  await db.exec(`
    UPDATE public.user_profiles
    SET status='active', role=role_before_deactivation,
        role_before_deactivation=NULL, deactivated_at=NULL,
        deactivated_by=NULL, deactivation_reason=NULL
    WHERE id='${CREATOR}'`);

  await actAs(db, CREATOR);
  const back = await one(db, `SELECT public.current_user_role() AS r`);
  R(back.r === 'am', 'restore brings back the exact previous role', `got ${back.r}`);

  // ── 9. archive is audited ──────────────────────────────────────────────────
  await actAs(db, OWNER);
  await db.exec(`
    UPDATE public.campaigns SET status='Archived', archived_at=now(),
      archived_by='${OWNER}', archive_reason='client ended'
    WHERE id='55555555-5555-5555-5555-555555555555'`);

  ev = await one(db, `
    SELECT action, entity_label, reason FROM public.admin_audit_logs
    WHERE entity_type='campaign' ORDER BY occurred_at DESC LIMIT 1`);
  R(ev && ev.action === 'campaign_archived', 'archiving a campaign is audited');
  R(ev && ev.entity_label === 'Summer Push', 'the campaign name is on the entry');

  // The campaign must still be readable — that is the difference between
  // archiving and deleting.
  const kept = await one(db, `SELECT status FROM public.campaigns WHERE id='55555555-5555-5555-5555-555555555555'`);
  R(kept && kept.status === 'Archived', 'the archived campaign is still there');

  // ── 10. content review decisions are audited (§5.1) ────────────────────────
  await db.exec(`
    INSERT INTO public.submissions (id, creator_id, campaign_id, concept_status)
    VALUES ('77777777-7777-7777-7777-777777777777',
            '33333333-3333-3333-3333-333333333333',
            '55555555-5555-5555-5555-555555555555', 'Pending')`);
  await db.exec(`
    UPDATE public.submissions SET final_status='Approved', reviewed_by='${OWNER}'
    WHERE id='77777777-7777-7777-7777-777777777777'`);

  ev = await one(db, `
    SELECT action, to_value FROM public.admin_audit_logs
    WHERE entity_type='submission' ORDER BY occurred_at DESC LIMIT 1`);
  R(ev && ev.action === 'final_review', 'a review decision is audited');
  R(ev && ev.to_value === 'Approved', 'the decision itself is recorded');

  // ── 11. the audit trail is append-only ─────────────────────────────────────
  try {
    await db.exec(`UPDATE public.admin_audit_logs SET action='tampered'`);
    R(false, 'UPDATE on admin_audit_logs is refused', 'the update succeeded');
  } catch (e) {
    R(/append-only/i.test(e.message), 'UPDATE on admin_audit_logs is refused');
  }

  try {
    await db.exec(`DELETE FROM public.admin_audit_logs`);
    R(false, 'DELETE on admin_audit_logs is refused', 'the delete succeeded');
  } catch (e) {
    R(/append-only/i.test(e.message), 'DELETE on admin_audit_logs is refused');
  }

  // ── 12. an unrelated update produces no noise ──────────────────────────────
  const before = await one(db, `SELECT count(*)::int AS n FROM public.admin_audit_logs`);
  await db.exec(`UPDATE public.user_profiles SET full_name='Renamed' WHERE id='${CREATOR}'`);
  const after = await one(db, `SELECT count(*)::int AS n FROM public.admin_audit_logs`);
  R(before.n === after.n,
    'renaming a user writes nothing — only sensitive changes are journalled',
    `${before.n} -> ${after.n}`);

  // ── 13. rollback ───────────────────────────────────────────────────────────
  try {
    await db.exec(read(path.join(MIG, ROLLBACK)));
    R(true, 'the rollback applies');
  } catch (e) {
    R(false, 'the rollback applies', e.message);
  }

  try {
    await db.exec(`DELETE FROM public.payments WHERE id='66666666-6666-6666-6666-666666666666'`);
    R(true, 'after rollback, DELETE on payments works again (as the header warns)');
  } catch (e) {
    R(false, 'after rollback, DELETE on payments works again', e.message);
  }

  const survived = await one(db, `SELECT count(*)::int AS n FROM public.admin_audit_logs`);
  R(survived.n > 0, 'the rollback keeps the audit trail', `${survived.n} entries`);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('\nHARNESS ERROR:', e);
  process.exit(2);
});
