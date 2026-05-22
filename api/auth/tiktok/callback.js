// api/auth/tiktok/callback.js
//
// GET /api/auth/tiktok/callback?code=...&state=...
//
// 1. Validates state via oauth_states (server-stored, hashed, one-time-use).
// 2. Exchanges code + PKCE verifier for tokens at TikTok.
// 3. Upserts creator_tokens with the canonical schema.
// 4. Redirects to the SPA with success/error query params.

const { getSupabaseAdminClient } = require('../../_utils/supabaseAdmin');
const { consumeOAuthState } = require('../../_utils/oauth');

function redirectBack(res, params) {
  const base = process.env.APP_BASE_URL || 'https://www.portalomnyagrowth.com';
  const qs = new URLSearchParams({ page: 'social-connections', ...params }).toString();
  res.redirect(302, `${base}/?${qs}`);
}

module.exports = async (req, res) => {
  const { code, state, error: providerError } = req.query || {};

  if (providerError) {
    console.warn('[tiktok/callback] provider returned error:', providerError);
    return redirectBack(res, { error: 'tiktok_auth_denied' });
  }
  if (!code || !state) {
    return redirectBack(res, { error: 'tiktok_missing_params' });
  }

  // Verify state. If null, either expired, already used, or forged.
  const stateRow = await consumeOAuthState({ platform: 'tiktok', state });
  if (!stateRow) {
    console.warn('[tiktok/callback] invalid or expired state');
    return redirectBack(res, { error: 'tiktok_invalid_state' });
  }

  const clientKey = process.env.TIKTOK_CLIENT_KEY || process.env.TIKTOK_APP_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET || process.env.TIKTOK_APP_SECRET;
  const redirectUri =
    process.env.TIKTOK_REDIRECT_URI ||
    `${process.env.APP_BASE_URL || 'https://www.portalomnyagrowth.com'}/api/auth/tiktok/callback`;

  if (!clientKey || !clientSecret) {
    console.error('[tiktok/callback] TIKTOK_CLIENT_KEY/SECRET not set');
    return redirectBack(res, { error: 'tiktok_misconfigured' });
  }

  try {
    const tokenResp = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code_verifier: stateRow.code_verifier || '',
      }),
    });

    const tokenData = await tokenResp.json().catch(() => ({}));

    if (!tokenResp.ok || !tokenData.access_token) {
      console.error(
        '[tiktok/callback] token exchange failed:',
        tokenResp.status,
        tokenData && tokenData.error
      );
      return redirectBack(res, { error: 'tiktok_token_exchange_failed' });
    }

    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      : null;
    const refreshExpiresAt = tokenData.refresh_expires_in
      ? new Date(Date.now() + tokenData.refresh_expires_in * 1000).toISOString()
      : null;

    const supabase = getSupabaseAdminClient();
    const { error: upsertErr } = await supabase
      .from('creator_tokens')
      .upsert(
        {
          user_id: stateRow.user_id,
          platform: 'tiktok',
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token || null,
          token_type: tokenData.token_type || 'bearer',
          scope: tokenData.scope || null,
          expires_at: expiresAt,
          refresh_expires_at: refreshExpiresAt,
          status: 'connected',
          last_error: null,
          platform_user_id: tokenData.open_id || null,
          metadata: { open_id: tokenData.open_id || null },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,platform' }
      );

    if (upsertErr) {
      console.error('[tiktok/callback] upsert failed:', upsertErr.message);
      return redirectBack(res, { error: 'tiktok_storage_failed' });
    }

    return redirectBack(res, { connected: 'tiktok' });
  } catch (err) {
    console.error('[tiktok/callback] unexpected error:', err && err.message);
    return redirectBack(res, { error: 'tiktok_server_error' });
  }
};
