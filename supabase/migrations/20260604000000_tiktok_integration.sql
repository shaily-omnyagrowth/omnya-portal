-- ============================================================================
-- MIGRATION: 20260604000000_tiktok_integration.sql
-- Omnya Portal — TikTok / social integration baseline  (F-12, F-13)
-- ============================================================================
--
-- WHY THIS FILE IS A REWRITE
--
--   It was committed as a 1-byte EMPTY file. The three tables it claims to
--   create -- creator_social_accounts, creator_videos, video_metrics -- were
--   created by hand in the production database and exist in NO migration. That
--   is the single largest piece of schema drift in the repo (audit finding
--   F-12): a fresh Supabase project built from supabase/migrations/ comes up
--   WITHOUT the tables that api/integrations/tiktok/* writes to, so the entire
--   TikTok path fails on a clean environment.
--
--   Every column, type, default and NOT NULL below was read back from the live
--   database through the PostgREST OpenAPI document
--   (`node tests/live-schema-report.cjs creator_social_accounts`) rather than
--   invented. This file is therefore a no-op against production and a faithful
--   reconstruction everywhere else.
--
-- WHY THESE TABLES AND NOT creator_tokens
--
--   Two TikTok implementations exist (F-13). `api/auth/tiktok/*` writes
--   plaintext tokens to `creator_tokens`; `api/integrations/tiktok/*` writes
--   AES-256-GCM ciphertext to `creator_social_accounts` and syncs videos into
--   `creator_videos` / `video_metrics`. The decision recorded in
--   .claude/IMPLEMENTATION_BRIEF.md section 3 is to converge on
--   creator_social_accounts; `creator_tokens` becomes legacy/read-only.
--
-- THE TOKEN COLUMNS ARE NOT BROWSER-READABLE
--
--   access_token_encrypted / refresh_token_encrypted hold ciphertext, but the
--   key lives in ENCRYPTION_KEY on the server, so ciphertext in the browser is
--   still a credential that only has to survive one key leak. SECTION 7
--   therefore:
--     * publishes `public.creator_social_accounts_safe`, which projects every
--       column EXCEPT those two, and
--     * REVOKEs anon's access to the base table entirely, and revokes
--       `authenticated`'s SELECT on the two token columns specifically.
--   The browser path is the VIEW. The server path (api/integrations/tiktok/*)
--   uses the service-role key, bypasses both RLS and these grants, and is
--   unaffected. Read the note above SECTION 7 before adding a browser query.
--
-- SAFETY
--   * CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS throughout.
--   * Every constraint is added inside a DO block that first checks whether an
--     equivalent constraint already exists AND that no existing row would
--     violate it. A production table that already carries the constraint is
--     left alone; one that carries violating data gets a RAISE NOTICE instead
--     of a failed migration.
--   * No DROP COLUMN, no DELETE, no data rewrite.
--   * Safe to re-run.
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1 — updated_at trigger helper
--
-- Byte-identical to the definition in 20260530000000_payout_system.sql. Kept
-- here so this file can be applied standalone against a database that only has
-- the core tables.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

REVOKE ALL  ON FUNCTION public.set_updated_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO service_role;


-- ============================================================================
-- SECTION 2 — creator_social_accounts
--
-- One row per (user, platform). Written by api/integrations/tiktok/callback.js
-- with `onConflict: 'user_id,platform'`, which is why the UNIQUE constraint in
-- SECTION 5 is load-bearing rather than decorative: without it every OAuth
-- callback fails with "there is no unique or exclusion constraint matching the
-- ON CONFLICT specification".
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.creator_social_accounts (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                   UUID        NOT NULL,
    creator_id                UUID,
    workspace_id              UUID,
    platform                  TEXT        NOT NULL,
    platform_user_id          TEXT,
    username                  TEXT,
    display_name              TEXT,
    profile_image_url         TEXT,
    access_token_encrypted    TEXT,
    refresh_token_encrypted   TEXT,
    token_expires_at          TIMESTAMPTZ,
    refresh_token_expires_at  TIMESTAMPTZ,
    scopes                    TEXT[]      NOT NULL DEFAULT '{}',
    connection_status         TEXT        NOT NULL DEFAULT 'not_connected',
    last_synced_at            TIMESTAMPTZ,
    last_error                TEXT,
    metadata                  JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.creator_social_accounts IS
    'One connected social account per (user_id, platform). Tokens are stored as '
    'AES-256-GCM ciphertext produced by api/_utils/encryption.js. Read from the '
    'browser through creator_social_accounts_safe, never from this table.';

COMMENT ON COLUMN public.creator_social_accounts.access_token_encrypted IS
    'base64([IV 12B | GCM tag 16B | ciphertext]). Never exposed to anon or to '
    'authenticated -- see the column grants in SECTION 7.';


-- ============================================================================
-- SECTION 3 — creator_videos
--
-- Upserted by api/integrations/tiktok/sync.js with
-- `onConflict: 'user_id,platform,platform_video_id'`.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.creator_videos (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID        NOT NULL,
    creator_id         UUID,
    workspace_id       UUID,
    social_account_id  UUID,
    platform           TEXT        NOT NULL DEFAULT 'tiktok',
    platform_video_id  TEXT        NOT NULL,
    video_url          TEXT,
    caption            TEXT,
    thumbnail_url      TEXT,
    posted_at          TIMESTAMPTZ,
    view_count         BIGINT      NOT NULL DEFAULT 0,
    like_count         BIGINT      NOT NULL DEFAULT 0,
    comment_count      BIGINT      NOT NULL DEFAULT 0,
    share_count        BIGINT      NOT NULL DEFAULT 0,
    duration_seconds   INTEGER,
    sync_status        TEXT        NOT NULL DEFAULT 'synced',
    metadata           JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.creator_videos IS
    'Latest known state of one published video. The per-pull history lives in '
    'video_metrics; this table is overwritten on every sync.';


-- ============================================================================
-- SECTION 4 — video_metrics
--
-- Append-only snapshots, one row per sync per video. Nothing updates a row
-- here: trend analysis is done by comparing snapshots.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.video_metrics (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id         UUID        NOT NULL,
    user_id          UUID        NOT NULL,
    snapshot_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    view_count       BIGINT      NOT NULL DEFAULT 0,
    like_count       BIGINT      NOT NULL DEFAULT 0,
    comment_count    BIGINT      NOT NULL DEFAULT 0,
    share_count      BIGINT      NOT NULL DEFAULT 0,
    engagement_rate  NUMERIC,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.video_metrics IS
    'Immutable metric snapshots for creator_videos rows. One row per sync.';


-- ============================================================================
-- SECTION 5 — constraints
--
-- Each block is guarded twice: it skips if an equivalent constraint already
-- exists (production), and it skips with a NOTICE rather than failing if
-- existing rows would violate it. A migration that cannot safely tighten a
-- constraint should say so in the apply log, not abort the whole run.
-- ============================================================================

-- ---- 5a. UNIQUE (user_id, platform) on creator_social_accounts -------------
-- This is the ON CONFLICT arbiter for the OAuth callback.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE  schemaname = 'public'
          AND  tablename  = 'creator_social_accounts'
          AND  indexdef ILIKE '%UNIQUE%'
          AND  indexdef ILIKE '%(user_id, platform)%'
    ) THEN
        RAISE NOTICE 'creator_social_accounts: UNIQUE(user_id, platform) already present -- skipped';
    ELSIF EXISTS (
        SELECT 1 FROM public.creator_social_accounts
        GROUP BY user_id, platform HAVING count(*) > 1
    ) THEN
        RAISE NOTICE 'creator_social_accounts: duplicate (user_id, platform) rows exist -- UNIQUE NOT added. Deduplicate, then re-run.';
    ELSE
        ALTER TABLE public.creator_social_accounts
            ADD CONSTRAINT creator_social_accounts_user_id_platform_key
            UNIQUE (user_id, platform);
        RAISE NOTICE 'creator_social_accounts: added UNIQUE(user_id, platform)';
    END IF;
END
$$;

-- ---- 5b. UNIQUE (user_id, platform, platform_video_id) on creator_videos ---
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE  schemaname = 'public'
          AND  tablename  = 'creator_videos'
          AND  indexdef ILIKE '%UNIQUE%'
          AND  indexdef ILIKE '%(user_id, platform, platform_video_id)%'
    ) THEN
        RAISE NOTICE 'creator_videos: UNIQUE(user_id, platform, platform_video_id) already present -- skipped';
    ELSIF EXISTS (
        SELECT 1 FROM public.creator_videos
        GROUP BY user_id, platform, platform_video_id HAVING count(*) > 1
    ) THEN
        RAISE NOTICE 'creator_videos: duplicate (user_id, platform, platform_video_id) rows exist -- UNIQUE NOT added.';
    ELSE
        ALTER TABLE public.creator_videos
            ADD CONSTRAINT creator_videos_user_platform_video_key
            UNIQUE (user_id, platform, platform_video_id);
        RAISE NOTICE 'creator_videos: added UNIQUE(user_id, platform, platform_video_id)';
    END IF;
END
$$;

-- ---- 5c. Foreign keys ------------------------------------------------------
-- Production carries FKs for creator_videos.social_account_id and
-- video_metrics.video_id but NOT for the user_id / creator_id columns (checked
-- against the live PostgREST relationship map). The blocks below add the
-- missing ones when the data allows it.
DO $$
DECLARE
    v_orphans BIGINT;
BEGIN
    -- creator_social_accounts.user_id -> auth.users
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'creator_social_accounts_user_id_fkey'
                     AND conrelid = 'public.creator_social_accounts'::regclass) THEN
        SELECT count(*) INTO v_orphans
        FROM   public.creator_social_accounts csa
        WHERE  NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = csa.user_id);
        IF v_orphans > 0 THEN
            RAISE NOTICE 'creator_social_accounts.user_id: % orphan row(s) -- FK NOT added', v_orphans;
        ELSE
            ALTER TABLE public.creator_social_accounts
                ADD CONSTRAINT creator_social_accounts_user_id_fkey
                FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
            RAISE NOTICE 'creator_social_accounts.user_id: FK -> auth.users added';
        END IF;
    END IF;

    -- creator_social_accounts.creator_id -> creators
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'creator_social_accounts_creator_id_fkey'
                     AND conrelid = 'public.creator_social_accounts'::regclass) THEN
        SELECT count(*) INTO v_orphans
        FROM   public.creator_social_accounts csa
        WHERE  csa.creator_id IS NOT NULL
          AND  NOT EXISTS (SELECT 1 FROM public.creators c WHERE c.id = csa.creator_id);
        IF v_orphans > 0 THEN
            RAISE NOTICE 'creator_social_accounts.creator_id: % orphan row(s) -- FK NOT added', v_orphans;
        ELSE
            ALTER TABLE public.creator_social_accounts
                ADD CONSTRAINT creator_social_accounts_creator_id_fkey
                FOREIGN KEY (creator_id) REFERENCES public.creators(id) ON DELETE SET NULL;
            RAISE NOTICE 'creator_social_accounts.creator_id: FK -> creators added';
        END IF;
    END IF;

    -- creator_videos.user_id -> auth.users
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'creator_videos_user_id_fkey'
                     AND conrelid = 'public.creator_videos'::regclass) THEN
        SELECT count(*) INTO v_orphans
        FROM   public.creator_videos cv
        WHERE  NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = cv.user_id);
        IF v_orphans > 0 THEN
            RAISE NOTICE 'creator_videos.user_id: % orphan row(s) -- FK NOT added', v_orphans;
        ELSE
            ALTER TABLE public.creator_videos
                ADD CONSTRAINT creator_videos_user_id_fkey
                FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
            RAISE NOTICE 'creator_videos.user_id: FK -> auth.users added';
        END IF;
    END IF;

    -- creator_videos.creator_id -> creators
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'creator_videos_creator_id_fkey'
                     AND conrelid = 'public.creator_videos'::regclass) THEN
        SELECT count(*) INTO v_orphans
        FROM   public.creator_videos cv
        WHERE  cv.creator_id IS NOT NULL
          AND  NOT EXISTS (SELECT 1 FROM public.creators c WHERE c.id = cv.creator_id);
        IF v_orphans > 0 THEN
            RAISE NOTICE 'creator_videos.creator_id: % orphan row(s) -- FK NOT added', v_orphans;
        ELSE
            ALTER TABLE public.creator_videos
                ADD CONSTRAINT creator_videos_creator_id_fkey
                FOREIGN KEY (creator_id) REFERENCES public.creators(id) ON DELETE SET NULL;
            RAISE NOTICE 'creator_videos.creator_id: FK -> creators added';
        END IF;
    END IF;

    -- creator_videos.social_account_id -> creator_social_accounts
    -- SET NULL, not CASCADE: disconnecting an account must not delete the
    -- creator's published-video history (api/integrations/tiktok/disconnect.js
    -- only nulls the tokens, it does not delete the account row).
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = 'public.creator_videos'::regclass
                     AND contype  = 'f'
                     AND conname LIKE '%social_account_id%') THEN
        SELECT count(*) INTO v_orphans
        FROM   public.creator_videos cv
        WHERE  cv.social_account_id IS NOT NULL
          AND  NOT EXISTS (SELECT 1 FROM public.creator_social_accounts a
                           WHERE a.id = cv.social_account_id);
        IF v_orphans > 0 THEN
            RAISE NOTICE 'creator_videos.social_account_id: % orphan row(s) -- FK NOT added', v_orphans;
        ELSE
            ALTER TABLE public.creator_videos
                ADD CONSTRAINT creator_videos_social_account_id_fkey
                FOREIGN KEY (social_account_id)
                REFERENCES public.creator_social_accounts(id) ON DELETE SET NULL;
            RAISE NOTICE 'creator_videos.social_account_id: FK -> creator_social_accounts added';
        END IF;
    END IF;

    -- video_metrics.video_id -> creator_videos
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = 'public.video_metrics'::regclass
                     AND contype  = 'f'
                     AND conname LIKE '%video_id%') THEN
        SELECT count(*) INTO v_orphans
        FROM   public.video_metrics vm
        WHERE  NOT EXISTS (SELECT 1 FROM public.creator_videos cv WHERE cv.id = vm.video_id);
        IF v_orphans > 0 THEN
            RAISE NOTICE 'video_metrics.video_id: % orphan row(s) -- FK NOT added', v_orphans;
        ELSE
            ALTER TABLE public.video_metrics
                ADD CONSTRAINT video_metrics_video_id_fkey
                FOREIGN KEY (video_id) REFERENCES public.creator_videos(id) ON DELETE CASCADE;
            RAISE NOTICE 'video_metrics.video_id: FK -> creator_videos added';
        END IF;
    END IF;

    -- video_metrics.user_id -> auth.users
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'video_metrics_user_id_fkey'
                     AND conrelid = 'public.video_metrics'::regclass) THEN
        SELECT count(*) INTO v_orphans
        FROM   public.video_metrics vm
        WHERE  NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = vm.user_id);
        IF v_orphans > 0 THEN
            RAISE NOTICE 'video_metrics.user_id: % orphan row(s) -- FK NOT added', v_orphans;
        ELSE
            ALTER TABLE public.video_metrics
                ADD CONSTRAINT video_metrics_user_id_fkey
                FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
            RAISE NOTICE 'video_metrics.user_id: FK -> auth.users added';
        END IF;
    END IF;
END
$$;

-- ---- 5d. Value CHECKs ------------------------------------------------------
-- Production already carries creator_social_accounts_platform_check and
-- creator_social_accounts_connection_status_check (confirmed by probing the
-- live table: it rejects platform='meta' and connection_status='needs_reauth').
-- These blocks reproduce them on a fresh database and are a no-op against
-- production.
--
-- The accepted values are exactly the ones the API writes:
--   platform          -- api/integrations/*, api/auth/*
--   connection_status -- callback.js 'connected', disconnect.js 'disconnected',
--                        status.js 'not_connected',
--                        _utils/tiktok.js 'reauth_required'
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'creator_social_accounts_platform_check'
                     AND conrelid = 'public.creator_social_accounts'::regclass)
       AND NOT EXISTS (SELECT 1 FROM public.creator_social_accounts
                       WHERE platform NOT IN ('tiktok','instagram','facebook','youtube'))
    THEN
        ALTER TABLE public.creator_social_accounts
            ADD CONSTRAINT creator_social_accounts_platform_check
            CHECK (platform IN ('tiktok','instagram','facebook','youtube'));
        RAISE NOTICE 'creator_social_accounts: added platform CHECK';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'creator_social_accounts_connection_status_check'
                     AND conrelid = 'public.creator_social_accounts'::regclass)
       AND NOT EXISTS (SELECT 1 FROM public.creator_social_accounts
                       WHERE connection_status NOT IN
                             ('not_connected','connected','disconnected','reauth_required'))
    THEN
        ALTER TABLE public.creator_social_accounts
            ADD CONSTRAINT creator_social_accounts_connection_status_check
            CHECK (connection_status IN
                   ('not_connected','connected','disconnected','reauth_required'));
        RAISE NOTICE 'creator_social_accounts: added connection_status CHECK';
    END IF;
END
$$;


-- ============================================================================
-- SECTION 6 — indexes and updated_at triggers
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_creator_social_accounts_user_id
    ON public.creator_social_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_creator_social_accounts_creator_id
    ON public.creator_social_accounts(creator_id);
CREATE INDEX IF NOT EXISTS idx_creator_social_accounts_status
    ON public.creator_social_accounts(connection_status);
-- The cron token-refresh job scans for accounts whose token is about to expire.
CREATE INDEX IF NOT EXISTS idx_creator_social_accounts_token_expiry
    ON public.creator_social_accounts(token_expires_at)
    WHERE token_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_creator_videos_user_id
    ON public.creator_videos(user_id);
CREATE INDEX IF NOT EXISTS idx_creator_videos_creator_id
    ON public.creator_videos(creator_id);
CREATE INDEX IF NOT EXISTS idx_creator_videos_social_account_id
    ON public.creator_videos(social_account_id);
CREATE INDEX IF NOT EXISTS idx_creator_videos_posted_at
    ON public.creator_videos(posted_at DESC);

CREATE INDEX IF NOT EXISTS idx_video_metrics_video_id
    ON public.video_metrics(video_id);
CREATE INDEX IF NOT EXISTS idx_video_metrics_user_id
    ON public.video_metrics(user_id);
-- Trend queries read the newest snapshot per video.
CREATE INDEX IF NOT EXISTS idx_video_metrics_video_snapshot
    ON public.video_metrics(video_id, snapshot_at DESC);

DROP TRIGGER IF EXISTS trg_creator_social_accounts_updated_at ON public.creator_social_accounts;
CREATE TRIGGER trg_creator_social_accounts_updated_at
    BEFORE UPDATE ON public.creator_social_accounts
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_creator_videos_updated_at ON public.creator_videos;
CREATE TRIGGER trg_creator_videos_updated_at
    BEFORE UPDATE ON public.creator_videos
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- video_metrics has no updated_at: it is append-only by design.


-- ============================================================================
-- SECTION 7 — the safe view, and the grants that make it the only browser path
--
-- READ THIS BEFORE ADDING A BROWSER QUERY AGAINST creator_social_accounts.
--
--   anon has no access to the base table at all.
--   authenticated has NO SELECT on access_token_encrypted /
--   refresh_token_encrypted, which means `select=*` from the browser fails with
--   "permission denied for column". That is deliberate. Query
--   public.creator_social_accounts_safe instead -- it carries every other
--   column and is security_invoker, so the RLS policies in SECTION 9 still
--   apply row by row.
--
--   Server code (api/integrations/tiktok/*, api/cron/*) uses the service-role
--   key, which bypasses RLS and these grants entirely. Nothing there changes.
-- ============================================================================

DROP VIEW IF EXISTS public.creator_social_accounts_safe;

CREATE VIEW public.creator_social_accounts_safe
WITH (security_invoker = true)
AS
SELECT
    csa.id,
    csa.user_id,
    csa.creator_id,
    csa.workspace_id,
    csa.platform,
    csa.platform_user_id,
    csa.username,
    csa.display_name,
    csa.profile_image_url,
    csa.token_expires_at,
    csa.refresh_token_expires_at,
    csa.scopes,
    csa.connection_status,
    csa.last_synced_at,
    csa.last_error,
    csa.metadata,
    csa.created_at,
    csa.updated_at
FROM public.creator_social_accounts csa;

COMMENT ON VIEW public.creator_social_accounts_safe IS
    'creator_social_accounts without access_token_encrypted / '
    'refresh_token_encrypted. This is the only connection-state read the '
    'browser is permitted to make; the base table revokes those two columns '
    'from authenticated and revokes everything from anon.';

-- anon must never touch these tables.
REVOKE ALL ON public.creator_social_accounts FROM anon;
REVOKE ALL ON public.creator_videos          FROM anon;
REVOKE ALL ON public.video_metrics           FROM anon;

-- authenticated: table-level SELECT off, then column-level SELECT back on for
-- everything except the two token columns. Writes stay table-level because RLS
-- (SECTION 9) already confines them to the caller's own rows, and because the
-- OAuth write path is service-role anyway.
REVOKE SELECT ON public.creator_social_accounts FROM authenticated;
GRANT  SELECT (
    id, user_id, creator_id, workspace_id, platform, platform_user_id,
    username, display_name, profile_image_url, token_expires_at,
    refresh_token_expires_at, scopes, connection_status, last_synced_at,
    last_error, metadata, created_at, updated_at
) ON public.creator_social_accounts TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.creator_social_accounts TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.creator_videos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_metrics  TO authenticated;

GRANT SELECT ON public.creator_social_accounts_safe TO authenticated;

-- ---- creator_connection_status ---------------------------------------------
-- Also live in production and in no migration. Created only when absent so a
-- differing live definition is never clobbered (CREATE OR REPLACE VIEW cannot
-- reorder or rename columns and would fail outright).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'creator_connection_status'
    ) THEN
        EXECUTE $v$
            CREATE VIEW public.creator_connection_status
            WITH (security_invoker = true) AS
            SELECT csa.id,
                   csa.user_id,
                   csa.platform,
                   csa.platform_user_id,
                   csa.username                 AS platform_username,
                   csa.connection_status        AS status,
                   csa.token_expires_at         AS expires_at,
                   csa.refresh_token_expires_at AS refresh_expires_at,
                   csa.last_synced_at,
                   csa.last_error,
                   csa.created_at,
                   csa.updated_at
            FROM public.creator_social_accounts csa
        $v$;
        EXECUTE 'GRANT SELECT ON public.creator_connection_status TO authenticated';
        RAISE NOTICE 'creator_connection_status view created';
    ELSE
        RAISE NOTICE 'creator_connection_status already exists -- left untouched';
    END IF;
END
$$;


-- ============================================================================
-- SECTION 8 — enable RLS
-- ============================================================================

ALTER TABLE public.creator_social_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_videos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_metrics           ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- SECTION 9 — RLS policies
--
--   creator          reads and writes only rows where user_id = auth.uid()
--   owner            reads and writes everything
--   payment manager  (active, can_view_payouts) reads everything
--   am               reads only the accounts of creators assigned to them
--   client           has no policy at all, and therefore reads nothing
--
-- The AM link is (creators.user_id = <table>.user_id) OR (creators.id =
-- <table>.creator_id): production populates user_id on every row and leaves
-- creator_id NULL, but both linkages are legal and the policy must not depend
-- on which one a given row happens to use.
--
-- current_user_role() comes from 20260521000000_omnya_hardening.sql and
-- is_payment_manager() from 20260530000000_payout_system.sql; both sort before
-- this file, so a fresh apply in filename order has them.
-- ============================================================================

-- ---- creator_social_accounts ----------------------------------------------
DROP POLICY IF EXISTS creator_social_accounts_select_self      ON public.creator_social_accounts;
DROP POLICY IF EXISTS creator_social_accounts_select_owner_pm  ON public.creator_social_accounts;
DROP POLICY IF EXISTS creator_social_accounts_select_am        ON public.creator_social_accounts;
DROP POLICY IF EXISTS creator_social_accounts_insert_self      ON public.creator_social_accounts;
DROP POLICY IF EXISTS creator_social_accounts_update_self      ON public.creator_social_accounts;
DROP POLICY IF EXISTS creator_social_accounts_delete_self      ON public.creator_social_accounts;

CREATE POLICY creator_social_accounts_select_self ON public.creator_social_accounts
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY creator_social_accounts_select_owner_pm ON public.creator_social_accounts
    FOR SELECT TO authenticated
    USING (
        public.current_user_role() = 'owner'
        OR public.is_payment_manager('can_view_payouts')
    );

CREATE POLICY creator_social_accounts_select_am ON public.creator_social_accounts
    FOR SELECT TO authenticated
    USING (
        public.current_user_role() = 'am'
        AND EXISTS (
            SELECT 1
            FROM   public.creators c
            JOIN   public.account_managers am ON am.id = c.am_id
            WHERE  am.user_id = auth.uid()
              AND  (c.user_id = creator_social_accounts.user_id
                    OR c.id   = creator_social_accounts.creator_id)
        )
    );

CREATE POLICY creator_social_accounts_insert_self ON public.creator_social_accounts
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid() OR public.current_user_role() = 'owner');

CREATE POLICY creator_social_accounts_update_self ON public.creator_social_accounts
    FOR UPDATE TO authenticated
    USING      (user_id = auth.uid() OR public.current_user_role() = 'owner')
    WITH CHECK (user_id = auth.uid() OR public.current_user_role() = 'owner');

CREATE POLICY creator_social_accounts_delete_self ON public.creator_social_accounts
    FOR DELETE TO authenticated
    USING (user_id = auth.uid() OR public.current_user_role() = 'owner');

-- ---- creator_videos --------------------------------------------------------
DROP POLICY IF EXISTS creator_videos_select_self     ON public.creator_videos;
DROP POLICY IF EXISTS creator_videos_select_owner_pm ON public.creator_videos;
DROP POLICY IF EXISTS creator_videos_select_am       ON public.creator_videos;
DROP POLICY IF EXISTS creator_videos_insert_self     ON public.creator_videos;
DROP POLICY IF EXISTS creator_videos_update_self     ON public.creator_videos;
DROP POLICY IF EXISTS creator_videos_delete_self     ON public.creator_videos;

CREATE POLICY creator_videos_select_self ON public.creator_videos
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY creator_videos_select_owner_pm ON public.creator_videos
    FOR SELECT TO authenticated
    USING (
        public.current_user_role() = 'owner'
        OR public.is_payment_manager('can_view_payouts')
    );

CREATE POLICY creator_videos_select_am ON public.creator_videos
    FOR SELECT TO authenticated
    USING (
        public.current_user_role() = 'am'
        AND EXISTS (
            SELECT 1
            FROM   public.creators c
            JOIN   public.account_managers am ON am.id = c.am_id
            WHERE  am.user_id = auth.uid()
              AND  (c.user_id = creator_videos.user_id
                    OR c.id   = creator_videos.creator_id)
        )
    );

CREATE POLICY creator_videos_insert_self ON public.creator_videos
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid() OR public.current_user_role() = 'owner');

CREATE POLICY creator_videos_update_self ON public.creator_videos
    FOR UPDATE TO authenticated
    USING      (user_id = auth.uid() OR public.current_user_role() = 'owner')
    WITH CHECK (user_id = auth.uid() OR public.current_user_role() = 'owner');

CREATE POLICY creator_videos_delete_self ON public.creator_videos
    FOR DELETE TO authenticated
    USING (user_id = auth.uid() OR public.current_user_role() = 'owner');

-- ---- video_metrics ---------------------------------------------------------
-- Append-only from the app's point of view: no UPDATE or DELETE policy exists
-- for authenticated at all, so a snapshot cannot be rewritten from the browser.
DROP POLICY IF EXISTS video_metrics_select_self     ON public.video_metrics;
DROP POLICY IF EXISTS video_metrics_select_owner_pm ON public.video_metrics;
DROP POLICY IF EXISTS video_metrics_select_am       ON public.video_metrics;
DROP POLICY IF EXISTS video_metrics_insert_self     ON public.video_metrics;

CREATE POLICY video_metrics_select_self ON public.video_metrics
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY video_metrics_select_owner_pm ON public.video_metrics
    FOR SELECT TO authenticated
    USING (
        public.current_user_role() = 'owner'
        OR public.is_payment_manager('can_view_payouts')
    );

CREATE POLICY video_metrics_select_am ON public.video_metrics
    FOR SELECT TO authenticated
    USING (
        public.current_user_role() = 'am'
        AND EXISTS (
            SELECT 1
            FROM   public.creators c
            JOIN   public.account_managers am ON am.id = c.am_id
            WHERE  am.user_id = auth.uid()
              AND  c.user_id  = video_metrics.user_id
        )
    );

CREATE POLICY video_metrics_insert_self ON public.video_metrics
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid() OR public.current_user_role() = 'owner');

COMMIT;
