// api/auth/meta/callback.js
//
// GET /api/auth/meta/callback?code=...&state=...
//
// Shared callback for facebook/start and meta/start. Instagram has its own
// callback (instagram/callback.js).
//
// Steps:
//   1. Validate state via oauth_states.
//   2. Exchange code for a short-lived access token.
//   3. Upgrade to a long-lived token (fb_exchange_token, ~60d).
//   4. Best-effort: fetch /me for the profile fields the UI shows.
//   5. Upsert creator_social_accounts with the token ENCRYPTED (F-3).
//
// F-3: this route used to write plaintext into creator_tokens. Tokens are now
// AES-256-GCM encrypted by api/_utils/encryption.js before they touch the
// database, and land on the canonical creator_social_accounts row.
//
// The generic 'meta' flow cannot be stored under that name — the live
// platform CHECK accepts only tiktok/instagram/facebook/youtube — so both
// flows land on the 'facebook' row with metadata.provider recording which
// dialog issued the token. See api/_utils/socialAccounts.js.

const { getSupabaseAdminClient } = require('../../_utils/supabaseAdmin');
const { consumeOAuthState } = require('../../_utils/oauth');
const { upsertSocialAccount } = require('../../_utils/socialAccounts');

function redirectBack(res, params) {
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
      `https://graph.facebook.com/v19.0/me?fields=id,name,picture.type(large)&access_token=${encodeURIComponent(token)}`
    );
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return null;
    return {
      id: data.id,
      name: data.name,
      picture: data.picture && data.picture.data ? data.picture.data.url : null,
    };
  } catch {
    return null;
  }
}

module.exports = async (req, res) => {
  const { code, state, error: providerError, error_description } = req.query || {};

  if (providerError) {
    console.warn('[meta/callback] provider returned error:', providerError, error_description);
    return redirectBack(res, { error: 'meta_auth_denied' });
  }
  if (!code || !state) {
    return redirectBack(res, { error: 'meta_missing_params' });
  }

  // The state could have been issued by facebook/start or meta/start.
  let stateRow = null;
  let flowPlatform = null;
  for (const candidate of ['facebook', 'meta']) {
    const row = await consumeOAuthState({ platform: candidate, state });
    if (row) {
      stateRow = row;
      flowPlatform = candidate;
      break;
    }
  }
  if (!stateRow) {
    console.warn('[meta/callback] invalid or expired state');
    return redirectBack(res, { error: 'meta_invalid_state' });
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
    return redirectBack(res, { error: 'meta_misconfigured' });
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
      return redirectBack(res, { error: 'meta_token_exchange_failed' });
    }

    // Step 2: upgrade to long-lived token (best-effort; fall back to short).
    const longLived = await fetchLongLivedToken({
      appId,
      appSecret,
      shortToken: exchangeData.access_token,
    });
    const accessToken = (longLived && longLived.access_token) || exchangeData.access_token;
    const expiresIn = (longLived && longLived.expires_in) || exchangeData.expires_in;

    // Step 3: best-effort profile fetch for the UI.
    const profile = await fetchProfile(accessToken);

    // Step 4: persist, encrypted.
    const supabase = getSupabaseAdminClient();
    const { error: upsertErr } = await upsertSocialAccount(supabase, {
      userId: stateRow.user_id,
      platform: flowPlatform, // 'meta' is mapped to 'facebook' for storage
      accessToken,
      refreshToken: null, // Meta issues no refresh token; the long-lived token is re-exchanged
      expiresInSeconds: expiresIn,
      platformUserId: profile ? profile.id : null,
      displayName: profile ? profile.name : null,
      profileImageUrl: profile ? profile.picture : null,
      scopes: [],
      metadata: {
        provider: 'meta',
        flow: flowPlatform,
        long_lived: !!longLived,
      },
    });

    if (upsertErr) {
      console.error('[meta/callback] upsert failed:', upsertErr.message);
      return redirectBack(res, { error: 'meta_storage_failed' });
    }

    return redirectBack(res, { connected: 'facebook' });
  } catch (err) {
    console.error('[meta/callback] unexpected error:', err && err.message);
    return redirectBack(res, { error: 'meta_server_error' });
  }
};
