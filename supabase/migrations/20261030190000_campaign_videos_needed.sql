BEGIN;

CREATE OR REPLACE FUNCTION public.campaign_approved_videos(p_campaign_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT count(*)::integer FROM public.submissions
  WHERE campaign_id = p_campaign_id
    AND submission_type = 'Final'
    AND status IN ('Approved', 'Published/Tracked')
    AND archived_at IS NULL;
$$;

-- Refuses new submissions and extra approvals once a campaign has every video it needs.
CREATE OR REPLACE FUNCTION public.enforce_videos_needed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_needed integer;
BEGIN
  IF NEW.campaign_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NOT (
    NEW.submission_type = 'Final'
    AND NEW.status IN ('Approved', 'Published/Tracked')
    AND OLD.status NOT IN ('Approved', 'Published/Tracked')
  ) THEN
    RETURN NEW;
  END IF;

  SELECT videos_needed INTO v_needed FROM public.campaigns WHERE id = NEW.campaign_id FOR UPDATE;
  IF COALESCE(v_needed, 0) > 0 AND public.campaign_approved_videos(NEW.campaign_id) >= v_needed THEN
    RAISE EXCEPTION 'This campaign already has the % approved % it needs.', v_needed, CASE WHEN v_needed = 1 THEN 'video' ELSE 'videos' END;
  END IF;
  RETURN NEW;
END;
$$;

-- Marks a campaign Completed when its last needed video is approved.
CREATE OR REPLACE FUNCTION public.complete_campaign_when_full()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.campaign_id IS NOT NULL
    AND NEW.submission_type = 'Final'
    AND NEW.status IN ('Approved', 'Published/Tracked')
  THEN
    UPDATE public.campaigns SET status = 'Completed'
    WHERE id = NEW.campaign_id
      AND COALESCE(videos_needed, 0) > 0
      AND status NOT IN ('Completed', 'Archived', 'Cancelled')
      AND public.campaign_approved_videos(id) >= videos_needed;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.campaign_approved_videos(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_videos_needed() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_campaign_when_full() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_videos_needed ON public.submissions;
CREATE TRIGGER trg_enforce_videos_needed
  BEFORE INSERT OR UPDATE OF status ON public.submissions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_videos_needed();

DROP TRIGGER IF EXISTS trg_complete_campaign_when_full ON public.submissions;
CREATE TRIGGER trg_complete_campaign_when_full
  AFTER INSERT OR UPDATE OF status ON public.submissions
  FOR EACH ROW EXECUTE FUNCTION public.complete_campaign_when_full();

COMMIT;
