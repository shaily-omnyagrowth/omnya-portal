-- 20260918000000_creator_portal_fixes.sql
--
-- Schema + RLS for the creator-portal punch list.
--
--   1. campaigns          sales_commission_rate, manager_commission_rate,
--                         show_client_cpm  (+ owner-only guard on the rates)
--   2. campaign_creators  status / commitment / demo_video_url, and the two
--                         mirror triggers taught that only APPROVED rows are
--                         assignments
--   3. creators           score_override / tier_override (+ staff-only guard)
--   4. RLS                managers review submissions on their clients'
--                         campaigns; creators may apply, and only apply
--   5. RPCs               list_unassigned_creators / claim_creator / release_creator, so a
--                         manager can pick creators without being handed the
--                         payout details of everyone who is unassigned
--   6. client_safe_campaigns  exposes show_client_cpm (and nothing about cost)
--
-- Idempotent: safe to run twice. Everything is in one transaction, so a
-- failure leaves the database exactly as it was.
--
-- APPLY THIS BEFORE DEPLOYING THE MATCHING FRONTEND. The UI writes the new
-- columns; against the old schema those writes fail with PGRST204.

BEGIN;

-- ============================================================================
-- 1. campaigns — commission rates and the client CPM switch
-- ============================================================================
--
-- sales_commission_rate is the rate that applies WHEN is_sales_sourced is true.
-- It is deliberately not zeroed when the flag is off, so unticking and
-- re-ticking "sales sourced" does not lose which sales team's rate was chosen.
-- 0.30 is the default because that is what every sales-sourced campaign was
-- being charged while the figure was hard-coded.
--
-- manager_commission_rate is NULLABLE on purpose. NULL means "use the account
-- manager's own account_managers.commission_rate" (10% by default), which is
-- the manager commission the portal has always charged. A value here is a
-- per-campaign override of that SAME commission — it is not a second one.
-- Modelling it as an additional 10% would bill every campaign twice.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS sales_commission_rate   NUMERIC(4,2) NOT NULL DEFAULT 0.30,
  ADD COLUMN IF NOT EXISTS manager_commission_rate NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS show_client_cpm         BOOLEAN      NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_sales_commission_rate_check') THEN
    ALTER TABLE public.campaigns
      ADD CONSTRAINT campaigns_sales_commission_rate_check
      CHECK (sales_commission_rate IN (0.10, 0.20, 0.30));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_manager_commission_rate_check') THEN
    ALTER TABLE public.campaigns
      ADD CONSTRAINT campaigns_manager_commission_rate_check
      CHECK (manager_commission_rate IS NULL OR (manager_commission_rate >= 0 AND manager_commission_rate <= 0.50));
  END IF;
END
$$;

-- A manager can UPDATE campaigns belonging to their own clients
-- (campaigns_modify_owner_or_am). Without this guard that includes the rate of
-- their own commission. Hiding the control in the UI is not a control.
--
-- auth.uid() IS NULL is the service role and migrations: no JWT, no guard.
CREATE OR REPLACE FUNCTION public.campaigns_guard_commission_rates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() = 'owner' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- A manager creating a campaign gets the defaults, whatever was sent.
    NEW.sales_commission_rate   := 0.30;
    NEW.manager_commission_rate := NULL;
    RETURN NEW;
  END IF;

  IF NEW.sales_commission_rate   IS DISTINCT FROM OLD.sales_commission_rate
  OR NEW.manager_commission_rate IS DISTINCT FROM OLD.manager_commission_rate THEN
    RAISE EXCEPTION 'Only the owner can change commission rates'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.campaigns_guard_commission_rates() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_campaigns_guard_commission_rates ON public.campaigns;
CREATE TRIGGER trg_campaigns_guard_commission_rates
  BEFORE INSERT OR UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.campaigns_guard_commission_rates();


-- ============================================================================
-- 2. campaign_creators — an application is not an assignment
-- ============================================================================
--
-- status vocabulary, enforced:
--   Applied   the creator asked; nobody has decided
--   Approved  on the campaign (every pre-existing row, and every staff add)
--   Declined  kept, so the creator sees the outcome and cannot re-apply blind
--
-- DEFAULT 'Approved' is what makes this safe to add to a live table: every row
-- that exists today IS an assignment, and a staff-side insert that does not
-- mention status still means "assign".

