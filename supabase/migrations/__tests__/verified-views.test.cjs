// Verified views: only the server sets them, and apply_verified_views only raises the count for the creator's own submission.
//
//   node supabase/migrations/__tests__/verified-views.test.cjs

const { freshDb } = require('./db.cjs');

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};

const CRE = '00000000-0000-0000-0000-000000000e01';
const OTHER = '00000000-0000-0000-0000-000000000e02';
const CR = 'e0000000-0000-0000-0000-000000000001';
const SUB = '50000000-0000-0000-0000-000000000001';

const run = async (db, sql) => { try { return { rows: (await db.query(sql)).rows }; } catch (e) { return { error: e.message, code: e.code }; } };

async function asCreator(db, sql) {
  await db.exec(`RESET ROLE; select set_config('request.jwt.claim.sub', '${CRE}', false); SET ROLE authenticated;`);
  try { return await run(db, sql); } finally { await db.exec('RESET ROLE;'); }
}

const views = async (db) => (await db.query(`select view_count_verified v, verified_views_source s from public.submissions where id = '${SUB}'`)).rows[0];
const apply = (n, src = 'oauth', user = CRE) =>
  `select public.apply_verified_views('${SUB}', ${n}, '${src}', '${user}', null) as ok`;

(async () => {
  console.log('\nverified views');
  const db = await freshDb();
  await db.exec(`
    insert into auth.users(id, email) values ('${CRE}','cre@x.com'), ('${OTHER}','other@x.com');
    insert into public.user_profiles(id, email, role) values ('${CRE}','cre@x.com','creator'), ('${OTHER}','other@x.com','creator')
      on conflict (id) do update set role = excluded.role;
    insert into public.creators(id, user_id, name, email) values ('${CR}','${CRE}','Creator','cre@x.com');
    insert into public.submissions(id, creator_id, submission_type, status) values ('${SUB}','${CR}','Final','Approved');
  `);

  let r = await asCreator(db, `update public.submissions set view_count_verified = 999 where id = '${SUB}'`);
  R(r.code === '42501', 'a creator cannot set their own verified views', r.error || 'it was allowed');

  r = await run(db, apply(500));
  R(r.rows && r.rows[0].ok === true && (await views(db)).v === 500, 'the server records views from the connected account');
  await run(db, apply(200));
  R((await views(db)).v === 500, 'a lower count never lowers verified views');
  r = await run(db, apply(800, 'oauth', OTHER));
  R(r.rows && r.rows[0].ok === false && (await views(db)).v === 500, "another creator's account cannot verify this submission");
  r = await run(db, apply(900, 'link'));
  R(r.code === '22023', 'link sourced views are refused', r.error || 'accepted');
  R((await views(db)).s === 'oauth', 'the source is oauth');

  await db.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
