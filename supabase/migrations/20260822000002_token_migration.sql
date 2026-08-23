-- ============================================================================
-- MIGRATION: 20260822000002_token_migration.sql
-- Omnya Portal — retire creator_tokens as the live token store  (F-3, F-13)
-- ============================================================================
--
-- WHAT CHANGED IN THE APPLICATION
--
-- Every OAuth connection now writes public.creator_social_accounts, with the
-- tokens encrypted AES-256-GCM by api/_utils/encryption.js:
--
--   api/auth/meta/callback.js         -> creator_social_accounts (encrypted)
--   api/auth/instagram/callback.js    -> creator_social_accounts (encrypted)
--   api/auth/youtube/callback.js      -> creator_social_accounts (encrypted)
--   api/integrations/tiktok/callback  -> creator_social_accounts (encrypted)
--   api/auth/tiktok/callback.js       -> delegates to the above
--
-- and every read path follows it -- api/_utils/analytics.js,
-- api/social/connections.js, src/pages/CreatorDashboard.js.
--
-- public.creator_tokens keeps its historical rows and stops being written to.
--
--
-- THE EXPOSURE THIS CLOSES
--
-- creator_tokens.access_token and .refresh_token are PLAINTEXT, and
-- 20260521000000 grants a browser read over them:
--
--     CREATE POLICY creator_tokens_select_self ON public.creator_tokens
--       FOR SELECT TO authenticated
--       USING (user_id = auth.uid() OR public.current_user_role() = 'owner');
--
-- So a signed-in creator could select their own OAuth access token in the
-- clear from the browser, and an owner could select every creator's. Until
-- today the dashboard genuinely did read that table, so the policy had a
-- caller and removing it would have broken the page. Nothing reads it from a
-- browser any more, so SECTION 2 takes the read away entirely.
--
-- Encrypting the new table while leaving the old one browser-readable would
-- have been theatre.
--
--
-- WHAT THIS MIGRATION DOES NOT DO
--
-- It does not copy the existing rows across, and it does not delete the
-- plaintext. Both are the job of scripts/backfill-tokens.js, because AES-GCM
-- encryption cannot happen inside PostgreSQL -- the wire format
-- ([IV | tag | ciphertext], base64) is defined in application code and the key
-- lives only in the server environment.
--
--   node scripts/backfill-tokens.js --dry-run     # report what would move
--   node scripts/backfill-tokens.js               # encrypt + upsert
--   node scripts/backfill-tokens.js --scrub       # null the verified plaintext
--
-- Run the backfill AFTER this migration: SECTION 3 drops the NOT NULL that
-- would otherwise make --scrub fail with 23502.
--
-- Rollback: 20260822000002_token_migration.rollback.sql
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1 — preconditions
-- ============================================================================

DO $$
BEGIN
    IF to_regclass('public.creator_tokens') IS NULL THEN
        RAISE NOTICE 'F-3: creator_tokens does not exist here -- nothing to retire.';
    END IF;

    IF to_regclass('public.creator_social_accounts') IS NULL THEN
        RAISE EXCEPTION
            'F-3: creator_social_accounts is missing. Apply 20260604000000_tiktok_integration.sql first -- retiring the old store before the new one exists would leave no token store at all.';
    END IF;
END;
$$;


-- ============================================================================
-- SECTION 2 — take the plaintext away from the browser
-- ============================================================================

DO $$
DECLARE
    r RECORD;
    v_dropped INT := 0;
BEGIN
    IF to_regclass('public.creator_tokens') IS NULL THEN
        RETURN;
    END IF;

    -- Discovered rather than named: production may carry policies on this
    -- table that exist in no migration, and every one of them is a read over
    -- plaintext tokens.
    FOR r IN
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'creator_tokens'
    LOOP
        RAISE NOTICE 'F-3: dropping creator_tokens policy -> %', r.policyname;
        EXECUTE format('DROP POLICY %I ON public.creator_tokens', r.policyname);
        v_dropped := v_dropped + 1;
    END LOOP;

    RAISE NOTICE 'F-3: dropped % policy/policies on creator_tokens', v_dropped;

    EXECUTE 'ALTER TABLE public.creator_tokens ENABLE ROW LEVEL SECURITY';

    -- RLS on with no permissive policy = no access for any non-superuser role.
    -- The API reaches this table through service_role, which bypasses RLS, so
    -- the backfill and disconnect paths are unaffected.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'REVOKE ALL ON public.creator_tokens FROM authenticated';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON public.creator_tokens FROM anon';
    END IF;
