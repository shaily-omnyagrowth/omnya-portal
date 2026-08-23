// api/integrations/tiktok/status.js
//
// GET /api/integrations/tiktok/status
// Headers: Authorization: Bearer <supabase-jwt>
// Returns: 200 { ok: true, data: { platform, connection_status, ... } }
//
// Returns the TikTok connection state for the authenticated user.
// Safe public fields only — access_token and refresh_token are never returned.

const { applyCors }              = require('../../_utils/cors');
const { requireAuth }            = require('../../_utils/auth');
const { Errors, sendOk }         = require('../../_utils/errors');
const { getSupabaseAdminClient } = require('../../_utils/supabaseAdmin');

const SAFE_COLUMNS = [
  'id',
  'platform',
  'platform_user_id',
  'username',
  'display_name',
  'profile_image_url',
  'connection_status',
  'scopes',
  'last_synced_at',
  'last_error',
  'token_expires_at',
  'refresh_token_expires_at',
  'created_at',
  'updated_at',
].join(', ');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') return Errors.methodNotAllowed(res);

  const user = await requireAuth(req, res);
  if (!user) return;

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from('creator_social_accounts')
    .select(SAFE_COLUMNS)
    .eq('user_id', user.id)
    .eq('platform', 'tiktok')
    .maybeSingle();

  if (error) {
    console.error('[tiktok/status] query error:', error.message);
    return Errors.internal(res, 'Failed to load TikTok status');
  }

  // No row yet — return a clean "not connected" shape
  if (!data) {
    return sendOk(res, {
      platform:          'tiktok',
      connection_status: 'not_connected',
      platform_user_id:  null,
      username:          null,
      display_name:      null,
      profile_image_url: null,
      scopes:            [],
      last_synced_at:    null,
      last_error:        null,
      token_expires_at:  null,
      connected_since:   null,
    });
  }

  return sendOk(res, {
    platform:                data.platform,
    connection_status:       data.connection_status,
    platform_user_id:        data.platform_user_id,
    username:                data.username,
    display_name:            data.display_name,
    profile_image_url:       data.profile_image_url,
    scopes:                  data.scopes || [],
    last_synced_at:          data.last_synced_at,
    last_error:              data.last_error,
    token_expires_at:        data.token_expires_at,
    refresh_token_expires_at: data.refresh_token_expires_at,
    connected_since:         data.created_at,
  });
};
