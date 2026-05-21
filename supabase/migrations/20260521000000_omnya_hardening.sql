-- =============================================================================
-- Omnya Portal — Production Hardening Migration
-- =============================================================================
--
-- Purpose:
--   1. Align schema with what the API + frontend code already reads/writes:
--      - payments.batch_id (FK to payout_batches.id)
--      - payout_batches.period_type
--      - creators.payout_email, creators.payout_preference
--      - creator_tokens: canonical key is user_id (matches OAuth callbacks,
--        sync.js, disconnect.js, CreatorConnections.js)
--   2. Add foreign-key + hot-path indexes.
--   3. Replace `USING (true)` RLS policies with role-scoped policies.
--   4. Add a helper function current_user_role() for clean policy expressions.
--
-- Safety:
--   - Idempotent: every statement uses IF NOT EXISTS, CREATE OR REPLACE, or a
--     conditional DO block. Safe to run multiple times.
--   - Non-destructive: NO `DROP COLUMN` calls. Dead columns are kept for now
--     (flagged in the README for a later cleanup migration after API code is
--     updated to stop referencing them).
--   - Status CHECK constraints are intentionally NOT added in this migration:
--     the API currently writes `'Pending'`/`'Paid'` (capitalized) while the
--     schema default is `'draft'` (lowercase). Adding a CHECK now would
--     break the running app. Normalize casing in Phase 5 (API hardening),
--     then add CHECKs in a follow-up migration.
--
-- Order:
--   1. Helper function (current_user_role)
--   2. Schema additions (columns)
--   3. creator_tokens backfill (creator_id -> user_id where needed)
--   4. Unique constraint on creator_tokens(user_id, platform)
--   5. Indexes
--   6. Drop old "Allow all" RLS policies
--   7. Create role-scoped RLS policies
--
-- Read supabase/migrations/README.md before applying. Apply on STAGING first.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Helper function: current_user_role()
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER so it can read user_profiles without recursing into the
-- table's own RLS. Normalizes 'account_manager' -> 'am' to match the convention
-- AuthContext.js uses on the frontend.
--
-- search_path is pinned to prevent search-path-injection attacks against
-- SECURITY DEFINER functions.

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT CASE WHEN role = 'account_manager' THEN 'am' ELSE role END
  FROM public.user_profiles
  WHERE id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO service_role;

COMMENT ON FUNCTION public.current_user_role() IS
  'Returns the role of the calling user from user_profiles, normalized so '
  'account_manager -> am. SECURITY DEFINER so RLS policies can call it without '
  'recursing on user_profiles.';

-- -----------------------------------------------------------------------------
-- 2. Schema additions
-- -----------------------------------------------------------------------------

-- 2a. payments.batch_id — written by api/payouts/generate.js, read by
--     mark-paid.js and export.js. Currently missing from the schema.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES public.payout_batches(id) ON DELETE SET NULL;

-- 2b. payout_batches.period_type — read and written by generate.js, used as
--     part of the idempotency key.
ALTER TABLE public.payout_batches
  ADD COLUMN IF NOT EXISTS period_type TEXT;

-- 2c. creators.payout_email and creators.payout_preference — referenced by
--     export.js (CSV columns). Without them, every CSV row had empty email
--     and defaulted preference to 'paypal'.
ALTER TABLE public.creators
  ADD COLUMN IF NOT EXISTS payout_email    TEXT,
  ADD COLUMN IF NOT EXISTS payout_preference TEXT DEFAULT 'paypal';

