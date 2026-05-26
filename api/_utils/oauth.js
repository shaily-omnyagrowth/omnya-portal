// api/_utils/oauth.js
//
// Secure OAuth state + PKCE helpers, backed by the public.oauth_states table.
//
//   generateRandomState()     -> 32-byte url-safe random string (the value
//                                that goes in the OAuth `state` query param)
//   hashState(state)          -> sha256 hex digest (what we persist)
//   generateCodeVerifier()    -> PKCE verifier (43-128 chars, url-safe)
//   generateCodeChallenge(v)  -> S256(verifier), base64url
//   storeOAuthState({...})    -> writes a row to oauth_states, returns the
//                                raw state to send to the provider
//   consumeOAuthState({...})  -> verifies + marks used; returns the stored
//                                row (incl. code_verifier) or null

const crypto = require('crypto');
const { getSupabaseAdminClient } = require('./supabaseAdmin');

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const SUPPORTED_PLATFORMS = new Set(['tiktok', 'instagram', 'facebook', 'meta', 'youtube']);

function assertPlatform(platform) {
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    const err = new Error(`Unsupported platform: ${platform}`);
    err.code = 'unsupported_platform';
    throw err;
  }
}

function base64UrlEncode(buf) {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function generateRandomState() {
  return base64UrlEncode(crypto.randomBytes(32));
}

function hashState(state) {
  return crypto.createHash('sha256').update(state).digest('hex');
}

// RFC 7636: verifier is 43-128 chars from [A-Z][a-z][0-9] - . _ ~
function generateCodeVerifier() {
  return base64UrlEncode(crypto.randomBytes(48)); // 64-char url-safe string
}

function generateCodeChallenge(codeVerifier) {
  return base64UrlEncode(crypto.createHash('sha256').update(codeVerifier).digest());
}

// Insert a row into oauth_states. Returns the raw state that should be sent
// to the OAuth provider as the `state` query param.
async function storeOAuthState({ userId, platform, codeVerifier, redirectAfter }) {
  assertPlatform(platform);
  if (!userId) throw new Error('userId is required');

  const state = generateRandomState();
  const stateHash = hashState(state);
  const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();

  const supabase = getSupabaseAdminClient();
  const { error } = await supabase.from('oauth_states').insert({
    user_id: userId,
    platform,
    state_hash: stateHash,
    code_verifier: codeVerifier || null,
    redirect_after: redirectAfter || null,
    expires_at: expiresAt,
  });

  if (error) {
    const err = new Error(`Failed to store oauth state: ${error.message}`);
    err.code = 'state_store_failed';
    throw err;
  }

  return state;
}

// Verify + consume an OAuth state. Atomic-ish: select the unused, unexpired
// row matching (platform, state_hash), then mark it used. Returns the row
// (with code_verifier, user_id, redirect_after) or null on any failure.
//
// Bound to platform — a state issued for tiktok cannot be replayed against
// the youtube callback.
async function consumeOAuthState({ platform, state }) {
  assertPlatform(platform);
  if (!state || typeof state !== 'string') return null;

  const stateHash = hashState(state);
  const supabase = getSupabaseAdminClient();

  // Look up the unused, unexpired row.
  const { data: row, error } = await supabase
    .from('oauth_states')
    .select('id, user_id, platform, code_verifier, redirect_after, expires_at, used_at')
    .eq('platform', platform)
    .eq('state_hash', stateHash)
    .is('used_at', null)
    .gte('expires_at', new Date().toISOString())
    .maybeSingle();

  if (error || !row) return null;

  // Mark used. The .is('used_at', null) here prevents double-consumption races.
  const { error: updErr, data: updated } = await supabase
    .from('oauth_states')
    .update({ used_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('used_at', null)
    .select('id')
    .maybeSingle();

  if (updErr || !updated) return null;

  return row;
}

module.exports = {
  STATE_TTL_MS,
  SUPPORTED_PLATFORMS,
  generateRandomState,
  hashState,
  generateCodeVerifier,
  generateCodeChallenge,
  storeOAuthState,
  consumeOAuthState,
  assertPlatform,
};