ALTER TABLE public.campaign_creators
  ADD COLUMN IF NOT EXISTS status         TEXT NOT NULL DEFAULT 'Approved',
  ADD COLUMN IF NOT EXISTS commitment     INTEGER,
  ADD COLUMN IF NOT EXISTS demo_video_url TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by    UUID,
  ADD COLUMN IF NOT EXISTS reviewed_at    TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_creators_status_check') THEN
    ALTER TABLE public.campaign_creators
      ADD CONSTRAINT campaign_creators_status_check
      CHECK (status IN ('Applied', 'Approved', 'Declined'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_creators_commitment_check') THEN
    ALTER TABLE public.campaign_creators
      ADD CONSTRAINT campaign_creators_commitment_check
      CHECK (commitment IS NULL OR (commitment >= 1 AND commitment <= 500));
  END IF;
END
$$;

-- The mirror, table -> array.
--
-- 20260822000003 aggregates EVERY campaign_creators row into
-- campaigns.assigned_creators. With a status column that is wrong in the worst
-- way: inserting an 'Applied' row put the creator in assigned_creators in the
-- same statement, so they were on the campaign — able to submit and be paid —
-- before anyone had looked at the application. Approve/Decline was decoration.
--
-- Only Approved rows are assignments.
CREATE OR REPLACE FUNCTION public.campaign_creators_sync_array()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_campaign UUID := COALESCE(NEW.campaign_id, OLD.campaign_id);
BEGIN
    IF public.cc_sync_in_progress() THEN
        RETURN NULL;
    END IF;
    PERFORM set_config('omnya.cc_sync', 'on', true);

    UPDATE public.campaigns c
    SET    assigned_creators = COALESCE((
               SELECT array_agg(cc.creator_id ORDER BY cc.creator_id)
               FROM   public.campaign_creators cc
               WHERE  cc.campaign_id = c.id
                 AND  cc.status = 'Approved'
           ), '{}'::uuid[])
    WHERE  c.id = v_campaign;

    IF TG_OP = 'UPDATE' AND OLD.campaign_id IS DISTINCT FROM NEW.campaign_id THEN
        UPDATE public.campaigns c
        SET    assigned_creators = COALESCE((
                   SELECT array_agg(cc.creator_id ORDER BY cc.creator_id)
                   FROM   public.campaign_creators cc
                   WHERE  cc.campaign_id = c.id
                     AND  cc.status = 'Approved'
               ), '{}'::uuid[])
        WHERE  c.id = OLD.campaign_id;
    END IF;

    PERFORM set_config('omnya.cc_sync', 'off', true);
    RETURN NULL;
END;
$$;

-- The mirror, array -> table (legacy writers that still set the array).
--
-- Two changes from 20260822000003:
--   * it only DELETEs Approved rows that left the array. It used to delete
--     every row not in the array, which would now silently discard pending
--     applications and the record of declined ones.
--   * a creator added through the array who already has an Applied/Declined
--     row is upgraded to Approved instead of being skipped by DO NOTHING —
--     staff putting them on the campaign IS the approval.
CREATE OR REPLACE FUNCTION public.campaigns_sync_campaign_creators()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_valid   UUID[];
    v_dropped BIGINT;
BEGIN
    IF public.cc_sync_in_progress() THEN
        RETURN NULL;
    END IF;
    PERFORM set_config('omnya.cc_sync', 'on', true);

    SELECT COALESCE(array_agg(DISTINCT x.id ORDER BY x.id), '{}'::uuid[])
    INTO   v_valid
    FROM   unnest(COALESCE(NEW.assigned_creators, '{}'::uuid[])) AS x(id)
    WHERE  EXISTS (SELECT 1 FROM public.creators cr WHERE cr.id = x.id);

    SELECT count(DISTINCT x.id)
    INTO   v_dropped
    FROM   unnest(COALESCE(NEW.assigned_creators, '{}'::uuid[])) AS x(id)
    WHERE  NOT EXISTS (SELECT 1 FROM public.creators cr WHERE cr.id = x.id);

    DELETE FROM public.campaign_creators cc
    WHERE  cc.campaign_id = NEW.id
      AND  cc.status = 'Approved'
      AND  NOT (cc.creator_id = ANY (v_valid));

    INSERT INTO public.campaign_creators (campaign_id, creator_id, assigned_by, status, reviewed_by, reviewed_at)
    SELECT NEW.id, x.id, auth.uid(), 'Approved', auth.uid(), now()
    FROM   unnest(v_valid) AS x(id)
    ON CONFLICT (campaign_id, creator_id) DO UPDATE
       SET status      = 'Approved',
           reviewed_by = EXCLUDED.reviewed_by,
           reviewed_at = EXCLUDED.reviewed_at
     WHERE public.campaign_creators.status <> 'Approved';

    UPDATE public.campaigns
    SET    assigned_creators = v_valid
    WHERE  id = NEW.id
      AND  assigned_creators IS DISTINCT FROM v_valid;

    IF v_dropped > 0 THEN
        RAISE WARNING
            'campaigns.assigned_creators on campaign % contained % id(s) with no creators row; they were dropped. Write public.campaign_creators instead.',
            NEW.id, v_dropped;
    END IF;

    PERFORM set_config('omnya.cc_sync', 'off', true);
    RETURN NULL;
END;
$$;

-- The job board. campaigns_select_scoped (20260822000005) shows a creator only
-- the campaigns they are ALREADY assigned to, so an open campaign — the thing
-- a job board exists to list — was invisible to exactly the people meant to
-- apply to it, and the apply policy below could never find the campaign it
-- checks. Permissive policies OR together: this adds open jobs and nothing else.
DROP POLICY IF EXISTS campaigns_select_open_jobs ON public.campaigns;
CREATE POLICY campaigns_select_open_jobs ON public.campaigns
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'creator'
    AND campaigns.status = 'Open'
    AND campaigns.application_type = 'Open Application'
  );

-- Creators may APPLY, and that is all they may do.
--
-- The first draft of this policy checked only that the row named the caller's
-- own creator record. status defaults to 'Approved', so a creator could omit
-- it — or send it — and approve themselves onto any campaign. The WITH CHECK
-- now pins status, and requires the campaign to be one that is actually
-- taking applications.
--
-- There is no UPDATE or DELETE policy for creators, so an application cannot
-- be edited into an approval afterwards either. Owner and manager writes go
-- through campaign_creators_modify_owner_am (20260822000003), untouched.
DROP POLICY IF EXISTS campaign_creators_creator_apply ON public.campaign_creators;
CREATE POLICY campaign_creators_creator_apply ON public.campaign_creators
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() = 'creator'
    AND status = 'Applied'
    AND EXISTS (
      SELECT 1 FROM public.creators c
      WHERE  c.id = campaign_creators.creator_id
        AND  c.user_id = auth.uid()
        AND  c.archived_at IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM public.campaigns ca
      WHERE  ca.id = campaign_creators.campaign_id
        AND  ca.status = 'Open'
        AND  ca.application_type = 'Open Application'
    )
  );


