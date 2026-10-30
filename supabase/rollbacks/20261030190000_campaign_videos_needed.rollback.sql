BEGIN;

DROP TRIGGER IF EXISTS trg_complete_campaign_when_full ON public.submissions;
DROP TRIGGER IF EXISTS trg_enforce_videos_needed ON public.submissions;
DROP FUNCTION IF EXISTS public.complete_campaign_when_full();
DROP FUNCTION IF EXISTS public.enforce_videos_needed();
DROP FUNCTION IF EXISTS public.campaign_approved_videos(uuid);

COMMIT;
