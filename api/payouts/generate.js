const { createClient } = require('@supabase/supabase-js');

const setCorsHeaders = (req) => ({
  'Access-Control-Allow-Origin': req.headers.origin || '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
});

module.exports = async (req, res) => {
  const corsHeaders = setCorsHeaders(req);
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Missing auth header' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
  if (authError || !user) return res.status(401).json({ error: 'Invalid session' });

  try {
    let body = req.body;
    if (typeof body === 'string') try { body = JSON.parse(body); } catch (_) {}
    const { periodStart, periodEnd, periodType } = body || {};
    
    if (!periodStart || !periodEnd || !periodType) {
      return res.status(400).json({ error: 'Missing period fields' });
    }

    // Role Guard
    const { data: profile } = await supabase.from('user_profiles').select('role').eq('id', user.id).single();
    if (!profile || !['owner', 'am', 'account_manager'].includes(profile.role)) {
      return res.status(403).json({ error: 'Unauthorized to generate payouts' });
    }

    // Idempotency: does exact batch exist?
    const { data: existingBatch } = await supabase.from('payout_batches')
      .select('id, total_amount')
      .eq('period_start', periodStart)
      .eq('period_end', periodEnd)
      .eq('period_type', periodType)
      .single();

    if (existingBatch) {
      return res.status(200).json({ success: true, batchId: existingBatch.id, totalAmount: existingBatch.total_amount, note: 'Existing batch returned' });
    }

    // Create tracking batch
    const { data: newBatch, error: batchError } = await supabase.from('payout_batches').insert({
      period_start: periodStart,
      period_end: periodEnd,
      period_type: periodType,
      status: 'Pending',
      total_amount: 0 
    }).select('id').single();

    if (batchError) throw batchError;

    // Grab all unpaid that fall in period
    const { data: pendingPayments } = await supabase.from('payments')
      .select('*')
      .eq('status', 'Pending')
      .gte('created_at', periodStart)
      .lte('created_at', periodEnd);
      
    if (!pendingPayments || pendingPayments.length === 0) {
       return res.status(200).json({ success: true, batchId: newBatch.id, totalAmount: 0, count: 0 });
    }

    // Update sum and tie batchId efficiently
    let totalAmount = 0;
    const updatePromises = pendingPayments.map(p => {
      totalAmount += parseFloat(p.amount_owed || 0);
      return supabase.from('payments').update({ batch_id: newBatch.id }).eq('id', p.id);
    });

    await Promise.all(updatePromises);
    await supabase.from('payout_batches').update({ total_amount: totalAmount }).eq('id', newBatch.id);

    return res.status(200).json({ success: true, batchId: newBatch.id, totalAmount, count: pendingPayments.length });
  } catch (err) {
    console.error('Payout Generate Error:', err);
    return res.status(500).json({ error: err.message });
  }
};
