// N-10 tenant isolation, offline: two tenants, and every role is asked whether it can reach the other one.
// tests/role-boundaries.test.cjs asks the same of the live database over HTTP.
//
//   node supabase/migrations/__tests__/tenant-isolation.test.cjs

const { freshDb } = require('./db.cjs');

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
  // Measurements run as `authenticated`, since PGlite's superuser bypasses RLS.
  const db = await freshDb();
  await db.exec(`
    insert into auth.users(id, email) values
      ('${U.owner}','owner@x.com'),('${U.am1}','am1@x.com'),('${U.am2}','am2@x.com'),
      ('${U.client1}','client1@x.com'),('${U.client2}','client2@x.com'),('${U.cre1}','cre1@x.com'),('${U.cre2}','cre2@x.com');

    insert into public.user_profiles(id, email, role) values
      ('${U.owner}',   'owner@x.com',   'owner'),
      ('${U.am1}',     'am1@x.com',     'account_manager'),
      ('${U.am2}',     'am2@x.com',     'account_manager'),
      ('${U.client1}', 'client1@x.com', 'client'),
      ('${U.client2}', 'client2@x.com', 'client'),
      ('${U.cre1}',    'cre1@x.com',    'creator'),
      ('${U.cre2}',    'cre2@x.com',    'creator')
      on conflict (id) do update set role = excluded.role;

    insert into public.account_managers(id, user_id, name, email) values
      ('a0000000-0000-0000-0000-000000000001','${U.am1}','AM One','am1@x.com'),
      ('a0000000-0000-0000-0000-000000000002','${U.am2}','AM Two','am2@x.com')
      on conflict (email) do update set id = excluded.id, user_id = excluded.user_id;

    insert into public.clients(id, user_id, name, am_id) values
      ('c0000000-0000-0000-0000-000000000001','${U.client1}','Tenant One',
       'a0000000-0000-0000-0000-000000000001'),
      ('c0000000-0000-0000-0000-000000000002','${U.client2}','Tenant Two',
       'a0000000-0000-0000-0000-000000000002')
      on conflict (user_id) do update set id = excluded.id, name = excluded.name, am_id = excluded.am_id;

    insert into public.creators(id, user_id, name, email, am_id) values
      ('e0000000-0000-0000-0000-000000000001','${U.cre1}','Creator One','cre1@x.com',
       'a0000000-0000-0000-0000-000000000001'),
      ('e0000000-0000-0000-0000-000000000002','${U.cre2}','Creator Two','cre2@x.com',
       'a0000000-0000-0000-0000-000000000002');

    insert into public.campaigns(id, name, status, client_id, assigned_creators) values
      ('ca000000-0000-0000-0000-000000000001','Campaign One','Active',
       'c0000000-0000-0000-0000-000000000001',
       array['e0000000-0000-0000-0000-000000000001']::uuid[]),
      ('ca000000-0000-0000-0000-000000000002','Campaign Two','Active',
       'c0000000-0000-0000-0000-000000000002',
       array['e0000000-0000-0000-0000-000000000002']::uuid[]);

    insert into public.submissions(id, creator_id, campaign_id, submission_type, status) values
      ('50000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001',
       'ca000000-0000-0000-0000-000000000001','Final','Approved'),
      ('50000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000002',
       'ca000000-0000-0000-0000-000000000002','Final','Approved');
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

async function after() {
  const db = await buildTenants();

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
  await after();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\nHARNESS ERROR:', e); process.exit(2); });
