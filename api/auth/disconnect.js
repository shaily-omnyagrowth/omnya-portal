// api/auth/disconnect.js
//
// POST /api/auth/disconnect
//   Headers: Authorization: Bearer <supabase-jwt>
//   Body:    { platform: 'tiktok' | 'instagram' | 'facebook' | 'meta' | 'youtube' }
//   Returns: 200 { ok: true, data: { platform, status: 'disconnected' } }
//
// Soft-delete: clears the stored tokens and flips connection_status to
// 'disconnected'. The row stays, with its profile and history, for audit.
// Only ever affects the caller's own row.

const { applyCors } = require('../_utils/cors');
const { requireAuth } = require('../_utils/auth');
const { Errors, sendOk } = require('../_utils/errors');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const { SUPPORTED_PLATFORMS } = require('../_utils/oauth');
const { storagePlatform, PLATFORMS } = require('../_utils/socialAccounts');
const { revokeToken } = require('../_utils/tiktok');


module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  const user = await requireAuth(req, res);
  if (!user) return;

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { platform: requested } = body || {};

  if (!requested || !SUPPORTED_PLATFORMS.has(requested)) {
    return Errors.badRequest(res, `Unsupported platform: ${requested}`, {
      allowed: Array.from(SUPPORTED_PLATFORMS),
    });
  }

  // 'meta' is a flow label; the row it wrote is the facebook one.
  const platform = storagePlatform(requested);
  if (!PLATFORMS.includes(platform)) {
    return Errors.badRequest(res, `Unsupported platform: ${requested}`, { allowed: PLATFORMS });
  }

  try {
    const supabase = getSupabaseAdminClient();

    const { data: account, error: fetchErr } = await supabase
      .from('creator_social_accounts')
      .select('id, platform, connection_status, access_token_encrypted')
      .eq('user_id', user.id)
      .eq('platform', platform)
      .maybeSingle();

    if (fetchErr) {
      console.error('[disconnect] fetch failed:', fetchErr.message);
      return Errors.internal(res, 'Failed to disconnect');
    }

    if (!account) {
      // Nothing existed for that user+platform; report success so the UI gets a consistent state.
      return sendOk(res, { platform, status: 'disconnected', wasConnected: false });
    }

    // Best-effort revocation at the provider. Only TikTok exposes one.
    if (platform === 'tiktok' && account.access_token_encrypted) {
      await revokeToken(account.access_token_encrypted);
    }

    const { error } = await supabase
      .from('creator_social_accounts')
      .update({
        access_token_encrypted: null,
        refresh_token_encrypted: null,
        token_expires_at: null,
        refresh_token_expires_at: null,
        connection_status: 'disconnected',
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', account.id);

    if (error) {
      console.error('[disconnect] update failed:', error.message);
      return Errors.internal(res, 'Failed to disconnect');
    }

    return sendOk(res, { platform, status: 'disconnected', wasConnected: true });
  } catch (err) {
    console.error('[disconnect] unexpected error:', err && err.message);
    return Errors.internal(res, 'Internal server error');
  }
};
