// api/integrations/tiktok/disconnect.js
//
// POST /api/integrations/tiktok/disconnect
// Headers: Authorization: Bearer <supabase-jwt>
// Returns: 200 { ok: true, data: { disconnected: true } }
//
// Disconnects the authenticated user's TikTok account:
//   1. Attempts token revocation at TikTok (best-effort, non-fatal).
//   2. Nulls the encrypted tokens in creator_social_accounts.
//   3. Sets connection_status = 'disconnected'.
//
// The row is retained for audit history. Profile metadata is preserved.
// Payout / earnings logic is not affected.

const { applyCors }              = require('../../_utils/cors');
const { requireAuth }            = require('../../_utils/auth');
const { Errors, sendOk }         = require('../../_utils/errors');
const { getSupabaseAdminClient } = require('../../_utils/supabaseAdmin');
const { revokeToken }            = require('../../_utils/tiktok');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  const user = await requireAuth(req, res);
  if (!user) return;

  const supabase = getSupabaseAdminClient();

  // Load current account (need encrypted token for revocation)
  const { data: account, error: fetchErr } = await supabase
    .from('creator_social_accounts')
    .select('id, access_token_encrypted, connection_status')
    .eq('user_id', user.id)
    .eq('platform', 'tiktok')
    .maybeSingle();

  if (fetchErr) {
    console.error('[tiktok/disconnect] fetch error:', fetchErr.message);
    return Errors.internal(res, 'Failed to load TikTok account');
  }

  if (!account) {
    return sendOk(res, { disconnected: false, message: 'No TikTok connection found' });
  }

  // Already disconnected — idempotent
  if (account.connection_status === 'disconnected' || account.connection_status === 'not_connected') {
    return sendOk(res, { disconnected: true });
  }

  // Revoke token at TikTok (best-effort — never block disconnect on this)
  if (account.access_token_encrypted) {
    await revokeToken(account.access_token_encrypted);
  }

  // Null tokens, mark disconnected, keep profile metadata
  const { error: updateErr } = await supabase
    .from('creator_social_accounts')
    .update({
      access_token_encrypted:  null,
      refresh_token_encrypted: null,
      connection_status:       'disconnected',
      last_error:              null,
      updated_at:              new Date().toISOString(),
    })
    .eq('id', account.id);

  if (updateErr) {
    console.error('[tiktok/disconnect] update failed:', updateErr.message);
    return Errors.internal(res, 'Failed to disconnect TikTok');
  }

  return sendOk(res, { disconnected: true });
};
