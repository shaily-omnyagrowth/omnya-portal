// api/_utils/tiktok.js
//
// TikTok v2 API helpers used by the /api/integrations/tiktok/* routes.
//
//   fetchProfile(accessToken)               -> TikTok user object | null
//   fetchVideos(accessToken, opts)          -> video list data | null (null = scope denied)
//   refreshAccessToken(encryptedRefresh)    -> raw token response
//   ensureFreshToken(supabase, account)     -> fresh plaintext access token
//
// Tokens stored in creator_social_accounts.access_token_encrypted are
// always decrypted server-side via api/_utils/encryption.js and never
// returned to the frontend.

const { encrypt, decrypt } = require('./encryption');
const { getSupabaseAdminClient } = require('./supabaseAdmin');

const API_BASE    = 'https://open.tiktokapis.com/v2';
const TOKEN_URL   = 'https://open.tiktokapis.com/v2/oauth/token/';
const REVOKE_URL  = 'https://open.tiktokapis.com/v2/oauth/revoke/';

// Five-minute buffer: refresh if token expires in less than this
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

// ─── Profile ────────────────────────────────────────────────────────────────

/**
 * Fetch TikTok user profile using the v2 /user/info/ endpoint.
 * Scope required: user.info.basic
 *
 * @param  {string} accessToken  plaintext access token
 * @returns {{ open_id, display_name, avatar_url } | null}
 */
async function fetchProfile(accessToken) {
  const fields = 'open_id,union_id,avatar_url,display_name';
  const resp   = await fetch(`${API_BASE}/user/info/?fields=${fields}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`TikTok profile fetch failed (${resp.status}): ${text}`);
  }

  const json = await resp.json();

  if (json.error && json.error.code !== 'ok') {
    throw new Error(`TikTok profile error [${json.error.code}]: ${json.error.message}`);
  }

  return json.data?.user ?? null;
}

// ─── Video list ──────────────────────────────────────────────────────────────

/**
 * Fetch the creator's public video list.
 * Scope required: video.list
 *
 * @param  {string} accessToken
 * @param  {{ cursor?: number, maxCount?: number }} opts
 * @returns {{ videos: [], cursor, has_more } | null}  null = scope not granted
 */
async function fetchVideos(accessToken, { cursor = 0, maxCount = 20 } = {}) {
  const fields = [
    'id', 'title', 'video_description', 'duration',
    'create_time', 'share_url', 'cover_image_url',
    'view_count', 'like_count', 'comment_count', 'share_count',
  ].join(',');

  const resp = await fetch(`${API_BASE}/video/list/?fields=${fields}`, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ max_count: maxCount, cursor }),
  });

  // 403 or no_permission code → scope was not approved
  if (resp.status === 403) return null;

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`TikTok video list failed (${resp.status}): ${text}`);
  }

  const json = await resp.json();

  if (json.error && json.error.code !== 'ok') {
    if (json.error.code === 'no_permission' || json.error.code === 'permission_denied') {
      return null; // scope not granted — treat gracefully
    }
    throw new Error(`TikTok video error [${json.error.code}]: ${json.error.message}`);
  }

  return json.data ?? null;
}

// ─── Token refresh ───────────────────────────────────────────────────────────

/**
 * Call TikTok's token endpoint with grant_type=refresh_token.
 * Decrypts the stored refresh token before sending.
 *
 * @param  {string} encryptedRefreshToken  value from creator_social_accounts
 * @returns {object}  raw TikTok token response
 */
async function refreshAccessToken(encryptedRefreshToken) {
  const clientKey    = process.env.TIKTOK_CLIENT_KEY    || process.env.TIKTOK_APP_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET || process.env.TIKTOK_APP_SECRET;

  if (!clientKey || !clientSecret) {
    throw new Error('TikTok credentials (TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET) are not set');
  }

  const refreshToken = decrypt(encryptedRefreshToken);
  if (!refreshToken) throw new Error('No refresh token available; reauthorization required');

  const resp = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key:    clientKey,
      client_secret: clientSecret,
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`TikTok token refresh failed (${resp.status}): ${text}`);
  }

  const data = await resp.json();

  if (!data.access_token) {
    throw new Error(`TikTok token refresh returned no access_token: ${JSON.stringify(data)}`);
  }

  return data;
}

// ─── Revocation (best-effort) ────────────────────────────────────────────────

/**
 * Attempt to revoke a TikTok token. Never throws — silently swallows errors.
 * Call before nulling the stored token on disconnect.
 *
 * @param {string} encryptedAccessToken  value from creator_social_accounts
 */
async function revokeToken(encryptedAccessToken) {
  try {
    const clientKey    = process.env.TIKTOK_CLIENT_KEY    || process.env.TIKTOK_APP_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET || process.env.TIKTOK_APP_SECRET;
    const token        = decrypt(encryptedAccessToken);

    if (!token || !clientKey || !clientSecret) return;

    await fetch(REVOKE_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_key: clientKey, client_secret: clientSecret, token }),
    });
  } catch (_) {
    // Best-effort — do not propagate
  }
}

// ─── ensureFreshToken ────────────────────────────────────────────────────────

/**
 * Return a valid plaintext access token for the given social account row.
 * If the stored token expires within REFRESH_BUFFER_MS, it is refreshed first.
 * On refresh failure the account status is set to 'reauth_required' and an
 * error is thrown.
 *
 * @param  {object} account  Row from creator_social_accounts
 * @returns {string}  plaintext access token
 */
async function ensureFreshToken(account) {
  const supabase  = getSupabaseAdminClient();
  const now       = Date.now();
  const expiresAt = account.token_expires_at
    ? new Date(account.token_expires_at).getTime()
    : 0;

  // Token still fresh — just decrypt and return
  if (expiresAt - now > REFRESH_BUFFER_MS) {
    const token = decrypt(account.access_token_encrypted);
    if (!token) throw new Error('Stored access token is null; reauthorization required');
    return token;
  }

  // Attempt refresh
  try {
    const tokenData = await refreshAccessToken(account.refresh_token_encrypted);

    const updates = {
      access_token_encrypted: encrypt(tokenData.access_token),
      token_expires_at:       tokenData.expires_in
        ? new Date(now + tokenData.expires_in * 1000).toISOString()
        : account.token_expires_at,
      connection_status: 'connected',
      last_error:        null,
      updated_at:        new Date().toISOString(),
    };

    if (tokenData.refresh_token) {
      updates.refresh_token_encrypted = encrypt(tokenData.refresh_token);
    }
    if (tokenData.refresh_expires_in) {
      updates.refresh_token_expires_at =
        new Date(now + tokenData.refresh_expires_in * 1000).toISOString();
    }

    await supabase
      .from('creator_social_accounts')
      .update(updates)
      .eq('id', account.id);

    return tokenData.access_token;
  } catch (err) {
    // Mark account as needing re-auth so the UI can surface a reconnect prompt
    await supabase
      .from('creator_social_accounts')
      .update({
        connection_status: 'reauth_required',
        last_error:        err.message,
        updated_at:        new Date().toISOString(),
      })
      .eq('id', account.id);

    throw err;
  }
}

module.exports = {
  fetchProfile,
  fetchVideos,
  refreshAccessToken,
  revokeToken,
  ensureFreshToken,
};
