// api/earnings/review.js
//
// POST /api/earnings/review
// Body: { earningId, action: 'approve' | 'forfeit', reason? }
//
// Approves or forfeits a bonus waiting for review. Owner only.

const { applyCors } = require('../_utils/cors');
const { Errors, sendOk } = require('../_utils/errors');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const { applyRateLimit } = require('../_utils/rateLimit');
const { requireRole } = require('../_utils/auth');
const { logPaymentAction } = require('../_lib/paymentPermissions');

const REVIEWABLE = ['needs_review', 'eligible'];

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  const blocked = await applyRateLimit(req, res, { failClosed: true, max: 60, windowSecs: 60, endpoint: 'earnings-review' });
  if (blocked) return;

  const authCtx = await requireRole(req, res, ['owner']);
  if (!authCtx) return;

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body || {};

  const earningId = typeof body.earningId === 'string' ? body.earningId.trim() : '';
  const action = body.action;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!earningId) return Errors.badRequest(res, 'earningId is required');
  if (action !== 'approve' && action !== 'forfeit') return Errors.badRequest(res, "action must be 'approve' or 'forfeit'");
  if (action === 'forfeit' && !reason) return Errors.badRequest(res, 'Add a reason so the creator knows why the bonus was forfeited.');

  try {
    const supabase = getSupabaseAdminClient();
    const patch = action === 'approve' ? { status: 'approved' } : { status: 'forfeited', description: reason };
    const { data, error } = await supabase
      .from('creator_earnings')
      .update(patch)
      .eq('id', earningId)
      .in('status', REVIEWABLE)
      .select('id, status, amount, creator_id');
    if (error) throw error;
    if (!data || !data.length) return Errors.badRequest(res, 'That bonus is no longer waiting for review. Refresh to see its current status.');

    await logPaymentAction(supabase, authCtx.user.id, `bonus_${action === 'approve' ? 'approved' : 'forfeited'}`, 'creator_earning', earningId,
      { amount: data[0].amount, creator_id: data[0].creator_id, reason: reason || null });
    return sendOk(res, { earning: data[0] });
  } catch (err) {
    console.error('[earnings/review] failed:', err && err.message);
    return Errors.internal(res, "The bonus wasn't updated");
  }
};
