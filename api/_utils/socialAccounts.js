// api/_utils/socialAccounts.js
//
// Canonical helpers for public.creator_social_accounts — the one table that
// holds an OAuth connection for every provider (F-3 / F-13). creator_tokens is
// legacy: plaintext, read-only after the backfill, kept only for history.
//
// The vocabulary below is not a preference, it is what the live CHECK
// constraints accept. Verified against production on 2026-08-21 by inserting
// each candidate value and reading back which ones the database refused:
//
//   creator_social_accounts_platform_check
//     tiktok | instagram | facebook | youtube          ('meta' is REJECTED)
//   creator_social_accounts_connection_status_check
//     connected | disconnected | not_connected |
//     expired | reauth_required | sync_failed          ('needs_reauth' is REJECTED)
//
// Two consequences the rest of the codebase depends on:
//
//   1. The generic Meta OAuth flow (api/auth/meta/*) cannot store platform
//      'meta'. It lands on the 'facebook' row and records provider='meta' in
//      metadata, so analytics can still route Instagram reads through it.
//   2. 'reauth_required' is the reauth signal, not 'needs_reauth'. The API
//      surfaces it as a boolean `needsReauth` so callers never have to know
//      which spelling the database happens to use.

const { encrypt } = require('./encryption');

// Platforms that can be stored. Ordered for stable UI rendering.
const PLATFORMS = ['tiktok', 'instagram', 'facebook', 'youtube'];

const CONNECTION_STATUSES = [
  'connected',
  'disconnected',
  'not_connected',
  'expired',
  'reauth_required',
  'sync_failed',
];

// The single status that means "the creator must authorize us again".
const STATUS_REAUTH = 'reauth_required';

// Statuses that should surface a Reconnect prompt in the UI. 'needs_reauth' is
// listed because the brief and any hand-written row may use that spelling even
// though the CHECK will not accept it on write.
const REAUTH_STATUSES = new Set(['expired', 'reauth_required', 'needs_reauth', 'sync_failed']);

// Every column, on either table, that holds token material. Nothing in this
// list may ever reach the browser.
const TOKEN_COLUMNS = [
  'access_token',
  'refresh_token',
  'access_token_encrypted',
  'refresh_token_encrypted',
];

// The safe projection: creator_social_accounts minus the token columns.
const SAFE_COLUMNS = [
  'id',
  'user_id',
  'platform',
  'platform_user_id',
  'username',
  'display_name',
  'profile_image_url',
  'token_expires_at',
  'refresh_token_expires_at',
  'scopes',
  'connection_status',
  'last_synced_at',
  'last_error',
  'metadata',
  'created_at',
  'updated_at',
];

/**
 * Refuse a select list that names a token column.
 *
 * This is the guard that stops F-3 regressing: the browser-facing endpoints
 * build their projection from a constant, and this assertion fails loudly if
 * anyone ever widens that constant to '*' or adds a token column by hand.
 *
 * @param {string|string[]} columns  select list, as a string or an array
 * @param {string} context           where it came from, for the error message
 * @throws if any token column is named
 */
function assertNoTokenColumns(columns, context = 'select list') {
  const list = Array.isArray(columns)
    ? columns
    : String(columns || '').split(',');

  const named = list
    .map((c) => String(c).trim().split(/[\s(]/)[0].replace(/["']/g, ''))
    .filter(Boolean);

  if (named.includes('*')) {
    throw new Error(
      `TOKEN LEAK GUARD: ${context} selects '*', which would include ` +
      `${TOKEN_COLUMNS.join(' / ')}. Name the columns explicitly.`
    );
  }

  const offenders = named.filter((c) => TOKEN_COLUMNS.includes(c));
  if (offenders.length) {
    throw new Error(
      `TOKEN LEAK GUARD: ${context} names token column(s) ${offenders.join(', ')}. ` +
      'Token material must never leave the server. Remove them from the projection.'
    );
  }
  return true;
}

// Built once, at module load, so a bad edit to SAFE_COLUMNS fails on require
// rather than on the first request that happens to hit the endpoint.
assertNoTokenColumns(SAFE_COLUMNS, 'socialAccounts.SAFE_COLUMNS');
const SAFE_SELECT = SAFE_COLUMNS.join(', ');

/**
 * Map an OAuth-state platform label onto a storable platform.
 * 'meta' is a flow label, not a storable platform — see the header.
 */
function storagePlatform(platform) {
  if (platform === 'meta') return 'facebook';
  return platform;
}

/** True if this row should prompt the creator to reconnect. */
function needsReauth(row) {
  if (!row) return false;
  if (REAUTH_STATUSES.has(row.connection_status)) return true;
  // A live token that has already passed its expiry is equally dead.
  if (row.connection_status === 'connected' && row.token_expires_at) {
    return new Date(row.token_expires_at).getTime() < Date.now();
  }
  return false;
}

/**
 * Upsert one connection, encrypting the tokens on the way in.
 *
 * Takes plaintext tokens and never returns them. The caller passes provider
 * fields already mapped onto the canonical column names.
 *
 * @param {object} supabase      service-role client
 * @param {object} fields
 * @param {string} fields.userId
 * @param {string} fields.platform            flow label; mapped via storagePlatform()
 * @param {string} [fields.accessToken]       PLAINTEXT — encrypted here
 * @param {string} [fields.refreshToken]      PLAINTEXT — encrypted here
 * @param {number} [fields.expiresInSeconds]
 * @param {number} [fields.refreshExpiresInSeconds]
 * @param {string[]} [fields.scopes]
 * @returns {{ error: object|null, platform: string }}
 */
async function upsertSocialAccount(supabase, fields) {
  const platform = storagePlatform(fields.platform);
  if (!PLATFORMS.includes(platform)) {
    return { error: new Error(`Unsupported platform for storage: ${fields.platform}`), platform };
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const row = {
    user_id: fields.userId,
    platform,
    platform_user_id: fields.platformUserId || null,
    username: fields.username || null,
    display_name: fields.displayName || null,
    profile_image_url: fields.profileImageUrl || null,
    access_token_encrypted: encrypt(fields.accessToken),
    refresh_token_encrypted: encrypt(fields.refreshToken),
    token_expires_at: fields.tokenExpiresAt
      || (fields.expiresInSeconds ? new Date(now + fields.expiresInSeconds * 1000).toISOString() : null),
    refresh_token_expires_at: fields.refreshTokenExpiresAt
      || (fields.refreshExpiresInSeconds
        ? new Date(now + fields.refreshExpiresInSeconds * 1000).toISOString()
        : null),
    scopes: Array.isArray(fields.scopes) ? fields.scopes : [],
    connection_status: 'connected',
    last_error: null,
    // token_issued_at is what the Instagram refresh strategy uses to honour the
    // provider's "token must be at least 24 hours old" rule.
    metadata: { ...(fields.metadata || {}), token_issued_at: nowIso },
    updated_at: nowIso,
  };

  const { error } = await supabase
    .from('creator_social_accounts')
    .upsert(row, { onConflict: 'user_id,platform' });

  return { error, platform };
}

module.exports = {
  PLATFORMS,
  CONNECTION_STATUSES,
  STATUS_REAUTH,
  REAUTH_STATUSES,
  TOKEN_COLUMNS,
  SAFE_COLUMNS,
  SAFE_SELECT,
  assertNoTokenColumns,
  storagePlatform,
  needsReauth,
  upsertSocialAccount,
};
