// api/_utils/socialPublic.js
//
// Single video data fetcher and normalizer for TikTok, Instagram, and YouTube (spec 0003).
// Backed by ScrapeCreators. Unrolls mobile share short links, calls the single video
// endpoint, and normalizes into a consistent shape with author handle confirmation.

const {
  resolveShortLink, detectPlatformFromUrl, normalizePlatformLabel, extractVideoId, fetchTikTokMetrics,
} = require('./analytics');
const { refreshIfNeeded } = require('./tokenRefresh');

const BASE_URL = 'https://api.scrapecreators.com';
const TIMEOUT_MS = 15000;
const PROVIDER_STATUSES = new Set([401, 402, 403, 429]);
const NOT_FOUND_TEXT = /not\s*found|does(?:n'?t| not)\s*exist|couldn'?t find|no such user|video.*(?:banned|unavailable|deleted)/i;

function fail(error, kind, status) {
  return { ok: false, error, kind, status: status || null };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

function normalizeHandle(handle) {
  if (!handle || typeof handle !== 'string') return '';
  return handle.trim().toLowerCase().replace(/^@+/, '');
}

function isAuthorMatch(videoAuthor, inputHandle) {
  const v = normalizeHandle(videoAuthor);
  const i = normalizeHandle(inputHandle);
  if (!v || !i) return false;
  return v === i;
}

// Low level HTTP call to ScrapeCreators with timeout and transient retry
async function callScrapeCreators(path, params, { retried = false } = {}) {
  const apiKey = process.env.SCRAPECREATORS_API_KEY;
  if (!apiKey) return fail('scrapecreators_not_configured', 'provider', null);

  const url = `${BASE_URL}${path}?${new URLSearchParams(params).toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let resp;
  let body;
  try {
    resp = await fetch(url, { headers: { 'x-api-key': apiKey }, signal: controller.signal });
    body = await resp.json().catch(() => null);
  } catch (err) {
    clearTimeout(timer);
    if (!retried) return callScrapeCreators(path, params, { retried: true });
    const timedOut = err && err.name === 'AbortError';
    return { ...fail(timedOut ? 'provider_timeout' : 'provider_network_error', 'transient', null), timeout: timedOut };
  }
  clearTimeout(timer);

  if (PROVIDER_STATUSES.has(resp.status)) {
    return fail(`provider_http_${resp.status}`, 'provider', resp.status);
  }
  if (resp.status >= 500) {
    if (!retried) return callScrapeCreators(path, params, { retried: true });
    return fail(`provider_http_${resp.status}`, 'transient', resp.status);
  }

  const message = body && (body.message || body.error || body.detail);
  if (resp.status === 404 || ((resp.status >= 400 || (body && body.success === false)) && NOT_FOUND_TEXT.test(String(message || '')))) {
    return fail('video_not_found', 'not_found', resp.status);
  }
  if (!resp.ok || !body || body.success === false) {
    return fail(`provider_http_${resp.status}`, 'transient', resp.status);
  }
  return { ok: true, body, status: resp.status };
}

// Normalizers per platform

function normalizeTikTok(aweme, originalUrl) {
  if (!aweme || !aweme.aweme_id) return null;
  const id = String(aweme.aweme_id);
  const s = aweme.statistics || {};
  const author = normalizeHandle(aweme.author && aweme.author.unique_id);
  const cover = aweme.video && aweme.video.cover && Array.isArray(aweme.video.cover.url_list) ? aweme.video.cover.url_list[0] : null;
  const durationMs = aweme.video && Number(aweme.video.duration);
  const url = typeof aweme.url === 'string' && aweme.url.includes(id)
    ? aweme.url
    : author ? `https://www.tiktok.com/@${author}/video/${id}` : originalUrl;

  return {
    platform: 'tiktok',
    id,
    url,
    authorHandle: author,
    title: typeof aweme.desc === 'string' ? aweme.desc : null,
    thumbnailUrl: cover || null,
    durationSeconds: Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs / 1000) : null,
    postedAt: aweme.create_time ? new Date(Number(aweme.create_time) * 1000).toISOString() : null,
    views: num(s.play_count),
    likes: num(s.digg_count),
    comments: num(s.comment_count),
    shares: num(s.share_count),
    saves: num(s.collect_count),
    raw: { aweme_id: id, author, statistics: s },
  };
}

function normalizeInstagram(data, originalUrl) {
  if (!data || !data.xdt_shortcode_media) return null;
  const m = data.xdt_shortcode_media;
  const id = String(m.id || m.shortcode || '');
  const author = normalizeHandle(m.owner && m.owner.username);
  const caption = (m.edge_media_to_caption && Array.isArray(m.edge_media_to_caption.edges) && m.edge_media_to_caption.edges[0]?.node?.text) || null;
  const thumbnail = m.thumbnail_src || m.display_url || null;
  const durationSec = Number(m.video_duration);
  const views = num(m.video_play_count || m.video_view_count);
  const likes = num(m.edge_media_preview_like && m.edge_media_preview_like.count);
  const comments = num(m.edge_media_to_parent_comment && m.edge_media_to_parent_comment.count);

  return {
    platform: 'instagram',
    id,
    url: originalUrl,
    authorHandle: author,
    title: caption,
    thumbnailUrl: thumbnail,
    durationSeconds: Number.isFinite(durationSec) && durationSec > 0 ? Math.round(durationSec) : null,
    postedAt: m.taken_at_timestamp ? new Date(Number(m.taken_at_timestamp) * 1000).toISOString() : null,
    views,
    likes,
    comments,
    shares: 0,
    saves: 0,
    raw: { id, shortcode: m.shortcode, owner: author, views, likes, comments },
  };
}

function normalizeYouTube(data, originalUrl) {
  if (!data || !data.id) return null;
  const id = String(data.id);
  const channel = data.channel || {};
  const author = normalizeHandle(channel.handle || channel.title || '');
  const durationMs = Number(data.durationMs);
  const views = num(data.viewCountInt || data.view_count);
  const likes = num(data.likeCountInt || data.like_count);
  const comments = num(data.commentCountInt || data.comment_count);

  return {
    platform: 'youtube',
    id,
    url: data.url || originalUrl,
    authorHandle: author,
    title: typeof data.title === 'string' ? data.title : null,
    thumbnailUrl: data.thumbnail || null,
    durationSeconds: Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs / 1000) : null,
    postedAt: data.publishDate || null,
    views,
    likes,
    comments,
    shares: 0,
    saves: 0,
    raw: { id, channel: author, views, likes, comments },
  };
}

