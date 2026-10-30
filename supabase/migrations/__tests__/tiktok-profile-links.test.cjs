// supabase/migrations/__tests__/tiktok-profile-links.test.cjs
//
// Behaviour test for 20261023000000_tiktok_profile_links.sql (spec 0002).
//
// Built on the real chain (SETUP, then every migration in the
// order full-chain.test.cjs uses), so the policies, grants and the safe view
// this migration extends are the production ones, not stand-ins.
//
// The questions it asks:
//
//   AC-17  can a browser caller set its own verification state, verified
//          views, or write a 'link' video row?          (must be 42501)
//   AC-2   can two creators both hold the same verified handle?
//   AC-8   does apply_verified_views only ever raise the count, and refuse a
//          write once the handle has changed?
//   AC-18  does thin_video_metrics keep one snapshot per video per old day?
//   AC-20  can a client read follower snapshots? can the wrong AM?
//
// Browser callers run as `authenticated` with a JWT subject and role, which is
// what PostgREST does. assertRlsIsEnforced() aborts if that instrument is dead.
//
//   node supabase/migrations/__tests__/tiktok-profile-links.test.cjs

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
const MIGRATION = '20261023000000_tiktok_profile_links.sql';

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};

const U = {
  owner:  '00000000-0000-0000-0000-0000000000ff',
  am1:    '00000000-0000-0000-0000-000000000a01',
  am2:    '00000000-0000-0000-0000-000000000a02',
  client: '00000000-0000-0000-0000-000000000c01',
  cre1:   '00000000-0000-0000-0000-000000000e01', // on am1's roster
  cre2:   '00000000-0000-0000-0000-000000000e02', // on am2's roster
};
const AM1 = 'a0000000-0000-0000-0000-000000000001';
const AM2 = 'a0000000-0000-0000-0000-000000000002';
const CR1 = 'e0000000-0000-0000-0000-000000000001';
const CR2 = 'e0000000-0000-0000-0000-000000000002';
const ACC1 = 'ac000000-0000-0000-0000-000000000001';
const ACC2 = 'ac000000-0000-0000-0000-000000000002';
const SUB1 = '50000000-0000-0000-0000-000000000001';
const VID1 = 'b0000000-0000-0000-0000-000000000001';

// Run `sql` as a signed-in browser user. Returns { rows } or { error, code }.
async function as(db, uid, sql) {
  const claims = JSON.stringify({ sub: uid, role: 'authenticated' });
  await db.exec(
    `RESET ROLE;` +
    `select set_config('request.jwt.claim.sub', '${uid}', false);` +
    `select set_config('request.jwt.claims', '${claims}', false);` +
    `SET ROLE authenticated;`
  );
  try {
    const r = await db.query(sql);
    return { rows: r.rows };
  } catch (e) {
    return { error: e.message, code: e.code, rows: [] };
  } finally {
    await db.exec(
      `RESET ROLE;` +
      `select set_config('request.jwt.claim.sub', '', false);` +
      `select set_config('request.jwt.claims', '', false);`
    );
  }
}

// Run `sql` the way an api/ route does: the service role JWT. PGlite has no
// PostgREST, so the statement runs as the superuser with the service_role
// claim set, which is what the guard trigger and the functions look at.
async function asService(db, sql) {
  await db.exec(`select set_config('request.jwt.claims', '{"role":"service_role"}', false);`);
  try {
    const r = await db.query(sql);
    return { rows: r.rows };
  } catch (e) {
    return { error: e.message, code: e.code, rows: [] };
  } finally {
    await db.exec(`select set_config('request.jwt.claims', '', false);`);
  }
}

