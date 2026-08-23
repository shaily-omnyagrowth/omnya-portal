// Integration test for the 20260821 payout migrations.
//
// Runs them against a real PostgreSQL engine (PGlite, Postgres 18 compiled to
// WASM) on a fixture schema built from the live production column lists. This
// is what validates the PL/pgSQL function bodies -- a plain SQL parse only
// checks the outer grammar and treats $$...$$ bodies as opaque strings.
//
//   npm i -D @electric-sql/pglite
//   node supabase/migrations/__tests__/migration.test.cjs
//
// Exits non-zero on any failure. Touches nothing outside the in-memory engine.

const fs = require('fs');
let PGlite;
try {
  ({ PGlite } = require('@electric-sql/pglite'));
} catch (e) {
  console.error([
    '',
    'This test needs an embedded Postgres engine, which is not installed:',
    '  npm i -D @electric-sql/pglite',
    'then re-run:',
    '  node supabase/migrations/__tests__/migration.test.cjs',
    '',
  ].join(String.fromCharCode(10)));
  process.exit(2);
}

const S = __dirname;
const MIG = require('path').join(__dirname, '..');

const read = p => fs.readFileSync(p, 'utf8');
let pass = 0, fail = 0;
const R = (ok, label, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  ok ? pass++ : fail++;
};

async function fresh() {
  const db = await PGlite.create();
  await db.exec(read(S + '/fixture_schema.sql'));
  return db;
}
const asUser = (db, uid) => db.exec(`select set_config('request.jwt.claim.sub', '${uid}', false);`);

process.on('unhandledRejection',e=>{console.log('  UNHANDLED: '+String(e&&e.message).slice(0,160));process.exit(1)});

