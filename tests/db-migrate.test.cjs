// tests/db-migrate.test.cjs
//
// Drives scripts/db-migrate.cjs (spec 0001, AC-3 to AC-6) against a real
// PostgreSQL engine (PGlite) standing in for production. The Supabase CLI,
// pg_dump, docker and the typed confirmation are stubbed; the probes, the
// history table and every applied migration are real.
//
// The CLI stub answers push and repair with the Management API 403, so the
// writes go through the runner's own fallback (`pg`) path, which is the path
// whose SQL this suite can actually observe.
//
//   node tests/db-migrate.test.cjs

const fs = require('fs');
const os = require('os');
const path = require('path');

let PGlite;
try {
  ({ PGlite } = require('@electric-sql/pglite'));
} catch {
  console.error('SKIP: @electric-sql/pglite is not installed.  npm i -D @electric-sql/pglite');
  process.exit(0);
}

const runner = require('../scripts/db-migrate.cjs');
const probes = require('../api/_lib/migrationProbes');

const ROOT = path.join(__dirname, '..');
const MIG = probes.MIGRATIONS_DIR;
const REF = 'abcdefghijklmnopqrst';
const URL_OK = `postgresql://postgres.${REF}:s3cret@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;
const LAST_TWO = ['20260908000000_campaign_shares_and_progress.sql', '20261001000000_admin_migration_status.sql'];

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'db-migrate-test-'));
function envFile(lines) {
  const p = path.join(TMP, `env-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(p, lines.join('\n'));
  return p;
}
const goodEnv = () => envFile([
  `SUPABASE_DB_URL=${URL_OK}`,
  `SUPABASE_PROJECT_REF=${REF}`,
  `MIGRATE_BACKUP_DIR=${path.join(TMP, 'backups')}`,
]);

