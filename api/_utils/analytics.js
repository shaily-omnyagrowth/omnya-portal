// api/_utils/analytics.js
//
// Shared analytics-sync logic used by:
//   - api/analytics/sync.js          (cron, all-creators)
//   - api/analytics/manual-sync.js   (JWT user-initiated, scoped)
//
// Responsibilities:
//   - detect platform from a posted-link URL
//   - extract platform-specific video id
//   - refresh per-platform OAuth tokens when expired (where supported)
//   - fetch metrics per platform (TikTok, YouTube, Meta/IG, Facebook)
//   - normalize into the canonical video_analytics shape
//   - upsert and update creator_tokens.last_synced_at / last_error
//
// Designed to never throw out of syncSubmissions(); errors are caught per
// submission and returned in the result summary.

const { getSupabaseAdminClient } = require('./supabaseAdmin');

// -----------------------------------------------------------------------------
// URL parsing
// -----------------------------------------------------------------------------

function detectPlatformFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const u = url.toLowerCase();
  if (u.includes('tiktok.com') || u.includes('vm.tiktok')) return 'tiktok';
  if (u.includes('instagram.com')) return 'instagram';
  if (u.includes('facebook.com') || u.includes('fb.watch')) return 'facebook';
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  return null;
}

function extractTikTokVideoId(url) {
  const m = url.match(/\/video\/(\d+)/);
  return m ? m[1] : null;
}

function extractInstagramShortcode(url) {
  const m = url.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

function extractFacebookVideoId(url) {
  // Many shapes: /videos/123, /watch/?v=123, /<page>/posts/123, fb.watch/<id>
  const v = url.match(/[?&]v=(\d+)/);
  if (v) return v[1];
  const w = url.match(/\/videos\/(?:\w+\/)?(\d+)/);
  if (w) return w[1];
  const p = url.match(/\/posts\/(\d+)/);
  if (p) return p[1];
  const s = url.match(/fb\.watch\/([A-Za-z0-9_-]+)/);
  if (s) return s[1];
  return null;
}

function extractYouTubeVideoId(url) {
  // youtube.com/watch?v=ID, youtu.be/ID, youtube.com/shorts/ID
  const watch = url.match(/[?&]v=([A-Za-z0-9_-]{6,})/);
  if (watch) return watch[1];
  const shorty = url.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/);
  if (shorty) return shorty[1];
  const shorts = url.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/);
  if (shorts) return shorts[1];
  return null;
}

function extractVideoId(platform, url) {
  switch (platform) {
    case 'tiktok':    return extractTikTokVideoId(url);
    case 'instagram': return extractInstagramShortcode(url);
    case 'facebook':  return extractFacebookVideoId(url);
    case 'youtube':   return extractYouTubeVideoId(url);
    default:          return null;
  }
}

// -----------------------------------------------------------------------------
// Engagement rate
// -----------------------------------------------------------------------------

function calculateEngagementRate({ views, likes, comments, shares, saves }) {
  const v = Number(views) || 0;
  if (v <= 0) return 0;
  const engagements = (Number(likes) || 0) + (Number(comments) || 0) + (Number(shares) || 0) + (Number(saves) || 0);
  return Math.round((engagements / v) * 10000) / 100; // percent with 2 decimals
}

// -----------------------------------------------------------------------------
// Token expiry + refresh
// -----------------------------------------------------------------------------

function isExpired(token) {
  if (!token || !token.expires_at) return false;
  return new Date(token.expires_at).getTime() < Date.now();
}

// TikTok refresh:
//   POST https://open.tiktokapis.com/v2/oauth/token/
//   grant_type=refresh_token
async function refreshTikTokToken(supabase, token) {
  const clientKey = process.env.TIKTOK_CLIENT_KEY || process.env.TIKTOK_APP_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET || process.env.TIKTOK_APP_SECRET;
  if (!clientKey || !clientSecret || !token.refresh_token) return null;

  const resp = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.access_token) return null;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || token.refresh_token,
    expires_at: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null,
    refresh_expires_at: data.refresh_expires_in
      ? new Date(Date.now() + data.refresh_expires_in * 1000).toISOString()
      : token.refresh_expires_at,
  };
}

