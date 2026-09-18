// tests/campaign-share.test.cjs
//
// api/campaigns/manage-share.js, driven offline with a scripted admin client.
//
// Written after production showed "Failed to update share settings." on every
// Share click. The cause was a migration nobody had applied
// (20260908000000_campaign_shares_and_progress.sql), but the handler folded
// PostgREST's "column does not exist" into the same generic message it uses
// for any failure, so the screen could not say what was wrong. This pins the
// distinction: a missing column names the migration; everything else stays
// generic.
//
// Auth and the database are stubbed through require.cache, so the suite needs
// no servers, no network and no .env. The authorization gate itself is covered
// by endpoints.test.cjs and role-boundaries.test.cjs.
//
//   node tests/campaign-share.test.cjs
//
// Exit codes: 0 pass . 1 fail.

const path = require('path');

const ROOT = path.join(__dirname, '..');
const API = path.join(ROOT, 'api');
const MIGRATION = '20260908000000_campaign_shares_and_progress.sql';

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};

// ---------------------------------------------------------------------------
// Stubs. Installed before the handler is required so its own require() calls
// resolve to these.
// ---------------------------------------------------------------------------

function stub(rel, exports) {
  const id = require.resolve(path.join(API, rel));
  require.cache[id] = { id, filename: id, loaded: true, exports, children: [], paths: [] };
}

// One scripted response per "<table>.<operation>"; a function receives the
// builder state (payload for an update) so a response can echo it back.
let script = {};
let calls = [];

function fakeClient() {
  return {
    from(table) {
      const state = { table, op: null, payload: null };
      const b = {};
      const step = (op) => (...args) => {
        if (op === 'update') { state.op = 'update'; state.payload = args[0]; }
        else if (op === 'select' && !state.op) state.op = 'select';
        return b;
      };
      for (const op of ['select', 'update', 'eq', 'limit']) b[op] = step(op);
      const finish = () => {
        calls.push({ table: state.table, op: state.op, payload: state.payload });
        const r = script[`${state.table}.${state.op}`];
        return Promise.resolve(typeof r === 'function' ? r(state) : (r || { data: null, error: null }));
      };
      b.single = finish;
      b.maybeSingle = finish;
      b.then = (ok, err) => finish().then(ok, err);
      return b;
    },
  };
}

stub('_utils/supabaseAdmin.js', { getSupabaseAdminClient: () => fakeClient() });
stub('_utils/auth.js', {
  requireRole: async () => ({ user: { id: 'owner-1' }, profile: { id: 'owner-1', email: 'owner@example.com', role: 'owner' } }),
  normalizeRole: r => String(r || '').toLowerCase(),
});
stub('_utils/cors.js', { applyCors: () => false });

const handler = require(path.join(API, 'campaigns', 'manage-share.js'));

// ---------------------------------------------------------------------------

function fakeRes() {
  const out = { code: null, body: null, headers: {} };
  const res = {
    setHeader: (k, v) => { out.headers[String(k).toLowerCase()] = v; return res; },
    status: c => { out.code = c; return res; },
    send: b => { out.body = typeof b === 'string' ? JSON.parse(b) : b; return res; },
    json: b => { out.body = b; return res; },
    end: () => res,
  };
  return { res, out };
}

async function call(body, scripted) {
  script = scripted;
  calls = [];
  const { res, out } = fakeRes();
  await handler({ method: 'POST', headers: {}, query: {}, body, url: '/api/campaigns/manage-share' }, res);
  return out;
}

const toggle = { campaignId: '11111111-1111-1111-1111-111111111111', action: 'toggle' };
const missingColumn = { code: '42703', message: 'column campaigns.share_enabled does not exist' };
const unknownColumn = { code: 'PGRST204', message: "Could not find the 'share_enabled' column of 'campaigns' in the schema cache" };

(async () => {
  console.log('\napi/campaigns/manage-share.js\n');

  // 1. The production failure: the SELECT that reads the current flag fails
  //    because the column is not there.
  let r = await call(toggle, { 'campaigns.select': { data: null, error: missingColumn } });
  R(r.code === 500 && r.body?.error?.code === 'schema_missing',
    'a missing column on read answers schema_missing', `${r.code} ${r.body?.error?.code}`);
  R(String(r.body?.error?.message || '').includes(MIGRATION),
    'and the message names the migration to apply', r.body?.error?.message);
  R(!calls.some(c => c.op === 'update'),
    'and no UPDATE is attempted against a schema that cannot take it');

  // 2. The same on the write path (PostgREST's own code for a payload column).
  r = await call(toggle, {
    'campaigns.select': { data: { share_enabled: false, share_token: null }, error: null },
    'campaigns.update': { data: null, error: unknownColumn },
  });
  R(r.code === 500 && r.body?.error?.code === 'schema_missing' && String(r.body?.error?.message).includes(MIGRATION),
    'a missing column on write answers schema_missing naming the migration', `${r.code} ${r.body?.error?.code}`);

  // 3. Any other database failure stays generic: the mapping is specific.
  r = await call(toggle, {
    'campaigns.select': { data: { share_enabled: false, share_token: 'tok' }, error: null },
    'campaigns.update': { data: null, error: { code: '23505', message: 'duplicate key' } },
  });
  R(r.code === 500 && r.body?.error?.code === 'internal',
    'an unrelated database error is still reported as internal', `${r.code} ${r.body?.error?.code}`);
  R(!String(r.body?.error?.message || '').includes('duplicate key'),
    'without leaking the raw database message');

  // 4. A campaign that does not exist is 404, not a toggle of nothing.
  r = await call(toggle, { 'campaigns.select': { data: null, error: null } });
  R(r.code === 404, 'an unknown campaign answers 404', String(r.code));
  R(!calls.some(c => c.op === 'update'), 'and is not updated');

  // 5. The happy path: first enable mints a token, and the answer carries it.
  r = await call(toggle, {
    'campaigns.select': { data: { share_enabled: false, share_token: null }, error: null },
    'campaigns.update': s => ({ data: { id: toggle.campaignId, ...s.payload }, error: null }),
  });
  const upd = calls.find(c => c.op === 'update');
  R(r.code === 200 && r.body?.ok === true, 'toggling a private campaign succeeds', String(r.code));
  R(upd && upd.payload.share_enabled === true, 'and turns sharing on');
  R(upd && /^[0-9a-f-]{36}$/.test(String(upd.payload.share_token)), 'and mints a share token when there is none');
  R(r.body?.data?.share_enabled === true && r.body?.data?.share_token === upd?.payload.share_token,
    'and returns the new state to the modal');

  // 6. Disabling keeps the token, so re-enabling restores the same link.
  r = await call(toggle, {
    'campaigns.select': { data: { share_enabled: true, share_token: 'keep-me' }, error: null },
    'campaigns.update': s => ({ data: { id: toggle.campaignId, share_token: 'keep-me', ...s.payload }, error: null }),
  });
  const upd2 = calls.find(c => c.op === 'update');
  R(r.code === 200 && upd2 && upd2.payload.share_enabled === false && !('share_token' in upd2.payload),
    'disabling turns sharing off and leaves the token alone');

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST BUG:', e); process.exit(1); });
