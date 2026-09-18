// supabase/migrations/__tests__/creator-portal-fixes.test.cjs
//
// Behaviour test for 20260918000000_creator_portal_fixes.sql.
//
// The first test written for this migration bootstrapped a private toy schema,
// stubbed current_user_role() to a constant, connected as the PGlite superuser
// (which bypasses RLS unconditionally) and then asserted that columns existed.
// It passed while the migration let a creator approve themselves onto any
// campaign, and while "applying" silently assigned the creator on the spot.
//
// This one runs the real chain and asks the questions the punch list asks:
//
//   P0-B  does a commission edit persist, and who is allowed to make it?
//   P1    can a manager see and approve work on their own tenant — and ONLY
//         their own tenant?
//   P2    is an application an application, or an assignment in disguise?
//   P3    can the client portal see the CPM switch, and nothing about cost?
//
// Every measurement runs as `authenticated` with a JWT subject, i.e. exactly
// what PostgREST does in production. assertRlsIsEnforced() aborts the suite if
// the instrument is not live — see tests/README.md for why that matters here.
//
//   node supabase/migrations/__tests__/creator-portal-fixes.test.cjs

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
const MIGRATION = '20260918000000_creator_portal_fixes.sql';

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
  cre1:    '00000000-0000-0000-0000-000000000e01', // on am1's roster
  cre2:    '00000000-0000-0000-0000-000000000e02', // on am2's roster
  cre3:    '00000000-0000-0000-0000-000000000e03', // unassigned
};
const AM1 = 'a0000000-0000-0000-0000-000000000001';
const AM2 = 'a0000000-0000-0000-0000-000000000002';
const CL1 = 'c0000000-0000-0000-0000-000000000001';
const CL2 = 'c0000000-0000-0000-0000-000000000002';
const CR1 = 'e0000000-0000-0000-0000-000000000001';
const CR2 = 'e0000000-0000-0000-0000-000000000002';
const CR3 = 'e0000000-0000-0000-0000-000000000003';
const CA1 = 'ca000000-0000-0000-0000-000000000001'; // tenant 1, open
const CA2 = 'ca000000-0000-0000-0000-000000000002'; // tenant 2, open
const CA3 = 'ca000000-0000-0000-0000-000000000003'; // tenant 1, invite only

// Run `sql` as a signed-in user. Returns { rows } or { error }.
async function as(db, uid, sql, params) {
  await db.exec(
    `RESET ROLE;` +
    `select set_config('request.jwt.claim.sub', '${uid}', false);` +
    `SET ROLE authenticated;`
  );
  try {
    const r = await db.query(sql, params);
    return { rows: r.rows, affected: r.affectedRows };
  } catch (e) {
    return { error: e.message, rows: [] };
  } finally {
    await db.exec('RESET ROLE;');
  }
}