// YouTube refresh:
//   POST https://oauth2.googleapis.com/token
//   grant_type=refresh_token
async function refreshYouTubeToken(supabase, token) {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret || !token.refresh_token) return null;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.access_token) return null;
  return {
    access_token: data.access_token,
    refresh_token: token.refresh_token, // Google rarely re-issues refresh_token
    expires_at: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null,
  };
}

// Instagram Business long-lived tokens can be refreshed before they expire.
// No client_id/secret required — just the current long-lived token.
async function refreshInstagramToken(supabase, token) {
  try {
    const params = new URLSearchParams({
      grant_type: 'ig_refresh_token',
      access_token: token.access_token,
    });
    const resp = await fetch(`https://graph.instagram.com/refresh_access_token?${params.toString()}`);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.access_token) return null;
    return {
      access_token: data.access_token,
      refresh_token: null,
      expires_at: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null,
    };
  } catch {
    return null;
  }
}

// Meta Facebook tokens (meta/facebook platforms) have no refresh flow; creator must reconnect.
async function refreshMetaToken() {
  return null;
}

async function refreshTokenIfNeeded(supabase, token) {
  if (!token) return null;
  if (!isExpired(token)) return token;

  let refreshed = null;
  if (token.platform === 'tiktok') refreshed = await refreshTikTokToken(supabase, token);
  else if (token.platform === 'youtube') refreshed = await refreshYouTubeToken(supabase, token);
  else if (token.platform === 'instagram' && token.metadata?.provider === 'instagram') {
    refreshed = await refreshInstagramToken(supabase, token);
  } else if (token.platform === 'meta' || token.platform === 'facebook') {
    refreshed = await refreshMetaToken(supabase, token);
  }

  if (!refreshed) {
    // Mark expired so the UI can show Reconnect.
    await supabase
      .from('creator_tokens')
      .update({
        status: 'expired',
        last_error: 'Token expired and could not be refreshed',
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', token.user_id)
      .eq('platform', token.platform);
    return null;
  }

  await supabase
    .from('creator_tokens')
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || token.refresh_token,
      expires_at: refreshed.expires_at,
      refresh_expires_at: refreshed.refresh_expires_at || token.refresh_expires_at,
      status: 'connected',
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', token.user_id)
    .eq('platform', token.platform);

  return { ...token, ...refreshed };
}

// -----------------------------------------------------------------------------
// Per-platform metric fetchers — each returns the normalized shape or null on
// failure. Internal errors are logged via console.warn (no token leak).
// -----------------------------------------------------------------------------

async function fetchTikTokMetrics(token, submission) {
  const resp = await fetch(
    'https://open.tiktokapis.com/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ filters: { video_ids: [submission.videoId] } }),
    }
  );
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) return { error: data?.error?.message || `tiktok_http_${resp.status}` };
  const video = data?.data?.videos?.[0];
  if (!video) return { error: 'tiktok_video_not_found' };
  return {
    views: video.view_count || 0,
    likes: video.like_count || 0,
    comments: video.comment_count || 0,
    shares: video.share_count || 0,
    saves: 0,
    raw: video,
  };
}

