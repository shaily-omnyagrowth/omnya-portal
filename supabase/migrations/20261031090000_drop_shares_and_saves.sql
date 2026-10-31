-- contract: #62 stopped reading and writing these columns
BEGIN;

DROP VIEW IF EXISTS public.client_safe_analytics;

ALTER TABLE public.video_analytics DROP COLUMN IF EXISTS shares, DROP COLUMN IF EXISTS saves;
ALTER TABLE public.submissions DROP COLUMN IF EXISTS shares, DROP COLUMN IF EXISTS saves;
ALTER TABLE public.creator_videos DROP COLUMN IF EXISTS share_count;
ALTER TABLE public.video_metrics DROP COLUMN IF EXISTS share_count;

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