async function build() {
  const db = await PGlite.create();
  await db.exec(read(S + '/fixture_schema.sql'));

  // Columns the live tables have and the shared fixture does not. Added here
  // rather than in fixture_schema.sql so the other suites are untouched.
  await db.exec(`
    ALTER TABLE public.campaigns
      ADD COLUMN IF NOT EXISTS application_type TEXT,
      ADD COLUMN IF NOT EXISTS is_sales_sourced BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS format TEXT,
      ADD COLUMN IF NOT EXISTS deadline DATE,
      ADD COLUMN IF NOT EXISTS start_date DATE,
      ADD COLUMN IF NOT EXISTS brief_url TEXT,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
    ALTER TABLE public.creators
      ADD COLUMN IF NOT EXISTS tiktok_handle TEXT,
      ADD COLUMN IF NOT EXISTS instagram_handle TEXT,
      ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
    ALTER TABLE public.payments
      ADD COLUMN IF NOT EXISTS campaign_id UUID,
      ADD COLUMN IF NOT EXISTS submission_id UUID,
      ADD COLUMN IF NOT EXISTS amount_owed NUMERIC,
      ADD COLUMN IF NOT EXISTS videos_approved INT;
    ALTER TABLE public.submissions
      ADD COLUMN IF NOT EXISTS status TEXT;
  `);

  await db.exec(`
    insert into auth.users(id) values
      ('${U.owner}'),('${U.am1}'),('${U.am2}'),('${U.client1}'),('${U.client2}'),
      ('${U.cre1}'),('${U.cre2}'),('${U.cre3}');

    insert into public.user_profiles(id, email, role) values
      ('${U.owner}',   'owner@x.com',   'owner'),
      ('${U.am1}',     'am1@x.com',     'account_manager'),
      ('${U.am2}',     'am2@x.com',     'account_manager'),
      ('${U.client1}', 'client1@x.com', 'client'),
      ('${U.client2}', 'client2@x.com', 'client'),
      ('${U.cre1}',    'cre1@x.com',    'creator'),
      ('${U.cre2}',    'cre2@x.com',    'creator'),
      ('${U.cre3}',    'cre3@x.com',    'creator');

    insert into public.account_managers(id, user_id, name) values
      ('${AM1}','${U.am1}','AM One'), ('${AM2}','${U.am2}','AM Two');

    insert into public.clients(id, user_id, name, am_id, budget) values
      ('${CL1}','${U.client1}','Tenant One','${AM1}', 5000),
      ('${CL2}','${U.client2}','Tenant Two','${AM2}', 9000);

    insert into public.creators(id, user_id, name, am_id, bank_account_last4) values
      ('${CR1}','${U.cre1}','Creator One','${AM1}','1111'),
      ('${CR2}','${U.cre2}','Creator Two','${AM2}','2222'),
      ('${CR3}','${U.cre3}','Creator Three', NULL,'3333');

    insert into public.campaigns(id, name, client_id, status, application_type, pay_per_video, assigned_creators) values
      ('${CA1}','Campaign One','${CL1}','Open','Open Application', 50, array['${CR1}']::uuid[]),
      ('${CA2}','Campaign Two','${CL2}','Open','Open Application', 80, array['${CR2}']::uuid[]),
      ('${CA3}','Invite Only', '${CL1}','Open','Invite Only',      50, '{}'::uuid[]);
  `);

  // The real chain, in the order it is applied in production.
  await db.exec(read(path.join(MIG, '20260521000000_omnya_hardening.sql'))
    .split('-- ===== creators =====')[1]
    .split('-- ===== payments =====')[0]);
  await db.exec(read(path.join(MIG, '20260527130000_client_rls_security.sql'))
    .replace(/ALTER TABLE public\.video_analytics[^;]*;/g, '')
    .replace(/DROP POLICY IF EXISTS client_select_own_analytics[^;]*;/g, '')
    .replace(/CREATE POLICY client_select_own_analytics[\s\S]*?\);\s*/g, ''));
  await db.exec(read(path.join(MIG, '20260822000003_campaign_creators.sql')));
  await db.exec(read(path.join(MIG, '20260822000005_tenant_policy_reset.sql')));

  await db.exec(`
    ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA public, auth TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      public.creators, public.clients, public.campaigns, public.submissions,
      public.payments, public.campaign_creators TO authenticated;
    GRANT SELECT ON public.account_managers, public.user_profiles TO authenticated;
    GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    GRANT EXECUTE ON FUNCTION public.get_my_payout_role() TO authenticated;
    GRANT EXECUTE ON FUNCTION public.is_payment_manager(TEXT) TO authenticated;
  `);

  return db;
}

// A guard that does not guard is worse than none. If the two-tenant fixture
// lets am1 read both clients, RLS is not being applied to these queries and
// every PASS below would be meaningless.
async function assertRlsIsEnforced(db) {
  const r = await as(db, U.am1, 'select count(*)::int n from public.clients');
  if (r.error || r.rows[0].n !== 1) {
    console.error('\nABORT: RLS is not enforced in this harness (am1 sees ' +
      (r.error || r.rows[0].n) + ' clients, expected 1). Results would be meaningless.');
    process.exit(2);
  }
  R(true, 'the instrument is live: am1 reads exactly one of two clients');
}

