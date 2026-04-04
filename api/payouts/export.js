const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  
  const { batchId } = req.query;
  if (!batchId) return res.status(400).send('Missing batchId Parameter');

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

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
