// tests/facebook-metrics.test.cjs
//
// Facebook views come from the video, reactions and shares from its post.
//
//   node tests/facebook-metrics.test.cjs

const path = require('path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test';

const { readFacebookObject, shapeFacebook } = require(path.join(__dirname, '..', 'api', '_utils', 'analytics.js'));

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};

const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
const FIELD_ERROR = { error: { code: 100, message: 'nonexisting field' } };

const VIDEO = {
  id: '111', from: { id: 'page1' }, created_time: '2026-10-30T14:52:46+0000', views: 27, post_id: '222',
  likes: { summary: { total_count: 1 } }, comments: { summary: { total_count: 0 } },
};
const POST = {
  id: 'page1_222', from: { id: 'page1' }, created_time: '2026-10-30T14:52:46+0000',
  reactions: { summary: { total_count: 3 } }, comments: { summary: { total_count: 2 } }, shares: { count: 4 },
};

let postStatus = 200;
let pictureStatus = 200;
global.fetch = async (url) => {
  const u = decodeURIComponent(String(url));
  const wantsVideo = /fields=[^&]*views/.test(u);
  if (/\/111\?fields=picture&/.test(u)) return pictureStatus < 400 ? reply(200, { picture: 'https://cdn/thumb.jpg' }) : reply(pictureStatus, FIELD_ERROR);
  if (u.includes('/111?')) return wantsVideo ? reply(200, VIDEO) : reply(400, FIELD_ERROR);
  if (u.includes('/page1_222?')) return wantsVideo ? reply(400, FIELD_ERROR) : reply(postStatus, postStatus < 400 ? POST : FIELD_ERROR);
  return reply(404, FIELD_ERROR);
};

(async () => {
  console.log('\nFacebook metrics');
  let r = await readFacebookObject('111', 'token');
  const m = shapeFacebook(r.data);
  R(r.resp.ok && m.views === 27, 'a reel reads views from the video', String(m.views));
  R(m.likes === 3, 'likes count every reaction on the post', String(m.likes));
  R(m.comments === 2 && m.shares === 4, 'comments and shares come from the post');
  R(r.data.id === '111' && r.data.from.id === 'page1', 'the video id and owner are kept');

  R(m.thumbnailUrl === 'https://cdn/thumb.jpg', 'a reel reads its thumbnail', m.thumbnailUrl);

  pictureStatus = 400;
  r = await readFacebookObject('111', 'token');
  R(r.resp.ok && shapeFacebook(r.data).views === 27 && shapeFacebook(r.data).thumbnailUrl === null, 'a missing thumbnail keeps the metrics');

  r = await readFacebookObject('page1_222', 'token');
  const p = shapeFacebook(r.data);
  R(r.resp.ok && p.likes === 3 && p.views === 0, 'a plain post still reads');

  postStatus = 400;
  r = await readFacebookObject('111', 'token');
  R(!r.resp.ok, 'an unreadable post is a failure, not zero likes', String(r.resp.status));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
