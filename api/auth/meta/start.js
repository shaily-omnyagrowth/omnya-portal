// api/auth/meta/start.js
//
// POST /api/auth/meta/start
//
// Generic Meta OAuth. Use this when the integration is "any Meta property"
// rather than specifically Instagram or Facebook. Most call sites should
// prefer instagram/start or facebook/start instead.

const { applyCors } = require('../../_utils/cors');
const { requireAuth } = require('../../_utils/auth');
const { Errors, sendOk } = require('../../_utils/errors');
const { storeOAuthState } = require('../../_utils/oauth');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  const user = await requireAuth(req, res);
  if (!user) return;

  const appId = process.env.META_APP_ID || process.env.FACEBOOK_APP_ID || process.env.INSTAGRAM_APP_ID;
  const redirectUri =
    process.env.META_REDIRECT_URI ||
    `${process.env.APP_BASE_URL || 'https://www.portalomnyagrowth.com'}/api/auth/meta/callback`;

  if (!appId) {
    return Errors.internal(res, 'Meta OAuth is not configured');
  }

  try {
    const state = await storeOAuthState({
      userId: user.id,
      platform: 'meta',
      redirectAfter: '/?page=social-connections',
    });

    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
      scope: 'instagram_basic,instagram_manage_insights,pages_show_list,pages_read_engagement',
    });

    const authorizationUrl = `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`;
    return sendOk(res, { authorizationUrl });
  } catch (err) {
    console.error('[meta/start] error:', err && err.code, err && err.message);
    return Errors.internal(res, 'Failed to start Meta OAuth');
  }
};
