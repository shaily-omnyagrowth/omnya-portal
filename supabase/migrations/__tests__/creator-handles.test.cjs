// guard_creator_handles(): signed-in users cannot set handles; the server can.
//
//   node supabase/migrations/__tests__/creator-handles.test.cjs

const { freshDb } = require('./db.cjs');

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};

const CR = 'e0000000-0000-0000-0000-0000000000a1';

(async () => {
  console.log('\ncreator handles');
  const db = await freshDb();
  await db.query(`insert into public.creators (id, name, email) values ($1, 'Ada', 'ada@example.com')`, [CR]);
  // RLS off so the trigger is what answers, whichever row a policy would expose.
  await db.exec('ALTER TABLE public.creators DISABLE ROW LEVEL SECURITY;');
  const as = async (role, sql) => {
    await db.exec(`SET ROLE ${role};`);
    try { await db.query(sql); return null; } catch (e) { return e.code; } finally { await db.exec('RESET ROLE;'); }
  };

  R(await as('authenticated', `update public.creators set tiktok_handle = 'ada' where id = '${CR}'`) === '42501', 'a signed-in user cannot set a handle');
  R(await as('authenticated', `insert into public.creators (name, email, instagram_handle) values ('Bo', 'bo@example.com', 'bo')`) === '42501',
    'a signed-in user cannot create a creator with a handle');
  R(await as('service_role', `update public.creators set tiktok_handle = 'ada' where id = '${CR}'`) === null, 'the server can set it');

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
