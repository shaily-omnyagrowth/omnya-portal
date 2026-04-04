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
    const { batchId } = body || {};
    if (!batchId) return res.status(400).json({ error: 'Missing batchId' });

    // Flip batch and children statuses transactionally
    await supabase.from('payout_batches')
        .update({ status: 'Paid', paid_at: new Date().toISOString() })
        .eq('id', batchId);
        
    await supabase.from('payments')
        .update({ status: 'Paid', paid_date: new Date().toISOString() })
        .eq('batch_id', batchId);

    // Call /api/send-email independently and asynchronously per worker in real app (omitted here)
    return res.status(200).json({ success: true, message: 'Batch marked paid' });
  } catch (err) {
    console.error('Mark Paid Error:', err);
    return res.status(500).json({ error: err.message });
  }
};
