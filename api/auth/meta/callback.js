const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  const { code, state, error } = req.query;
  
  if (error || !code) {
    return res.redirect(302, '/dashboard?error=' + encodeURIComponent(error || 'No code provided'));
  }

  let userId;
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64').toString('ascii'));
    userId = decoded.userId;
  } catch (err) {
    return res.status(400).send('Invalid state payload');
  }

  const clientId = process.env.META_CLIENT_ID;
  const clientSecret = process.env.META_CLIENT_SECRET;
  const redirectUri = 'https://www.portalomnyagrowth.com/api/auth/meta/callback';
  
  try {
    // Exchange code for token
    const tokenRes = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${clientSecret}&code=${code}`);
    
    if (!tokenRes.ok) throw new Error('Token exchange failed');
    const tokenData = await tokenRes.json();
    
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    
    // Connect user and insert tokens
    const { data: creator } = await supabase.from('creators').select('id').eq('user_id', userId).single();
    if (!creator) throw new Error('Creator profile not found');
    
    const expiresAt = tokenData.expires_in ? new Date(Date.now() + (tokenData.expires_in * 1000)).toISOString() : null;
    
    await supabase.from('creator_tokens').upsert({
      creator_id: creator.id,
      platform: 'instagram', // Treat Meta auth as standard IG
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || null,
      scopes: 'instagram_basic,instagram_manage_insights',
      expires_at: expiresAt,
      updated_at: new Date().toISOString()
    }, { onConflict: 'creator_id, platform' });
    
    res.redirect(302, '/dashboard?success=meta_connected');
  } catch (err) {
    console.error('Meta Callback Error:', err);
    res.redirect(302, '/dashboard?error=auth_failed');
  }
};
