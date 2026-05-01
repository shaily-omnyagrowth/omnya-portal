const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.REACT_APP_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

module.exports = async (req, res) => {
  const { code, state, error } = req.query;
  
  if (error) {
    return res.redirect(302, '/?page=social-connections&error=youtube_auth_denied');
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
    const params = new URLSearchParams();
    params.append('client_id', process.env.YOUTUBE_CLIENT_ID);
    params.append('client_secret', process.env.YOUTUBE_CLIENT_SECRET);
    params.append('code', code);
    params.append('grant_type', 'authorization_code');
    params.append('redirect_uri', 'https://www.portalomnyagrowth.com/api/auth/youtube/callback');

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });
    
    const tokenData = await tokenResponse.json();
    
    if (tokenData.error || !tokenData.access_token) {
       console.error("YouTube OAuth Error:", tokenData);
       return res.redirect(302, '/?page=social-connections&error=youtube_auth_failed');
    }

    // Upsert token in Supabase
    await supabase.from('creator_tokens').upsert({
      user_id: userId,
      platform: 'youtube',
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token, // might be undefined if not first time
      expires_at: new Date(Date.now() + tokenData.expires_in * 1000),
      updated_at: new Date()
    }, { onConflict: 'user_id, platform' });

    res.redirect(302, '/?page=social-connections&success=youtube');
  } catch (error) {
    console.error("YouTube Callback Error:", error);
    res.redirect(302, '/?page=social-connections&error=server_error');
  }
};
