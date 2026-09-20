// api/auth/instagram/start.js
//
// POST /api/auth/instagram/start
//
// Begins an Instagram Business OAuth flow using instagram.com/oauth/authorize
// (the new Instagram Business Login, distinct from the Facebook dialog).
// The callback is handled by /api/auth/instagram/callback.

const { applyCors } = require('../../_utils/cors');
const { requireAuth } = require('../../_utils/auth');
const { Errors, sendOk } = require('../../_utils/errors');
const { storeOAuthState, redirectUriFor } = require('../../_utils/oauth');
const { instagramAppCredentials } = require('../../_utils/meta');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  const user = await requireAuth(req, res);
  if (!user) return;

  const creds = instagramAppCredentials();
  const redirectUri = redirectUriFor('instagram');

  // Refuse here, with the reason, rather than sending the creator to
  // Instagram's "Invalid platform app" page, which says nothing they can act on.
  if (creds.error) {
    console.error('[instagram/start]', creds.error);
    return Errors.internal(res, `Instagram is not set up correctly. ${creds.error}`);
  }

  try {
    const state = await storeOAuthState({
      userId: user.id,
      platform: 'instagram',
      redirectAfter: '/?page=social-connections',
    });

    // Instagram Business Login — shows instagram.com branding, not facebook.com.
    const params = new URLSearchParams({
      client_id: creds.appId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
      scope: 'instagram_business_basic,instagram_business_manage_insights',
    });

    const authorizationUrl = `https://www.instagram.com/oauth/authorize?${params.toString()}`;
    return sendOk(res, { authorizationUrl });
  } catch (err) {
    console.error('[instagram/start] error:', err && err.code, err && err.message);
    return Errors.internal(res, 'Failed to start Instagram OAuth');
  }
};
