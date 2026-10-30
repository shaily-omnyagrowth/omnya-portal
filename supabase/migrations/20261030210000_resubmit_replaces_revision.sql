BEGIN;

CREATE OR REPLACE FUNCTION public.campaign_videos_taken(p_campaign_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT count(*)::integer FROM public.submissions
  WHERE campaign_id = p_campaign_id
    AND submission_type = 'Final'
    AND status IN ('Submitted', 'Under Review', 'Revision Requested', 'Approved', 'Published/Tracked')
    AND archived_at IS NULL;
$$;

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
  IF COALESCE(v_needed, 0) = 0 THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' THEN
    IF public.campaign_approved_videos(NEW.campaign_id) >= v_needed THEN
      RAISE EXCEPTION 'This campaign already has the % approved % it needs. Raise videos needed on the campaign to approve more.', v_needed, CASE WHEN v_needed = 1 THEN 'video' ELSE 'videos' END;
    END IF;
    RETURN NEW;
  END IF;

  -- A creator resending after requested changes keeps the spot they already hold.
  IF public.campaign_videos_taken(NEW.campaign_id) >= v_needed AND NOT EXISTS (
    SELECT 1 FROM public.submissions s
    WHERE s.campaign_id = NEW.campaign_id
      AND s.creator_id = NEW.creator_id
      AND s.status = 'Revision Requested'
      AND s.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'This campaign is full. All its videos are approved or in review.';
  END IF;
  RETURN NEW;
END;
$$;

-- A new submission replaces the creator's oldest open revision on that campaign.
CREATE OR REPLACE FUNCTION public.archive_replaced_revision()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE public.submissions
  SET status = 'Archived', archived_at = now(), archive_reason = 'Replaced by a newer submission'
  WHERE id = (
    SELECT s.id FROM public.submissions s
    WHERE s.campaign_id = NEW.campaign_id
      AND s.creator_id = NEW.creator_id
      AND s.status = 'Revision Requested'
      AND s.archived_at IS NULL
      AND s.id <> NEW.id
    ORDER BY s.created_at
    LIMIT 1
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_replaced_revision() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_archive_replaced_revision ON public.submissions;
CREATE TRIGGER trg_archive_replaced_revision
  AFTER INSERT ON public.submissions
  FOR EACH ROW EXECUTE FUNCTION public.archive_replaced_revision();

-- Clears revisions that were already resent before this trigger existed.
UPDATE public.submissions old
SET status = 'Archived', archived_at = now(), archive_reason = 'Replaced by a newer submission'
WHERE old.status = 'Revision Requested'
  AND old.archived_at IS NULL
  AND EXISTS (
    SELECT 1 FROM public.submissions newer
    WHERE newer.campaign_id = old.campaign_id
      AND newer.creator_id = old.creator_id
      AND newer.created_at > old.created_at
  );

COMMIT;