-- ============================================================================
-- 3. creators — manual performance overrides
-- ============================================================================

ALTER TABLE public.creators
  ADD COLUMN IF NOT EXISTS score_override INTEGER,
  ADD COLUMN IF NOT EXISTS tier_override  TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creators_score_override_check') THEN
    ALTER TABLE public.creators
      ADD CONSTRAINT creators_score_override_check
      CHECK (score_override IS NULL OR (score_override >= 0 AND score_override <= 100));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creators_tier_override_check') THEN
    ALTER TABLE public.creators
      ADD CONSTRAINT creators_tier_override_check
      CHECK (tier_override IS NULL OR tier_override IN ('A', 'B', 'C', 'D'));
  END IF;
END
$$;

-- creators_update_scoped lets a creator update their own row (user_id =
-- auth.uid()). Their own performance grade must not be one of the things they
-- can update.
CREATE OR REPLACE FUNCTION public.creators_guard_overrides()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() IN ('owner', 'am') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.score_override := NULL;
    NEW.tier_override  := NULL;
    RETURN NEW;
  END IF;

  IF NEW.score_override IS DISTINCT FROM OLD.score_override
  OR NEW.tier_override  IS DISTINCT FROM OLD.tier_override THEN
    RAISE EXCEPTION 'Only the owner or an account manager can set a performance override'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.creators_guard_overrides() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_creators_guard_overrides ON public.creators;
CREATE TRIGGER trg_creators_guard_overrides
  BEFORE INSERT OR UPDATE ON public.creators
  FOR EACH ROW EXECUTE FUNCTION public.creators_guard_overrides();


-- ============================================================================
-- 4. RLS — the manager as a scoped owner
-- ============================================================================

