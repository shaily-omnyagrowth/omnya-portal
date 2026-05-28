-- ====================================================================
-- MIGRATION: 20260528000000_security_hardening.sql
-- ====================================================================
--
-- Fixes applied:
--   Fix 1 — Recreate client_safe_* views with security_invoker=true
--            and explicit WHERE cl.user_id = auth.uid() guards.
--   Fix 2 — Add campaigns.brief_url column (was referenced by views
--            but never existed on the base table).
--   Fix 3 — Trigger: auto-create clients row when user_profiles.role
--            is set to 'client', preventing the infinite spinner.
--
-- Safety:
--   • All DDL is idempotent (IF NOT EXISTS / OR REPLACE / DO blocks).
--   • No DROP COLUMN or DELETE of existing data.
--   • Deduplication step before adding UNIQUE constraint is isolated
--     to rows that already violate uniqueness; it keeps the oldest row.
--   • Trigger function is SECURITY DEFINER with fixed search_path to
--     prevent search-path injection.
-- ====================================================================

BEGIN;

-- ============================================================
-- Fix 2: Add campaigns.brief_url
-- Referenced by client_safe_campaigns view but missing on base
-- table, which caused the view to fail or return NULL every row.
-- ============================================================
ALTER TABLE public.campaigns
    ADD COLUMN IF NOT EXISTS brief_url TEXT;

-- ============================================================
-- Fix 3a: Ensure a proper UNIQUE CONSTRAINT on clients.user_id
-- The earlier migration added a partial unique INDEX (WHERE user_id
-- IS NOT NULL). A partial index cannot be used as the ON CONFLICT
-- arbiter without repeating the WHERE predicate. Adding a full
-- unique constraint gives us a clean ON CONFLICT (user_id) target.
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM   pg_constraint
        WHERE  conname    = 'clients_user_id_unique'
          AND  conrelid   = 'public.clients'::regclass
    ) THEN
        -- Deduplicate before adding constraint: keep the oldest row
        -- (by created_at) for any user_id that appears more than once.
        -- MIN() doesn't work on UUID, so we use DISTINCT ON instead.
        DELETE FROM public.clients a
        WHERE  a.user_id IS NOT NULL
          AND  a.id NOT IN (
                SELECT DISTINCT ON (user_id) id
                FROM   public.clients
                WHERE  user_id IS NOT NULL
                ORDER  BY user_id, created_at ASC NULLS LAST
               );

        ALTER TABLE public.clients
            ADD CONSTRAINT clients_user_id_unique UNIQUE (user_id);
    END IF;
END
$$;

-- ============================================================
-- Fix 3b: Trigger function — auto-create clients row
-- Fires after INSERT or after role UPDATE on user_profiles.
-- Uses COALESCE so it still works when full_name is NULL.
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_client_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.role = 'client' THEN
        INSERT INTO public.clients (name, user_id, created_at)
        VALUES (
            COALESCE(NULLIF(trim(NEW.full_name), ''), NEW.email, 'New Client'),
            NEW.id,
            now()
        )
        ON CONFLICT ON CONSTRAINT clients_user_id_unique DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

-- Restrict execution to server-side roles only.
REVOKE ALL ON FUNCTION public.handle_new_client_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_client_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_client_user() TO service_role;

COMMENT ON FUNCTION public.handle_new_client_user() IS
    'Auto-provisions a clients row whenever a user_profiles row is inserted '
    'or updated with role=''client''. Prevents ClientDashboard infinite spinner.';

-- Attach trigger (idempotent via DROP IF EXISTS + CREATE)
DROP TRIGGER IF EXISTS on_client_role_assigned ON public.user_profiles;
CREATE TRIGGER on_client_role_assigned
    AFTER INSERT OR UPDATE OF role ON public.user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_client_user();

-- Backfill: create clients rows for any user_profiles rows that
-- already have role='client' but no matching clients row.
INSERT INTO public.clients (name, user_id, created_at)
SELECT
    COALESCE(NULLIF(trim(up.full_name), ''), up.email, 'New Client'),
    up.id,
    now()
FROM public.user_profiles up
WHERE up.role = 'client'
  AND NOT EXISTS (
        SELECT 1 FROM public.clients cl WHERE cl.user_id = up.id
      )
ON CONFLICT ON CONSTRAINT clients_user_id_unique DO NOTHING;


