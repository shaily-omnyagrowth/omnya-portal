const { applyCors } = require('../_utils/cors');
const { requireRole } = require('../_utils/auth');
const { Errors, sendOk } = require('../_utils/errors');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const { applyRateLimit } = require('../_utils/rateLimit');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  // Rate limit: 10 revocations per hour.
  const blocked = await applyRateLimit(req, res, {
    max: 10,
    windowSecs: 3600,
    endpoint: 'payment-managers-revoke',
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

    const { userId } = body || {};

    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      return Errors.badRequest(res, 'userId is required and must be a non-empty string');
    }

    // Soft-deactivate the payment manager record.
    const { data: updated, error: updateError } = await supabase
      .from('payment_managers')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('user_id', userId.trim())
      .select('user_id, active, updated_at')
      .maybeSingle();

    if (updateError) throw updateError;

    if (!updated) {
      return Errors.notFound(res, `No payment manager record found for userId: ${userId}`);
    }

    // Audit log.
    const { error: auditError } = await supabase
      .from('payment_audit_logs')
      .insert({
        action: 'payment_manager_revoked',
        performed_by: authCtx.user.id,
        target_user_id: userId.trim(),
        details: {},
      });

    if (auditError) {
      // Non-fatal: log but do not fail the request.
      console.error('Payment Managers Revoke — audit log error:', auditError.message);
    }

    return sendOk(res, { success: true });
  } catch (err) {
    console.error('Payment Managers Revoke Error:', err.message);
    return Errors.internal(res, err.message);
  }
};
