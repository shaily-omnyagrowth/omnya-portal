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
const { syncSubmissions } = require(path.join(ROOT, 'api/_utils/analytics'));

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

// ---------------------------------------------------------------------------

async function run() {
  const origFetch = global.fetch;

  try {
    // ---- 1. The happy path, and the table it reads --------------------------
    let seenAuth = null;
    global.fetch = async (url, opts) => {
      seenAuth = opts && opts.headers && opts.headers.Authorization;
      return {
        ok: true, status: 200,
        json: async () => ({ data: { videos: [{
          id: '7300000000000000000',
          view_count: 12000, like_count: 800, comment_count: 40, share_count: 25,
        }] } }),
      };
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

    const statusWrite = sb.writes.find(w => w.table === 'creator_social_accounts');
    R(!!statusWrite, 'the sync outcome is written back to the account row');
    R(statusWrite && statusWrite.col === 'id' && statusWrite.val === ACCT,
      'keyed by id, not by (user_id, platform)',
      statusWrite ? `${statusWrite.col}=${String(statusWrite.val).slice(0, 8)}` : '');
    R(statusWrite && statusWrite.values.connection_status === 'connected'
      && statusWrite.values.last_error === null,
      'a clean run clears last_error');

    // No plaintext token may appear in anything we wrote.
    const written = JSON.stringify({ w: sb.writes, u: sb.upserts });
    R(!written.includes(PLAINTEXT_TOKEN),
      'no plaintext token appears in anything written back');

    // ---- 2. Provider failure is recorded, not swallowed ---------------------
    global.fetch = async () => ({
      ok: false, status: 401,
      json: async () => ({ error: { message: 'access_token_invalid' } }),
    });
    sb = fakeSupabase({ accounts: [account()] });
    summary = await syncSubmissions(sb, [submission()]);

    R(summary.failed === 1 && summary.updated === 0,
      'a provider error fails the submission rather than reporting success',
      `failed=${summary.failed}`);

    const failWrite = sb.writes.find(w => w.table === 'creator_social_accounts');
    R(failWrite && failWrite.values.connection_status === 'sync_failed',
      "the account is flagged 'sync_failed' -- the value the live CHECK accepts",
      failWrite ? failWrite.values.connection_status : 'no write');
    R(failWrite && typeof failWrite.values.last_error === 'string' && failWrite.values.last_error,
      'and the reason is stored for the UI',
      failWrite ? String(failWrite.values.last_error).slice(0, 40) : '');

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
    global.fetch = async (url) => {
      igCalled = true;
      if (String(url).includes('/me/accounts')) {
        return { ok: true, status: 200,
          json: async () => ({ data: [{ instagram_business_account: { id: 'ig1' } }] }) };
      }
      if (String(url).includes('/media')) {
        return { ok: true, status: 200,
          json: async () => ({ data: [{ id: 'm1', shortcode: 'ABC123',
            like_count: 5, comments_count: 1, media_type: 'VIDEO' }] }) };
      }
      return { ok: true, status: 200,
        json: async () => ({ data: [{ name: 'reach', values: [{ value: 99 }] }] }) };
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
    const used = sb.writes.find(w => w.table === 'creator_social_accounts');
    R(used && used.val === 'ig-row',
      'a direct Instagram connection is preferred over the Meta fallback',
      used ? `used ${used.val}` : 'no write');

  } finally {
    global.fetch = origFetch;
  }
}

(async () => {
  console.log('Analytics token path -- reads the encrypted table, not the legacy one');
  await run();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\nHARNESS ERROR:', e); process.exit(2); });
