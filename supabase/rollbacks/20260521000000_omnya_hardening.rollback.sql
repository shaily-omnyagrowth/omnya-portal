-- =============================================================================
-- Omnya Portal — Rollback for 20260521000000_omnya_hardening.sql
-- =============================================================================
--
-- Restores the pre-hardening state of policies + drops the helper function +
-- drops the indexes that were added.
--
-- DOES NOT DROP COLUMNS or undo the creator_tokens backfill. That is
-- intentional: those changes are additive and reverting them would risk
-- data loss. If you need a column gone, do it in a separate explicit
-- migration with a known-safe DROP plan.
--
-- Apply with the same caveats as the forward migration: STAGING FIRST.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Drop the new role-scoped policies on every protected table.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'user_profiles','creators','account_managers','clients','campaigns',
        'submissions','payments','messages','creator_tokens','video_analytics',
        'payout_batches','payout_line_items'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Recreate the legacy "Allow all" policies so the app keeps working in
--    permissive mode after rollback. (This is the original — and unsafe —
--    behavior. Only intended for emergency rollback, never long-term.)
-- -----------------------------------------------------------------------------
CREATE POLICY "Allow all" ON public.user_profiles     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON public.creators          FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON public.account_managers  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON public.clients           FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON public.campaigns         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON public.submissions       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON public.payments          FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON public.messages          FOR ALL USING (true) WITH CHECK (true);

-- Restore the two narrower legacy policies that existed on the side files.
CREATE POLICY "Allow owners to see their own tokens"
  ON public.creator_tokens FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.creators
      WHERE creators.id = creator_tokens.creator_id
        AND creators.user_id = auth.uid()
    )
  );

CREATE POLICY "Allow owners to see their own analytics"
  ON public.video_analytics FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.creators
      WHERE creators.id = video_analytics.creator_id
        AND creators.user_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- 3. Drop the indexes added by the forward migration.
-- -----------------------------------------------------------------------------
DROP INDEX IF EXISTS public.idx_submissions_creator_id;
DROP INDEX IF EXISTS public.idx_submissions_campaign_id;
DROP INDEX IF EXISTS public.idx_submissions_payout_batch_id;
DROP INDEX IF EXISTS public.idx_payments_creator_id;
DROP INDEX IF EXISTS public.idx_payments_batch_id;
DROP INDEX IF EXISTS public.idx_payments_status;
DROP INDEX IF EXISTS public.idx_video_analytics_creator_id;
DROP INDEX IF EXISTS public.idx_video_analytics_submission_id;
DROP INDEX IF EXISTS public.idx_video_analytics_campaign_id;
DROP INDEX IF EXISTS public.idx_creator_tokens_user_id;
DROP INDEX IF EXISTS public.idx_creator_tokens_creator_id;
DROP INDEX IF EXISTS public.idx_creators_am_id;
DROP INDEX IF EXISTS public.idx_clients_am_id;
DROP INDEX IF EXISTS public.idx_campaigns_client_id;
DROP INDEX IF EXISTS public.idx_messages_campaign_id;
DROP INDEX IF EXISTS public.idx_payout_batches_period;

-- -----------------------------------------------------------------------------
-- 4. Drop the unique constraint on creator_tokens(user_id, platform).
-- -----------------------------------------------------------------------------
ALTER TABLE public.creator_tokens
  DROP CONSTRAINT IF EXISTS creator_tokens_user_id_platform_key;

-- -----------------------------------------------------------------------------
-- 5. Drop the helper function.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.current_user_role();

-- -----------------------------------------------------------------------------
-- NOT DROPPED (preserved for data safety):
--   * payments.batch_id
--   * payout_batches.period_type
--   * creators.payout_email, payout_preference
--   * creator_tokens added columns (user_id, account_id, etc.)
--   * Backfill of creator_tokens.user_id from creators.user_id
--
-- If you absolutely must remove these, write a follow-up migration and verify
-- no production rows depend on them first.
-- -----------------------------------------------------------------------------

COMMIT;
