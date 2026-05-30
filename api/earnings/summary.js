const { applyCors } = require('../_utils/cors');
const { requireRole } = require('../_utils/auth');
const { Errors, sendOk } = require('../_utils/errors');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const { applyRateLimit } = require('../_utils/rateLimit');
const {
  canRequestWithdrawal,
  getNextWithdrawalDate,
} = require('../_lib/paymentCalculations');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') return Errors.methodNotAllowed(res);

  const blocked = await applyRateLimit(req, res, {
    max: 30,
    windowSecs: 60,
    endpoint: 'earnings-summary',
  });
  if (blocked) return;

  const authCtx = await requireRole(req, res, [
    'owner',
    'am',
    'account_manager',
    'creator',
    'payment_manager',
  ]);
  if (!authCtx) return;

  const { user, profile } = authCtx;
  const role = profile.role; // already normalized by requireRole
  const supabase = getSupabaseAdminClient();

  try {
    let creatorId;

    if (role === 'creator') {
      // Resolve the creator row that belongs to this user.
      const { data: creatorRow, error: creatorErr } = await supabase
        .from('creators')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (creatorErr) throw creatorErr;
      if (!creatorRow) return Errors.notFound(res, 'Creator profile not found for this user');

      creatorId = creatorRow.id;
    } else if (role === 'am') {
      // AM must supply a creatorId and must be assigned to that creator.
      const paramId = req.query && req.query.creatorId;
      if (!paramId) return Errors.badRequest(res, 'creatorId query param is required for AM role');

      const { data: assignment, error: assignErr } = await supabase
        .from('creators')
        .select('id')
        .eq('id', paramId)
        .eq('account_manager_id', user.id)
        .maybeSingle();

      if (assignErr) throw assignErr;
      if (!assignment) {
        return Errors.forbidden(res, 'Creator is not assigned to this account manager');
      }

      creatorId = assignment.id;
    } else {
      // owner or payment_manager — accept any creatorId.
      const paramId = req.query && req.query.creatorId;
      if (!paramId) return Errors.badRequest(res, 'creatorId query param is required');

      creatorId = paramId;
    }

    // Fetch all earnings rows for this creator.
    const { data: earnings, error: earningsErr } = await supabase
      .from('creator_earnings')
      .select('*')
      .eq('creator_id', creatorId)
      .order('created_at', { ascending: false });

    if (earningsErr) throw earningsErr;

    const earningsRows = earnings || [];

    // Calculate balance totals by status.
    const pendingStatuses = new Set(['pending', 'eligible', 'needs_review']);

    let availableBalance = 0;
    let pendingBalance = 0;
    let withdrawalRequestedBalance = 0;
    let paidBalance = 0;

    for (const row of earningsRows) {
      const amount = parseFloat(row.amount) || 0;
      const status = row.status;

      if (status === 'approved') {
        availableBalance += amount;
      } else if (pendingStatuses.has(status)) {
        pendingBalance += amount;
      } else if (status === 'withdrawal_requested') {
        withdrawalRequestedBalance += amount;
      } else if (status === 'paid') {
        paidBalance += amount;
      }
    }

    // Fetch the most recent active withdrawal request (not rejected or cancelled).
    const { data: lastRequest, error: requestErr } = await supabase
      .from('withdrawal_requests')
      .select('created_at, status')
      .eq('creator_id', creatorId)
      .not('status', 'in', '("rejected","cancelled")')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (requestErr) throw requestErr;

    const lastRequestDate = lastRequest ? lastRequest.created_at : null;

    const canWithdraw = canRequestWithdrawal(lastRequestDate);
    const nextWithdrawalDate = getNextWithdrawalDate(lastRequestDate);

    return sendOk(res, {
      availableBalance,
      pendingBalance,
      withdrawalRequestedBalance,
      paidBalance,
      canRequestWithdrawal: canWithdraw,
      nextWithdrawalDate: nextWithdrawalDate ? nextWithdrawalDate.toISOString() : null,
      earnings: earningsRows,
    });
  } catch (err) {
    console.error('Earnings Summary Error:', err.message);
    return Errors.internal(res, err.message);
  }
};
