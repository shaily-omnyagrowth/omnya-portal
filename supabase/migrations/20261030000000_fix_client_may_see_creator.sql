-- ============================================================================
-- 20261030000000_fix_client_may_see_creator.sql
--
-- Every client read that touches creators fails with
--
--     column s.final_status does not exist
--
-- client_may_see_creator() (20260822000005) filters on submissions.final_status,
-- which 20260826000000 dropped. The creators RLS policy calls it, so the client
-- portal loads no submissions, creators or analytics. Confirmed on the live
-- database 2026-10-29.
--
-- Fix: the same check on `status`, matching client_safe_submissions.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.client_may_see_creator(p_creator_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
    SELECT EXISTS (
      SELECT 1
      FROM   public.submissions s
      JOIN   public.campaigns   ca ON ca.id = s.campaign_id
      JOIN   public.clients     cl ON cl.id = ca.client_id
      WHERE  s.creator_id = p_creator_id
        AND  cl.user_id   = auth.uid()
        AND  s.status     = 'Approved'
    );
$$;

REVOKE ALL  ON FUNCTION public.client_may_see_creator(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_may_see_creator(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.client_may_see_creator(UUID) TO service_role;

COMMIT;
