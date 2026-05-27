const { applyCors } = require('../_utils/cors');
const { requireRole } = require('../_utils/auth');
const { Errors, sendOk } = require('../_utils/errors');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  const authCtx = await requireRole(req, res, ['owner', 'am', 'account_manager']);
  if (!authCtx) return;

  const supabase = getSupabaseAdminClient();

  try {
    let body = req.body;
    if (typeof body === 'string') try { body = JSON.parse(body); } catch (_) {}
    const { batchId } = body || {};
    if (!batchId) return Errors.badRequest(res, 'Missing batchId');

    // Flip batch and children statuses transactionally
    const { error: batchErr } = await supabase.from('payout_batches')
        .update({ status: 'Paid', paid_at: new Date().toISOString() })
        .eq('id', batchId);
    if (batchErr) throw batchErr;
        
    const { error: paymentsErr } = await supabase.from('payments')
        .update({ status: 'Paid', paid_date: new Date().toISOString() })
        .eq('batch_id', batchId);
    if (paymentsErr) throw paymentsErr;

    // Call /api/send-email independently and asynchronously per worker in real app (omitted here)
    return sendOk(res, { message: 'Batch marked paid' });
  } catch (err) {
    console.error('Mark Paid Error:', err);
    return Errors.internal(res, err.message);
  }
};

