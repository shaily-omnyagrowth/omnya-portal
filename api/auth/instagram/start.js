// api/auth/instagram/start.js
//
// POST /api/auth/instagram/start
//
// Begins a Meta OAuth flow that will be labelled as 'instagram' in
// creator_tokens. Same redirect URI as Facebook + Meta — the shared
// /api/auth/meta/callback reads the platform label from oauth_states.

const { applyCors } = require('../../_utils/cors');
const { requireAuth } = require('../../_utils/auth');
const { Errors, sendOk } = require('../../_utils/errors');
const { storeOAuthState } = require('../../_utils/oauth');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  const user = await requireAuth(req, res);
  if (!user) return;

  const appId = process.env.INSTAGRAM_APP_ID || process.env.META_APP_ID || process.env.FACEBOOK_APP_ID;
  const redirectUri =
    process.env.META_REDIRECT_URI ||
    `${process.env.APP_BASE_URL || 'https://www.portalomnyagrowth.com'}/api/auth/meta/callback`;

  if (!appId) {
    return Errors.internal(res, 'Meta OAuth is not configured (INSTAGRAM_APP_ID/META_APP_ID missing)');
  }

  try {
    const state = await storeOAuthState({
      userId: user.id,
      platform: 'instagram',
      redirectAfter: '/?page=social-connections',
    });

    // Meta's unified OAuth dialog. Instagram-specific business scopes.
    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
      scope: 'instagram_basic,instagram_manage_insights,pages_show_list,business_management',
    });

    const authorizationUrl = `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`;
    return sendOk(res, { authorizationUrl });
  } catch (err) {
    console.error('[instagram/start] error:', err && err.code, err && err.message);
    return Errors.internal(res, 'Failed to start Instagram OAuth');
  }
};
