const { applyCors } = require('../_utils/cors');
const { requireRole } = require('../_utils/auth');
const { Errors, sendOk } = require('../_utils/errors');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const { applyRateLimit } = require('../_utils/rateLimit');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  // Rate limit: 10 grants per hour.
  const blocked = await applyRateLimit(req, res, {
    max: 10,
    windowSecs: 3600,
    endpoint: 'payment-managers-grant',
  });
  if (blocked) return;

  const authCtx = await requireRole(req, res, ['owner']);
  if (!authCtx) return;

  const supabase = getSupabaseAdminClient();

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) {}
    }

    const {
      userId,
      can_view_payouts,
      can_approve_withdrawals,
      can_export_batches,
      can_mark_paid,
    } = body || {};

    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      return Errors.badRequest(res, 'userId is required and must be a non-empty string');
    }

    // Verify the target user exists in user_profiles.
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('id', userId.trim())
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile) {
      return Errors.notFound(res, `No user profile found for userId: ${userId}`);
    }

    // UPSERT the payment_managers row.
    const { data: upserted, error: upsertError } = await supabase
      .from('payment_managers')
      .upsert(
        {
          user_id: userId.trim(),
          can_view_payouts: can_view_payouts ?? false,
          can_approve_withdrawals: can_approve_withdrawals ?? false,
          can_export_batches: can_export_batches ?? false,
          can_mark_paid: can_mark_paid ?? false,
          active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )
      .select()
      .single();

    if (upsertError) throw upsertError;

    // Audit log.
    const { error: auditError } = await supabase
      .from('payment_audit_logs')
      .insert({
        action: 'payment_manager_granted',
        performed_by: authCtx.user.id,
        target_user_id: userId.trim(),
        details: {
          can_view_payouts: upserted.can_view_payouts,
          can_approve_withdrawals: upserted.can_approve_withdrawals,
          can_export_batches: upserted.can_export_batches,
          can_mark_paid: upserted.can_mark_paid,
        },
      });

    if (auditError) {
      // Non-fatal: log but do not fail the request.
      console.error('Payment Managers Grant — audit log error:', auditError.message);
    }

    return sendOk(res, upserted);
  } catch (err) {
    console.error('Payment Managers Grant Error:', err.message);
    return Errors.internal(res, err.message);
  }
};
