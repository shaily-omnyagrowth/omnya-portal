// tests/tiktok-link-routes.test.cjs
//
// Offline tests for spec 0002 slice 1's server code, run through the real
// handlers:
//
//   POST /api/tiktok-link/save          AC-1, AC-2, AC-3, AC-19
//   POST /api/tiktok-link/review        AC-5, AC-6
//   GET  /api/cron/sync-tiktok-links    AC-4, AC-7, AC-8, AC-12, AC-13
//   POST /api/earnings/recalculate      AC-10
//
// The Supabase client is an in memory stand in that applies the filters the
// handlers send, so the assertions are on the rows that end up in each table,
// not on which methods were called. global.fetch answers from
// tests/fixtures/scrapecreators/. apply_verified_views is mirrored from the
// SQL; its database behaviour is proven by the PGlite suite
// (supabase/migrations/__tests__/tiktok-profile-links.test.cjs).
//
//   node tests/tiktok-link-routes.test.cjs

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures', 'scrapecreators');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8'));

process.env.SCRAPECREATORS_API_KEY = 'test-key';
process.env.CRON_SECRET = 'cron-test-secret';
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.TIKTOK_VERIFIED_BONUS_ONLY;

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};

// ---------------------------------------------------------------------------
// In memory Supabase
// ---------------------------------------------------------------------------

let seq = 0;
const newId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
const UNIQUE = {
  creator_social_accounts: [['user_id', 'platform']],
  creator_videos: [['user_id', 'platform', 'platform_video_id']],
  social_profile_snapshots: [['social_account_id', 'snapshot_date']],
  video_analytics: [['submission_id']],
};

