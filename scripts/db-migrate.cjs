#!/usr/bin/env node
// scripts/db-migrate.cjs  (npm run db:migrate)
//
// The only production apply path for supabase/migrations/ (spec 0001).
//
//   npm run db:migrate -- --status     read only: what is recorded, what is present
//   npm run db:migrate -- --baseline   record the files that are present but unrecorded
//   npm run db:migrate                 apply the pending files
//
// Exit codes, every mode (AC-3):
//   0  every row is applied
//   1  gaps remain (pending, drift, broken, manual), or an apply failed
//   2  refused: a prerequisite, the target, or the confirmation failed
//
// Why a wrapper and not `supabase db push` on its own: production's history
// table was empty while most of the schema was live (files were pasted by
// hand), so a bare push would re-run everything. The runner proves each file
// with a catalog probe (supabase/migrations/probes.json) before and after it
// touches anything, records only what it has proven, and never runs a rollback.
//
// Order of a write run (baseline or push):
//   prerequisites -> probe -> plan (dry run list) -> typed confirmation ->
//   backup (schema + data dump, outside the repo and OneDrive) -> apply ->
//   probe again.
// The confirmation comes before the dump so a wrong ref costs nothing, and
// the dump still lands before anything is applied (AC-5).
//
// Configuration lives in .env.migrate at the repo root (gitignored), never in
// Vercel or GitHub: SUPABASE_DB_URL (session pooler, port 5432, with the DB
// password), SUPABASE_PROJECT_REF, optional MIGRATE_BACKUP_DIR.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const probes = require('../api/_lib/migrationProbes');

const REPO_ROOT = path.join(__dirname, '..');
const CLI_JS = path.join(REPO_ROOT, 'node_modules', 'supabase', 'dist', 'supabase.js');
const MIN_CLI = [2, 20, 0];
const DUMP_SCHEMAS = ['public', 'auth', 'storage', 'supabase_migrations'];
const ROLLBACKS_DIR = path.join(REPO_ROOT, 'supabase', 'rollbacks');

const EXIT = { OK: 0, GAPS: 1, REFUSED: 2 };

class Refusal extends Error {}

// ---------------------------------------------------------------- parsing

function parseArgs(argv) {
  const known = new Set(['--status', '--baseline']);
  const unknown = argv.filter((a) => !known.has(a) && !a.startsWith('--env-file='));
  if (unknown.length) throw new Refusal(`unknown argument(s): ${unknown.join(' ')}. Use --status, --baseline, or nothing (push).`);
  if (argv.includes('--status') && argv.includes('--baseline')) throw new Refusal('pick one of --status and --baseline');
  const envArg = argv.find((a) => a.startsWith('--env-file='));
  return {
    mode: argv.includes('--status') ? 'status' : argv.includes('--baseline') ? 'baseline' : 'push',
    envFile: envArg ? path.resolve(envArg.slice('--env-file='.length)) : path.join(REPO_ROOT, '.env.migrate'),
  };
}

function parseEnvFile(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

// Two accepted shapes (AC-5):
//   session pooler  postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres
//   direct          postgres:<pw>@db.<ref>.supabase.co:5432/postgres
// Port 6543 is the transaction pooler, which breaks multi statement
// transactions and prepared statements; it is refused.
function parseDbUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Refusal('SUPABASE_DB_URL is not a valid URL'); }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Refusal('SUPABASE_DB_URL must start with postgresql://');
  const port = u.port ? Number(u.port) : 5432;
  if (port === 6543) {
    throw new Refusal('SUPABASE_DB_URL uses port 6543 (the transaction pooler). Use the session pooler on port 5432.');
  }
  const host = u.hostname.toLowerCase();
  const user = decodeURIComponent(u.username);
  let ref = null, form = null;
  const direct = host.match(/^db\.([a-z0-9]+)\.supabase\.co$/);
  if (direct) { ref = direct[1]; form = 'direct'; }
  else if (/\.pooler\.supabase\.com$/.test(host)) {
    const m = user.match(/^postgres\.([a-z0-9]+)$/);
    if (!m) throw new Refusal('a pooler SUPABASE_DB_URL must use the user postgres.<project ref>');
    ref = m[1]; form = 'pooler';
  } else {
    throw new Refusal(`SUPABASE_DB_URL host ${host} is neither db.<ref>.supabase.co nor *.pooler.supabase.com`);
  }
  return { ref, form, host, port, user, password: decodeURIComponent(u.password), database: u.pathname.slice(1) || 'postgres' };
}

