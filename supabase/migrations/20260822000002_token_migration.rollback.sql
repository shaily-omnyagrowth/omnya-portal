-- ============================================================================
-- ROLLBACK: 20260822000002_token_migration.sql   (F-3, F-13)
-- ============================================================================
--
-- Restores browser read access to public.creator_tokens.
--
-- READ THIS FIRST. creator_tokens.access_token and .refresh_token are
-- PLAINTEXT. Running this file gives every signed-in creator a browser-side
-- read of their own OAuth access token, and gives the owner a read of every
-- creator's. That is the exposure the forward migration closed.
--
-- There is almost never a good reason to run this. If something broke after
-- the forward migration, the cause is far more likely to be one of:
--
--   · a code path still selecting creator_tokens with the anon key --
--     find it and move it to /api/social/connections instead;
--   · the backfill not having run, so creator_social_accounts is empty --
--     run scripts/backfill-tokens.js rather than reopening the old table;
--   · ENCRYPTION_KEY unset, so the new path throws on every connect --
--     set it; the plaintext table will not help, the code no longer reads it.
--
-- The NOT NULL on access_token is deliberately NOT restored. Re-adding it
-- would fail outright on any row the scrub phase has already nulled, and it
-- protects nothing.
-- ============================================================================

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.creator_tokens') IS NULL THEN
        RAISE NOTICE 'creator_tokens does not exist -- nothing to roll back.';
        RETURN;
    END IF;

    EXECUTE 'ALTER TABLE public.creator_tokens ENABLE ROW LEVEL SECURITY';

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'GRANT SELECT, DELETE ON public.creator_tokens TO authenticated';
    END IF;

    EXECUTE 'DROP POLICY IF EXISTS creator_tokens_select_self ON public.creator_tokens';
    EXECUTE $p$
      CREATE POLICY creator_tokens_select_self ON public.creator_tokens
        FOR SELECT TO authenticated
        USING (user_id = auth.uid() OR public.current_user_role() = 'owner')
    $p$;

    EXECUTE 'DROP POLICY IF EXISTS creator_tokens_delete_self ON public.creator_tokens';
    EXECUTE $p$
      CREATE POLICY creator_tokens_delete_self ON public.creator_tokens
        FOR DELETE TO authenticated
        USING (user_id = auth.uid() OR public.current_user_role() = 'owner')
    $p$;

    EXECUTE $c$
      COMMENT ON TABLE public.creator_tokens IS
        'ROLLED BACK to browser-readable. Holds PLAINTEXT OAuth tokens and is '
        'readable by the owning creator and by any owner. Re-apply '
        '20260822000002_token_migration.sql to close this.'
    $c$;

    RAISE WARNING
        'F-3 ROLLED BACK: plaintext OAuth tokens in creator_tokens are readable from the browser again.';
END;
$$;

COMMIT;
