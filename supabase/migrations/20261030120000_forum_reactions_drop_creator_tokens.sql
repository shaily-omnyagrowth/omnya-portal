-- Adds forum message reactions and drops the legacy plaintext token table.
-- contract: feat/portal-redesign stopped reading creator_tokens; it held no rows in production.

BEGIN;

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS reactions jsonb DEFAULT '{}'::jsonb;

DROP VIEW IF EXISTS public.creator_connection_status;
DROP TABLE IF EXISTS public.creator_tokens;

COMMIT;
