-- ====================================================================
-- MIGRATION: 20260527120000_client_system_integration.sql
-- ====================================================================

BEGIN;

-- 1. Safely alter check constraint on user_profiles role mapping
ALTER TABLE public.user_profiles 
DROP CONSTRAINT IF EXISTS user_profiles_role_check;

ALTER TABLE public.user_profiles 
ADD CONSTRAINT user_profiles_role_check 
CHECK (role IN ('owner', 'am', 'account_manager', 'creator', 'client', 'pending', 'denied'));

-- 2. Add user_id mapping column to clients table
ALTER TABLE public.clients 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 3. High-Performance Indexes for Client Joins & Tenant Separation
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_user_id ON public.clients(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campaigns_client_id ON public.campaigns(client_id);
CREATE INDEX IF NOT EXISTS idx_submissions_campaign_id ON public.submissions(campaign_id);
CREATE INDEX IF NOT EXISTS idx_video_analytics_campaign_id ON public.video_analytics(campaign_id);

-- 4. Establish Safe Database Views for Clients (Column Filtering)

-- A. Client-Safe Campaigns (Omit internal agency budget margins/contracts)
CREATE OR REPLACE VIEW public.client_safe_campaigns AS
SELECT 
    c.id AS campaign_id,
    c.client_id,
    c.name AS campaign_name,
    c.status AS campaign_status,
    c.brief_url,
    c.created_at
FROM public.campaigns c;

-- B. Client-Safe Submissions (Omit pay rates, payouts, and commissions)
CREATE OR REPLACE VIEW public.client_safe_submissions AS
SELECT 
    s.id AS submission_id,
    s.campaign_id,
    s.creator_id,
    cr.name AS creator_name,
    s.platform,
    s.submission_type,
    s.concept_status,
    s.final_status,
    s.posted_link,
    s.created_at
FROM public.submissions s
JOIN public.creators cr ON s.creator_id = cr.id
WHERE s.final_status = 'Approved'; -- Only show fully delivered & validated posts

-- C. Client-Safe Video Analytics (Aggregated campaign rollups)
CREATE OR REPLACE VIEW public.client_safe_analytics AS
SELECT 
    va.id AS analytics_id,
    va.video_id,
    va.platform,
    va.submission_id,
    va.creator_id,
    cr.name AS creator_name,
    va.campaign_id,
    c.name AS campaign_name,
    c.client_id,
    va.views,
    va.likes,
    va.comments,
    va.shares,
    va.reach,
    va.pulled_at
FROM public.video_analytics va
JOIN public.creators cr ON va.creator_id = cr.id
JOIN public.campaigns c ON va.campaign_id = c.id;

-- 5. Revoke direct base table access for select tables from public/authenticated (optional hardening layer)
-- For Phase V1, standard users rely on views. Ensure view select is granted to authenticated/service_role.
GRANT SELECT ON public.client_safe_campaigns TO authenticated;
GRANT SELECT ON public.client_safe_submissions TO authenticated;
GRANT SELECT ON public.client_safe_analytics TO authenticated;

COMMIT;
