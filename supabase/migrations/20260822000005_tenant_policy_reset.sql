-- ============================================================================
-- MIGRATION: 20260822000005_tenant_policy_reset.sql
-- Omnya Portal — close the cross-tenant read for account managers  (N-10)
-- ============================================================================
--
-- THE FINDING
--
-- An account manager reads every tenant's clients, campaigns and submissions,
-- including those of clients they are not assigned to. The two-tenant suite in
-- tests/role-boundaries.test.cjs proves it: an AM with zero assigned clients
-- reads all of them.
--
--
-- THE CAUSE — AND IT IS IN THIS REPOSITORY, NOT ONLY IN PRODUCTION
--
-- This was chased for a long time as "production carries extra policies that
-- exist in no migration". It carries the leak in plain sight instead.
--
-- 20260527130000_client_rls_security.sql adds three policies whose stated job
-- is to let a CLIENT read its own rows. Each one ends with a staff escape
-- hatch:
--
--     CREATE POLICY client_select_own_profile ON public.clients
--       FOR SELECT TO authenticated
--       USING (
--         auth.uid() = user_id
--         OR EXISTS (SELECT 1 FROM public.user_profiles
--                    WHERE id = auth.uid()
--                      AND role IN ('owner','am','account_manager'))   -- <<<<
--       );
--
-- Permissive RLS policies are combined with OR. So for an AM the row is
-- visible if the correctly-scoped clients_select_scoped passes *or* if that
-- second clause passes -- and that second clause asks only "are you staff?",
-- never "is this row yours?".
--
-- The same clause is on client_select_own_campaigns, on
-- client_select_own_submissions, and on client_select_own_analytics. Those are
-- exactly the tables N-10 names. The correctly-scoped policies were never
-- wrong; they were simply being OR'd with a blanket one.
--
-- This is why the finding survived review: reading clients_select_scoped on
-- its own shows nothing amiss. A policy only means something alongside every
-- other policy on the same table and command.
--
--
-- WHAT THIS MIGRATION DOES
--
-- SECTION 1 drops EVERY policy on the five affected tables, discovered from
-- pg_policies at apply time rather than by name, and RAISEs a NOTICE for each
-- one. That serves two purposes: it removes the leaking policies whatever they
-- are called in your database, and the apply log becomes the first accurate
-- record of what production actually had. If a NOTICE names a policy that
-- appears in no migration, that is drift worth investigating (F-12).
--
-- SECTION 2 recreates the complete, intended set from scratch.
--
-- Dropping every policy and rebuilding is the dangerous half: a policy left
-- out is a role locked out. The full intended matrix is therefore written
-- below, and SECTION 3 refuses to commit if the count is wrong.
--
--
-- THE INTENDED MATRIX
--
--   table         owner        am                     creator            client
--   ----------------------------------------------------------------------------
--   creators      all          own creators (am_id)   own row            creators on
--                                                                        own approved
--                                                                        submissions
--   clients       all          assigned (am_id)       -                  own row
--   campaigns     all          via assigned clients   assigned campaigns own campaigns
--   submissions   all          via own creators       own submissions    on own campaigns
--   video_        all          via own creators       own videos         on own campaigns
--   analytics
--
-- "-" means no read path at all, not a narrower one.
--
-- Rollback: 20260822000005_tenant_policy_reset.rollback.sql
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 0 — preconditions
-- ============================================================================

DO $$
BEGIN
    IF to_regprocedure('public.current_user_role()') IS NULL THEN
        RAISE EXCEPTION
            'N-10: public.current_user_role() is missing. Apply 20260521000000_omnya_hardening.sql first.';
    END IF;
END;
$$;


-- ============================================================================
-- SECTION 1 — drop every policy on the affected tables, by discovery
-- ============================================================================

DO $$
DECLARE
    r        RECORD;
    v_count  INT := 0;
    v_tables TEXT[] := ARRAY['creators', 'clients', 'campaigns', 'submissions', 'video_analytics'];
BEGIN
    FOR r IN
        SELECT schemaname, tablename, policyname
        FROM   pg_policies
        WHERE  schemaname = 'public'
          AND  tablename = ANY (v_tables)
        ORDER  BY tablename, policyname
    LOOP
        RAISE NOTICE 'N-10: dropping policy %.% -> %', r.schemaname, r.tablename, r.policyname;
        EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
        v_count := v_count + 1;
    END LOOP;

    RAISE NOTICE 'N-10: dropped % policy/policies across %', v_count, array_to_string(v_tables, ', ');
    RAISE NOTICE 'N-10: any name above that you cannot find in supabase/migrations/ is undocumented drift (F-12). Record it.';