async function build() {
  const chainSrc = read(path.join(S, 'full-chain.test.cjs'));
  const BOOT = chainSrc.match(/const BOOTSTRAP = `([\s\S]*?)`;/)[1];
  const ORDER = [...chainSrc.match(/const ORDER = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+\.sql)'/g)].map(x => x[1]);
  const later = fs.readdirSync(MIG)
    .filter(f => /^\d{14}_.*\.sql$/.test(f) && !ORDER.includes(f) && f !== MIGRATION)
    .sort();

  const db = await PGlite.create();
  await db.exec(BOOT);
  // What a Supabase project grants before any project SQL runs. Set up front,
  // so the column level REVOKE in 20260604000000 lands on top of it exactly as
  // it did in production (granting afterwards would undo that revoke).
  await db.exec(`
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
  `);
  await db.exec(read(path.join(MIG, '..', 'SETUP.sql')));
  for (const f of [...ORDER, ...later]) {
    const p = path.join(MIG, f);
    if (fs.existsSync(p)) await db.exec(read(p));
  }


  // The N-20 signup trigger copies auth.users.email into user_profiles, so
  // every seeded user carries an email and gets its profile row from there.
  await db.exec(`
    insert into auth.users(id, email) values
      ('${U.owner}','owner@x.com'),('${U.am1}','am1@x.com'),('${U.am2}','am2@x.com'),
      ('${U.client}','client@x.com'),('${U.cre1}','cre1@x.com'),('${U.cre2}','cre2@x.com')
      on conflict do nothing;
    insert into public.user_profiles(id, email, role) values
      ('${U.owner}','owner@x.com','owner'),('${U.am1}','am1@x.com','account_manager'),
      ('${U.am2}','am2@x.com','account_manager'),('${U.client}','client@x.com','client'),
      ('${U.cre1}','cre1@x.com','creator'),('${U.cre2}','cre2@x.com','creator')
      on conflict (id) do update set role = excluded.role;
    insert into public.account_managers(id, user_id, name, email) values
      ('${AM1}','${U.am1}','AM One','am1@x.com'),('${AM2}','${U.am2}','AM Two','am2@x.com');
    insert into public.creators(id, user_id, name, email, am_id) values
      ('${CR1}','${U.cre1}','Creator One','cre1@x.com','${AM1}'),
      ('${CR2}','${U.cre2}','Creator Two','cre2@x.com','${AM2}');
  `);
  return db;
}

async function assertRlsIsEnforced(db) {
  await db.exec(`
    insert into public.creator_social_accounts(id, user_id, platform, username) values
      ('${ACC1}','${U.cre1}','tiktok','cre1'),('${ACC2}','${U.cre2}','tiktok','cre2')
      on conflict do nothing;
  `);
  const r = await as(db, U.cre1, 'select count(*)::int n from public.creator_social_accounts_safe');
  if (r.error || r.rows[0].n !== 1) {
    console.error('\nABORT: RLS is not enforced in this harness (cre1 sees ' +
      (r.error || r.rows[0].n) + ' accounts, expected 1). Results would be meaningless.');
    process.exit(2);
  }
  R(true, 'the instrument is live: cre1 reads exactly one of two accounts');
}

async function run() {
  console.log(`\n${MIGRATION}`);
  const db = await build();

  try {
    await db.exec(read(path.join(MIG, MIGRATION)));
    R(true, 'the migration applies on top of the real chain');
  } catch (e) {
    R(false, 'the migration applies on top of the real chain', e.message.slice(0, 400));
    return db.close();
  }
  try {
    await db.exec(read(path.join(MIG, MIGRATION)));
    R(true, 'and is idempotent');
  } catch (e) {
    R(false, 'and is idempotent', e.message.slice(0, 400));
  }

  await assertRlsIsEnforced(db);

  // ===========================================================================
  console.log('\nAC-17 -- the browser cannot verify itself');
  // ===========================================================================

  let r = await as(db, U.cre1,
    `insert into public.creator_social_accounts(user_id, platform, link_handle, link_status)
     values ('${U.cre1}','instagram','cre1','verified')`);
  R(r.code === '42501', 'a creator inserting a row with link_status = verified gets 42501', r.code || 'ACCEPTED');

  r = await as(db, U.cre1,
    `update public.creator_social_accounts set link_handle='cre1', link_status='verified'
     where id='${ACC1}' returning id`);
  R(r.code === '42501', 'a creator updating their own row to verified gets 42501', r.code || 'ACCEPTED');

  r = await as(db, U.cre1,
    `update public.creator_social_accounts set link_code_expires_at = now() + interval '1 year'
     where id='${ACC1}' returning id`);
  R(r.code === '42501', 'nor can they push their code expiry forward', r.code || 'ACCEPTED');

  r = await as(db, U.cre1,
    `update public.creator_social_accounts set display_name='Creator One' where id='${ACC1}' returning id`);
  R(!r.error && r.rows.length === 1, 'but can still edit an unprotected column on their row', r.error);

  r = await as(db, U.cre1,
    `insert into public.creator_social_accounts(user_id, platform, username)
     values ('${U.cre1}','youtube','cre1yt') returning link_health, link_failure_count`);
  R(!r.error && r.rows[0] && r.rows[0].link_health === 'ok',
    'and insert a plain OAuth style row riding the defaults', r.error);

  await db.exec(`
    insert into public.campaigns(id, name) values ('ca000000-0000-0000-0000-000000000001','C1');
    insert into public.submissions(id, creator_id, campaign_id, submission_type, posted_link, platform)
    values ('${SUB1}','${CR1}','ca000000-0000-0000-0000-000000000001','Final',
            'https://www.tiktok.com/@cre1/video/7517114944362499342','TikTok');
  `);

  r = await as(db, U.owner,
    `update public.submissions set view_count_verified = 999999 where id='${SUB1}' returning id`);
  R(r.code === '42501', 'even an owner in the browser cannot write view_count_verified', r.code || r.error || 'ACCEPTED');

  r = await as(db, U.owner,
    `update public.submissions set verified_views_source = 'link', view_count_verified_at = now()
     where id='${SUB1}' returning id`);
  R(r.code === '42501', 'nor stamp it as verified', r.code || r.error || 'ACCEPTED');

  r = await as(db, U.owner,
    `insert into public.submissions(creator_id, submission_type, view_count_verified)
     values ('${CR1}','Final', 5)`);
  R(r.code === '42501', 'nor insert a submission that arrives pre verified', r.code || r.error || 'ACCEPTED');

  r = await as(db, U.owner, `update public.submissions set feedback='nice' where id='${SUB1}' returning id`);
  R(!r.error && r.rows.length === 1, 'while ordinary submission edits still work', r.error);

  r = await as(db, U.cre1,
    `insert into public.creator_videos(user_id, platform, platform_video_id, source)
     values ('${U.cre1}','tiktok','1','link')`);
  R(r.code === '42501', "a creator cannot insert a creator_videos row with source = 'link'", r.code || 'ACCEPTED');

  r = await as(db, U.cre1,
    `insert into public.creator_videos(user_id, platform, platform_video_id)
     values ('${U.cre1}','tiktok','2') returning source`);
  R(!r.error && r.rows[0] && r.rows[0].source === 'oauth', "but an 'oauth' row (the default) still works", r.error);

  r = await asService(db,
    `update public.creator_social_accounts
        set link_handle='some.creator', link_status='pending_code', link_code='OMNYA-7K3QZD',
            link_code_expires_at = now() + interval '7 days'
      where id='${ACC1}' returning link_status`);
  R(!r.error && r.rows[0] && r.rows[0].link_status === 'pending_code', 'the service role can write the link state', r.error);

  // ===========================================================================
  console.log('\nAC-2 -- one verified owner per handle');
  // ===========================================================================

  r = await asService(db,
    `update public.creator_social_accounts set link_status='verified', link_verified_at=now()
      where id='${ACC1}' returning id`);
  R(!r.error, 'cre1 verifies some.creator', r.error);

  r = await asService(db,
    `update public.creator_social_accounts set link_handle='some.creator', link_status='pending_code'
      where id='${ACC2}' returning id`);
  R(!r.error, 'cre2 may still save the same handle while unverified (the route refuses it, not the index)', r.error);

  r = await asService(db,
    `update public.creator_social_accounts set link_status='verified' where id='${ACC2}' returning id`);
  R(r.code === '23505', 'but verifying it as well hits the unique index (23505)', r.code || 'ACCEPTED');

  r = await asService(db, `update public.creator_social_accounts set link_handle='Some.Creator' where id='${ACC2}'`);
  R(r.code === '23514', 'an uppercase handle is rejected by the CHECK, so case cannot dodge the index', r.code || 'ACCEPTED');

  r = await asService(db,
    `update public.creator_social_accounts set link_handle=NULL, link_status='pending_code' where id='${ACC2}'`);
  R(r.code === '23514', 'a status with no handle is rejected', r.code || 'ACCEPTED');

  // ===========================================================================
  console.log('\nAC-8 -- apply_verified_views');
  // ===========================================================================

  const apply = (views, source, user, handle) => asService(db,
    `select public.apply_verified_views('${SUB1}', ${views}, '${source}', '${user}', ${handle ? `'${handle}'` : 'NULL'}) as ok`);
  const stored = async () => (await db.query(
    `select view_count_verified v, view_count_verified_at at, verified_views_source s from public.submissions where id='${SUB1}'`)).rows[0];

  r = await apply(120000, 'link', U.cre1, 'some.creator');
  let s = await stored();
  R(r.rows[0] && r.rows[0].ok === true && s.v === 120000 && s.at && s.s === 'link',
    'writes 120000 with a timestamp and source link', r.error || JSON.stringify(s));

  r = await apply(0, 'link', U.cre1, 'some.creator');
  s = await stored();
  R(s.v === 120000, 'a later fetch of 0 never lowers it (GREATEST)', 'v=' + s.v);

  r = await apply(150000, 'link', U.cre1, 'old.handle');
  s = await stored();
  R(r.rows[0] && r.rows[0].ok === false && s.v === 120000,
    'a write for a handle that is no longer the verified one is a no-op (stale_skip)', JSON.stringify(r.rows[0]));

  r = await apply(150000, 'link', U.cre2, 'some.creator');
  R(r.rows[0] && r.rows[0].ok === false, "another creator's id cannot write to cre1's submission", JSON.stringify(r.rows[0]));

  r = await apply(5000000000, 'oauth', U.cre1, null);
  s = await stored();
  R(r.rows[0] && r.rows[0].ok === true && s.v === 2147483647 && s.s === 'oauth',
    'oauth writes need no link, and an out of range count is clamped, not an overflow', r.error || JSON.stringify(s));

  r = await apply(1, 'scraped', U.cre1, null);
  R(r.code === '22023', 'an unknown source is refused', r.code || 'ACCEPTED');

  r = await as(db, U.owner,
    `select public.apply_verified_views('${SUB1}', 1, 'oauth', '${U.cre1}', NULL)`);
  R(!!r.error && /permission denied/i.test(r.error), 'the browser cannot call it at all', r.error || 'ACCEPTED');

  // ===========================================================================
  console.log('\nAC-18 -- thin_video_metrics');
  // ===========================================================================

  await db.exec(`
    insert into public.creator_videos(id, user_id, platform, platform_video_id)
      values ('${VID1}','${U.cre1}','tiktok','thin-1');
    insert into public.video_metrics(video_id, user_id, snapshot_at, view_count) values
      ('${VID1}','${U.cre1}', '2026-01-05 00:10+00', 1),
      ('${VID1}','${U.cre1}', '2026-01-05 06:10+00', 2),
      ('${VID1}','${U.cre1}', '2026-01-05 18:10+00', 3),
      ('${VID1}','${U.cre1}', '2026-01-06 00:10+00', 4),
      ('${VID1}','${U.cre1}', now() - interval '1 hour', 5),
      ('${VID1}','${U.cre1}', now(), 6);
  `);
  r = await asService(db, `select public.thin_video_metrics(90) as n`);
  const left = (await db.query(
    `select view_count v from public.video_metrics where video_id='${VID1}' order by snapshot_at`)).rows.map(x => Number(x.v));
  R(r.rows[0] && Number(r.rows[0].n) === 2 && left.join(',') === '3,4,5,6',
    'deletes all but the newest snapshot per old day and keeps recent ones', `deleted=${r.rows[0] && r.rows[0].n} left=${left}`);

  r = await as(db, U.owner, `select public.thin_video_metrics(90)`);
  R(!!r.error, 'the browser cannot call it', r.error ? 'refused' : 'ACCEPTED');

  // ===========================================================================
  console.log('\nAC-20 -- who can read follower snapshots and the link state');
  // ===========================================================================

  await asService(db, `insert into public.social_profile_snapshots(social_account_id, user_id, snapshot_date, follower_count)
                       values ('${ACC1}','${U.cre1}', current_date, 4100)`);

  r = await as(db, U.cre1, `select follower_count from public.social_profile_snapshots`);
  R(r.rows.length === 1, 'the creator reads their own snapshot', r.error || 'rows=' + r.rows.length);
  r = await as(db, U.am1, `select follower_count from public.social_profile_snapshots`);
  R(r.rows.length === 1, 'their AM reads it', r.error || 'rows=' + r.rows.length);
  r = await as(db, U.am2, `select follower_count from public.social_profile_snapshots`);
  R(r.rows.length === 0, 'another AM does not', 'rows=' + r.rows.length);
  r = await as(db, U.client, `select follower_count from public.social_profile_snapshots`);
  R(r.rows.length === 0, 'a client reads nothing', r.error || 'rows=' + r.rows.length);
  r = await as(db, U.client, `select id from public.creator_videos`);
  R(r.rows.length === 0, 'nor any creator_videos', r.error || 'rows=' + r.rows.length);
  r = await as(db, U.client, `select id from public.creator_social_accounts_safe`);
  R(r.rows.length === 0, "nor any creator's account row", r.error || 'rows=' + r.rows.length);
  r = await as(db, U.cre1,
    `insert into public.social_profile_snapshots(social_account_id, user_id, snapshot_date, follower_count)
     values ('${ACC1}','${U.cre1}', current_date - 1, 9999999)`);
  R(!!r.error, 'a creator cannot write a snapshot', r.error ? 'refused' : 'ACCEPTED');

  r = await as(db, U.cre1,
    `select link_handle, link_status, link_code, link_health, follower_count
       from public.creator_social_accounts_safe where id='${ACC1}'`);
  R(!r.error && r.rows[0] && r.rows[0].link_status === 'verified' && r.rows[0].link_code === 'OMNYA-7K3QZD',
    'the creator reads their link state through the safe view (column grants in place)', r.error);
  r = await as(db, U.am1, `select link_status from public.creator_social_accounts_safe where id='${ACC1}'`);
  R(r.rows.length === 1, "their AM reads it too", r.error || 'rows=' + r.rows.length);
  r = await as(db, U.cre1, `select access_token_encrypted from public.creator_social_accounts where id='${ACC1}'`);
  R(!!r.error, 'token columns are still hidden from the browser', r.error ? 'refused' : 'LEAKED');

  await db.close();
}

(async () => {
  await run();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\nHARNESS ERROR:', e); process.exit(2); });
