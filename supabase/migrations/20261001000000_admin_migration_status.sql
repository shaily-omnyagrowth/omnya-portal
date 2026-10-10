-- ============================================================================
-- 20261001000000_admin_migration_status.sql
--
-- Spec 0001 (production config and migrations), AC-7.
--
-- One read only function that System Config calls to answer "which migrations
-- are on this database?". It returns two things side by side:
--
--   history  what the Supabase CLI recorded in
--            supabase_migrations.schema_migrations (empty when the table does
--            not exist, which was production's state on 2026-10-01)
--   probes   for each entry of supabase/migrations/probes.json the caller
--            passes in, whether the object that file leaves behind is present
--
-- System Config combines the two into applied / broken / pending / drift.
-- History alone is not proof: files were pasted by hand for months, so the
-- catalog is the second witness.
--
-- Safety:
--   * No dynamic SQL is built from the input. Every probe value reaches the
--     catalog only as a parameter to to_regclass / to_regprocedure or as a
--     comparison value, so a hostile manifest can at worst report false.
--   * EXECUTE is granted to service_role only. The browser never calls this;
--     api/admin/config-status.js does, after requireOwner.
--
-- The block between the PROBE_SELECT markers is the only copy of the probe
-- SQL. api/_lib/migrationProbes.js (probeSelectSql) lifts it out of this file
-- so scripts/db-migrate.cjs runs the very same query over `pg` on a database
-- where this function does not exist yet. Keep the markers.
--
-- Idempotent: safe to re-run. Rollback:
--   supabase/rollbacks/20261001000000_admin_migration_status.rollback.sql
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_migration_status(probes jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  hist   jsonb := '[]'::jsonb;
  result jsonb := '[]'::jsonb;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    -- to_jsonb(m)->>'name' rather than m.name: very old CLI versions created
    -- the table without a name column, and a missing column must not turn
    -- the whole panel red.
    SELECT COALESCE(
             jsonb_agg(jsonb_build_object('version', m.version,
                                          'name', to_jsonb(m)->>'name')
                       ORDER BY m.version),
             '[]'::jsonb)
      INTO hist
      FROM supabase_migrations.schema_migrations m;
  END IF;

  IF probes IS NOT NULL AND jsonb_typeof(probes) = 'array' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'file', r.file, 'present', r.present, 'detail', r.detail)), '[]'::jsonb)
      INTO result
      FROM (
        -- PROBE_SELECT (read by api/_lib/migrationProbes.js; keep the markers)
        SELECT p->>'file' AS file,
               COALESCE(CASE p->>'kind'
                 WHEN 'table'    THEN to_regclass(p->>'table') IS NOT NULL
                 WHEN 'index'    THEN to_regclass(p->>'index') IS NOT NULL
                 WHEN 'function' THEN to_regprocedure(p->>'signature') IS NOT NULL
                 WHEN 'function_body' THEN
                   position(p->>'marker' IN pg_get_functiondef(to_regprocedure(p->>'signature'))) > 0
                 WHEN 'columns' THEN (
                   SELECT count(DISTINCT c.column_name) = jsonb_array_length(p->'columns')
                     FROM information_schema.columns c
                    WHERE c.table_schema = split_part(p->>'table', '.', 1)
                      AND c.table_name   = split_part(p->>'table', '.', 2)
                      AND c.column_name IN (SELECT jsonb_array_elements_text(p->'columns')))
                 WHEN 'policy' THEN EXISTS (
                   SELECT 1 FROM pg_policies pp
                    WHERE pp.schemaname = split_part(p->>'table', '.', 1)
                      AND pp.tablename  = split_part(p->>'table', '.', 2)
                      AND pp.policyname = p->>'policy')
                 WHEN 'trigger' THEN EXISTS (
                   SELECT 1 FROM pg_trigger t
                    WHERE t.tgrelid = to_regclass(p->>'table')
                      AND t.tgname  = p->>'trigger')
                 WHEN 'constraint' THEN EXISTS (
                   SELECT 1 FROM pg_constraint k
                    WHERE k.conrelid = to_regclass(p->>'table')
                      AND k.conname  = p->>'constraint')
               END, false) AS present,
               p->>'kind' AS detail
          FROM jsonb_array_elements(probes) AS p
        -- end PROBE_SELECT
      ) r;
  END IF;

  RETURN jsonb_build_object('history', hist, 'probes', result);
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_migration_status(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_migration_status(jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_migration_status(jsonb) TO service_role;

-- PostgREST caches the schema. Without this the RPC answers PGRST202 until
-- the next cache reload, and System Config would wrongly say this file is
-- missing right after it was applied.
NOTIFY pgrst, 'reload schema';

COMMIT;
