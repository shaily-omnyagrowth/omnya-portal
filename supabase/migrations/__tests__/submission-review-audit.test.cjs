// supabase/migrations/__tests__/submission-review-audit.test.cjs
//
// Regression test for 20261023000001_fix_submission_review_audit.sql.
//
// THE BUG: 20260826000000 dropped submissions.concept_status and final_status
// (replaced by `status`), but the AFTER UPDATE trigger from 20260823000000,
// audit_submission_review(), still compared NEW.concept_status with
// OLD.concept_status. PL/pgSQL resolves record fields when the line runs, so
// EVERY update of a submission failed with
//
//     record "new" has no field "concept_status"
//
// including the review decision in src/App.js and the stats save. Confirmed on
// the live database 2026-10-23 (the trigger is enabled, the columns are gone).
//
// This suite builds the real chain (as full-chain.test.cjs), proves the update
// fails without the fix, then applies the fix and checks that updates work and
// that a status change is still audited, with the reviewer as actor.
//
//   node supabase/migrations/__tests__/submission-review-audit.test.cjs

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
const FIX = '20261023000001_fix_submission_review_audit.sql';

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};

const OWNER = '00000000-0000-0000-0000-0000000000ff';
const CR = 'e0000000-0000-0000-0000-000000000001';
const SUB = '50000000-0000-0000-0000-000000000001';

async function build() {
  const chainSrc = read(path.join(S, 'full-chain.test.cjs'));
  const BOOT = chainSrc.match(/const BOOTSTRAP = `([\s\S]*?)`;/)[1];
  const ORDER = [...chainSrc.match(/const ORDER = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+\.sql)'/g)].map(x => x[1]);
  // Everything up to, but not including, the fix: the state production is in.
  const later = fs.readdirSync(MIG)
    .filter(f => /^\d{14}_.*\.sql$/.test(f) && !ORDER.includes(f) && f < FIX)
    .sort();

  const db = await PGlite.create();
  await db.exec(BOOT);
  await db.exec(read(path.join(MIG, '..', 'SETUP.sql')));
  for (const f of [...ORDER, ...later]) await db.exec(read(path.join(MIG, f)));

  await db.exec(`
    insert into auth.users(id, email) values ('${OWNER}','owner@x.com') on conflict do nothing;
    insert into public.user_profiles(id, email, role) values ('${OWNER}','owner@x.com','owner')
      on conflict (id) do update set role = excluded.role;
    insert into public.creators(id, name, email) values ('${CR}','Creator One','cre1@x.com');
    insert into public.submissions(id, creator_id, submission_type, status)
      values ('${SUB}','${CR}','Final','Under Review');
  `);
  return db;
}

const tryExec = async (db, sql) => {
  try { await db.exec(sql); return null; } catch (e) { return e.message; }
};
const reviewRows = async (db) => (await db.query(
  `select action, from_value, to_value, reason, actor_user_id, actor_role, metadata
     from public.admin_audit_logs where entity_type='submission' and entity_id='${SUB}'`)).rows;

(async () => {
  console.log(`\n${FIX}`);
  const db = await build();

  // ---- the bug, reproduced ---------------------------------------------------
  let err = await tryExec(db, `update public.submissions set feedback = 'nice' where id='${SUB}'`);
  R(!!err && /has no field "concept_status"/.test(err),
    'before the fix, any submissions update fails on the dropped column', err || 'it did NOT fail');

  // ---- the fix ---------------------------------------------------------------
  err = await tryExec(db, read(path.join(MIG, FIX)));
  R(!err, 'the fix applies', err);
  err = await tryExec(db, read(path.join(MIG, FIX)));
  R(!err, 'and is idempotent', err);

  err = await tryExec(db, `update public.submissions set feedback = 'nice' where id='${SUB}'`);
  R(!err, 'an update that does not touch status now succeeds', err);
  R((await reviewRows(db)).length === 0, 'and writes no audit row');

  err = await tryExec(db,
    `update public.submissions set status = 'Approved', feedback = 'great work', reviewed_by = '${OWNER}'
      where id='${SUB}'`);
  R(!err, 'the review decision (status change) succeeds', err);
  const rows = await reviewRows(db);
  const row = rows[0];
  R(rows.length === 1 && row.action === 'submission_review' && row.from_value === 'Under Review' &&
    row.to_value === 'Approved' && row.reason === 'great work',
    'and is audited once, from the old status to the new, with the feedback', JSON.stringify(rows));
  R(row && row.actor_user_id === OWNER && row.actor_role === 'owner',
    'with the reviewer as actor (reviewed_by fallback for service role calls)', row && `${row.actor_user_id} ${row.actor_role}`);
  R(row && row.metadata && row.metadata.creator_id === CR && row.metadata.submission_type === 'Final',
    'and the creator and submission type in metadata', row && JSON.stringify(row.metadata));

  const fn = (await db.query(`select pg_get_functiondef('public.audit_submission_review()'::regprocedure) d`)).rows[0].d;
  R(!/concept_status|final_status/.test(fn), 'the trigger no longer names either dropped column');

  await db.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\nHARNESS ERROR:', e); process.exit(2); });
