// supabase/migrations/__tests__/campaign-shares.test.cjs
//
// Acceptance for 20260908000000_campaign_shares_and_progress.sql, against a
// real PostgreSQL engine (PGlite). Same conventions as new-migrations.test.cjs.
//
//   1. does it apply, on a database that only has the core tables?
//   2. is it idempotent, and does a second run leave existing tokens alone?
//      (a regenerated token would silently break every link already shared)
//   3. is it one transaction, as supabase/migrations/README.md requires?
//
//   node supabase/migrations/__tests__/campaign-shares.test.cjs

const fs = require('fs');
const path = require('path');

let PGlite;
try {
  ({ PGlite } = require('@electric-sql/pglite'));
} catch {
  console.error('SKIP: @electric-sql/pglite is not installed.  npm i -D @electric-sql/pglite');
  process.exit(0);
}

const S = __dirname;
const MIG = path.join(__dirname, '..');
const FILE = '20260908000000_campaign_shares_and_progress.sql';
const read = p => fs.readFileSync(p, 'utf8');

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};

const one = async (db, sql) => (await db.query(sql)).rows[0];

(async () => {
  console.log('\n' + FILE);
  const sql = read(path.join(MIG, FILE));

  R(/^\s*BEGIN;/m.test(sql) && /^\s*COMMIT;\s*$/m.test(sql),
    'is wrapped in BEGIN; ... COMMIT; (README rule)');

  const db = await PGlite.create();
  await db.exec(read(S + '/fixture_schema.sql'));
  // Production campaigns has created_at (the migration backfills start_date
  // from it); the shared fixture keeps campaigns minimal, so add it here.
  await db.exec('ALTER TABLE public.campaigns ADD COLUMN created_at TIMESTAMPTZ DEFAULT now();');
  await db.exec(`
    INSERT INTO public.campaigns (name, status, created_at) VALUES
      ('Older', 'Active', '2026-08-01T10:00:00Z'),
      ('Newer', 'Active', '2026-09-01T10:00:00Z');
  `);

  try {
    await db.exec(sql);
    R(true, 'applies to a fresh database');
  } catch (e) {
    R(false, 'applies to a fresh database', e.message.slice(0, 300));
    await db.close();
    process.exit(1);
  }

  const cols = (await db.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'campaigns'
      AND column_name IN ('share_token', 'share_enabled', 'share_created_at', 'start_date')
    ORDER BY column_name`)).rows.map(r => r.column_name);
  R(cols.length === 4, 'adds share_token, share_enabled, share_created_at, start_date', cols.join(','));

  const rows = (await db.query('SELECT name, share_token, share_enabled, start_date::text AS start_date FROM public.campaigns ORDER BY name')).rows;
  R(rows.every(r => typeof r.share_token === 'string' && r.share_token.length > 0),
    'every existing campaign gets a share_token');
  R(new Set(rows.map(r => r.share_token)).size === rows.length,
    'share tokens are distinct');
  R(rows.every(r => r.share_enabled === false),
    'sharing is OFF for every existing campaign (nothing becomes public by accident)');
  const older = rows.find(r => r.name === 'Older');
  R(older.start_date === '2026-08-01',
    'start_date backfills from created_at', String(older.start_date));

  const idx = await one(db, "SELECT 1 AS ok FROM pg_indexes WHERE indexname = 'idx_campaigns_share_token'");
  R(Boolean(idx), 'creates idx_campaigns_share_token');

  const before = rows.map(r => r.share_token).join('|');
  try {
    await db.exec(sql);
    R(true, 'is idempotent (applies a second time)');
  } catch (e) {
    R(false, 'is idempotent (applies a second time)', e.message.slice(0, 300));
  }
  const after = (await db.query('SELECT share_token FROM public.campaigns ORDER BY name')).rows.map(r => r.share_token).join('|');
  R(before === after, 'a second run does not regenerate existing tokens');

  // A campaign inserted after the migration gets a token from the default.
  const fresh = await one(db, "INSERT INTO public.campaigns (name) VALUES ('Later') RETURNING share_token, share_enabled");
  R(typeof fresh.share_token === 'string' && fresh.share_enabled === false,
    'new campaigns get a token by default and start private');

  await db.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST BUG:', e); process.exit(1); });
