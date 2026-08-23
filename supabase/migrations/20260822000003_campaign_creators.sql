-- ============================================================================
-- MIGRATION: 20260822000003_campaign_creators.sql
-- Omnya Portal — referential integrity for campaign assignment  (F-10)
-- ============================================================================
--
-- THE PROBLEM
--
--   `campaigns.assigned_creators` is a bare `uuid[]` holding `creators.id`
--   values. PostgreSQL cannot put a foreign key on an array element, so
--   nothing has ever stopped the array from holding an id that no longer
--   exists. Delete a creator and every campaign they were on keeps their id
--   forever: the roster count in the UI stays wrong, `campaigns_select_scoped`
--   keeps matching against a ghost, and no query can ever tell you which
--   campaigns are affected without a full scan and a manual join.
--
-- THE FIX
--
--   A real junction table, `public.campaign_creators`, with real foreign keys
--   in both directions and ON DELETE CASCADE. Deleting a creator now removes
--   their assignment rows, and an id that does not name a creator can no
--   longer be inserted at all.
--
-- *** campaigns.assigned_creators IS NOW A DERIVED MIRROR. DO NOT WRITE IT. ***
--
--   The array stays, because `campaigns_select_scoped`, `messages_select_by_
--   campaign` and roughly a dozen reads in src/App.js still depend on it.
--   From this migration onward it is MAINTAINED BY TRIGGER from
--   campaign_creators and must be treated as read-only:
--
--       to assign    -> INSERT INTO public.campaign_creators
--       to unassign  -> DELETE FROM public.campaign_creators
--       to read      -> either one; they are kept identical
--
--   SECTION 5 installs a COMPATIBILITY trigger in the other direction so that
--   the writes still present in src/App.js (lines ~1362, ~2393, ~2400) are
--   reconciled into campaign_creators instead of silently desynchronising the
--   two representations. That trigger is a migration aid, not a supported API:
--   it drops any id with no creators row and RAISEs a WARNING when it does.
--   It comes out once src/App.js writes campaign_creators directly.
--
-- SAFETY
--   * CREATE TABLE / INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
--     DROP TRIGGER IF EXISTS before CREATE TRIGGER, DROP POLICY IF EXISTS
--     before CREATE POLICY. Safe to re-run.
--   * The backfill is ON CONFLICT DO NOTHING, so a second run adds nothing.
--   * SECTION 7 hard-fails the transaction if the two representations disagree
--     or if any dangling id survived. A silent partial backfill is worse than
--     a refused migration.
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1 — the junction table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.campaign_creators (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id  UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    creator_id   UUID NOT NULL REFERENCES public.creators(id)  ON DELETE CASCADE,
    assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    assigned_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT campaign_creators_campaign_creator_key UNIQUE (campaign_id, creator_id)
);

COMMENT ON TABLE public.campaign_creators IS
    'Authoritative campaign <-> creator assignment. campaigns.assigned_creators '
    'is a trigger-maintained mirror of this table and must not be written '
    'directly. See 20260822000003_campaign_creators.sql.';

COMMENT ON COLUMN public.campaign_creators.assigned_by IS
    'auth.users id of whoever made the assignment. NULL for rows created by '
    'the backfill or by a service-role write.';

