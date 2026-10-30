// tests/single-video-verification.test.cjs
//
// Offline unit tests for video lookups through the creator's connected account:
//   api/_utils/socialVideo.js
//
// Run directly with:
//   node tests/single-video-verification.test.cjs

const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
const { encrypt } = require(path.join(ROOT, 'api/_utils/encryption'));

const { normalizeHandle, fetchOwnVideo } = require(path.join(ROOT, 'api/_utils/socialVideo'));

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};

// Canned answers for stubFetch
let calls = [];
let answers = [];
function stubFetch(list) {
  calls = [];
  answers = list.slice();
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), headers: (opts && opts.headers) || {}, body: opts && opts.body });
    const a = answers.length > 1 ? answers.shift() : answers[0];
    if (a.throw) { const e = new Error(a.throw); e.name = a.throw; throw e; }
    return {
      ok: a.status >= 200 && a.status < 300,
      status: a.status,
      url: a.url || String(url),
      json: async () => a.body,
    };
  };
}

(async () => {
  console.log('\n--- AC-4: Handle normalization and matching ---');
  R(normalizeHandle('@alex_ugc') === 'alex_ugc', 'strips leading @');
  R(normalizeHandle('  @@Alex_UGC  ') === 'alex_ugc', 'lowercases and trims whitespace');
  R(normalizeHandle('') === '', 'handles empty string');
  R(normalizeHandle(null) === '', 'handles null');

  console.log('\n--- TikTok ownership through the connected login ---');
  const tiktokRow = {
    id: 'acc-1', user_id: 'user-1', platform: 'tiktok', username: null,
    access_token_encrypted: encrypt('tok-123'),
    token_expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    created_at: new Date().toISOString(),
  };
  const fakeSupabase = (row) => {
    const q = { select: () => q, eq: () => q, not: () => q, maybeSingle: async () => ({ data: row, error: null }) };
    return { from: () => q };
  };
  const ownUrl = 'https://www.tiktok.com/@someone/video/7700902300537113908';

  stubFetch([{ status: 200, body: { data: { videos: [{ id: '7700902300537113908', title: 'Mine', view_count: 4200, like_count: 50 }] }, error: { code: 'ok' } } }]);
  const own = await fetchOwnVideo(fakeSupabase(tiktokRow), 'user-1', ownUrl);
  R(own.ok && own.source === 'oauth', 'video on the connected account is verified through the login');
  R(own && own.video.views === 4200 && own.video.title === 'Mine', 'views and title come from TikTok');
  R(calls[0] && calls[0].url.includes('open.tiktokapis.com/v2/video/query') && calls[0].headers.Authorization === 'Bearer tok-123', 'queries TikTok with the creator token');
  R(calls[0] && JSON.parse(calls[0].body).filters.video_ids[0] === '7700902300537113908', 'asks for the video id from the link');

  stubFetch([{ status: 200, body: { data: { videos: [] }, error: { code: 'ok' } } }]);
  R((await fetchOwnVideo(fakeSupabase(tiktokRow), 'user-1', ownUrl)).kind === 'not_yours', 'video not on the connected account is refused');

  stubFetch([{ status: 500, body: {} }]);
  R((await fetchOwnVideo(fakeSupabase(null), 'user-1', ownUrl)).kind === 'not_connected' && calls.length === 0, 'no connected login is refused without calling TikTok');
  R((await fetchOwnVideo(fakeSupabase(tiktokRow), null, ownUrl)).kind === 'not_connected', 'no creator to check is refused');
  R((await fetchOwnVideo(fakeSupabase(tiktokRow), 'user-1', 'https://vimeo.com/123456')).kind === 'not_supported', 'unsupported link is refused');

  console.log('\n--- YouTube ownership through the connected login ---');
  const ytRow = { ...tiktokRow, platform: 'youtube', platform_user_id: 'UC_mine' };
  const ytUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  const ytVideo = (channelId) => ({ status: 200, body: { items: [{ id: 'dQw4w9WgXcQ', snippet: { channelId, title: 'My short', thumbnails: { medium: { url: 'https://i.ytimg.com/x.jpg' } } }, statistics: { viewCount: '900', likeCount: '40', commentCount: '3' } }] } });

  stubFetch([ytVideo('UC_mine')]);
  const yt = await fetchOwnVideo(fakeSupabase(ytRow), 'user-1', ytUrl);
  R(yt.ok && yt.platform === 'youtube' && yt.video.views === 900 && yt.video.title === 'My short', 'video on the connected channel is verified through the login');
  R(calls[0] && calls[0].url.includes('videos?part=snippet,statistics&id=dQw4w9WgXcQ') && calls[0].headers.Authorization === 'Bearer tok-123', 'queries YouTube with the creator token');

  stubFetch([ytVideo('UC_someone_else')]);
  R((await fetchOwnVideo(fakeSupabase(ytRow), 'user-1', ytUrl)).kind === 'not_yours', 'video from another channel is refused');

  stubFetch([{ status: 200, body: { items: [] } }]);
  R((await fetchOwnVideo(fakeSupabase(ytRow), 'user-1', ytUrl)).kind === 'not_yours', 'missing or private video is refused');

  stubFetch([{ status: 200, body: { items: [{ id: 'UC_mine' }] } }, ytVideo('UC_mine')]);
  R((await fetchOwnVideo(fakeSupabase({ ...ytRow, platform_user_id: null }), 'user-1', ytUrl)).ok, 'looks up the channel when it was not stored at connect');

  console.log('\n--- Instagram through Instagram login, Facebook through Facebook login ---');
  const igRow = { ...tiktokRow, platform: 'instagram', metadata: { provider: 'instagram' } };
  const metaRow = { ...tiktokRow, platform: 'facebook', metadata: { provider: 'meta', flow: 'meta' } };
  const igUrl = 'https://www.instagram.com/reel/C9xyz123/';

  stubFetch([{ status: 200, body: { data: [{ id: 'm1', shortcode: 'C9xyz123', like_count: 7, comments_count: 2, thumbnail_url: 'https://cdn/t.jpg' }] } }, { status: 200, body: { data: [{ name: 'views', values: [{ value: 300 }] }] } }]);
  const ig = await fetchOwnVideo(fakeSupabase(igRow), 'user-1', igUrl);
  R(ig.ok && ig.platform === 'instagram' && ig.video.views === 300 && ig.video.likes === 7, 'reel on the connected Instagram account is verified');
  R(calls[0] && calls[0].url.includes('graph.instagram.com'), 'Instagram is read through Instagram login, not Facebook');
  R(ig.video.thumbnailUrl === 'https://cdn/t.jpg', 'Instagram thumbnail is returned');

  stubFetch([{ status: 200, body: { data: [{ id: 'm2', shortcode: 'OTHER', like_count: 1 }] } }]);
  R((await fetchOwnVideo(fakeSupabase(igRow), 'user-1', igUrl)).kind === 'not_yours', 'reel not on the connected account is refused');

  const fbUrl = 'https://www.facebook.com/watch/?v=1234567890';
  const fbPages = { status: 200, body: { data: [{ id: 'P1', access_token: 'page-tok' }] } };
  stubFetch([fbPages, { status: 200, body: { from: { id: 'P1' }, likes: { summary: { total_count: 9 } }, comments: { summary: { total_count: 1 } } } }]);
  const fb = await fetchOwnVideo(fakeSupabase(metaRow), 'user-1', fbUrl);
  R(fb.ok && fb.platform === 'facebook' && fb.video.likes === 9, 'video posted by the creator Page is verified');
  R(calls[1] && calls[1].url.includes('page-tok'), 'reads the video with the Page token');

  stubFetch([fbPages, { status: 200, body: { from: { id: 'SOMEONE_ELSE' } } }, { status: 400, body: {} }]);
  R((await fetchOwnVideo(fakeSupabase(metaRow), 'user-1', fbUrl)).kind === 'not_yours', 'video from another Page is refused');

  console.log(`\n========================================`);
  console.log(`Results: ${pass} passed, ${fail} failed`);
  console.log(`========================================\n`);

  if (fail > 0) process.exit(1);
})();
