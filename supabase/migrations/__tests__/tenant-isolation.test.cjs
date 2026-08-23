// supabase/migrations/__tests__/tenant-isolation.test.cjs
//
// The acceptance criterion for N-10, against a real PostgreSQL engine.
//
// tests/role-boundaries.test.cjs asks the same question of the live database
// over HTTP. This asks it of the migration itself, offline, in about a second,
// so the boundary can be checked on every edit rather than only against a
// deployed environment.
//
// TWO tenants, not one. With a single client in the system, "an AM sees all
// clients" and "an AM sees their own client" produce identical results, and
// that ambiguity is exactly how N-10 survived review.
//
// It runs the whole thing twice:
//   · BEFORE  -- the repo's pre-fix policies, which must LEAK. A test that
//               cannot demonstrate the bug it guards is not evidence of
//               anything, so this half fails loudly if the leak is absent.
//   · AFTER   -- the reset migration, which must hold every boundary.
//
//   node supabase/migrations/__tests__/tenant-isolation.test.cjs

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

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};

const U = {
  owner:   '00000000-0000-0000-0000-0000000000ff',
  am1:     '00000000-0000-0000-0000-000000000a01',
  am2:     '00000000-0000-0000-0000-000000000a02',
  client1: '00000000-0000-0000-0000-000000000c01',
  client2: '00000000-0000-0000-0000-000000000c02',
  cre1:    '00000000-0000-0000-0000-000000000e01',
  cre2:    '00000000-0000-0000-0000-000000000e02',
};

// ---------------------------------------------------------------------------

