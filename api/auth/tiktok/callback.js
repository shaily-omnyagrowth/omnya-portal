const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  const { code, state, error } = req.query;
  
  if (error === 'access_denied') {
    return res.redirect(302, '/dashboard?error=access_denied');
  } else if (error || !code) {
    return res.redirect(302, '/dashboard?error=' + encodeURIComponent(error || 'No code provided'));
  }

  let userId;
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64').toString('ascii'));
    userId = decoded.userId;
  } catch (err) {
    return res.status(400).send('Invalid state payload');
  }

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  
  try {
    // Exchange code for token
    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: 'https://www.portalomnyagrowth.com/api/auth/tiktok/callback'
      })
    });
    
    if (!tokenRes.ok) throw new Error('Token exchange failed');
    const tokenData = await tokenRes.json();
    
    // Store in Supabase securely (bypass RLS)
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    
    const { data: creator } = await supabase.from('creators').select('id').eq('user_id', userId).single();
    if (!creator) throw new Error('Creator profile not found');
    
    const expiresAt = new Date(Date.now() + (tokenData.expires_in * 1000)).toISOString();
    
    await supabase.from('creator_tokens').upsert({
      creator_id: creator.id,
      platform: 'tiktok',
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      scopes: tokenData.scope,
      expires_at: expiresAt,
      updated_at: new Date().toISOString()
    }, { onConflict: 'creator_id, platform' });
    
    res.redirect(302, '/dashboard?success=tiktok_connected');
  } catch (err) {
    console.error('TikTok Callback Error:', err);
    res.redirect(302, '/dashboard?error=auth_failed');
  }
};
