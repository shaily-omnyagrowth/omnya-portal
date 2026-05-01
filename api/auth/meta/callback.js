const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.REACT_APP_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

module.exports = async (req, res) => {
  const { code, state } = req.query;
  
  if (!code || !state) return res.status(400).send('Missing code or state');

  let userId;
  try {
    const stateObj = JSON.parse(Buffer.from(state, 'base64').toString('ascii'));
    userId = stateObj.userId;
  } catch (err) {
    return res.status(400).send('Invalid state parameter');
  }
  
  try {
    // Exchange code for token
    const tokenResponse = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?client_id=${process.env.FACEBOOK_APP_ID}&redirect_uri=https://www.portalomnyagrowth.com/api/auth/meta/callback&client_secret=${process.env.FACEBOOK_APP_SECRET}&code=${code}`);
    
    const tokenData = await tokenResponse.json();
    
    if (tokenData.error) {
       console.error("Meta OAuth Error:", tokenData.error);
       return res.redirect(302, '/?page=social-connections&error=meta_auth_failed');
    }

    // Upsert token in Supabase
    await supabase.from('creator_tokens').upsert({
      user_id: userId,
      platform: 'meta',
      access_token: tokenData.access_token,
      updated_at: new Date()
    }, { onConflict: 'user_id, platform' });

    // Redirect back to frontend
    res.redirect(302, '/?page=social-connections&success=meta');
  } catch (error) {
    console.error("Meta Callback Error:", error);
    res.redirect(302, '/?page=social-connections&error=server_error');
  }
};
