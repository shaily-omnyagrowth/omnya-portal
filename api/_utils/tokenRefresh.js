// api/_utils/tokenRefresh.js
//
// F-4. Before this file, nothing in the codebase ever refreshed an OAuth
// token: every provider issues an expiry, we stored it, and then the
// connection silently died. The only exception was TikTok, whose
// ensureFreshToken lived in api/_utils/tiktok.js.
//
// One entry point:
//
//   refreshIfNeeded(account, opts) -> { status, accessToken, account, error }
//
//     status 'fresh'        token is not close enough to expiry to bother
//            'refreshed'    provider issued a new token; it is stored, encrypted
//            'failed'       provider refused; row marked reauth_required
//            'unsupported'  provider has no refresh path from where we are
//            'no_token'     nothing stored to refresh
//
// It never throws for a provider failure. Losing a refresh must not lose the
// row — the account is flagged so the UI can prompt a reconnect, and the
// creator's history, profile and scopes survive.
//
// Per-provider strategy, because no two of these work the same way:
//
//   Google / YouTube  a real refresh_token grant. Google only issues the
//                     refresh_token when access_type=offline&prompt=consent,
//                     which api/auth/youtube/start.js does, and rarely
//                     re-issues it, so the stored one is kept.
//   Meta / Facebook   no refresh token exists. The long-lived token (~60d) is
//                     re-exchanged for a fresh 60 days via fb_exchange_token,
//                     using the current access token as the input.
//   Instagram         graph.instagram.com/refresh_access_token. Rejects tokens
//                     younger than 24 hours, so we check the issue time first
//                     and report 'fresh' rather than burning a failure on it.
//   TikTok            refresh_token grant. api/_utils/tiktok.js already
//                     implements it — this reuses that, it does not repeat it.

const { encrypt, decrypt } = require('./encryption');
const { getSupabaseAdminClient } = require('./supabaseAdmin');
const { STATUS_REAUTH } = require('./socialAccounts');
const { refreshAccessToken: refreshTikTokToken } = require('./tiktok');
const { facebookGraph } = require('./meta');

const DAY_MS = 24 * 60 * 60 * 1000;

// Refresh anything expiring inside this window. Seven days is comfortably
// inside Meta's 60-day life and far outside Google's one hour, so a daily cron
// gets many chances at each token before it dies.
function defaultThresholdMs() {
  const days = Number(process.env.OAUTH_REFRESH_THRESHOLD_DAYS);
  return Number.isFinite(days) && days > 0 ? days * DAY_MS : 7 * DAY_MS;
}

// Instagram refuses to refresh a token that is less than 24 hours old.
const IG_MIN_TOKEN_AGE_MS = 24 * 60 * 60 * 1000;

function metaCredentials() {
  const appId = process.env.META_APP_ID || process.env.FACEBOOK_APP_ID || process.env.INSTAGRAM_APP_ID;
  const appSecret = process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET || process.env.INSTAGRAM_APP_SECRET;
  return { appId, appSecret };
}

// ─── Per-provider strategies ────────────────────────────────────────────────
// Each returns { accessToken, refreshToken?, expiresInSeconds?,
// refreshExpiresInSeconds? } or throws with a message safe to store.

async function refreshGoogle(account) {
  const clientId = process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('YouTube OAuth client is not configured');

  const refreshToken = decrypt(account.refresh_token_encrypted);
  if (!refreshToken) {
    throw new Error('No refresh token stored; the creator must reconnect with offline access');
  }

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.access_token) {
    throw new Error(`Google refresh failed (${resp.status}): ${data.error_description || data.error || 'no access_token'}`);
  }
  return {
    accessToken: data.access_token,
    // Google keeps the same refresh_token unless the grant was revoked.
    refreshToken: data.refresh_token || null,
    expiresInSeconds: data.expires_in || null,
  };
}

async function refreshMeta(account) {
  const { appId, appSecret } = metaCredentials();
  if (!appId || !appSecret) throw new Error('Meta OAuth app is not configured');

  const current = decrypt(account.access_token_encrypted);
  if (!current) throw new Error('No access token stored to exchange');

  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: current,
  });
  const resp = await fetch(`${facebookGraph('oauth/access_token')}?${params.toString()}`);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.access_token) {
    throw new Error(`Meta long-lived exchange failed (${resp.status}): ${data.error?.message || 'no access_token'}`);
  }
  return {
    accessToken: data.access_token,
    refreshToken: null, // Meta has none, by design
    expiresInSeconds: data.expires_in || null,
  };
}

async function refreshInstagram(account) {
  const current = decrypt(account.access_token_encrypted);
  if (!current) throw new Error('No access token stored to refresh');

  const params = new URLSearchParams({
    grant_type: 'ig_refresh_token',
    access_token: current,
  });
  const resp = await fetch(`https://graph.instagram.com/refresh_access_token?${params.toString()}`);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.access_token) {
    throw new Error(`Instagram refresh failed (${resp.status}): ${data.error?.message || 'no access_token'}`);
  }
  return {
    accessToken: data.access_token,
    refreshToken: null,
    expiresInSeconds: data.expires_in || null,
  };
}

async function refreshTikTok(account) {
  const data = await refreshTikTokToken(account.refresh_token_encrypted);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresInSeconds: data.expires_in || null,
    refreshExpiresInSeconds: data.refresh_expires_in || null,
  };
}

/**
 * Which strategy applies to this row?
 * An Instagram row connected through the Facebook dialog (provider 'meta')
 * carries a Facebook token, so it refreshes the Meta way, not the IG way.
 */
