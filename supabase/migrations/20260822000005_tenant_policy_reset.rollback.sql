-- ============================================================================
-- ROLLBACK: 20260822000005_tenant_policy_reset.sql   (N-10)
-- ============================================================================
--
-- Restores the policy set as the repository defined it before the reset --
-- which means restoring the unscoped staff clause, and with it the
-- cross-tenant read. Run this only to unblock a production incident, and
-- treat N-10 as reopened the moment you do.
--
-- The likelier cause of needing this is not the fix itself but a role losing
-- access it should have kept. Before rolling back the whole thing, check:
--
--   SELECT tablename, policyname, roles, cmd
--   FROM   pg_policies
--   WHERE  schemaname = 'public'
--     AND  tablename IN ('creators','clients','campaigns','submissions','video_analytics')
--   ORDER  BY tablename, policyname;
--
-- Adding one missing policy back is almost always better than reopening the
-- tenant boundary for everyone.
--
-- NOTE: this restores what the MIGRATIONS defined. Any policy that existed
-- only in production and was dropped by SECTION 1 of the forward migration is
-- not restored here, because its definition was never recorded anywhere. The
-- forward migration's NOTICE output is the only record of those names -- keep
-- the apply log.
-- ============================================================================

BEGIN;

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT schemaname, tablename, policyname
        FROM   pg_policies
        WHERE  schemaname = 'public'
          AND  tablename IN ('creators','clients','campaigns','submissions','video_analytics')
    LOOP
        EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    END LOOP;
END;
$$;

-- ---- creators (unchanged by the forward migration) -------------------------

CREATE POLICY creators_select_scoped ON public.creators
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.current_user_role() = 'owner'
    OR (public.current_user_role() = 'am' AND EXISTS (
          SELECT 1 FROM public.account_managers am
          WHERE am.id = creators.am_id AND am.user_id = auth.uid()))
  );

CREATE POLICY client_select_creators_on_own_campaigns ON public.creators
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'client'
    AND EXISTS (
      SELECT 1 FROM public.submissions s
      JOIN public.campaigns ca ON ca.id = s.campaign_id
      JOIN public.clients   cl ON cl.id = ca.client_id
      WHERE s.creator_id = creators.id AND cl.user_id = auth.uid()
        AND s.final_status = 'Approved')
  );

CREATE POLICY creators_insert_self_or_staff ON public.creators
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.current_user_role() IN ('owner','am'));

CREATE POLICY creators_update_scoped ON public.creators
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.current_user_role() = 'owner'
    OR (public.current_user_role() = 'am' AND EXISTS (
          SELECT 1 FROM public.account_managers am
          WHERE am.id = creators.am_id AND am.user_id = auth.uid()))
  )
  WITH CHECK (public.current_user_role() IN ('owner','am') OR user_id = auth.uid());

CREATE POLICY creators_delete_owner ON public.creators
  FOR DELETE TO authenticated
  USING (public.current_user_role() = 'owner');

-- ---- clients ---------------------------------------------------------------

CREATE POLICY clients_select_scoped ON public.clients
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'owner'
    OR (public.current_user_role() = 'am' AND EXISTS (
          SELECT 1 FROM public.account_managers am
          WHERE am.id = clients.am_id AND am.user_id = auth.uid()))
  );

-- REOPENS N-10: the staff clause has no row test.
CREATE POLICY client_select_own_profile ON public.clients
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM public.user_profiles
               WHERE id = auth.uid() AND role IN ('owner','am','account_manager'))
  );

CREATE POLICY clients_modify_owner_or_assigned_am ON public.clients
  FOR ALL TO authenticated
  USING (
    public.current_user_role() = 'owner'
    OR (public.current_user_role() = 'am' AND EXISTS (
          SELECT 1 FROM public.account_managers am
          WHERE am.id = clients.am_id AND am.user_id = auth.uid()))
  )
  WITH CHECK (
    public.current_user_role() = 'owner'
    OR (public.current_user_role() = 'am' AND EXISTS (
          SELECT 1 FROM public.account_managers am
          WHERE am.id = clients.am_id AND am.user_id = auth.uid()))
  );

-- ---- campaigns -------------------------------------------------------------

