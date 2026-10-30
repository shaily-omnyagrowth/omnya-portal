// tests/invite-roles.test.cjs
//
// api/admin/users/create.js refuses owner and pending invites, and
// api/admin/users/role.js refuses a move back to pending.
//
//   node tests/invite-roles.test.cjs

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

let invited = 0;
const q = {
  select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: null }),
  upsert: async () => ({ error: null }),
};
stub('_utils/supabaseAdmin.js', {
  getSupabaseAdminClient: () => ({
    from: () => q,
    auth: { admin: { inviteUserByEmail: async () => { invited++; return { data: { user: { id: 'u2' } }, error: null }; } } },
  }),
});
stub('_lib/adminGuard.js', {
  requireOwner: async () => ({ user: { id: 'owner-1' } }),
  parseBody: (req) => req.body,
  loadTargetProfile: async () => null,
  refuseSelfTarget: () => false,
  refuseLastOwnerRemoval: () => false,
});
stub('_utils/cors.js', { applyCors: () => false });
stub('_utils/rateLimit.js', { applyRateLimit: async () => false });

const create = require(path.join(API, 'admin', 'users', 'create.js'));
const role = require(path.join(API, 'admin', 'users', 'role.js'));

async function call(handler, body) {
  const out = { code: null };
  const res = { setHeader: () => res, status: (c) => { out.code = c; return res; }, json: () => res, send: () => res, end: () => res };
  await handler({ method: 'POST', headers: {}, query: {}, body }, res);
  return out;
}

(async () => {
  console.log('\nInvite roles');
  for (const r of ['owner', 'pending']) {
    const out = await call(create, { email: 'new@example.com', role: r });
    R(out.code === 400 && invited === 0, `an invite as ${r} is refused`, String(out.code));
  }
  await call(create, { email: 'new@example.com', role: 'am' });
  R(invited === 1, 'an invite as account manager goes out');

  console.log('\nRole changes');
  const out = await call(role, { userId: 'u2', role: 'pending' });
  R(out.code === 400, 'a move back to pending is refused', String(out.code));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
