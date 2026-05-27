// api/auth/instagram/callback.js
//
// GET /api/auth/instagram/callback?code=...&state=...
//
// Handles the Instagram Business OAuth callback (instagram.com/oauth/authorize).
// Token exchange goes through api.instagram.com (not graph.facebook.com).
//
// Steps:
//   1. Validate state via oauth_states.
//   2. Exchange code → short-lived token (api.instagram.com/oauth/access_token).
//   3. Upgrade → long-lived token (graph.instagram.com/access_token, ~60d).
//   4. Fetch /me for platform_user_id / platform_username.
//   5. Upsert creator_tokens with platform='instagram'.

const { getSupabaseAdminClient } = require('../../_utils/supabaseAdmin');
const { consumeOAuthState } = require('../../_utils/oauth');

function redirectBack(res, params) {
  const base = process.env.APP_BASE_URL || 'https://www.portalomnyagrowth.com';
  const qs = new URLSearchParams({ page: 'social-connections', ...params }).toString();
  res.redirect(302, `${base}/?${qs}`);
}

module.exports = async (req, res) => {
  const { code, state, error: providerError, error_description } = req.query || {};

  if (providerError) {
    console.warn('[instagram/callback] provider error:', providerError, error_description);
    return redirectBack(res, { error: 'instagram_auth_denied' });
  }
  if (!code || !state) {
    return redirectBack(res, { error: 'instagram_missing_params' });
  }

  const stateRow = await consumeOAuthState({ platform: 'instagram', state });
  if (!stateRow) {
    console.warn('[instagram/callback] invalid or expired state');
    return redirectBack(res, { error: 'instagram_invalid_state' });
  }

  const appId = process.env.INSTAGRAM_APP_ID || process.env.META_APP_ID || process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.INSTAGRAM_APP_SECRET || process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET;
  const redirectUri =
    process.env.INSTAGRAM_REDIRECT_URI ||
    `${process.env.APP_BASE_URL || 'https://www.portalomnyagrowth.com'}/api/auth/instagram/callback`;

  if (!appId || !appSecret) {
    console.error('[instagram/callback] env vars not set');
    return redirectBack(res, { error: 'instagram_misconfigured' });
  }

  try {
    // Step 1: exchange code for short-lived token.
    const exchangeResp = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code,
      }),
    });
    const exchangeData = await exchangeResp.json().catch(() => ({}));

    if (!exchangeResp.ok || !exchangeData.access_token) {
      console.error('[instagram/callback] token exchange failed:', exchangeResp.status, exchangeData);
      return redirectBack(res, { error: 'instagram_token_exchange_failed' });
    }

    // Step 2: upgrade to long-lived token (~60 days). No client_id needed.
    const longParams = new URLSearchParams({
      grant_type: 'ig_exchange_token',
      client_secret: appSecret,
      access_token: exchangeData.access_token,
    });
    const longResp = await fetch(`https://graph.instagram.com/access_token?${longParams.toString()}`);
    const longData = await longResp.json().catch(() => ({}));
    const accessToken = (longResp.ok && longData.access_token) ? longData.access_token : exchangeData.access_token;
    const expiresAt = longData.expires_in
      ? new Date(Date.now() + longData.expires_in * 1000).toISOString()
      : null;

    // Step 3: fetch Instagram profile.
    let platformUserId = exchangeData.user_id ? String(exchangeData.user_id) : null;
    let platformUsername = null;
    try {
      const profileResp = await fetch(
        `https://graph.instagram.com/me?fields=id,username&access_token=${encodeURIComponent(accessToken)}`
      );
      const profileData = await profileResp.json().catch(() => ({}));
      if (profileResp.ok) {
        platformUserId = platformUserId || profileData.id || null;
        platformUsername = profileData.username || null;
      }
    } catch { /* non-fatal */ }

    // Step 4: persist.
    const supabase = getSupabaseAdminClient();
    const { error: upsertErr } = await supabase
      .from('creator_tokens')
      .upsert(
        {
          user_id: stateRow.user_id,
          platform: 'instagram',
          access_token: accessToken,
          refresh_token: null,
          token_type: 'bearer',
          scope: 'instagram_business_basic,instagram_business_manage_insights',
          expires_at: expiresAt,
          status: 'connected',
          last_error: null,
          platform_user_id: platformUserId,
          platform_username: platformUsername,
          metadata: {
            provider: 'instagram',
            long_lived: !!(longResp.ok && longData.access_token),
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,platform' }
      );

    if (upsertErr) {
      console.error('[instagram/callback] upsert failed:', upsertErr.message);
      return redirectBack(res, { error: 'instagram_storage_failed' });
    }

    return redirectBack(res, { connected: 'instagram' });
  } catch (err) {
    console.error('[instagram/callback] unexpected error:', err && err.message);
    return redirectBack(res, { error: 'instagram_server_error' });
  }
};