// The dump holds PII and the payout ledger: never inside the repo (it could be
// committed) and never inside OneDrive (it would be synced off the machine).
function resolveBackupRoot(dir, { env = process.env, homedir = os.homedir(), repoRoot = REPO_ROOT } = {}) {
  const raw = dir && dir.trim() ? dir.trim() : path.join(homedir, 'omnya-backups');
  const expanded = raw.startsWith('~') ? path.join(homedir, raw.slice(1)) : raw;
  const abs = path.resolve(expanded);
  const norm = (p) => path.resolve(p).toLowerCase().replace(/[\\/]+$/, '') + path.sep;
  const inside = (parent) => parent && (norm(abs) + '').startsWith(norm(parent));
  if (inside(repoRoot)) throw new Refusal(`the backup folder ${abs} is inside the repo. Set MIGRATE_BACKUP_DIR outside it.`);
  for (const key of ['OneDrive', 'OneDriveCommercial', 'OneDriveConsumer']) {
    if (inside(env[key])) throw new Refusal(`the backup folder ${abs} is inside ${key} (${env[key]}). Set MIGRATE_BACKUP_DIR outside it.`);
  }
  return abs;
}

function versionAtLeast(found, min) {
  for (let i = 0; i < min.length; i++) {
    if ((found[i] || 0) > min[i]) return true;
    if ((found[i] || 0) < min[i]) return false;
  }
  return true;
}

function formatTable(rows) {
  const cols = [
    ['file', (r) => r.file],
    ['recorded', (r) => (r.recorded ? 'yes' : 'no')],
    ['probe', (r) => r.probe],
    ['state', (r) => r.state],
  ];
  const width = cols.map(([h, f]) => Math.max(h.length, ...rows.map((r) => String(f(r)).length)));
  const line = (vals) => vals.map((v, i) => String(v).padEnd(width[i])).join('  ');
  return [line(cols.map(([h]) => h)), line(width.map((w) => '-'.repeat(w))), ...rows.map((r) => line(cols.map(([, f]) => f(r))))].join('\n');
}

// ------------------------------------------------------------------ system

function defaultSys() {
  return {
    log: (s = '') => console.log(s),
    err: (s = '') => console.error(s),
    env: process.env,
    homedir: os.homedir(),
    user: (() => { try { return os.userInfo().username; } catch { return 'unknown'; } })(),
    now: () => new Date(),
    exec(cmd, args, opts = {}) {
      const r = spawnSync(cmd, args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
      return { status: r.error ? -1 : r.status, stdout: r.stdout || '', stderr: (r.stderr || '') + (r.error ? String(r.error.message) : '') };
    },
    async connect(url) {
      const { Client } = require('pg');
      // Supabase's certificate chain is not in Node's CA store. The target is
      // pinned by host and project ref above, not by the certificate.
      const u = new URL(url);
      u.searchParams.delete('sslmode');
      const client = new Client({ connectionString: u.toString(), ssl: { rejectUnauthorized: false } });
      await client.connect();
      return client;
    },
    ask(question) {
      if (!process.stdin.isTTY) {
        return Promise.reject(new Refusal('the typed confirmation needs an interactive terminal'));
      }
      const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
      return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a); }));
    },
  };
}

const cli = (sys, args, opts) => sys.exec(process.execPath, [CLI_JS, ...args], opts);
const outputOf = (r) => `${r.stdout}\n${r.stderr}`.trim();

