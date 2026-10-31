// api/_utils/socialVideo.js
//
// Looks up one video through the creator's connected account (TikTok, YouTube, Instagram, Facebook).

const { resolveShortLink, detectPlatformFromUrl, extractVideoId, fetchTikTokMetrics, fetchInstagramBusinessMetrics, readFacebookObject, shapeFacebook } = require('./analytics');
const { facebookGraph } = require('./meta');
const { refreshIfNeeded } = require('./tokenRefresh');

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

const LOGIN_PLATFORMS = new Set(['tiktok', 'youtube', 'instagram', 'facebook']);
// Facebook connects through Facebook login, stored on the facebook row
const STORAGE_PLATFORM = { tiktok: 'tiktok', youtube: 'youtube', instagram: 'instagram', facebook: 'facebook' };

// TikTok: video/query only returns videos owned by the token's account.
async function lookupTikTok(token, videoId, account, resolvedUrl) {
  const m = await fetchTikTokMetrics({ access_token: token }, { videoId });
  if (m.error) {
    if (m.content) return fail('video_not_on_account', 'not_yours', 404);
    if (m.auth) return fail('tiktok_reauth_required', 'not_connected', 401);
    return fail(m.error, 'provider', null);
  }
  const v = m.raw || {};
  return {
    id: String(v.id || videoId),
    url: v.share_url || resolvedUrl,
    title: v.title || null,
    thumbnailUrl: v.cover_image_url || null,
    durationSeconds: num(v.duration) || null,
    postedAt: v.create_time ? new Date(Number(v.create_time) * 1000).toISOString() : null,
    views: num(m.views),
    likes: num(m.likes),
    comments: num(m.comments),
  };
}

// YouTube: the video's channelId must be the connected channel.
async function lookupYouTube(token, videoId, account, resolvedUrl) {
  const headers = { Authorization: `Bearer ${token}` };
  let channelId = account.platform_user_id;
  if (!channelId) {
    const r = await fetch('https://www.googleapis.com/youtube/v3/channels?part=id&mine=true', { headers });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) return fail('youtube_reauth_required', 'not_connected', 401);
    channelId = d?.items?.[0]?.id;
    if (!channelId) return fail(`youtube_http_${r.status}`, 'provider', r.status);
  }

  const resp = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${encodeURIComponent(videoId)}`,
    { headers }
  );
  const data = await resp.json().catch(() => ({}));
  if (resp.status === 401) return fail('youtube_reauth_required', 'not_connected', 401);
  if (!resp.ok) return fail(`youtube_http_${resp.status}`, 'provider', resp.status);
  const item = data?.items?.[0];
  if (!item || item.snippet?.channelId !== channelId) return fail('video_not_on_account', 'not_yours', 404);

  const sn = item.snippet || {};
  const st = item.statistics || {};
  const thumbs = sn.thumbnails || {};
  return {
    id: String(item.id),
    url: resolvedUrl,
    title: sn.title || null,
    thumbnailUrl: (thumbs.medium || thumbs.default || {}).url || null,
    durationSeconds: null,
    postedAt: sn.publishedAt || null,
    views: num(st.viewCount),
    likes: num(st.likeCount),
    comments: num(st.commentCount),
  };
}

// Instagram: the post must be in the media of the connected Instagram account.
async function lookupInstagram(token, videoId, account, resolvedUrl) {
  const m = await fetchInstagramBusinessMetrics({ access_token: token }, { videoId }, {});
  if (m.error) {
    if (m.content) return fail('video_not_on_account', 'not_yours', 404);
    if (m.auth) return fail('instagram_reauth_required', 'not_connected', 401);
    return fail(m.error, 'provider', null);
  }
  const r = m.raw || {};
  return {
    id: String(r.id || videoId),
    url: resolvedUrl,
    title: null,
    thumbnailUrl: r.thumbnail_url || r.media_url || null,
    durationSeconds: null,
    postedAt: r.timestamp || null,
    views: num(m.views),
    likes: num(m.likes),
    comments: num(m.comments),
  };
}

// Facebook: the post must read with one of the creator's Page tokens and be posted by that Page.
async function lookupFacebook(token, videoId, account, resolvedUrl) {
  const resp = await fetch(`${facebookGraph('me/accounts')}?fields=id,access_token&limit=25&access_token=${encodeURIComponent(token)}`);
  const data = await resp.json().catch(() => ({}));
  if (resp.status === 401 || data?.error?.code === 190) return fail('facebook_reauth_required', 'not_connected', 401);
  if (!resp.ok) return fail(`fb_accounts_http_${resp.status}`, 'provider', resp.status);
  const pages = (data.data || []).filter((p) => p && p.id && p.access_token);
  if (!pages.length) return fail('fb_no_pages', 'not_linked', null);

  const id = String(videoId);
  for (const page of pages) {
    for (const objectId of id.includes('_') ? [id] : [id, `${page.id}_${id}`]) {
      const { resp: r, data: d } = await readFacebookObject(objectId, page.access_token);
      if (!r.ok) continue;
      if (!d.from || d.from.id !== page.id) break;
      const { views, likes, comments, thumbnailUrl } = shapeFacebook(d);
      return {
        id: objectId,
        url: resolvedUrl,
        title: null,
        thumbnailUrl,
        durationSeconds: null,
        postedAt: d.created_time || null,
        views,
        likes,
        comments,
      };
    }
  }
  return fail('video_not_on_account', 'not_yours', 404);
}

const LOOKUPS = { tiktok: lookupTikTok, youtube: lookupYouTube, instagram: lookupInstagram, facebook: lookupFacebook };

// Looks the video up with the creator's own login on that platform, which
// proves ownership. Failure kinds: not_supported, validation, not_connected,
// not_yours, provider.
async function fetchOwnVideo(supabase, userId, url) {
  if (!url) return fail('url_required', 'validation', 400);
  const resolvedUrl = await resolveShortLink(url);
  const platform = detectPlatformFromUrl(resolvedUrl);
  if (!LOGIN_PLATFORMS.has(platform)) return fail('not_supported', 'not_supported', null);
  const videoId = extractVideoId(platform, resolvedUrl);
  if (!videoId) return fail('video_id_unparseable', 'validation', 400);
  if (!userId) return fail(`${platform}_not_connected`, 'not_connected', null);

  const { data: account } = await supabase
    .from('creator_social_accounts')
    .select(
      'id, user_id, platform, platform_user_id, username, access_token_encrypted, refresh_token_encrypted, ' +
      'token_expires_at, refresh_token_expires_at, connection_status, metadata, created_at, updated_at'
    )
    .eq('user_id', userId)
    .eq('platform', STORAGE_PLATFORM[platform])
    .not('access_token_encrypted', 'is', null)
    .maybeSingle();
  if (!account) return fail(`${platform}_not_connected`, 'not_connected', null);

  const refresh = await refreshIfNeeded(account, { supabase });
  if (!refresh.accessToken) return fail(`${platform}_reauth_required`, 'not_connected', null);

  const v = await LOOKUPS[platform](refresh.accessToken, videoId, account, resolvedUrl);
  if (v.ok === false) return v;

  return {
    ok: true,
    source: 'oauth',
    resolvedUrl,
    platform,
    video: {
      platform,
      ...v,
      authorHandle: normalizeHandle(account.username) || null,
      raw: { video_id: v.id, source: 'oauth', statistics: { views: v.views, likes: v.likes, comments: v.comments } },
    },
  };
}

module.exports = { normalizeHandle, fetchOwnVideo };
