// api/_utils/analytics.js
//
// Shared analytics-sync logic used by:
//   - api/analytics/sync.js          (cron, all-creators)
//   - api/analytics/manual-sync.js   (JWT user-initiated, scoped)
//
// Responsibilities:
//   - resolve share/short links, detect platform, extract the post id
//   - refresh per-platform OAuth tokens lazily, on the read path (F-4)
//   - fetch metrics per platform (TikTok, YouTube, Meta/IG, Facebook)
//   - normalize into the canonical video_analytics shape
//   - upsert and update creator_social_accounts.last_synced_at / last_error
//
// F-3/F-4/F-13: tokens come from creator_social_accounts and are encrypted at
// rest. They are decrypted here, in memory, immediately before the provider
// call — and refreshed first if they are near expiry, which is the whole point
// of doing it on the read path rather than hoping the cron got there first.
//
// Designed to never throw out of syncSubmissions(); errors are caught per
// submission and returned in the result summary.

const { getSupabaseAdminClient } = require('./supabaseAdmin');
const { decrypt } = require('./encryption');
const { refreshIfNeeded } = require('./tokenRefresh');
const { STATUS_REAUTH } = require('./socialAccounts');
const { facebookGraph, instagramGraph } = require('./meta');

// The creator submit form (src/App.js) writes submission_type 'Final'. Older
// rows, the seed fixtures and the test harness use 'Final Post'. Filtering on
// 'Final Post' alone matched none of the posts creators actually submit, so
// neither the cron nor "Sync Now" ever pulled a number for them.
const FINAL_SUBMISSION_TYPES = ['Final', 'Final Post'];

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

// submissions.platform holds the submit form's dropdown label ('TikTok',
// 'Instagram', 'Facebook', 'YouTube'); campaign formats use 'IG Reel',
// 'FB Reel' and 'YouTube Short'.
function normalizePlatformLabel(label) {
  const l = String(label || '').trim().toLowerCase();
  if (!l) return null;
  if (l.includes('tiktok')) return 'tiktok';
  if (l.includes('instagram') || /^ig\b/.test(l)) return 'instagram';
  if (l.includes('facebook') || /^fb\b/.test(l)) return 'facebook';
  if (l.includes('youtube') || /^yt\b/.test(l)) return 'youtube';
  return null;
}

// The link is the ground truth. The dropdown defaults to TikTok and is easy to
// leave unchanged, and routing an Instagram link through a TikTok token can
// only fail — so the URL wins and the label is the fallback.
function resolvePlatform(sub) {
  if (!sub) return null;
  return detectPlatformFromUrl(sub.posted_link) || normalizePlatformLabel(sub.platform);
}

function extractTikTokVideoId(url) {
  // /@user/video/<id>, and /@user/photo/<id> for photo-mode posts.
  const m = url.match(/\/(?:video|photo)\/(\d+)/);
  return m ? m[1] : null;
}

