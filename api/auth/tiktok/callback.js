const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.REACT_APP_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

module.exports = async (req, res) => {
  const { code, state, error } = req.query;
  
  if (error) {
    return res.redirect(302, '/?page=social-connections&error=tiktok_auth_denied');
  }
  
  if (!code || !state) return res.status(400).send('Missing code or state');

  let userId;
  try {
    const stateObj = JSON.parse(Buffer.from(state, 'base64').toString('ascii'));
    userId = stateObj.userId;
  } catch (err) {
    return res.status(400).send('Invalid state parameter');
  }
  
  try {
    const clientKey = process.env.TIKTOK_CLIENT_KEY || process.env.TIKTOK_APP_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET || process.env.TIKTOK_APP_SECRET;
    
    console.log(`[TikTok OAuth Callback] Client Key Present: ${!!clientKey}`);
    console.log(`[TikTok OAuth Callback] Client Secret Present: ${!!clientSecret}`);

    // Exchange code for token via TikTok API
    const params = new URLSearchParams();
    params.append('client_key', clientKey);
    params.append('client_secret', clientSecret);
    params.append('code', code);
    params.append('grant_type', 'authorization_code');
    params.append('redirect_uri', 'https://www.portalomnyagrowth.com/api/auth/tiktok/callback');

    const tokenResponse = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });
    
    const tokenData = await tokenResponse.json();
    
    if (tokenData.error || !tokenData.access_token) {
       console.error("TikTok OAuth Error:", tokenData);
       return res.redirect(302, '/?page=social-connections&error=tiktok_auth_failed');
    }

    // Upsert token in Supabase
    await supabase.from('creator_tokens').upsert({
      user_id: userId,
      platform: 'tiktok',
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: new Date(Date.now() + tokenData.expires_in * 1000),
      updated_at: new Date()
    }, { onConflict: 'user_id, platform' });

    // Redirect back to frontend
    res.redirect(302, '/?page=social-connections&success=tiktok');
  } catch (error) {
    console.error("TikTok Callback Error:", error);
    res.redirect(302, '/?page=social-connections&error=server_error');
  }
};