async function fetchYouTubeMetrics(token, submission) {
  const resp = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(submission.videoId)}`,
    { headers: { Authorization: `Bearer ${token.access_token}` } }
  );
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) return { error: data?.error?.message || `youtube_http_${resp.status}` };
  const item = data?.items?.[0];
  if (!item) return { error: 'youtube_video_not_found' };
  const s = item.statistics || {};
  return {
    views: Number(s.viewCount || 0),
    likes: Number(s.likeCount || 0),
    comments: Number(s.commentCount || 0),
    shares: 0,
    saves: 0,
    raw: s,
  };
}

// New Instagram Business API (graph.instagram.com) — tokens issued by instagram/callback.js.
async function fetchInstagramBusinessMetrics(token, submission) {
  const userId = token.platform_user_id;
  if (!userId) return { error: 'ig_missing_user_id' };

  const mediaResp = await fetch(
    `https://graph.instagram.com/v21.0/${userId}/media?fields=id,shortcode,like_count,comments_count,media_type&access_token=${encodeURIComponent(token.access_token)}`
  );
  const mediaData = await mediaResp.json().catch(() => ({}));
  if (!mediaResp.ok) return { error: mediaData?.error?.message || `ig_media_http_${mediaResp.status}` };

  const match = mediaData?.data?.find((m) => m.shortcode === submission.videoId);
  if (!match) return { error: 'ig_media_not_found' };

  let views = 0;
  let reach = 0;
  try {
    const insightsResp = await fetch(
      `https://graph.instagram.com/v21.0/${match.id}/insights?metric=impressions,reach&access_token=${encodeURIComponent(token.access_token)}`
    );
    const insightsData = await insightsResp.json().catch(() => ({}));
    if (insightsResp.ok && Array.isArray(insightsData.data)) {
      const byName = Object.fromEntries(insightsData.data.map((d) => [d.name, d.values?.[0]?.value || 0]));
      views = byName.impressions || 0;
      reach = byName.reach || 0;
    }
  } catch { /* non-fatal */ }

  return {
    views,
    likes: match.like_count || 0,
    comments: match.comments_count || 0,
    shares: 0,
    saves: 0,
    reach,
    raw: match,
  };
}

// Legacy: Facebook-issued token via meta/callback (provider='meta'). Kept for
// tokens connected before the Instagram Business Login migration.
async function fetchInstagramViaMetaMetrics(token, submission) {
  const accountsResp = await fetch(
    `https://graph.facebook.com/v19.0/me/accounts?fields=instagram_business_account&access_token=${encodeURIComponent(token.access_token)}`
  );
  const accountsData = await accountsResp.json().catch(() => ({}));
  if (!accountsResp.ok) return { error: accountsData?.error?.message || `ig_accounts_http_${accountsResp.status}` };

  const igAccountId = accountsData?.data?.find((p) => p.instagram_business_account)?.instagram_business_account?.id;
  if (!igAccountId) return { error: 'ig_no_business_account' };

  const mediaResp = await fetch(
    `https://graph.facebook.com/v19.0/${igAccountId}/media?fields=id,shortcode,like_count,comments_count,media_type&access_token=${encodeURIComponent(token.access_token)}`
  );
  const mediaData = await mediaResp.json().catch(() => ({}));
  if (!mediaResp.ok) return { error: mediaData?.error?.message || `ig_media_http_${mediaResp.status}` };

  const match = mediaData?.data?.find((m) => m.shortcode === submission.videoId);
  if (!match) return { error: 'ig_media_not_found' };

  let reach = 0;
  let views = 0;
  try {
    const insightsResp = await fetch(
      `https://graph.facebook.com/v19.0/${match.id}/insights?metric=impressions,reach&access_token=${encodeURIComponent(token.access_token)}`
    );
    const insightsData = await insightsResp.json().catch(() => ({}));
    if (insightsResp.ok && Array.isArray(insightsData.data)) {
      const byName = Object.fromEntries(insightsData.data.map((d) => [d.name, d.values?.[0]?.value || 0]));
      reach = byName.reach || 0;
      views = byName.impressions || 0;
    }
  } catch { /* permission errors are non-fatal */ }

  return {
    views,
    likes: match.like_count || 0,
    comments: match.comments_count || 0,
    shares: 0,
    saves: 0,
    reach,
    raw: match,
  };
}

async function fetchInstagramMetrics(token, submission) {
  // Route to the correct API based on which OAuth flow issued the token.
  if (token.metadata?.provider === 'instagram') {
    return fetchInstagramBusinessMetrics(token, submission);
  }
  return fetchInstagramViaMetaMetrics(token, submission);
}

