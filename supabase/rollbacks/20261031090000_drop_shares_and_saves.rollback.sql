BEGIN;

-- Restores the columns, not the dropped values.
ALTER TABLE public.video_analytics ADD COLUMN IF NOT EXISTS shares bigint DEFAULT 0, ADD COLUMN IF NOT EXISTS saves bigint DEFAULT 0;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS shares bigint, ADD COLUMN IF NOT EXISTS saves bigint;
ALTER TABLE public.creator_videos ADD COLUMN IF NOT EXISTS share_count bigint DEFAULT 0 NOT NULL;
ALTER TABLE public.video_metrics ADD COLUMN IF NOT EXISTS share_count bigint DEFAULT 0 NOT NULL;

DROP VIEW IF EXISTS public.client_safe_analytics;

CREATE VIEW public.client_safe_analytics WITH (security_invoker='true') AS
 SELECT va.id AS analytics_id,
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
    va.engagement_rate,
    va.pulled_at
   FROM (((public.video_analytics va
     JOIN public.creators cr ON ((va.creator_id = cr.id)))
     JOIN public.campaigns c ON ((va.campaign_id = c.id)))
     JOIN public.clients cl ON ((c.client_id = cl.id)))
  WHERE (cl.user_id = auth.uid());

GRANT ALL ON TABLE public.client_safe_analytics TO anon;
GRANT ALL ON TABLE public.client_safe_analytics TO authenticated;
GRANT ALL ON TABLE public.client_safe_analytics TO service_role;

COMMIT;