// Production as it was on 2026-10-01: the schema built, history empty, the
// last two files never applied.
async function productionLike() {
  const chainSrc = fs.readFileSync(path.join(MIG, '__tests__', 'full-chain.test.cjs'), 'utf8');
  const BOOT = chainSrc.match(/const BOOTSTRAP = `([\s\S]*?)`;/)[1];
  const ORDER = [...chainSrc.match(/const ORDER = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+\.sql)'/g)].map((x) => x[1]);
  const files = probes.listMigrationFiles().filter((f) => probes.manifest[f]);
  const chain = [...ORDER.filter((f) => files.includes(f)), ...files.filter((f) => !ORDER.includes(f))]
    .filter((f) => !LAST_TWO.includes(f));
  const db = await PGlite.create();
  await db.exec(BOOT);
  await db.exec(fs.readFileSync(path.join(MIG, '..', 'SETUP_FROM_SCRATCH.sql'), 'utf8'));
  for (const f of chain) await db.exec(fs.readFileSync(path.join(MIG, f), 'utf8'));
  return db;
}

// node-pg's Client surface, as far as the runner uses it.
//
// `sys.pendingLand` lets the synchronous CLI stub say "the CLI applied this
// file": the adapter does that work (apply and record) before its next query,
// which is when the runner would next look at the database. `sys.applied`
// counts every time a migration file's SQL runs, from either path.
function pgAdapter(db, sys) {
  const fileSql = new Map(probes.listMigrationFiles().map((f) => [fs.readFileSync(path.join(MIG, f), 'utf8'), f]));
  const count = (sql) => {
    const f = fileSql.get(sql);
    if (f && sys) sys.applied[f] = (sys.applied[f] || 0) + 1;
  };
  return {
    async query(sql, params) {
      if (sys && sys.pendingLand) {
        const f = sys.pendingLand;
        sys.pendingLand = null;
        const text = fs.readFileSync(path.join(MIG, f), 'utf8');
        count(text);
        await db.exec(text);
        await db.exec(`CREATE SCHEMA IF NOT EXISTS supabase_migrations;
          CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text);`);
        await db.query('INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ($1, $2)',
          [probes.versionOf(f), probes.nameOf(f)]);
      }
      count(sql);
      if (params) return db.query(sql, params);
      const res = await db.exec(sql);
      return { rows: (res[res.length - 1] || { rows: [] }).rows };
    },
    async end() {},
  };
}

function makeSys(db, { answer = REF, pgDump = 'ok', env = {}, cliPush = '403' } = {}) {
  const calls = [];
  const logs = [];
  const sys = {
    log: (s = '') => logs.push(String(s)),
    err: (s = '') => logs.push(String(s)),
    env,
    homedir: TMP,
    user: 'tester',
    now: () => new Date('2026-10-01T12:00:00Z'),
    connects: 0,
    asked: 0,
    exec(cmd, args) {
      calls.push([path.basename(cmd), ...args]);
      const cliArgs = args[0] && args[0].endsWith('supabase.js') ? args.slice(1) : null;
      if (cliArgs) {
        if (cliArgs[0] === '--version') return { status: 0, stdout: '2.119.0\n', stderr: '' };
        if (cliArgs[0] === 'db' && cliArgs[1] === 'push') {
          if (cliArgs.includes('--dry-run')) return { status: 0, stdout: 'Would push these migrations:\n', stderr: '' };
          if (cliPush === '403') return { status: 1, stdout: '', stderr: 'unexpected status 403: Forbidden (Management API)' };
          // The CLI lands the first pending file, then stops on a 403.
          if (cliPush === 'partial403') {
            sys.pendingLand = LAST_TWO[0];
            return { status: 1, stdout: `Applying migration ${LAST_TWO[0]}...\n`, stderr: 'unexpected status 403: Forbidden' };
          }
          // A real SQL failure whose echoed statement happens to contain the word "forbidden".
          if (cliPush === 'sqlerror') {
            return { status: 1, stdout: `Applying migration ${LAST_TWO[0]}...\n`,
              stderr: 'ERROR: column "forbidden_reason" does not exist (SQLSTATE 42703)\nAt statement: ALTER TABLE t ADD CHECK (forbidden_reason IS NULL)' };
          }
        }
        if (cliArgs[0] === 'migration') return { status: 1, stdout: '', stderr: 'unexpected status 403: Forbidden' };
        return { status: 1, stdout: '', stderr: 'unexpected CLI call in test' };
      }
      if (cmd === 'pg_dump') {
        if (args[0] === '--version') return { status: 0, stdout: 'pg_dump (PostgreSQL) 18.1\n', stderr: '' };
        const file = args[args.indexOf('--file') + 1];
        if (pgDump === 'fail') return { status: 1, stdout: '', stderr: 'pg_dump: error: connection refused' };
        fs.writeFileSync(file, pgDump === 'empty' ? '' : '-- dump\n');
        return { status: 0, stdout: '', stderr: '' };
      }
      if (cmd === 'docker') return { status: 1, stdout: '', stderr: 'not running' };
      return { status: 1, stdout: '', stderr: `unexpected command ${cmd}` };
    },
    async connect() { sys.connects++; return pgAdapter(db, sys); },
    pendingLand: null,
    applied: {},
    async ask() { sys.asked++; return answer; },
  };
  sys.calls = calls;
  sys.logs = logs;
  sys.dumped = () => calls.some((c) => c[0] === 'pg_dump' && c[1] !== '--version');
  return sys;
}

const historyOf = async (db) => {
  const ok = (await db.query("SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS ok")).rows[0].ok;
  if (!ok) return null;
  return (await db.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version')).rows.map((r) => r.version);
};

(async () => {
  // ------------------------------------------------------------ pure pieces
  console.log('\nTarget and folder checks (AC-5)');
  const p = runner.parseDbUrl(URL_OK);
  R(p.ref === REF && p.form === 'pooler', 'reads the ref from a session pooler URL');
  R(runner.parseDbUrl(`postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres`).ref === REF, 'reads the ref from a direct URL');
  const refuses = (fn) => { try { fn(); return false; } catch (e) { return e instanceof runner.Refusal; } };
  R(refuses(() => runner.parseDbUrl(URL_OK.replace(':5432', ':6543'))), 'refuses the transaction pooler (6543)');
  R(refuses(() => runner.parseDbUrl('postgresql://postgres:pw@example.com:5432/postgres')), 'refuses a host that is not Supabase');
  R(refuses(() => runner.resolveBackupRoot(path.join(ROOT, 'backups'), { env: {}, homedir: TMP })), 'refuses a backup folder inside the repo');
  R(refuses(() => runner.resolveBackupRoot('C:\\Users\\x\\OneDrive\\b', { env: { OneDrive: 'C:\\Users\\x\\OneDrive' }, homedir: TMP })),
    'refuses a backup folder inside OneDrive');
  R(runner.resolveBackupRoot('', { env: {}, homedir: TMP }) === path.join(TMP, 'omnya-backups'), 'defaults to ~/omnya-backups');
  R(runner.versionAtLeast([2, 119, 0], [2, 20, 0]) && !runner.versionAtLeast([2, 9, 9], [2, 20, 0]), 'compares CLI versions numerically');
  const cf = runner.parseCliFailure('Applying migration 20260908000000_a.sql...\nApplying migration 20261001000000_b.sql...\nERROR: role "x" does not exist (SQLSTATE 42704)');
  R(cf.file === '20261001000000_b.sql' && /SQLSTATE 42704/.test(cf.error), 'reads the failed file and Postgres error from CLI output');

  // ------------------------------------------------------------ refusals
  console.log('\nRefusals happen before anything is touched (AC-5)');
  {
    const db = await productionLike();
    const wrongRef = makeSys(db);
    const e1 = envFile([`SUPABASE_DB_URL=${URL_OK}`, 'SUPABASE_PROJECT_REF=zzzzzzzzzzzzzzzzzzzz', `MIGRATE_BACKUP_DIR=${path.join(TMP, 'b')}`]);
    const c1 = await runner.main([`--env-file=${e1}`], wrongRef);
    R(c1 === 2 && wrongRef.connects === 0 && !wrongRef.dumped(), 'URL ref differs from SUPABASE_PROJECT_REF: exit 2, never connects');

    const typo = makeSys(db, { answer: 'aglikzyarmqbdmjvkvyj' });
    const c2 = await runner.main(['--baseline', `--env-file=${goodEnv()}`], typo);
    R(c2 === 2 && typo.asked === 1 && !typo.dumped() && (await historyOf(db)) === null,
      'typed ref is wrong: exit 2, no dump, history untouched');

    const noDump = makeSys(db, { pgDump: 'fail' });
    const c3 = await runner.main(['--baseline', `--env-file=${goodEnv()}`], noDump);
    R(c3 === 2 && (await historyOf(db)) === null, 'a failed dump refuses (exit 2) and records nothing');

    const emptyDump = makeSys(db, { pgDump: 'empty' });
    const c4 = await runner.main(['--baseline', `--env-file=${goodEnv()}`], emptyDump);
    R(c4 === 2 && (await historyOf(db)) === null, 'an empty dump refuses (exit 2) and records nothing');

    const missingEnv = makeSys(db);
    const c5 = await runner.main([`--env-file=${path.join(TMP, 'nope')}`], missingEnv);
    R(c5 === 2, 'no .env.migrate: exit 2');

    const pushFirst = makeSys(db);
    const c6 = await runner.main([`--env-file=${goodEnv()}`], pushFirst);
    R(c6 === 2 && !pushFirst.dumped() && pushFirst.logs.some((l) => /--baseline first/.test(l)),
      'push with drift rows refuses and points to --baseline');
    await db.close();
  }

  // ------------------------------------------------------------ status
  console.log('\n--status is read only (AC-3)');
  const db = await productionLike();
  const st = makeSys(db);
  const cs = await runner.main(['--status', `--env-file=${goodEnv()}`], st);
  const out = st.logs.join('\n');
  R(cs === 1, '--status exits 1 while gaps remain', `exit ${cs}`);
  R(/file\s+recorded\s+probe\s+state/.test(out), 'prints one table with file, recorded, probe, state');
  R(LAST_TWO.every((f) => new RegExp(`${f}\\s+no\\s+missing\\s+pending`).test(out)), 'the two unapplied files show pending');
  R(st.asked === 0 && !st.dumped() && (await historyOf(db)) === null, 'asks nothing, dumps nothing, writes nothing');
  R(fs.readFileSync(path.join(TMP, 'backups', 'migrate.log'), 'utf8').includes('\tstatus\t'), 'appends a line to migrate.log');

  // ------------------------------------------------------------ baseline
  console.log('\n--baseline records only what probes present (AC-4)');
  const bl = makeSys(db);
  const cb = await runner.main(['--baseline', `--env-file=${goodEnv()}`], bl);
  const hist = await historyOf(db);
  const rows = probes.computeRows({ files: probes.listMigrationFiles().filter((f) => probes.manifest[f]), history: [], present: {} });
  const manualFiles = rows.filter((r) => r.state === 'manual').map((r) => r.file);
  R(bl.asked === 1 && bl.dumped(), 'asked for the ref and dumped before writing');
  R(hist && !LAST_TWO.some((f) => hist.includes(probes.versionOf(f))), 'never records a file whose probe is missing');
  R(hist && !manualFiles.some((f) => hist.includes(probes.versionOf(f))), 'never records a manual file');
  R(hist && hist.includes('20260530000001'), 'records a retiredBy file whose later file is present');
  R(cb === 1, 'exits 1: pending files remain', `exit ${cb}`);
  const backups = fs.readdirSync(path.join(TMP, 'backups')).filter((d) => d !== 'migrate.log');
  R(backups.length >= 1 && ['schema.sql', 'data.sql'].every((f) => fs.existsSync(path.join(TMP, 'backups', backups[0], f))),
    'schema and data dumps sit in a timestamped folder');
  const dumpCall = bl.calls.find((c) => c[0] === 'pg_dump' && c.includes('--data-only'));
  R(dumpCall && ['public', 'auth', 'storage', 'supabase_migrations'].every((s) => dumpCall.includes(s)) && !dumpCall.join(' ').includes('s3cret'),
    'data dump covers the four schemas, password not on the command line');

  // ------------------------------------------------------------ partial failure
  console.log('\nPush stops at a failing file and says where (AC-6)');
  await db.exec('ALTER ROLE service_role RENAME TO service_role_gone;');
  const pf = makeSys(db);
  const cp = await runner.main([`--env-file=${goodEnv()}`], pf);
  const pfOut = pf.logs.join('\n');
  const hist2 = await historyOf(db);
  R(cp === 1, 'exits non zero', `exit ${cp}`);
  R(hist2.includes('20260908000000') && !hist2.includes('20261001000000'), 'the first file landed and is recorded; the failing one is not');
  R(/FAILED at 20261001000000_admin_migration_status\.sql/.test(pfOut), 'names the failed file');
  R(/Postgres said: .*service_role/.test(pfOut), 'prints the Postgres error');
  R(/supabase\/rollbacks\/20261001000000_admin_migration_status\.rollback\.sql/.test(pfOut), 'prints the rollback path, and does not run it');
  R(/Landed: .*20260908000000/.test(pfOut), 'lists what landed');
  await db.exec('ALTER ROLE service_role_gone RENAME TO service_role;');

  // ------------------------------------------------------------ happy push
  console.log('\nPush applies the rest and proves it (AC-5, AC-6)');
  const hp = makeSys(db);
  const ch = await runner.main([`--env-file=${goodEnv()}`], hp);
  const after = await historyOf(db);
  const fn = (await db.query("SELECT to_regprocedure('public.admin_migration_status(jsonb)') IS NOT NULL AS ok")).rows[0].ok;
  R(fn && after.includes('20261001000000'), '20261001000000 applied and recorded');
  R(/Push will apply/.test(hp.logs.join('\n')) &&
    hp.logs.findIndex((l) => /Push will apply/.test(l)) < hp.logs.findIndex((l) => /State after/.test(l)),
    'the plan is printed before the apply');
  const nonManual = probes.listMigrationFiles().filter((f) => !manualFiles.includes(f));
  R(nonManual.every((f) => after.includes(probes.versionOf(f))), 'every non manual file is now recorded');
  R(ch === (manualFiles.length ? 1 : 0), manualFiles.length
    ? `exit 1 only because ${manualFiles.length} manual row(s) never count as applied`
    : 'exit 0: every row applied', `exit ${ch}`);

  const again = makeSys(db);
  const cAgain = await runner.main(['--status', `--env-file=${goodEnv()}`], again);
  const gaps = again.logs.join('\n').match(/(\d+) applied, (\d+) pending, (\d+) drift, (\d+) broken/);
  R(gaps && gaps[2] === '0' && gaps[3] === '0' && gaps[4] === '0', '--status afterwards: no pending, drift or broken rows', gaps && gaps[0]);
  R(cAgain === (manualFiles.length ? 1 : 0), '--status exit matches');

  await db.close();

  // ------------------------------------------------------------ CLI lands some, then 403
  // Review finding (2026-10-01): the pg fallback replayed the plan made before
  // the push, so a file the CLI had already applied and recorded ran again.
  console.log('\nThe fallback never repeats a file the CLI already landed (AC-6)');
  {
    const db3 = await productionLike();
    await runner.main(['--baseline', `--env-file=${goodEnv()}`], makeSys(db3));
    const ps = makeSys(db3, { cliPush: 'partial403' });
    const c = await runner.main([`--env-file=${goodEnv()}`], ps);
    const hist = await historyOf(db3);
    R(ps.applied[LAST_TWO[0]] === 1, `${LAST_TWO[0]} ran once (by the CLI), not again in the fallback`,
      `ran ${ps.applied[LAST_TWO[0]] || 0} time(s)`);
    R(ps.applied[LAST_TWO[1]] === 1 && hist.includes(probes.versionOf(LAST_TWO[1])),
      `${LAST_TWO[1]} was applied by the fallback and recorded`);
    R(LAST_TWO.every((f) => hist.filter((v) => v === probes.versionOf(f)).length === 1), 'each version is recorded exactly once');
    R(c === 1 || c === 0, 'exit reflects the final state, not the CLI failure', `exit ${c}`);
    await db3.close();
  }

  console.log('\nA real SQL error is reported, not mistaken for the 403 (AC-6)');
  {
    const db4 = await productionLike();
    await runner.main(['--baseline', `--env-file=${goodEnv()}`], makeSys(db4));
    const se = makeSys(db4, { cliPush: 'sqlerror' });
    const c = await runner.main([`--env-file=${goodEnv()}`], se);
    const out = se.logs.join('\n');
    R(!/applying through the runner's own connection/.test(out) && Object.keys(se.applied).length === 0,
      'no fallback when the output merely mentions "forbidden"');
    R(c === 1 && new RegExp(`FAILED at ${LAST_TWO[0]}`).test(out) && /SQLSTATE 42703/.test(out),
      'exits 1 naming the failed file and the Postgres error', `exit ${c}`);
    await db4.close();
  }

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('\nHARNESS ERROR:', e); process.exit(2); });
