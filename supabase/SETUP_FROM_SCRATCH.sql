-- =============================================================================
-- Omnya Portal — One-shot setup script for a fresh Supabase project
-- =============================================================================
--
-- Bundle of everything needed to bring the new project to the hardening-branch
-- state:
--
--   Section 1: Base schema       (database_setup.sql)
--   Section 2: Payouts + tokens  (database_update.sql)
--   Section 3: Analytics         (analytics_setup.sql)
--   Section 4: Meta tokens (compat layer; mostly no-op against the above)
--                                (meta_setup.sql)
--   Section 5: Role constraint   (fix_role_constraint.sql)
--   Section 6: Hardening migration (RLS + indexes + missing columns)
--                                (20260521000000_omnya_hardening.sql)
--   Section 7: Social media schema (oauth_states, creator_tokens columns, view)
--                                (20260522000000_social_media_feature.sql)
--   Section 8: Verification block (SELECTs you can eyeball)
--
-- HOW TO USE
--   1. Supabase Dashboard → your project → SQL Editor → New query.
--   2. Paste this entire file.
--   3. Click "Run".
--   4. Scroll to the bottom output — Section 8 prints summaries you can compare
--      against the "Expected" notes in the comments.
--
-- The script is idempotent: re-running is safe. Sections 1-5 use
-- `CREATE TABLE IF NOT EXISTS` and friends; Sections 6 + 7 are wrapped in
-- transactions and use `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
-- and conditional DO blocks.
--
-- After this runs, the database is on the role-scoped RLS model — anonymous
-- queries see nothing; the anon key is gated by RLS for every table. The app
-- still needs:
--   - REACT_APP_SUPABASE_URL + REACT_APP_SUPABASE_ANON_KEY set locally + in
--     Vercel.
--   - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set in Vercel for server-side
--     functions.
-- =============================================================================


-- =============================================================================
-- SECTION 1: BASE SCHEMA  (from database_setup.sql)
-- =============================================================================

-- Run this in Supabase SQL Editor to set up your database

-- 1. User profiles (links auth users to roles)
create table if not exists user_profiles (
  id uuid references auth.users primary key,
  email text unique not null,
  full_name text,
  role text default 'pending' check (role in ('creator','am','account_manager','owner','pending','denied')),
  created_at timestamptz default now()
);

-- 2. Account Managers
create table if not exists account_managers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users,
  name text not null,
  email text unique not null,
  created_at timestamptz default now()
);

-- 3. Creators
create table if not exists creators (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users,
  name text not null,
  email text unique not null,
  tiktok_handle text,
  instagram_handle text,
  status text default 'Active',
  weekly_rate numeric default 150,
  videos_per_week integer default 15,
  payment_status text default 'Current',
  am_id uuid references account_managers,
  created_at timestamptz default now()
);

-- 4. Clients
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  deal_type text default 'Monthly Retainer',
  videos_per_month integer default 20,
  budget numeric default 0,
  status text default 'Active',
  contact_name text,
  contact_email text,
  contact_phone text,
  contract_terms text,
  drive_link text,
  am_id uuid references account_managers,
  created_at timestamptz default now()
);

-- 5. Campaigns
create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client_id uuid references clients,
  description text,
  format text default 'TikTok',
  videos_needed integer default 10,
  pay_per_video numeric default 10,
  deadline date,
  status text default 'Open',
  application_type text default 'Open Application',
  assigned_creators uuid[] default '{}',
  created_at timestamptz default now()
);

-- 6. Submissions
create table if not exists submissions (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid references creators,
  campaign_id uuid references campaigns,
  submission_type text default 'Concept',
  concept_link text,
  concept_status text default 'Pending',
  posted_link text,
  final_status text,
  platform text default 'TikTok',
  feedback text,
  approved_date date,
  views_24h bigint, views_72h bigint, views_1w bigint, views_2w bigint, views_1m bigint,
  likes bigint, comments bigint, shares bigint, saves bigint,
  payment_status text default 'Unpaid',
  ai_insights jsonb,
  created_at timestamptz default now()
);

-- 7. Payments
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid references creators,
  campaign_id uuid references campaigns,
  submission_id uuid references submissions,
  week_ending date,
  videos_approved integer default 0,
  amount_owed numeric default 0,
  status text default 'Pending',
  payment_method text,
  paid_date date,
  created_at timestamptz default now()
);

-- 8. Messages (Forum)
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references campaigns,
  user_id uuid,
  sender_name text,
  content text,
  reactions jsonb default '{}',
  is_pinned boolean default false,
  created_at timestamptz default now()
);

-- Enable Row Level Security (allow all for development)
alter table user_profiles enable row level security;
alter table creators enable row level security;
alter table clients enable row level security;
alter table campaigns enable row level security;
alter table submissions enable row level security;
alter table payments enable row level security;
alter table account_managers enable row level security;
alter table messages enable row level security;

-- Policies
do $$
begin
  drop policy if exists "Allow all" on user_profiles;
  drop policy if exists "Allow all" on creators;
  drop policy if exists "Allow all" on clients;
  drop policy if exists "Allow all" on campaigns;
  drop policy if exists "Allow all" on submissions;
  drop policy if exists "Allow all" on payments;
  drop policy if exists "Allow all" on account_managers;
  drop policy if exists "Allow all" on messages;
end $$;

create policy "Allow all" on user_profiles for all using (true) with check (true);
create policy "Allow all" on creators for all using (true) with check (true);
create policy "Allow all" on clients for all using (true) with check (true);
create policy "Allow all" on campaigns for all using (true) with check (true);
create policy "Allow all" on submissions for all using (true) with check (true);
create policy "Allow all" on payments for all using (true) with check (true);
create policy "Allow all" on account_managers for all using (true) with check (true);
create policy "Allow all" on messages for all using (true) with check (true);


-- =============================================================================
-- SECTION 2: PAYOUTS + LEGACY CREATOR TOKENS  (from database_update.sql)
-- =============================================================================

-- OAuth Tokens Storage
CREATE TABLE IF NOT EXISTS creator_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL, -- 'meta', 'youtube', 'tiktok'
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  platform_account_id TEXT,
  platform_account_name TEXT,
  scopes TEXT[],
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, platform)
);

-- Payouts System
CREATE TABLE IF NOT EXISTS payout_batches (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  status TEXT DEFAULT 'draft', -- 'draft', 'paid'
  period_start DATE,
  period_end DATE,
  total_amount NUMERIC(10,2) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  paid_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS payout_line_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id UUID REFERENCES payout_batches(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  role TEXT, -- 'creator' or 'am'
  amount NUMERIC(10,2) NOT NULL,
  payment_method TEXT,
  payment_details JSONB,
  status TEXT DEFAULT 'pending'
);

-- Add payout reference to submissions if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='submissions' AND column_name='payout_batch_id') THEN
        ALTER TABLE submissions ADD COLUMN payout_batch_id UUID REFERENCES payout_batches(id);
    END IF;
END $$;


-- =============================================================================
-- SECTION 3: VIDEO ANALYTICS  (from analytics_setup.sql)
-- =============================================================================

-- Table to store unified post-level analytics for all platforms
create table if not exists video_analytics (
  id uuid primary key default gen_random_uuid(),
  platform text not null, -- 'tiktok', 'meta', 'youtube'
  creator_id uuid references creators(id),
  campaign_id uuid references campaigns(id),
  submission_id uuid references submissions(id),
  video_id text not null, -- Platform specific ID (e.g. IG Media ID, TikTok Video ID)
  views bigint default 0,
  likes bigint default 0,
  comments bigint default 0,
  shares bigint default 0,
  reach bigint default 0,
  saves bigint default 0,
  watch_time numeric, -- in seconds
  pulled_at timestamptz default now(),
  unique(submission_id)
);

-- Enable RLS
alter table video_analytics enable row level security;

-- Policy to allow creators to see their own analytics
create policy "Allow owners to see their own analytics" 
on video_analytics for select 
using (
  exists (
    select 1 from creators 
    where creators.id = video_analytics.creator_id 
    and creators.user_id = auth.uid()
  )
);


-- =============================================================================
-- SECTION 4: META TOKENS COMPAT  (from meta_setup.sql)
-- Note: the CREATE TABLE IF NOT EXISTS is a no-op because Section 2 already
-- created creator_tokens with the canonical user_id key. The RLS policy here
-- is dropped by Section 6 anyway. Kept for compatibility with the original
-- file order.
-- =============================================================================

-- Ensure creator_tokens table exists and has all necessary fields for TikTok and Meta/Instagram
create table if not exists creator_tokens (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid references creators(id) on delete cascade,
  platform text not null, -- 'tiktok', 'meta', 'youtube', etc.
  access_token text not null,
  refresh_token text,
  scopes text,
  account_id text, -- Specific ID from the platform (e.g., IG Business Account ID)
  account_name text, -- Username or display name
  expires_at timestamptz,
  updated_at timestamptz default now(),
  unique(creator_id, platform)
);

-- Enable RLS
alter table creator_tokens enable row level security;

-- Policy to allow creators to see their own tokens (read-only for frontend)
create policy "Allow owners to see their own tokens" 
on creator_tokens for select 
using (
  exists (
    select 1 from creators 
    where creators.id = creator_tokens.creator_id 
    and creators.user_id = auth.uid()
  )
);


-- =============================================================================
-- SECTION 5: ROLE CONSTRAINT  (from fix_role_constraint.sql)
-- =============================================================================

-- Fix user_profiles role check constraint
-- Allowed roles: creator, am, account_manager, owner, pending, denied

ALTER TABLE user_profiles 
DROP CONSTRAINT IF EXISTS user_profiles_role_check;

ALTER TABLE user_profiles 
ADD CONSTRAINT user_profiles_role_check 
CHECK (role IN ('creator', 'am', 'account_manager', 'owner', 'pending', 'denied'));


-- =============================================================================
-- SECTION 6: PRODUCTION HARDENING MIGRATION
--   (from supabase/migrations/20260521000000_omnya_hardening.sql)
-- =============================================================================

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


-- =============================================================================
-- SECTION 7: SOCIAL MEDIA FEATURE MIGRATION
--   (from supabase/migrations/20260522000000_social_media_feature.sql)
-- =============================================================================

-- =============================================================================
-- Omnya Portal — Social Media Feature Schema
-- =============================================================================
--
-- Companion to 20260521000000_omnya_hardening.sql. Apply that one first.
--
-- Adds:
--   1. oauth_states table — server-side OAuth nonce store with PKCE verifier
--   2. New columns on creator_tokens (status, last_synced_at, last_error,
--      platform_user_id, platform_username, token_type, scope,
--      refresh_expires_at, metadata)
--   3. New columns on video_analytics (user_id, video_url, watch_time_seconds,
--      engagement_rate, raw_metrics, created_at, updated_at)
--   4. UNIQUE(platform, video_id) on video_analytics
--   5. creator_connection_status view (safe, no raw tokens) for frontend reads
--   6. RLS policies on oauth_states and the new columns
--
-- Idempotent. Non-destructive. Apply on staging first, then prod.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. oauth_states — short-lived server-side OAuth state
-- -----------------------------------------------------------------------------
-- The OAuth callback receives `state` and `code` from the provider. To prevent
-- forgery, the start endpoint generates a random nonce, stores its sha256 hash
-- here keyed by (user_id, platform), and the callback verifies the hash before
-- exchanging the code.
--
-- For TikTok we also store the PKCE code_verifier here (server-only — never
-- sent to the browser).
CREATE TABLE IF NOT EXISTS public.oauth_states (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL,
  state_hash      TEXT NOT NULL,
  code_verifier   TEXT,
  redirect_after  TEXT,
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_user_platform ON public.oauth_states(user_id, platform);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at    ON public.oauth_states(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_states_state_hash    ON public.oauth_states(state_hash);

ALTER TABLE public.oauth_states ENABLE ROW LEVEL SECURITY;

-- No policies for authenticated role: oauth_states is read/written exclusively
-- by serverless functions via the service-role key. Authenticated users have
-- zero direct access. (RLS enabled with no policies = deny-all.)

COMMENT ON TABLE public.oauth_states IS
  'Short-lived OAuth state + PKCE verifier store. Server-only; deny-all RLS.';

-- -----------------------------------------------------------------------------
-- 2. creator_tokens — new columns required by the canonical schema
-- -----------------------------------------------------------------------------
-- The hardening migration already added user_id, account_id, account_name,
-- scopes, created_at, updated_at. Here we add the remaining columns the
-- social-media feature needs.
ALTER TABLE public.creator_tokens
  ADD COLUMN IF NOT EXISTS status              TEXT DEFAULT 'connected',
  ADD COLUMN IF NOT EXISTS last_synced_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error          TEXT,
  ADD COLUMN IF NOT EXISTS platform_user_id    TEXT,
  ADD COLUMN IF NOT EXISTS platform_username   TEXT,
  ADD COLUMN IF NOT EXISTS token_type          TEXT,
  ADD COLUMN IF NOT EXISTS scope               TEXT,
  ADD COLUMN IF NOT EXISTS refresh_expires_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS metadata            JSONB DEFAULT '{}'::jsonb;

-- Backfill platform_user_id/platform_username from the legacy account_id/
-- account_name where the new columns are empty.
UPDATE public.creator_tokens
SET platform_user_id  = account_id
WHERE platform_user_id IS NULL AND account_id IS NOT NULL;

UPDATE public.creator_tokens
SET platform_username = account_name
WHERE platform_username IS NULL AND account_name IS NOT NULL;

-- Initialize status for any pre-existing rows.
UPDATE public.creator_tokens
SET status = 'connected'
WHERE status IS NULL AND access_token IS NOT NULL;

UPDATE public.creator_tokens
SET status = 'disconnected'
WHERE status IS NULL AND access_token IS NULL;

-- Status CHECK is intentionally deferred (see hardening migration's note on
-- casing) until all writers are confirmed lowercase. Add in a follow-up
-- migration once Phase 5 normalization lands.

-- -----------------------------------------------------------------------------
-- 3. video_analytics — additive columns + extra UNIQUE
-- -----------------------------------------------------------------------------
-- Add the columns the canonical analytics schema needs. user_id is NULLABLE
-- here on first add to avoid violating any pre-existing row; the sync code
-- populates it going forward.
ALTER TABLE public.video_analytics
  ADD COLUMN IF NOT EXISTS user_id              UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS video_url            TEXT,
  ADD COLUMN IF NOT EXISTS watch_time_seconds   BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS engagement_rate      NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS raw_metrics          JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at           TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at           TIMESTAMPTZ DEFAULT now();

-- Backfill user_id from the creator → user join, then we can rely on it for
-- RLS.
UPDATE public.video_analytics va
SET user_id = c.user_id
FROM public.creators c
WHERE va.user_id IS NULL
  AND va.creator_id IS NOT NULL
  AND va.creator_id = c.id;

CREATE INDEX IF NOT EXISTS idx_video_analytics_user_id ON public.video_analytics(user_id);

-- Add UNIQUE(platform, video_id) alongside the existing UNIQUE(submission_id).
-- The two coexist: sync upserts by submission_id (one analytics row per
-- submission), while platform+video_id helps deduplicate cross-submission
-- shares of the same video. If you only need the latter later, drop
-- video_analytics_submission_id_key in a follow-up.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'video_analytics_platform_video_id_key'
  ) THEN
    ALTER TABLE public.video_analytics
      ADD CONSTRAINT video_analytics_platform_video_id_key UNIQUE (platform, video_id);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 4. creator_connection_status view — safe frontend read
-- -----------------------------------------------------------------------------
-- This view excludes access_token / refresh_token / metadata so the browser
-- (or any code reading via the anon key) can never get raw OAuth secrets.
-- Use the /api/social/connections endpoint for the recommended path; this
-- view is a defensive fallback so even a direct anon-key query is safe.
CREATE OR REPLACE VIEW public.creator_connection_status
WITH (security_invoker = true) AS
SELECT
  id,
  user_id,
  platform,
  platform_user_id,
  platform_username,
  status,
  expires_at,
  refresh_expires_at,
  last_synced_at,
  last_error,
  created_at,
  updated_at
FROM public.creator_tokens;

COMMENT ON VIEW public.creator_connection_status IS
  'Public-safe projection of creator_tokens (omits access/refresh tokens). '
  'security_invoker=true means RLS on creator_tokens is enforced when the '
  'view is queried by a non-service role.';

-- The view inherits RLS from creator_tokens via security_invoker=true, so
-- the existing creator_tokens_select_self policy (from the hardening migration)
-- correctly restricts rows to user_id = auth.uid() OR owner.

GRANT SELECT ON public.creator_connection_status TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. Update creator_tokens RLS to permit INSERT/UPDATE only via service role.
-- -----------------------------------------------------------------------------
-- The hardening migration created a SELECT and DELETE policy. No INSERT/UPDATE
-- policy was added because tokens are always written by server-side endpoints
-- via the service-role key (which bypasses RLS). That's still true here. No
-- change needed; included this note so the design intent is clear.

-- -----------------------------------------------------------------------------
-- 6. Helper: opportunistic cleanup of expired oauth_states.
-- -----------------------------------------------------------------------------
-- Vacuums on a manual basis. Wire as a scheduled function later if volume
-- warrants. Call as: SELECT public.purge_expired_oauth_states();
CREATE OR REPLACE FUNCTION public.purge_expired_oauth_states()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.oauth_states
  WHERE expires_at < now() - INTERVAL '1 hour';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_oauth_states() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_expired_oauth_states() TO service_role;

COMMIT;


-- =============================================================================
-- SECTION 8: VERIFICATION
-- Eyeball these results to confirm the script ran cleanly. The "Expected"
-- notes describe a healthy result.
-- =============================================================================

-- 8a. Tables that should exist (Expected: 13 rows).
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'user_profiles','account_managers','creators','clients','campaigns',
    'submissions','payments','messages','creator_tokens','video_analytics',
    'payout_batches','payout_line_items','oauth_states'
  )
ORDER BY table_name;

-- 8b. New columns that the new code depends on (Expected: 7+ rows).
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'payments'       AND column_name = 'batch_id') OR
    (table_name = 'payout_batches' AND column_name = 'period_type') OR
    (table_name = 'creators'       AND column_name IN ('payout_email','payout_preference')) OR
    (table_name = 'creator_tokens' AND column_name IN ('user_id','status','last_synced_at','platform_user_id')) OR
    (table_name = 'video_analytics' AND column_name IN ('user_id','engagement_rate','raw_metrics'))
  )
ORDER BY table_name, column_name;

-- 8c. RLS policies — every protected table should have its own role-scoped
-- policy, and NO policy should be named "Allow all". (Expected: many rows.)
SELECT tablename, policyname
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 8d. Should return 0 rows. If you see any "Allow all" rows here, the
-- hardening migration did not run and your RLS is still permissive.
SELECT tablename, policyname
FROM pg_policies
WHERE schemaname = 'public' AND policyname = 'Allow all';

-- 8e. Helper function exists (Expected: 1 row).
SELECT proname
FROM pg_proc
WHERE proname IN ('current_user_role','purge_expired_oauth_states')
ORDER BY proname;

-- 8f. View exists (Expected: 1 row).
SELECT table_name
FROM information_schema.views
WHERE table_schema = 'public' AND table_name = 'creator_connection_status';
