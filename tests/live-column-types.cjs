// tests/live-column-types.cjs
//
// READ ONLY. Prints the real Postgres type of each column in a live table,
// read from PostgREST's OpenAPI document.
//
// Exists because reconciling supabase/SETUP_FROM_SCRATCH.sql with production
// means writing ALTER TABLE ... ADD COLUMN with the RIGHT type. Guessing from
// a column's name is how `is_sales_sourced` becomes text and `due_date`
// becomes timestamptz, and a type mismatch between the repo's schema and
// production is worse than the missing column it was meant to fix.
//
//   node tests/live-column-types.cjs campaigns
//   node tests/live-column-types.cjs campaigns brief_url due_date

const { env } = require('./lib/schema.cjs');

const URL_BASE = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;

(async () => {
  const [table, ...wanted] = process.argv.slice(2);
  if (!table) {
    console.error('usage: node tests/live-column-types.cjs <table> [column ...]');
    process.exit(2);
  }

  const res = await fetch(`${URL_BASE}/rest/v1/`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: 'application/openapi+json' },
  });
  if (!res.ok) throw new Error(`OpenAPI fetch failed (${res.status})`);
  const doc = await res.json();

  const def = doc.definitions && doc.definitions[table];
  if (!def) {
    console.error(`no such table exposed: ${table}`);
    process.exit(1);
  }

  const rows = Object.entries(def.properties || {})
    .filter(([name]) => wanted.length === 0 || wanted.includes(name))
    .map(([name, p]) => ({
      name,
      // PostgREST puts the real Postgres type in `format`; `type` is the JSON
      // shape and is far too lossy to build a schema from.
      pg: p.format || p.type || '?',
      nullable: !(def.required || []).includes(name),
      dflt: p.default === undefined ? '' : String(p.default),
      note: (p.description || '').split('\n')[0].slice(0, 44),
    }));

  if (!rows.length) {
    console.log(`  none of [${wanted.join(', ')}] exist on ${table}`);
    process.exit(1);
  }

  console.log(`\n${table}\n`);
  console.log('  COLUMN                          TYPE                      NULL  DEFAULT');
  console.log('  ' + '-'.repeat(78));
  for (const r of rows) {
    console.log(
      '  ' + r.name.padEnd(32) +
      String(r.pg).padEnd(26) +
      (r.nullable ? 'yes ' : 'NO  ').padEnd(6) +
      r.dflt + (r.note ? '   ' + r.note : '')
    );
  }
  console.log('');
})().catch(e => { console.error('PROBE FAILED:', e.message); process.exit(2); });
