const { applyCors } = require('../_utils/cors');
const { Errors, sendOk } = require('../_utils/errors');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const { applyRateLimit } = require('../_utils/rateLimit');
const { requirePaymentPermission } = require('../_lib/paymentPermissions');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  // Rate limit: 5 requests per minute per caller.
  const blocked = await applyRateLimit(req, res, {
    max: 5,
    windowSecs: 60,
    endpoint: 'payouts-create-batch',
  });
  if (blocked) return;

  // Auth: owner or a payment manager with export_batches permission.
  const authCtx = await requirePaymentPermission(req, res, 'export_batches');
  if (!authCtx) return;

  const { user } = authCtx;

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) {}
  }

  const { withdrawalRequestIds, notes } = body || {};

  if (
    !Array.isArray(withdrawalRequestIds) ||
    withdrawalRequestIds.length === 0
  ) {
    return Errors.badRequest(
      res,
      'withdrawalRequestIds must be a non-empty array'
    );
  }

  const supabase = getSupabaseAdminClient();

  try {
    const { data, error } = await supabase.rpc('create_payout_batch', {
      p_withdrawal_request_ids: withdrawalRequestIds,
      p_generated_by: user.id,
      p_notes: notes || null,
    });

    if (error) throw error;

    // The RPC signals domain-level failure in the payload, not as an error.
    // Returning that with a 200 makes callers treat a failure as a success.
    if (data && data.success === false) {
      return Errors.badRequest(
        res,
        data.message || 'Payout batch could not be created',
        { error: data.error || null, invalid_count: data.invalid_count }
      );
    }

    return sendOk(res, data);
  } catch (err) {
    console.error('Payout Create-Batch Error:', err.message);
    return Errors.internal(res, err.message);
  }
};