function makeDb() {
  const db = {
    tables: {},
    users: {},              // token -> user
    rpcs: [],
    failNext: null,         // { table, code } -> next query on that table errors
  };
  const rows = (t) => (db.tables[t] = db.tables[t] || []);
  const get = (r, col) => col.split('.').reduce((o, k) => (o == null ? o : o[k]), r);

  function verifiedHandleClash(t) {
    if (t !== 'creator_social_accounts') return false;
    const seen = new Set();
    for (const r of rows(t)) {
      if (r.link_status !== 'verified') continue;
      if (seen.has(r.link_handle)) return true;
      seen.add(r.link_handle);
    }
    return false;
  }

  function from(table) {
    const q = { op: null, filters: [], payload: null, opts: null, wantRows: false, single: false, order: null };
    const match = (r) => q.filters.every(([op, col, val]) => {
      const v = get(r, col);
      if (op === 'eq') return v === val;
      if (op === 'neq') return v !== val;
      if (op === 'gt') return v != null && v > val;
      if (op === 'in') return val.includes(v);
      if (op === 'notnull') return v != null;
      return true;
    });
    const exec = () => {
      if (db.failNext && db.failNext.table === table) {
        const code = db.failNext.code;
        db.failNext = null;
        return { data: null, error: { code, message: `simulated ${code}` } };
      }
      const t = rows(table);
      if (!q.op || q.op === 'select') {
        let out = t.filter(match).map((r) => ({ ...r }));
        if (q.order) {
          const [col, o] = q.order;
          out.sort((a, b) => {
            const x = a[col], y = b[col];
            if (x == null && y == null) return 0;
            if (x == null) return o.nullsFirst ? -1 : 1;
            if (y == null) return o.nullsFirst ? 1 : -1;
            return (x < y ? -1 : x > y ? 1 : 0) * (o.ascending === false ? -1 : 1);
          });
        }
        if (q.single) return { data: out[0] || null, error: null };
        return { data: out, error: null };
      }
      if (q.op === 'update') {
        const hit = t.filter(match);
        const before = hit.map((r) => ({ ...r }));
        hit.forEach((r) => Object.assign(r, q.payload));
        if (verifiedHandleClash(table)) {
          hit.forEach((r, i) => { Object.keys(r).forEach((k) => delete r[k]); Object.assign(r, before[i]); });
          return { data: null, error: { code: '23505', message: 'duplicate key' } };
        }
        return { data: q.wantRows ? hit.map((r) => ({ ...r })) : null, error: null };
      }
      const list = Array.isArray(q.payload) ? q.payload : [q.payload];
      const out = [];
      for (const p of list) {
        const keys = q.op === 'upsert'
          ? q.opts.onConflict.split(',')
          : null;
        const existing = keys && t.find((r) => keys.every((k) => r[k] === p[k]));
        if (existing) { Object.assign(existing, p); out.push({ ...existing }); continue; }
        for (const u of UNIQUE[table] || []) {
          if (t.some((r) => u.every((k) => r[k] === p[k]))) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        }
        const row = { id: newId(), link_health: table === 'creator_social_accounts' ? 'ok' : undefined, ...p };
        t.push(row);
        out.push({ ...row });
      }
      return { data: q.wantRows ? out : null, error: null };
    };
    const chain = {
      select() { if (q.op) q.wantRows = true; else q.op = 'select'; return chain; },
      insert(p) { q.op = 'insert'; q.payload = p; return chain; },
      update(p) { q.op = 'update'; q.payload = p; return chain; },
      upsert(p, o) { q.op = 'upsert'; q.payload = p; q.opts = o; return chain; },
      eq(c, v) { q.filters.push(['eq', c, v]); return chain; },
      neq(c, v) { q.filters.push(['neq', c, v]); return chain; },
      gt(c, v) { q.filters.push(['gt', c, v]); return chain; },
      in(c, v) { q.filters.push(['in', c, v]); return chain; },
      not(c, op, v) { q.filters.push(op === 'is' ? ['notnull', c] : ['neq', c, v]); return chain; },
      order(c, o) { q.order = [c, o || {}]; return chain; },
      limit() { return chain; },
      maybeSingle() { q.single = true; return Promise.resolve(exec()); },
      single() { q.single = true; const r = exec(); return Promise.resolve(r.data == null && !r.error ? { data: null, error: { code: 'PGRST116', message: 'no rows' } } : r); },
      then(res, rej) { return Promise.resolve(exec()).then(res, rej); },
    };
    return chain;
  }

  // Mirrors 20261023000000's apply_verified_views().
  function applyVerifiedViews({ p_submission_id, p_views, p_source, p_user_id, p_handle }) {
    const sub = rows('submissions').find((s) => s.id === p_submission_id);
    if (!sub || !sub.creators || sub.creators.user_id !== p_user_id) return false;
    if (p_source === 'link' && !rows('creator_social_accounts').some((a) =>
      a.user_id === p_user_id && a.platform === 'tiktok' && a.link_status === 'verified' && a.link_handle === p_handle)) {
      return false;
    }
    sub.view_count_verified = Math.max(sub.view_count_verified || 0, p_views);
    sub.view_count_verified_at = new Date().toISOString();
    sub.verified_views_source = p_source;
    return true;
  }

  db.client = {
    from,
    auth: {
      getUser: async (token) => (db.users[token]
        ? { data: { user: db.users[token] }, error: null }
        : { data: null, error: { message: 'bad token' } }),
    },
    rpc: async (name, args) => {
      db.rpcs.push({ name, args });
      if (name === 'apply_verified_views') return { data: applyVerifiedViews(args), error: null };
      return { data: null, error: null };
    },
  };
  return db;
}

let db = makeDb();
require.cache[require.resolve(path.join(ROOT, 'api/_utils/supabaseAdmin'))] = {
  id: 'supabaseAdmin', filename: 'supabaseAdmin', loaded: true,
  exports: { getSupabaseAdminClient: () => db.client },
};

const save = require(path.join(ROOT, 'api/tiktok-link/save'));
const review = require(path.join(ROOT, 'api/tiktok-link/review'));
const cron = require(path.join(ROOT, 'api/cron/sync-tiktok-links'));
const recalc = require(path.join(ROOT, 'api/earnings/recalculate'));