-- 2d. creator_tokens — canonical key is user_id (FK -> auth.users).
--     The repo has two competing definitions in database_update.sql (user_id)
--     and meta_setup.sql (creator_id); we make user_id authoritative and
--     ensure all the columns that any code path reads or writes exist.
--     creator_id is kept (nullable) for backward compat with files that still
--     read it (api/analytics/refresh.js, fetch.js, pages/CreatorDashboard.js)
--     — those are tagged dead in AUDIT.md and slated for Phase 10 removal.
ALTER TABLE public.creator_tokens
  ADD COLUMN IF NOT EXISTS user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS creator_id UUID REFERENCES public.creators(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS platform   TEXT,
  ADD COLUMN IF NOT EXISTS access_token   TEXT,
  ADD COLUMN IF NOT EXISTS refresh_token  TEXT,
  ADD COLUMN IF NOT EXISTS expires_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS account_id     TEXT,
  ADD COLUMN IF NOT EXISTS account_name   TEXT,
  ADD COLUMN IF NOT EXISTS scopes         TEXT[],
  ADD COLUMN IF NOT EXISTS created_at     TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ DEFAULT now();

-- -----------------------------------------------------------------------------
-- 3. Backfill creator_tokens.user_id where only creator_id is populated
-- -----------------------------------------------------------------------------
-- If the legacy meta_setup.sql definition ran first, rows might have creator_id
-- but no user_id. Populate user_id from creators.user_id so RLS by user_id works.
UPDATE public.creator_tokens ct
SET user_id = c.user_id
FROM public.creators c
WHERE ct.user_id IS NULL
  AND ct.creator_id IS NOT NULL
  AND ct.creator_id = c.id;

-- -----------------------------------------------------------------------------
-- 4. Constraints on creator_tokens
-- -----------------------------------------------------------------------------
-- UNIQUE(user_id, platform) — matches `onConflict: 'user_id, platform'` used
-- by the OAuth callbacks.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'creator_tokens_user_id_platform_key'
  ) THEN
    -- Only add the unique constraint if no orphan rows would violate it.
    -- Orphan rows (user_id NULL) keep coexisting; the unique index will simply
    -- ignore them per Postgres NULL-uniqueness semantics (multiple NULLs allowed).
    ALTER TABLE public.creator_tokens
      ADD CONSTRAINT creator_tokens_user_id_platform_key UNIQUE (user_id, platform);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 5. Indexes
-- -----------------------------------------------------------------------------
-- All foreign keys + hot query columns. CREATE INDEX IF NOT EXISTS is
-- idempotent. Names follow `idx_<table>_<column>` for predictability.

CREATE INDEX IF NOT EXISTS idx_submissions_creator_id      ON public.submissions(creator_id);
CREATE INDEX IF NOT EXISTS idx_submissions_campaign_id     ON public.submissions(campaign_id);
CREATE INDEX IF NOT EXISTS idx_submissions_payout_batch_id ON public.submissions(payout_batch_id);

CREATE INDEX IF NOT EXISTS idx_payments_creator_id ON public.payments(creator_id);
CREATE INDEX IF NOT EXISTS idx_payments_batch_id   ON public.payments(batch_id);
CREATE INDEX IF NOT EXISTS idx_payments_status     ON public.payments(status);

CREATE INDEX IF NOT EXISTS idx_video_analytics_creator_id    ON public.video_analytics(creator_id);
CREATE INDEX IF NOT EXISTS idx_video_analytics_submission_id ON public.video_analytics(submission_id);
CREATE INDEX IF NOT EXISTS idx_video_analytics_campaign_id   ON public.video_analytics(campaign_id);

CREATE INDEX IF NOT EXISTS idx_creator_tokens_user_id    ON public.creator_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_creator_tokens_creator_id ON public.creator_tokens(creator_id);

CREATE INDEX IF NOT EXISTS idx_creators_am_id  ON public.creators(am_id);
CREATE INDEX IF NOT EXISTS idx_clients_am_id   ON public.clients(am_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_client_id ON public.campaigns(client_id);

CREATE INDEX IF NOT EXISTS idx_messages_campaign_id ON public.messages(campaign_id);

CREATE INDEX IF NOT EXISTS idx_payout_batches_period
  ON public.payout_batches(period_start, period_end, period_type);

-- -----------------------------------------------------------------------------
-- 6. Drop legacy "Allow all" policies
-- -----------------------------------------------------------------------------
-- Every table currently has a `Allow all` policy with USING (true). They are
-- replaced below with role-scoped policies. Some tables have additional legacy
-- policies (e.g. video_analytics, creator_tokens from meta_setup.sql); they are
-- dropped too so the new policy set is the only one active.

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
-- 7. Enable RLS on every sensitive table (idempotent — ENABLE on enabled table
--    is a no-op).
-- -----------------------------------------------------------------------------
ALTER TABLE public.user_profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creators          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_managers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_tokens    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_analytics   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_batches    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_line_items ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 8. New role-scoped RLS policies
-- -----------------------------------------------------------------------------
-- Convention:
--   <table>_select_owner_all      : owner sees everything
--   <table>_select_self / scoped  : non-owners see only their slice
--   <table>_modify_*              : write policies
--
-- The service-role key (used by api/**/*.js) bypasses RLS entirely, so these
-- policies only affect direct Supabase calls from the browser. That is exactly
-- where the protection is needed: the SPA holds the anon key.

-- ===== user_profiles =====
-- Read: self + owner sees all + AM sees profiles of their assigned creators.
CREATE POLICY user_profiles_select_self_or_scoped ON public.user_profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.current_user_role() = 'owner'
    OR (
      public.current_user_role() = 'am'
      AND EXISTS (
        SELECT 1 FROM public.creators c
        JOIN public.account_managers am ON c.am_id = am.id
        WHERE c.user_id = user_profiles.id
          AND am.user_id = auth.uid()
      )
    )
  );