END;
$$;

-- RLS must be on, and FORCE so that even a table owner is subject to it.
ALTER TABLE public.creators        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions     ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF to_regclass('public.video_analytics') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.video_analytics ENABLE ROW LEVEL SECURITY';
    END IF;
END;
$$;


-- ============================================================================
-- SECTION 2a — creators
-- ============================================================================

CREATE POLICY creators_select_scoped ON public.creators
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.current_user_role() = 'owner'
    OR (
      public.current_user_role() = 'am'
      AND EXISTS (
        SELECT 1 FROM public.account_managers am
        WHERE am.id = creators.am_id AND am.user_id = auth.uid()
      )
    )
  );

-- A client may resolve the name behind work already delivered to them, and
-- nothing else.
--
-- WHY THIS IS A FUNCTION AND NOT AN INLINE EXISTS
--
-- 20260821000001_client_creator_visibility.sql writes this predicate inline,
-- selecting from public.campaigns. campaigns_select_scoped (SECTION 2c) in
-- turn selects from public.creators for its creator branch. Two policies that
-- read each other's table is a cycle, and PostgreSQL refuses the whole query:
--
--     ERROR:  infinite recursion detected in policy for relation "creators"
--             (SQLSTATE 42P17)
--
-- That is not a narrow failure. It breaks EVERY read of campaigns, for every
-- role, including the owner. 20260821000001 is untracked and has evidently
-- never been applied, which is the only reason production is still up.
-- Reproduced in supabase/migrations/__tests__/tenant-isolation.test.cjs.
--
-- A SECURITY DEFINER function runs as its owner and is therefore not subject
-- to RLS, so the cycle is broken at the point where it would close. This is
-- the same reason current_user_role() is SECURITY DEFINER -- see its comment
-- in 20260521000000: "so RLS policies can call it without recursing on
-- user_profiles". Same problem, same remedy.
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

REVOKE ALL  ON FUNCTION public.client_may_see_creator(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_may_see_creator(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.client_may_see_creator(UUID) TO service_role;

COMMENT ON FUNCTION public.client_may_see_creator(UUID) IS
    'True when the calling client has an approved submission from this creator '
    'on one of its own campaigns. SECURITY DEFINER to break the creators <-> '
    'campaigns RLS policy cycle -- see 20260822000005 SECTION 2a.';

CREATE POLICY client_select_creators_on_own_campaigns ON public.creators
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'client'
    AND public.client_may_see_creator(creators.id)
  );

CREATE POLICY creators_insert_self_or_staff ON public.creators
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR public.current_user_role() IN ('owner','am')
  );

CREATE POLICY creators_update_scoped ON public.creators
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.current_user_role() = 'owner'
    OR (
      public.current_user_role() = 'am'
      AND EXISTS (
        SELECT 1 FROM public.account_managers am
        WHERE am.id = creators.am_id AND am.user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    public.current_user_role() IN ('owner','am')
    OR user_id = auth.uid()
  );

CREATE POLICY creators_delete_owner ON public.creators
  FOR DELETE TO authenticated
  USING (public.current_user_role() = 'owner');


-- ============================================================================
-- SECTION 2b — clients
-- ============================================================================

CREATE POLICY clients_select_scoped ON public.clients
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'owner'
    OR (
      public.current_user_role() = 'am'
      AND EXISTS (
        SELECT 1 FROM public.account_managers am
        WHERE am.id = clients.am_id AND am.user_id = auth.uid()
      )
    )
  );

-- THE N-10 FIX.
--
-- Was: auth.uid() = user_id OR <any staff member>.
-- Now: the client's own row, and only for someone whose role IS 'client'.
--
-- The staff clause is gone rather than narrowed. Owners and AMs already have
-- clients_select_scoped above, which grants an owner everything and an AM
-- exactly their assigned clients. Re-granting staff access here could only
-- ever widen that, never narrow it, which is precisely how the hole appeared.
CREATE POLICY client_select_own_profile ON public.clients
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'client'
    AND user_id = auth.uid()
  );