CREATE POLICY campaigns_select_scoped ON public.campaigns
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'owner'
    OR (public.current_user_role() = 'am' AND EXISTS (
          SELECT 1 FROM public.clients cl
          JOIN public.account_managers am ON cl.am_id = am.id
          WHERE cl.id = campaigns.client_id AND am.user_id = auth.uid()))
    OR (public.current_user_role() = 'creator' AND EXISTS (
          SELECT 1 FROM public.creators c
          WHERE c.user_id = auth.uid() AND c.id = ANY (campaigns.assigned_creators)))
  );

-- REOPENS N-10.
CREATE POLICY client_select_own_campaigns ON public.campaigns
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.clients
            WHERE public.clients.user_id = auth.uid()
              AND public.clients.id = campaigns.client_id)
    OR EXISTS (SELECT 1 FROM public.user_profiles
               WHERE id = auth.uid() AND role IN ('owner','am','account_manager'))
  );

CREATE POLICY campaigns_modify_owner_or_am ON public.campaigns
  FOR ALL TO authenticated
  USING (
    public.current_user_role() = 'owner'
    OR (public.current_user_role() = 'am' AND EXISTS (
          SELECT 1 FROM public.clients cl
          JOIN public.account_managers am ON cl.am_id = am.id
          WHERE cl.id = campaigns.client_id AND am.user_id = auth.uid()))
  )
  WITH CHECK (
    public.current_user_role() = 'owner'
    OR (public.current_user_role() = 'am' AND EXISTS (
          SELECT 1 FROM public.clients cl
          JOIN public.account_managers am ON cl.am_id = am.id
          WHERE cl.id = campaigns.client_id AND am.user_id = auth.uid()))
  );

-- ---- submissions -----------------------------------------------------------

CREATE POLICY submissions_select_scoped ON public.submissions
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'owner'
    OR EXISTS (SELECT 1 FROM public.creators c
               WHERE c.id = submissions.creator_id AND c.user_id = auth.uid())
    OR (public.current_user_role() = 'am' AND EXISTS (
          SELECT 1 FROM public.creators c
          JOIN public.account_managers am ON c.am_id = am.id
          WHERE c.id = submissions.creator_id AND am.user_id = auth.uid()))
  );

-- REOPENS N-10.
CREATE POLICY client_select_own_submissions ON public.submissions
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.campaigns c
            JOIN public.clients cl ON c.client_id = cl.id
            WHERE cl.user_id = auth.uid() AND c.id = submissions.campaign_id)
    OR EXISTS (SELECT 1 FROM public.user_profiles
               WHERE id = auth.uid() AND role IN ('owner','am','account_manager'))
  );

CREATE POLICY submissions_insert_scoped ON public.submissions
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() = 'owner'
    OR EXISTS (SELECT 1 FROM public.creators c
               WHERE c.id = submissions.creator_id AND c.user_id = auth.uid())
    OR (public.current_user_role() = 'am' AND EXISTS (
          SELECT 1 FROM public.creators c
          JOIN public.account_managers am ON c.am_id = am.id
          WHERE c.id = submissions.creator_id AND am.user_id = auth.uid()))
  );

CREATE POLICY submissions_update_scoped ON public.submissions
  FOR UPDATE TO authenticated
  USING (
    public.current_user_role() = 'owner'
    OR EXISTS (SELECT 1 FROM public.creators c
               WHERE c.id = submissions.creator_id AND c.user_id = auth.uid())
    OR (public.current_user_role() = 'am' AND EXISTS (
          SELECT 1 FROM public.creators c
          JOIN public.account_managers am ON c.am_id = am.id
          WHERE c.id = submissions.creator_id AND am.user_id = auth.uid()))
  )
  WITH CHECK (
    public.current_user_role() = 'owner'
    OR EXISTS (SELECT 1 FROM public.creators c
               WHERE c.id = submissions.creator_id AND c.user_id = auth.uid())
    OR (public.current_user_role() = 'am' AND EXISTS (
          SELECT 1 FROM public.creators c
          JOIN public.account_managers am ON c.am_id = am.id
          WHERE c.id = submissions.creator_id AND am.user_id = auth.uid()))
  );

CREATE POLICY submissions_delete_owner ON public.submissions
  FOR DELETE TO authenticated
  USING (public.current_user_role() = 'owner');

DO $$
BEGIN
    RAISE WARNING
        'N-10 ROLLED BACK: an account manager can once again read every tenant''s clients, campaigns and submissions.';
END;
$$;

COMMIT;
