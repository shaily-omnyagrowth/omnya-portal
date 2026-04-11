const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  const { code, state, error } = req.query;
  
  if (error || !code) {
    return res.redirect(302, '/dashboard?error=' + encodeURIComponent(error || 'No code provided'));
  }

  let userId, platformType;
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64').toString('ascii'));
    userId = decoded.userId;
    platformType = decoded.type || 'meta';
  } catch (err) {
    return res.status(400).send('Invalid state payload');
  }

  const appId = process.env.INSTAGRAM_APP_ID;
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  const redirectUri = 'https://www.portalomnyagrowth.com/api/auth/meta/callback';
  
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: creator } = await supabase.from('creators').select('id').eq('user_id', userId).single();
    if (!creator) throw new Error('Creator profile not found');

    if (platformType === 'instagram') {
      // INSTAGRAM BASIC DISPLAY AUTH FLOW
      const form = new URLSearchParams();
      form.append('client_id', appId);
      form.append('client_secret', appSecret);
      form.append('grant_type', 'authorization_code');
      form.append('redirect_uri', redirectUri);
      form.append('code', code);

      const igTokenRes = await fetch('https://api.instagram.com/oauth/access_token', {
        method: 'POST',
        body: form
      });
      
      if (!igTokenRes.ok) throw new Error('Instagram token exchange failed');
      const igData = await igTokenRes.json();
      
      // Get Long-Lived Token (optional, but good practice)
      const longRes = await fetch(`https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${appSecret}&access_token=${igData.access_token}`);
      const longData = longRes.ok ? await longRes.json() : igData;
      const finalToken = longData.access_token || igData.access_token;
      
      // Get User Info
      const userRes = await fetch(`https://graph.instagram.com/me?fields=id,username&access_token=${finalToken}`);
      const userInfo = userRes.ok ? await userRes.json() : { id: igData.user_id, username: 'Instagram User' };

      await supabase.from('creator_tokens').upsert({
        creator_id: creator.id,
        platform: 'instagram',
        access_token: finalToken,
        account_id: userInfo.id,
        account_name: userInfo.username,
        scopes: 'user_profile,user_media',
        expires_at: new Date(Date.now() + (60 * 24 * 60 * 60 * 1000)).toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'creator_id, platform' });

    } else {
      // FACEBOOK GRAPH AUTH FLOW (Includes Facebook Pages and insights if needed)
      // 1. Exchange code for Short-Lived User Access Token
      const shortTokenRes = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`);
      if (!shortTokenRes.ok) throw new Error('Short-lived token exchange failed');
      const shortTokenData = await shortTokenRes.json();
      const shortAccessToken = shortTokenData.access_token;

      // 2. Exchange for Long-Lived User Access Token (~60 days)
      const longTokenRes = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortAccessToken}`);
      if (!longTokenRes.ok) throw new Error('Long-lived token exchange failed');
      const longTokenData = await longTokenRes.json();
      const longAccessToken = longTokenData.access_token;

      // 3. Find associated Facebook Pages
      const pagesRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${longAccessToken}`);
      if (!pagesRes.ok) throw new Error('Failed to fetch Facebook pages');
      const pagesData = await pagesRes.json();
      
      let fbPageId = null;
      let fbPageName = null;

      if (pagesData.data && pagesData.data.length > 0) {
        fbPageId = pagesData.data[0].id; // taking primary page
        fbPageName = pagesData.data[0].name;
      }

      const expiresAt = longTokenData.expires_in ? new Date(Date.now() + (longTokenData.expires_in * 1000)).toISOString() : new Date(Date.now() + (60 * 24 * 60 * 60 * 1000)).toISOString();
      
      await supabase.from('creator_tokens').upsert({
        creator_id: creator.id,
        platform: 'facebook',
        access_token: longAccessToken,
        account_id: fbPageId || 'unknown',
        account_name: fbPageName || 'Facebook User',
        scopes: 'pages_show_list,pages_read_engagement',
        expires_at: expiresAt,
        updated_at: new Date().toISOString()
      }, { onConflict: 'creator_id, platform' });
    }
    
    res.redirect(302, `/dashboard?success=${platformType}_connected`);
  } catch (err) {
    console.error('Callback Error:', err);
    res.redirect(302, '/dashboard?error=auth_failed');
  }
};
