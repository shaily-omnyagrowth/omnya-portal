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
