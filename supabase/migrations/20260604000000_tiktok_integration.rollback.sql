-- ============================================================================
-- ROLLBACK: 20260604000000_tiktok_integration.sql
-- ============================================================================
--
-- WHAT THIS UNDOES
--   * the RLS policies added by SECTION 9
--   * the column-level grant split on creator_social_accounts (SECTION 7)
--   * the creator_social_accounts_safe view
--   * the indexes and updated_at triggers added by SECTION 6
--
-- WHAT THIS DELIBERATELY DOES NOT UNDO
--   * THE THREE TABLES ARE NOT DROPPED. They hold live production data --
--     connected accounts, published videos and every metric snapshot ever
--     pulled. The forward migration only ever ran CREATE TABLE IF NOT EXISTS
--     against them, so it created nothing in production and there is nothing
--     to remove. Dropping them here would destroy data the migration never
--     touched.
--   * The FKs and CHECK constraints stay. They are correctness constraints on
--     data that already satisfies them; removing them cannot fix an incident.
--     If one genuinely blocks you, drop that single constraint by name.
--   * creator_connection_status stays. The forward migration only creates it
--     when absent and never modifies an existing one.
--
-- AFTER THIS RUNS, RLS IS STILL ENABLED ON ALL THREE TABLES WITH NO POLICIES,
-- which means `authenticated` reads ZERO rows. That is the safe direction, but
-- it is not the pre-migration state -- production had RLS on these tables with
-- policies we cannot name. If you need the browser to read them again while
-- you investigate, re-apply the forward migration rather than hand-writing a
-- permissive policy.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Policies
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS creator_social_accounts_select_self     ON public.creator_social_accounts;
DROP POLICY IF EXISTS creator_social_accounts_select_owner_pm ON public.creator_social_accounts;
DROP POLICY IF EXISTS creator_social_accounts_select_am       ON public.creator_social_accounts;
DROP POLICY IF EXISTS creator_social_accounts_insert_self     ON public.creator_social_accounts;
DROP POLICY IF EXISTS creator_social_accounts_update_self     ON public.creator_social_accounts;
DROP POLICY IF EXISTS creator_social_accounts_delete_self     ON public.creator_social_accounts;

DROP POLICY IF EXISTS creator_videos_select_self     ON public.creator_videos;
DROP POLICY IF EXISTS creator_videos_select_owner_pm ON public.creator_videos;
DROP POLICY IF EXISTS creator_videos_select_am       ON public.creator_videos;
DROP POLICY IF EXISTS creator_videos_insert_self     ON public.creator_videos;
DROP POLICY IF EXISTS creator_videos_update_self     ON public.creator_videos;
DROP POLICY IF EXISTS creator_videos_delete_self     ON public.creator_videos;

DROP POLICY IF EXISTS video_metrics_select_self     ON public.video_metrics;
DROP POLICY IF EXISTS video_metrics_select_owner_pm ON public.video_metrics;
DROP POLICY IF EXISTS video_metrics_select_am       ON public.video_metrics;
DROP POLICY IF EXISTS video_metrics_insert_self     ON public.video_metrics;

-- ----------------------------------------------------------------------------
-- 2. The safe view
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.creator_social_accounts_safe;

-- ----------------------------------------------------------------------------
-- 3. Restore the flat table-level grants
--
-- This RE-EXPOSES access_token_encrypted / refresh_token_encrypted to any
-- authenticated caller whose RLS policy lets them see the row. With section 1
-- above having removed every policy, no rows are visible -- but if you later
-- add a policy, the tokens come back with it. Do not leave the database in
-- this state.
-- ----------------------------------------------------------------------------
REVOKE SELECT (
    id, user_id, creator_id, workspace_id, platform, platform_user_id,
    username, display_name, profile_image_url, token_expires_at,
    refresh_token_expires_at, scopes, connection_status, last_synced_at,
    last_error, metadata, created_at, updated_at
) ON public.creator_social_accounts FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.creator_social_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.creator_social_accounts TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.creator_videos          TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_metrics           TO anon;

-- ----------------------------------------------------------------------------
-- 4. Triggers and indexes
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_creator_social_accounts_updated_at ON public.creator_social_accounts;
DROP TRIGGER IF EXISTS trg_creator_videos_updated_at          ON public.creator_videos;

DROP INDEX IF EXISTS public.idx_creator_social_accounts_user_id;
DROP INDEX IF EXISTS public.idx_creator_social_accounts_creator_id;
DROP INDEX IF EXISTS public.idx_creator_social_accounts_status;
DROP INDEX IF EXISTS public.idx_creator_social_accounts_token_expiry;
DROP INDEX IF EXISTS public.idx_creator_videos_user_id;
DROP INDEX IF EXISTS public.idx_creator_videos_creator_id;
DROP INDEX IF EXISTS public.idx_creator_videos_social_account_id;
DROP INDEX IF EXISTS public.idx_creator_videos_posted_at;
DROP INDEX IF EXISTS public.idx_video_metrics_video_id;
DROP INDEX IF EXISTS public.idx_video_metrics_user_id;
DROP INDEX IF EXISTS public.idx_video_metrics_video_snapshot;

-- public.set_updated_at() is NOT dropped: it is owned by
-- 20260530000000_payout_system.sql and five other triggers depend on it.

COMMIT;
