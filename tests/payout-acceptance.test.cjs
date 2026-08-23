// tests/payout-acceptance.test.cjs
//
// The acceptance criterion for the payout system.
//
// It walks one creator's money from earned to paid, through the same calls the
// application makes, and reconciles the ledger at the end:
//
//   payment method -> earnings recalculated -> owner approves earnings
//   -> withdrawal requested -> owner approves -> batch created -> CSV exported
//   -> batch marked paid -> ledger reconciles
//
// As of the 2026-08-21 audit this chain had never once completed in production.
// It fails at the database layer, and this test is written to say so precisely:
// a known pre-migration blocker is reported as BLOCKED with the migration step
// that fixes it, not as an anonymous 500. Once the migrations are applied every
// step should read PASS, and that is the proof the payout system works.
//
//   1. npm start
//   2. node tests/lib/devServer.cjs
//   3. node tests/payout-acceptance.test.cjs
//
// Exit codes: 0 all passed · 1 a real failure · 3 blocked on a pending migration.

const { select, selectOne, parseBody, env } = require('./lib/schema.cjs');
const { setup, teardown, tokens, post, rest } = require('./lib/fixture.cjs');
const { BASE } = require('./lib/ui.cjs');

// Known pre-migration conditions, mapped to the step that resolves them.
const BLOCKERS = [
  { match: /creator_earnings_status_check|23514/i, finding: 'N-03',
    why: 'the live CHECK rejects withdrawal_requested / batched',
    fix: 'migration step 2 — 20260821000000_payout_drift_and_authz.sql' },
  { match: /performed_by/i, finding: 'N-04',
    why: 'the deployed RPC bodies are the stale pre-bbf9612 versions',
    fix: 'migration step 1 — 20260530000001_payout_rpc_functions.sql' },
  { match: /stripe_account_id|stripe_transfer_id|column .*stripe/i, finding: 'N-08',
    why: 'the Stripe columns do not exist',
    fix: 'migration step 3 — 20260530000002_stripe_connect.sql' },
  { match: /can_manage_payment_managers/i, finding: 'N-07',
    why: 'a permission column that has never existed',
    fix: 'already fixed in api/_lib/paymentPermissions.js — redeploy' },
];

let pass = 0, failed = 0, blocked = 0;
const seen = new Set();

function record(state, label, detail) {
  const tag = { PASS: 'PASS', FAIL: 'FAIL', BLOCK: 'BLOCKED' }[state];
  console.log(`  ${tag.padEnd(7)} ${label.padEnd(44)} ${detail || ''}`);
  if (state === 'PASS') pass++; else if (state === 'FAIL') failed++; else blocked++;
}

/** Classify an error: a known migration blocker, or a genuine failure. */
function judge(label, message) {
  const hit = BLOCKERS.find(b => b.match.test(message || ''));
  if (hit) {
    seen.add(`${hit.finding} — ${hit.why}\n           fix: ${hit.fix}`);
    record('BLOCK', label, `${hit.finding}: ${hit.why}`);
    return false;
  }
  record('FAIL', label, String(message).slice(0, 120));
  return false;
}

const api = async (path, { method = 'GET', token, body } = {}) => {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, body: parseBody(text), raw: text };
};

const rpc = async (fn, args, token) => {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: env.REACT_APP_SUPABASE_ANON_KEY, 'content-type': 'application/json',
               authorization: 'Bearer ' + token },
    body: JSON.stringify(args),
  });
  const text = await r.text();
  return { status: r.status, body: parseBody(text), raw: text };
};