// The Management API 403 that made `db push` unusable before (scope feature 1).
// Only the HTTP status wording counts. A bare "forbidden" also appears in
// echoed SQL and Postgres errors, and mistaking a real SQL failure for the 403
// would send the runner down its own apply path (review 2026-10-01). A 403
// worded some other way is reported as a failure, which is the safe side.
const looksForbidden = (text) => /\bstatus(?: code)?:? 403\b|\b403 Forbidden\b/i.test(text);

// ------------------------------------------------------------------- steps

async function prerequisites(sys, args) {
  const v = cli(sys, ['--version']);
  const m = v.status === 0 && outputOf(v).match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) throw new Refusal('the Supabase CLI did not run. Run npm install (it is a devDependency).');
  if (!versionAtLeast(m.slice(1, 4).map(Number), MIN_CLI)) {
    throw new Refusal(`Supabase CLI ${m[0]} is older than ${MIN_CLI.join('.')}. Run npm install.`);
  }

  if (!fs.existsSync(args.envFile)) {
    throw new Refusal(`${path.relative(REPO_ROOT, args.envFile) || args.envFile} not found. Copy .env.migrate.example to .env.migrate and fill it in.`);
  }
  const cfg = parseEnvFile(fs.readFileSync(args.envFile, 'utf8'));
  for (const k of ['SUPABASE_DB_URL', 'SUPABASE_PROJECT_REF']) {
    if (!cfg[k]) throw new Refusal(`${k} is missing from .env.migrate`);
  }
  const target = parseDbUrl(cfg.SUPABASE_DB_URL);
  if (target.ref !== cfg.SUPABASE_PROJECT_REF) {
    throw new Refusal(`SUPABASE_DB_URL points at project ${target.ref}, but SUPABASE_PROJECT_REF is ${cfg.SUPABASE_PROJECT_REF}.`);
  }
  const backupRoot = resolveBackupRoot(cfg.MIGRATE_BACKUP_DIR, { env: sys.env, homedir: sys.homedir });
  return { cfg, target, url: cfg.SUPABASE_DB_URL, backupRoot };
}

// pg_dump on PATH whose major is >= the server's (no Docker needed); else
// `supabase db dump`, which runs pg_dump inside Docker; else stop.
function pickDumpTool(sys, serverMajor) {
  const pd = sys.exec('pg_dump', ['--version']);
  const m = pd.status === 0 && outputOf(pd).match(/(\d+)(?:\.\d+)?/);
  if (m && Number(m[1]) >= serverMajor) return { kind: 'pg_dump', version: m[0] };
  const docker = sys.exec('docker', ['info']);
  if (docker.status === 0) return { kind: 'supabase', version: 'docker' };
  throw new Refusal(
    (m ? `pg_dump ${m[0]} is older than the server (${serverMajor}). ` : 'pg_dump is not on PATH. ') +
    `Install the PostgreSQL ${serverMajor} client tools, or start Docker so supabase db dump can run.`
  );
}

async function readState(client) {
  const files = probes.listMigrationFiles();
  const hasHistory = (await client.query(
    "SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS ok")).rows[0].ok;
  const history = hasHistory
    ? (await client.query('SELECT version FROM supabase_migrations.schema_migrations')).rows.map((r) => String(r.version))
    : [];
  const result = (await client.query(probes.probeSelectSql(), [JSON.stringify(probes.probePayload())])).rows;
  const present = Object.fromEntries(result.map((r) => [r.file, r.present === true]));
  const rows = probes.computeRows({ files, history, present });
  return { files, rows, summary: probes.summarize(rows), hasHistory };
}

function printState(sys, title, state) {
  sys.log(`\n${title}\n`);
  sys.log(formatTable(state.rows));
  const s = state.summary;
  sys.log(`\n${s.total} files: ${s.applied} applied, ${s.pending} pending, ${s.drift} drift, ${s.broken} broken, ${s.manual} manual`);
  for (const r of state.rows.filter((x) => x.state === 'manual')) sys.log(`  manual  ${r.file}: ${r.why}`);
  for (const r of state.rows.filter((x) => x.state === 'broken')) sys.log(`  BROKEN  ${r.file}: recorded, but ${r.checks} is missing`);
}