// Unified fetch function across all platforms
async function fetchPublicVideo({ url, platform }) {
  if (!url || typeof url !== 'string') {
    return fail('url_required', 'validation', 400);
  }

  // 1. Resolve mobile short links (vt.tiktok.com, youtu.be, instagram.com/share)
  const resolvedUrl = await resolveShortLink(url);

  // 2. Resolve target platform
  const targetPlatform = normalizePlatformLabel(platform) || detectPlatformFromUrl(resolvedUrl);
  if (!targetPlatform || !['tiktok', 'instagram', 'youtube'].includes(targetPlatform)) {
    return fail('unsupported_platform', 'validation', 400);
  }

  // 3. Call ScrapeCreators
  let result;
  let normalized;

  if (targetPlatform === 'tiktok') {
    result = await callScrapeCreators('/v2/tiktok/video', { url: resolvedUrl, trim: 'true' });
    if (!result.ok) return result;
    normalized = normalizeTikTok(result.body && result.body.aweme_detail, resolvedUrl);
  } else if (targetPlatform === 'instagram') {
    result = await callScrapeCreators('/v1/instagram/post', { url: resolvedUrl, trim: 'true' });
    if (!result.ok) return result;
    normalized = normalizeInstagram(result.body && result.body.data, resolvedUrl);
  } else if (targetPlatform === 'youtube') {
    result = await callScrapeCreators('/v1/youtube/video', { url: resolvedUrl });
    if (!result.ok) return result;
    normalized = normalizeYouTube(result.body, resolvedUrl);
  }

  if (!normalized) {
    return fail('video_not_found', 'not_found', 404);
  }

  return {
    ok: true,
    resolvedUrl,
    platform: targetPlatform,
    video: normalized,
  };
}

// Looks the video up with the creator's own TikTok login. TikTok's video/query
// only returns videos owned by the token's account, so a hit proves ownership.
// Failure kinds: not_tiktok, validation, not_connected, not_yours, provider.
async function fetchOwnTikTokVideo(supabase, userId, url) {
  if (!url) return fail('url_required', 'validation', 400);
  const resolvedUrl = await resolveShortLink(url);
  if (detectPlatformFromUrl(resolvedUrl) !== 'tiktok') return fail('not_tiktok', 'not_tiktok', null);
  const videoId = extractVideoId('tiktok', resolvedUrl);
  if (!videoId) return fail('video_id_unparseable', 'validation', 400);
  if (!userId) return fail('tiktok_not_connected', 'not_connected', null);

  const { data: account } = await supabase
    .from('creator_social_accounts')
    .select(
      'id, user_id, platform, username, access_token_encrypted, refresh_token_encrypted, ' +
      'token_expires_at, refresh_token_expires_at, connection_status, metadata, created_at, updated_at'
    )
    .eq('user_id', userId)
    .eq('platform', 'tiktok')
    .not('access_token_encrypted', 'is', null)
    .maybeSingle();
  if (!account) return fail('tiktok_not_connected', 'not_connected', null);

  const refresh = await refreshIfNeeded(account, { supabase });
  if (!refresh.accessToken) return fail('tiktok_reauth_required', 'not_connected', null);

  const m = await fetchTikTokMetrics({ access_token: refresh.accessToken }, { videoId });
  if (m.error) {
    if (m.content) return fail('video_not_on_account', 'not_yours', 404);
    if (m.auth) return fail('tiktok_reauth_required', 'not_connected', 401);
    return fail(m.error, 'provider', null);
  }

  const v = m.raw || {};
  return {
    ok: true,
    source: 'oauth',
    resolvedUrl,
    platform: 'tiktok',
    video: {
      platform: 'tiktok',
      id: String(v.id || videoId),
      url: v.share_url || resolvedUrl,
      authorHandle: normalizeHandle(account.username) || null,
      title: v.title || null,
      thumbnailUrl: v.cover_image_url || null,
      durationSeconds: num(v.duration) || null,
      postedAt: v.create_time ? new Date(Number(v.create_time) * 1000).toISOString() : null,
      views: num(m.views),
      likes: num(m.likes),
      comments: num(m.comments),
      shares: num(m.shares),
      saves: 0,
      raw: { video_id: String(v.id || videoId), source: 'oauth', statistics: { view_count: m.views, like_count: m.likes, comment_count: m.comments, share_count: m.shares } },
    },
  };
}

module.exports = {
  normalizeHandle,
  isAuthorMatch,
  callScrapeCreators,
  fetchPublicVideo,
  fetchOwnTikTokVideo,
  normalizeTikTok,
  normalizeInstagram,
  normalizeYouTube,
};
