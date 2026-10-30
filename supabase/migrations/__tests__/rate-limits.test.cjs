// rate_limit_hit(): counts per key, resets after the window, service_role only.
//
//   node supabase/migrations/__tests__/rate-limits.test.cjs

const { freshDb } = require('./db.cjs');

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};

const hit = async (db, key, secs = 60) => (await db.query(`select public.rate_limit_hit('${key}', ${secs}) as n`)).rows[0].n;

(async () => {
  console.log('\nrate limits');
  const db = await freshDb();

  const counts = [await hit(db, 'a'), await hit(db, 'a'), await hit(db, 'a')];
  R(JSON.stringify(counts) === '[1,2,3]', 'each hit counts up within the window', JSON.stringify(counts));
  R(await hit(db, 'b') === 1, 'keys are counted separately');

  await db.exec(`update public.rate_limits set window_ends = now() - interval '1 second' where key = 'a'`);
  R(await hit(db, 'a') === 1, 'an expired window starts again at 1');
  const ends = (await db.query(`select window_ends > now() + interval '50 seconds' as fresh from public.rate_limits where key = 'a'`)).rows[0].fresh;
  R(ends === true, 'the new window runs for the full length');

  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role};`);
    let err = null;
    try { await db.query(`select public.rate_limit_hit('x', 60)`); } catch (e) { err = e.code; }
    try { await db.query(`select * from public.rate_limits`); err = err && 'select ok'; } catch (e) { /* refused */ }
    await db.exec('RESET ROLE;');
    R(err === '42501', `${role} can neither call the function nor read the table`, String(err));
  }
  await db.exec('SET ROLE service_role;');
  R(await hit(db, 'c') === 1, 'service_role can call it');
  await db.exec('RESET ROLE;');

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
