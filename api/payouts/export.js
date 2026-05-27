const { applyCors } = require('../_utils/cors');
const { requireRole } = require('../_utils/auth');
const { Errors } = require('../_utils/errors');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') return Errors.methodNotAllowed(res);

  const authCtx = await requireRole(req, res, ['owner', 'am', 'account_manager']);
  if (!authCtx) return;

  const { batchId } = req.query;
  if (!batchId) return res.status(400).send('Missing batchId Parameter');

  const supabase = getSupabaseAdminClient();

  try {
    const { data: payments } = await supabase.from('payments')
      .select('amount_owed, status, creators(name, payout_email, payout_preference)')
      .eq('batch_id', batchId);

    if (!payments) return res.status(404).send('Batch not found');

    const csvRows = ['Creator Name,Payout Email,Preference,Amount Owed,Status'];
    payments.forEach(p => {
      const creator = p.creators || {};
      csvRows.push(`"${creator.name}","${creator.payout_email || ''}","${creator.payout_preference || 'paypal'}","$${p.amount_owed}","${p.status}"`);
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="payout_batch_${batchId}.csv"`);
    res.status(200).send(csvRows.join('\n'));
  } catch (err) {
    console.error('Export Error:', err);
    res.status(500).send('Export computation failed');
  }
};