async function run() {
  console.log(`\n${MIGRATION}`);
  const db = await build();

  // ---- applies, and applies twice -------------------------------------------
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

  // ---- existing data is not disturbed ---------------------------------------
  let r = await db.query(`select status from public.campaign_creators where campaign_id='${CA1}' and creator_id='${CR1}'`);
  R(r.rows[0] && r.rows[0].status === 'Approved',
    'assignments that already existed are Approved, not orphaned', r.rows[0] && r.rows[0].status);
  r = await db.query(`select sales_commission_rate s, manager_commission_rate m, show_client_cpm c from public.campaigns where id='${CA1}'`);
  R(Number(r.rows[0].s) === 0.3 && r.rows[0].m === null && r.rows[0].c === false,
    'existing campaigns keep 30% sales, inherit the manager rate, and hide CPM from the client',
    JSON.stringify(r.rows[0]));

  // ===========================================================================
  console.log('\nP2 -- an application is not an assignment');
  // ===========================================================================

  r = await as(db, U.cre3,
    `insert into public.campaign_creators(campaign_id, creator_id, status, commitment, demo_video_url)
     values ('${CA1}','${CR3}','Applied', 4, 'https://example.com/demo.mp4') returning status`);
  R(!r.error && r.rows[0] && r.rows[0].status === 'Applied', 'a creator can apply to an open campaign', r.error);

  r = await db.query(`select assigned_creators from public.campaigns where id='${CA1}'`);
  R(!String(r.rows[0].assigned_creators).includes(CR3),
    'applying does NOT put the creator on the campaign',
    'assigned_creators=' + r.rows[0].assigned_creators);

  r = await as(db, U.cre3, `select id from public.campaigns where id in ('${CA1}','${CA3}')`);
  R(r.rows.length === 1 && r.rows[0].id === CA1,
    'the job board shows a creator the open campaign and not the invite-only one', 'rows=' + r.rows.length);

  r = await as(db, U.cre2,
    `insert into public.campaign_creators(campaign_id, creator_id, status) values ('${CA1}','${CR2}','Approved')`);
  R(!!r.error, 'a creator cannot insert themselves as Approved', r.error ? 'refused' : 'ACCEPTED');

  r = await as(db, U.cre2,
    `insert into public.campaign_creators(campaign_id, creator_id) values ('${CA1}','${CR2}')`);
  R(!!r.error, 'nor by omitting status and riding the Approved default', r.error ? 'refused' : 'ACCEPTED');

  r = await as(db, U.cre2,
    `insert into public.campaign_creators(campaign_id, creator_id, status) values ('${CA1}','${CR1}','Applied')`);
  R(!!r.error, 'a creator cannot apply on behalf of someone else', r.error ? 'refused' : 'ACCEPTED');

  r = await as(db, U.cre2,
    `insert into public.campaign_creators(campaign_id, creator_id, status) values ('${CA3}','${CR2}','Applied')`);
  R(!!r.error, 'a creator cannot apply to an invite-only campaign', r.error ? 'refused' : 'ACCEPTED');

  r = await as(db, U.cre3,
    `update public.campaign_creators set status='Approved' where campaign_id='${CA1}' and creator_id='${CR3}' returning status`);
  R(r.rows.length === 0, 'a creator cannot approve their own application afterwards', 'rows updated=' + r.rows.length);

  r = await as(db, U.cre3,
    `insert into public.campaign_creators(campaign_id, creator_id, status, commitment) values ('${CA2}','${CR3}','Applied', 0)`);
  R(!!r.error, 'a commitment of zero videos is rejected', r.error ? 'refused' : 'ACCEPTED');

  // ===========================================================================
  console.log('\nP1 -- the manager as a scoped owner');
  // ===========================================================================

  r = await as(db, U.am1, `select name from public.creators where id='${CR3}'`);
  R(r.rows.length === 1 && r.rows[0].name === 'Creator Three',
    'a manager can read the name of an applicant to their campaign', r.error || ('rows=' + r.rows.length));

  r = await as(db, U.am2, `select name from public.creators where id='${CR3}'`);
  R(r.rows.length === 0, 'the OTHER manager cannot', 'rows=' + r.rows.length);

  r = await as(db, U.am2,
    `update public.campaign_creators set status='Approved' where campaign_id='${CA1}' and creator_id='${CR3}' returning status`);
  R(r.rows.length === 0, 'the other manager cannot approve tenant one\'s application', 'rows=' + r.rows.length);

  r = await as(db, U.am1,
    `update public.campaign_creators set status='Approved', reviewed_by='${U.am1}', reviewed_at=now()
     where campaign_id='${CA1}' and creator_id='${CR3}' returning status`);
  R(r.rows.length === 1, 'the campaign\'s own manager can approve it', r.error || ('rows=' + r.rows.length));

  r = await db.query(`select assigned_creators from public.campaigns where id='${CA1}'`);
  R(String(r.rows[0].assigned_creators).includes(CR3) && String(r.rows[0].assigned_creators).includes(CR1),
    'approval is what assigns — and the existing creator is still there',
    'assigned_creators=' + r.rows[0].assigned_creators);

  // Declining keeps the record and removes the assignment.
  await as(db, U.am1,
    `update public.campaign_creators set status='Declined' where campaign_id='${CA1}' and creator_id='${CR3}'`);
  r = await db.query(`select assigned_creators from public.campaigns where id='${CA1}'`);
  R(!String(r.rows[0].assigned_creators).includes(CR3),
    'moving a creator to Declined takes them back off the campaign');

  // The legacy array writer must not eat applications.
  await db.exec(`insert into public.campaign_creators(campaign_id, creator_id, status)
                 values ('${CA2}','${CR3}','Applied') on conflict do nothing`);
  await as(db, U.owner, `update public.campaigns set assigned_creators = array['${CR2}']::uuid[] || '{}'::uuid[] , name = name where id='${CA2}'`);
  await as(db, U.owner, `update public.campaigns set assigned_creators = '{}'::uuid[] where id='${CA2}'`);
  r = await db.query(`select status from public.campaign_creators where campaign_id='${CA2}' and creator_id='${CR3}'`);
  R(r.rows[0] && r.rows[0].status === 'Applied',
    'rewriting assigned_creators does not delete a pending application',
    r.rows[0] ? r.rows[0].status : 'row is gone');
  await as(db, U.owner, `update public.campaigns set assigned_creators = array['${CR3}']::uuid[] where id='${CA2}'`);
  r = await db.query(`select status from public.campaign_creators where campaign_id='${CA2}' and creator_id='${CR3}'`);
  R(r.rows[0] && r.rows[0].status === 'Approved',
    'adding an applicant through the array approves them rather than being ignored',
    r.rows[0] && r.rows[0].status);

  // ---- review queue ---------------------------------------------------------
  // cre2 is on am2's roster but has submitted to am1's client's campaign.
  await db.exec(`
    insert into public.submissions(id, creator_id, campaign_id, status, final_status) values
      ('50000000-0000-0000-0000-0000000000a1','${CR2}','${CA1}','Under Review','Pending'),
      ('50000000-0000-0000-0000-0000000000a2','${CR2}','${CA2}','Under Review','Pending');
  `);
  r = await as(db, U.am1, `select id from public.submissions where id='50000000-0000-0000-0000-0000000000a1'`);
  R(r.rows.length === 1,
    'a manager SEES a submission on their client\'s campaign from a creator off their roster',
    r.error || ('rows=' + r.rows.length));
  r = await as(db, U.am1,
    `update public.submissions set status='Approved' where id='50000000-0000-0000-0000-0000000000a1' returning status`);
  R(r.rows.length === 1, 'and can approve it', r.error || ('rows=' + r.rows.length));

  r = await as(db, U.am1, `select count(*)::int n from public.submissions where campaign_id='${CA2}'`);
  R(r.rows[0] && r.rows[0].n === 0, 'but still reads nothing from the other tenant', 'saw ' + (r.rows[0] && r.rows[0].n));
  r = await as(db, U.am1,
    `update public.submissions set status='Approved' where id='50000000-0000-0000-0000-0000000000a2' returning status`);
  R(r.rows.length === 0, 'and cannot approve the other tenant\'s submission', 'rows=' + r.rows.length);

  // ---- the payment an approval creates --------------------------------------
  r = await as(db, U.am1,
    `insert into public.payments(creator_id, campaign_id, amount_owed, videos_approved, status)
     values ('${CR2}','${CA1}', 50, 1, 'Pending')`);
  // No RETURNING: managers have no SELECT on payments, and the app's insert
  // does not ask for the row back either.
  R(!r.error && r.affected === 1, 'approving manager can create the Pending payment at the campaign rate', r.error);
  r = await as(db, U.am1,
    `insert into public.payments(creator_id, campaign_id, amount_owed, videos_approved, status)
     values ('${CR2}','${CA1}', 5000, 1, 'Pending')`);
  R(!!r.error, 'but not for more than the campaign\'s rate', r.error ? 'refused' : 'ACCEPTED');
  r = await as(db, U.am1,
    `insert into public.payments(creator_id, campaign_id, amount_owed, videos_approved, status)
     values ('${CR2}','${CA1}', 50, 1, 'Paid')`);
  R(!!r.error, 'nor already marked Paid', r.error ? 'refused' : 'ACCEPTED');
  r = await as(db, U.am1,
    `insert into public.payments(creator_id, campaign_id, amount_owed, videos_approved, status)
     values ('${CR2}','${CA2}', 80, 1, 'Pending')`);
  R(!!r.error, 'nor on another tenant\'s campaign', r.error ? 'refused' : 'ACCEPTED');

  // ---- picking creators -----------------------------------------------------
  await db.exec(`insert into public.creators(id, name, am_id, bank_account_last4)
                 values ('e0000000-0000-0000-0000-000000000004','Creator Four', NULL, '4444')`);
  r = await as(db, U.am1, `select * from public.list_unassigned_creators()`);
  R(r.rows.some(x => x.name === 'Creator Four'), 'a manager can list the unassigned pool', r.error);
  R(r.rows.length > 0 && !('bank_account_last4' in r.rows[0]) && !('payout_email' in r.rows[0]),
    'and the pool carries no payout details', r.rows[0] ? Object.keys(r.rows[0]).join(',') : '');
  r = await as(db, U.cre1, `select * from public.list_unassigned_creators()`);
  R(r.rows.length === 0, 'a creator gets nothing from the pool', 'rows=' + r.rows.length);

  r = await as(db, U.am1, `select public.claim_creator('e0000000-0000-0000-0000-000000000004') as id`);
  R(!r.error, 'a manager can claim an unassigned creator', r.error);
  r = await as(db, U.am2, `select public.claim_creator('e0000000-0000-0000-0000-000000000004') as id`);
  R(!!r.error, 'a second manager cannot take them', r.error ? 'refused' : 'ACCEPTED');
  r = await as(db, U.am2, `select public.claim_creator('${CR1}') as id`);
  R(!!r.error, 'and cannot poach a colleague\'s creator', r.error ? 'refused' : 'ACCEPTED');
  r = await as(db, U.am1,
    `update public.creators set archived_at = now() where id='e0000000-0000-0000-0000-000000000004' returning id`);
  R(r.rows.length === 1, 'a manager can archive a creator on their own roster', r.error || ('rows=' + r.rows.length));
  r = await as(db, U.am1, `update public.creators set archived_at = now() where id='${CR2}' returning id`);
  R(r.rows.length === 0, 'but not one on a colleague\'s', 'rows=' + r.rows.length);

  // Adding a brand-new creator straight onto the roster.
  r = await as(db, U.am1,
    `insert into public.creators(name, email, am_id) values ('Fresh Face','fresh@x.com','${AM1}') returning id`);
  R(r.rows.length === 1, 'a manager can add a new creator to their own roster', r.error);
  const freshId = r.rows[0] && r.rows[0].id;

  r = await as(db, U.am2, `select public.release_creator('${freshId}') as id`);
  R(!!r.error, 'a manager cannot release a creator who is not theirs', r.error ? 'refused' : 'ACCEPTED');
  r = await as(db, U.am1, `select public.release_creator('${freshId}') as id`);
  R(!r.error, 'but can release their own', r.error);
  r = await db.query(`select am_id from public.creators where id='${freshId}'`);
  R(r.rows[0] && r.rows[0].am_id === null, 'which returns them to the unassigned pool, record intact', JSON.stringify(r.rows[0]));

  // ===========================================================================
  console.log('\nP0-B -- commission edits persist, for the right person');
  // ===========================================================================

  r = await as(db, U.owner,
    `update public.campaigns set is_sales_sourced = true, sales_commission_rate = 0.20, manager_commission_rate = 0.10
     where id='${CA1}' returning sales_commission_rate s`);
  R(r.rows.length === 1, 'the owner can set a 20% sales rate and a manager rate', r.error);
  r = await db.query(`select is_sales_sourced f, sales_commission_rate s, manager_commission_rate m from public.campaigns where id='${CA1}'`);
  R(r.rows[0].f === true && Number(r.rows[0].s) === 0.2 && Number(r.rows[0].m) === 0.1,
    'and a fresh read returns what was written', JSON.stringify(r.rows[0]));

  await as(db, U.owner, `update public.campaigns set is_sales_sourced = false where id='${CA1}'`);
  r = await db.query(`select sales_commission_rate s from public.campaigns where id='${CA1}'`);
  R(Number(r.rows[0].s) === 0.2, 'unticking "sales sourced" does not forget which rate was chosen', 's=' + r.rows[0].s);

  r = await as(db, U.owner, `update public.campaigns set sales_commission_rate = 0.25 where id='${CA1}'`);
  R(!!r.error, 'a rate outside 10 / 20 / 30% is rejected', r.error ? 'refused' : 'ACCEPTED');

  r = await as(db, U.am1, `update public.campaigns set manager_commission_rate = 0.50 where id='${CA1}'`);
  R(!!r.error, 'a manager cannot raise their own commission', r.error ? 'refused' : 'ACCEPTED');
  r = await as(db, U.am1, `update public.campaigns set sales_commission_rate = 0.10 where id='${CA1}'`);
  R(!!r.error, 'nor change the sales rate', r.error ? 'refused' : 'ACCEPTED');
  r = await as(db, U.am1, `update public.campaigns set show_client_cpm = true, name = 'Campaign One (edited)' where id='${CA1}' returning name`);
  R(r.rows.length === 1, 'but can still edit the campaign and flip the client CPM switch', r.error);
  r = await as(db, U.am1,
    `insert into public.campaigns(name, client_id, status, sales_commission_rate, manager_commission_rate)
     values ('AM made this','${CL1}','Open', 0.10, 0.50) returning sales_commission_rate s, manager_commission_rate m`);
  R(r.rows.length === 1 && Number(r.rows[0].s) === 0.3 && r.rows[0].m === null,
    'a campaign a manager creates gets the default rates regardless of what was sent',
    r.error || JSON.stringify(r.rows[0]));

  // ---- performance overrides ------------------------------------------------
  r = await as(db, U.am1, `update public.creators set score_override = 92, tier_override = 'A' where id='${CR1}' returning score_override`);
  R(r.rows.length === 1, 'a manager can override the score of a creator on their roster', r.error);
  r = await as(db, U.cre1, `update public.creators set tier_override = 'A', score_override = 100 where id='${CR1}'`);
  R(!!r.error, 'a creator cannot grade themselves', r.error ? 'refused' : 'ACCEPTED');
  r = await as(db, U.cre1, `update public.creators set name = 'Creator One Renamed' where id='${CR1}' returning name`);
  R(r.rows.length === 1, 'but can still edit the rest of their own profile', r.error);
  r = await as(db, U.owner, `update public.creators set score_override = 140 where id='${CR1}'`);
  R(!!r.error, 'a score above 100 is rejected', r.error ? 'refused' : 'ACCEPTED');

  // ===========================================================================
  console.log('\nP3 -- what the client portal can see');
  // ===========================================================================

  await db.exec(`GRANT SELECT ON public.client_safe_campaigns TO authenticated;`);
  r = await as(db, U.client1, `select * from public.client_safe_campaigns order by campaign_name`);
  const mine = r.rows.find(x => x.campaign_id === CA1);
  R(!!mine && mine.show_client_cpm === true, 'the client view carries the CPM switch the manager just flipped',
    r.error || (mine ? 'show_client_cpm=' + mine.show_client_cpm : 'campaign not visible'));
  R(r.rows.length > 0 && r.rows.every(x => x.client_id === CL1), 'and only that client\'s own campaigns',
    'client_ids=' + [...new Set(r.rows.map(x => x.client_id))].join(','));
  const cols = r.rows[0] ? Object.keys(r.rows[0]) : [];
  const leaked = cols.filter(c => /pay_per_video|budget|commission|assigned_creators/.test(c));
  R(cols.length > 0 && leaked.length === 0, 'with no cost, rate or roster columns', leaked.join(',') || cols.join(','));

  await db.close();
}

(async () => {
  await run();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\nHARNESS ERROR:', e); process.exit(2); });
