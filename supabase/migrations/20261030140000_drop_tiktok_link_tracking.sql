-- Removes TikTok profile link tracking. Views are verified only through connected accounts.
-- contract: feat/portal-redesign removes the tiktok-link routes, the sync-tiktok-links cron and ScrapeCreators.

BEGIN;

DROP TRIGGER IF EXISTS trg_guard_link_verification ON public.creator_social_accounts;
DROP TRIGGER IF EXISTS trg_guard_link_verification ON public.creator_videos;
DROP TRIGGER IF EXISTS trg_guard_link_verification ON public.submissions;
DROP FUNCTION IF EXISTS public.guard_link_verification_columns();

-- Only the server sets verified views on a submission.
CREATE OR REPLACE FUNCTION public.guard_verified_view_columns() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
    v_claims TEXT := nullif(current_setting('request.jwt.claims', true), '');
    v_role   TEXT := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                              CASE WHEN v_claims IS NULL THEN NULL ELSE v_claims::jsonb ->> 'role' END);
    v_bad    TEXT;
BEGIN
    IF current_user::text NOT IN ('authenticated','anon')
       AND coalesce(v_role, '') NOT IN ('authenticated','anon') THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        v_bad := CASE
            WHEN coalesce(NEW.view_count_verified, 0) <> 0 THEN 'view_count_verified'
            WHEN NEW.view_count_verified_at IS NOT NULL   THEN 'view_count_verified_at'
            WHEN NEW.verified_views_source  IS NOT NULL   THEN 'verified_views_source'
        END;
    ELSE
        v_bad := CASE
            WHEN NEW.view_count_verified    IS DISTINCT FROM OLD.view_count_verified    THEN 'view_count_verified'
            WHEN NEW.view_count_verified_at IS DISTINCT FROM OLD.view_count_verified_at THEN 'view_count_verified_at'
            WHEN NEW.verified_views_source  IS DISTINCT FROM OLD.verified_views_source  THEN 'verified_views_source'
        END;
    END IF;

    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'Only the server can set submissions.%', v_bad USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_verified_views ON public.submissions;
CREATE TRIGGER trg_guard_verified_views BEFORE INSERT OR UPDATE ON public.submissions
    FOR EACH ROW EXECUTE FUNCTION public.guard_verified_view_columns();

CREATE OR REPLACE FUNCTION public.apply_verified_views(p_submission_id uuid, p_views bigint, p_source text, p_user_id uuid, p_handle text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_id UUID;
BEGIN
    IF p_source IS DISTINCT FROM 'oauth' THEN
        RAISE EXCEPTION 'apply_verified_views: source must be oauth, got %', p_source USING ERRCODE = '22023';
    END IF;
    IF p_views IS NULL OR p_views < 0 THEN
        RAISE EXCEPTION 'apply_verified_views: views must be a non negative number' USING ERRCODE = '22023';
    END IF;

    UPDATE public.submissions s
       SET view_count_verified    = GREATEST(COALESCE(s.view_count_verified, 0), LEAST(p_views, 2147483647))::INTEGER,
           view_count_verified_at = now(),
           verified_views_source  = p_source
     WHERE s.id = p_submission_id
       AND EXISTS (SELECT 1 FROM public.creators c WHERE c.id = s.creator_id AND c.user_id = p_user_id)
    RETURNING s.id INTO v_id;

    RETURN v_id IS NOT NULL;
END;
$$;

ALTER TABLE public.submissions DROP CONSTRAINT IF EXISTS submissions_verified_views_source_check;
ALTER TABLE public.submissions ADD CONSTRAINT submissions_verified_views_source_check
    CHECK (verified_views_source IS NULL OR verified_views_source = 'oauth') NOT VALID;

DROP VIEW IF EXISTS public.creator_social_accounts_safe;

ALTER TABLE public.creator_social_accounts
    DROP COLUMN IF EXISTS link_handle,
    DROP COLUMN IF EXISTS link_status,
    DROP COLUMN IF EXISTS link_code,
    DROP COLUMN IF EXISTS link_code_expires_at,
    DROP COLUMN IF EXISTS link_code_found_at,
    DROP COLUMN IF EXISTS link_verified_at,
    DROP COLUMN IF EXISTS link_verified_by,
    DROP COLUMN IF EXISTS link_rejected_reason,
    DROP COLUMN IF EXISTS link_health,
    DROP COLUMN IF EXISTS link_failure_count,
    DROP COLUMN IF EXISTS link_last_error,
    DROP COLUMN IF EXISTS link_last_fetched_at,
    DROP COLUMN IF EXISTS follower_count;

CREATE VIEW public.creator_social_accounts_safe WITH (security_invoker = true) AS
 SELECT id, user_id, creator_id, workspace_id, platform, platform_user_id, username, display_name,
        profile_image_url, token_expires_at, refresh_token_expires_at, scopes, connection_status,
        last_synced_at, last_error, metadata, created_at, updated_at
   FROM public.creator_social_accounts;

REVOKE ALL ON public.creator_social_accounts_safe FROM anon;
GRANT SELECT ON public.creator_social_accounts_safe TO authenticated;
GRANT ALL ON public.creator_social_accounts_safe TO service_role;

ALTER TABLE public.creator_videos
    DROP COLUMN IF EXISTS source,
    DROP COLUMN IF EXISTS author_handle;

DROP FUNCTION IF EXISTS public.thin_video_metrics(integer);
DROP TABLE IF EXISTS public.social_profile_snapshots;

NOTIFY pgrst, 'reload schema';

COMMIT;
