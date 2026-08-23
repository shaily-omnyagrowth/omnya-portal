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
//
// F-3/F-13: this writes creator_social_accounts, not creator_tokens. The
// legacy row is cleared too when one exists, best-effort — see the note on
// access_token below.

const { applyCors } = require('../_utils/cors');
const { requireAuth } = require('../_utils/auth');
const { Errors, sendOk } = require('../_utils/errors');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const { SUPPORTED_PLATFORMS } = require('../_utils/oauth');
const { storagePlatform, PLATFORMS } = require('../_utils/socialAccounts');
const { revokeToken } = require('../_utils/tiktok');

// creator_tokens.access_token is NOT NULL in production until migration
// 20260822000002 drops it, so a plain null-out fails with 23502. Try the clean
// version first and fall back to the status flip so a disconnect never 500s on
// a legacy row.
async function clearLegacyRow(supabase, userId, platform) {
  const base = { status: 'disconnected', last_error: null, updated_at: new Date().toISOString() };
  const { error } = await supabase
    .from('creator_tokens')
    .update({ ...base, access_token: null, refresh_token: null, expires_at: null, refresh_expires_at: null })
    .eq('user_id', userId)
    .eq('platform', platform);
  if (!error) return;
  await supabase.from('creator_tokens').update(base).eq('user_id', userId).eq('platform', platform);
}

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
      // Nothing existed for that user+platform. Still clear any legacy row, and
      // report success — the UI gets a consistent "disconnected" state.
      await clearLegacyRow(supabase, user.id, requested);
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

    await clearLegacyRow(supabase, user.id, requested);

    return sendOk(res, { platform, status: 'disconnected', wasConnected: true });
  } catch (err) {
    console.error('[disconnect] unexpected error:', err && err.message);
    return Errors.internal(res, 'Internal server error');
  }
};
