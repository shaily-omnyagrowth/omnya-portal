// api/integrations/tiktok/connect.js
//
// POST /api/integrations/tiktok/connect
// Headers: Authorization: Bearer <supabase-jwt>
// Returns: 200 { ok: true, data: { authorizationUrl } }
//
// Starts the TikTok OAuth flow with PKCE.
// The frontend receives authorizationUrl and does window.location.href = url.
// TikTok redirects back to /api/integrations/tiktok/callback.
//
// Tokens are NOT cleared until a new authorization succeeds in the callback,
// so calling this on an already-connected account is safe (use reconnect.js
// for the explicit reconnect UX, which calls the same logic).

const { applyCors }                                    = require('../../_utils/cors');
const { requireAuth }                                  = require('../../_utils/auth');
const { Errors, sendOk }                               = require('../../_utils/errors');
const { storeOAuthState, generateCodeVerifier, generateCodeChallenge, appBaseUrl, redirectUriFor } = require('../../_utils/oauth');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  const user = await requireAuth(req, res);
  if (!user) return;

  const clientKey = process.env.TIKTOK_CLIENT_KEY || process.env.TIKTOK_APP_KEY;
  const baseUrl   = appBaseUrl();
  const redirectUri = redirectUriFor('tiktok');

  if (!clientKey) {
    return Errors.internal(res, 'TikTok OAuth is not configured (TIKTOK_CLIENT_KEY missing)');
  }

  try {
    const codeVerifier  = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    const state = await storeOAuthState({
      userId:        user.id,
      platform:      'tiktok',
      codeVerifier,
      redirectAfter: `${baseUrl}/?page=social-connections`,
    });

    const params = new URLSearchParams({
      client_key:            clientKey,
      response_type:         'code',
      scope:                 'user.info.basic,video.list',
      redirect_uri:          redirectUri,
      state,
      code_challenge:        codeChallenge,
      code_challenge_method: 'S256',
    });

    const authorizationUrl = `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
    return sendOk(res, { authorizationUrl });
  } catch (err) {
    console.error('[tiktok/connect] error:', err?.code, err?.message);
    return Errors.internal(res, 'Failed to start TikTok OAuth');
  }
};