async function fetchFacebookMetrics(token, submission) {
  const resp = await fetch(
    `https://graph.facebook.com/v19.0/${encodeURIComponent(submission.videoId)}?fields=likes.summary(true),comments.summary(true),shares&access_token=${encodeURIComponent(token.access_token)}`
  );
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) return { error: data?.error?.message || `fb_http_${resp.status}` };
  return {
    views: 0, // requires page-insights scope; left at 0
    likes: data?.likes?.summary?.total_count || 0,
    comments: data?.comments?.summary?.total_count || 0,
    shares: data?.shares?.count || 0,
    saves: 0,
    raw: data,
  };
}

async function fetchPlatformMetrics(token, submission) {
  switch (token.platform) {
    case 'tiktok':    return fetchTikTokMetrics(token, submission);
    case 'youtube':   return fetchYouTubeMetrics(token, submission);
    case 'instagram':
    case 'meta':      return fetchInstagramMetrics(token, submission);
    case 'facebook':  return fetchFacebookMetrics(token, submission);
    default:          return { error: 'unsupported_platform' };
  }
}

// -----------------------------------------------------------------------------
// Upsert into video_analytics
// -----------------------------------------------------------------------------

async function upsertVideoAnalytics(supabase, row) {
  const { error } = await supabase
    .from('video_analytics')
    .upsert(row, { onConflict: 'submission_id' });
  return error;
}

// -----------------------------------------------------------------------------
// Main entry: syncSubmissions
//
// Given an array of submissions (id, creator_id, campaign_id, platform,
// posted_link, creators.user_id), fetches metrics for each and writes them.
// Returns a summary.
// -----------------------------------------------------------------------------

