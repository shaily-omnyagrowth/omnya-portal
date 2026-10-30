// A brand sees a creator only once that creator has an approved submission on one of its campaigns.
//
//   node supabase/migrations/__tests__/client-may-see-creator.test.cjs

const { freshDb } = require('./db.cjs');

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
  const db = await freshDb();

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
  console.log('\nclient_may_see_creator');
  const db = await build();

  let r = await tryQuery(db, sees(APPROVED_CR));
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
