// api/auth/youtube/callback.js
//
// GET /api/auth/youtube/callback?code=...&state=...

const { getSupabaseAdminClient } = require('../../_utils/supabaseAdmin');
const { consumeOAuthState } = require('../../_utils/oauth');

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
    return {
      id: item.id,
      name: item.snippet && item.snippet.title,
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

    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      : null;

    const channel = await fetchChannel(tokenData.access_token);

    const supabase = getSupabaseAdminClient();
    const { error: upsertErr } = await supabase
      .from('creator_tokens')
      .upsert(
        {
          user_id: stateRow.user_id,
          platform: 'youtube',
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token || null,
          token_type: tokenData.token_type || 'Bearer',
          scope: tokenData.scope || null,
          expires_at: expiresAt,
          status: 'connected',
          last_error: null,
          platform_user_id: channel ? channel.id : null,
          platform_username: channel ? channel.name : null,
          metadata: {
            provider: 'google',
            has_refresh_token: !!tokenData.refresh_token,
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,platform' }
      );

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