async function syncSubmissions(supabase, submissions) {
  const summary = { processed: 0, updated: 0, failed: 0, skipped: 0, errors: [] };
  if (!Array.isArray(submissions) || submissions.length === 0) return summary;

  // 1. Group by (user_id, platform) to minimize token lookups.
  const groups = new Map(); // key: `${userId}_${platform}` -> { userId, platform, submissions[] }
  for (const sub of submissions) {
    const userId = sub.creators?.user_id || sub.user_id;
    if (!userId) {
      summary.skipped += 1;
      summary.errors.push({ submission_id: sub.id, reason: 'missing_user_id' });
      continue;
    }
    const platform = (sub.platform || detectPlatformFromUrl(sub.posted_link) || '').toLowerCase();
    if (!platform) {
      summary.skipped += 1;
      summary.errors.push({ submission_id: sub.id, reason: 'platform_unknown' });
      continue;
    }
    const videoId = extractVideoId(platform, sub.posted_link);
    if (!videoId) {
      summary.skipped += 1;
      summary.errors.push({ submission_id: sub.id, reason: 'video_id_unparseable' });
      continue;
    }
    const key = `${userId}_${platform}`;
    if (!groups.has(key)) groups.set(key, { userId, platform, submissions: [] });
    groups.get(key).submissions.push({ ...sub, videoId, user_id: userId });
  }

  // 2. Fetch tokens for all needed (user_id, platform) pairs.
  const userIds = [...new Set([...groups.values()].map((g) => g.userId))];
  if (userIds.length === 0) return summary;

  const { data: tokens, error: tokensErr } = await supabase
    .from('creator_tokens')
    .select('id, user_id, platform, access_token, refresh_token, expires_at, refresh_expires_at, status')
    .in('user_id', userIds)
    .not('access_token', 'is', null);

  if (tokensErr) {
    summary.errors.push({ reason: `tokens_fetch_failed: ${tokensErr.message}` });
    return summary;
  }
  const tokenIndex = new Map();
  for (const t of tokens || []) {
    // Meta token covers instagram + facebook calls.
    if (t.platform === 'meta') {
      tokenIndex.set(`${t.user_id}_instagram`, t);
      tokenIndex.set(`${t.user_id}_facebook`, t);
      tokenIndex.set(`${t.user_id}_meta`, t);
    } else {
      tokenIndex.set(`${t.user_id}_${t.platform}`, t);
    }
  }

  // 3. Process each group.
  for (const { userId, platform, submissions: groupSubs } of groups.values()) {
    let token = tokenIndex.get(`${userId}_${platform}`);
    if (!token) {
      summary.skipped += groupSubs.length;
      for (const s of groupSubs) summary.errors.push({ submission_id: s.id, reason: 'no_token' });
      continue;
    }

    token = await refreshTokenIfNeeded(supabase, token);
    if (!token) {
      summary.failed += groupSubs.length;
      for (const s of groupSubs) summary.errors.push({ submission_id: s.id, reason: 'token_refresh_failed' });
      continue;
    }

    let groupHadError = null;
    for (const sub of groupSubs) {
      summary.processed += 1;
      const result = await fetchPlatformMetrics({ ...token, platform }, sub);
      if (result.error) {
        summary.failed += 1;
        summary.errors.push({ submission_id: sub.id, platform, reason: result.error });
        groupHadError = result.error;
        continue;
      }
      const engagementRate = calculateEngagementRate(result);
      const row = {
        user_id: userId,
        creator_id: sub.creator_id,
        submission_id: sub.id,
        campaign_id: sub.campaign_id,
        platform,
        video_id: sub.videoId,
        video_url: sub.posted_link,
        views: result.views || 0,
        likes: result.likes || 0,
        comments: result.comments || 0,
        shares: result.shares || 0,
        saves: result.saves || 0,
        reach: result.reach || 0,
        engagement_rate: engagementRate,
        raw_metrics: result.raw || {},
        pulled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const upsertErr = await upsertVideoAnalytics(supabase, row);
      if (upsertErr) {
        summary.failed += 1;
        summary.errors.push({ submission_id: sub.id, reason: `upsert_failed: ${upsertErr.message}` });
      } else {
        summary.updated += 1;
      }
    }

    // 4. Update the token's last_synced_at + last_error.
    await supabase
      .from('creator_tokens')
      .update({
        last_synced_at: new Date().toISOString(),
        last_error: groupHadError || null,
        status: groupHadError ? 'error' : 'connected',
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('platform', token.platform);
  }

  return summary;
}

// -----------------------------------------------------------------------------
// Submissions query helpers — used by both sync entry points.
// -----------------------------------------------------------------------------

const SUBMISSION_SELECT =
  'id, creator_id, campaign_id, platform, posted_link, submission_type, creators!inner(user_id)';

async function fetchAllFinalSubmissions(supabase) {
  const { data, error } = await supabase
    .from('submissions')
    .select(SUBMISSION_SELECT)
    .not('posted_link', 'is', null)
    .not('posted_link', 'eq', '')
    .eq('submission_type', 'Final Post');
  if (error) throw new Error(`submissions_fetch_failed: ${error.message}`);
  return data || [];
}

async function fetchSubmissionsByIds(supabase, submissionIds) {
  if (!submissionIds || submissionIds.length === 0) return [];
  const { data, error } = await supabase
    .from('submissions')
    .select(SUBMISSION_SELECT)
    .in('id', submissionIds)
    .not('posted_link', 'is', null);
  if (error) throw new Error(`submissions_fetch_failed: ${error.message}`);
  return data || [];
}

async function fetchSubmissionsForUser(supabase, userId, platform) {
  const q = supabase
    .from('submissions')
    .select(SUBMISSION_SELECT)
    .eq('creators.user_id', userId)
    .not('posted_link', 'is', null)
    .eq('submission_type', 'Final Post');
  const { data, error } = platform ? await q.eq('platform', platform) : await q;
  if (error) throw new Error(`submissions_fetch_failed: ${error.message}`);
  return data || [];
}

module.exports = {
  // URL parsing
  detectPlatformFromUrl,
  extractVideoId,
  // Math
  calculateEngagementRate,
  // Token refresh
  isExpired,
  refreshTokenIfNeeded,
  // Per-platform fetchers (exported for testing; sync uses fetchPlatformMetrics)
  fetchPlatformMetrics,
  // Storage
  upsertVideoAnalytics,
  // Main
  syncSubmissions,
  // Query helpers
  fetchAllFinalSubmissions,
  fetchSubmissionsByIds,
  fetchSubmissionsForUser,
};
