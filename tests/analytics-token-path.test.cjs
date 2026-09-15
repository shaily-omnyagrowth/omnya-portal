// tests/analytics-token-path.test.cjs
//
// Guards the defect that made this work necessary.
//
// The OAuth callbacks were moved onto creator_social_accounts (encrypted)
// while api/_utils/analytics.js still read creator_tokens. Nothing threw:
// syncSubmissions simply found no token for any newly connected account and
// recorded 'no_token'. A creator would connect successfully and then watch
// their view counts never update, with nothing in any log to explain it.
//
// Silent wrong-table reads are exactly the class of bug a type checker will
// not catch and a smoke test will not notice, so it gets a dedicated suite.
//
// It also guards the second round of silent "connected but nothing moves"
// defects (2026-09-15):
//
//   · the sync queried submission_type 'Final Post'; the submit form writes 'Final'
//   · Instagram insights asked for the retired 'impressions' metric, so views
//     and reach were always 0
//   · only the first page of Instagram media was searched
//   · the dropdown label, not the link, chose the token
//   · one missing post flipped a healthy account to 'sync_failed'
//
// Everything runs offline: the Supabase client and global.fetch are both
// stubbed, so this asserts on the real control flow rather than on a mock's
// opinion of it.
//
//   node tests/analytics-token-path.test.cjs

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
if (!/^[0-9a-fA-F]{64}$/.test((process.env.ENCRYPTION_KEY || '').trim())) {
  process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('hex');
}

const { encrypt } = require(path.join(ROOT, 'api/_utils/encryption'));
const analytics = require(path.join(ROOT, 'api/_utils/analytics'));
const social = require(path.join(ROOT, 'api/_utils/socialAccounts'));
const { graphVersion } = require(path.join(ROOT, 'api/_utils/meta'));
const { syncSubmissions } = analytics;

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};

const USER = '11111111-1111-1111-1111-111111111111';
const ACCT = 'aaaaaaaa-1111-1111-1111-111111111111';
const PLAINTEXT_TOKEN = 'act.tiktok-real-access-token';

// ---------------------------------------------------------------------------
// A Supabase stand-in that records which tables were touched and how.
// ---------------------------------------------------------------------------

function fakeSupabase({ accounts = [], accountsError = null } = {}) {
  const reads = [];
  const writes = [];
  const upserts = [];

  function from(table) {
    reads.push({ table, kind: 'from' });
    const chain = {
      _table: table,
      select() { return chain; },
      in() { return chain; },
      // The account query ends on .not(...), so that is where it resolves.
      not() {
        return Promise.resolve(
          table === 'creator_social_accounts'
            ? { data: accounts, error: accountsError }
            : { data: [], error: null }
        );
      },
      upsert(row, opts) {
        upserts.push({ table, row, opts });
        return Promise.resolve({ error: null });
      },
      update(values) {
        return {
          eq(col, val) {
            writes.push({ table, values, col, val });
            return Promise.resolve({ error: null });
          },
        };
      },
    };
    return chain;
  }

  return { from, reads, writes, upserts, tables: () => [...new Set(reads.map(r => r.table))] };
}

// The sync outcome is the last write to the account row; a token refresh, when
// one happens, writes before it.
const outcomeWrite = sb => sb.writes.filter(w => w.table === 'creator_social_accounts').pop();

const account = over => Object.assign({
  id: ACCT,
  user_id: USER,
  platform: 'tiktok',
  access_token_encrypted: encrypt(PLAINTEXT_TOKEN),
  refresh_token_encrypted: encrypt('rft.tiktok-refresh'),
  // Comfortably fresh, so refreshIfNeeded is a no-op and no network is needed
  // for the refresh path itself.
  token_expires_at: new Date(Date.now() + 60 * 86400000).toISOString(),
  refresh_token_expires_at: null,
  connection_status: 'connected',
  metadata: {},
  created_at: new Date(Date.now() - 30 * 86400000).toISOString(),
  updated_at: new Date(Date.now() - 30 * 86400000).toISOString(),
}, over || {});

