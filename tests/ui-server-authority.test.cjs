// tests/ui-server-authority.test.cjs
//
// N-18. Static guard: the browser must not perform privileged writes itself.
//
// PayoutManager used to call approve_withdrawal_request,
// reject_withdrawal_request, create_payout_batch and mark_payout_batch_paid as
// direct supabase.rpc() calls, and to upsert payment_managers straight from the
// client. The RPCs carry their own authorization, so this was not an open door
// -- but the RPC is only one step of what the endpoint does, and the browser
// path skipped every other step:
//
//   /api/withdrawals/approve     payment row + audit log + email to the creator
//   /api/withdrawals/reject      audit log + email with the reason
//   /api/payouts/create-batch    can_export_batches checked before the RPC
//   /api/payouts/mark-paid       THE STRIPE TRANSFERS, then emails
//   /api/payment-managers/grant  owner-only, writes payment_manager_granted
//
// So a creator could be approved and never told, rejected and never told, or a
// batch marked paid with no money actually moving -- and payment_audit_logs
// stayed empty through all of it.
//
// This suite reads the source rather than running it, because the failure it
// guards against is a call site being added back, which no runtime test of the
// current behaviour would notice.
//
//   node tests/ui-server-authority.test.cjs

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(js|jsx)$/.test(e.name) && !/\.test\.js$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const files = walk(SRC).map(f => ({
  path: path.relative(ROOT, f).replace(/\\/g, '/'),
  text: fs.readFileSync(f, 'utf8'),
}));

// Blank out `//` prose so a call site *described* in a comment is not mistaken
// for a real one. The N-18 note in PayoutManager.js names every RPC and every
// endpoint it touches, which is exactly what a naive grep reports as the bug it
// documents.
//
// Two rules learned the hard way here:
//
//   · Blank the line, do not delete it. Deleting shifts every line number
//     after it, and the first version of this file reported a real call site
//     700 lines from where it actually was.
//   · Do not strip /* */ with a regex. `/* eslint-disable */` at the top and
//     the JSX `{/* ... */}` comments further down made a non-greedy pass
//     swallow whole regions of real code, so three call sites that were
//     plainly present were reported as missing. Block comments cannot produce
//     a false positive for any pattern below, so they are simply left alone.
function code(text) {
  return text
    .split('\n')
    .map(l => (/^\s*\/\//.test(l) ? '' : l))
    .join('\n');
}

const source = files.map(f => ({ ...f, code: code(f.text) }));

function findAll(pattern) {
  const hits = [];
  for (const f of source) {
    const lines = f.code.split('\n');
    lines.forEach((line, i) => {
      if (pattern.test(line)) hits.push(`${f.path}:${i + 1}`);
    });
  }
  return hits;
}

// ---------------------------------------------------------------------------

console.log('N-18 -- the browser does not move money by itself\n');

// 1. The four money RPCs.
const MONEY_RPCS = [
  'approve_withdrawal_request',
  'reject_withdrawal_request',
  'create_payout_batch',
  'mark_payout_batch_paid',
];

for (const rpc of MONEY_RPCS) {
  const hits = findAll(new RegExp(`\\.rpc\\(\\s*['"\`]${rpc}['"\`]`));
  R(hits.length === 0, `no direct supabase.rpc('${rpc}') in the UI`,
    hits.length ? hits.join(', ') : 'none');
}

// 2. payment_managers: the table that decides who may move money.
const grantWrites = findAll(
  /\.from\(\s*['"`]payment_managers['"`]\s*\)[\s\S]{0,80}?\.(insert|upsert|update|delete)\b/
);
const grantChained = source.flatMap(f => {
  const out = [];
  const lines = f.code.split('\n');
  lines.forEach((line, i) => {
    if (!/\.from\(\s*['"`]payment_managers['"`]\s*\)/.test(line)) return;
    // The write verb usually lands on the next line or two in this codebase.
    const window = lines.slice(i, i + 4).join('\n');
    if (/\.(insert|upsert|update|delete)\s*\(/.test(window)) out.push(`${f.path}:${i + 1}`);
  });
  return out;
});
const grantAll = [...new Set([...grantWrites, ...grantChained])];
R(grantAll.length === 0, 'the UI never writes payment_managers directly',
  grantAll.length ? grantAll.join(', ') : 'reads only');

// 3. The endpoints that must now be called.
const REQUIRED = [
  '/api/withdrawals/approve',
  '/api/withdrawals/reject',
  '/api/payouts/create-batch',
  '/api/payouts/mark-paid',
  '/api/payment-managers/grant',
  '/api/payment-managers/revoke',
];
for (const ep of REQUIRED) {
  const hits = findAll(new RegExp(ep.replace(/\//g, '\\/')));
  R(hits.length > 0, `the UI calls ${ep}`, hits.length ? hits[0] : 'NOT CALLED');
}

// 4. Every privileged call goes through one helper, so the auth header and the
//    error envelope cannot drift apart between call sites.
const pm = source.find(f => f.path === 'src/components/PayoutManager.js');
R(!!pm && /async function callApi\(/.test(pm.code),
  'PayoutManager routes through a single callApi() helper');

const rawFetches = pm
  ? (pm.code.match(/fetch\(\s*['"`]\/api\//g) || []).length
  : -1;
// callApi itself contains the only bare fetch(path, ...). The export path uses
// a template literal with a query string, which is a GET download rather than a
// privileged write, so one extra is expected.
R(rawFetches <= 1, 'no privileged call bypasses callApi()',
  rawFetches + ' bare fetch(\'/api/...\') call(s)');

// 5. The error envelope is read correctly.
//    { ok: false, error: { code, message } } -- error is an OBJECT. Reading it
//    straight into an Error renders "[object Object]" on screen.
const objectObject = findAll(/new Error\(\s*(?:data|json)\.error\s*\|\|/);
R(objectObject.length === 0,
  'no call site renders the error object as a string',
  objectObject.length ? objectObject.join(', ') : 'none');

// ---------------------------------------------------------------------------
// Reported, not asserted: the legacy weekly-payments flow in App.js still
// writes public.payments from the browser. That predates the payout system and
// is a separate table from the one the payout endpoints touch, so failing on it
// here would be scope creep -- but it is the same shape of finding and should
// not go unrecorded.
// ---------------------------------------------------------------------------

const legacyPayments = source.flatMap(f => {
  const out = [];
  const lines = f.code.split('\n');
  lines.forEach((line, i) => {
    if (/\.from\(\s*["'`]payments["'`]\s*\)/.test(line) &&
        /\.(insert|update|delete|upsert)\s*\(/.test(lines.slice(i, i + 3).join('\n'))) {
      out.push(`${f.path}:${i + 1}`);
    }
  });
  return out;
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');

if (legacyPayments.length) {
  console.log('\nNoted, not failed -- the legacy weekly-payments flow still writes');
  console.log('public.payments from the browser. Separate from the payout system,');
  console.log('but the same shape as N-18 and worth closing:');
  for (const h of legacyPayments) console.log('  ' + h);
}

process.exit(fail ? 1 : 0);