CREATE INDEX IF NOT EXISTS idx_campaign_creators_campaign_id
    ON public.campaign_creators(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_creators_creator_id
    ON public.campaign_creators(creator_id);


-- ============================================================================
-- SECTION 2 — backfill from the existing arrays
--
-- Runs before the triggers exist, so it is a plain bulk insert with no
-- per-row mirror churn. Ids with no matching creators row cannot be inserted
-- (the FK would reject them) and are counted and reported instead: that count
-- is the exact size of the corruption F-10 describes.
-- ============================================================================

DO $$
DECLARE
    v_orphans   BIGINT;
    v_inserted  BIGINT;
    v_campaigns BIGINT;
BEGIN
    SELECT count(*) INTO v_orphans
    FROM   public.campaigns c
    CROSS  JOIN LATERAL unnest(COALESCE(c.assigned_creators, '{}'::uuid[])) AS x(creator_id)
    WHERE  NOT EXISTS (SELECT 1 FROM public.creators cr WHERE cr.id = x.creator_id);

    SELECT count(DISTINCT c.id) INTO v_campaigns
    FROM   public.campaigns c
    CROSS  JOIN LATERAL unnest(COALESCE(c.assigned_creators, '{}'::uuid[])) AS x(creator_id)
    WHERE  NOT EXISTS (SELECT 1 FROM public.creators cr WHERE cr.id = x.creator_id);

    INSERT INTO public.campaign_creators (campaign_id, creator_id)
    SELECT DISTINCT c.id, x.creator_id
    FROM   public.campaigns c
    CROSS  JOIN LATERAL unnest(COALESCE(c.assigned_creators, '{}'::uuid[])) AS x(creator_id)
    WHERE  EXISTS (SELECT 1 FROM public.creators cr WHERE cr.id = x.creator_id)
    ON CONFLICT (campaign_id, creator_id) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    RAISE NOTICE 'campaign_creators backfill: % assignment row(s) created', v_inserted;

    IF v_orphans > 0 THEN
        RAISE NOTICE 'campaign_creators backfill: DROPPED % dangling creator id(s) across % campaign(s) -- these ids had no creators row and were the whole point of F-10',
            v_orphans, v_campaigns;
    ELSE
        RAISE NOTICE 'campaign_creators backfill: 0 dangling creator ids found';
    END IF;
END
$$;

-- Re-derive every array from the junction table in one pass. This is what
-- removes the dangling ids the backfill had to skip, and it fixes the array
-- ordering to the deterministic (creator_id ASC) that SECTION 7 verifies.
UPDATE public.campaigns c
SET    assigned_creators = COALESCE((
           SELECT array_agg(cc.creator_id ORDER BY cc.creator_id)
           FROM   public.campaign_creators cc
           WHERE  cc.campaign_id = c.id
       ), '{}'::uuid[])
WHERE  c.assigned_creators IS DISTINCT FROM COALESCE((
           SELECT array_agg(cc.creator_id ORDER BY cc.creator_id)
           FROM   public.campaign_creators cc
           WHERE  cc.campaign_id = c.id
       ), '{}'::uuid[]);


-- ============================================================================
-- SECTION 3 — the recursion guard
--
-- Two triggers keep the table and the array in step, one in each direction.
-- Left alone they would call each other forever, so both check a single
-- transaction-local flag (`omnya.cc_sync`) and return immediately when a sync
-- is already in flight. set_config(..., is_local => true) means the flag dies
-- with the transaction, so a failed statement cannot leave the triggers
-- disarmed for the next one.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cc_sync_in_progress()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT COALESCE(current_setting('omnya.cc_sync', true), 'off') = 'on';
$$;

COMMENT ON FUNCTION public.cc_sync_in_progress() IS
    'True while a campaign_creators <-> campaigns.assigned_creators sync is '
    'already running in this transaction. Both mirror triggers bail out on it.';


-- ============================================================================
-- SECTION 4 — campaign_creators -> campaigns.assigned_creators (the mirror)
--
-- This is the supported direction. Every INSERT, UPDATE or DELETE on
-- campaign_creators re-derives the whole array for the affected campaign, so
-- the array cannot drift even if several rows change in one statement.
-- ============================================================================

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
           ), '{}'::uuid[])
    WHERE  c.id = v_campaign;

    -- An UPDATE that moved a row between campaigns has to fix both arrays.
    IF TG_OP = 'UPDATE' AND OLD.campaign_id IS DISTINCT FROM NEW.campaign_id THEN
        UPDATE public.campaigns c
        SET    assigned_creators = COALESCE((
                   SELECT array_agg(cc.creator_id ORDER BY cc.creator_id)
                   FROM   public.campaign_creators cc
                   WHERE  cc.campaign_id = c.id
               ), '{}'::uuid[])
        WHERE  c.id = OLD.campaign_id;
    END IF;

    PERFORM set_config('omnya.cc_sync', 'off', true);
    RETURN NULL;
END;
$$;

