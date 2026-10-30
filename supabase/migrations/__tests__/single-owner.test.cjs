// guard_owner_role(): only owner_emails can hold the owner role, outside the SQL editor.
//
//   node supabase/migrations/__tests__/single-owner.test.cjs

const { freshDb } = require('./db.cjs');

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};

const SHAILY = '00000000-0000-0000-0000-0000000005a1';
const LILI = '00000000-0000-0000-0000-0000000005a2';

(async () => {
  console.log('\nsingle owner');
  const db = await freshDb();
  for (const [id, email] of [[SHAILY, 'Shaily@omnyagrowth.com'], [LILI, 'lili@omnyagrowth.com']]) {
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
    await db.query(`insert into public.user_profiles (id, email, role) values ($1, $2, 'pending')
                    on conflict (id) do update set email = excluded.email, role = 'pending'`, [id, email]);
  }

  const promote = (id) => `update public.user_profiles set role = 'owner' where id = '${id}' returning id`;
  const tryQuery = (sql) => db.query(sql).then((r) => (r.rows.length ? null : 'no rows'), (e) => e.code);

  // The SQL editor runs as postgres. Checked first: PGlite cannot switch back after the API session below.
  R(await tryQuery(promote(LILI)) === null, 'the SQL editor (postgres) is exempt');
  await db.query(`update public.user_profiles set role = 'pending' where id = '${LILI}'`);

  // From here on, the API: PostgREST connects as authenticator and switches to service_role.
  await db.exec(`ALTER ROLE service_role BYPASSRLS; CREATE ROLE authenticator NOINHERIT LOGIN; GRANT service_role TO authenticator;`);
  await db.exec('SET SESSION AUTHORIZATION authenticator');
  await db.exec('SET ROLE service_role');

  R(await tryQuery(promote(LILI)) === '42501', 'an email not on the list cannot be made owner');
  R(await tryQuery(promote(SHAILY)) === null, 'the listed email can be made owner, whatever its case');
  R(await tryQuery(`update public.user_profiles set email = 'someone@else.com' where id = '${SHAILY}' returning id`) === '42501',
    'an owner cannot be moved to an unlisted email');
  R(await tryQuery(`update public.user_profiles set role = 'account_manager' where id = '${SHAILY}' returning id`) === null,
    'leaving the owner role is never blocked');

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
