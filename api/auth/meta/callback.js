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

  const appId = process.env.INSTAGRAM_APP_ID;
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  const redirectUri = 'https://www.portalomnyagrowth.com/api/auth/meta/callback';
  
  try {
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

    // 3. Find associated Instagram Business/Creator Account
    // First get the Facebook Pages managed by the user
    const pagesRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${longAccessToken}`);
    if (!pagesRes.ok) throw new Error('Failed to fetch Facebook pages');
    const pagesData = await pagesRes.json();

    let igAccountId = null;
    let igUsername = null;

    // Iterate through pages to find the one with a connected Instagram account
    for (const page of (pagesData.data || [])) {
      const igRes = await fetch(`https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account&access_token=${longAccessToken}`);
      if (igRes.ok) {
        const igData = await igRes.json();
        if (igData.instagram_business_account) {
          igAccountId = igData.instagram_business_account.id;
          
          // Get IG Username
          const igInfoRes = await fetch(`https://graph.facebook.com/v19.0/${igAccountId}?fields=username&access_token=${longAccessToken}`);
          if (igInfoRes.ok) {
            const igInfo = await igInfoRes.json();
            igUsername = igInfo.username;
          }
          break; // Found one!
        }
      }
    }

    if (!igAccountId) {
      return res.redirect(302, '/dashboard?error=' + encodeURIComponent('No Instagram Business account found connected to your Facebook pages. Please ensure your Instagram is professional and linked to a Facebook Page.'));
    }

    // 4. Store in Supabase
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: creator } = await supabase.from('creators').select('id').eq('user_id', userId).single();
    if (!creator) throw new Error('Creator profile not found');
    
    // Long-lived tokens from Meta usually have 60 days expiry, or no expiry if offline_access was granted (rare now)
    const expiresAt = longTokenData.expires_in ? new Date(Date.now() + (longTokenData.expires_in * 1000)).toISOString() : new Date(Date.now() + (60 * 24 * 60 * 60 * 1000)).toISOString();
    
    await supabase.from('creator_tokens').upsert({
      creator_id: creator.id,
      platform: 'meta',
      access_token: longAccessToken,
      account_id: igAccountId,
      account_name: igUsername,
      scopes: 'instagram_basic,instagram_manage_insights,pages_show_list,pages_read_engagement',
      expires_at: expiresAt,
      updated_at: new Date().toISOString()
    }, { onConflict: 'creator_id, platform' });
    
    res.redirect(302, '/dashboard?success=instagram_connected');
  } catch (err) {
    console.error('Meta Callback Error:', err);
    res.redirect(302, '/dashboard?error=auth_failed');
  }
};
