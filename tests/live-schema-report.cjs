// tests/live-schema-report.cjs
//
// Ground truth for F-12 (migrations matching production).
//
// Reads the live PostgREST OpenAPI document and prints every table the
// production database actually exposes, together with its columns. Compare
// against supabase/migrations/ to see what exists in production but in no
// migration -- and what a migration creates that production has never seen.
//
//   node tests/live-schema-report.cjs            # table list
//   node tests/live-schema-report.cjs <table>    # columns of one table

const { loadSchema } = require('./lib/schema.cjs');

(async () => {
  const schema = await loadSchema();
  const tables = Object.keys(schema).sort();
  const only = process.argv[2];

  if (only) {
    if (!schema[only]) {
      console.log(`ABSENT  ${only}  -- not exposed by the live database`);
      process.exit(1);
    }
    console.log(`${only}: ${schema[only].join(', ')}`);
    return;
  }

  console.log(`live tables (${tables.length}):`);
  for (const t of tables) console.log(`  ${t}  (${schema[t].length} cols)`);
})().catch(e => { console.error('PROBE FAILED:', e.message); process.exit(2); });
