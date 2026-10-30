// A signed in non-owner can edit their own name but not their role, email or account status.
//
//   node supabase/migrations/__tests__/guard-profile-self-update.test.cjs

const { freshDb } = require('./db.cjs');

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};

const USER = '00000000-0000-0000-0000-0000000000a1';
const OWNER = '00000000-0000-0000-0000-0000000000a2';

const run = async (db, sql) => { try { await db.exec(sql); return null; } catch (e) { return e.message; } };
const as = (id) => `select set_config('request.jwt.claim.sub', '${id}', false);`;

(async () => {
  console.log('\nuser_profiles self update guard');
  const db = await freshDb();
  await db.exec(`
    insert into auth.users(id, email) values ('${USER}','u@x.com'), ('${OWNER}','o@x.com') on conflict do nothing;
    insert into public.user_profiles(id, email, role) values ('${USER}','u@x.com','pending'), ('${OWNER}','o@x.com','owner')
      on conflict (id) do update set role = excluded.role;
  `);

  let e = await run(db, as(USER) + `update public.user_profiles set role = 'am' where id = '${USER}'`);
  R(e && /Only an owner/.test(e), 'a user cannot change their own role', e || 'it was allowed');
  e = await run(db, as(USER) + `update public.user_profiles set email = 'new@x.com' where id = '${USER}'`);
  R(e && /Only an owner/.test(e), 'or their email', e || 'it was allowed');
  R(!(await run(db, as(USER) + `update public.user_profiles set full_name = 'New Name' where id = '${USER}'`)), 'but can still change their name');
  R(!(await run(db, as(OWNER) + `update public.user_profiles set role = 'creator' where id = '${USER}'`)), 'an owner can still assign roles');
  R(!(await run(db, `select set_config('request.jwt.claim.sub', '', false); update public.user_profiles set role = 'am' where id = '${USER}'`)), 'and the service role (no auth.uid) is unaffected');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
