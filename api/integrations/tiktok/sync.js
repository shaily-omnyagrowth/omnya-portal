// api/integrations/tiktok/sync.js
//
// POST /api/integrations/tiktok/sync
// Headers: Authorization: Bearer <supabase-jwt>
// Returns: 200 { ok: true, data: { profile_updated, videos_synced, video_access } }
//
// Syncs TikTok profile and (if video.list scope is granted) public videos.
// Stores metric snapshots in video_metrics for future trend analysis.
//
// Deliberately decoupled from payouts, bonuses, and earnings — this route
// only writes to creator_social_accounts, creator_videos, and video_metrics.
//
// Rate limit: 3 manual syncs per minute per user (in-process counter).

const { applyCors }              = require('../../_utils/cors');
const { requireAuth }            = require('../../_utils/auth');
const { Errors, sendOk }         = require('../../_utils/errors');
const { getSupabaseAdminClient } = require('../../_utils/supabaseAdmin');
const { fetchProfile, fetchVideos, ensureFreshToken } = require('../../_utils/tiktok');

// ─── Simple in-memory rate limiter ──────────────────────────────────────────
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX       = 3;
const syncHistory    = new Map(); // userId -> [timestamp, ...]

function isRateLimited(userId) {
  const now     = Date.now();
  const history = (syncHistory.get(userId) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (history.length >= RATE_MAX) return true;
  history.push(now);
  syncHistory.set(userId, history);
  return false;
}

// ─── Engagement rate ─────────────────────────────────────────────────────────
function calcEngagement({ views, likes, comments, shares }) {
  if (!views || views === 0) return 0;
  return parseFloat((((likes + comments + shares) / views) * 100).toFixed(2));
}

// ─── Handler ─────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  const user = await requireAuth(req, res);
  if (!user) return;

  if (isRateLimited(user.id)) {
    return Errors.rateLimited(res, 'Manual sync limit reached. Please wait a minute before syncing again.');
  }

  const supabase = getSupabaseAdminClient();

  // Load TikTok account (need token columns for ensureFreshToken)
  const { data: account, error: acctErr } = await supabase
    .from('creator_social_accounts')
    .select('id, connection_status, access_token_encrypted, refresh_token_encrypted, token_expires_at, scopes')
    .eq('user_id', user.id)
    .eq('platform', 'tiktok')
    .maybeSingle();

  if (acctErr) return Errors.internal(res, 'Failed to load TikTok account');

  if (!account) {
    return Errors.notFound(res, 'TikTok account is not connected. Please connect first.');
  }

  const inactiveStatuses = ['disconnected', 'not_connected'];
  if (inactiveStatuses.includes(account.connection_status)) {
    return Errors.badRequest(res, 'TikTok account is not connected.');
  }

  // Ensure we have a valid access token (refreshes automatically if expiring soon)
  let accessToken;
  try {
    accessToken = await ensureFreshToken(account);
  } catch (err) {
    console.error('[tiktok/sync] token refresh failed:', err.message);
    return Errors.badRequest(
      res,
      'TikTok token has expired and could not be refreshed. Please reconnect your account.'
    );
  }

  const summary = {
    profile_updated: false,
    videos_synced:   0,
    video_access:    'unknown',
  };

  // ── 1. Profile sync ─────────────────────────────────────────────────────────
  try {
    const profile = await fetchProfile(accessToken);
    if (profile) {
      await supabase
        .from('creator_social_accounts')
        .update({
          platform_user_id:  profile.open_id      || null,
          display_name:      profile.display_name  || null,
          profile_image_url: profile.avatar_url    || null,
          updated_at:        new Date().toISOString(),
        })
        .eq('id', account.id);

      summary.profile_updated = true;
    }
  } catch (profileErr) {
    console.warn('[tiktok/sync] profile sync skipped (non-fatal):', profileErr.message);
  }

  // ── 2. Video sync ────────────────────────────────────────────────────────────
  const hasVideoScope = (account.scopes || []).includes('video.list');

  if (!hasVideoScope) {
    summary.video_access = 'scope_not_granted';
  } else {
    try {
      const videoData = await fetchVideos(accessToken, { maxCount: 20 });

      if (videoData === null) {
        // TikTok returned 403 / no_permission — scope was approved but later revoked
        summary.video_access = 'denied';
      } else {
        summary.video_access = 'granted';
        const videos = videoData.videos || [];

        for (const v of videos) {
          if (!v.id) continue;

          const videoRow = {
            user_id:           user.id,
            social_account_id: account.id,
            platform:          'tiktok',
            platform_video_id: v.id,
            video_url:         v.share_url         || null,
            caption:           v.video_description || v.title || null,
            thumbnail_url:     v.cover_image_url   || null,
            posted_at:         v.create_time
              ? new Date(v.create_time * 1000).toISOString()
              : null,
            view_count:        v.view_count    ?? 0,
            like_count:        v.like_count    ?? 0,
            comment_count:     v.comment_count ?? 0,
            share_count:       v.share_count   ?? 0,
            duration_seconds:  v.duration      ?? null,
            sync_status:       'synced',
            updated_at:        new Date().toISOString(),
          };

          const { data: upserted, error: videoErr } = await supabase
            .from('creator_videos')
            .upsert(videoRow, { onConflict: 'user_id,platform,platform_video_id' })
            .select('id')
            .maybeSingle();

          if (videoErr) {
            console.warn('[tiktok/sync] video upsert failed:', videoErr.message, 'video_id:', v.id);
            continue;
          }

          // Store a metric snapshot for trend tracking
          if (upserted?.id) {
            const engagement = calcEngagement({
              views:    v.view_count    ?? 0,
              likes:    v.like_count    ?? 0,
              comments: v.comment_count ?? 0,
              shares:   v.share_count   ?? 0,
            });

            await supabase.from('video_metrics').insert({
              video_id:        upserted.id,
              user_id:         user.id,
              view_count:      v.view_count    ?? 0,
              like_count:      v.like_count    ?? 0,
              comment_count:   v.comment_count ?? 0,
              share_count:     v.share_count   ?? 0,
              engagement_rate: engagement,
            });

            summary.videos_synced++;
          }
        }
      }
    } catch (videoErr) {
      console.error('[tiktok/sync] video sync error:', videoErr.message);
      summary.video_access = 'error';
      summary.video_error  = videoErr.message;
    }
  }

  // ── 3. Update last_synced_at ─────────────────────────────────────────────────
  await supabase
    .from('creator_social_accounts')
    .update({
      last_synced_at:    new Date().toISOString(),
      connection_status: 'connected',
      last_error:        null,
      updated_at:        new Date().toISOString(),
    })
    .eq('id', account.id);

  return sendOk(res, summary);
};
