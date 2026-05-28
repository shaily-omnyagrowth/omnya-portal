const { applyCors } = require('../_utils/cors');
const { requireRole } = require('../_utils/auth');
const { Errors, sendOk } = require('../_utils/errors');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const { applyRateLimit } = require('../_utils/rateLimit');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  // Rate limit: payout generation is an expensive write — 5 per minute per caller.
  const blocked = await applyRateLimit(req, res, {
    max: 5,
    windowSecs: 60,
    endpoint: 'payouts-generate',
  });
  if (blocked) return;

  const authCtx = await requireRole(req, res, ['owner', 'am', 'account_manager']);
  if (!authCtx) return;

  const supabase = getSupabaseAdminClient();

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) {}
    }
    const { periodStart, periodEnd, periodType } = body || {};

    if (!periodStart || !periodEnd || !periodType) {
      return Errors.badRequest(res, 'Missing required fields: periodStart, periodEnd, periodType');
    }

    // Idempotency: return existing batch if it already covers this exact period.
    const { data: existingBatch } = await supabase
      .from('payout_batches')
      .select('id, total_amount')
      .eq('period_start', periodStart)
      .eq('period_end', periodEnd)
      .eq('period_type', periodType)
      .maybeSingle();

    if (existingBatch) {
      return sendOk(res, {
        batchId: existingBatch.id,
        totalAmount: existingBatch.total_amount,
        note: 'Existing batch returned',
      });
    }

    // Create a new tracking batch (total_amount updated below).
    const { data: newBatch, error: batchError } = await supabase
      .from('payout_batches')
      .insert({
        period_start: periodStart,
        period_end: periodEnd,
        period_type: periodType,
        status: 'Pending',
        total_amount: 0,
      })
      .select('id')
      .single();

    if (batchError) throw batchError;

    // Collect all unpaid payments that fall within the period.
    const { data: pendingPayments } = await supabase
      .from('payments')
      .select('id, amount_owed')
      .eq('status', 'Pending')
      .gte('created_at', periodStart)
      .lte('created_at', periodEnd);

    if (!pendingPayments || pendingPayments.length === 0) {
      return sendOk(res, {
        batchId: newBatch.id,
        totalAmount: 0,
        count: 0,
      });
    }

    // Tie payments to the batch and accumulate total.
    let totalAmount = 0;
    const updatePromises = pendingPayments.map((p) => {
      totalAmount += parseFloat(p.amount_owed || 0);
      return supabase.from('payments').update({ batch_id: newBatch.id }).eq('id', p.id);
    });
    await Promise.all(updatePromises);

    await supabase
      .from('payout_batches')
      .update({ total_amount: totalAmount })
      .eq('id', newBatch.id);

    return sendOk(res, {
      batchId: newBatch.id,
      totalAmount,
      count: pendingPayments.length,
    });
  } catch (err) {
    console.error('Payout Generate Error:', err.message);
    return Errors.internal(res, err.message);
  }
};
