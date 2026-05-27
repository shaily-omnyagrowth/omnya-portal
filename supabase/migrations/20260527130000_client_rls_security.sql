-- ====================================================================
-- MIGRATION: 20260527130000_client_rls_security.sql
-- ====================================================================

BEGIN;

-- Ensure RLS is active on target tables
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_analytics ENABLE ROW LEVEL SECURITY;

-- 1. RLS: clients (Clients can read only their own mapping)
DROP POLICY IF EXISTS client_select_own_profile ON public.clients;
CREATE POLICY client_select_own_profile ON public.clients
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() = user_id 
        OR EXISTS (
            SELECT 1 FROM public.user_profiles 
            WHERE id = auth.uid() AND role IN ('owner', 'am', 'account_manager')
        )
    );

-- 2. RLS: campaigns (Clients can read only their own campaigns)
DROP POLICY IF EXISTS client_select_own_campaigns ON public.campaigns;
CREATE POLICY client_select_own_campaigns ON public.campaigns
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.clients 
            WHERE public.clients.user_id = auth.uid() AND public.clients.id = campaigns.client_id
        )
        OR EXISTS (
            SELECT 1 FROM public.user_profiles 
            WHERE id = auth.uid() AND role IN ('owner', 'am', 'account_manager')
        )
    );

-- 3. RLS: submissions (Clients can read only submissions linked to their own campaigns)
DROP POLICY IF EXISTS client_select_own_submissions ON public.submissions;
CREATE POLICY client_select_own_submissions ON public.submissions
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.campaigns c
            JOIN public.clients cl ON c.client_id = cl.id
            WHERE cl.user_id = auth.uid() AND c.id = submissions.campaign_id
        )
        OR EXISTS (
            SELECT 1 FROM public.user_profiles 
            WHERE id = auth.uid() AND role IN ('owner', 'am', 'account_manager')
        )
    );

-- 4. RLS: video_analytics (Clients can read only analytics linked to their own campaigns)
DROP POLICY IF EXISTS client_select_own_analytics ON public.video_analytics;
CREATE POLICY client_select_own_analytics ON public.video_analytics
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.campaigns c
            JOIN public.clients cl ON c.client_id = cl.id
            WHERE cl.user_id = auth.uid() AND c.id = video_analytics.campaign_id
        )
        OR EXISTS (
            SELECT 1 FROM public.user_profiles 
            WHERE id = auth.uid() AND role IN ('owner', 'am', 'account_manager')
        )
    );

COMMIT;
