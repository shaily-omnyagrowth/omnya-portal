// api/auth/disconnect.js
//
// POST /api/auth/disconnect
//   Headers: Authorization: Bearer <supabase-jwt>
//   Body:    { platform: 'tiktok' | 'instagram' | 'facebook' | 'meta' | 'youtube' }
//   Returns: 200 { ok: true, data: { platform, status: 'disconnected' } }
//
// Soft-delete: clears the OAuth tokens and flips status='disconnected'. The
// row stays for audit history. Only affects the caller's own row.

const { applyCors } = require('../_utils/cors');
const { requireAuth } = require('../_utils/auth');
const { Errors, sendOk } = require('../_utils/errors');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const { SUPPORTED_PLATFORMS } = require('../_utils/oauth');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  const user = await requireAuth(req, res);
  if (!user) return;

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { platform } = body || {};

  if (!platform || !SUPPORTED_PLATFORMS.has(platform)) {
    return Errors.badRequest(res, `Unsupported platform: ${platform}`, {
      allowed: Array.from(SUPPORTED_PLATFORMS),
    });
  }

  try {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from('creator_tokens')
      .update({
        access_token: null,
        refresh_token: null,
        expires_at: null,
        refresh_expires_at: null,
        status: 'disconnected',
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)
      .eq('platform', platform)
      .select('id, platform, status')
      .maybeSingle();

    if (error) {
      console.error('[disconnect] update failed:', error.message);
      return Errors.internal(res, 'Failed to disconnect');
    }

    if (!data) {
      // Nothing existed for that user+platform. Treat as success — UI gets a
      // consistent "disconnected" state either way.
      return sendOk(res, { platform, status: 'disconnected', wasConnected: false });
    }

    return sendOk(res, { platform: data.platform, status: data.status, wasConnected: true });
  } catch (err) {
    console.error('[disconnect] unexpected error:', err && err.message);
    return Errors.internal(res, 'Internal server error');
  }
};
