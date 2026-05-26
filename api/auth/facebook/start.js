// api/auth/facebook/start.js
//
// POST /api/auth/facebook/start
//
// Same Meta OAuth flow as the instagram start route, but labelled 'facebook'
// in creator_tokens so the UI can show two separate cards even though they
// share the same provider.

const { applyCors } = require('../../_utils/cors');
const { requireAuth } = require('../../_utils/auth');
const { Errors, sendOk } = require('../../_utils/errors');
const { storeOAuthState } = require('../../_utils/oauth');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  const user = await requireAuth(req, res);
  if (!user) return;

  const appId = process.env.FACEBOOK_APP_ID || process.env.META_APP_ID || process.env.INSTAGRAM_APP_ID;
  const redirectUri =
    process.env.META_REDIRECT_URI ||
    `${process.env.APP_BASE_URL || 'https://www.portalomnyagrowth.com'}/api/auth/meta/callback`;

  if (!appId) {
    return Errors.internal(res, 'Meta OAuth is not configured (FACEBOOK_APP_ID missing)');
  }

  try {
    const state = await storeOAuthState({
      userId: user.id,
      platform: 'facebook',
      redirectAfter: '/?page=social-connections',
    });

    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
      scope: 'pages_show_list,pages_read_engagement,pages_read_user_content',
    });

    const authorizationUrl = `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`;
    return sendOk(res, { authorizationUrl });
  } catch (err) {
    console.error('[facebook/start] error:', err && err.code, err && err.message);
    return Errors.internal(res, 'Failed to start Facebook OAuth');
  }
};