END;
$$;


-- ============================================================================
-- SECTION 3 — let the plaintext be erased
-- ============================================================================
--
-- access_token is NOT NULL, so `UPDATE creator_tokens SET access_token = NULL`
-- fails with 23502 and the scrub phase cannot do its job. api/auth/disconnect.js
-- already carries a fallback for exactly this and names this migration in its
-- comment; once this lands, the fallback stops being needed.

DO $$
BEGIN
    IF to_regclass('public.creator_tokens') IS NULL THEN
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'creator_tokens'
          AND column_name = 'access_token' AND is_nullable = 'NO'
    ) THEN
        EXECUTE 'ALTER TABLE public.creator_tokens ALTER COLUMN access_token DROP NOT NULL';
        RAISE NOTICE 'F-3: creator_tokens.access_token is now nullable -- the scrub phase can erase it.';
    ELSE
        RAISE NOTICE 'F-3: creator_tokens.access_token was already nullable.';
    END IF;
END;
$$;


-- ============================================================================
-- SECTION 4 — label the table so the next reader is not misled
-- ============================================================================

DO $$
BEGIN
    IF to_regclass('public.creator_tokens') IS NULL THEN
        RETURN;
    END IF;

    EXECUTE $c$
      COMMENT ON TABLE public.creator_tokens IS
        'LEGACY, NOT WRITTEN TO. Superseded by public.creator_social_accounts, '
        'which stores the same connections with AES-256-GCM encrypted tokens '
        '(F-3 / F-13). Retained for history only. Rows are migrated by '
        'scripts/backfill-tokens.js; its --scrub phase NULLs the plaintext once '
        'a row is verified to round-trip. No browser-facing role has any '
        'privilege on this table. Do not add one.'
    $c$;

    EXECUTE $c$
      COMMENT ON COLUMN public.creator_tokens.access_token IS
        'PLAINTEXT LEGACY VALUE. Never expose. Encrypted equivalent lives in '
        'creator_social_accounts.access_token_encrypted.'
    $c$;

    EXECUTE $c$
      COMMENT ON COLUMN public.creator_tokens.refresh_token IS
        'PLAINTEXT LEGACY VALUE. Never expose. Encrypted equivalent lives in '
        'creator_social_accounts.refresh_token_encrypted.'
    $c$;
END;
$$;


-- ============================================================================
-- SECTION 5 — verification
-- ============================================================================

DO $$
DECLARE
    v_policies INT;
    v_rows     INT;
    v_plain    INT;
BEGIN
    IF to_regclass('public.creator_tokens') IS NULL THEN
        RAISE NOTICE 'F-3: nothing to verify -- creator_tokens does not exist.';
        RETURN;
    END IF;

    SELECT count(*) INTO v_policies
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'creator_tokens';

    IF v_policies > 0 THEN
        RAISE EXCEPTION
            'F-3: % policy/policies remain on creator_tokens. A browser-readable plaintext token store is the exposure this migration exists to close.',
            v_policies;
    END IF;

    EXECUTE 'SELECT count(*) FROM public.creator_tokens' INTO v_rows;
    EXECUTE 'SELECT count(*) FROM public.creator_tokens WHERE access_token IS NOT NULL' INTO v_plain;

    RAISE NOTICE 'F-3: creator_tokens retired. % row(s) remain, % still hold plaintext.', v_rows, v_plain;

    IF v_plain > 0 THEN
        RAISE NOTICE 'F-3: NEXT STEP -- node scripts/backfill-tokens.js --dry-run, then without the flag, then --scrub.';
    END IF;
END;
$$;

COMMIT;
