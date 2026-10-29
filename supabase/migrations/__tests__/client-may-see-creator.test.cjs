// supabase/migrations/__tests__/client-may-see-creator.test.cjs
//
// Regression test for 20261030000000_fix_client_may_see_creator.sql: the
// function still read submissions.final_status after 20260826000000 dropped
// it, so every client read of creators failed. Builds the real chain up to the
// fix, reproduces the failure, applies the fix and checks the result.
//
//   node supabase/migrations/__tests__/client-may-see-creator.test.cjs

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
const FIX = '20261030000000_fix_client_may_see_creator.sql';

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};

const CLIENT_USER = '00000000-0000-0000-0000-0000000000c1';
const CAMPAIGN = 'ca000000-0000-0000-0000-000000000001';
const APPROVED_CR = 'e0000000-0000-0000-0000-000000000001';
const PENDING_CR = 'e0000000-0000-0000-0000-000000000002';

async function build() {
  const chainSrc = read(path.join(S, 'full-chain.test.cjs'));
  const BOOT = chainSrc.match(/const BOOTSTRAP = `([\s\S]*?)`;/)[1];
  const ORDER = [...chainSrc.match(/const ORDER = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+\.sql)'/g)].map(x => x[1]);
  const later = fs.readdirSync(MIG)
    .filter(f => /^\d{14}_.*\.sql$/.test(f) && !ORDER.includes(f) && f < FIX)
    .sort();

  const db = await PGlite.create();
  await db.exec(BOOT);
  await db.exec(read(path.join(MIG, '..', 'SETUP_FROM_SCRATCH.sql')));
  for (const f of [...ORDER, ...later]) await db.exec(read(path.join(MIG, f)));

  await db.exec(`
    insert into auth.users(id, email) values ('${CLIENT_USER}','client@x.com') on conflict do nothing;
    insert into public.user_profiles(id, email, role) values ('${CLIENT_USER}','client@x.com','client')
      on conflict (id) do update set role = excluded.role;
    insert into public.clients(name, user_id)
      select 'Brand', '${CLIENT_USER}' where not exists (select 1 from public.clients where user_id = '${CLIENT_USER}');
    insert into public.campaigns(id, name, client_id, sales_commission_rate)
      select '${CAMPAIGN}', 'Launch', id, 0.1 from public.clients where user_id = '${CLIENT_USER}';
    insert into public.creators(id, name, email) values
      ('${APPROVED_CR}','Approved Creator','a@x.com'), ('${PENDING_CR}','Pending Creator','p@x.com');
    insert into public.submissions(creator_id, campaign_id, submission_type, status) values
      ('${APPROVED_CR}','${CAMPAIGN}','Final','Approved'),
      ('${PENDING_CR}','${CAMPAIGN}','Final','Under Review');
    select set_config('request.jwt.claim.sub', '${CLIENT_USER}', false);
  `);
  return db;
}

const tryQuery = async (db, sql) => {
  try { return { rows: (await db.query(sql)).rows }; } catch (e) { return { err: e.message }; }
};
const sees = id => `select public.client_may_see_creator('${id}') as ok`;

(async () => {
  console.log(`\n${FIX}`);
  const db = await build();

  let r = await tryQuery(db, sees(APPROVED_CR));
  R(r.err && /final_status/.test(r.err), 'before the fix, the check fails on the dropped column', r.err || 'it did NOT fail');

  for (const label of ['the fix applies', 'and is idempotent']) {
    let err = null;
    try { await db.exec(read(path.join(MIG, FIX))); } catch (e) { err = e.message; }
    R(!err, label, err);
  }

  r = await tryQuery(db, sees(APPROVED_CR));
  R(!r.err && r.rows[0].ok === true, 'a client sees a creator with an approved submission on its campaign', r.err);
  r = await tryQuery(db, sees(PENDING_CR));
  R(!r.err && r.rows[0].ok === false, 'but not one whose only submission is still under review', r.err);

  await db.exec(`select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c2', false);`);
  r = await tryQuery(db, sees(APPROVED_CR));
  R(!r.err && r.rows[0].ok === false, 'and another client does not see that creator at all', r.err);

  const fn = (await db.query(`select pg_get_functiondef('public.client_may_see_creator(uuid)'::regprocedure) d`)).rows[0].d;
  R(!/final_status|concept_status/.test(fn), 'the function no longer names either dropped column');

  await db.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\nHARNESS ERROR:', e); process.exit(2); });
