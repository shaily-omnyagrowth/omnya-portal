// admin_migration_status() and the shared evaluator in api/_lib/migrationProbes.js:
//
//   2. only service_role may execute it (authenticated and anon are refused)
//   3. every probe kind answers present AND missing correctly
//   4. the RPC and the runner's query (lifted from the same file) agree
//   5. history is read when supabase_migrations.schema_migrations exists, and
//      is [] when it does not
//   6. computeRows turns history plus probes into the four states, including
//      retiredBy and manual rows; baseline only ever picks drift rows
//
//   node supabase/migrations/__tests__/migration-status.test.cjs

const path = require('path');
const { freshDb, read, MIG } = require('./db.cjs');
const probes = require('../../../api/_lib/migrationProbes');

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};

// Objects for every probe kind, each with a present and a missing twin.
const SETUP = `
  CREATE TABLE public.probe_t (id int PRIMARY KEY, a text, b text,
    CONSTRAINT probe_t_a_chk CHECK (a <> ''));
  CREATE INDEX probe_t_a_idx ON public.probe_t (a);
  CREATE FUNCTION public.probe_fn(uuid, text) RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$;
  CREATE FUNCTION public.probe_body() RETURNS int LANGUAGE plpgsql AS $f$
    BEGIN
      -- fixed: the new marker lives here
      RETURN 2;
    END $f$;
  CREATE FUNCTION public.probe_trg_fn() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$;
  CREATE TRIGGER probe_trg BEFORE INSERT ON public.probe_t FOR EACH ROW EXECUTE FUNCTION public.probe_trg_fn();
  ALTER TABLE public.probe_t ENABLE ROW LEVEL SECURITY;
  CREATE POLICY probe_pol ON public.probe_t FOR SELECT USING (true);
`;

const CASES = [
  ['table',         { kind: 'table', table: 'public.probe_t' },                          { kind: 'table', table: 'public.nope_t' }],
  ['columns',       { kind: 'columns', table: 'public.probe_t', columns: ['a', 'b'] },   { kind: 'columns', table: 'public.probe_t', columns: ['a', 'zz'] }],
  ['function',      { kind: 'function', signature: 'public.probe_fn(uuid, text)' },      { kind: 'function', signature: 'public.probe_fn(uuid)' }],
  ['function_body', { kind: 'function_body', signature: 'public.probe_body()', marker: 'new marker lives here' },
                    { kind: 'function_body', signature: 'public.probe_body()', marker: 'old body text' }],
  ['function_body (no such function)', null,
                    { kind: 'function_body', signature: 'public.nope_fn()', marker: 'x' }],
  ['policy',        { kind: 'policy', table: 'public.probe_t', policy: 'probe_pol' },    { kind: 'policy', table: 'public.probe_t', policy: 'nope_pol' }],
  ['trigger',       { kind: 'trigger', table: 'public.probe_t', trigger: 'probe_trg' },  { kind: 'trigger', table: 'public.nope_t', trigger: 'probe_trg' }],
  ['index',         { kind: 'index', index: 'public.probe_t_a_idx' },                    { kind: 'index', index: 'public.nope_idx' }],
  ['constraint',    { kind: 'constraint', table: 'public.probe_t', constraint: 'probe_t_a_chk' },
                    { kind: 'constraint', table: 'public.probe_t', constraint: 'nope_chk' }],
];

function payloadFor() {
  const out = [];
  for (const [name, yes, no] of CASES) {
    if (yes) out.push({ file: `${name}:present`, ...yes });
    out.push({ file: `${name}:missing`, ...no });
  }
  return out;
}

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0];

