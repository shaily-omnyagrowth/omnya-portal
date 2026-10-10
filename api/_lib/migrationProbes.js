// api/_lib/migrationProbes.js
//
// The one evaluator for "is this migration on the database?" (spec 0001).
// Both readers use it, so they can never disagree:
//
//   scripts/db-migrate.cjs        runs the probe query itself over `pg`
//   api/admin/config-status.js    sends the payload to admin_migration_status()
//
// A row's state comes from two witnesses (spec 0001, state model):
//
//   recorded in schema_migrations | probe   | state
//   ------------------------------+---------+--------
//   yes                           | present | applied
//   yes                           | missing | broken
//   no                            | missing | pending
//   no                            | present | drift
//
// History alone is not proof (files were pasted by hand for months, so the
// history table was empty while most of the schema was live), and the catalog
// alone cannot tell a hand paste from a recorded apply. Together they can.

const fs = require('fs');
const path = require('path');

// A static require, so Vercel's file tracer bundles the manifest with every
// function that imports this module. vercel.json also lists it under
// includeFiles for config-status as a safety net.
const manifest = require('../../supabase/migrations/probes.json');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const STATUS_MIGRATION = '20261001000000_admin_migration_status.sql';

// Only forward migrations live in supabase/migrations/ (spec 0001 invariant).
const MIGRATION_FILE_RE = /^\d{14}_[a-z0-9_]+\.sql$/;

const KINDS = {
  table: ['table'],
  columns: ['table', 'columns'],
  function: ['signature'],
  function_body: ['signature', 'marker'],
  policy: ['table', 'policy'],
  trigger: ['table', 'trigger'],
  index: ['index'],
  constraint: ['table', 'constraint'],
  manual: ['why'],
};

// What the CLI stores in schema_migrations: version is the 14 digit prefix,
// name is the rest of the file name without the extension.
const versionOf = (file) => file.slice(0, 14);
const nameOf = (file) => file.slice(15).replace(/\.sql$/, '');

// "campaigns" and "public.campaigns" mean the same table. The catalog query
// splits on the dot, so every table name leaves here schema qualified.
const qualify = (name) => (name && !name.includes('.') ? `public.${name}` : name);

function listMigrationFiles(dir = MIGRATIONS_DIR) {
  return fs.readdirSync(dir).filter((f) => MIGRATION_FILE_RE.test(f)).sort();
}

// AC-2: every migration file has exactly one entry, every entry names a file
// that exists, and every entry is well formed. Returns a list of problems;
// empty means the manifest and the folder agree.
function validateManifest(m, files) {
  const problems = [];
  const keys = Object.keys(m);
  const fileSet = new Set(files);

  for (const f of files) {
    if (!Object.prototype.hasOwnProperty.call(m, f)) {
      problems.push(`${f} has no entry in probes.json`);
    }
  }
  for (const k of keys) {
    if (!fileSet.has(k)) {
      problems.push(`probes.json names ${k}, which is not a migration file in supabase/migrations/`);
      continue;
    }
    const e = m[k];
    if (!e || typeof e !== 'object' || Array.isArray(e)) {
      problems.push(`${k}: entry must be an object`);
      continue;
    }
    const needs = KINDS[e.kind];
    if (!needs) {
      problems.push(`${k}: unknown kind "${e.kind}" (allowed: ${Object.keys(KINDS).join(', ')})`);
      continue;
    }
    for (const field of needs) {
      const v = e[field];
      const ok = field === 'columns'
        ? Array.isArray(v) && v.length > 0 && v.every((c) => typeof c === 'string' && c)
        : typeof v === 'string' && v.trim() !== '';
      if (!ok) problems.push(`${k}: kind "${e.kind}" needs a non empty "${field}"`);
    }
    if (e.kind === 'function' || e.kind === 'function_body') {
      if (typeof e.signature === 'string' && !/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*\(.*\)$/i.test(e.signature)) {
        problems.push(`${k}: signature must look like schema.fn(argtypes)`);
      }
    }
    if (e.retiredBy !== undefined) {
      if (!fileSet.has(e.retiredBy)) {
        problems.push(`${k}: retiredBy names ${e.retiredBy}, which is not a migration file`);
      } else if (e.retiredBy <= k) {
        problems.push(`${k}: retiredBy must name a LATER file`);
      }
    }
  }
  return problems;
}

