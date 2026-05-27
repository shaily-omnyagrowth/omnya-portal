// api/auth/meta/callback.js
//
// GET /api/auth/meta/callback?code=...&state=...
//
// Shared callback for instagram/start, facebook/start, and meta/start. Reads
// the platform label from oauth_states (which was set by the start route) and
// stores the resulting token under that label.
//
// Steps:
//   1. Validate state via oauth_states.
//   2. Exchange code for a short-lived access token.
//   3. Upgrade to a long-lived token (fb_exchange_token, ~60d).
//   4. Best-effort: fetch /me for platform_user_id / platform_username.
//   5. Upsert creator_tokens.

const { getSupabaseAdminClient } = require('../../_utils/supabaseAdmin');
const { consumeOAuthState } = require('../../_utils/oauth');

function redirectBack(res, platform, params) {
  const base = process.env.APP_BASE_URL || 'https://www.portalomnyagrowth.com';
  const qs = new URLSearchParams({ page: 'social-connections', ...params }).toString();
  res.redirect(302, `${base}/?${qs}`);
}

async function fetchLongLivedToken({ appId, appSecret, shortToken }) {
  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortToken,
  });
  const resp = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token?${params.toString()}`
  );
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.access_token) return null;
  return data; // { access_token, token_type, expires_in }
}

async function fetchProfile(token) {
  try {
    const resp = await fetch(
      `https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${encodeURIComponent(token)}`
    );
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return null;
    return { id: data.id, name: data.name };
  } catch {
    return null;
  }
}

module.exports = async (req, res) => {
  const { code, state, error: providerError, error_description } = req.query || {};

  if (providerError) {
    console.warn('[meta/callback] provider returned error:', providerError, error_description);
    return redirectBack(res, 'meta', { error: 'meta_auth_denied' });
  }
  if (!code || !state) {
    return redirectBack(res, 'meta', { error: 'meta_missing_params' });
  }

  // The state could have been issued by facebook/start or meta/start.
  // Instagram now has its own callback (instagram/callback.js).
  let stateRow = null;
  let platform = null;
  for (const candidate of ['facebook', 'meta']) {
    const row = await consumeOAuthState({ platform: candidate, state });
    if (row) {
      stateRow = row;
      platform = candidate;
      break;
    }
  }
  if (!stateRow) {
    console.warn('[meta/callback] invalid or expired state');
    return redirectBack(res, 'meta', { error: 'meta_invalid_state' });
  }

  const appId =
    process.env.META_APP_ID ||
    process.env.FACEBOOK_APP_ID ||
    process.env.INSTAGRAM_APP_ID;
  const appSecret =
    process.env.META_APP_SECRET ||
    process.env.FACEBOOK_APP_SECRET ||
    process.env.INSTAGRAM_APP_SECRET;
  const redirectUri =
    process.env.META_REDIRECT_URI ||
    `${process.env.APP_BASE_URL || 'https://www.portalomnyagrowth.com'}/api/auth/meta/callback`;

  if (!appId || !appSecret) {
    console.error('[meta/callback] Meta OAuth env vars not set');
    return redirectBack(res, platform, { error: 'meta_misconfigured' });
  }

  try {
    // Step 1: exchange code for short-lived token.
    const exchangeParams = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: redirectUri,
      code,
    });
    const exchangeResp = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?${exchangeParams.toString()}`
    );
    const exchangeData = await exchangeResp.json().catch(() => ({}));

    if (!exchangeResp.ok || !exchangeData.access_token) {
      console.error(
        '[meta/callback] short-lived exchange failed:',
        exchangeResp.status,
        exchangeData && exchangeData.error
      );
      return redirectBack(res, platform, { error: 'meta_token_exchange_failed' });
    }

    // Step 2: upgrade to long-lived token (best-effort; fall back to short).
    const longLived = await fetchLongLivedToken({
      appId,
      appSecret,
      shortToken: exchangeData.access_token,
    });
    const accessToken = (longLived && longLived.access_token) || exchangeData.access_token;
    const expiresIn = (longLived && longLived.expires_in) || exchangeData.expires_in;
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

    // Step 3: best-effort profile fetch for the UI.
    const profile = await fetchProfile(accessToken);

    // Step 4: persist.
    const supabase = getSupabaseAdminClient();
    const { error: upsertErr } = await supabase
      .from('creator_tokens')
      .upsert(
        {
          user_id: stateRow.user_id,
          platform,
          access_token: accessToken,
          refresh_token: null, // Meta does not issue refresh tokens; long-lived only
          token_type: 'bearer',
          scope: null,
          expires_at: expiresAt,
          status: 'connected',
          last_error: null,
          platform_user_id: profile ? profile.id : null,
          platform_username: profile ? profile.name : null,
          metadata: {
            provider: 'meta',
            long_lived: !!longLived,
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,platform' }
      );

    if (upsertErr) {
      console.error('[meta/callback] upsert failed:', upsertErr.message);
      return redirectBack(res, platform, { error: 'meta_storage_failed' });
    }

    return redirectBack(res, platform, { connected: platform });
  } catch (err) {
    console.error('[meta/callback] unexpected error:', err && err.message);
    return redirectBack(res, platform || 'meta', { error: 'meta_server_error' });
  }
};