REVOKE ALL  ON FUNCTION public.campaign_creators_sync_array() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.campaign_creators_sync_array() TO authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_creators_sync_array() TO service_role;

DROP TRIGGER IF EXISTS trg_campaign_creators_sync_array ON public.campaign_creators;
CREATE TRIGGER trg_campaign_creators_sync_array
    AFTER INSERT OR UPDATE OR DELETE ON public.campaign_creators
    FOR EACH ROW EXECUTE FUNCTION public.campaign_creators_sync_array();


-- ============================================================================
-- SECTION 5 — campaigns.assigned_creators -> campaign_creators (compatibility)
--
-- DEPRECATED ON ARRIVAL. This exists only because src/App.js still writes the
-- array directly:
--
--     src/App.js:1362  creator applies to a job
--     src/App.js:2393  AM/owner assigns a creator
--     src/App.js:2400  AM/owner unassigns a creator
--
-- Without it, every one of those writes would leave campaign_creators stale
-- and F-10 would be "fixed" only for rows nobody touched. With it, a direct
-- array write is accepted, filtered down to ids that actually name a creator,
-- reconciled into campaign_creators, and then written back so the array can
-- never hold an id the junction table refused.
--
-- Delete this section, and its two triggers, once WS-D has moved those three
-- call sites onto campaign_creators.
-- ============================================================================

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
      AND  NOT (cc.creator_id = ANY (v_valid));

    INSERT INTO public.campaign_creators (campaign_id, creator_id, assigned_by)
    SELECT NEW.id, x.id, auth.uid()
    FROM   unnest(v_valid) AS x(id)
    ON CONFLICT (campaign_id, creator_id) DO NOTHING;

    -- Write the filtered set back, so the mirror is exact rather than merely
    -- close: the array must never contain an id campaign_creators rejected.
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

REVOKE ALL  ON FUNCTION public.campaigns_sync_campaign_creators() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.campaigns_sync_campaign_creators() TO authenticated;
GRANT EXECUTE ON FUNCTION public.campaigns_sync_campaign_creators() TO service_role;

DROP TRIGGER IF EXISTS trg_campaigns_sync_cc_insert ON public.campaigns;
CREATE TRIGGER trg_campaigns_sync_cc_insert
    AFTER INSERT ON public.campaigns
    FOR EACH ROW
    WHEN (NEW.assigned_creators IS NOT NULL AND array_length(NEW.assigned_creators, 1) > 0)
    EXECUTE FUNCTION public.campaigns_sync_campaign_creators();

DROP TRIGGER IF EXISTS trg_campaigns_sync_cc_update ON public.campaigns;
CREATE TRIGGER trg_campaigns_sync_cc_update
    AFTER UPDATE OF assigned_creators ON public.campaigns
    FOR EACH ROW
    WHEN (NEW.assigned_creators IS DISTINCT FROM OLD.assigned_creators)
    EXECUTE FUNCTION public.campaigns_sync_campaign_creators();


-- ============================================================================
-- SECTION 6 — RLS
--
-- Mirrors campaigns_select_scoped / campaigns_modify_owner_or_am from
-- 20260521000000_omnya_hardening.sql, reached through the campaign:
--
--   owner    everything
--   am       assignments on campaigns belonging to one of their clients
--   creator  SELECT only, and only rows naming their own creators row
--   client   NO POLICY, deliberately. A client can read their campaign, but
--            the full assignment roster includes creators whose work was never
--            approved and never delivered to them. client_safe_submissions
--            already exposes exactly the creator names a client is entitled
--            to; this table would widen that.
--
-- Writes are owner/AM only. A creator cannot self-assign here -- and could not
-- before either: campaigns_modify_owner_or_am has denied creators UPDATE on
-- campaigns since 20260521000000, which already broke the "apply to job" flow
-- at src/App.js:1362. This migration does not restore that path and does not
-- make it worse; see the report accompanying this migration.
-- ============================================================================

ALTER TABLE public.campaign_creators ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campaign_creators_select_scoped   ON public.campaign_creators;
DROP POLICY IF EXISTS campaign_creators_modify_owner_am ON public.campaign_creators;

