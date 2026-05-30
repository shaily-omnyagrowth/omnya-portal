// api/withdrawals/approve.js — Vercel serverless function
//
// POST /api/withdrawals/approve
//
// Approves a pending withdrawal request by calling the approve_withdrawal_request
// Supabase RPC, then notifies the creator via email.
//
// Auth: owner (unconditional) OR payment manager with can_approve_withdrawals = true
// Rate limit: 20 requests per minute per caller IP

const { applyCors } = require('../_utils/cors');
const { Errors, sendOk } = require('../_utils/errors');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const { applyRateLimit } = require('../_utils/rateLimit');
const { requirePaymentPermission, logPaymentAction } = require('../_lib/paymentPermissions');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  // Rate limit: 20 approvals per minute per IP.
  const blocked = await applyRateLimit(req, res, {
    max: 20,
    windowSecs: 60,
    endpoint: 'withdrawals-approve',
  });
  if (blocked) return;

  // Auth: owner or payment manager with approve_withdrawals permission.
  const authCtx = await requirePaymentPermission(req, res, 'approve_withdrawals');
  if (!authCtx) return;

  const { user } = authCtx;

  const supabase = getSupabaseAdminClient();

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) {}
    }

    const { withdrawalRequestId } = body || {};

    if (!withdrawalRequestId) {
      return Errors.badRequest(res, 'Missing required field: withdrawalRequestId');
    }

    // Call the Supabase RPC to approve the withdrawal request.
    const { data: rpcData, error: rpcError } = await supabase.rpc('approve_withdrawal_request', {
      p_request_id: withdrawalRequestId,
      p_approved_by: user.id,
    });

    if (rpcError) {
      console.error('[withdrawals/approve] RPC error:', rpcError.message);
      return Errors.internal(res, rpcError.message);
    }

    const paymentId = rpcData?.payment_id ?? rpcData ?? null;

    // Write an audit log entry for traceability.
    await logPaymentAction(
      supabase,
      user.id,
      'approve_withdrawal',
      'withdrawal_request',
      withdrawalRequestId,
      { payment_id: paymentId }
    );

    // Fetch creator info to send the notification email.
    // withdrawal_requests is expected to have a creator_id FK into user_profiles.
    const { data: withdrawalRow, error: wrError } = await supabase
      .from('withdrawal_requests')
      .select('creator_id, amount')
      .eq('id', withdrawalRequestId)
      .single();

    if (wrError || !withdrawalRow) {
      // Non-fatal: approval succeeded; just skip the email.
      console.warn('[withdrawals/approve] Could not fetch withdrawal row for email notification:', wrError?.message);
      return sendOk(res, { success: true, paymentId });
    }

    const { data: creatorProfile, error: cpError } = await supabase
      .from('user_profiles')
      .select('email, display_name')
      .eq('id', withdrawalRow.creator_id)
      .single();

    if (cpError || !creatorProfile?.email) {
      console.warn('[withdrawals/approve] Could not fetch creator profile for email notification:', cpError?.message);
      return sendOk(res, { success: true, paymentId });
    }

    // Send withdrawal_approved email via /api/send-email.
    // Fire-and-forget: email failure must not roll back a successful approval.
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000');

    fetch(`${baseUrl}/api/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        type: 'withdrawal_approved',
        data: {
          creatorEmail: creatorProfile.email,
          creatorName: creatorProfile.display_name || creatorProfile.email,
          amount: withdrawalRow.amount,
          paymentId,
        },
      }),
    }).catch((err) => {
      console.error('[withdrawals/approve] Email notification failed (non-fatal):', err.message);
    });

    return sendOk(res, { success: true, paymentId });
  } catch (err) {
    console.error('[withdrawals/approve] Unexpected error:', err);
    return Errors.internal(res, err.message);
  }
};
