// tests/money-writes.test.cjs
//
// api/earnings/review.js and api/payments/record-approval.js, offline with a scripted admin client.
//
//   node tests/money-writes.test.cjs

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

// One scripted response per "<table>.<operation>".
let script = {};
let calls = [];
let actor = { id: 'owner-1', role: 'owner' };

function fakeClient() {
  return {
    from(table) {
      const state = { table, op: null, payload: null, filters: [] };
      const b = {};
      for (const op of ['select', 'update', 'insert', 'eq', 'in', 'limit']) {
        b[op] = (...args) => {
          if (op === 'update' || op === 'insert') { state.op = op; state.payload = args[0]; }
          else if (op === 'select' && !state.op) state.op = 'select';
          else if (op === 'eq' || op === 'in') state.filters.push([op, ...args]);
          return b;
        };
      }
      const finish = () => {
        calls.push(state);
        const r = script[`${state.table}.${state.op}`];
        return Promise.resolve(typeof r === 'function' ? r(state) : (r || { data: null, error: null }));
      };
      b.maybeSingle = finish;
      b.then = (ok, err) => finish().then(ok, err);
      return b;
    },
  };
}

stub('_utils/supabaseAdmin.js', { getSupabaseAdminClient: () => fakeClient() });
stub('_utils/auth.js', {
  requireRole: async (req, res, roles) => (roles.includes(actor.role)
    ? { user: { id: actor.id }, profile: { id: actor.id, role: actor.role } }
    : (res.status(403).send({ ok: false, error: { code: 'forbidden' } }), null)),
  normalizeRole: (r) => String(r || '').toLowerCase(),
});
stub('_utils/cors.js', { applyCors: () => false });
stub('_utils/rateLimit.js', { applyRateLimit: async () => false });
stub('_lib/paymentPermissions.js', { logPaymentAction: async () => {} });

const review = require(path.join(API, 'earnings', 'review.js'));
const record = require(path.join(API, 'payments', 'record-approval.js'));

function fakeRes() {
  const out = { code: null, body: null };
  const res = {
    setHeader: () => res,
    status: (c) => { out.code = c; return res; },
    send: (b) => { out.body = typeof b === 'string' ? JSON.parse(b) : b; return res; },
    json: (b) => { out.body = b; return res; },
    end: () => res,
  };
  return { res, out };
}

async function call(handler, body, scripted, as = { id: 'owner-1', role: 'owner' }) {
  script = scripted; calls = []; actor = as;
  const { res, out } = fakeRes();
  await handler({ method: 'POST', headers: {}, query: {}, body }, res);
  return out;
}

const SUB = {
  id: 's1', creator_id: 'c1', campaign_id: 'k1', status: 'Approved',
  campaigns: { id: 'k1', pay_per_video: 75, clients: { am_id: 'am1', account_managers: { user_id: 'am-user-1' } } },
};

(async () => {
  console.log('\nBonus review');
  let r = await call(review, { earningId: 'e1', action: 'approve' }, { 'creator_earnings.update': { data: [{ id: 'e1', status: 'approved', amount: 10 }], error: null } });
  const upd = calls.find((c) => c.op === 'update');
  R(r.code === 200 && upd.payload.status === 'approved', 'the owner approves a bonus');
  R(upd.filters.some(([op, col]) => op === 'in' && col === 'status'), 'only a bonus still waiting for review is changed');
  r = await call(review, { earningId: 'e1', action: 'forfeit' }, {});
  R(r.code === 400, 'forfeiting needs a reason');
  r = await call(review, { earningId: 'e1', action: 'approve' }, { 'creator_earnings.update': { data: [], error: null } });
  R(r.code === 400, 'a bonus already decided is reported, not silently ignored');
  r = await call(review, { earningId: 'e1', action: 'approve' }, {}, { id: 'am-user-1', role: 'am' });
  R(r.code === 403, 'an account manager cannot review bonuses');

  console.log('\nPayment on approval');
  r = await call(record, { submissionId: 's1' }, {
    'submissions.select': { data: SUB, error: null },
    'payments.select': { data: [], error: null },
    'payments.insert': { data: [{ id: 'p1' }], error: null },
  }, { id: 'am-user-1', role: 'am' });
  const ins = calls.find((c) => c.op === 'insert');
  R(r.code === 200 && ins && ins.payload.amount_owed === 75 && ins.payload.status === 'pending',
    "the client's manager creates a pending payment at the campaign rate", JSON.stringify(ins && ins.payload));
  r = await call(record, { submissionId: 's1' }, { 'submissions.select': { data: SUB, error: null } }, { id: 'am-user-2', role: 'am' });
  R(r.code === 403 && !calls.some((c) => c.op === 'insert'), "another manager's campaign is refused");
  r = await call(record, { submissionId: 's1' }, {
    'submissions.select': { data: SUB, error: null },
    'payments.select': { data: [{ id: 'p1' }], error: null },
  });
  R(r.code === 200 && r.body.data.created === false && !calls.some((c) => c.op === 'insert'), 'a second call returns the existing payment');
  r = await call(record, { submissionId: 's1' }, { 'submissions.select': { data: { ...SUB, status: 'Under Review' }, error: null } });
  R(r.code === 400, 'a submission that is not approved gets no payment');
  r = await call(record, { submissionId: 's1' }, {}, { id: 'cr-1', role: 'creator' });
  R(r.code === 403, 'a creator cannot create payments');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
