// api/payments/record-approval.js
//
// POST /api/payments/record-approval
// Body: { submissionId }
//
// Creates the pending payment for an approved submission, at the campaign's rate. Owner, or the
// account manager of the campaign's client. Safe to call twice: an existing payment is returned.

const { applyCors } = require('../_utils/cors');
const { Errors, sendOk } = require('../_utils/errors');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const { applyRateLimit } = require('../_utils/rateLimit');
const { requireRole } = require('../_utils/auth');

const APPROVED = ['Approved', 'Published/Tracked'];

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  const blocked = await applyRateLimit(req, res, { failClosed: true, max: 60, windowSecs: 60, endpoint: 'payments-record-approval' });
  if (blocked) return;

  const authCtx = await requireRole(req, res, ['owner', 'am']);
  if (!authCtx) return;

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  const submissionId = body && typeof body.submissionId === 'string' ? body.submissionId.trim() : '';
  if (!submissionId) return Errors.badRequest(res, 'submissionId is required');

  try {
    const supabase = getSupabaseAdminClient();
    const { data: sub, error: subErr } = await supabase
      .from('submissions')
      .select('id, creator_id, campaign_id, status, campaigns(id, pay_per_video, clients(am_id, account_managers(user_id)))')
      .eq('id', submissionId)
      .maybeSingle();
    if (subErr) throw subErr;
    if (!sub || !sub.campaigns) return Errors.notFound(res, 'Submission or its campaign not found');
    if (!APPROVED.includes(sub.status)) return Errors.badRequest(res, 'Only an approved submission gets a payment.');

    const managerUserId = sub.campaigns.clients && sub.campaigns.clients.account_managers && sub.campaigns.clients.account_managers.user_id;
    if (authCtx.profile.role === 'am' && managerUserId !== authCtx.user.id) {
      return Errors.forbidden(res, "This campaign belongs to another account manager's client.");
    }

    const { data: existing, error: exErr } = await supabase.from('payments').select('id').eq('submission_id', sub.id).limit(1);
    if (exErr) throw exErr;
    if (existing && existing.length) return sendOk(res, { paymentId: existing[0].id, created: false });

    const { data: created, error: insErr } = await supabase
      .from('payments')
      .insert({
        creator_id: sub.creator_id,
        campaign_id: sub.campaign_id,
        submission_id: sub.id,
        videos_approved: 1,
        amount_owed: Number(sub.campaigns.pay_per_video || 0),
        week_ending: new Date().toISOString().split('T')[0],
        status: 'pending',
        payment_method: 'Venmo',
      })
      .select('id');
    if (insErr) throw insErr;
    return sendOk(res, { paymentId: created[0].id, created: true });
  } catch (err) {
    console.error('[payments/record-approval] failed:', err && err.message);
    return Errors.internal(res, "The payment record wasn't created");
  }
};
