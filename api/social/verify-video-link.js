// api/social/verify-video-link.js
//
// POST /api/social/verify-video-link
//   Headers: Authorization: Bearer <supabase-jwt>
//   Body:    { url: string, handle: string, platform?: string, submissionId?: uuid }
//
// Single video link verification for TikTok, Instagram, and YouTube (spec 0003).
// For TikTok it first asks TikTok through the creator's connected login, which
// proves ownership. Otherwise it unrolls mobile redirects, queries ScrapeCreators
// for the single video, confirms that the author returned by the provider matches
// the creator handle, and writes verified views and analytics.

const { applyCors } = require('../_utils/cors');
const { requireRole, normalizeRole } = require('../_utils/auth');
const { Errors, sendOk } = require('../_utils/errors');
const { applyRateLimit } = require('../_utils/rateLimit');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const { fetchPublicVideo, fetchOwnTikTokVideo, isAuthorMatch, normalizeHandle } = require('../_utils/socialPublic');

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
  const rawHandle = body && typeof body.handle === 'string' ? body.handle.trim() : '';
  const platform = body && typeof body.platform === 'string' ? body.platform.trim() : '';
  const submissionId = body && typeof body.submissionId === 'string' ? body.submissionId.trim() : null;

  if (!rawUrl) {
    return Errors.badRequest(res, 'A video link is required.');
  }
  if (!rawHandle) {
    return Errors.badRequest(res, 'An account handle is required to verify ownership.');
  }

  const supabase = getSupabaseAdminClient();
  const role = normalizeRole(ctx.profile.role);

  // 1. If submissionId was passed, load it and check the caller may verify it
  let sub = null;
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

    // Role check: creators can only update their own submissions
    const creatorUserId = sub.creators?.user_id;
    if (role === 'creator' && creatorUserId !== ctx.user.id) {
      return Errors.forbidden(res, 'You may only verify your own submissions.');
    }

    // AMs can only update their assigned creators
    if (role === 'am') {
      const { data: amRecord } = await supabase
        .from('account_managers')
        .select('id')
        .eq('user_id', ctx.user.id)
        .maybeSingle();
      if (!amRecord || sub.creators?.am_id !== amRecord.id) {
        return Errors.forbidden(res, 'You may only verify submissions for creators assigned to you.');
      }
    }
  }

  // 2. TikTok: ask TikTok through the creator's connected login first
  const ownerUserId = sub ? sub.creators?.user_id : (role === 'creator' ? ctx.user.id : null);
  let fetchResult = await fetchOwnTikTokVideo(supabase, ownerUserId, rawUrl).catch((err) => {
    console.error('[verify-video-link] TikTok login lookup failed:', err && err.message);
    return null;
  });

  if (fetchResult) {
    if (!fetchResult.video.authorHandle) fetchResult.video.authorHandle = normalizeHandle(rawHandle);
  } else {
    // 3. Otherwise fetch the single video from the provider
    fetchResult = await fetchPublicVideo({ url: rawUrl, platform });
    if (!fetchResult.ok) {
      if (fetchResult.kind === 'provider') {
        return Errors.badGateway(res, 'Social data service is currently unavailable. Please try again in a few moments.');
      }
      if (fetchResult.kind === 'not_found') {
        return Errors.notFound(res, 'Video could not be found. Please check that the link is correct and publicly viewable.');
      }
      return Errors.badRequest(res, fetchResult.error || 'Could not fetch video details.');
    }

    // Author verification
    if (!isAuthorMatch(fetchResult.video.authorHandle, rawHandle)) {
      return Errors.unprocessable(
        res,
        `This video was posted by @${fetchResult.video.authorHandle || 'another account'}, not @${normalizeHandle(rawHandle)}.`,
        {
          code: 'author_mismatch',
          actualAuthor: fetchResult.video.authorHandle,
          expectedAuthor: normalizeHandle(rawHandle),
        }
      );
    }
  }

  const video = fetchResult.video;
  let updatedSubmission = null;

  // 4. Persist verified views and metrics
  if (sub) {
    const newViews = Math.max(Number(sub.view_count_verified || 0), Number(video.views || 0));
    const nowIso = new Date().toISOString();

    const updatePayload = {
      view_count_verified: newViews,
      view_count_verified_at: nowIso,
      verified_views_source: fetchResult.source === 'oauth' ? 'oauth' : 'link',
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