// The probes that go to the catalog. `manual` entries cannot be checked by
// machine, and a `retiredBy` entry's object is meant to be gone, so neither
// is sent (spec 0001, data model sketch).
function probePayload(m = manifest) {
  return Object.keys(m).sort()
    .filter((file) => m[file].kind !== 'manual' && !m[file].retiredBy)
    .map((file) => {
      const e = m[file];
      const p = { file, kind: e.kind };
      if (e.table) p.table = qualify(e.table);
      if (e.index) p.index = qualify(e.index);
      if (e.columns) p.columns = e.columns;
      if (e.signature) p.signature = e.signature;
      if (e.marker) p.marker = e.marker;
      if (e.policy) p.policy = e.policy;
      if (e.trigger) p.trigger = e.trigger;
      if (e.constraint) p.constraint = e.constraint;
      return p;
    });
}

// The runner's probe query, lifted out of the status migration itself so the
// SQL exists exactly once. The runner cannot call the RPC: on a database that
// predates 20261001000000 the function does not exist yet.
let _probeSql = null;
function probeSelectSql() {
  if (_probeSql) return _probeSql;
  const src = fs.readFileSync(path.join(MIGRATIONS_DIR, STATUS_MIGRATION), 'utf8');
  const m = src.match(/-- PROBE_SELECT[^\n]*\n([\s\S]*?)-- end PROBE_SELECT/);
  if (!m) throw new Error(`could not find the PROBE_SELECT block in ${STATUS_MIGRATION}`);
  const body = m[1].replace('jsonb_array_elements(probes)', 'jsonb_array_elements($1::jsonb)');
  if (!body.includes('$1::jsonb')) throw new Error('PROBE_SELECT no longer reads jsonb_array_elements(probes)');
  _probeSql = body.trim();
  return _probeSql;
}

function describeProbe(e) {
  switch (e.kind) {
    case 'table': return `table ${qualify(e.table)}`;
    case 'columns': return `${qualify(e.table)} (${e.columns.join(', ')})`;
    case 'function': return `function ${e.signature}`;
    case 'function_body': return `body of ${e.signature} contains its fix`;
    case 'policy': return `policy ${e.policy} on ${qualify(e.table)}`;
    case 'trigger': return `trigger ${e.trigger} on ${qualify(e.table)}`;
    case 'index': return `index ${qualify(e.index)}`;
    case 'constraint': return `constraint ${e.constraint} on ${qualify(e.table)}`;
    case 'manual': return e.why;
    default: return '';
  }
}

// Combine history and probe results into one row per file.
//
//   files     file names (the folder for the runner, manifest keys for the API)
//   history   array of versions, or of { version }, read from schema_migrations
//   present   { [file]: boolean } from the probe query or the RPC
//
// Rules beyond the four state table (spec 0001, state model):
//   * retiredBy: applied when recorded, pending when not, whatever its own
//     probe says. Except when its retiredBy file probes present: that file
//     could only have run after this one, so it is drift and baseline may
//     record it.
//   * manual: always state "manual", which never counts as applied.
function computeRows({ files, manifest: m = manifest, history = [], present = {} }) {
  const recorded = new Set(history.map((h) => String(h && typeof h === 'object' ? h.version : h)));

  return files.map((file) => {
    const e = m[file] || null;
    const isRecorded = recorded.has(versionOf(file));
    const base = {
      file,
      version: versionOf(file),
      label: (e && e.label) || file,
      recorded: isRecorded,
      checks: e ? describeProbe(e) : 'no entry in probes.json',
    };

    if (!e) return { ...base, probe: 'missing', state: isRecorded ? 'broken' : 'pending' };

    if (e.kind === 'manual') return { ...base, probe: 'manual', state: 'manual', why: e.why };

    if (e.retiredBy) {
      let state = isRecorded ? 'applied' : 'pending';
      if (!isRecorded && present[e.retiredBy] === true) state = 'drift';
      return { ...base, probe: 'retired', state, retiredBy: e.retiredBy };
    }

    const isPresent = present[file] === true;
    let state;
    if (isRecorded) state = isPresent ? 'applied' : 'broken';
    else state = isPresent ? 'drift' : 'pending';
    return { ...base, probe: isPresent ? 'present' : 'missing', state };
  });
}

function summarize(rows) {
  const count = (s) => rows.filter((r) => r.state === s).length;
  const out = {
    total: rows.length,
    applied: count('applied'),
    broken: count('broken'),
    pending: count('pending'),
    drift: count('drift'),
    manual: count('manual'),
  };
  out.allApplied = out.applied === out.total;
  return out;
}

module.exports = {
  manifest,
  MIGRATIONS_DIR,
  STATUS_MIGRATION,
  MIGRATION_FILE_RE,
  versionOf,
  nameOf,
  qualify,
  listMigrationFiles,
  validateManifest,
  probePayload,
  probeSelectSql,
  describeProbe,
  computeRows,
  summarize,
};
