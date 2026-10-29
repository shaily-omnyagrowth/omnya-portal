-- ROLLBACK for 20261030000000_fix_client_may_see_creator.sql
--
-- Manual only. Never move this file into supabase/migrations/.
--
-- Restores the 20260822000005 body, which reads final_status. With
-- 20260826000000 applied (that column dropped) this breaks every client read
-- of creators again, so only run it after undoing 20260826000000.
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
      WHERE  s.creator_id   = p_creator_id
        AND  cl.user_id     = auth.uid()
        AND  s.final_status = 'Approved'
    );
$$;

COMMIT;