async function buildTenants() {
  const db = await PGlite.create();
  await db.exec(read(S + '/fixture_schema.sql'));

  // PGlite connects as `postgres`, a SUPERUSER, and a superuser bypasses RLS
  // unconditionally -- ENABLE does not stop it and neither does FORCE, which
  // only subjects a non-superuser owner.
  //
  // An earlier version of this file relied on FORCE and measured nothing at
  // all: every role read every row, the BEFORE half reported "the leak is
  // reproducible" because am1 saw both tenants, and that pass was worthless.
  // It would have reported the leak as reproduced no matter what the policies
  // said, including after they were fixed.
  //
  // So every measurement below runs as `authenticated`, which is both a real
  // non-superuser and the exact role PostgREST uses in production. Verified by
  // probe: as postgres a two-row table returns 2 rows through a policy that
  // permits one; as authenticated it returns 1.
  for (const t of ['creators', 'clients', 'campaigns', 'submissions']) {
    await db.exec(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
    await db.exec(`GRANT SELECT ON public.${t} TO authenticated;`);
  }
  await db.exec(`
    GRANT USAGE   ON SCHEMA public, auth            TO authenticated;
    GRANT SELECT  ON public.account_managers        TO authenticated;
    GRANT SELECT  ON public.user_profiles           TO authenticated;
    GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid()                 TO authenticated;
  `);

  await db.exec(`
    insert into auth.users(id) values
      ('${U.owner}'),('${U.am1}'),('${U.am2}'),
      ('${U.client1}'),('${U.client2}'),('${U.cre1}'),('${U.cre2}');

    insert into public.user_profiles(id, email, role) values
      ('${U.owner}',   'owner@x.com',   'owner'),
      ('${U.am1}',     'am1@x.com',     'account_manager'),
      ('${U.am2}',     'am2@x.com',     'account_manager'),
      ('${U.client1}', 'client1@x.com', 'client'),
      ('${U.client2}', 'client2@x.com', 'client'),
      ('${U.cre1}',    'cre1@x.com',    'creator'),
      ('${U.cre2}',    'cre2@x.com',    'creator');

    insert into public.account_managers(id, user_id, name) values
      ('a0000000-0000-0000-0000-000000000001','${U.am1}','AM One'),
      ('a0000000-0000-0000-0000-000000000002','${U.am2}','AM Two');

    insert into public.clients(id, user_id, name, am_id) values
      ('c0000000-0000-0000-0000-000000000001','${U.client1}','Tenant One',
       'a0000000-0000-0000-0000-000000000001'),
      ('c0000000-0000-0000-0000-000000000002','${U.client2}','Tenant Two',
       'a0000000-0000-0000-0000-000000000002');

    insert into public.creators(id, user_id, name, am_id) values
      ('e0000000-0000-0000-0000-000000000001','${U.cre1}','Creator One',
       'a0000000-0000-0000-0000-000000000001'),
      ('e0000000-0000-0000-0000-000000000002','${U.cre2}','Creator Two',
       'a0000000-0000-0000-0000-000000000002');

    insert into public.campaigns(id, name, client_id, assigned_creators) values
      ('ca000000-0000-0000-0000-000000000001','Campaign One',
       'c0000000-0000-0000-0000-000000000001',
       array['e0000000-0000-0000-0000-000000000001']::uuid[]),
      ('ca000000-0000-0000-0000-000000000002','Campaign Two',
       'c0000000-0000-0000-0000-000000000002',
       array['e0000000-0000-0000-0000-000000000002']::uuid[]);

    insert into public.submissions(id, creator_id, campaign_id, final_status) values
      ('50000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001',
       'ca000000-0000-0000-0000-000000000001','Approved'),
      ('50000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000002',
       'ca000000-0000-0000-0000-000000000002','Approved');
  `);

  return db;
}

// Identity is set as superuser (the GUC write needs no special right, but
// RESET ROLE first keeps this correct regardless of what ran before), then the
// read is taken as `authenticated` so RLS actually applies.
async function countAs(db, uid, table) {
  await db.exec(
    `RESET ROLE;` +
    `select set_config('request.jwt.claim.sub', '${uid}', false);` +
    `SET ROLE authenticated;`
  );
  try {
    const r = await db.query(`select count(*)::int as n from public.${table}`);
    return r.rows[0].n;
  } finally {
    await db.exec('RESET ROLE;');
  }
}

// A guard against the exact mistake this file already made once: if RLS is not
// being enforced for the measuring role, every count is meaningless and the
// suite must say so rather than reporting passes.
async function assertRlsIsEnforced(db) {
  const seen = await countAs(db, U.client1, 'clients');
  if (seen === 2) {
    throw new Error(
      'TEST BUG: RLS is not being enforced for the measuring role -- client1 ' +
      'can see both tenants\' client rows, which no policy permits. Every ' +
      'count in this suite would be vacuous. Check that measurements run as ' +
      '`authenticated` and that GRANT SELECT was issued.'
    );
  }
}

// ---------------------------------------------------------------------------

async function measure(db) {
  return {
    am1Clients:     await countAs(db, U.am1,     'clients'),
    am1Campaigns:   await countAs(db, U.am1,     'campaigns'),
    am1Submissions: await countAs(db, U.am1,     'submissions'),
    am1Creators:    await countAs(db, U.am1,     'creators'),
    ownerClients:   await countAs(db, U.owner,   'clients'),
    cli1Clients:    await countAs(db, U.client1, 'clients'),
    cli1Campaigns:  await countAs(db, U.client1, 'campaigns'),
    cli1Subs:       await countAs(db, U.client1, 'submissions'),
    cre1Subs:       await countAs(db, U.cre1,    'submissions'),
    cre1Campaigns:  await countAs(db, U.cre1,    'campaigns'),
  };
}

async function before() {
  console.log('\nBEFORE the fix -- the repo policies as they stand');
  const db = await buildTenants();

  // The pre-fix policy set, exactly as the repository defines it today.
  await db.exec(read(path.join(MIG, '20260521000000_omnya_hardening.sql'))
    .split('-- ===== creators =====')[1]
    .split('-- ===== payments =====')[0]
    .replace(/^/, '-- extracted policy block\n'));
  await db.exec(read(path.join(MIG, '20260527130000_client_rls_security.sql'))
    .replace(/ALTER TABLE public\.video_analytics[^;]*;/g, '')
    .replace(/DROP POLICY IF EXISTS client_select_own_analytics[^;]*;/g, '')
    .replace(/CREATE POLICY client_select_own_analytics[\s\S]*?\);\s*/g, ''));

  await assertRlsIsEnforced(db);

  const m = await measure(db);
  console.log('    am1 sees: clients=' + m.am1Clients + ' campaigns=' + m.am1Campaigns +
              ' submissions=' + m.am1Submissions +
              '   (client1 sees ' + m.cli1Clients + ' client row, so RLS is live)');

  // This half of the test exists to prove the bug is real and reachable.
  R(m.am1Clients === 2, 'the leak is reproducible: am1 reads BOTH tenants\' clients',
    'saw ' + m.am1Clients + ' of 2');
  R(m.am1Campaigns === 2, 'am1 reads both tenants\' campaigns', 'saw ' + m.am1Campaigns + ' of 2');
  R(m.am1Submissions === 2, 'am1 reads both tenants\' submissions', 'saw ' + m.am1Submissions + ' of 2');

  await db.close();
  return m;
}

