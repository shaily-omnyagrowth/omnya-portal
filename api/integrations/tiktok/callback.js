// api/integrations/tiktok/callback.js
//
// GET /api/integrations/tiktok/callback?code=...&state=...
//
// TikTok redirects here after user grants (or denies) permission.
//
// Flow:
//   1. Validate state via oauth_states (server-stored, hashed, one-time-use, 10-min TTL).
//   2. Exchange authorization code + PKCE verifier for access + refresh tokens.
//   3. Encrypt tokens with AES-256-GCM before storage.
//   4. Fetch TikTok profile (display_name, avatar_url).
//   5. Upsert creator_social_accounts row.
//   6. Redirect browser back to /?page=social-connections&connected=tiktok
//      (or &error=...).
//
// F-13: this used to redirect to page=tiktok-connect. There is no such page —
// src/App.js's nav only knows 'social-connections' (label "Social Channels"),
// so an unknown id fell through to the dashboard and the creator never saw the
// result of the connect they had just completed. The three other callbacks
// (auth/instagram, auth/meta, auth/youtube) already use
// page=social-connections&connected=<platform>; this one now matches them
// exactly, which is what src/CreatorConnections.js's mount effect reads.
//
// Tokens NEVER appear in logs or responses.

const { getSupabaseAdminClient } = require('../../_utils/supabaseAdmin');
const { consumeOAuthState }      = require('../../_utils/oauth');
const { encrypt }                = require('../../_utils/encryption');
const { fetchProfile }           = require('../../_utils/tiktok');

function redirectTo(res, baseUrl, params) {
  const qs = new URLSearchParams({ page: 'social-connections', ...params }).toString();
  return res.redirect(302, `${baseUrl}/?${qs}`);
}

module.exports = async (req, res) => {
  const baseUrl = process.env.APP_BASE_URL || 'https://www.portalomnyagrowth.com';
  const { code, state, error: providerError } = req.query || {};

  // Provider returned an error (e.g. user denied access)
  if (providerError) {
    console.warn('[tiktok/callback] provider error:', providerError);
    return redirectTo(res, baseUrl, { error: 'tiktok_auth_denied' });
  }

  if (!code || !state) {
    return redirectTo(res, baseUrl, { error: 'tiktok_missing_params' });
  }

  // Validate state — expires in 10 min, one-time use, platform-bound
  const stateRow = await consumeOAuthState({ platform: 'tiktok', state });
  if (!stateRow) {
    console.warn('[tiktok/callback] invalid, expired, or replayed state');
    return redirectTo(res, baseUrl, { error: 'tiktok_invalid_state' });
  }

  const clientKey    = process.env.TIKTOK_CLIENT_KEY    || process.env.TIKTOK_APP_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET || process.env.TIKTOK_APP_SECRET;
  const redirectUri  =
    process.env.TIKTOK_REDIRECT_URI ||
    `${baseUrl}/api/integrations/tiktok/callback`;

  if (!clientKey || !clientSecret) {
    console.error('[tiktok/callback] TikTok credentials not configured');
    return redirectTo(res, baseUrl, { error: 'tiktok_misconfigured' });
  }

  try {
    // ── Step 1: Exchange code for tokens ────────────────────────────────────
    const tokenResp = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key:    clientKey,
        client_secret: clientSecret,
        code,
        grant_type:    'authorization_code',
        redirect_uri:  redirectUri,
        code_verifier: stateRow.code_verifier || '',
      }),
    });

    const tokenData = await tokenResp.json().catch(() => ({}));

    if (!tokenResp.ok || !tokenData.access_token) {
      console.error(
        '[tiktok/callback] token exchange failed:',
        tokenResp.status,
        tokenData?.error || tokenData
      );
      return redirectTo(res, baseUrl, { error: 'tiktok_token_failed' });
    }

    const now = Date.now();
    const tokenExpiresAt = tokenData.expires_in
      ? new Date(now + tokenData.expires_in * 1000).toISOString()
      : null;
    const refreshExpiresAt = tokenData.refresh_expires_in
      ? new Date(now + tokenData.refresh_expires_in * 1000).toISOString()
      : null;

    // ── Step 2: Encrypt tokens ───────────────────────────────────────────────
    let encryptedAccess  = null;
    let encryptedRefresh = null;
    try {
      encryptedAccess  = encrypt(tokenData.access_token);
      encryptedRefresh = tokenData.refresh_token ? encrypt(tokenData.refresh_token) : null;
    } catch (encErr) {
      console.error('[tiktok/callback] encryption failed:', encErr.message);
      return redirectTo(res, baseUrl, { error: 'tiktok_encryption_failed' });
    }

    // ── Step 3: Fetch TikTok profile (non-fatal if unavailable) ─────────────
    let profile = null;
    try {
      profile = await fetchProfile(tokenData.access_token);
    } catch (profileErr) {
      console.warn('[tiktok/callback] profile fetch failed (non-fatal):', profileErr.message);
    }

    // ── Step 4: Upsert creator_social_accounts ───────────────────────────────
    const supabase = getSupabaseAdminClient();
    const { error: upsertErr } = await supabase
      .from('creator_social_accounts')
      .upsert(
        {
          user_id:                   stateRow.user_id,
          platform:                  'tiktok',
          platform_user_id:          tokenData.open_id || profile?.open_id || null,
          username:                  null, // requires user.info.profile scope; set on sync
          display_name:              profile?.display_name || null,
          profile_image_url:         profile?.avatar_url  || null,
          access_token_encrypted:    encryptedAccess,
          refresh_token_encrypted:   encryptedRefresh,
          token_expires_at:          tokenExpiresAt,
          refresh_token_expires_at:  refreshExpiresAt,
          scopes:                    tokenData.scope ? tokenData.scope.split(',') : [],
          connection_status:         'connected',
          last_error:                null,
          last_synced_at:            new Date().toISOString(),
          metadata: {
            open_id:     tokenData.open_id    || null,
            token_type:  tokenData.token_type || 'bearer',
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,platform' }
      );

    if (upsertErr) {
      console.error('[tiktok/callback] upsert failed:', upsertErr.message);
      return redirectTo(res, baseUrl, { error: 'tiktok_storage_failed' });
    }

    // 'tiktok', not 'true': the UI renders `Connected ${connected}` and the
    // other three callbacks all send the platform name.
    return redirectTo(res, baseUrl, { connected: 'tiktok' });
  } catch (err) {
    console.error('[tiktok/callback] unexpected error:', err?.message);
    return redirectTo(res, baseUrl, { error: 'tiktok_server_error' });
  }
};