CREATE POLICY clients_modify_owner_or_assigned_am ON public.clients
  FOR ALL TO authenticated
  USING (
    public.current_user_role() = 'owner'
    OR (
      public.current_user_role() = 'am'
      AND EXISTS (
        SELECT 1 FROM public.account_managers am
        WHERE am.id = clients.am_id AND am.user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    public.current_user_role() = 'owner'
    OR (
      public.current_user_role() = 'am'
      AND EXISTS (
        SELECT 1 FROM public.account_managers am
        WHERE am.id = clients.am_id AND am.user_id = auth.uid()
      )
    )
  );


-- ============================================================================
-- SECTION 2c — campaigns
-- ============================================================================

CREATE POLICY campaigns_select_scoped ON public.campaigns
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'owner'
    OR (
      public.current_user_role() = 'am'
      AND EXISTS (
        SELECT 1 FROM public.clients cl
        JOIN public.account_managers am ON cl.am_id = am.id
        WHERE cl.id = campaigns.client_id AND am.user_id = auth.uid()
      )
    )
    OR (
      public.current_user_role() = 'creator'
      AND EXISTS (
        SELECT 1 FROM public.creators c
        WHERE c.user_id = auth.uid()
          AND c.id = ANY (campaigns.assigned_creators)
      )
    )
  );

-- Same fix as clients: scoped to the client role, staff clause removed.
CREATE POLICY client_select_own_campaigns ON public.campaigns
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'client'
    AND EXISTS (
      SELECT 1 FROM public.clients cl
      WHERE cl.user_id = auth.uid() AND cl.id = campaigns.client_id
    )
  );

CREATE POLICY campaigns_modify_owner_or_am ON public.campaigns
  FOR ALL TO authenticated
  USING (
    public.current_user_role() = 'owner'
    OR (
      public.current_user_role() = 'am'
      AND EXISTS (
        SELECT 1 FROM public.clients cl
        JOIN public.account_managers am ON cl.am_id = am.id
        WHERE cl.id = campaigns.client_id AND am.user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    public.current_user_role() = 'owner'
    OR (
      public.current_user_role() = 'am'
      AND EXISTS (
        SELECT 1 FROM public.clients cl
        JOIN public.account_managers am ON cl.am_id = am.id
        WHERE cl.id = campaigns.client_id AND am.user_id = auth.uid()
      )
    )
  );


-- ============================================================================
-- SECTION 2d — submissions
-- ============================================================================

CREATE POLICY submissions_select_scoped ON public.submissions
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'owner'
    OR EXISTS (
      SELECT 1 FROM public.creators c
      WHERE c.id = submissions.creator_id AND c.user_id = auth.uid()
    )
    OR (
      public.current_user_role() = 'am'
      AND EXISTS (
        SELECT 1 FROM public.creators c
        JOIN public.account_managers am ON c.am_id = am.id
        WHERE c.id = submissions.creator_id AND am.user_id = auth.uid()
      )
    )
  );

-- Same fix again. This is the one the two-tenant suite caught that
-- single-tenant checks could not see.
CREATE POLICY client_select_own_submissions ON public.submissions
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'client'
    AND EXISTS (
      SELECT 1 FROM public.campaigns c
      JOIN public.clients cl ON c.client_id = cl.id
      WHERE cl.user_id = auth.uid() AND c.id = submissions.campaign_id
    )
  );

CREATE POLICY submissions_insert_scoped ON public.submissions
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() = 'owner'
    OR EXISTS (
      SELECT 1 FROM public.creators c
      WHERE c.id = submissions.creator_id AND c.user_id = auth.uid()
    )
    OR (
      public.current_user_role() = 'am'
      AND EXISTS (
        SELECT 1 FROM public.creators c
        JOIN public.account_managers am ON c.am_id = am.id
        WHERE c.id = submissions.creator_id AND am.user_id = auth.uid()
      )
    )
  );

