// api/payouts/reconcile.js
//
// GET /api/payouts/reconcile
//
// Scope §6.1 — "Operate payout approvals, batches, exports and reconciliation
// where authorized." Reconciliation was the one verb in that sentence with no
// surface: payout_ledger_reconcile() has existed since 20260822000004 and
// nothing ever called it.
//
// §9.3 makes SUM(amount_delta) per creator the payable balance, and §16's
// payout-safety gate asks for "ledger invariants, idempotency, reconciliation
// and manual recovery tested". This is the report that makes the first and
// third checkable without opening the SQL editor.
//
// A non-zero drift means a status was written without passing through the
// ledger trigger — the single failure the ledger design exists to detect. It
// is reported per creator and never auto-corrected: a correction is an
// append-only reversing entry an operator makes deliberately, not something a
// GET request does on their behalf.
//
// Auth: owner, or a payment manager with can_view_payouts.

const { applyCors } = require('../_utils/cors');
const { Errors, sendOk } = require('../_utils/errors');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const { applyRateLimit } = require('../_utils/rateLimit');
const { requirePaymentPermission } = require('../_lib/paymentPermissions');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') return Errors.methodNotAllowed(res);

  // The reconcile query aggregates the whole ledger, so it is not free.
  const blocked = await applyRateLimit(req, res, {
    max: 20,
    windowSecs: 60,
    endpoint: 'payouts-reconcile',
  });
  if (blocked) return;

  const authCtx = await requirePaymentPermission(req, res, 'view_payouts');
  if (!authCtx) return;

  const supabase = getSupabaseAdminClient();

  try {
    // The wrapper joins the creator name and re-checks the permission at the
    // database boundary, so this is authorized twice on purpose.
    let rows = null;
    let usedFallback = false;

    const { data, error } = await supabase.rpc('payout_reconciliation_report');

    if (error) {
      // The wrapper only exists once 20260823000000 is applied. Fall back to
      // the raw reconcile so the page still works on a partly-migrated
      // database, and say which one answered.
      console.warn('[payouts/reconcile] wrapper unavailable, falling back:', error.message);

      const fallback = await supabase.rpc('payout_ledger_reconcile', { p_creator_id: null });
      if (fallback.error) {
        if (/does not exist|could not find/i.test(fallback.error.message)) {
          return Errors.badRequest(
            res,
            'The payout ledger is not installed on this database. Apply ' +
            '20260822000004_payout_ledger.sql to enable reconciliation.'
          );
        }
        throw fallback.error;
      }

      rows = fallback.data || [];
      usedFallback = true;

      // Attach names client-side of the RPC, since the raw function has none.
      const ids = rows.map((r) => r.creator_id).filter(Boolean);
      if (ids.length) {
        const { data: creators } = await supabase
          .from('creators').select('id, name').in('id', ids);
        const nameById = new Map((creators || []).map((c) => [c.id, c.name]));
        rows = rows.map((r) => ({ ...r, creator_name: nameById.get(r.creator_id) || null }));
      }
    } else {
      rows = data || [];
    }

    const toNum = (v) => (v == null ? 0 : Number(v));

    const entries = rows
      .map((r) => ({
        creator_id: r.creator_id,
        creator_name: r.creator_name || 'Unknown creator',
        ledger_balance: toNum(r.ledger_balance),
        table_balance: toNum(r.table_balance),
        drift: toNum(r.drift),
      }))
      .sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));

    const drifted = entries.filter((e) => Math.abs(e.drift) > 0.005);

    return sendOk(res, {
      entries,
      drifted,
      summary: {
        creators: entries.length,
        creatorsWithDrift: drifted.length,
        totalLedger: Number(entries.reduce((s, e) => s + e.ledger_balance, 0).toFixed(2)),
        totalTable: Number(entries.reduce((s, e) => s + e.table_balance, 0).toFixed(2)),
        totalDrift: Number(entries.reduce((s, e) => s + e.drift, 0).toFixed(2)),
        // Floating point on money is why this compares against a half-cent
        // rather than against zero.
        balanced: drifted.length === 0,
      },
      source: usedFallback ? 'payout_ledger_reconcile' : 'payout_reconciliation_report',
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[payouts/reconcile] Error:', err.message);
    return Errors.internal(res, err.message);
  }
};