function backup(sys, ctx, dumpTool, stamp) {
  const dir = path.join(ctx.backupRoot, stamp);
  fs.mkdirSync(dir, { recursive: true });
  const schemaFile = path.join(dir, 'schema.sql');
  const dataFile = path.join(dir, 'data.sql');

  const runDump = (dataOnly, file) => {
    if (dumpTool.kind === 'pg_dump') {
      const t = ctx.target;
      // The password travels in the environment, not on the command line.
      const env = { ...sys.env, PGHOST: t.host, PGPORT: String(t.port), PGUSER: t.user,
        PGPASSWORD: t.password, PGDATABASE: t.database, PGSSLMODE: 'require' };
      const args = [dataOnly ? '--data-only' : '--schema-only',
        ...DUMP_SCHEMAS.flatMap((s) => ['--schema', s]), '--file', file];
      return sys.exec('pg_dump', args, { env });
    }
    const args = ['db', 'dump', '--db-url', ctx.url, '--schema', DUMP_SCHEMAS.join(','), '--file', file];
    if (dataOnly) args.push('--data-only');
    return cli(sys, args);
  };

  for (const [label, dataOnly, file] of [['schema', false, schemaFile], ['data', true, dataFile]]) {
    sys.log(`  dumping ${label} -> ${file}`);
    const r = runDump(dataOnly, file);
    if (r.status !== 0) throw new Refusal(`the ${label} dump failed (exit ${r.status}): ${outputOf(r).slice(-400)}`);
    const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
    if (size === 0) throw new Refusal(`the ${label} dump wrote an empty file: ${file}`);
  }
  return dir;
}

const HISTORY_DDL = `
  CREATE SCHEMA IF NOT EXISTS supabase_migrations;
  CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
    version text NOT NULL PRIMARY KEY, statements text[], name text);`;

async function recordVersions(client, files) {
  await client.query(HISTORY_DDL);
  for (const f of files) {
    await client.query(
      'INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING',
      [probes.versionOf(f), probes.nameOf(f)]);
  }
}

// Fallback when the CLI still hits the Management API 403 (spec 0001): apply
// each file ourselves, one transaction per file (each file carries its own
// BEGIN/COMMIT), in filename order, recording each only after it committed.
async function applyWithPg(sys, client, files) {
  const landed = [];
  for (const f of files) {
    sys.log(`  applying ${f}`);
    try {
      await client.query(fs.readFileSync(path.join(probes.MIGRATIONS_DIR, f), 'utf8'));
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* not in a transaction */ }
      return { landed, failed: { file: f, error: `${e.message}${e.code ? ` (SQLSTATE ${e.code})` : ''}` } };
    }
    await recordVersions(client, [f]);
    landed.push(f);
  }
  return { landed, failed: null };
}

function rollbackPathFor(file) {
  const p = path.join(ROLLBACKS_DIR, file.replace(/\.sql$/, '.rollback.sql'));
  return fs.existsSync(p) ? path.relative(REPO_ROOT, p).replace(/\\/g, '/') : null;
}

// Which file the CLI was on when it stopped, and the Postgres error it printed.
function parseCliFailure(text) {
  const applying = [...text.matchAll(/Applying migration (\d{14}_[a-z0-9_]+\.sql)/g)].map((m) => m[1]);
  const error = (text.match(/^.*(ERROR|error):.*$/m) || [null])[0];
  return { file: applying.length ? applying[applying.length - 1] : null, error: error ? error.trim() : text.slice(-400) };
}

// -------------------------------------------------------------------- main