async function call(handler, { method = 'POST', token, body, auth } = {}) {
  const res = {
    statusCode: 200, headers: {}, body: null,
    status(s) { this.statusCode = s; return this; },
    setHeader(k, v) { this.headers[k] = v; return this; },
    send(b) { this.body = typeof b === 'string' ? JSON.parse(b) : b; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (auth) headers.authorization = auth;
  await handler({ method, headers, body: body === undefined ? {} : JSON.stringify(body), socket: {} }, res);
  return res;
}

// fetch answers by endpoint. `override` can replace one answer for a test.
let fetchCalls = [];
let override = null;
global.fetch = async (url) => {
  const u = new URL(String(url));
  fetchCalls.push(u.pathname + u.search);
  const answer = (override && override(u)) || (() => {
    if (u.pathname === '/v1/tiktok/profile') return { status: 200, body: fixture('profile.json') };
    if (u.pathname === '/v3/tiktok/profile/videos') {
      return u.searchParams.get('max_cursor')
        ? { status: 200, body: { success: true, aweme_list: [], max_cursor: 0 } }
        : { status: 200, body: fixture('videos.json') };
    }
    if (u.pathname === '/v2/tiktok/video') return { status: 200, body: fixture('video.json') };
    return { status: 404, body: {} };
  })();
  return { ok: answer.status < 300, status: answer.status, url: String(url), json: async () => answer.body };
};

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

const A = { id: 'u-creator-a', token: 'tok-a' };
const B = { id: 'u-creator-b', token: 'tok-b' };
const AM1 = { id: 'u-am-1', token: 'tok-am1' };
const AM2 = { id: 'u-am-2', token: 'tok-am2' };
const OWNER = { id: 'u-owner', token: 'tok-owner' };

function seed() {
  db = makeDb();
  for (const u of [A, B, AM1, AM2, OWNER]) db.users[u.token] = { id: u.id };
  db.tables.user_profiles = [
    { id: A.id, role: 'creator' }, { id: B.id, role: 'creator' },
    { id: AM1.id, role: 'account_manager' }, { id: AM2.id, role: 'account_manager' },
    { id: OWNER.id, role: 'owner' },
  ];
  db.tables.account_managers = [{ id: 'am-1', user_id: AM1.id }, { id: 'am-2', user_id: AM2.id }];
  db.tables.creators = [
    { id: 'cr-a', user_id: A.id, name: 'Creator A', am_id: 'am-1' },
    { id: 'cr-b', user_id: B.id, name: 'Creator B', am_id: 'am-2' },
  ];
}

const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();

(async () => {
  // =========================================================================
  console.log('\nsave -- AC-1, AC-2, AC-3, AC-19');
  // =========================================================================
  seed();
  let r = await call(save, { token: A.token, body: { handle: 'https://www.tiktok.com/@Some.Creator?lang=en' } });
  const first = r.body && r.body.data;
  R(r.statusCode === 200 && first && first.handle === 'some.creator' && first.linkStatus === 'pending_code' &&
    /^OMNYA-[0-9A-Z]{6}$/.test(first.code), 'a profile URL saves as some.creator, pending, with a code', JSON.stringify(r.body));
  const rowA = db.tables.creator_social_accounts[0];
  R(rowA && rowA.user_id === A.id && rowA.creator_id === 'cr-a' && rowA.username === 'some.creator' &&
    !('connection_status' in rowA), 'the row is the caller\'s own, linked to their creator, OAuth columns untouched');
  R(Math.abs(new Date(first.codeExpiresAt).getTime() - (Date.now() + 7 * 86400000)) < 60000, 'the code expires in 7 days');

  r = await call(save, { token: A.token, body: { handle: '@some.creator' } });
  R(r.statusCode === 200 && r.body.data.code !== first.code && db.tables.creator_social_accounts.length === 1,
    'saving the same handle while pending issues a new code on the same row');

  r = await call(save, { token: A.token, body: { handle: 'not a handle!' } });
  R(r.statusCode === 422 && r.body.error.code === 'invalid_tiktok_handle', 'garbage is 422 invalid_tiktok_handle');

  r = await call(save, { token: AM1.token, body: { handle: 'some.creator' } });
  R(r.statusCode === 403, 'only creators can save a link', String(r.statusCode));

  Object.assign(rowA, { link_status: 'verified', link_code_found_at: daysAgo(1), link_verified_at: daysAgo(1) });
  r = await call(save, { token: B.token, body: { handle: 'some.creator' } });
  R(r.statusCode === 409 && r.body.error.code === 'handle_claimed', 'another creator saving a verified handle gets 409 handle_claimed');
  R(!db.tables.creator_social_accounts.some((x) => x.user_id === B.id), 'and nothing is written for them');

  const codeBefore = rowA.link_code;
  r = await call(save, { token: A.token, body: { handle: 'some.creator' } });
  R(r.statusCode === 200 && r.body.data.linkStatus === 'verified' && rowA.link_code === codeBefore,
    'saving the same handle while verified changes nothing');

  r = await call(save, { token: A.token, body: { handle: 'new.handle' } });
  R(rowA.link_status === 'pending_code' && rowA.link_handle === 'new.handle' && rowA.link_verified_at === null &&
    rowA.link_code_found_at === null && rowA.link_failure_count === 0, 'a new handle resets a verified row to pending');

  db.failNext = { table: 'creator_social_accounts', code: '42703' };
  r = await call(save, { token: A.token, body: { handle: 'some.creator' } });
  R(r.statusCode === 503 && r.body.error.code === 'migration_missing' &&
    r.body.error.message.includes('supabase/SETUP.sql'), 'an unapplied migration is 503 migration_missing naming the file');

  // =========================================================================
  console.log('\nreview -- AC-5, AC-6');
  // =========================================================================
  seed();
  db.tables.creator_social_accounts = [{
    id: 'acc-a', user_id: A.id, platform: 'tiktok', link_handle: 'some.creator',
    link_status: 'code_found', link_code: 'OMNYA-7K3QZD', link_health: 'ok',
  }];
  const acc = db.tables.creator_social_accounts[0];

  r = await call(review, { token: AM2.token, body: { accountId: '00000000-0000-4000-8000-000000000000', handle: 'x', action: 'verify' } });
  R(r.statusCode === 404, 'an unknown account is 404', String(r.statusCode));

  acc.id = '11111111-1111-4111-8111-111111111111';
  const reviewBody = (extra) => ({ accountId: acc.id, handle: 'some.creator', action: 'verify', ...extra });

  r = await call(review, { token: AM2.token, body: reviewBody() });
  R(r.statusCode === 403 && r.body.error.code === 'not_your_creator', "another creator's AM gets 403 not_your_creator");
  r = await call(review, { token: A.token, body: reviewBody() });
  R(r.statusCode === 403, 'the creator cannot review themselves');

  r = await call(review, { token: AM1.token, body: reviewBody({ handle: 'other.handle' }) });
  R(r.statusCode === 409 && r.body.error.code === 'invalid_link_state', 'a handle other than the one shown is 409 invalid_link_state');

  override = (u) => (u.pathname === '/v1/tiktok/profile'
    ? { status: 200, body: { ...fixture('profile.json'), user: { ...fixture('profile.json').user, signature: 'no code here' } } }
    : null);
  r = await call(review, { token: AM1.token, body: reviewBody() });
  R(r.statusCode === 409 && r.body.error.code === 'code_missing' && acc.link_status === 'code_found',
    'a code gone from the bio is 409 code_missing and nothing changes');

  override = (u) => (u.pathname === '/v1/tiktok/profile' ? { status: 402, body: {} } : null);
  r = await call(review, { token: AM1.token, body: reviewBody() });
  R(r.statusCode === 502 && r.body.error.code === 'provider_unavailable', 'a provider outage on the recheck is 502');
  override = null;

  r = await call(review, { token: AM1.token, body: reviewBody() });
  R(r.statusCode === 200 && acc.link_status === 'verified' && acc.link_verified_by === AM1.id && acc.link_verified_at,
    "the creator's own AM verifies it", JSON.stringify(r.body));
  const audit = db.rpcs.find((x) => x.name === 'log_admin_action');
  R(audit && audit.args.p_action === 'tiktok_link_verified' && audit.args.p_entity_type === 'creator_social_account' &&
    audit.args.p_entity_label === 'some.creator' && audit.args.p_actor === AM1.id, 'and one audit row names the actor and handle');

  r = await call(review, { token: AM1.token, body: reviewBody() });
  R(r.statusCode === 409, 'verifying twice is 409 invalid_link_state', String(r.statusCode));

  r = await call(review, { token: OWNER.token, body: reviewBody({ action: 'reject', reason: 'no' }) });
  R(r.statusCode === 422 && r.body.error.code === 'reason_required', 'a reject reason under 3 characters is 422');
  r = await call(review, { token: OWNER.token, body: reviewBody({ action: 'reject', reason: 'This is not your account.' }) });
  R(r.statusCode === 200 && acc.link_status === 'rejected' && acc.link_rejected_reason === 'This is not your account.',
    'an owner can reject a verified link with a reason');

  // B has no AM: owners only.
  db.tables.creators[1].am_id = null;
  db.tables.creator_social_accounts.push({
    id: '22222222-2222-4222-8222-222222222222', user_id: B.id, platform: 'tiktok',
    link_handle: 'b.handle', link_status: 'code_found', link_code: 'OMNYA-7K3QZD',
  });
  r = await call(review, { token: AM1.token, body: { accountId: '22222222-2222-4222-8222-222222222222', handle: 'b.handle', action: 'verify' } });
  R(r.statusCode === 403, 'a creator with no AM cannot be reviewed by an AM');

  // A concurrent verify losing to the unique index.
  db.tables.creator_social_accounts.push({ id: 'acc-c', user_id: 'u-c', platform: 'tiktok', link_handle: 'b.handle', link_status: 'verified' });
  r = await call(review, { token: OWNER.token, body: { accountId: '22222222-2222-4222-8222-222222222222', handle: 'b.handle', action: 'verify' } });
  R(r.statusCode === 409 && r.body.error.code === 'handle_claimed', 'losing the race to the unique index is 409 handle_claimed');

  // =========================================================================
  console.log('\ncron -- AC-4, AC-7, AC-8, AC-13');
  // =========================================================================
  seed();
  db.tables.creator_social_accounts = [
    { id: 'acc-a', user_id: A.id, creator_id: 'cr-a', platform: 'tiktok', link_handle: 'some.creator',
      link_status: 'verified', link_last_fetched_at: null },
    { id: 'acc-b', user_id: B.id, creator_id: 'cr-b', platform: 'tiktok', link_handle: 'b.pending',
      link_status: 'pending_code', link_code: 'OMNYA-7K3QZD', link_code_expires_at: new Date(Date.now() + 86400000).toISOString() },
  ];
  db.tables.submissions = [
    { id: 'sub-match', creator_id: 'cr-a', campaign_id: 'ca-1', platform: 'TikTok', submission_type: 'Final',
      posted_link: 'https://www.tiktok.com/@some.creator/video/7517114944362499342', posted_at: daysAgo(20),
      view_count_verified: 0, view_count_verified_at: null, creators: { user_id: A.id } },
    { id: 'sub-stolen', creator_id: 'cr-a', campaign_id: 'ca-1', platform: 'TikTok', submission_type: 'Final',
      posted_link: 'https://www.tiktok.com/@another.account/video/7545933721589910798', posted_at: daysAgo(5),
      view_count_verified: 0, view_count_verified_at: null, creators: { user_id: A.id } },
    { id: 'sub-ig', creator_id: 'cr-a', campaign_id: 'ca-1', platform: 'Instagram', submission_type: 'Final',
      posted_link: 'https://www.instagram.com/reel/abc', posted_at: daysAgo(5), creators: { user_id: A.id } },
    { id: 'sub-concept', creator_id: 'cr-a', campaign_id: 'ca-1', platform: 'TikTok', submission_type: 'Concept',
      posted_link: 'https://www.tiktok.com/@some.creator/video/7516000000000000001', creators: { user_id: A.id } },
  ];

  r = await call(cron, { method: 'GET', auth: 'Bearer wrong' });
  R(r.statusCode === 401, 'a wrong cron secret is 401');

  fetchCalls = [];
  r = await call(cron, { method: 'GET', auth: 'Bearer cron-test-secret' });
  const sum = r.body && r.body.data;
  R(r.statusCode === 200, 'the run completes', JSON.stringify(r.body).slice(0, 200));
  const accB = db.tables.creator_social_accounts.find((x) => x.id === 'acc-b');
  R(accB.link_status === 'code_found' && accB.link_code_found_at && sum.codes_found === 1,
    'a pending row whose bio holds the code moves to code_found (AC-4)');

  const subMatch = db.tables.submissions.find((s) => s.id === 'sub-match');
  R(subMatch.view_count_verified === 120000 && subMatch.verified_views_source === 'link' && subMatch.view_count_verified_at,
    "the matching Final submission gets view_count_verified = 120000 from 'link' (AC-8)", JSON.stringify(subMatch));
  const stolen = db.tables.submissions.find((s) => s.id === 'sub-stolen');
  R(!stolen.view_count_verified_at && sum.author_mismatch === 1,
    "another account's video is not credited and counts as author_mismatch", `author_mismatch=${sum.author_mismatch}`);
  R(!db.tables.submissions.find((s) => s.id === 'sub-concept').view_count_verified_at,
    'a Concept submission is never matched');

  const vids = db.tables.creator_videos || [];
  R(vids.length === 2 && vids.every((v) => v.source === 'link' && v.author_handle === 'some.creator' && v.social_account_id === 'acc-a'),
    'the 2 feed videos are upserted as source link with their author (AC-7)', `videos=${vids.length}`);
  R((db.tables.video_metrics || []).length === 2, 'one video_metrics row per video');
  const snap = (db.tables.social_profile_snapshots || [])[0];
  R(snap && snap.follower_count === 4100 && snap.snapshot_date === new Date().toISOString().slice(0, 10),
    "today's (UTC) follower snapshot is written");
  const va = (db.tables.video_analytics || []).find((x) => x.submission_id === 'sub-match');
  R(va && va.views === 120000 && va.platform === 'tiktok' && va.video_id === '7517114944362499342',
    'video_analytics carries the matched numbers for dashboards');
  const accA = db.tables.creator_social_accounts.find((x) => x.id === 'acc-a');
  R(accA.follower_count === 4100 && accA.link_last_fetched_at, 'follower_count and link_last_fetched_at move once the pipeline finished');
  R(fetchCalls.every((c) => !c.includes('instagram')), 'no provider call for the Instagram submission');

  // A second run: the feed video is fetched again, nothing double counts, and
  // a later 0 never lowers the verified count.
  override = (u) => (u.pathname === '/v3/tiktok/profile/videos' && !u.searchParams.get('max_cursor')
    ? { status: 200, body: { ...fixture('videos.json'), aweme_list: fixture('videos.json').aweme_list.map((v) => ({ ...v, statistics: { ...v.statistics, play_count: 0 } })) } }
    : null);
  await call(cron, { method: 'GET', auth: 'Bearer cron-test-secret' });
  override = null;
  R(subMatch.view_count_verified === 120000, 'a later fetch of 0 views never lowers the verified count');

  // Handle changed under the run: the write is a stale skip.
  accA.link_status = 'verified';
  const realRpc = db.client.rpc;
  db.client.rpc = async (name, args) => {
    if (name === 'apply_verified_views') accA.link_handle = 'renamed.handle';
    return realRpc(name, args);
  };
  subMatch.view_count_verified = 100;
  r = await call(cron, { method: 'GET', auth: 'Bearer cron-test-secret' });
  db.client.rpc = realRpc;
  R(subMatch.view_count_verified === 100 && r.body.data.stale_skip >= 1,
    'a handle change mid run writes nothing (stale_skip)', `stale_skip=${r.body.data.stale_skip}`);
  accA.link_handle = 'some.creator';

  // AC-9: a usable OAuth token keeps the link job away.
  Object.assign(accA, { access_token_encrypted: 'enc', connection_status: 'connected',
    token_expires_at: new Date(Date.now() + 86400000).toISOString() });
  fetchCalls = [];
  r = await call(cron, { method: 'GET', auth: 'Bearer cron-test-secret' });
  R(r.body.data.creators_eligible === 0 && !fetchCalls.some((c) => c.includes('videos')),
    'a creator with a usable OAuth token is skipped by the link job (AC-9)');
  Object.assign(accA, { connection_status: 'reauth_required' });
  r = await call(cron, { method: 'GET', auth: 'Bearer cron-test-secret' });
  R(r.body.data.creators_eligible === 1, 'and taken over again once OAuth needs a reconnect');

  // =========================================================================
  console.log('\ncron -- AC-12, AC-19');
  // =========================================================================
  const lastFetched = accA.link_last_fetched_at;
  accB.link_status = 'pending_code';
  override = () => ({ status: 402, body: { message: 'out of credits' } });
  fetchCalls = [];
  r = await call(cron, { method: 'GET', auth: 'Bearer cron-test-secret' });
  override = null;
  R(r.statusCode === 503 && r.body.error.code === 'provider_unavailable', 'out of credits stops the run with 503 provider_unavailable');
  R(accA.link_last_fetched_at === lastFetched && accB.link_status === 'pending_code',
    'and changes no creator');
  R(fetchCalls.length <= 4, 'workers start nothing new after the refusal', `calls=${fetchCalls.length}`);

  db.failNext = { table: 'creator_social_accounts', code: '42703' };
  r = await call(cron, { method: 'GET', auth: 'Bearer cron-test-secret' });
  R(r.statusCode === 503 && r.body.error.code === 'migration_missing', 'an unapplied migration is 503 migration_missing');

  // =========================================================================
  console.log('\nrecalculate -- AC-10');
  // =========================================================================
  // requirePaymentPermission('manage_payment_managers') is owner only.
  seed();
  const old = daysAgo(30);
  db.tables.submissions = [
    { id: 's-tt-held', creator_id: 'cr-a', campaign_id: 'ca', status: 'Approved', posted_at: old,
      platform: 'TikTok', posted_link: 'https://www.tiktok.com/@a/video/1', view_count_submitted: 500000, view_count_verified: 0, view_count_verified_at: null },
    { id: 's-tt-ok', creator_id: 'cr-a', campaign_id: 'ca', status: 'Approved', posted_at: old,
      platform: 'TikTok', posted_link: 'https://www.tiktok.com/@a/video/2', view_count_submitted: 900000, view_count_verified: 120000, view_count_verified_at: old },
    { id: 's-ig', creator_id: 'cr-a', campaign_id: 'ca', status: 'Approved', posted_at: old,
      platform: 'Instagram', posted_link: 'https://www.instagram.com/reel/x', view_count_submitted: 500000, view_count_verified: 0 },
  ];
  db.tables.creator_earnings = [];
  const bonusFor = (id) => db.tables.creator_earnings.find((e) => e.submission_id === id && e.earning_type === 'performance_bonus');

  r = await call(recalc, { token: OWNER.token });
  const flagOff = JSON.stringify(r.body);
  R(r.statusCode === 200 && bonusFor('s-tt-held') && r.body.data.bonusHeld === 0,
    'flag off: the TikTok bonus is paid on submitted views exactly as today', flagOff.slice(0, 160));

  seed();
  db.tables.submissions = JSON.parse(JSON.stringify([
    { id: 's-tt-held', creator_id: 'cr-a', campaign_id: 'ca', status: 'Approved', posted_at: old,
      platform: 'TikTok', posted_link: 'https://www.tiktok.com/@a/video/1', view_count_submitted: 500000, view_count_verified: 0, view_count_verified_at: null },
    { id: 's-tt-ok', creator_id: 'cr-a', campaign_id: 'ca', status: 'Approved', posted_at: old,
      platform: 'TikTok', posted_link: 'https://www.tiktok.com/@a/video/2', view_count_submitted: 900000, view_count_verified: 120000, view_count_verified_at: old },
    { id: 's-ig', creator_id: 'cr-a', campaign_id: 'ca', status: 'Approved', posted_at: old,
      platform: 'Instagram', posted_link: 'https://www.instagram.com/reel/x', view_count_submitted: 500000, view_count_verified: 0 },
  ]));
  db.tables.creator_earnings = [];
  process.env.TIKTOK_VERIFIED_BONUS_ONLY = 'true';
  r = await call(recalc, { token: OWNER.token });
  delete process.env.TIKTOK_VERIFIED_BONUS_ONLY;
  R(r.statusCode === 200 && r.body.data.bonusHeld === 1 && !bonusFor('s-tt-held'),
    'flag on: a TikTok submission without verified views gets no bonus and is counted in bonusHeld', JSON.stringify(r.body).slice(0, 160));
  const okBonus = bonusFor('s-tt-ok');
  R(okBonus && Number(okBonus.views_counted) === 120000, 'a verified one is paid on view_count_verified, not the 900k submitted');
  R(bonusFor('s-ig') && Number(bonusFor('s-ig').views_counted) === 500000, 'other platforms keep today\'s logic');
  R(db.tables.creator_earnings.filter((e) => e.earning_type === 'base_video_pay').length === 3, 'base pay is unchanged');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('\nHARNESS ERROR:', e); process.exit(2); });