CREATE POLICY campaign_creators_select_scoped ON public.campaign_creators
    FOR SELECT TO authenticated
    USING (
        public.current_user_role() = 'owner'
        OR (
            public.current_user_role() = 'am'
            AND EXISTS (
                SELECT 1
                FROM   public.campaigns        ca
                JOIN   public.clients          cl ON cl.id = ca.client_id
                JOIN   public.account_managers am ON am.id = cl.am_id
                WHERE  ca.id = campaign_creators.campaign_id
                  AND  am.user_id = auth.uid()
            )
        )
        OR (
            public.current_user_role() = 'creator'
            AND EXISTS (
                SELECT 1 FROM public.creators c
                WHERE  c.id = campaign_creators.creator_id
                  AND  c.user_id = auth.uid()
            )
        )
    );

CREATE POLICY campaign_creators_modify_owner_am ON public.campaign_creators
    FOR ALL TO authenticated
    USING (
        public.current_user_role() = 'owner'
        OR (
            public.current_user_role() = 'am'
            AND EXISTS (
                SELECT 1
                FROM   public.campaigns        ca
                JOIN   public.clients          cl ON cl.id = ca.client_id
                JOIN   public.account_managers am ON am.id = cl.am_id
                WHERE  ca.id = campaign_creators.campaign_id
                  AND  am.user_id = auth.uid()
            )
        )
    )
    WITH CHECK (
        public.current_user_role() = 'owner'
        OR (
            public.current_user_role() = 'am'
            AND EXISTS (
                SELECT 1
                FROM   public.campaigns        ca
                JOIN   public.clients          cl ON cl.id = ca.client_id
                JOIN   public.account_managers am ON am.id = cl.am_id
                WHERE  ca.id = campaign_creators.campaign_id
                  AND  am.user_id = auth.uid()
            )
        )
    );

REVOKE ALL ON public.campaign_creators FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_creators TO authenticated;


-- ============================================================================
-- SECTION 7 — integrity assertion
--
-- The whole point of this migration is that the two representations agree and
-- that no id dangles. If either is false the transaction must not commit: a
-- half-backfilled junction table is worse than no junction table, because the
-- next reader would trust it.
-- ============================================================================

DO $$
DECLARE
    v_dangling  BIGINT;
    v_mismatch  BIGINT;
    v_rows      BIGINT;
BEGIN
    -- 7a. No array element may lack a creators row.
    SELECT count(*) INTO v_dangling
    FROM   public.campaigns c
    CROSS  JOIN LATERAL unnest(COALESCE(c.assigned_creators, '{}'::uuid[])) AS x(creator_id)
    WHERE  NOT EXISTS (SELECT 1 FROM public.creators cr WHERE cr.id = x.creator_id);

    IF v_dangling > 0 THEN
        RAISE EXCEPTION
            'campaign_creators integrity check FAILED: % dangling creator id(s) still in campaigns.assigned_creators after backfill. Nothing has been committed.',
            v_dangling;
    END IF;

    -- 7b. The array and the junction table must be element-for-element equal.
    SELECT count(*) INTO v_mismatch
    FROM   public.campaigns c
    WHERE  COALESCE((SELECT array_agg(cc.creator_id ORDER BY cc.creator_id)
                     FROM public.campaign_creators cc
                     WHERE cc.campaign_id = c.id), '{}'::uuid[])
           IS DISTINCT FROM
           COALESCE((SELECT array_agg(DISTINCT x.creator_id ORDER BY x.creator_id)
                     FROM unnest(COALESCE(c.assigned_creators, '{}'::uuid[])) AS x(creator_id)),
                    '{}'::uuid[]);

    IF v_mismatch > 0 THEN
        RAISE EXCEPTION
            'campaign_creators integrity check FAILED: % campaign(s) where assigned_creators does not equal the campaign_creators rows. Nothing has been committed.',
            v_mismatch;
    END IF;

    SELECT count(*) INTO v_rows FROM public.campaign_creators;
    RAISE NOTICE 'campaign_creators integrity check PASSED: % assignment row(s), 0 dangling ids, 0 mismatched campaigns', v_rows;
END
$$;

COMMIT;