async function main(argv, sys = defaultSys()) {
  let args = null, ctx = null, client = null, code = EXIT.REFUSED;
  const applied = [];
  const stamp = sys.now().toISOString().replace(/[:.]/g, '-');

  try {
    args = parseArgs(argv);
    sys.log(`db:migrate ${args.mode}`);

    ctx = await prerequisites(sys, args);
    sys.log(`target: project ${ctx.target.ref} (${ctx.target.form}, ${ctx.target.host}:${ctx.target.port})`);
    client = await sys.connect(ctx.url);
    const serverNum = Number((await client.query('SHOW server_version_num')).rows[0].server_version_num);
    // Only write runs back up, so --status (read only) needs no dump tool.
    const dumpTool = args.mode === 'status' ? null : pickDumpTool(sys, Math.floor(serverNum / 10000));
    if (dumpTool) sys.log(`dump tool: ${dumpTool.kind} ${dumpTool.version}`);

    const before = await readState(client);
    printState(sys, 'Current state', before);
    if (!before.hasHistory) sys.log('  (supabase_migrations.schema_migrations does not exist yet: nothing is recorded)');

    if (args.mode === 'status') {
      code = before.summary.allApplied ? EXIT.OK : EXIT.GAPS;
      return code;
    }

    const manifestProblems = probes.validateManifest(probes.manifest, before.files);
    if (manifestProblems.length) {
      throw new Refusal(`probes.json and supabase/migrations/ disagree, so a file could be applied unproven:\n  ${manifestProblems.join('\n  ')}`);
    }
    const broken = before.rows.filter((r) => r.state === 'broken');
    if (broken.length) {
      throw new Refusal(`${broken.length} file(s) are recorded but their object is missing (broken). A person resolves these; nothing automatic moves a row out of broken:\n  ${broken.map((r) => r.file).join('\n  ')}`);
    }

    // ---- plan
    let targets;
    if (args.mode === 'baseline') {
      targets = before.rows.filter((r) => r.state === 'drift').map((r) => r.file);
      if (!targets.length) {
        sys.log('\nNothing to record: no file is present but unrecorded.');
        code = before.summary.allApplied ? EXIT.OK : EXIT.GAPS;
        return code;
      }
      sys.log(`\nBaseline will record ${targets.length} file(s) as applied (history only, no SQL runs):`);
      targets.forEach((f) => sys.log(`  ${f}`));
    } else {
      const drift = before.rows.filter((r) => r.state === 'drift');
      if (drift.length) {
        // `db push --include-all` would run these again. Some are not safe to
        // repeat (20260530000001 would bring back the unguarded payout RPCs).
        throw new Refusal(`${drift.length} file(s) are present but unrecorded (drift). Run npm run db:migrate -- --baseline first, so push does not run them again.`);
      }
      targets = before.rows.filter((r) => !r.recorded).map((r) => r.file);
      if (!targets.length) {
        sys.log('\nNothing to apply: every file is recorded.');
        code = before.summary.allApplied ? EXIT.OK : EXIT.GAPS;
        return code;
      }
      const reruns = before.rows.filter((r) => !r.recorded && r.state === 'manual').map((r) => r.file);
      sys.log(`\nPush will apply ${targets.length} file(s), in this order:`);
      targets.forEach((f) => sys.log(`  ${f}${reruns.includes(f) ? '   (manual probe: may already be live; it runs again)' : ''}`));
      const dry = cli(sys, ['db', 'push', '--db-url', ctx.url, '--include-all', '--dry-run']);
      sys.log('\nsupabase db push --dry-run says:');
      sys.log(outputOf(dry).split('\n').map((l) => '  ' + l).join('\n'));
      if (dry.status !== 0) {
        sys.log(looksForbidden(outputOf(dry))
          ? '  (the CLI hit the Management API 403; the runner will apply through its own connection instead)'
          : `  (dry run exited ${dry.status}; the list above from the runner is what will be applied)`);
      }
    }

    // ---- confirm
    const answer = await sys.ask(`\nType the project ref (${ctx.target.ref}) to continue: `);
    if (String(answer || '').trim() !== ctx.target.ref) throw new Refusal('the typed project ref did not match. Nothing was changed.');

    // ---- backup
    sys.log('\nBacking up');
    const dir = backup(sys, ctx, dumpTool, stamp);
    sys.log(`  backup saved in ${dir}`);

    // ---- apply
    let failure = null;
    if (args.mode === 'baseline') {
      const versions = targets.map(probes.versionOf);
      const r = cli(sys, ['migration', 'repair', '--db-url', ctx.url, '--status', 'applied', ...versions, '--yes']);
      sys.log(outputOf(r));
      if (r.status !== 0) {
        if (!looksForbidden(outputOf(r))) throw new Error(`supabase migration repair failed (exit ${r.status})`);
        sys.log('  the CLI hit the Management API 403; recording through the runner\'s own connection');
        await recordVersions(client, targets);
      }
      applied.push(...targets);
    } else {
      const r = cli(sys, ['db', 'push', '--db-url', ctx.url, '--include-all', '--yes'], { input: 'y\n' });
      const out = outputOf(r);
      sys.log(out);
      if (r.status !== 0 && looksForbidden(out)) {
        sys.log('  the CLI hit the Management API 403; applying through the runner\'s own connection');
        // The CLI may have applied and recorded some files before it stopped.
        // Read history again and apply only what is still unrecorded; the plan
        // from before the push would run those files a second time (review
        // 2026-10-01), and some files are not safe to repeat.
        const now = await readState(client);
        const stillUnrecorded = new Set(now.rows.filter((x) => !x.recorded).map((x) => x.file));
        const remaining = targets.filter((f) => stillUnrecorded.has(f));
        const skipped = targets.filter((f) => !stillUnrecorded.has(f));
        if (skipped.length) sys.log(`  already applied by the CLI, not run again: ${skipped.join(', ')}`);
        const res = await applyWithPg(sys, client, remaining);
        applied.push(...res.landed);
        failure = res.failed;
      } else if (r.status !== 0) {
        failure = parseCliFailure(out);
      }
    }

    // ---- verify
    const after = await readState(client);
    printState(sys, 'State after this run', after);
    if (args.mode === 'push') {
      const wasPending = new Set(targets);
      applied.push(...after.rows.filter((r) => wasPending.has(r.file) && r.recorded && !applied.includes(r.file)).map((r) => r.file));
    }
    if (applied.length) sys.log(`\nLanded: ${applied.join(', ')}`);

    if (failure) {
      sys.log(`\nFAILED at ${failure.file || '(unknown file)'}`);
      sys.log(`  Postgres said: ${failure.error}`);
      const rb = failure.file && rollbackPathFor(failure.file);
      sys.log(rb ? `  Rollback, if you decide you need it: ${rb} (the runner never runs it)` : '  No rollback file exists for it.');
      code = EXIT.GAPS;
      return code;
    }

    const gaps = after.rows.filter((r) => r.state !== 'applied');
    if (gaps.length) {
      sys.log('\nGaps remain:');
      gaps.forEach((r) => sys.log(`  ${r.state.padEnd(8)} ${r.file}`));
    }
    code = after.summary.allApplied ? EXIT.OK : EXIT.GAPS;
    return code;
  } catch (e) {
    if (e instanceof Refusal) {
      sys.err(`\nREFUSED: ${e.message}`);
      code = EXIT.REFUSED;
    } else {
      sys.err(`\nERROR: ${e && e.stack ? e.stack : e}`);
      code = EXIT.GAPS;
    }
    return code;
  } finally {
    if (client) { try { await client.end(); } catch { /* already closed */ } }
    // The audit trail for a tool that touches the payout ledger (spec 0001,
    // security model): who ran what, against which project, with what result.
    if (ctx && ctx.backupRoot) {
      try {
        fs.mkdirSync(ctx.backupRoot, { recursive: true });
        fs.appendFileSync(path.join(ctx.backupRoot, 'migrate.log'),
          [sys.now().toISOString(), sys.user, args ? args.mode : '?', ctx.target.ref,
            applied.length ? applied.join(',') : '-', `exit=${code}`].join('\t') + '\n');
      } catch (e) {
        sys.err(`could not write migrate.log: ${e.message}`);
      }
    }
  }
}

module.exports = {
  main, parseArgs, parseEnvFile, parseDbUrl, resolveBackupRoot, versionAtLeast,
  formatTable, parseCliFailure, looksForbidden, Refusal, EXIT,
};

if (require.main === module) {
  main(process.argv.slice(2)).then((c) => process.exit(c));
}
