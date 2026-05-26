// api/auth/youtube/start.js
//
// POST /api/auth/youtube/start

const { applyCors } = require('../../_utils/cors');
const { requireAuth } = require('../../_utils/auth');
const { Errors, sendOk } = require('../../_utils/errors');
const { storeOAuthState } = require('../../_utils/oauth');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  const user = await requireAuth(req, res);
  if (!user) return;

  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const redirectUri =
    process.env.YOUTUBE_REDIRECT_URI ||
    `${process.env.APP_BASE_URL || 'https://www.portalomnyagrowth.com'}/api/auth/youtube/callback`;

  if (!clientId) {
    return Errors.internal(res, 'YouTube OAuth is not configured (YOUTUBE_CLIENT_ID missing)');
  }

  try {
    const state = await storeOAuthState({
      userId: user.id,
      platform: 'youtube',
      redirectAfter: '/?page=social-connections',
    });

    const scope = [
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/yt-analytics.readonly',
    ].join(' ');

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope,
      state,
      access_type: 'offline', // needed to receive refresh_token
      prompt: 'consent',       // force refresh_token re-issue on re-auth
      include_granted_scopes: 'true',
    });

    const authorizationUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    return sendOk(res, { authorizationUrl });
  } catch (err) {
    console.error('[youtube/start] error:', err && err.code, err && err.message);
    return Errors.internal(res, 'Failed to start YouTube OAuth');
  }
};