function extractInstagramShortcode(url) {
  // An unresolved /share/ link carries an opaque token, not a shortcode.
  if (/instagram\.com\/share\//i.test(url)) return null;
  // /p/, /reel/, /reels/, /tv/ — optionally after /<username>/, which is how
  // Instagram's own share sheet has formatted links since 2024.
  const m = url.match(/instagram\.com\/(?:[A-Za-z0-9._]+\/)?(?:p|reels?|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

function extractFacebookVideoId(url) {
  // fb.watch and /share/ links are opaque until resolved; their path token is
  // not a Graph object id, and passing it to the API only produces an error.
  if (/fb\.watch\/|facebook\.com\/share\//i.test(url)) return null;
  // permalink.php?story_fbid=<post>&id=<page> -> the <page>_<post> Graph id.
  const story = url.match(/[?&]story_fbid=(\d+)/);
  if (story) {
    const owner = url.match(/[?&]id=(\d+)/);
    return owner ? `${owner[1]}_${story[1]}` : story[1];
  }
  const v = url.match(/[?&]v=(\d+)/);
  if (v) return v[1];
  const w = url.match(/\/videos\/(?:[\w.-]+\/)?(\d+)/);
  if (w) return w[1];
  const r = url.match(/\/reels?\/(\d+)/);
  if (r) return r[1];
  const p = url.match(/\/posts\/(\d+)/);
  if (p) return p[1];
  return null;
}

function extractYouTubeVideoId(url) {
  // youtube.com/watch?v=ID, youtu.be/ID, youtube.com/{shorts,live,embed}/ID
  const watch = url.match(/[?&]v=([A-Za-z0-9_-]{6,})/);
  if (watch) return watch[1];
  const shorty = url.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/);
  if (shorty) return shorty[1];
  const path = url.match(/youtube\.com\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{6,})/);
  if (path) return path[1];
  return null;
}

function extractVideoId(platform, url) {
  if (!url || typeof url !== 'string') return null;
  switch (platform) {
    case 'tiktok':    return extractTikTokVideoId(url);
    case 'instagram': return extractInstagramShortcode(url);
    case 'facebook':  return extractFacebookVideoId(url);
    case 'youtube':   return extractYouTubeVideoId(url);
    default:          return null;
  }
}

// Links copied from a phone's share sheet are usually redirects that carry no
// post id: vm.tiktok.com/ZM…, tiktok.com/t/…, fb.watch/…, facebook.com/share/…,
// instagram.com/share/…. Following the redirect once turns them into a
// canonical URL the extractors understand. Best-effort: on any failure the
// original link is returned and the submission is reported as unparseable.
const SHORT_LINK_PATTERNS = [
  /^(?:https?:\/\/)?(?:vm|vt)\.tiktok\.com\//i,
  /tiktok\.com\/t\//i,
  /fb\.watch\//i,
  /facebook\.com\/share\//i,
  /instagram\.com\/share\//i,
];
const SHORT_LINK_TIMEOUT_MS = 5000;

async function resolveShortLink(url) {
  if (!url || typeof url !== 'string') return url;
  const trimmed = url.trim();
  if (!SHORT_LINK_PATTERNS.some((re) => re.test(trimmed))) return trimmed;

  const target = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SHORT_LINK_TIMEOUT_MS);
  try {
    const resp = await fetch(target, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OmnyaAnalytics/1.0)' },
    });
    try { if (resp.body && resp.body.cancel) await resp.body.cancel(); } catch { /* body unused */ }
    return resp.url || trimmed;
  } catch {
    return trimmed;
  } finally {
    clearTimeout(timer);
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
//
// There is deliberately no refresh implementation in this file any more.
//
// There used to be one -- isExpired(), refreshTikTokToken(),
// refreshYouTubeToken(), refreshInstagramToken(), refreshMetaToken() and
// refreshTokenIfNeeded() -- writing plaintext back to creator_tokens. It was a
// second, divergent copy of api/_utils/tokenRefresh.js: it lacked Instagram's
// 24-hour minimum token age, it treated an unrefreshable Meta token as a hard
// failure rather than a reconnect prompt, and it stored the tokens in the clear.
//
// Everything now goes through refreshIfNeeded(), which is covered by
// tests/token-security.test.cjs. One refresh path, one set of rules.
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Provider errors
//
// A failure is one of three kinds, and only the first says anything about the
// connection itself:
//
//   auth     the token was refused — force a refresh, then ask for a reconnect
//   content  this one post could not be found — a bad link, not a bad account
//   other    rate limits, outages, missing page permissions — retry later
// -----------------------------------------------------------------------------

const TIKTOK_AUTH_CODES = new Set(['access_token_invalid', 'scope_not_authorized']);
const META_AUTH_CODES = new Set([102, 190]); // session invalid / OAuth token invalid or expired

function providerError(resp, data, fallback) {
  const e = (data && data.error) || {};
  const message = (typeof e === 'string' ? e : e.message || e.error_description) || fallback;
  const auth = resp.status === 401 || META_AUTH_CODES.has(e.code) || TIKTOK_AUTH_CODES.has(e.code);
  // Meta reports a missing object as code 100 / subcode 33.
  const content = !auth && (resp.status === 404 || (e.code === 100 && e.error_subcode === 33));
  return { error: message, auth, content };
}

function notFound(error) {
  return { error, auth: false, content: true };
}

// -----------------------------------------------------------------------------
// Per-platform metric fetchers — each returns the normalized shape or
// { error, auth, content }. `ctx` is per (account, sync run) scratch space for
// lookups that are the same for every submission in the group.
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
  // TikTok reports some failures as HTTP 200 with error.code set.
  const code = data && data.error && data.error.code;
  if (!resp.ok || (code && code !== 'ok')) {
    return providerError(resp, data, `tiktok_http_${resp.status}`);
  }
  const video = data?.data?.videos?.[0];
  if (!video) return notFound('tiktok_video_not_found');
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
  if (!resp.ok) return providerError(resp, data, `youtube_http_${resp.status}`);
  const item = data?.items?.[0];
  if (!item) return notFound('youtube_video_not_found');
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

// ── Instagram ────────────────────────────────────────────────────────────────

const IG_MEDIA_FIELDS = 'id,shortcode,like_count,comments_count,media_type,timestamp';

// Media lists are paged, 25 per page by default. Only the first page used to
// be read, so any post older than a creator's 25 most recent returned
// ig_media_not_found forever. The walk is cached on ctx, so a creator with ten
// submissions costs one walk rather than ten.
const IG_MEDIA_PAGE_SIZE = 100;
const IG_MAX_MEDIA_PAGES = 10;

async function findMediaByShortcode(ctx, firstPageUrl, shortcode) {
  if (!ctx.media) ctx.media = { byShortcode: new Map(), next: firstPageUrl, pages: 0 };
  const media = ctx.media;
  while (!media.byShortcode.has(shortcode) && media.next && media.pages < IG_MAX_MEDIA_PAGES) {
    const resp = await fetch(media.next);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return providerError(resp, data, `ig_media_http_${resp.status}`);
    media.pages += 1;
    for (const item of data.data || []) {
      if (item && item.shortcode) media.byShortcode.set(item.shortcode, item);
    }
    media.next = (data.paging && data.paging.next) || null;
  }
  const match = media.byShortcode.get(shortcode);
  return match ? { match } : notFound('ig_media_not_found');
}

// 'impressions' and 'plays' were retired on 2025-04-21 in favour of 'views'.
// Asking for a retired metric fails the whole request, which is why every
// Instagram post was syncing with 0 views and 0 reach. 'saved' and 'shares'
// are not valid on every media type, and one invalid metric fails the request
// too, so narrow the set rather than lose all of it.
const IG_METRIC_SETS = ['views,reach,saved,shares', 'views,reach', 'reach'];

async function fetchInstagramInsights(insightsUrl, accessToken) {
  for (const metrics of IG_METRIC_SETS) {
    try {
      const resp = await fetch(
        `${insightsUrl}?metric=${metrics}&access_token=${encodeURIComponent(accessToken)}`
      );
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && Array.isArray(data.data)) {
        return Object.fromEntries(data.data.map((d) => [
          d.name,
          Number((d.values && d.values[0] && d.values[0].value) ?? (d.total_value && d.total_value.value) ?? 0) || 0,
        ]));
      }
    } catch { /* try the narrower set */ }
  }
  return {};
}

function shapeInstagram(match, insights) {
  return {
    views: insights.views || 0,
    likes: match.like_count || 0,
    comments: match.comments_count || 0,
    shares: insights.shares || 0,
    saves: insights.saved || 0,
    reach: insights.reach || 0,
    raw: { ...match, insights },
  };
}

// Instagram Business Login (graph.instagram.com) — tokens issued by instagram/callback.js.
async function fetchInstagramBusinessMetrics(token, submission, ctx) {
  // 'me' always resolves to the account the token belongs to, so this does not
  // depend on which of Instagram's user ids was stored as platform_user_id.
  const firstPage =
    `${instagramGraph('me/media')}?fields=${IG_MEDIA_FIELDS}&limit=${IG_MEDIA_PAGE_SIZE}` +
    `&access_token=${encodeURIComponent(token.access_token)}`;
  const found = await findMediaByShortcode(ctx, firstPage, submission.videoId);
  if (found.error) return found;

  const insights = await fetchInstagramInsights(instagramGraph(`${found.match.id}/insights`), token.access_token);
  return shapeInstagram(found.match, insights);
}

// Legacy: Facebook-issued token via meta/callback (provider='meta'). Kept for
// tokens connected before the Instagram Business Login migration.
async function fetchInstagramViaMetaMetrics(token, submission, ctx) {
  if (!ctx.igAccountId) {
    const accountsResp = await fetch(
      `${facebookGraph('me/accounts')}?fields=instagram_business_account&limit=100` +
      `&access_token=${encodeURIComponent(token.access_token)}`
    );
    const accountsData = await accountsResp.json().catch(() => ({}));
    if (!accountsResp.ok) return providerError(accountsResp, accountsData, `ig_accounts_http_${accountsResp.status}`);

    const igAccountId = accountsData?.data?.find((p) => p.instagram_business_account)?.instagram_business_account?.id;
    if (!igAccountId) return { error: 'ig_no_business_account', auth: false, content: false };
    ctx.igAccountId = igAccountId;
  }

  const firstPage =
    `${facebookGraph(`${ctx.igAccountId}/media`)}?fields=${IG_MEDIA_FIELDS}&limit=${IG_MEDIA_PAGE_SIZE}` +
    `&access_token=${encodeURIComponent(token.access_token)}`;
  const found = await findMediaByShortcode(ctx, firstPage, submission.videoId);
  if (found.error) return found;

  const insights = await fetchInstagramInsights(facebookGraph(`${found.match.id}/insights`), token.access_token);
  return shapeInstagram(found.match, insights);
}

async function fetchInstagramMetrics(token, submission, ctx) {
  // Route to the correct API based on which OAuth flow issued the token.
  if (token.metadata?.provider === 'instagram') {
    return fetchInstagramBusinessMetrics(token, submission, ctx);
  }
  return fetchInstagramViaMetaMetrics(token, submission, ctx);
}

// ── Facebook ─────────────────────────────────────────────────────────────────

const FB_FIELDS = 'likes.summary(true),comments.summary(true),shares';
const FB_MAX_PAGES = 25;

function shapeFacebook(data) {
  return {
    views: 0, // requires page video insights; left at 0
    likes: data?.likes?.summary?.total_count || 0,
    comments: data?.comments?.summary?.total_count || 0,
    shares: data?.shares?.count || 0,
    saves: 0,
    raw: data,
  };
}

async function readFacebookObject(objectId, accessToken) {
  const resp = await fetch(
    `${facebookGraph(encodeURIComponent(objectId))}?fields=${FB_FIELDS}&access_token=${encodeURIComponent(accessToken)}`
  );
  const data = await resp.json().catch(() => ({}));
  return { resp, data };
}

async function fetchFacebookMetrics(token, submission, ctx) {
  const first = await readFacebookObject(submission.videoId, token.access_token);
  if (first.resp.ok) return shapeFacebook(first.data);

  const firstError = providerError(first.resp, first.data, `fb_http_${first.resp.status}`);
  if (firstError.auth) return firstError;

  // Posts and videos on a Page are generally only readable with that Page's
  // own access token, not the user token the creator authorized. Try each Page
  // the creator manages, with both the bare id and the <page>_<post> form.
  if (!ctx.pages) {
    const resp = await fetch(
      `${facebookGraph('me/accounts')}?fields=id,access_token&limit=${FB_MAX_PAGES}` +
      `&access_token=${encodeURIComponent(token.access_token)}`
    );
    const data = await resp.json().catch(() => ({}));
    ctx.pages = resp.ok && Array.isArray(data.data)
      ? data.data.filter((p) => p && p.id && p.access_token).slice(0, FB_MAX_PAGES)
      : [];
  }

  const videoId = String(submission.videoId);
  for (const page of ctx.pages) {
    const ids = videoId.includes('_') ? [videoId] : [videoId, `${page.id}_${videoId}`];
    for (const id of ids) {
      const attempt = await readFacebookObject(id, page.access_token);
      if (attempt.resp.ok) return shapeFacebook(attempt.data);
    }
  }
  return firstError;
}

async function fetchPlatformMetrics(token, submission, ctx = {}) {
  switch (token.platform) {
    case 'tiktok':    return fetchTikTokMetrics(token, submission);
    case 'youtube':   return fetchYouTubeMetrics(token, submission);
    case 'instagram':
    case 'meta':      return fetchInstagramMetrics(token, submission, ctx);
    case 'facebook':  return fetchFacebookMetrics(token, submission, ctx);
    default:          return { error: 'unsupported_platform', auth: false, content: false };
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
    const link = await resolveShortLink(sub.posted_link);
    const platform = resolvePlatform({ ...sub, posted_link: link });
    if (!platform) {
      summary.skipped += 1;
      summary.errors.push({ submission_id: sub.id, reason: 'platform_unknown' });
      continue;
    }
    const videoId = extractVideoId(platform, link);
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

  const { data: accounts, error: tokensErr } = await supabase
    .from('creator_social_accounts')
    .select(
      'id, user_id, platform, access_token_encrypted, refresh_token_encrypted, ' +
      'token_expires_at, refresh_token_expires_at, connection_status, metadata, ' +
      'created_at, updated_at'
    )
    .in('user_id', userIds)
    .not('access_token_encrypted', 'is', null);

  if (tokensErr) {
    summary.errors.push({ reason: `tokens_fetch_failed: ${tokensErr.message}` });
    return summary;
  }

  // The live CHECK constraint accepts tiktok | instagram | facebook | youtube.
  // 'meta' is not storable, so a Facebook-flow connection lands on the
  // 'facebook' row with metadata.provider = 'meta'. That one row is what serves
  // Instagram *and* Facebook metric calls, which is why it is indexed under
  // three keys here.
  const tokenIndex = new Map();
  for (const a of accounts || []) {
    const viaMeta = a.metadata && a.metadata.provider === 'meta';
    if (a.platform === 'facebook') {
      tokenIndex.set(`${a.user_id}_facebook`, a);
      tokenIndex.set(`${a.user_id}_meta`, a);
      // Only claim Instagram if a native Instagram connection has not already
      // been indexed -- a direct instagram row is the better source.
      if (viaMeta && !tokenIndex.has(`${a.user_id}_instagram`)) {
        tokenIndex.set(`${a.user_id}_instagram`, a);
      }
    } else {
      tokenIndex.set(`${a.user_id}_${a.platform}`, a);
    }
  }

  // 3. Process each group.
  for (const { userId, platform, submissions: groupSubs } of groups.values()) {
    const account = tokenIndex.get(`${userId}_${platform}`);
    if (!account) {
      summary.skipped += groupSubs.length;
      for (const s of groupSubs) summary.errors.push({ submission_id: s.id, reason: 'no_token' });
      continue;
    }

    // Refresh on the read path, immediately before use. refreshIfNeeded() is a
    // no-op unless the token is inside the expiry threshold, so the common case
    // costs nothing; when it does refresh it re-encrypts and persists, and on a
    // provider refusal it flags the row for reconnect rather than discarding it.
    const refresh = await refreshIfNeeded(account, { supabase });
    if (!refresh.accessToken) {
      summary.failed += groupSubs.length;
      const reason = refresh.status === 'failed'
        ? `token_refresh_failed: ${refresh.error}`
        : `token_unusable: ${refresh.status}`;
      for (const s of groupSubs) summary.errors.push({ submission_id: s.id, reason });
      continue;
    }

    // Decrypted in memory, for the length of this group's provider calls only.
    // The fetchers below read token.access_token, so the plaintext is handed to
    // them here rather than each one having to learn about encryption.
    let current = refresh.account;
    let token = { ...current, platform, access_token: refresh.accessToken };
    let ctx = {};

    let retriedAuth = false;
    let authError = null;         // the token was refused, even after a forced refresh
    let lastProviderError = null; // outage, rate limit, permissions
    let lastContentError = null;  // this post could not be found
    let successes = 0;

    for (const sub of groupSubs) {
      summary.processed += 1;

      if (authError) {
        summary.failed += 1;
        summary.errors.push({ submission_id: sub.id, platform, reason: authError });
        continue;
      }

      let result = await fetchPlatformMetrics(token, sub, ctx);

      // A token can be revoked or invalidated long before its expiry date, and
      // refreshIfNeeded() only looks at the date. Force one refresh and retry
      // before concluding the creator has to reconnect.
      if (result.error && result.auth && !retriedAuth) {
        retriedAuth = true;
        const forced = await refreshIfNeeded(current, { supabase, force: true });
        if (forced.accessToken && forced.status === 'refreshed') {
          current = forced.account;
          token = { ...current, platform, access_token: forced.accessToken };
          ctx = {}; // cached page URLs embed the old token
          result = await fetchPlatformMetrics(token, sub, ctx);
        }
      }

      if (result.error) {
        summary.failed += 1;
        summary.errors.push({ submission_id: sub.id, platform, reason: result.error });
        if (result.auth) authError = result.error;
        else if (result.content) lastContentError = result.error;
        else lastProviderError = result.error;
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
        successes += 1;
      }
    }

    // 4. Record the sync outcome on the account row.
    //
    // Keyed by id, not (user_id, platform): the Meta row is indexed under three
    // platform keys above, and matching on platform would miss it for two of
    // them.
    //
    // Only a refused token changes what the creator has to do. One mistyped or
    // deleted post used to flip the whole account to 'sync_failed', which the
    // UI rendered as "Reconnect required" and the nightly refresh sweep then
    // skipped — so a single bad link could let a healthy 60-day Meta token
    // quietly expire. A missing post is now recorded in last_error only.
    let connectionStatus = 'connected';
    let lastError = lastProviderError || lastContentError;
    if (authError) {
      connectionStatus = STATUS_REAUTH;
      lastError = authError;
    } else if (lastProviderError && successes === 0) {
      connectionStatus = 'sync_failed';
    }

    await supabase
      .from('creator_social_accounts')
      .update({
        last_synced_at: new Date().toISOString(),
        last_error: lastError || null,
        connection_status: connectionStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', account.id);
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
    .in('submission_type', FINAL_SUBMISSION_TYPES);
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
  const { data, error } = await supabase
    .from('submissions')
    .select(SUBMISSION_SELECT)
    .eq('creators.user_id', userId)
    .not('posted_link', 'is', null)
    .in('submission_type', FINAL_SUBMISSION_TYPES);
  if (error) throw new Error(`submissions_fetch_failed: ${error.message}`);
  // submissions.platform holds the dropdown label ('TikTok'), so filtering the
  // column on 'tiktok' never matched. Filter on the resolved platform instead.
  return platform ? (data || []).filter((s) => resolvePlatform(s) === platform) : (data || []);
}

module.exports = {
  FINAL_SUBMISSION_TYPES,
  // URL parsing
  detectPlatformFromUrl,
  normalizePlatformLabel,
  resolvePlatform,
  resolveShortLink,
  extractVideoId,
  // Math
  calculateEngagementRate,
  // Token refresh lives in api/_utils/tokenRefresh.js -- see the note above.
  // Per-platform fetchers (exported for testing; sync uses fetchPlatformMetrics)
  fetchPlatformMetrics,
  providerError,
  // Storage
  upsertVideoAnalytics,
  // Main
  syncSubmissions,
  // Query helpers
  fetchAllFinalSubmissions,
  fetchSubmissionsByIds,
  fetchSubmissionsForUser,
};
