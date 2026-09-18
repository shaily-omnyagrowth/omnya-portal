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

// Where every OAuth callback ends: a 302 to the static /oauth-complete page.
//
// WHY A REDIRECT AND NOT AN HTML RESPONSE
//
// A previous version rendered a small HTML page from here, with an inline
// <script> that postMessage'd window.opener and an onclick="retry()" button.
// Neither can work on this deployment, and the dev server hides both:
//
//   * vercel.json sends `Content-Security-Policy: script-src 'self'` on every
//     path, /api/* included. Inline script and inline event handlers are
//     blocked, so the page rendered and then did nothing — no message, no
//     auto-return, and a dead "Try Again".
//   * vercel.json also sends `Cross-Origin-Opener-Policy: same-origin`. The
//     moment the popup navigates to tiktok.com / facebook.com / google.com the
//     browser severs it from the portal: window.opener is null from then on
//     (even once it is back on our origin), and the portal reads popup.closed
//     as true while the popup is still open.
//
// `react-scripts start` sets neither header, which is why it looked fine
// locally. Loosening the policy to suit the callback would be the wrong trade.
//
// So the result goes to public/oauth-complete.html, whose script is a
// same-origin FILE (allowed by the CSP) and which reports back over
// BroadcastChannel + localStorage — both scoped by origin, not by opener, so
// the COOP severance does not matter. If nobody is listening (the popup was
// blocked and this is a full-page flow) it simply continues to the portal.
//
// Only fixed, server-chosen codes ever reach the query string: `platform` and
// `error` are never echoed from provider input.
const OAUTH_PLATFORMS = new Set(['tiktok', 'instagram', 'facebook', 'youtube']);

function oauthCompleteUrl(baseUrl, { platform, error = null, connected = null }) {
  const qs = new URLSearchParams();
  qs.set('platform', OAUTH_PLATFORMS.has(platform) ? platform : 'account');
  if (error) {
    qs.set('status', 'error');
    qs.set('error', String(error).replace(/[^a-z0-9_]/gi, '').slice(0, 64));
  } else {
    qs.set('status', 'success');
    if (connected) qs.set('connected', OAUTH_PLATFORMS.has(connected) ? connected : 'account');
  }
  // vercel.json has cleanUrls on, so production serves the page at
  // /oauth-complete and would 308 the .html form. Going there directly avoids
  // depending on that redirect carrying the query string. The CRA dev server
  // and tests/lib/devServer.cjs only know the file by its real name.
  const page = process.env.VERCEL ? '/oauth-complete' : '/oauth-complete.html';
  return `${String(baseUrl || '').replace(/\/+$/, '')}${page}?${qs.toString()}`;
}

function finishOAuth(res, baseUrl, result) {
  res.setHeader('Cache-Control', 'no-store');
  return res.redirect(302, oauthCompleteUrl(baseUrl, result || {}));
}

// The redirect URI each flow sends to its provider. One definition, used by the
// start routes, the callbacks (the token exchange must repeat it byte for byte)
// and the owner's config page — a mismatch with what is registered in the
// provider console is the single most common reason a connect fails, and it
// fails on the PROVIDER's error page, where the portal cannot explain it.
//
// TikTok's default is /api/auth/tiktok/callback because that is the path
// SOCIAL_MEDIA_INTEGRATION.md tells the operator to register. The integrations
// route used to default to /api/integrations/tiktok/callback instead, so a
// console set up from the docs never matched what the Connect button sent.
function appBaseUrl() {
  return String(process.env.APP_BASE_URL || 'https://www.portalomnyagrowth.com').replace(/\/+$/, '');
}

function redirectUriFor(platform) {
  const base = appBaseUrl();
  switch (platform) {
    case 'tiktok':    return process.env.TIKTOK_REDIRECT_URI    || `${base}/api/auth/tiktok/callback`;
    case 'instagram': return process.env.INSTAGRAM_REDIRECT_URI || `${base}/api/auth/instagram/callback`;
    case 'facebook':
    case 'meta':      return process.env.META_REDIRECT_URI      || `${base}/api/auth/meta/callback`;
    case 'youtube':   return process.env.YOUTUBE_REDIRECT_URI   || `${base}/api/auth/youtube/callback`;
    default:          return null;
  }
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
  finishOAuth,
  oauthCompleteUrl,
  appBaseUrl,
  redirectUriFor,
  assertPlatform,
};
