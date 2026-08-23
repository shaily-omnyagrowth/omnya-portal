// api/integrations/tiktok/reconnect.js
//
// POST /api/integrations/tiktok/reconnect
// Headers: Authorization: Bearer <supabase-jwt>
// Returns: 200 { ok: true, data: { authorizationUrl } }
//
// Returns a fresh TikTok authorization URL.
// The existing connection (and tokens) are NOT removed until the new
// authorization succeeds in the callback — if the user abandons the
// reconnect flow, the old connection is still intact.

const { applyCors }                                    = require('../../_utils/cors');
const { requireAuth }                                  = require('../../_utils/auth');
const { Errors, sendOk }                               = require('../../_utils/errors');
const { storeOAuthState, generateCodeVerifier, generateCodeChallenge } = require('../../_utils/oauth');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  const user = await requireAuth(req, res);
  if (!user) return;

  const clientKey = process.env.TIKTOK_CLIENT_KEY || process.env.TIKTOK_APP_KEY;
  const baseUrl   = process.env.APP_BASE_URL || 'https://www.portalomnyagrowth.com';
  const redirectUri =
    process.env.TIKTOK_REDIRECT_URI ||
    `${baseUrl}/api/integrations/tiktok/callback`;

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
      redirectAfter: `${baseUrl}/?page=tiktok-connect`,
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
    console.error('[tiktok/reconnect] error:', err?.code, err?.message);
    return Errors.internal(res, 'Failed to start TikTok reconnect');
  }
};
