-- ============================================================================
-- 20260821000001_client_creator_visibility.sql
--
-- Fixes audit finding N-09 / feature F-6: the client Delivered Content gallery
-- and Video Insights pages are permanently empty for every client.
--
-- Why they are empty:
--   client_safe_submissions and client_safe_analytics are declared
--   security_invoker = true and inner-join public.creators. Clients have no
--   RLS policy on creators, so that table yields zero rows for them and the
--   inner join annihilates every result -- even when the client can read the
--   underlying campaign and submission perfectly well.
--
--   Verified against production: a client with an Approved submission on their
--   own campaign could read campaigns (1 row) and submissions (1 row) but
--   creators (0 rows), and both views returned 0.
--
-- The fix grants clients a deliberately narrow read on creators: only creators
-- who have an approved submission on one of that client's own campaigns, and
-- only through the view, which already projects just the creator's name.
-- Contact details, rates and payout fields stay unreachable because the views
-- never select them and no other client policy exists on the table.
--
-- Idempotent: safe to re-run.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS client_select_creators_on_own_campaigns ON public.creators;

CREATE POLICY client_select_creators_on_own_campaigns ON public.creators
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'client'
    AND EXISTS (
      SELECT 1
      FROM   public.submissions s
      JOIN   public.campaigns   ca ON ca.id = s.campaign_id
      JOIN   public.clients     cl ON cl.id = ca.client_id
      WHERE  s.creator_id   = creators.id
        AND  cl.user_id     = auth.uid()
        AND  s.final_status = 'Approved'
    )
  );

COMMENT ON POLICY client_select_creators_on_own_campaigns ON public.creators IS
  'Lets a client resolve the creator name behind work already delivered to them. '
  'Scoped to approved submissions on campaigns belonging to that client. '
  'Required for client_safe_submissions / client_safe_analytics to return rows.';

COMMIT;
