// tests/tiktok-link.test.cjs
//
// Offline unit tests for spec 0002's two helper modules:
//
//   api/_utils/tiktokPublic.js   the ScrapeCreators adapter and its error
//                                classifier (AC-4, AC-7, AC-8, AC-11, AC-12)
//   api/_utils/tiktokLink.js     handle normalizer, codes, the AC-8 write
//                                rules, migration missing (AC-1, AC-8, AC-19)
//
// global.fetch is stubbed and answers from tests/fixtures/scrapecreators/, so
// nothing here spends a credit or needs a key.
//
//   node tests/tiktok-link.test.cjs

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures', 'scrapecreators');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8'));

process.env.SCRAPECREATORS_API_KEY = 'test-key';
const pub = require(path.join(ROOT, 'api/_utils/tiktokPublic'));
const link = require(path.join(ROOT, 'api/_utils/tiktokLink'));

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};

// A queue of canned answers. Each entry is { status, body } or { throw }.
let calls = [];
let answers = [];
function stubFetch(list) {
  calls = [];
  answers = list.slice();
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), headers: (opts && opts.headers) || {} });
    const a = answers.length > 1 ? answers.shift() : answers[0];
    if (a.throw) { const e = new Error(a.throw); e.name = a.throw; throw e; }
    return {
      ok: a.status >= 200 && a.status < 300,
      status: a.status,
      url: a.url || String(url),
      body: null,
      json: async () => a.body,
    };
  };
}

