// tests/lib/schema.cjs
//
// Fixes false-alarm class 3, which caught me out three times in one audit.
//
// A test asserts on `am_feedback`, but the column is `feedback`. PostgREST
// returns an error object rather than rows, the test reads `rows[0].final_status`
// as undefined, and reports "the app did not save the revision" — when the app
// saved it perfectly. The same shape of mistake produced false failures for
// `posted_link` (the value was in `concept_link`) and for reading `.ok` off a
// response body that was a JSON string.
//
// The failure mode is silent: a typo in the *test* is indistinguishable from a
// bug in the *app*. So this module refuses to let a test reference a column
// that does not exist. It reads the live schema from PostgREST's OpenAPI
// document and throws a loud, specific error naming the closest real column.
//
// A test that is wrong should fail as a broken test, never as a false bug report.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const env = loadEnv();
const URL_BASE = env.SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

let _tables = null;

async function loadSchema() {
  if (_tables) return _tables;
  const r = await fetch(`${URL_BASE}/rest/v1/?apikey=${SERVICE_KEY}`);
  if (!r.ok) throw new Error(`Could not read the schema: ${r.status}`);
  const spec = await r.json();
  _tables = {};
  for (const [name, def] of Object.entries(spec.definitions || {})) {
    _tables[name] = Object.keys(def.properties || {});
  }
  return _tables;
}

// Cheap edit distance, only used to make the error message helpful.
function closest(target, candidates) {
  const d = (a, b) => {
    const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 0; j <= b.length; j++) m[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1,
          m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return m[a.length][b.length];
  };
  return candidates
    .map(c => ({ c, d: d(target, c) }))
    .sort((x, y) => x.d - y.d)
    .slice(0, 3)
    .map(x => x.c);
}

/** Throw unless every named column exists on the table. */
async function assertColumns(table, columns) {
  const tables = await loadSchema();
  if (!tables[table]) {
    throw new Error(
      `TEST BUG: table "${table}" does not exist. ` +
      `Did you mean: ${closest(table, Object.keys(tables)).join(', ')}?`
    );
  }
  const missing = columns.filter(c => !tables[table].includes(c));
  if (missing.length) {
    const hints = missing
      .map(m => `  "${m}" -> did you mean ${closest(m, tables[table]).map(x => `"${x}"`).join(' / ')}?`)
      .join('\n');
    throw new Error(
      `TEST BUG: ${table} has no column(s) ${missing.map(m => `"${m}"`).join(', ')}.\n` +
      `${hints}\n` +
      `This is a fault in the test, not in the application. Fix the test.`
    );
  }
}

/**
 * Schema-checked read. Validates every requested column before querying, so a
 * typo surfaces as an obvious test bug instead of an empty result that looks
 * like an application defect.
 */
async function select(table, columns, filter = '') {
  await assertColumns(table, columns);
  const q = `${table}?select=${columns.join(',')}${filter ? '&' + filter : ''}`;
  const r = await fetch(`${URL_BASE}/rest/v1/${q}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    throw new Error(`Query failed (${r.status}) on ${q}: ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body;
}

/** Read a single row, or null. */
async function selectOne(table, columns, filter) {
  const rows = await select(table, columns, filter);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/**
 * Parse an API response body that may be a JSON string or an object.
 * The handlers return a stringified payload; reading `.ok` straight off it
 * yields undefined and produced a false failure during the audit.
 */
function parseBody(body) {
  if (body == null) return null;
  if (typeof body === 'string') { try { return JSON.parse(body); } catch { return body; } }
  return body;
}

module.exports = { loadSchema, assertColumns, select, selectOne, parseBody, env };
