const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  // Security Note: In a true Vercel architecture, this route should either be triggered internally
  // (via a shared module) or guarded with a strong secret. Assuming authorized call here.
  
  try {
    let body = req.body;
    if (typeof body === 'string') try { body = JSON.parse(body); } catch (_) {}
    const { creatorId, platform } = body || {};
    
    if (!creatorId || platform !== 'tiktok') return res.status(400).json({ error: 'Invalid refresh payload' });

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    
    // 1. Grab old token
    const { data: currentToken } = await supabase.from('creator_tokens').select('*').eq('creator_id', creatorId).eq('platform', platform).single();
    if (!currentToken || !currentToken.refresh_token) return res.status(404).json({ error: 'No refresh token available' });

    // 2. HTTP POST to TikTok
    const refreshRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY,
        client_secret: process.env.TIKTOK_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: currentToken.refresh_token
      })
    });

    if (!refreshRes.ok) {
        // If it fails (e.g. burn token), delete it so user must reconnect.
        await supabase.from('creator_tokens').delete().eq('creator_id', creatorId).eq('platform', platform);
        return res.status(400).json({ error: 'Token burnt or disabled' });
    }
    
    const tokenData = await refreshRes.json();
    const expiresAt = new Date(Date.now() + (tokenData.expires_in * 1000)).toISOString();
    
    // 3. Update DB
    await supabase.from('creator_tokens').update({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: expiresAt,
        updated_at: new Date().toISOString()
    }).eq('creator_id', creatorId).eq('platform', platform);

    return res.status(200).json({ success: true, new_access_token: tokenData.access_token });
  } catch (err) {
    console.error('Refresh Error:', err);
    return res.status(500).json({ error: err.message });
  }
};
