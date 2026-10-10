// tests/migration-guards.test.cjs
//
// Offline guards on supabase/migrations/ (spec 0001). No database, no network.
//
//   AC-1   only forward migration files live directly in supabase/migrations/
//          (no rollbacks, no superseded files, no verify scripts)
//   AC-2   probes.json has exactly one well formed entry per migration file
//   AC-14  migrations dated 20261001000000 or later are expand only: no
//          DROP TABLE / DROP COLUMN / RENAME TO / RENAME COLUMN unless the file
//          carries a `-- contract:` line naming the release that stopped
//          reading the object. Previews and production share one database, so
//          a drop breaks the deployed code before the PR that stops reading it
//          has merged.
//
//   node tests/migration-guards.test.cjs

const fs = require('fs');
const path = require('path');

const probes = require('../api/_lib/migrationProbes');

const MIG = probes.MIGRATIONS_DIR;
const SUPA = path.join(MIG, '..');

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};

// --- AC-1 ---------------------------------------------------------------------
console.log('\nAC-1: supabase/migrations/ holds forward migrations only');

const sqlFiles = fs.readdirSync(MIG).filter((f) => f.toLowerCase().endsWith('.sql'));
const strays = sqlFiles.filter((f) => !probes.MIGRATION_FILE_RE.test(f));
R(strays.length === 0, 'every .sql file is named NNNNNNNNNNNNNN_name.sql', strays.join(', '));

const SUPERSEDED = '20260821000001_client_creator_visibility.sql';
R(!fs.existsSync(path.join(MIG, SUPERSEDED)), `${SUPERSEDED} is out of migrations/`,
  'move it to supabase/superseded/ (20260822000005 supersedes it)');
R(fs.existsSync(path.join(SUPA, 'superseded', SUPERSEDED)), 'it lives in supabase/superseded/');
const supersededReadme = path.join(SUPA, 'superseded', 'README.md');
R(fs.existsSync(supersededReadme) && /20260822000005/.test(fs.readFileSync(supersededReadme, 'utf8')),
  'supabase/superseded/README.md points to 20260822000005');
R(fs.existsSync(path.join(SUPA, 'verify', 'VERIFY_20260821.sql')), 'VERIFY_20260821.sql lives in supabase/verify/');

// --- AC-2 ---------------------------------------------------------------------
console.log('\nAC-2: probes.json covers every migration file, exactly once');

const files = probes.listMigrationFiles();
const problems = probes.validateManifest(probes.manifest, files);
R(problems.length === 0, `manifest agrees with the folder (${files.length} files)`);
for (const p of problems) console.log('           · ' + p);

// The validator itself must catch each kind of drift, or a green line above
// proves nothing.
const F1 = '20990101000000_one.sql', F2 = '20990101000001_two.sql';
const has = (m, fs_, re) => probes.validateManifest(m, fs_).some((p) => re.test(p));
R(has({}, [F1], /has no entry/), 'catches a file with no entry');
R(has({ [F1]: { kind: 'table', table: 'x' }, [F2]: { kind: 'table', table: 'y' } }, [F1], /not a migration file/),
  'catches an entry for a file that does not exist');
R(has({ [F1]: { kind: 'manual' } }, [F1], /needs a non empty "why"/), 'catches a manual entry with no why');
R(has({ [F1]: { kind: 'sideways' } }, [F1], /unknown kind/), 'catches an unknown kind');
R(has({ [F1]: { kind: 'columns', table: 't', columns: [] } }, [F1], /needs a non empty "columns"/),
  'catches an empty columns list');
R(has({ [F2]: { kind: 'table', table: 't', retiredBy: F1 }, [F1]: { kind: 'table', table: 'u' } }, [F1, F2], /LATER file/),
  'catches a retiredBy that points backwards');

// JSON.parse keeps the last of two duplicate keys silently, so "exactly one
// entry" needs a look at the raw text.
const raw = fs.readFileSync(path.join(MIG, 'probes.json'), 'utf8');
const keyCounts = {};
for (const m of raw.matchAll(/"(\d{14}_[a-z0-9_]+\.sql)"\s*:/g)) keyCounts[m[1]] = (keyCounts[m[1]] || 0) + 1;
const dupes = Object.keys(keyCounts).filter((k) => keyCounts[k] > 1);
R(dupes.length === 0, 'no file has two entries', dupes.join(', '));

// --- AC-14 --------------------------------------------------------------------
console.log('\nAC-14: new migrations are expand only');

const CONTRACT_FROM = '20261001000000';
const DESTRUCTIVE = [/DROP\s+TABLE/i, /DROP\s+COLUMN/i, /RENAME\s+TO/i, /RENAME\s+COLUMN/i];

function expandOnlyViolations(sql) {
  if (/^\s*--\s*contract:\s*\S/m.test(sql)) return [];
  // Comments may describe a drop without doing one.
  const code = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  return DESTRUCTIVE.filter((re) => re.test(code)).map((re) => re.source.replace('\\s+', ' '));
}

const guarded = files.filter((f) => f.slice(0, 14) >= CONTRACT_FROM);
const offenders = guarded
  .map((f) => [f, expandOnlyViolations(fs.readFileSync(path.join(MIG, f), 'utf8'))])
  .filter(([, v]) => v.length);
R(offenders.length === 0, `${guarded.length} migration(s) from ${CONTRACT_FROM} on are expand only`,
  offenders.map(([f, v]) => `${f}: ${v.join(', ')}`).join('; '));

// The rule must bite, and must stay out of the way where the spec says so.
R(expandOnlyViolations('ALTER TABLE t DROP COLUMN x;').length === 1, 'flags DROP COLUMN');
R(expandOnlyViolations('drop  table t;').length === 1, 'flags drop table (any case, any spacing)');
R(expandOnlyViolations('ALTER TABLE t RENAME COLUMN a TO b;').length >= 1, 'flags RENAME COLUMN');
R(expandOnlyViolations('ALTER TABLE t RENAME TO u;').length === 1, 'flags RENAME TO');
R(expandOnlyViolations('-- contract: release 2026-11 stopped reading t.x\nALTER TABLE t DROP COLUMN x;').length === 0,
  'a -- contract: line allows it');
R(expandOnlyViolations('DROP POLICY p ON t; DROP FUNCTION f(); DROP TRIGGER g ON t; DROP VIEW v; DROP INDEX i;').length === 0,
  'policy, function, trigger, view and index drops are not matched');
R(expandOnlyViolations('-- we never DROP TABLE here\nSELECT 1;').length === 0, 'a drop mentioned in a comment is not matched');

// --- AC-15 --------------------------------------------------------------------
console.log('\nAC-15: the runner is the documented apply path');

const readme = fs.readFileSync(path.join(MIG, 'README.md'), 'utf8');
R(/only way to apply to production: `npm run db:migrate`/.test(readme), 'supabase/migrations/README.md names npm run db:migrate as the only apply path');
const applyDocs = fs.readdirSync(MIG).filter((f) => /^APPLY_.*\.md$/.test(f));
const unmarked = applyDocs.filter((f) => !fs.readFileSync(path.join(MIG, f), 'utf8').startsWith('> **Historical.**'));
R(unmarked.length === 0, `every APPLY_*.md (${applyDocs.length}) opens with a Historical marker`, unmarked.join(', '));
const gitignore = fs.readFileSync(path.join(SUPA, '..', '.gitignore'), 'utf8');
R(/^\.env\.migrate$/m.test(gitignore), '.env.migrate is gitignored');
R(fs.existsSync(path.join(SUPA, '..', '.env.migrate.example')), '.env.migrate.example exists');

console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
