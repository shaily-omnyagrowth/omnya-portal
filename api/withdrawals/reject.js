// api/withdrawals/reject.js — Vercel serverless function
// Rejects a pending withdrawal request.
//
// Auth: owner OR payment manager with can_approve_withdrawals.
// Rate limit: 20 per minute.
//
// POST body: { withdrawalRequestId: string, reason: string }
//
// On success:
//   1. Calls supabase.rpc('reject_withdrawal_request', { p_request_id, p_rejected_by, p_reason })
//   2. Fetches creator info attached to the request
//   3. Fires withdrawal_rejected transactional email to the creator
//   4. Logs the action to payment_audit_logs
//   Returns: { ok: true, data: { success: true } }

const { applyCors } = require('../_utils/cors');
const { Errors, sendOk } = require('../_utils/errors');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const { applyRateLimit } = require('../_utils/rateLimit');
const { requirePaymentPermission, logPaymentAction } = require('../_lib/paymentPermissions');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  // Rate limit: 20 rejections per minute per IP.
  const blocked = await applyRateLimit(req, res, {
    max: 20,
    windowSecs: 60,
    endpoint: 'withdrawals-reject',
  });
  if (blocked) return;

  // Auth: owner or payment manager with can_approve_withdrawals.
  const authCtx = await requirePaymentPermission(req, res, 'approve_withdrawals');
  if (!authCtx) return;

  const { user } = authCtx;
  const supabase = getSupabaseAdminClient();

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) {}
    }

    const { withdrawalRequestId, reason } = body || {};

    // Validate both fields.
    if (!withdrawalRequestId) {
      return Errors.badRequest(res, 'Missing required field: withdrawalRequestId');
    }
    if (!reason || typeof reason !== 'string' || reason.trim() === '') {
      return Errors.badRequest(res, 'Missing required field: reason (must be a non-empty string)');
    }

    // Call the DB function — handles state transition and guards against double-rejection.
    const { data: rpcData, error: rpcError } = await supabase.rpc('reject_withdrawal_request', {
      p_request_id: withdrawalRequestId,
      p_rejected_by: user.id,
      p_reason: reason.trim(),
    });

    if (rpcError) {
      console.error('[withdrawals/reject] rpc error:', rpcError.message);
      // Surface DB-level business rule violations (e.g. request already processed) as 400.
      if (
        rpcError.code === 'P0001' ||        // raise_exception from the function
        rpcError.message?.includes('not found') ||
        rpcError.message?.includes('already')
      ) {
        return Errors.badRequest(res, rpcError.message);
      }
      return Errors.internal(res, rpcError.message);
    }

    // Audit log — fire-and-forget, never blocks the response.
    logPaymentAction(
      supabase,
      user.id,
      'reject_withdrawal',
      'withdrawal_request',
      withdrawalRequestId,
      { reason: reason.trim() }
    );

    // Fetch creator info to send the rejection email.
    // withdrawal_requests should have a creator_id or user_id column.
    const { data: withdrawalRow, error: fetchError } = await supabase
      .from('withdrawal_requests')
      .select('id, creator_id, amount, method')
      .eq('id', withdrawalRequestId)
      .maybeSingle();

    if (fetchError) {
      console.error('[withdrawals/reject] fetch withdrawal row error:', fetchError.message);
      // Non-fatal: the rejection already succeeded; log and continue to response.
    }

    if (withdrawalRow?.creator_id) {
      const { data: creatorProfile, error: profileError } = await supabase
        .from('user_profiles')
        .select('email, display_name')
        .eq('id', withdrawalRow.creator_id)
        .maybeSingle();

      if (profileError) {
        console.error('[withdrawals/reject] fetch creator profile error:', profileError.message);
      }

      if (creatorProfile?.email) {
        // Fire withdrawal_rejected email — best-effort, non-blocking.
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : (process.env.NEXT_PUBLIC_APP_URL || 'https://www.portalomnyagrowth.com');

        fetch(`${baseUrl}/api/send-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            type: 'withdrawal_rejected',
            data: {
              creatorEmail: creatorProfile.email,
              creatorName: creatorProfile.display_name || creatorProfile.email,
              amount: withdrawalRow.amount,
              method: withdrawalRow.method,
              reason: reason.trim(),
            },
          }),
        }).catch((emailErr) => {
          console.error('[withdrawals/reject] send-email fire-and-forget error:', emailErr.message);
        });
      }
    }

    return sendOk(res, { success: true });
  } catch (err) {
    console.error('[withdrawals/reject] unexpected error:', err);
    return Errors.internal(res, err.message);
  }
};
