// tests/schema-drift-report.cjs
//
// READ ONLY. What can the repository build, versus what production actually has?
//
// Builds supabase/SETUP.sql plus every migration in PGlite, then compares it column by column
// with the live database (F-12 drift). Columns only the repo has are migrations not yet applied.
//
//   node tests/schema-drift-report.cjs

const { loadSchema } = require('./lib/schema.cjs');

const { freshDb } = require('../supabase/migrations/__tests__/db.cjs');

(async () => {
  console.log('\nSchema drift — what the repo builds vs what production has\n');

  let db;
  try {
    db = await freshDb();
  } catch (e) {
    console.log('  SETUP.sql plus migrations FAILED to run:');
    console.log('    ' + String(e.message).split('\n')[0].slice(0, 140));
    process.exit(1);
  }
  console.log('  SETUP.sql and every migration ran cleanly');

  const repoRows = await db.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, column_name
  `);
  await db.close();

  const repo = {};
  for (const r of repoRows.rows) {
    (repo[r.table_name] = repo[r.table_name] || new Set()).add(r.column_name);
  }

  // --- production's version -------------------------------------------------
  const live = await loadSchema();

  console.log(`  repo builds ${Object.keys(repo).length} table(s); production exposes ${Object.keys(live).length}\n`);

  // PostgREST exposes views alongside tables; those are not drift.
  const VIEWS = new Set(Object.keys(live).filter(t => /^client_safe_|_safe$/.test(t)));

  let missingTotal = 0, extraTotal = 0;
  const missingTables = [];

  for (const table of Object.keys(live).sort()) {
    if (VIEWS.has(table)) continue;
    const liveCols = new Set(live[table]);
    const repoCols = repo[table];

    if (!repoCols) {
      missingTables.push(table);
      continue;
    }

    const missing = [...liveCols].filter(c => !repoCols.has(c)).sort();
    const extra = [...repoCols].filter(c => !liveCols.has(c)).sort();

    if (missing.length || extra.length) {
      console.log('  ' + table);
      if (missing.length) {
        missingTotal += missing.length;
        console.log('    production has, repo does NOT build: ' + missing.join(', '));
      }
      if (extra.length) {
        extraTotal += extra.length;
        console.log('    repo builds, production does NOT have: ' + extra.join(', '));
      }
    }
  }

  if (missingTables.length) {
    console.log('\n  Tables in production that the repo does not build at all:');
    for (const t of missingTables) console.log('    · ' + t);
  }

  console.log('\n  ' + '-'.repeat(62));
  console.log(`  ${missingTotal} column(s) production has that the repo cannot create`);
  console.log(`  ${extraTotal} column(s) the repo creates that production lacks`);
  console.log(`  ${missingTables.length} table(s) missing from the repo entirely`);

  if (missingTotal === 0 && missingTables.length === 0) {
    console.log('\n  The repo can rebuild production\'s shape. Staging, branches and');
    console.log('  disaster recovery are all possible.\n');
  } else {
    console.log('\n  Until this reaches zero, the repo cannot rebuild this database:');
    console.log('  no staging, no Supabase branch, no disaster recovery, and the');
    console.log('  migration chain stops wherever it first needs a missing column.\n');
  }


  process.exit(0);
})().catch(e => { console.error('PROBE FAILED:', e.message); process.exit(2); });
