// tests/campaign-platform.test.cjs
//
// api/social/verify-video-link.js refuses a video on a different platform from the campaign's.
//
//   node tests/campaign-platform.test.cjs

const path = require('path');

const API = path.join(__dirname, '..', 'api');

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};

function stub(rel, exports) {
  const id = require.resolve(path.join(API, rel));
  require.cache[id] = { id, filename: id, loaded: true, exports, children: [], paths: [] };
}

let campaignFormat = 'YouTube';
let fetched = 0;
const query = (row) => {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: row(), error: null }) };
  return q;
};
stub('_utils/supabaseAdmin.js', {
  getSupabaseAdminClient: () => ({
    from: (t) => query(() => (t === 'submissions'
      ? { id: 's1', creator_id: 'c1', campaign_id: 'k1', platform: null, creators: { user_id: 'u1', am_id: null } }
      : { format: campaignFormat })),
  }),
});
stub('_utils/auth.js', { requireRole: async () => ({ user: { id: 'u1' }, profile: { role: 'creator' } }), normalizeRole: (r) => r });
stub('_utils/cors.js', { applyCors: () => false });
stub('_utils/rateLimit.js', { applyRateLimit: async () => false });
stub('_utils/socialVideo.js', { fetchOwnVideo: async () => { fetched++; return { ok: false, kind: 'provider' }; } });

const handler = require(path.join(API, 'social', 'verify-video-link.js'));

async function call(url) {
  const out = { code: null, body: null };
  const res = { setHeader: () => res, status: (c) => { out.code = c; return res; }, json: (b) => { out.body = b; return res; }, send: (b) => { out.body = typeof b === 'string' ? JSON.parse(b) : b; return res; }, end: () => res };
  await handler({ method: 'POST', headers: {}, query: {}, body: { url, submissionId: 's1' } }, res);
  return out;
}

(async () => {
  console.log('\nCampaign platform');
  fetched = 0;
  let r = await call('https://www.tiktok.com/@me/video/123');
  R(r.code === 422 && /YouTube/.test(JSON.stringify(r.body)) && fetched === 0, 'a TikTok link on a YouTube campaign is refused before any lookup', String(r.code));
  r = await call('https://www.youtube.com/shorts/abc123');
  R(fetched === 1, 'a YouTube link on a YouTube campaign goes on to the lookup');
  campaignFormat = 'Brand story';
  fetched = 0;
  await call('https://www.tiktok.com/@me/video/123');
  R(fetched === 1, 'an old free-text format does not block any platform');
  campaignFormat = 'FB Reel';
  fetched = 0;
  r = await call('https://www.tiktok.com/@me/video/123');
  R(r.code === 422 && /Facebook/.test(JSON.stringify(r.body)) && fetched === 0, 'an older "FB Reel" format counts as Facebook', String(r.code));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