-- Insert: a user can create their own profile row at signup. Owner can also
-- insert (e.g. seeding).
--
-- Trade-off: we allow role='owner' on self-insert too, because the current
-- signup flow in App.js auto-promotes a hardcoded owner email (shaily@...)
-- and there is otherwise no way to provision the first owner without a
-- service-role seed. Once Phase 4 replaces the special-email path with a
-- proper bootstrap (DB trigger or manual seed via service-role), tighten
-- this WITH CHECK back to ('pending','creator','am','account_manager').
CREATE POLICY user_profiles_insert_self_or_owner ON public.user_profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    id = auth.uid()
    OR public.current_user_role() = 'owner'
  );

-- Update: owners can update anyone. Anyone else can update only their own row
-- and CANNOT escalate their role (the WITH CHECK enforces the role column
-- can only be set to one of the non-privileged values from a self-update).
CREATE POLICY user_profiles_update_self_or_owner ON public.user_profiles
  FOR UPDATE TO authenticated
  USING (
    id = auth.uid()
    OR public.current_user_role() = 'owner'
  )
  WITH CHECK (
    public.current_user_role() = 'owner'
    OR (
      id = auth.uid()
      AND role IN ('pending','creator','am','account_manager','denied')
    )
  );

-- Delete: owners only.
CREATE POLICY user_profiles_delete_owner ON public.user_profiles
  FOR DELETE TO authenticated
  USING (public.current_user_role() = 'owner');


-- ===== account_managers =====
CREATE POLICY account_managers_select ON public.account_managers
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.current_user_role() = 'owner'
    -- AMs need to be able to see other AMs in some views (e.g. assigning).
    -- If that is undesirable, tighten by removing this OR clause.
    OR public.current_user_role() = 'am'
  );

CREATE POLICY account_managers_modify_owner ON public.account_managers
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'owner')
  WITH CHECK (public.current_user_role() = 'owner');


-- ===== creators =====
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

-- Insert: owner or AM can create creator rows (e.g. onboarding). A creator
-- self-provisioning is also allowed (the App.js handleLogin flow inserts a
-- row keyed by user_id).
CREATE POLICY creators_insert_self_or_staff ON public.creators
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR public.current_user_role() IN ('owner','am')
  );

-- Update: owner or the AM the creator is assigned to. Creators can update
-- their own row (handles, payment preferences, etc.) but cannot reassign
-- themselves to a different AM — the WITH CHECK enforces am_id stays the same
-- unless owner/AM is doing it.
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


-- ===== clients =====
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


-- ===== campaigns =====
-- A creator can see a campaign if their creator_id appears in assigned_creators.
-- Note: assigned_creators stores creator UUIDs (creators.id), not user UUIDs.
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


-- ===== submissions =====
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

-- Insert: creators submit on their own behalf. Owner/AM can also create
-- submissions (e.g. for backfill or admin overrides).
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

-- Update: same scoping. Creators can edit their own pre-approval; review
-- decisions (concept_status, final_status, payment_status) are normally only
-- changed by AM/owner UI flows.
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


-- ===== payments =====
-- Creators read their own. AMs read payments for their creators. Owner reads all.
CREATE POLICY payments_select_scoped ON public.payments
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'owner'
    OR EXISTS (
      SELECT 1 FROM public.creators c
      WHERE c.id = payments.creator_id AND c.user_id = auth.uid()
    )
    OR (
      public.current_user_role() = 'am'
      AND EXISTS (
        SELECT 1 FROM public.creators c
        JOIN public.account_managers am ON c.am_id = am.id
        WHERE c.id = payments.creator_id AND am.user_id = auth.uid()
      )
    )
  );

-- Only owners/AMs can create or modify payments. Creators are read-only.
-- (Service-role endpoints — mark-paid.js, generate.js — bypass RLS anyway.)
CREATE POLICY payments_modify_owner_or_am ON public.payments
  FOR ALL TO authenticated
  USING (public.current_user_role() IN ('owner','am'))
  WITH CHECK (public.current_user_role() IN ('owner','am'));


-- ===== payout_batches =====
-- Creators must NOT see batch metadata (other creators' totals, period info).
-- AMs may see batches; owners manage them.
CREATE POLICY payout_batches_select_owner_or_am ON public.payout_batches
  FOR SELECT TO authenticated
  USING (public.current_user_role() IN ('owner','am'));

CREATE POLICY payout_batches_modify_owner ON public.payout_batches
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'owner')
  WITH CHECK (public.current_user_role() = 'owner');