(async () => {

// ============================================================ 1. clean apply
console.log('\n1. Apply 20260821000000 to a schema that mirrors production');
let db = await fresh();
try {
  await db.exec(read(MIG + '/20260821000000_payout_drift_and_authz.sql'));
  R(true, 'migration applies without error', '(all PL/pgSQL bodies compiled)');
} catch (e) {
  R(false, 'migration applies without error', String(e.message).slice(0, 220));
  console.log('\n  Cannot continue — aborting.');
  process.exit(1);
}

// ---- N-03 constraint
console.log('\n2. N-03 — the status CHECK now accepts the payout states');
{
  const c = await db.query(`select pg_get_constraintdef(oid) d from pg_constraint
                            where conrelid='public.creator_earnings'::regclass
                              and conname='creator_earnings_status_check'`);
  const d = c.rows[0] ? c.rows[0].d : '';
  for (const st of ['needs_review', 'withdrawal_requested', 'batched'])
    R(d.includes(st), `accepts '${st}'`);
}

// ---- F-9 row lock
console.log('\n3. F-9 — the row lock is in request_creator_withdrawal');
{
  const f = await db.query(`select pg_get_functiondef(p.oid) d from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='request_creator_withdrawal'`);
  R(f.rows[0].d.includes('FOR UPDATE'), 'FOR UPDATE present');
}

// ---- F-2 wrappers + sealed internals
console.log('\n4. F-2 — wrappers published, internals sealed');
{
  const q = await db.query(`select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (proname like '%withdrawal%' or proname like '%payout%')
    order by proname`);
  const names = q.rows.map(r => r.proname);
  for (const fn of ['approve_withdrawal_request', 'reject_withdrawal_request',
                    'create_payout_batch', 'mark_payout_batch_paid']) {
    R(names.includes(fn) && names.includes(fn + '_internal'), `${fn} + _internal both exist`);
  }
  const anon = await db.query(`select p.proname,
      has_function_privilege('anon', p.oid, 'EXECUTE') ex
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in
      ('request_creator_withdrawal','approve_withdrawal_request','reject_withdrawal_request',
       'create_payout_batch','mark_payout_batch_paid')`);
  const leaky = anon.rows.filter(r => r.ex).map(r => r.proname);
  R(leaky.length === 0, 'anon cannot execute any payout RPC',
    leaky.length ? 'STILL EXECUTABLE: ' + leaky.join(', ') : '(N-11 closed)');
}

// ---- authorization actually enforced
console.log('\n5. N-11 — authorization is enforced at runtime, not just declared');
{
  const owner = '11111111-1111-1111-1111-111111111111';
  const creatorUser = '22222222-2222-2222-2222-222222222222';
  const clientUser = '33333333-3333-3333-3333-333333333333';
  await db.exec(`
    insert into auth.users(id) values ('${owner}'),('${creatorUser}'),('${clientUser}');
    insert into user_profiles(id,email,role) values
      ('${owner}','o@x.com','owner'),
      ('${creatorUser}','c@x.com','creator'),
      ('${clientUser}','cl@x.com','client');
    insert into creators(id,user_id,name,email,payment_method,payment_method_status)
      values ('44444444-4444-4444-4444-444444444444','${creatorUser}','C','c@x.com','zelle','submitted');
    insert into creator_earnings(creator_id,earning_type,amount,status)
      values ('44444444-4444-4444-4444-444444444444','base_video_pay',100,'approved');
    insert into withdrawal_requests(id,creator_id,amount,currency,payment_method,status)
      values ('55555555-5555-5555-5555-555555555555','44444444-4444-4444-4444-444444444444',
              100,'USD','zelle','pending_admin_approval');
  `);

  const tryCall = async (uid, sql) => {
    await asUser(db, uid);
    try { const r = await db.query(sql); return { ok: true, r }; }
    catch (e) { return { ok: false, msg: e.message }; }
  };

  let x = await tryCall(creatorUser, `select approve_withdrawal_request('55555555-5555-5555-5555-555555555555', '${creatorUser}')`);
  R(!x.ok && /Not authorized/i.test(x.msg || ''), 'creator CANNOT approve their own withdrawal',
    x.ok ? 'IT SUCCEEDED — hole still open' : x.msg.slice(0, 60));

  x = await tryCall(clientUser, `select approve_withdrawal_request('55555555-5555-5555-5555-555555555555', '${clientUser}')`);
  R(!x.ok && /Not authorized/i.test(x.msg || ''), 'client CANNOT approve a withdrawal',
    x.ok ? 'IT SUCCEEDED' : x.msg.slice(0, 60));

  x = await tryCall(creatorUser, `select mark_payout_batch_paid('66666666-6666-6666-6666-666666666666', '${creatorUser}')`);
  R(!x.ok && /Not authorized/i.test(x.msg || ''), 'creator CANNOT mark a batch paid',
    x.ok ? 'IT SUCCEEDED' : x.msg.slice(0, 60));

  x = await tryCall(owner, `select approve_withdrawal_request('55555555-5555-5555-5555-555555555555', null) v`);
  R(x.ok, 'owner CAN approve', x.ok ? 'succeeded' : x.msg.slice(0, 80));

  // F-8: the recorded actor is auth.uid(), not whatever was passed in.
  const audit = await db.query(`select actor_user_id from payment_audit_logs
                                where action='withdrawal_approved' order by created_at desc limit 1`);
  R(audit.rows[0] && audit.rows[0].actor_user_id === owner,
    'F-8 audit actor is auth.uid(), not the caller-supplied id',
    audit.rows[0] ? audit.rows[0].actor_user_id : 'no row');

  // A creator forging another actor id must still be refused.
  x = await tryCall(creatorUser, `select approve_withdrawal_request('55555555-5555-5555-5555-555555555555', '${owner}')`);
  R(!x.ok, 'creator passing the OWNER id is still refused',
    x.ok ? 'FORGERY SUCCEEDED' : 'refused');
}

// ---- F-2 ownership check on request_creator_withdrawal
console.log('\n6. F-2 — a creator cannot request a withdrawal for someone else');
{
  const other = '77777777-7777-7777-7777-777777777777';
  await db.exec(`insert into auth.users(id) values ('${other}');
    insert into user_profiles(id,email,role) values ('${other}','o2@x.com','creator');
    insert into creators(id,user_id,name,email,payment_method,payment_method_status)
      values ('88888888-8888-8888-8888-888888888888','${other}','C2','o2@x.com','zelle','submitted');`);
  await asUser(db, other);
  try {
    await db.query(`select request_creator_withdrawal('44444444-4444-4444-4444-444444444444','USD','zelle','x')`);
    R(false, 'refuses a foreign creator_id', 'IT SUCCEEDED — anyone can cash out anyone');
  } catch (e) {
    R(/Not authorized/i.test(e.message), 'refuses a foreign creator_id', e.message.slice(0, 60));
  }
}

// ============================================================ ordering guard
console.log('\n7. The ordering guard refuses to run on stale bodies');
{
  const db2 = await fresh();
  // Re-create one function the OLD way, writing to the dropped column.
  await db2.exec(`
    alter table payment_audit_logs add column performed_by uuid;
    create or replace function public.approve_withdrawal_request(p_request_id uuid, p_approved_by uuid default null)
    returns jsonb language plpgsql security definer set search_path=public,auth as $x$
    begin
      insert into payment_audit_logs(entity_type,entity_id,action,performed_by,metadata)
      values ('withdrawal_request',p_request_id,'withdrawal_approved',p_approved_by,'{}'::jsonb);
      return jsonb_build_object('success',true);
    end $x$;
    alter table payment_audit_logs drop column performed_by;
  `);
  try {
    await db2.exec(read(MIG + '/20260821000000_payout_drift_and_authz.sql'));
    R(false, 'guard fires on stale bodies', 'MIGRATION APPLIED ANYWAY — guard is broken');
  } catch (e) {
    R(/Stale payout RPC bodies/i.test(e.message), 'guard fires on stale bodies', e.message.slice(0, 70));
  }
  try { await db2.exec('rollback;'); } catch (_) {}
  // and nothing was left half-applied
  const c = await db2.query(`select pg_get_constraintdef(oid) d from pg_constraint
      where conrelid='public.creator_earnings'::regclass and conname='creator_earnings_status_check'`);
  R(!c.rows[0].d.includes('withdrawal_requested'),
    'transaction rolled back cleanly — no partial apply');
}

// ============================================================ idempotency
console.log('\n8. Re-running the migration is a no-op, not an error');
try {
  await db.exec(read(MIG + '/20260821000000_payout_drift_and_authz.sql'));
  const q = await db.query(`select count(*)::int n from pg_proc p join pg_namespace nn on nn.oid=p.pronamespace
    where nn.nspname='public' and p.proname like '%_internal'`);
  R(q.rows[0].n === 4, 'second apply succeeds and still leaves exactly 4 internals', 'n=' + q.rows[0].n);
} catch (e) {
  R(false, 'second apply succeeds', e.message.slice(0, 160));
}

// ============================================================ client policy
console.log('\n9. Apply 20260821000001 (client creator visibility)');
try {
  await db.exec(read(MIG + '/20260821000001_client_creator_visibility.sql'));
  const p = await db.query(`select policyname from pg_policies
    where schemaname='public' and tablename='creators'
      and policyname='client_select_creators_on_own_campaigns'`);
  R(p.rows.length === 1, 'policy created');
} catch (e) {
  R(false, 'migration applies', e.message.slice(0, 200));
}

// ============================================================ verify script
console.log('\n10. VERIFY_20260821.sql runs');
try {
  const sql = read(MIG + '/VERIFY_20260821.sql');
  const out = await db.exec(sql);
  R(true, 'verify script executes', `${out.length} result sets`);
  for (const rs of out) {
    if (rs.rows && rs.rows.length && rs.rows[0].check_name && rs.rows[0].status) {
      const r = rs.rows[0];
      console.log(`        ${String(r.status).startsWith('PASS') ? 'PASS' : 'FAIL'}  ${r.check_name}`);
    }
  }
} catch (e) {
  R(false, 'verify script executes', e.message.slice(0, 220));
}

console.log(`\n${'-'.repeat(64)}\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
})();
