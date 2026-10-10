-- Rollback for 20261001000000_admin_migration_status.sql (spec 0001).
--
-- Removes the read only status function. Nothing else depends on it in the
-- database; System Config falls back to naming this migration (PGRST202).
-- Never applied by a routine command (see README.md in this folder).

BEGIN;

DROP FUNCTION IF EXISTS public.admin_migration_status(jsonb);

NOTIFY pgrst, 'reload schema';

COMMIT;
