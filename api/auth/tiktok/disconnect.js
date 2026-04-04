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

  // Use Service Role to bypass strict RLS on the tokens table for deletion
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
  if (authError || !user) return res.status(401).json({ error: 'Invalid session' });

  try {
    let body = req.body;
    if (typeof body === 'string') try { body = JSON.parse(body); } catch (_) {}
    const { platform } = body || {};
    
    // Default to tiktok for this route, but extensible
    const targetPlatform = platform || 'tiktok';

    // 1. Get the creator_id for this logged-in user
    const { data: creator } = await supabase.from('creators').select('id').eq('user_id', user.id).single();
    if (!creator) return res.status(404).json({ error: 'Creator profile not found' });

    // 2. Hard delete the specific token mapping
    const { error: deleteError } = await supabase.from('creator_tokens')
      .delete()
      .eq('creator_id', creator.id)
      .eq('platform', targetPlatform);

    if (deleteError) throw deleteError;

    return res.status(200).json({ success: true, message: 'Platform disconnected successfully' });
  } catch (err) {
    console.error('Disconnect Error:', err);
    return res.status(500).json({ error: err.message });
  }
};