const submission = over => Object.assign({
  id: '50000000-0000-0000-0000-000000000001',
  creator_id: 'e0000000-0000-0000-0000-000000000001',
  campaign_id: 'ca000000-0000-0000-0000-000000000001',
  platform: 'tiktok',
  posted_link: 'https://www.tiktok.com/@someone/video/7300000000000000000',
  submission_type: 'final',
  creators: { user_id: USER },
}, over || {});

const okJson = body => ({ ok: true, status: 200, json: async () => body });
const tiktokVideo = { data: { videos: [{
  id: '7300000000000000000',
  view_count: 12000, like_count: 800, comment_count: 40, share_count: 25,
}] } };

// ---------------------------------------------------------------------------

async function run() {
  const origFetch = global.fetch;

  try {
    // ---- 1. The happy path, and the table it reads --------------------------
    let seenAuth = null;
    global.fetch = async (url, opts) => {
      seenAuth = opts && opts.headers && opts.headers.Authorization;
      return okJson(tiktokVideo);
    };

    let sb = fakeSupabase({ accounts: [account()] });
    let summary = await syncSubmissions(sb, [submission()]);

    R(sb.tables().includes('creator_social_accounts'),
      'tokens are read from creator_social_accounts', sb.tables().join(', '));
    R(!sb.tables().includes('creator_tokens'),
      'the legacy creator_tokens table is never touched');

    R(summary.processed === 1 && summary.updated === 1 && summary.failed === 0,
      'the submission syncs',
      `processed=${summary.processed} updated=${summary.updated} failed=${summary.failed} skipped=${summary.skipped}`);

    R(seenAuth === `Bearer ${PLAINTEXT_TOKEN}`,
      'the provider is called with the DECRYPTED token',
      seenAuth ? seenAuth.slice(0, 12) + '...' : 'no Authorization header seen');

    const va = sb.upserts.find(u => u.table === 'video_analytics');
    R(!!va, 'metrics are upserted into video_analytics');
    R(va && va.row.views === 12000 && va.row.likes === 800,
      'and carry the provider figures', va ? `views=${va.row.views} likes=${va.row.likes}` : '');

    const statusWrite = outcomeWrite(sb);
    R(!!statusWrite, 'the sync outcome is written back to the account row');
    R(statusWrite && statusWrite.col === 'id' && statusWrite.val === ACCT,
      'keyed by id, not by (user_id, platform)',
      statusWrite ? `${statusWrite.col}=${String(statusWrite.val).slice(0, 8)}` : '');
    R(statusWrite && statusWrite.values.connection_status === 'connected'
      && statusWrite.values.last_error === null,
      'a clean run clears last_error');

    // No plaintext token may appear in anything we wrote.
    let written = JSON.stringify({ w: sb.writes, u: sb.upserts });
    R(!written.includes(PLAINTEXT_TOKEN),
      'no plaintext token appears in anything written back');

    // ---- 2. A refused token that cannot be refreshed asks for a reconnect ----
    global.fetch = async () => ({
      ok: false, status: 401,
      json: async () => ({ error: { code: 'access_token_invalid', message: 'access_token_invalid' } }),
    });
    sb = fakeSupabase({ accounts: [account()] });
    summary = await syncSubmissions(sb, [submission()]);

    R(summary.failed === 1 && summary.updated === 0,
      'a provider error fails the submission rather than reporting success',
      `failed=${summary.failed}`);

    let failWrite = outcomeWrite(sb);
    R(failWrite && failWrite.values.connection_status === social.STATUS_REAUTH,
      `a refused token, still refused after a forced refresh, is flagged '${social.STATUS_REAUTH}'`,
      failWrite ? failWrite.values.connection_status : 'no write');
    R(failWrite && typeof failWrite.values.last_error === 'string' && failWrite.values.last_error,
      'and the reason is stored for the UI',
      failWrite ? String(failWrite.values.last_error).slice(0, 40) : '');

    // ---- 2b. A refused token that CAN be refreshed recovers in the same run --
    const savedKey = process.env.TIKTOK_CLIENT_KEY;
    const savedSecret = process.env.TIKTOK_CLIENT_SECRET;
    process.env.TIKTOK_CLIENT_KEY = 'test-client-key';
    process.env.TIKTOK_CLIENT_SECRET = 'test-client-secret';
    try {
      let tokenCalls = 0;
      global.fetch = async (url, opts) => {
        if (String(url).includes('/oauth/token/')) {
          tokenCalls++;
          return okJson({ access_token: 'act.rotated', expires_in: 86400, refresh_token: 'rft.rotated' });
        }
        if (opts && opts.headers && opts.headers.Authorization === 'Bearer act.rotated') return okJson(tiktokVideo);
        return { ok: false, status: 401,
          json: async () => ({ error: { code: 'access_token_invalid', message: 'revoked' } }) };
      };
      sb = fakeSupabase({ accounts: [account()] });
      summary = await syncSubmissions(sb, [submission()]);

      R(tokenCalls === 1 && summary.updated === 1 && summary.failed === 0,
        'a token revoked before its expiry is force-refreshed once and the post still syncs',
        `tokenCalls=${tokenCalls} updated=${summary.updated} failed=${summary.failed}`);
      R(outcomeWrite(sb) && outcomeWrite(sb).values.connection_status === 'connected',
        'and the account stays connected');
      written = JSON.stringify({ w: sb.writes, u: sb.upserts });
      R(!written.includes('act.rotated') && !written.includes('rft.rotated'),
        'the rotated tokens are persisted encrypted, never in plaintext');
    } finally {
      if (savedKey === undefined) delete process.env.TIKTOK_CLIENT_KEY; else process.env.TIKTOK_CLIENT_KEY = savedKey;
      if (savedSecret === undefined) delete process.env.TIKTOK_CLIENT_SECRET; else process.env.TIKTOK_CLIENT_SECRET = savedSecret;
    }

    // ---- 2c. One missing post does not poison a healthy account ------------
    global.fetch = async () => okJson({ data: { videos: [] } });
    sb = fakeSupabase({ accounts: [account()] });
    summary = await syncSubmissions(sb, [submission()]);
    failWrite = outcomeWrite(sb);
    R(summary.failed === 1 && failWrite && failWrite.values.connection_status === 'connected',
      'a post the provider cannot find leaves the account connected',
      failWrite ? failWrite.values.connection_status : 'no write');
    R(failWrite && failWrite.values.last_error === 'tiktok_video_not_found',
      'but still records why for the creator',
      failWrite ? String(failWrite.values.last_error) : '');
    R(!social.REAUTH_STATUSES.has('sync_failed') && !social.needsReauth({ connection_status: 'sync_failed' }),
      "'sync_failed' does not prompt a reconnect, so the nightly refresh no longer skips it");

    // ---- 3. No connection at all -------------------------------------------
    global.fetch = async () => { throw new Error('should not be called'); };
    sb = fakeSupabase({ accounts: [] });
    summary = await syncSubmissions(sb, [submission()]);
    R(summary.skipped === 1 && summary.errors[0] && summary.errors[0].reason === 'no_token',
      'a creator with no connected account is skipped, not failed',
      `skipped=${summary.skipped} reason=${summary.errors[0] && summary.errors[0].reason}`);

    // ---- 4. The Meta row serves Instagram and Facebook ---------------------
    // 'meta' is not a storable platform: the live CHECK accepts only
    // tiktok | instagram | facebook | youtube, so a Meta connection lands on
    // the facebook row with metadata.provider='meta'. One row, three lookups.
    let igCalled = false;
    let seenUrls = [];
    global.fetch = async (url) => {
      igCalled = true;
      seenUrls.push(String(url));
      if (String(url).includes('/me/accounts')) {
        return okJson({ data: [{ instagram_business_account: { id: 'ig1' } }] });
      }
      if (String(url).includes('/media')) {
        return okJson({ data: [{ id: 'm1', shortcode: 'ABC123',
          like_count: 5, comments_count: 1, media_type: 'VIDEO' }] });
      }
      return okJson({ data: [{ name: 'reach', values: [{ value: 99 }] }] });
    };

    sb = fakeSupabase({
      accounts: [account({ platform: 'facebook', metadata: { provider: 'meta' } })],
    });
    summary = await syncSubmissions(sb, [submission({
      platform: 'instagram',
      posted_link: 'https://www.instagram.com/reel/ABC123/',
    })]);

    R(summary.skipped === 0,
      'an Instagram submission finds the Meta-provider facebook row',
      `skipped=${summary.skipped} processed=${summary.processed}`);
    R(igCalled, 'and actually calls the Graph API');
    R(seenUrls.every(u => !u.includes('graph.facebook.com') || u.includes(`/${graphVersion()}/`)),
      `every Graph call uses the pinned version (${graphVersion()}), not the retired v19.0`);

    // ---- 5. A native Instagram row wins over the Meta one -------------------
    sb = fakeSupabase({
      accounts: [
        account({ platform: 'facebook', id: 'fb-row', metadata: { provider: 'meta' } }),
        account({ platform: 'instagram', id: 'ig-row', metadata: {} }),
      ],
    });
    summary = await syncSubmissions(sb, [submission({
      platform: 'instagram',
      posted_link: 'https://www.instagram.com/reel/ABC123/',
    })]);
    const used = outcomeWrite(sb);
    R(used && used.val === 'ig-row',
      'a direct Instagram connection is preferred over the Meta fallback',
      used ? `used ${used.val}` : 'no write');

    // ---- 6. Instagram Business Login: link wins, pages walk, views not impressions
    seenUrls = [];
    global.fetch = async (url) => {
      const u = String(url);
      seenUrls.push(u);
      if (u.includes('/me/media') && u.includes('after=page2')) {
        return okJson({ data: [{ id: 'm1', shortcode: 'ABC123', like_count: 5, comments_count: 1 }] });
      }
      if (u.includes('/me/media')) {
        return okJson({
          data: [{ id: 'm0', shortcode: 'NEWER1', like_count: 1, comments_count: 0 }],
          paging: { next: `https://graph.instagram.com/${graphVersion()}/me/media?after=page2` },
        });
      }
      if (u.includes('/m1/insights')) {
        return okJson({ data: [
          { name: 'views', values: [{ value: 4321 }] },
          { name: 'reach', values: [{ value: 999 }] },
          { name: 'saved', values: [{ value: 7 }] },
          { name: 'shares', values: [{ value: 3 }] },
        ] });
      }
      return { ok: false, status: 400, json: async () => ({ error: { code: 100, message: 'unexpected ' + u } }) };
    };
    sb = fakeSupabase({
      accounts: [account({ platform: 'instagram', id: 'ig-biz', metadata: { provider: 'instagram' } })],
    });
    summary = await syncSubmissions(sb, [submission({
      // The dropdown defaults to TikTok; the creator pasted an Instagram link
      // in the username-first format Instagram's share sheet produces.
      platform: 'TikTok',
      posted_link: 'https://www.instagram.com/someone/reel/ABC123/?igsh=abc',
    })]);
    const igRow = sb.upserts.find(u => u.table === 'video_analytics');
    R(summary.updated === 1 && igRow && igRow.row.platform === 'instagram',
      "the link, not the 'TikTok' dropdown label, picks the Instagram token",
      `updated=${summary.updated} errors=${JSON.stringify(summary.errors)}`);
    R(seenUrls.some(u => u.includes('after=page2')),
      'a post older than the first page of media is still found');
    R(igRow && igRow.row.views === 4321 && igRow.row.reach === 999 && igRow.row.saves === 7 && igRow.row.shares === 3,
      "views, reach, saves and shares come from the 'views'-era insights metrics",
      igRow ? `views=${igRow.row.views} reach=${igRow.row.reach} saves=${igRow.row.saves} shares=${igRow.row.shares}` : '');
    R(seenUrls.every(u => !u.includes('impressions')),
      "the retired 'impressions' metric is never requested");

    // ---- 7. Which submissions the sync picks up ----------------------------
    const calls = [];
    const q = {
      select() { calls.push(['select']); return q; },
      eq(...a) { calls.push(['eq', ...a]); return q; },
      not(...a) { calls.push(['not', ...a]); return q; },
      in(col, vals) {
        calls.push(['in', col, vals]);
        return Promise.resolve({ data: [
          submission({ id: 's-tt', platform: 'TikTok' }),
          submission({ id: 's-ig', platform: 'TikTok', posted_link: 'https://www.instagram.com/p/XYZ789/' }),
        ], error: null });
      },
    };
    await analytics.fetchAllFinalSubmissions({ from: () => q });
    const typeFilter = calls.find(c => c[0] === 'in' && c[1] === 'submission_type');
    R(typeFilter && typeFilter[2].includes('Final') && typeFilter[2].includes('Final Post'),
      "the sync selects the 'Final' type the submit form writes, not only 'Final Post'",
      typeFilter ? JSON.stringify(typeFilter[2]) : 'no submission_type filter');

    const mine = await analytics.fetchSubmissionsForUser({ from: () => q }, USER, 'tiktok');
    R(mine.length === 1 && mine[0].id === 's-tt',
      "a platform filter matches the 'TikTok' label and ignores a mislabelled Instagram link",
      mine.map(s => s.id).join(','));

  } finally {
    global.fetch = origFetch;
  }
}

