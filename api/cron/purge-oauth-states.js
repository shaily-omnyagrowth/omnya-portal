// api/cron/purge-oauth-states.js
//
// Vercel cron — runs daily per vercel.json. Authenticates via CRON_SECRET,
// matching the pattern in api/analytics/sync.js.
//
// Addresses audit finding N-17 / feature F-5: purge_expired_oauth_states()
// has existed since the social-media migration but was scheduled nowhere, so
// expired OAuth state rows accumulated indefinitely. Every row in production
// was expired at the time of the audit.
//
// The SQL function is granted to service_role only, so this endpoint uses the
// admin client.

const crypto = require('crypto');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const { Errors, sendOk } = require('../_utils/errors');

module.exports = async (req, res) => {
  // Verify cron auth. Vercel sends Authorization: Bearer ${CRON_SECRET}.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron/purge-oauth-states] CRON_SECRET env var is not set');
    return Errors.internal(res, 'Cron not configured');
  }

  // Constant-time comparison over equal-length hashes, as in analytics/sync.
  const incoming = req.headers.authorization || '';
  const expected = `Bearer ${cronSecret}`;
  const incomingHash = crypto.createHash('sha256').update(incoming).digest();
  const expectedHash = crypto.createHash('sha256').update(expected).digest();
  if (!crypto.timingSafeEqual(incomingHash, expectedHash)) {
    return Errors.unauthorized(res, 'Invalid cron secret');
  }

  // Vercel cron uses GET.
  if (req.method !== 'GET' && req.method !== 'POST') {
    return Errors.methodNotAllowed(res);
  }

  try {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase.rpc('purge_expired_oauth_states');

    if (error) {
      console.error('[cron/purge-oauth-states] purge failed:', error.message);
      return Errors.internal(res, error.message);
    }

    // The function returns the number of rows it deleted.
    const purged = typeof data === 'number' ? data : (data ?? null);
    console.log(`[cron/purge-oauth-states] purged ${purged} expired state row(s)`);

    return sendOk(res, { purged });
  } catch (err) {
    console.error('[cron/purge-oauth-states] Unexpected error:', err.message);
    return Errors.internal(res, err.message);
  }
};