(async () => {
  // =========================================================================
  console.log('\nAC-1 -- what a creator can paste');
  // =========================================================================
  stubFetch([{ status: 200, body: {}, url: 'https://www.tiktok.com/@Short.Link.User/video/1?is_from_webapp=1' }]);
  const cases = [
    ['some.creator', 'some.creator'],
    ['@Some.Creator', 'some.creator'],
    ['https://www.tiktok.com/@Some.Creator?lang=en', 'some.creator'],
    ['https://www.tiktok.com/@some_creator/video/7517114944362499342', 'some_creator'],
    ['tiktok.com/@abc', 'abc'],
    ['https://vm.tiktok.com/ZMabc123/', 'short.link.user'],
    ['https://www.tiktok.com/t/ZTabc/', 'short.link.user'],
    ['a', null],
    ['has space', null],
    ['https://www.instagram.com/someone', null],
    ['https://www.tiktok.com/foryou', null],
    ['x'.repeat(25), null],
    ['', null],
    [42, null],
  ];
  for (const [input, want] of cases) {
    const got = await link.normalizeHandle(input);
    R(got === want, `normalizeHandle(${JSON.stringify(input)}) = ${JSON.stringify(want)}`, got === want ? '' : 'got ' + got);
  }

  const codes = new Set(Array.from({ length: 200 }, () => link.generateCode()));
  R([...codes].every((c) => /^OMNYA-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{6}$/.test(c)),
    'codes are OMNYA- plus 6 Crockford base32 characters');
  R(codes.size === 200, 'and 200 in a row are all different');
  const exp = new Date(link.codeExpiresAt(Date.parse('2026-10-23T00:00:00Z'))).toISOString();
  R(exp === '2026-10-30T00:00:00.000Z', 'a code expires 7 days after it is issued', exp);

  // =========================================================================
  console.log('\nAC-4 -- the bio check');
  // =========================================================================
  stubFetch([{ status: 200, body: fixture('profile.json') }]);
  const profile = await pub.getProfile('some.creator');
  R(profile.handle === 'some.creator' && profile.followers === 4100 && profile.videoCount === 3,
    'getProfile normalizes handle, followers and video count', JSON.stringify(profile).slice(0, 120));
  R(calls[0].url.startsWith('https://api.scrapecreators.com/v1/tiktok/profile?') &&
    calls[0].url.includes('handle=some.creator') && calls[0].headers['x-api-key'] === 'test-key',
    'it calls /v1/tiktok/profile with the handle and the x-api-key header', calls[0].url);
  R(link.bioHasCode(profile.bio, 'OMNYA-7K3QZD'), 'a lowercase code in the bio still counts (case insensitive)');
  R(!link.bioHasCode(profile.bio, 'OMNYA-7K3QZE'), 'a different code does not');
  R(!link.bioHasCode(profile.bio, null), 'and no code never matches');
  R(link.codeExpired({ link_code_expires_at: '2020-01-01T00:00:00Z' }) &&
    !link.codeExpired({ link_code_expires_at: new Date(Date.now() + 60000).toISOString() }),
    'codeExpired reads link_code_expires_at');

  stubFetch([{ status: 200, body: fixture('profile_private.json') }]);
  let r = await pub.getProfile('some.creator');
  R(r.kind === 'private' && r.error === 'profile_private', 'a private account is kind private', JSON.stringify(r));

  // =========================================================================
  console.log('\nAC-11 / AC-12 -- classifying failures');
  // =========================================================================
  stubFetch([{ status: 404, body: { success: false, message: 'User not found' } }]);
  r = await pub.getProfile('gone');
  R(r.kind === 'not_found' && r.error === 'profile_not_found' && calls.length === 1,
    '404 is not_found, with no retry', JSON.stringify(r));

  stubFetch([{ status: 400, body: { success: false, message: "This user doesn't exist" } }]);
  r = await pub.getProfile('gone');
  R(r.kind === 'not_found', 'a 400 that says the user does not exist is not_found too', JSON.stringify(r));

  for (const status of [401, 402, 403, 429]) {
    stubFetch([{ status, body: { message: 'nope' } }]);
    r = await pub.getProfile('some.creator');
    R(r.kind === 'provider' && r.status === status && calls.length === 1,
      `${status} is provider wide, never retried and never blamed on the creator`, JSON.stringify(r));
  }

  stubFetch([{ status: 502, body: null }, { status: 503, body: null }]);
  r = await pub.getProfile('some.creator');
  R(r.kind === 'transient' && calls.length === 2, 'a 5xx is retried once, then transient', `calls=${calls.length}`);

  stubFetch([{ status: 500, body: null }, { status: 200, body: fixture('profile.json') }]);
  r = await pub.getProfile('some.creator');
  R(!r.error && r.handle === 'some.creator' && calls.length === 2, 'a 5xx followed by success is a success');

  stubFetch([{ throw: 'AbortError' }]);
  r = await pub.getProfile('some.creator');
  R(r.kind === 'transient' && r.timeout === true && calls.length === 2, 'a timeout is retried once, then transient', JSON.stringify(r));

  const key = process.env.SCRAPECREATORS_API_KEY;
  delete process.env.SCRAPECREATORS_API_KEY;
  stubFetch([{ status: 200, body: fixture('profile.json') }]);
  r = await pub.getProfile('some.creator');
  R(r.kind === 'provider' && calls.length === 0, 'no API key is provider wide and makes no call', JSON.stringify(r));
  process.env.SCRAPECREATORS_API_KEY = key;

  // =========================================================================
  console.log('\nAC-7 / AC-8 -- videos');
  // =========================================================================
  stubFetch([
    { status: 200, body: fixture('videos.json') },
    { status: 200, body: { success: true, aweme_list: [], max_cursor: 0 } },
  ]);
  r = await pub.listVideos('some.creator', 30);
  const v = r.videos && r.videos[0];
  R(r.videos && r.videos.length === 2 && !r.partial, 'listVideos returns both fixture videos', JSON.stringify(r).slice(0, 80));
  R(calls.length === 2 && calls[1].url.includes('max_cursor=1748286476000'),
    'it pages with max_cursor and stops on an empty page', calls.map((c) => c.url.split('?')[1]).join(' | '));
  R(v && v.id === '7517114944362499342' && v.views === 120000 && v.likes === 5960 &&
    v.comments === 587 && v.shares === 342 && v.saves === 1565,
    'counts map from statistics.*_count', JSON.stringify(v && { views: v.views, likes: v.likes }));
  R(v && v.authorHandle === 'some.creator', 'the author is author.unique_id (the handle), not the nickname');
  R(v && v.postedAt === '2025-06-18T02:45:25.000Z' && v.durationSeconds === 17,
    'create_time becomes postedAt and duration ms becomes seconds', `${v && v.postedAt} ${v && v.durationSeconds}`);

  stubFetch([
    { status: 200, body: fixture('videos.json') },
    { status: 402, body: { message: 'out of credits' } },
  ]);
  r = await pub.listVideos('some.creator', 30);
  R(r.kind === 'provider', 'a provider wide failure on page 2 still propagates', JSON.stringify(r).slice(0, 80));

  stubFetch([
    { status: 200, body: fixture('videos.json') },
    { status: 500, body: null },
  ]);
  r = await pub.listVideos('some.creator', 30);
  R(r.videos && r.videos.length === 2 && r.partial === true, 'a transient failure on page 2 keeps page 1, marked partial');

  stubFetch([{ status: 200, body: fixture('video.json') }]);
  r = await pub.getVideo('https://www.tiktok.com/@some.creator/video/7545933721589910798');
  R(r.authorHandle === 'another.account' && r.views === 9000000,
    'getVideo reads aweme_detail, and the author is the real uploader (mismatch case)', JSON.stringify(r).slice(0, 80));

  stubFetch([{ status: 200, body: { success: true, aweme_detail: null } }]);
  r = await pub.getVideo('https://www.tiktok.com/@x/video/1');
  R(r.kind === 'not_found' && r.error === 'video_not_found', 'a missing aweme_detail is video_not_found');

  // =========================================================================
  console.log('\nAC-8 -- write rules');
  // =========================================================================
  const J = (newViews, storedVerified, previousFetch) => link.checkJump({ newViews, storedVerified, previousFetch });
  R(J(120000, 0, null).apply, 'first verified count is written whatever its size');
  R(J(19000, 999, null).apply, 'a stored count under 1,000 is never held');
  R(J(100000, 5000, null).apply, 'exactly 20x is allowed');
  R(J(9000000, 5000, null).held, 'a 1,800x glitch on first sight is held');
  R(J(9000000, 5000, 4000).held, 'and held when the previous fetch was normal');
  R(J(9000000, 5000, 8900000).apply, 'and applied when two fetches in a row agree');

  const now = Date.parse('2026-10-23T12:00:00Z');
  const daysAgo = (d) => new Date(now - d * 86400000).toISOString();
  R(link.lookupEligible({ posted_at: daysAgo(10) }, null, now), 'a 10 day old post with no verified count is looked up');
  R(!link.lookupEligible({ posted_at: daysAgo(46) }, null, now), 'a 46 day old post keeps its last value');
  R(link.lookupEligible({ posted_at: null, created_at: daysAgo(3) }, null, now), 'created_at stands in for a missing posted_at');
  R(!link.lookupEligible({ posted_at: daysAgo(3), view_count_verified_at: new Date(now - 3600000).toISOString() }, null, now),
    'a post verified an hour ago is not looked up again');
  R(link.lookupEligible({ posted_at: daysAgo(3), view_count_verified_at: daysAgo(2) }, null, now),
    'one verified 2 days ago is');
  R(!link.lookupEligible({ posted_at: daysAgo(3) }, daysAgo(2), now), 'a not found cached 2 days ago skips the lookup');
  R(link.lookupEligible({ posted_at: daysAgo(10) }, daysAgo(8), now), 'one cached 8 days ago tries again');

  const future = new Date(Date.now() + 86400000).toISOString();
  R(link.hasUsableOAuth({ access_token_encrypted: 'x', connection_status: 'connected', token_expires_at: future }),
    'a connected, unexpired token is usable OAuth');
  R(!link.hasUsableOAuth({ access_token_encrypted: 'x', connection_status: 'reauth_required' }),
    'reauth_required is not, so the link job takes over');
  R(!link.hasUsableOAuth({ access_token_encrypted: null, connection_status: 'not_connected' }),
    'a link only row (no token) is not');

  // =========================================================================
  console.log('\nAC-19 -- migration missing');
  // =========================================================================
  for (const code of ['42703', '42P01', 'PGRST204', 'PGRST202']) {
    R(link.isLinkSchemaMissing({ code }), `${code} reads as migration missing`);
  }
  R(!link.isLinkSchemaMissing({ code: '23505' }) && !link.isLinkSchemaMissing(null), 'other errors do not');
  let sent;
  link.sendMigrationMissing({
    status(s) { sent = { status: s }; return this; },
    setHeader() { return this; },
    send(b) { sent.body = JSON.parse(b); },
  });
  R(sent.status === 503 && sent.body.error.code === 'migration_missing' &&
    sent.body.error.message.includes('supabase/SETUP.sql'),
    'it answers 503 migration_missing naming the file', JSON.stringify(sent));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('\nHARNESS ERROR:', e); process.exit(2); });