function urlParsing() {
  const { extractVideoId: id, resolvePlatform, normalizePlatformLabel } = analytics;
  const cases = [
    ['tiktok', 'https://www.tiktok.com/@a/video/7300000000000000000?is_from_webapp=1', '7300000000000000000'],
    ['tiktok', 'https://www.tiktok.com/@a/photo/7400000000000000001', '7400000000000000001'],
    ['instagram', 'https://www.instagram.com/reel/ABC123/', 'ABC123'],
    ['instagram', 'https://www.instagram.com/someone/reel/ABC123/?igsh=x', 'ABC123'],
    ['instagram', 'https://www.instagram.com/reels/ABC123/', 'ABC123'],
    ['instagram', 'https://www.instagram.com/p/C_x-1y/', 'C_x-1y'],
    ['instagram', 'https://www.instagram.com/share/reel/BAabc123/', null],
    ['instagram', 'https://www.instagram.com/someone/', null],
    ['youtube', 'https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['youtube', 'https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['youtube', 'https://www.youtube.com/live/dQw4w9WgXcQ?si=1', 'dQw4w9WgXcQ'],
    ['facebook', 'https://www.facebook.com/watch/?v=123456789', '123456789'],
    ['facebook', 'https://www.facebook.com/permalink.php?story_fbid=222&id=111', '111_222'],
    ['facebook', 'https://www.facebook.com/somepage/videos/987654321/', '987654321'],
    ['facebook', 'https://fb.watch/abcDEF/', null],
    ['tiktok', null, null],
  ];
  for (const [platform, url, want] of cases) {
    const got = id(platform, url);
    R(got === want, `extractVideoId(${platform}, ${url})`, `-> ${got}`);
  }

  R(normalizePlatformLabel('IG Reel') === 'instagram'
    && normalizePlatformLabel('FB Reel') === 'facebook'
    && normalizePlatformLabel('YouTube Short') === 'youtube'
    && normalizePlatformLabel('TikTok') === 'tiktok',
    'campaign format and dropdown labels map onto platforms');
  R(resolvePlatform({ platform: 'TikTok', posted_link: 'https://www.youtube.com/shorts/dQw4w9WgXcQ' }) === 'youtube',
    'the posted link outranks the dropdown label');
  R(resolvePlatform({ platform: 'Instagram', posted_link: '' }) === 'instagram',
    'the label is used when there is no link to read');
}

(async () => {
  console.log('Analytics token path -- reads the encrypted table, not the legacy one');
  await run();
  console.log('\nPost link parsing');
  urlParsing();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\nHARNESS ERROR:', e); process.exit(2); });
