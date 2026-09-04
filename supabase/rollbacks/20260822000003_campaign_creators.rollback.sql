-- ============================================================================
-- ROLLBACK: 20260822000003_campaign_creators.sql
-- ============================================================================
--
-- Returns campaigns.assigned_creators to being a plain, unmanaged uuid[] and
-- removes the junction table.
--
-- ORDER MATTERS: the triggers come off FIRST. Dropping campaign_creators while
-- trg_campaign_creators_sync_array is still attached would fire the mirror for
-- every row and rewrite every campaign's array to '{}' on the way out.
--
-- WHAT IS LOST
--   * The assignment history (assigned_at / assigned_by). The array never had
--     it, so rolling back throws it away. If you may want it later, copy
--     public.campaign_creators to a scratch table before running this.
--   * Referential integrity. After this runs, deleting a creator once again
--     leaves their id in every campaign array forever. That is F-10, restored.
--
-- WHAT IS KEPT
--   * The contents of campaigns.assigned_creators as they stand right now,
--     which is the de-duplicated, dangling-id-free version the forward
--     migration produced. The rollback does NOT reinstate the dangling ids the
--     backfill dropped -- they named creators that do not exist and putting
--     them back would be vandalism, not a rollback.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Detach both mirror directions before anything else.
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_campaign_creators_sync_array ON public.campaign_creators;
DROP TRIGGER IF EXISTS trg_campaigns_sync_cc_insert     ON public.campaigns;
DROP TRIGGER IF EXISTS trg_campaigns_sync_cc_update     ON public.campaigns;

-- ----------------------------------------------------------------------------
-- 2. Policies, then the table.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS campaign_creators_select_scoped   ON public.campaign_creators;
DROP POLICY IF EXISTS campaign_creators_modify_owner_am ON public.campaign_creators;

DROP TABLE IF EXISTS public.campaign_creators;

-- ----------------------------------------------------------------------------
-- 3. Helper functions.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.campaign_creators_sync_array();
DROP FUNCTION IF EXISTS public.campaigns_sync_campaign_creators();
DROP FUNCTION IF EXISTS public.cc_sync_in_progress();

COMMIT;