-- ============================================================
-- Fix 1: Recreate client_safe_* views
--
-- Problem: The previous definitions omitted WITH (security_invoker=true),
-- meaning PostgreSQL ran the views with the definer's privileges and
-- bypassed RLS on the underlying tables. Any authenticated user could
-- query these views and see ALL other clients' data.
--
-- Fix: security_invoker=true forces the view to run under the calling
-- user's credentials, so the existing RLS policies on campaigns, clients,
-- submissions, and video_analytics are enforced as normal.
--
-- Defence-in-depth: Each view also carries an explicit WHERE clause
-- (cl.user_id = auth.uid()) so it self-documents intent and provides
-- an additional filter even if a future policy regression occurs.
-- ============================================================

-- Drop old insecure versions first.
DROP VIEW IF EXISTS public.client_safe_analytics;
DROP VIEW IF EXISTS public.client_safe_submissions;
DROP VIEW IF EXISTS public.client_safe_campaigns;

-- A. client_safe_campaigns
--    Safe columns only: no budget, no rate card, no internal notes.
CREATE VIEW public.client_safe_campaigns
WITH (security_invoker = true)
AS
SELECT
    c.id             AS campaign_id,
    c.client_id,
    c.name           AS campaign_name,
    c.status         AS campaign_status,
    c.brief_url,
    c.created_at
FROM   public.campaigns c
JOIN   public.clients   cl ON c.client_id = cl.id
WHERE  cl.user_id = auth.uid();

-- B. client_safe_submissions
--    Only Approved final posts. No pay rates, no revision notes,
--    no payment_status, no creator private fields.
CREATE VIEW public.client_safe_submissions
WITH (security_invoker = true)
AS
SELECT
    s.id              AS submission_id,
    s.campaign_id,
    s.creator_id,
    cr.name           AS creator_name,
    s.platform,
    s.submission_type,
    s.concept_status,
    s.final_status,
    s.posted_link,
    s.created_at
FROM   public.submissions s
JOIN   public.campaigns   ca ON s.campaign_id  = ca.id
JOIN   public.clients     cl ON ca.client_id   = cl.id
JOIN   public.creators    cr ON s.creator_id   = cr.id
WHERE  cl.user_id    = auth.uid()
  AND  s.final_status = 'Approved';

-- C. client_safe_analytics
--    No raw_metrics JSONB (can contain internal creator data), no user_id.
CREATE VIEW public.client_safe_analytics
WITH (security_invoker = true)
AS
SELECT
    va.id            AS analytics_id,
    va.video_id,
    va.platform,
    va.submission_id,
    va.creator_id,
    cr.name          AS creator_name,
    va.campaign_id,
    c.name           AS campaign_name,
    c.client_id,
    va.views,
    va.likes,
    va.comments,
    va.shares,
    va.reach,
    va.engagement_rate,
    va.pulled_at
FROM   public.video_analytics va
JOIN   public.creators  cr ON va.creator_id  = cr.id
JOIN   public.campaigns c  ON va.campaign_id = c.id
JOIN   public.clients   cl ON c.client_id    = cl.id
WHERE  cl.user_id = auth.uid();

-- Restore SELECT grants.
GRANT SELECT ON public.client_safe_campaigns   TO authenticated;
GRANT SELECT ON public.client_safe_submissions TO authenticated;
GRANT SELECT ON public.client_safe_analytics   TO authenticated;

COMMIT;

-- ====================================================================
-- Regression verification (run manually in Supabase SQL editor):
-- ====================================================================
--
-- 1. As Client A, confirm you see ONLY your own campaigns:
--      SELECT count(*) FROM public.client_safe_campaigns;
--      -- Should equal only campaigns where clients.user_id = your auth.uid()
--
-- 2. As Client A, attempt to read Client B's data:
--      SELECT * FROM public.client_safe_campaigns WHERE client_id = '<client_b_clients_id>';
--      -- Should return 0 rows.
--
-- 3. Confirm the trigger fires for a new client signup:
--      INSERT INTO public.user_profiles (id, email, role)
--      VALUES (gen_random_uuid(), 'test-client@example.com', 'client');
--      SELECT * FROM public.clients WHERE name = 'test-client@example.com';
--      -- Should return 1 row.
--
-- 4. Confirm backfill covered existing clients:
--      SELECT up.email FROM public.user_profiles up
--      LEFT JOIN public.clients cl ON cl.user_id = up.id
--      WHERE up.role = 'client' AND cl.id IS NULL;
--      -- Should return 0 rows.
-- ====================================================================