(async () => {
  console.log('\nadmin_migration_status');
  const db = await freshDb({ migrations: false });

  await db.exec(SETUP);
  const payload = payloadFor();
  const payloadJson = JSON.stringify(payload);

  // --- 2. who may call it ----------------------------------------------------
  console.log('\n  --- privileges ---');
  for (const role of ['anon', 'authenticated']) {
    let denied = false, msg = '';
    try {
      await db.exec(`SET ROLE ${role};`);
      await db.query('SELECT public.admin_migration_status($1::jsonb)', ['[]']);
    } catch (e) {
      denied = /permission denied/i.test(e.message);
      msg = e.message.split('\n')[0].slice(0, 90);
    } finally {
      await db.exec('RESET ROLE;');
    }
    R(denied, `${role} is refused`, msg);
  }

  let rpc;
  try {
    await db.exec('SET ROLE service_role;');
    rpc = (await one(db, 'SELECT public.admin_migration_status($1::jsonb) AS r', [payloadJson])).r;
    R(true, 'service_role may execute it');
  } catch (e) {
    R(false, 'service_role may execute it', e.message.slice(0, 120));
  } finally {
    await db.exec('RESET ROLE;');
  }

  // --- 3. every probe kind -----------------------------------------------------
  console.log('\n  --- probe kinds (RPC) ---');
  const byFile = Object.fromEntries(((rpc && rpc.probes) || []).map((p) => [p.file, p.present]));
  for (const [name, yes] of CASES) {
    if (yes) R(byFile[`${name}:present`] === true, `${name}: present object reads present`);
    R(byFile[`${name}:missing`] === false, `${name}: missing object reads missing`);
  }
  R(rpc && Array.isArray(rpc.history) && rpc.history.length === 0,
    'history is [] when supabase_migrations.schema_migrations does not exist');

  // --- 4. the runner's query, lifted from the same file, agrees -------------
  console.log('\n  --- runner query (probeSelectSql) ---');
  try {
    const runnerRows = (await db.query(probes.probeSelectSql(), [payloadJson])).rows;
    const runnerByFile = Object.fromEntries(runnerRows.map((r) => [r.file, r.present]));
    const disagree = Object.keys(byFile).filter((f) => byFile[f] !== runnerByFile[f]);
    R(runnerRows.length === payload.length && disagree.length === 0,
      'runner and RPC agree on every probe', disagree.length ? 'disagree: ' + disagree.join(', ') : `${runnerRows.length} probes`);
  } catch (e) {
    R(false, 'runner query runs', e.message.slice(0, 160));
  }

  // --- 5. history, when the CLI table exists --------------------------------
  console.log('\n  --- history ---');
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS supabase_migrations;
    CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text);
    INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
      ('20260908000000', 'campaign_shares_and_progress');
  `);
  await db.exec('SET ROLE service_role;');
  const rpc2 = (await one(db, 'SELECT public.admin_migration_status($1::jsonb) AS r', ['[]'])).r;
  await db.exec('RESET ROLE;');
  R(rpc2.history.length === 1 && rpc2.history[0].version === '20260908000000' &&
    rpc2.history[0].name === 'campaign_shares_and_progress',
    'history lists recorded versions and names');

  // --- 6. state model ----------------------------------------------------------
  console.log('\n  --- state model (computeRows) ---');
  const A = '20990101000001_a.sql', B = '20990101000002_b.sql', C = '20990101000003_c.sql',
        D = '20990101000004_d.sql', E = '20990101000005_e.sql', F = '20990101000006_f.sql',
        G = '20990101000007_g.sql';
  const m = {
    [A]: { kind: 'table', table: 'public.a' },
    [B]: { kind: 'table', table: 'public.b' },
    [C]: { kind: 'table', table: 'public.c' },
    [D]: { kind: 'table', table: 'public.d' },
    [E]: { kind: 'table', table: 'public.e', retiredBy: D },
    [F]: { kind: 'manual', why: 'checked by hand' },
    [G]: { kind: 'table', table: 'public.g', retiredBy: C },
  };
  const rows = probes.computeRows({
    files: [A, B, C, D, E, F, G],
    manifest: m,
    history: [{ version: '20990101000001' }, { version: '20990101000002' }],
    present: { [A]: true, [B]: false, [C]: false, [D]: true },
  });
  const st = Object.fromEntries(rows.map((r) => [r.file, r.state]));
  R(st[A] === 'applied', 'recorded + present = applied');
  R(st[B] === 'broken', 'recorded + missing = broken');
  R(st[C] === 'pending', 'not recorded + missing = pending');
  R(st[D] === 'drift', 'not recorded + present = drift');
  R(st[E] === 'drift', 'retiredBy, not recorded, its later file present = drift (baseline may record it)');
  R(st[G] === 'pending', 'retiredBy, not recorded, its later file missing = pending');
  R(st[F] === 'manual', 'manual row is "manual", never applied');
  const retiredRecorded = probes.computeRows({
    files: [E], manifest: m, history: ['20990101000005'], present: {},
  })[0];
  R(retiredRecorded.state === 'applied' && retiredRecorded.probe === 'retired',
    'retiredBy, recorded = applied whatever its probe says');
  const sum = probes.summarize(rows);
  R(sum.allApplied === false && sum.drift === 2 && sum.manual === 1, 'summary counts states', JSON.stringify(sum));

  const payloadSent = probes.probePayload(m).map((p) => p.file);
  R(!payloadSent.includes(E) && !payloadSent.includes(F) && !payloadSent.includes(G),
    'manual and retiredBy entries are not sent to the catalog');
  R(probes.probePayload({ [A]: { kind: 'policy', table: 'campaigns', policy: 'x' } })[0].table === 'public.campaigns',
    'unqualified table names are qualified with public.');

  await db.close();

  // --- 7. the real manifest against the real chain ---------------------------
  // A probe that is already present on the base schema proves nothing (a fresh
  // project would show the file as drift and baseline would record it
  // unapplied). A probe that is missing after the whole chain is a wrong
  // object name, and would leave its file pending forever.
  console.log('\n  --- probes.json against SETUP + every migration ---');
  const files = probes.listMigrationFiles().filter((f) => probes.manifest[f]);
  const realPayload = JSON.stringify(probes.probePayload());
  const chainDb = await freshDb({ migrations: false });
  const before = (await chainDb.query(probes.probeSelectSql(), [realPayload])).rows;
  const early = before.filter((r) => r.present).map((r) => r.file);
  R(early.length === 0, 'no probe is satisfied by SETUP.sql alone', early.join(', '));

  let halted = null;
  for (const f of files) {
    try { await chainDb.exec(read(path.join(MIG, f))); } catch (e) { halted = `${f}: ${e.message.slice(0, 100)}`; break; }
  }
  R(!halted, `every migration applies on SETUP.sql (${files.length} files)`, halted || '');
  const after = (await chainDb.query(probes.probeSelectSql(), [realPayload])).rows;
  const absent = after.filter((r) => !r.present).map((r) => r.file);
  R(absent.length === 0, `every probe reads present after them (${after.length} probes)`, absent.join(', '));
  await chainDb.close();

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('\nHARNESS ERROR:', e); process.exit(2); });