function strategyFor(account) {
  const provider = account.metadata && account.metadata.provider;
  switch (account.platform) {
    case 'tiktok':
      return { name: 'tiktok', run: refreshTikTok };
    case 'youtube':
      return { name: 'google', run: refreshGoogle };
    case 'facebook':
      return { name: 'meta', run: refreshMeta };
    case 'instagram':
      return provider === 'meta'
        ? { name: 'meta', run: refreshMeta }
        : { name: 'instagram', run: refreshInstagram };
    default:
      return null;
  }
}

/** When was this token issued? Falls back to the row's own timestamps. */
function tokenIssuedAt(account) {
  const fromMeta = account.metadata && account.metadata.token_issued_at;
  const iso = fromMeta || account.updated_at || account.created_at;
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
}

/**
 * Refresh this account's token if it is close enough to expiry to matter.
 *
 * @param {object} account   a creator_social_accounts row, WITH the encrypted
 *                           token columns (this runs server-side only)
 * @param {object} [opts]
 * @param {number} [opts.thresholdMs]  refresh window; default 7 days
 * @param {number} [opts.now]          injectable clock, for tests
 * @param {object} [opts.supabase]     injectable client
 * @param {boolean} [opts.force]       refresh regardless of expiry
 * @returns {{status: string, accessToken: string|null, account: object, error: string|null}}
 */
async function refreshIfNeeded(account, opts = {}) {
  const supabase = opts.supabase || getSupabaseAdminClient();
  const now = opts.now || Date.now();
  const thresholdMs = opts.thresholdMs != null ? opts.thresholdMs : defaultThresholdMs();

  if (!account || !account.access_token_encrypted) {
    return { status: 'no_token', accessToken: null, account, error: null };
  }

  const expiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : null;
  const expiringSoon = expiresAt != null && expiresAt - now <= thresholdMs;

  // Comfortably fresh — hand back the current token without touching the network.
  if (!opts.force && !expiringSoon) {
    return { status: 'fresh', accessToken: decrypt(account.access_token_encrypted), account, error: null };
  }

  const strategy = strategyFor(account);
  if (!strategy) {
    return {
      status: 'unsupported',
      accessToken: decrypt(account.access_token_encrypted),
      account,
      error: `No refresh strategy for platform '${account.platform}'`,
    };
  }

  // Instagram will refuse a token younger than 24h. Reporting that as a failure
  // would flag a perfectly healthy connection for reauth, so treat it as fresh.
  if (strategy.name === 'instagram') {
    const issued = tokenIssuedAt(account);
    if (issued != null && now - issued < IG_MIN_TOKEN_AGE_MS) {
      return { status: 'fresh', accessToken: decrypt(account.access_token_encrypted), account, error: null };
    }
  }

  let result;
  try {
    result = await strategy.run(account);
  } catch (err) {
    const message = String((err && err.message) || 'Token refresh failed').slice(0, 500);
    // Keep the row. Flag it. The creator reconnects; nothing is thrown away.
    await supabase
      .from('creator_social_accounts')
      .update({
        connection_status: STATUS_REAUTH,
        last_error: message,
        updated_at: new Date(now).toISOString(),
      })
      .eq('id', account.id);
    console.warn(`[tokenRefresh] ${account.platform} refresh failed for account ${account.id}: ${message}`);
    return {
      status: 'failed',
      accessToken: null,
      account: { ...account, connection_status: STATUS_REAUTH, last_error: message },
      error: message,
    };
  }

  const nowIso = new Date(now).toISOString();
  const updates = {
    access_token_encrypted: encrypt(result.accessToken),
    token_expires_at: result.expiresInSeconds
      ? new Date(now + result.expiresInSeconds * 1000).toISOString()
      : account.token_expires_at,
    connection_status: 'connected',
    last_error: null,
    metadata: { ...(account.metadata || {}), token_issued_at: nowIso, last_refreshed_at: nowIso },
    updated_at: nowIso,
  };
  if (result.refreshToken) {
    updates.refresh_token_encrypted = encrypt(result.refreshToken);
  }
  if (result.refreshExpiresInSeconds) {
    updates.refresh_token_expires_at = new Date(now + result.refreshExpiresInSeconds * 1000).toISOString();
  }

  const { error: updErr } = await supabase
    .from('creator_social_accounts')
    .update(updates)
    .eq('id', account.id);

  if (updErr) {
    // The provider gave us a good token but we could not persist it. Return it
    // so the caller's request still succeeds; the next run will try again.
    console.error(`[tokenRefresh] refreshed ${account.platform} but could not store it: ${updErr.message}`);
    return {
      status: 'refreshed',
      accessToken: result.accessToken,
      account,
      error: `stored_failed: ${updErr.message}`,
    };
  }

  return {
    status: 'refreshed',
    accessToken: result.accessToken,
    account: { ...account, ...updates },
    error: null,
  };
}

/**
 * Convenience for read paths that are about to call a provider API: returns a
 * usable plaintext access token, refreshing first if it is near expiry, or
 * null if the connection needs the creator's attention.
 */
async function getFreshAccessToken(account, opts = {}) {
  const result = await refreshIfNeeded(account, opts);
  return result.accessToken || null;
}

module.exports = {
  refreshIfNeeded,
  getFreshAccessToken,
  strategyFor,
  defaultThresholdMs,
  IG_MIN_TOKEN_AGE_MS,
};