-- ===== payout_line_items (dead table — locked down anyway) =====
CREATE POLICY payout_line_items_owner_only ON public.payout_line_items
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'owner')
  WITH CHECK (public.current_user_role() = 'owner');


-- ===== creator_tokens =====
-- Creators read their own connection state. Writes happen server-side via the
-- service-role key (OAuth callbacks, refresh). Creators may delete their own
-- tokens directly if needed; today the disconnect API does this via service-role.
CREATE POLICY creator_tokens_select_self ON public.creator_tokens
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.current_user_role() = 'owner'
  );

CREATE POLICY creator_tokens_delete_self ON public.creator_tokens
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.current_user_role() = 'owner'
  );

-- No INSERT/UPDATE policy for authenticated role: the only way tokens are
-- written is through service-role endpoints, which bypass RLS.


-- ===== video_analytics =====
-- Creators see analytics for their own submissions. AMs see analytics for
-- their assigned creators. Owners see everything.
-- Writes only happen via service-role (sync.js cron, fetch.js).
CREATE POLICY video_analytics_select_scoped ON public.video_analytics
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'owner'
    OR EXISTS (
      SELECT 1 FROM public.creators c
      WHERE c.id = video_analytics.creator_id AND c.user_id = auth.uid()
    )
    OR (
      public.current_user_role() = 'am'
      AND EXISTS (
        SELECT 1 FROM public.creators c
        JOIN public.account_managers am ON c.am_id = am.id
        WHERE c.id = video_analytics.creator_id AND am.user_id = auth.uid()
      )
    )
  );


-- ===== messages =====
-- A message is visible if the user has access to the campaign. We treat
-- campaign visibility as transitive: anyone who can SELECT the campaign per
-- the campaigns RLS policy can SELECT its messages and post messages to it.
CREATE POLICY messages_select_by_campaign ON public.messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.campaigns ca
      WHERE ca.id = messages.campaign_id
        -- piggyback on campaigns RLS by re-checking the visibility predicate
        AND (
          public.current_user_role() = 'owner'
          OR (
            public.current_user_role() = 'am'
            AND EXISTS (
              SELECT 1 FROM public.clients cl
              JOIN public.account_managers am ON cl.am_id = am.id
              WHERE cl.id = ca.client_id AND am.user_id = auth.uid()
            )
          )
          OR (
            public.current_user_role() = 'creator'
            AND EXISTS (
              SELECT 1 FROM public.creators c
              WHERE c.user_id = auth.uid()
                AND c.id = ANY (ca.assigned_creators)
            )
          )
        )
    )
  );

CREATE POLICY messages_insert_self ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.campaigns ca
      WHERE ca.id = messages.campaign_id
        AND (
          public.current_user_role() = 'owner'
          OR (
            public.current_user_role() = 'am'
            AND EXISTS (
              SELECT 1 FROM public.clients cl
              JOIN public.account_managers am ON cl.am_id = am.id
              WHERE cl.id = ca.client_id AND am.user_id = auth.uid()
            )
          )
          OR (
            public.current_user_role() = 'creator'
            AND EXISTS (
              SELECT 1 FROM public.creators c
              WHERE c.user_id = auth.uid()
                AND c.id = ANY (ca.assigned_creators)
            )
          )
        )
    )
  );

-- Senders may edit their own messages; owners may moderate.
CREATE POLICY messages_update_self_or_owner ON public.messages
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.current_user_role() = 'owner'
  )
  WITH CHECK (
    user_id = auth.uid()
    OR public.current_user_role() = 'owner'
  );

CREATE POLICY messages_delete_self_or_owner ON public.messages
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.current_user_role() = 'owner'
  );


-- -----------------------------------------------------------------------------
-- 9. Verification helpers (commented — run manually after applying)
-- -----------------------------------------------------------------------------
--
-- After applying, log into the SQL editor as an authenticated user (set the
-- session's role to `authenticated` and JWT claim `sub` to a test user id) and
-- run the smoke checks. Or use the Supabase JS client with an anon key + a real
-- session.
--
--   -- As a creator (uid = <CREATOR_UUID>), should return only their own rows:
--   SELECT count(*) FROM public.payments;
--
--   -- As an AM (uid = <AM_UUID>), should return only their assigned creators':
--   SELECT count(*) FROM public.creators;
--
--   -- As owner, should return everything:
--   SELECT count(*) FROM public.user_profiles;
--
-- The accompanying README also includes a Supabase JS snippet for testing
-- from your local machine using a real session token.

COMMIT;
