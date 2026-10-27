// tests/single-video-verification.test.cjs
//
// Offline unit tests for spec 0003 single video link verification:
//   api/_utils/socialPublic.js (AC-2, AC-3, AC-4)
//   api/social/verify-video-link.js (AC-4, AC-5, AC-7)
//
// Run directly with:
//   node tests/single-video-verification.test.cjs

const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
process.env.SCRAPECREATORS_API_KEY = 'test-key';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
const { encrypt } = require(path.join(ROOT, 'api/_utils/encryption'));

const {
  normalizeHandle,
  isAuthorMatch,
  normalizeTikTok,
  normalizeInstagram,
  normalizeYouTube,
  fetchPublicVideo,
  fetchOwnTikTokVideo,
} = require(path.join(ROOT, 'api/_utils/socialPublic'));

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

  R(isAuthorMatch('@alex_ugc', 'alex_ugc') === true, 'matches exact handle');
  R(isAuthorMatch('Alex_UGC', '@alex_ugc') === true, 'matches case insensitive with @');
  R(isAuthorMatch('other_creator', 'alex_ugc') === false, 'rejects mismatch');
  R(isAuthorMatch('', 'alex_ugc') === false, 'rejects empty author');

  console.log('\n--- AC-3: Provider payload normalizers ---');
  // TikTok normalizer
  const rawTikTok = {
    aweme_id: '7700902300537113908',
    desc: 'New summer look',
    create_time: 1700000000,
    author: { unique_id: 'irene_stiches_fashion' },
    video: {
      duration: 15000,
      cover: { url_list: ['https://p16.tiktokcdn.com/cover.jpeg'] },
    },
    statistics: {
      play_count: 54320,
      digg_count: 1200,
      comment_count: 45,
      share_count: 12,
      collect_count: 8,
    },
  };
  const normalizedTT = normalizeTikTok(rawTikTok, 'https://vt.tiktok.com/ZSg4DrvG8/');
  R(normalizedTT.platform === 'tiktok', 'TikTok platform normalized');
  R(normalizedTT.authorHandle === 'irene_stiches_fashion', 'TikTok author handle parsed');
  R(normalizedTT.views === 54320, 'TikTok views parsed');
  R(normalizedTT.likes === 1200, 'TikTok likes parsed');
  R(normalizedTT.durationSeconds === 15, 'TikTok duration converted from ms');
  R(normalizedTT.thumbnailUrl === 'https://p16.tiktokcdn.com/cover.jpeg', 'TikTok thumbnail parsed');

  // Instagram normalizer
  const rawInstagram = {
    xdt_shortcode_media: {
      id: '123456789',
      shortcode: 'C9xyz123',
      owner: { username: 'shaily_creator' },
      edge_media_to_caption: { edges: [{ node: { text: 'Reel caption' } }] },
      display_url: 'https://instagram.fna.fbcdn.net/thumb.jpg',
      video_duration: 30,
      video_play_count: 89000,
      edge_media_preview_like: { count: 3200 },
      edge_media_to_parent_comment: { count: 120 },
      taken_at_timestamp: 1700000000,
    },
  };
  const normalizedIG = normalizeInstagram(rawInstagram, 'https://www.instagram.com/reel/C9xyz123/');
  R(normalizedIG.platform === 'instagram', 'Instagram platform normalized');
  R(normalizedIG.authorHandle === 'shaily_creator', 'Instagram author parsed');
  R(normalizedIG.views === 89000, 'Instagram views parsed');
  R(normalizedIG.likes === 3200, 'Instagram likes parsed');
  R(normalizedIG.comments === 120, 'Instagram comments parsed');

  // YouTube normalizer
  const rawYouTube = {
    id: 'dQw4w9WgXcQ',
    title: 'Never Gonna Give You Up',
    channel: { handle: 'rickastley', title: 'Rick Astley' },
    viewCountInt: 1500000000,
    likeCountInt: 16000000,
    commentCountInt: 2500000,
    thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    durationMs: 213000,
  };
  const normalizedYT = normalizeYouTube(rawYouTube, 'https://youtu.be/dQw4w9WgXcQ');
  R(normalizedYT.platform === 'youtube', 'YouTube platform normalized');
  R(normalizedYT.authorHandle === 'rickastley', 'YouTube author parsed');
  R(normalizedYT.views === 1500000000, 'YouTube views parsed');
  R(normalizedYT.durationSeconds === 213, 'YouTube duration in seconds');

  console.log('\n--- AC-2 & AC-3: fetchPublicVideo with short link unrolling ---');
  // Mock redirect follow for short link
  stubFetch([
    // Redirect resolution call
    { status: 200, body: {}, url: 'https://www.tiktok.com/@irene_stiches_fashion/video/7700902300537113908' },
    // ScrapeCreators API response
    { status: 200, body: { success: true, aweme_detail: rawTikTok } },
  ]);

  const fetchRes = await fetchPublicVideo({ url: 'https://vt.tiktok.com/ZSg4DrvG8/', platform: 'TikTok' });
  R(fetchRes.ok === true, 'fetchPublicVideo succeeded');
  R(fetchRes.platform === 'tiktok', 'resolved platform is tiktok');
  R(fetchRes.video.authorHandle === 'irene_stiches_fashion', 'author handle extracted correctly');
  R(fetchRes.video.views === 54320, 'views extracted correctly');

  console.log('\n--- AC-7: Error handling and not found ---');
  stubFetch([
    { status: 404, body: { success: false, message: 'Video not found' } },
  ]);
  const errRes = await fetchPublicVideo({ url: 'https://www.tiktok.com/@user/video/9999999', platform: 'tiktok' });
  R(errRes.ok === false, 'fetchPublicVideo reports error');
  R(errRes.kind === 'not_found', 'error classified as not_found');

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
  const own = await fetchOwnTikTokVideo(fakeSupabase(tiktokRow), 'user-1', ownUrl);
  R(own && own.source === 'oauth', 'video on the connected account is verified through the login');
  R(own && own.video.views === 4200 && own.video.title === 'Mine', 'views and title come from TikTok');
  R(calls[0] && calls[0].url.includes('open.tiktokapis.com/v2/video/query') && calls[0].headers.Authorization === 'Bearer tok-123', 'queries TikTok with the creator token');
  R(calls[0] && JSON.parse(calls[0].body).filters.video_ids[0] === '7700902300537113908', 'asks for the video id from the link');

  stubFetch([{ status: 200, body: { data: { videos: [] }, error: { code: 'ok' } } }]);
  R(await fetchOwnTikTokVideo(fakeSupabase(tiktokRow), 'user-1', ownUrl) === null, 'video not on the connected account falls back (null)');

  stubFetch([{ status: 500, body: {} }]);
  R(await fetchOwnTikTokVideo(fakeSupabase(null), 'user-1', ownUrl) === null && calls.length === 0, 'no connected login falls back without calling TikTok');
  R(await fetchOwnTikTokVideo(fakeSupabase(tiktokRow), 'user-1', 'https://www.instagram.com/reel/C9xyz123/') === null, 'non TikTok link falls back');

  console.log(`\n========================================`);
  console.log(`Results: ${pass} passed, ${fail} failed`);
  console.log(`========================================\n`);

  if (fail > 0) process.exit(1);
})();