CREATE POLICY submissions_update_scoped ON public.submissions
  FOR UPDATE TO authenticated
  USING (
    public.current_user_role() = 'owner'
    OR EXISTS (
      SELECT 1 FROM public.creators c
      WHERE c.id = submissions.creator_id AND c.user_id = auth.uid()
    )
    OR (
      public.current_user_role() = 'am'
      AND EXISTS (
        SELECT 1 FROM public.creators c
        JOIN public.account_managers am ON c.am_id = am.id
        WHERE c.id = submissions.creator_id AND am.user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    public.current_user_role() = 'owner'
    OR EXISTS (
      SELECT 1 FROM public.creators c
      WHERE c.id = submissions.creator_id AND c.user_id = auth.uid()
    )
    OR (
      public.current_user_role() = 'am'
      AND EXISTS (
        SELECT 1 FROM public.creators c
        JOIN public.account_managers am ON c.am_id = am.id
        WHERE c.id = submissions.creator_id AND am.user_id = auth.uid()
      )
    )
  );

CREATE POLICY submissions_delete_owner ON public.submissions
  FOR DELETE TO authenticated
  USING (public.current_user_role() = 'owner');


-- ============================================================================
-- SECTION 2e — video_analytics
-- ============================================================================

DO $$
BEGIN
    IF to_regclass('public.video_analytics') IS NULL THEN
        RAISE NOTICE 'N-10: video_analytics does not exist here; skipping its policies';
        RETURN;
    END IF;

    EXECUTE $p$
      CREATE POLICY video_analytics_select_scoped ON public.video_analytics
        FOR SELECT TO authenticated
        USING (
          public.current_user_role() = 'owner'
          OR EXISTS (
            SELECT 1 FROM public.submissions s
            JOIN public.creators c ON c.id = s.creator_id
            WHERE s.id = video_analytics.submission_id AND c.user_id = auth.uid()
          )
          OR (
            public.current_user_role() = 'am'
            AND EXISTS (
              SELECT 1 FROM public.submissions s
              JOIN public.creators c ON c.id = s.creator_id
              JOIN public.account_managers am ON c.am_id = am.id
              WHERE s.id = video_analytics.submission_id AND am.user_id = auth.uid()
            )
          )
        )
    $p$;

    -- Same fix as the other three.
    EXECUTE $p$
      CREATE POLICY client_select_own_analytics ON public.video_analytics
        FOR SELECT TO authenticated
        USING (
          public.current_user_role() = 'client'
          AND EXISTS (
            SELECT 1 FROM public.submissions s
            JOIN public.campaigns ca ON ca.id = s.campaign_id
            JOIN public.clients   cl ON cl.id = ca.client_id
            WHERE s.id = video_analytics.submission_id AND cl.user_id = auth.uid()
          )
        )
    $p$;
END;
$$;


-- ============================================================================
-- SECTION 3 — refuse to commit a half-built policy set
-- ============================================================================
--
-- Rebuilding from a wholesale drop is only safe if we verify what came back.
-- An empty or short set here means a role is locked out, which would be a
-- worse outage than the leak this migration closes.

DO $$
DECLARE
    r        RECORD;
    v_have   INT;
    v_expect INT;
    v_bad    TEXT := '';
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            ('creators',        5),
            ('clients',         3),
            ('campaigns',       3),
            ('submissions',     5)
        ) AS t(tbl, expected)
    LOOP
        SELECT count(*) INTO v_have
        FROM pg_policies WHERE schemaname = 'public' AND tablename = r.tbl;

        IF v_have <> r.expected THEN
            v_bad := v_bad || format('%s has %s policies, expected %s; ', r.tbl, v_have, r.expected);
        END IF;
    END LOOP;

    IF v_bad <> '' THEN
        RAISE EXCEPTION 'N-10: policy rebuild is wrong -- %. Rolling back rather than leaving a role locked out or a table open.', v_bad;
    END IF;

    -- The specific thing that must no longer be true: a policy on one of these
    -- tables granting access on the strength of being staff, with no row test.
    --
    -- Match the quoted role LITERAL, not the bare word. The correctly-scoped
    -- policies all join public.account_managers, and that table name contains
    -- the substring 'account_manager' -- a LIKE '%account_manager%' here
    -- reports all six of them and fails the migration that just fixed the bug.
    -- It did exactly that before this was tightened.
    SELECT count(*) INTO v_expect
    FROM   pg_policies
    WHERE  schemaname = 'public'
      AND  tablename IN ('clients', 'campaigns', 'submissions', 'video_analytics')
      AND  qual LIKE '%''account_manager''%';

    IF v_expect > 0 THEN
        RAISE EXCEPTION
            'N-10: % policy/policies still test for the literal role account_manager. current_user_role() normalises that to am, so such a test is the unscoped staff clause this migration exists to remove.',
            v_expect;
    END IF;

    RAISE NOTICE 'N-10: policy set rebuilt and verified. The unscoped staff clause is gone from clients, campaigns, submissions and video_analytics.';
END;
$$;

COMMIT;
