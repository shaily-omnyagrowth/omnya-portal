// Shared PGlite setup: Supabase's auth stubs, roles and default grants, then
// supabase/SETUP.sql and every migration after it.

const fs = require('fs');
const path = require('path');

const MIG = path.join(__dirname, '..');
const SETUP = path.join(MIG, '..', 'SETUP.sql');
const read = (p) => fs.readFileSync(p, 'utf8');

const SUPABASE = `
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE IF NOT EXISTS auth.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT,
    raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
    LANGUAGE sql STABLE AS $fn$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID
    $fn$;
  DO $r$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role; END IF;
  END $r$;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
`;

const migrationFiles = () => fs.readdirSync(MIG).filter((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f)).sort();

function loadPGlite() {
  try {
    return require('@electric-sql/pglite').PGlite;
  } catch {
    console.error('SKIP: @electric-sql/pglite is not installed.  npm i -D @electric-sql/pglite');
    process.exit(0);
  }
}

async function freshDb({ migrations = true } = {}) {
  const db = await loadPGlite().create();
  await db.exec(SUPABASE);
  await db.exec(read(SETUP));
  if (migrations) for (const f of migrationFiles()) await db.exec(read(path.join(MIG, f)));
  return db;
}

module.exports = { freshDb, migrationFiles, read, MIG, SETUP, SUPABASE };
