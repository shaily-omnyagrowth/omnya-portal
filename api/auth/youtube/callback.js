// api/auth/youtube/callback.js
//
// GET /api/auth/youtube/callback?code=...&state=...
//
// F-3: this route used to write plaintext into creator_tokens. Both tokens are
// now AES-256-GCM encrypted by api/_utils/encryption.js and stored on the
// canonical creator_social_accounts row.
//
// YouTube is the only provider here that issues a real refresh_token, and only
// when the authorization request carried access_type=offline&prompt=consent —
// which api/auth/youtube/start.js does. Without it Google returns an access
// token that dies in an hour with no way to renew it, so has_refresh_token is
// recorded in metadata to make that visible.

const { getSupabaseAdminClient } = require('../../_utils/supabaseAdmin');
const { consumeOAuthState } = require('../../_utils/oauth');
const { upsertSocialAccount } = require('../../_utils/socialAccounts');

function redirectBack(res, params) {
  const base = process.env.APP_BASE_URL || 'https://www.portalomnyagrowth.com';
  const qs = new URLSearchParams({ page: 'social-connections', ...params }).toString();
  res.redirect(302, `${base}/?${qs}`);
}

async function fetchChannel(accessToken) {
  try {
    const resp = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return null;
    const item = (data.items || [])[0];
    if (!item) return null;
    const snippet = item.snippet || {};
    const thumbs = snippet.thumbnails || {};
    return {
      id: item.id,
      name: snippet.title || null,
      // customUrl is the @handle, when the channel has claimed one.
      handle: snippet.customUrl ? String(snippet.customUrl).replace(/^@/, '') : null,
      avatar: (thumbs.default && thumbs.default.url) || (thumbs.medium && thumbs.medium.url) || null,
    };
  } catch {
    return null;
  }
}

module.exports = async (req, res) => {
  const { code, state, error: providerError } = req.query || {};

  if (providerError) {
    console.warn('[youtube/callback] provider error:', providerError);
    return redirectBack(res, { error: 'youtube_auth_denied' });
  }
  if (!code || !state) {
    return redirectBack(res, { error: 'youtube_missing_params' });
  }

  const stateRow = await consumeOAuthState({ platform: 'youtube', state });
  if (!stateRow) {
    console.warn('[youtube/callback] invalid or expired state');
    return redirectBack(res, { error: 'youtube_invalid_state' });
  }

  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const redirectUri =
    process.env.YOUTUBE_REDIRECT_URI ||
    `${process.env.APP_BASE_URL || 'https://www.portalomnyagrowth.com'}/api/auth/youtube/callback`;

  if (!clientId || !clientSecret) {
    console.error('[youtube/callback] YOUTUBE_CLIENT_ID/SECRET not set');
    return redirectBack(res, { error: 'youtube_misconfigured' });
  }

  try {
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });
    const tokenData = await tokenResp.json().catch(() => ({}));

    if (!tokenResp.ok || !tokenData.access_token) {
      console.error(
        '[youtube/callback] token exchange failed:',
        tokenResp.status,
        tokenData && tokenData.error
      );
      return redirectBack(res, { error: 'youtube_token_exchange_failed' });
    }

    const channel = await fetchChannel(tokenData.access_token);

    const supabase = getSupabaseAdminClient();
    const { error: upsertErr } = await upsertSocialAccount(supabase, {
      userId: stateRow.user_id,
      platform: 'youtube',
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || null,
      expiresInSeconds: tokenData.expires_in,
      platformUserId: channel ? channel.id : null,
      username: channel ? channel.handle : null,
      displayName: channel ? channel.name : null,
      profileImageUrl: channel ? channel.avatar : null,
      scopes: tokenData.scope ? String(tokenData.scope).split(' ') : [],
      metadata: {
        provider: 'google',
        token_type: tokenData.token_type || 'Bearer',
        has_refresh_token: !!tokenData.refresh_token,
      },
    });

    if (upsertErr) {
      console.error('[youtube/callback] upsert failed:', upsertErr.message);
      return redirectBack(res, { error: 'youtube_storage_failed' });
    }

    return redirectBack(res, { connected: 'youtube' });
  } catch (err) {
    console.error('[youtube/callback] unexpected error:', err && err.message);
    return redirectBack(res, { error: 'youtube_server_error' });
  }
};