async function after() {
  console.log('\nAFTER 20260822000005_tenant_policy_reset.sql');
  const db = await buildTenants();

  await db.exec(read(path.join(MIG, '20260521000000_omnya_hardening.sql'))
    .split('-- ===== creators =====')[1]
    .split('-- ===== payments =====')[0]);
  await db.exec(read(path.join(MIG, '20260527130000_client_rls_security.sql'))
    .replace(/ALTER TABLE public\.video_analytics[^;]*;/g, '')
    .replace(/DROP POLICY IF EXISTS client_select_own_analytics[^;]*;/g, '')
    .replace(/CREATE POLICY client_select_own_analytics[\s\S]*?\);\s*/g, ''));

  try {
    await db.exec(read(path.join(MIG, '20260822000005_tenant_policy_reset.sql')));
    R(true, 'the reset migration applies');
  } catch (e) {
    R(false, 'the reset migration applies', e.message.slice(0, 300));
    await db.close();
    return;
  }

  try {
    await db.exec(read(path.join(MIG, '20260822000005_tenant_policy_reset.sql')));
    R(true, 'and is idempotent');
  } catch (e) {
    R(false, 'and is idempotent', e.message.slice(0, 300));
  }

  await assertRlsIsEnforced(db);
  const m = await measure(db);

  // The boundary.
  R(m.am1Clients === 1, 'am1 now reads ONLY its own tenant\'s client', 'saw ' + m.am1Clients);
  R(m.am1Campaigns === 1, 'am1 now reads only its own tenant\'s campaign', 'saw ' + m.am1Campaigns);
  R(m.am1Submissions === 1, 'am1 now reads only its own tenant\'s submission', 'saw ' + m.am1Submissions);
  R(m.am1Creators === 1, 'am1 now reads only its own creator', 'saw ' + m.am1Creators);

  // Nobody legitimate was locked out. This is the half that a wholesale policy
  // drop can quietly get wrong, so it is asserted as hard as the boundary is.
  R(m.ownerClients === 2, 'the owner still reads everything', 'saw ' + m.ownerClients);
  R(m.cli1Clients === 1, 'a client still reads its own record', 'saw ' + m.cli1Clients);
  R(m.cli1Campaigns === 1, 'a client still reads its own campaign', 'saw ' + m.cli1Campaigns);
  R(m.cli1Subs === 1, 'a client still reads work delivered to it', 'saw ' + m.cli1Subs);
  R(m.cre1Subs === 1, 'a creator still reads their own submission', 'saw ' + m.cre1Subs);
  R(m.cre1Campaigns === 1, 'a creator still reads the campaign they are assigned to',
    'saw ' + m.cre1Campaigns);

  // And the reverse direction, so this is not one-sided.
  const am2Clients = await countAs(db, U.am2, 'clients');
  R(am2Clients === 1, 'am2 is confined symmetrically', 'saw ' + am2Clients);

  await db.close();
}

(async () => {
  console.log('N-10 tenant isolation, against real PostgreSQL (PGlite)');
  await before();
  await after();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\nHARNESS ERROR:', e); process.exit(2); });
