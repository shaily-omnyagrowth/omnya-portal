-- Account managers may only insert a pending payment, at the campaign rate, on a campaign they own.
-- contract: payments_modify_owner_or_am let any manager write any payment; owners and payment managers keep their own policies.

BEGIN;

DROP POLICY IF EXISTS payments_modify_owner_or_am ON public.payments;
DROP POLICY IF EXISTS payments_am_approval_insert ON public.payments;
DROP POLICY IF EXISTS payments_am_insert_own_campaign ON public.payments;

CREATE POLICY payments_am_insert_own_campaign ON public.payments FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() = 'am'
    AND status = 'pending'
    AND public.am_owns_campaign(campaign_id)
    AND EXISTS (
      SELECT 1 FROM public.campaigns ca
      WHERE ca.id = payments.campaign_id
        AND COALESCE(payments.amount_owed, 0) <= COALESCE(ca.pay_per_video, 0) * GREATEST(COALESCE(payments.videos_approved, 1), 1)
    )
  );

COMMIT;