(async () => {
  console.log('\nPayout acceptance — earned money all the way to paid\n');
  const fx = await setup();
  const tk = await tokens(fx);
  const CID = fx.ids.creator;
  let wrId = null, batchId = null;

  try {
    // A posted video old enough to qualify for the view bonus.
    await post('submissions', {
      creator_id: CID, campaign_id: fx.ids.campaign,
      submission_type: 'Final Post', concept_status: 'Approved', final_status: 'Approved',
      platform: 'TikTok', posted_link: 'https://tiktok.com/@t/video/1',
      posted_url: 'https://tiktok.com/@t/video/1',
      posted_at: new Date(Date.now() - 15 * 86400000).toISOString(),
      view_count_submitted: 120000,
    });

    // ---- 1 ----------------------------------------------------------------
    let r = await api('/api/creators/payment-method', { method: 'PATCH', token: tk.creator,
      body: { payment_method: 'zelle', zelle_email: 'claude-test@example.com' } });
    r.status === 200
      ? record('PASS', '1. creator sets a payment method', r.body.data?.destination_summary || '')
      : judge('1. creator sets a payment method', r.raw);

    // ---- 2 ----------------------------------------------------------------
    r = await api('/api/earnings/recalculate', { method: 'POST', token: tk.owner, body: { creatorId: CID } });
    if (r.status === 200) {
      const d = r.body.data || {};
      record('PASS', '2. earnings recalculated',
        `base ${d.basePay?.created ?? '?'} + bonus ${d.bonus?.created ?? '?'}`);
    } else judge('2. earnings recalculated', r.raw);

    const earned = await select('creator_earnings', ['id', 'earning_type', 'amount', 'status'], `creator_id=eq.${CID}`);
    const total = earned.reduce((s, e) => s + Number(e.amount), 0);
    record(earned.length > 0 ? 'PASS' : 'FAIL', '3. earnings exist on the ledger',
      `${earned.length} row(s), $${total.toFixed(2)}`);

    // ---- 4 : owner approves, exactly as PayoutManager does ----------------
    const up = await rest(`creator_earnings?creator_id=eq.${CID}`, { method: 'PATCH',
      body: JSON.stringify({ status: 'approved', approved_at: new Date().toISOString() }) });
    up.ok ? record('PASS', '4. owner approves the earnings', 'status=approved')
          : judge('4. owner approves the earnings', await up.text());

    // ---- 5 : the creator asks to be paid ----------------------------------
    r = await api('/api/withdrawals/request', { method: 'POST', token: tk.creator });
    if (r.status === 200 && r.body?.data) {
      wrId = r.body.data.withdrawal_request_id || r.body.data.withdrawalRequestId;
      record('PASS', '5. creator requests a withdrawal', `$${r.body.data.amount} · ${wrId}`);
    } else judge('5. creator requests a withdrawal', r.raw);

    // ---- 6 : owner approves it --------------------------------------------
    if (wrId) {
      r = await rpc('approve_withdrawal_request', { p_request_id: wrId, p_approved_by: null }, tk.owner);
      if (r.status === 200 && r.body?.success !== false) {
        const row = await selectOne('withdrawal_requests', ['status'], `id=eq.${wrId}`);
        record(row?.status === 'approved' ? 'PASS' : 'FAIL',
          '6. owner approves the withdrawal', `status=${row?.status}`);
      } else judge('6. owner approves the withdrawal', r.raw);
    } else record('BLOCK', '6. owner approves the withdrawal', 'no withdrawal to approve');

    // ---- 7 : batch it ------------------------------------------------------
    if (wrId) {
      r = await api('/api/payouts/create-batch', { method: 'POST', token: tk.owner,
        body: { withdrawalRequestIds: [wrId] } });
      const d = r.body?.data;
      if (r.status === 200 && d && d.success !== false) {
        batchId = d.batch_id || d.batchId;
        record('PASS', '7. payout batch created', batchId || '');
      } else judge('7. payout batch created', r.raw);
    } else record('BLOCK', '7. payout batch created', 'no approved withdrawal');

    // ---- 8 : export --------------------------------------------------------
    if (batchId) {
      r = await api(`/api/payouts/export?batchId=${batchId}`, { token: tk.owner });
      r.status === 200 && r.raw.length > 0
        ? record('PASS', '8. batch exported', `${r.raw.split('\n').length} line(s) of CSV`)
        : judge('8. batch exported', r.raw);
    } else record('BLOCK', '8. batch exported', 'no batch');

    // ---- 9 : mark paid -----------------------------------------------------
    if (batchId) {
      r = await api('/api/payouts/mark-paid', { method: 'POST', token: tk.owner, body: { batchId } });
      r.status === 200 && r.body?.data?.success !== false
        ? record('PASS', '9. batch marked paid', `paidCount=${r.body?.data?.paidCount ?? '?'}`)
        : judge('9. batch marked paid', r.raw);
    } else record('BLOCK', '9. batch marked paid', 'no batch');

    // ---- 10 : the ledger has to agree with itself -------------------------
    const finalEarnings = await select('creator_earnings', ['status', 'amount'], `creator_id=eq.${CID}`);
    const finalWr = await select('withdrawal_requests', ['status', 'amount'], `creator_id=eq.${CID}`);
    const finalPay = await select('payments', ['status', 'amount'], `creator_id=eq.${CID}`);

    const allPaid = finalEarnings.length > 0 && finalEarnings.every(e => e.status === 'paid');
    const wrPaid = finalWr.length === 1 && finalWr[0].status === 'paid';
    const paySum = finalPay.reduce((s, p) => s + Number(p.amount || 0), 0);
    const earnSum = finalEarnings.reduce((s, e) => s + Number(e.amount), 0);

    if (allPaid && wrPaid && Math.abs(paySum - earnSum) < 0.01) {
      record('PASS', '10. ledger reconciles', `$${earnSum.toFixed(2)} earned = $${paySum.toFixed(2)} paid`);
    } else if (blocked > 0) {
      record('BLOCK', '10. ledger reconciles', 'chain never completed');
    } else {
      record('FAIL', '10. ledger reconciles',
        `earnings paid=${allPaid} · withdrawal paid=${wrPaid} · earned $${earnSum.toFixed(2)} vs paid $${paySum.toFixed(2)}`);
    }
  } finally {
    process.stdout.write('\nTearing down… ');
    await teardown(fx);
    console.log('done.');
  }

  console.log(`\n${'-'.repeat(72)}`);
  console.log(`  ${pass} passed · ${failed} failed · ${blocked} blocked`);

  if (seen.size) {
    console.log('\n  Blocked on migrations that have not been applied:\n');
    for (const b of seen) console.log('    · ' + b);
    console.log('\n  See supabase/migrations/APPLY_20260821.md. Steps 1 and 2 must go');
    console.log('  together — step 1 alone repairs the RPC bodies and removes the only');
    console.log('  thing currently stopping a creator approving their own payout.');
  } else if (!failed) {
    console.log('\n  The payout system completes end to end.');
  }
  console.log('');
  process.exit(failed ? 1 : (blocked ? 3 : 0));
})().catch(e => { console.error('\nHarness error:', e.message); process.exit(1); });