-- True when the creator has any campaign_creators row (applied, approved or
-- declined) on a campaign belonging to one of the calling manager's clients.
-- SECURITY DEFINER for the same reason as client_may_see_creator(): a creators
-- policy that joins campaigns, whose own policies look back at creators, is a
-- policy cycle.
CREATE OR REPLACE FUNCTION public.am_may_see_creator(p_creator_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
    SELECT EXISTS (
      SELECT 1
      FROM   public.campaign_creators cc
      JOIN   public.campaigns        ca ON ca.id = cc.campaign_id
      JOIN   public.clients          cl ON cl.id = ca.client_id
      JOIN   public.account_managers am ON am.id = cl.am_id
      WHERE  cc.creator_id = p_creator_id
        AND  am.user_id    = auth.uid()
    );
$$;

REVOKE ALL  ON FUNCTION public.am_may_see_creator(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.am_may_see_creator(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.am_may_see_creator(UUID) TO service_role;

-- A manager reviewing an application has to be able to read the applicant's
-- name. creators_select_scoped only shows a manager their own roster, so an
-- applicant from anywhere else rendered as a nameless row.
DROP POLICY IF EXISTS creators_select_am_campaign ON public.creators;
CREATE POLICY creators_select_am_campaign ON public.creators
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'am'
    AND public.am_may_see_creator(creators.id)
  );

-- Same shape, for campaigns: true when the campaign belongs to one of the
-- calling manager's clients.
CREATE OR REPLACE FUNCTION public.am_owns_campaign(p_campaign_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
    SELECT EXISTS (
      SELECT 1
      FROM   public.campaigns        ca
      JOIN   public.clients          cl ON cl.id = ca.client_id
      JOIN   public.account_managers am ON am.id = cl.am_id
      WHERE  ca.id      = p_campaign_id
        AND  am.user_id = auth.uid()
    );
$$;

REVOKE ALL  ON FUNCTION public.am_owns_campaign(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.am_owns_campaign(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.am_owns_campaign(UUID) TO service_role;

-- Submissions. A manager could previously read and update a submission only
-- when the CREATOR was on their roster. A submission on their own client's
-- campaign, from a creator rostered elsewhere or nowhere, was invisible — so
-- the review queue could not show it, let alone approve it. Widening UPDATE
-- alone (the first draft) changes nothing the manager can see.
--
-- Added as separate permissive policies rather than by rewriting
-- submissions_select_scoped / submissions_update_scoped: those were settled by
-- the N-10 tenant work and are covered by tenant-isolation.test.cjs. Permissive
-- policies OR together, so this only ever adds the manager's own tenant.
DROP POLICY IF EXISTS submissions_select_am_campaign ON public.submissions;
CREATE POLICY submissions_select_am_campaign ON public.submissions
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'am'
    AND public.am_owns_campaign(submissions.campaign_id)
  );

DROP POLICY IF EXISTS submissions_update_am_campaign ON public.submissions;
CREATE POLICY submissions_update_am_campaign ON public.submissions
  FOR UPDATE TO authenticated
  USING (
    public.current_user_role() = 'am'
    AND public.am_owns_campaign(submissions.campaign_id)
  )
  WITH CHECK (
    public.current_user_role() = 'am'
    AND public.am_owns_campaign(submissions.campaign_id)
  );

-- Payments. Approving a final post creates the Pending payment row from the
-- browser, so a manager who may approve must be able to insert it — but only
-- that row: Pending, for their own campaign, and for no more than the
-- campaign's agreed rate. Owner / payment-manager inserts are unchanged.
DROP POLICY IF EXISTS payments_owner_pm_insert ON public.payments;
CREATE POLICY payments_owner_pm_insert ON public.payments
  FOR INSERT TO authenticated
  WITH CHECK (
    get_my_payout_role() = 'owner'
    OR is_payment_manager('can_export_batches')
  );

DROP POLICY IF EXISTS payments_am_approval_insert ON public.payments;
CREATE POLICY payments_am_approval_insert ON public.payments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() = 'am'
    AND payments.status = 'Pending'
    AND public.am_owns_campaign(payments.campaign_id)
    AND EXISTS (
      SELECT 1 FROM public.campaigns ca
      WHERE  ca.id = payments.campaign_id
        AND  COALESCE(payments.amount_owed, 0)
             <= COALESCE(ca.pay_per_video, 0) * GREATEST(COALESCE(payments.videos_approved, 1), 1)
    )
  );


-- ============================================================================
-- 5. RPCs — a manager picks their own creators
-- ============================================================================
--
-- The obvious route — let managers SELECT creators WHERE am_id IS NULL — hands
-- every manager the full creators row of everyone unassigned, and that row
-- carries payout details (payment_email, bank_account_last4, zelle_email …).
-- Picking someone from a list needs a name and a handle. So the pool is an RPC
-- that returns exactly that, and claiming is an RPC that does exactly one
-- thing, atomically.

CREATE OR REPLACE FUNCTION public.list_unassigned_creators()
RETURNS TABLE (
  id               UUID,
  name             TEXT,
  tiktok_handle    TEXT,
  instagram_handle TEXT,
  status           TEXT,
  created_at       TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
    SELECT c.id, c.name, c.tiktok_handle, c.instagram_handle, c.status, c.created_at
    FROM   public.creators c
    WHERE  c.am_id IS NULL
      AND  c.archived_at IS NULL
      AND  public.current_user_role() IN ('owner', 'am')
    ORDER  BY c.created_at DESC NULLS LAST;
$$;

REVOKE ALL  ON FUNCTION public.list_unassigned_creators() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_unassigned_creators() TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_creator(p_creator_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_am_id UUID;
  v_done  UUID;
BEGIN
  IF public.current_user_role() <> 'am' THEN
    RAISE EXCEPTION 'Only an account manager can claim a creator' USING ERRCODE = '42501';
  END IF;

  SELECT am.id INTO v_am_id
  FROM   public.account_managers am
  WHERE  am.user_id = auth.uid()
  LIMIT  1;

  IF v_am_id IS NULL THEN
    RAISE EXCEPTION 'Your account manager profile is not linked yet' USING ERRCODE = '42501';
  END IF;

  -- am_id IS NULL in the WHERE is the whole point: two managers clicking at
  -- once cannot both win, and nobody can take a creator off a colleague.
  UPDATE public.creators
  SET    am_id = v_am_id
  WHERE  id = p_creator_id
    AND  am_id IS NULL
    AND  archived_at IS NULL
  RETURNING id INTO v_done;

  IF v_done IS NULL THEN
    RAISE EXCEPTION 'That creator is no longer available' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_done;
END;
$$;

REVOKE ALL  ON FUNCTION public.claim_creator(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_creator(UUID) TO authenticated;

-- Releasing is an RPC for a mechanical reason, not a policy one. The manager is
-- allowed to update their own creator, but setting am_id to NULL makes the row
-- invisible to them under creators_select_scoped, and Postgres rejects an
-- UPDATE whose resulting row the caller cannot SELECT ("new row violates
-- row-level security policy"). Done here, the check is explicit instead:
-- it must be YOUR creator, and the creator's campaign history is untouched.
CREATE OR REPLACE FUNCTION public.release_creator(p_creator_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_done UUID;
BEGIN
  IF public.current_user_role() <> 'am' THEN
    RAISE EXCEPTION 'Only an account manager can release a creator' USING ERRCODE = '42501';
  END IF;

  UPDATE public.creators c
  SET    am_id = NULL
  FROM   public.account_managers am
  WHERE  c.id = p_creator_id
    AND  am.id = c.am_id
    AND  am.user_id = auth.uid()
  RETURNING c.id INTO v_done;

  IF v_done IS NULL THEN
    RAISE EXCEPTION 'That creator is not on your roster' USING ERRCODE = '42501';
  END IF;

  RETURN v_done;
END;
$$;

REVOKE ALL  ON FUNCTION public.release_creator(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_creator(UUID) TO authenticated;


-- ============================================================================
-- 6. client_safe_campaigns — let the client portal see the CPM switch
-- ============================================================================
--
-- Clients read campaigns through this view, never the table. It exposed six
-- columns, show_client_cpm not among them, so the client-side check
-- `campaign.show_client_cpm` was always undefined and the toggle did nothing.
--
-- Still no budget, no pay_per_video, no commission: the CPM a client sees is
-- computed from THEIR OWN clients.budget, which their own row already shows
-- them. CREATE OR REPLACE may only append columns, which is all this does.
CREATE OR REPLACE VIEW public.client_safe_campaigns
WITH (security_invoker = true)
AS
SELECT
    c.id             AS campaign_id,
    c.client_id,
    c.name           AS campaign_name,
    c.status         AS campaign_status,
    c.brief_url,
    c.created_at,
    c.format,
    c.deadline,
    c.start_date,
    c.videos_needed,
    c.show_client_cpm
FROM   public.campaigns c
JOIN   public.clients   cl ON c.client_id = cl.id
WHERE  cl.user_id = auth.uid();

GRANT SELECT ON public.client_safe_campaigns TO authenticated;

COMMIT;
