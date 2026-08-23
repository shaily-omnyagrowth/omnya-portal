// api/payments/void.js
//
// POST /api/payments/void
// Body: { paymentId, reason }
//
// Replaces the hard DELETE that used to sit behind the ✕ button on the
// Payment Management screen.
//
// §9.5 is unambiguous: "No hard deletion of financial records." The old
// control called supabase.from('payments').delete() straight from the browser,
// with no confirmation, no audit entry and no check on the result — so a
// payment could disappear and leave nothing behind that said it had ever
// existed, let alone who removed it.
//
// Voiding keeps the row. status moves to 'cancelled' (already an accepted
// value in payments_status_payout_check) and the reason, actor and timestamp
// are recorded. trg_audit_payment_void writes the audit entry.
//
// A paid payment is never voided: money has already moved, so the correction
// is a reversing entry against the ledger, not a status flip that would make
// the record disagree with reality.
//
// Auth: owner, or a payment manager with can_mark_paid — the same permission
// that lets someone say money moved is the one that lets them say it should
// not have.

const { applyCors } = require('../_utils/cors');
const { Errors, sendOk } = require('../_utils/errors');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const { applyRateLimit } = require('../_utils/rateLimit');
const { requirePaymentPermission, logPaymentAction } = require('../_lib/paymentPermissions');

// Statuses that mean the money is gone or in flight. Voiding these would make
// the portal disagree with the bank.
const UNVOIDABLE = ['paid', 'processing'];

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  const blocked = await applyRateLimit(req, res, {
    max: 20,
    windowSecs: 60,
    endpoint: 'payments-void',
  });
  if (blocked) return;

  const authCtx = await requirePaymentPermission(req, res, 'mark_paid');
  if (!authCtx) return;

  const { user } = authCtx;
  const supabase = getSupabaseAdminClient();

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body || {};

  const paymentId = typeof body.paymentId === 'string' ? body.paymentId.trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

  if (!paymentId) {
    return Errors.badRequest(res, 'paymentId is required');
  }
  if (!reason) {
    return Errors.badRequest(
      res,
      'A reason is required. It is the only explanation the audit trail will carry.'
    );
  }

  try {
    const { data: payment, error: fetchErr } = await supabase
      .from('payments')
      .select('id, creator_id, status, amount, amount_owed, voided_at, batch_id, stripe_transfer_id')
      .eq('id', paymentId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!payment) return Errors.notFound(res, 'Payment not found');

    if (payment.voided_at) {
      return sendOk(res, {
        success: true,
        unchanged: true,
        message: 'That payment was already voided.',
      });
    }

    const status = (payment.status || '').toLowerCase();

    if (UNVOIDABLE.includes(status)) {
      return Errors.badRequest(
        res,
        `This payment is ${status}, so the money has already moved. Reverse it with a ` +
        'ledger entry instead of voiding the record.'
      );
    }

    if (payment.stripe_transfer_id) {
      return Errors.badRequest(
        res,
        'A Stripe transfer exists for this payment. Reverse it in Stripe first; ' +
        'voiding here would leave the two records disagreeing.'
      );
    }

    // voided_by is what trg_audit_payment_void reads for the actor, because
    // auth.uid() is NULL on a service-role connection.
    const { data: updated, error: updateErr } = await supabase
      .from('payments')
      .update({
        status: 'cancelled',
        voided_at: new Date().toISOString(),
        voided_by: user.id,
        void_reason: reason,
      })
      .eq('id', paymentId)
      // Guard against a second void landing between the read above and this
      // write. A `NOT IN ('paid','processing')` filter is deliberately not
      // added alongside it: status is nullable, and NOT IN over NULL matches
      // nothing, so it would reject a perfectly valid void as a phantom race.
      .is('voided_at', null)
      .select('id, status')
      .maybeSingle();

    if (updateErr) throw updateErr;
    if (!updated) {
      return Errors.badRequest(
        res,
        'The payment changed while this request was in flight and was not voided. Reload and try again.'
      );
    }

    // Belt and braces: the DB trigger writes admin_audit_logs, this writes the
    // money-path journal, so the void appears in both histories.
    await logPaymentAction(
      supabase, user.id, 'payment_voided', 'payment', paymentId,
      { reason, previous_status: payment.status,
        amount: payment.amount ?? payment.amount_owed }
    );

    return sendOk(res, {
      success: true,
      paymentId,
      previousStatus: payment.status,
      message: 'Payment voided. The record is kept and the reason is on the audit trail.',
    });
  } catch (err) {
    console.error('[payments/void] Error:', err.message);
    return Errors.internal(res, err.message);
  }
};
