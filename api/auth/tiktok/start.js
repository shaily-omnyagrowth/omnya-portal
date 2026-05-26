// api/auth/tiktok/start.js
//
// POST /api/auth/tiktok/start
//   Headers: Authorization: Bearer <supabase-jwt>
//   Body:    (none required)
//   Returns: 200 { ok: true, data: { authorizationUrl } }
//
// Generates a secure, server-stored OAuth state + PKCE verifier and returns
// the TikTok authorization URL for the browser to redirect to.

const { applyCors } = require('../../_utils/cors');
const { requireAuth } = require('../../_utils/auth');
const { Errors, sendOk } = require('../../_utils/errors');
const {
  storeOAuthState,
  generateCodeVerifier,
  generateCodeChallenge,
} = require('../../_utils/oauth');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  const user = await requireAuth(req, res);
  if (!user) return;

  const clientKey = process.env.TIKTOK_CLIENT_KEY || process.env.TIKTOK_APP_KEY;
  const redirectUri =
    process.env.TIKTOK_REDIRECT_URI ||
    `${process.env.APP_BASE_URL || 'https://www.portalomnyagrowth.com'}/api/auth/tiktok/callback`;

  if (!clientKey) {
    return Errors.internal(res, 'TikTok OAuth is not configured (TIKTOK_CLIENT_KEY missing)');
  }

  try {
    // PKCE — TikTok requires this for public/SPA clients.
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    const state = await storeOAuthState({
      userId: user.id,
      platform: 'tiktok',
      codeVerifier,
      redirectAfter: '/?page=social-connections',
    });

    const params = new URLSearchParams({
      client_key: clientKey,
      response_type: 'code',
      scope: 'user.info.basic,video.list',
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const authorizationUrl = `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
    return sendOk(res, { authorizationUrl });
  } catch (err) {
    console.error('[tiktok/start] error:', err && err.code, err && err.message);
    return Errors.internal(res, 'Failed to start TikTok OAuth');
  }
};
