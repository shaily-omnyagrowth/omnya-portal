// api/social/verify-video-link.js
//
// POST /api/social/verify-video-link
//   Headers: Authorization: Bearer <supabase-jwt>
//   Body:    { url: string, submissionId?: uuid, creatorId?: uuid }
//
// Single video link verification for TikTok, Instagram, YouTube and Facebook
// (spec 0003). Every video is checked through the creator's connected login on
// that platform, which proves ownership, then verified views and analytics are
// written.

const { applyCors } = require('../_utils/cors');
const { requireRole, normalizeRole } = require('../_utils/auth');
const { Errors, sendOk } = require('../_utils/errors');
const { applyRateLimit } = require('../_utils/rateLimit');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const { fetchOwnVideo } = require('../_utils/socialPublic');
const { detectPlatformFromUrl } = require('../_utils/analytics');

const PLATFORM_LABELS = { tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram', facebook: 'Facebook' };

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  const ctx = await requireRole(req, res, ['creator', 'am', 'account_manager', 'owner']);
  if (!ctx) return;

  // Rate limit: 10 video verifications per minute per user
  const blocked = await applyRateLimit(req, res, {
    max: 10,
    windowSecs: 60,
    endpoint: 'verify-video-link',
    userId: ctx.user.id,
  });
  if (blocked) return;

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const rawUrl = body && typeof body.url === 'string' ? body.url.trim() : '';
  const submissionId = body && typeof body.submissionId === 'string' ? body.submissionId.trim() : null;
  const creatorId = body && typeof body.creatorId === 'string' ? body.creatorId.trim() : null;

  if (!rawUrl) {
    return Errors.badRequest(res, 'A video link is required.');
  }

  const supabase = getSupabaseAdminClient();
  const role = normalizeRole(ctx.profile.role);

  // 1. Work out whose video this is and check the caller may verify it
  let sub = null;
  let target = null; // { user_id, am_id } of the creator
  if (submissionId) {
    const { data, error: subErr } = await supabase
      .from('submissions')
      .select('id, creator_id, campaign_id, platform, view_count_verified, creators!inner(user_id, am_id)')
      .eq('id', submissionId)
      .maybeSingle();

    if (subErr || !data) {
      return Errors.notFound(res, 'Submission not found.');
    }
    sub = data;
    target = sub.creators;
  } else if (creatorId && role !== 'creator') {
    const { data } = await supabase
      .from('creators')
      .select('user_id, am_id')
      .eq('id', creatorId)
      .maybeSingle();
    if (!data) return Errors.notFound(res, 'Creator not found.');
    target = data;
  }

  if (target) {
    // Role check: creators can only verify their own videos
    if (role === 'creator' && target.user_id !== ctx.user.id) {
      return Errors.forbidden(res, 'You may only verify your own submissions.');
    }

    // AMs can only verify their assigned creators
    if (role === 'am') {
      const { data: amRecord } = await supabase
        .from('account_managers')
        .select('id')
        .eq('user_id', ctx.user.id)
        .maybeSingle();
      if (!amRecord || target.am_id !== amRecord.id) {
        return Errors.forbidden(res, 'You may only verify submissions for creators assigned to you.');
      }
    }
  }

  const ownerUserId = role === 'creator' ? ctx.user.id : (target && target.user_id) || null;

  // 2. Only through the creator's connected login on that platform
  const fetchResult = await fetchOwnVideo(supabase, ownerUserId, rawUrl);
  const label = PLATFORM_LABELS[detectPlatformFromUrl(rawUrl)] || 'that platform';

  if (!fetchResult.ok) {
    if (fetchResult.kind === 'not_connected') {
      return Errors.unprocessable(res, `Connect ${label} on the Social Channels page to verify ${label} videos.`, { code: 'not_connected' });
    }
    if (fetchResult.kind === 'not_linked') {
      return Errors.unprocessable(res, "Your Facebook login doesn't include any Pages. Reconnect Facebook and select your Page.", { code: fetchResult.error });
    }
    if (fetchResult.kind === 'not_yours') {
      return Errors.unprocessable(res, `This video isn't on the connected ${label} account.`, { code: 'author_mismatch' });
    }
    if (fetchResult.kind === 'provider') {
      return Errors.badGateway(res, `${label} is unavailable right now. Please try again in a few moments.`);
    }
    if (fetchResult.kind === 'not_supported') {
      return Errors.badRequest(res, 'Paste a TikTok, Instagram, YouTube or Facebook video link.');
    }
    return Errors.badRequest(res, `Could not read the video from this ${label} link.`);
  }

  const video = fetchResult.video;
  let updatedSubmission = null;

  // 3. Reject a video already tracked on another submission
  const { data: existing } = await supabase
    .from('video_analytics')
    .select('submission_id')
    .eq('platform', fetchResult.platform)
    .eq('video_id', video.id)
    .maybeSingle();
  if (existing && (!sub || existing.submission_id !== sub.id)) {
    return Errors.unprocessable(res, 'This video has already been submitted.', { code: 'duplicate_video' });
  }

  // 4. Persist verified views and metrics
  if (sub) {
    const newViews = Math.max(Number(sub.view_count_verified || 0), Number(video.views || 0));
    const nowIso = new Date().toISOString();

    const updatePayload = {
      view_count_verified: newViews,
      view_count_verified_at: nowIso,
      verified_views_source: 'oauth',
      posted_link: fetchResult.resolvedUrl,
      posted_url: fetchResult.resolvedUrl,
      likes: video.likes || 0,
      comments: video.comments || 0,
      shares: video.shares || 0,
      saves: video.saves || 0,
      views_24h: video.views || 0,
      analytics_synced_at: nowIso,
    };

    const { data: updated, error: updateErr } = await supabase
      .from('submissions')
      .update(updatePayload)
      .eq('id', sub.id)
      .select()
      .single();

    if (updateErr) {
      console.error('[verify-video-link] submission update failed:', updateErr.message);
    } else {
      updatedSubmission = updated;
    }

    // Save the thumbnail in its own write
    if (video.thumbnailUrl) {
      const { error: thumbErr } = await supabase
        .from('submissions')
        .update({ thumbnail_url: video.thumbnailUrl })
        .eq('id', sub.id);
      if (thumbErr) console.error('[verify-video-link] thumbnail not saved:', thumbErr.message);
    }

    // Upsert into video_analytics
    try {
      await supabase.from('video_analytics').upsert({
        submission_id: sub.id,
        creator_id: sub.creator_id,
        campaign_id: sub.campaign_id,
        platform: fetchResult.platform,
        video_id: video.id,
        video_url: fetchResult.resolvedUrl,
        view_count: video.views,
        like_count: video.likes,
        comment_count: video.comments,
        share_count: video.shares,
        raw_metrics: video.raw,
        pulled_at: nowIso,
      }, { onConflict: 'submission_id' });
    } catch (anErr) {
      console.error('[verify-video-link] video_analytics upsert error:', anErr && anErr.message);
    }
  }

  return sendOk(res, {
    verified: true,
    authorMatches: true,
    platform: fetchResult.platform,
    resolvedUrl: fetchResult.resolvedUrl,
    video,
    submission: updatedSubmission,
  });
};
