// api/cron/refresh-oauth-tokens.js
//
// Vercel cron — runs daily per vercel.json. Authenticates via CRON_SECRET,
// matching api/cron/purge-oauth-states.js exactly.
//
// WHY THIS EXISTS  (F-4)
//
// Every stored token carries an expiry and, until now, nothing ever renewed
// one. A connection worked until its token aged out and then failed silently:
// the sync recorded an error against a row nobody looks at, and the creator
// found out when their view counts stopped moving.
//
// refreshIfNeeded() is also called lazily on the read path in
// api/_utils/analytics.js, and that alone would eventually renew most tokens.
// It is not enough on its own:
//
//   · A creator with no active submissions is never on a read path, so their
//     connection expires even though the account is perfectly healthy.
//   · Instagram refuses to refresh a token in its last 24 hours of life in
//     some states, so discovering the expiry at point of use can be too late.
//   · A refresh that fails needs to surface as a Reconnect prompt with enough
//     runway for the creator to act, not at the moment the data was wanted.
//
// So the cron sweeps ahead of the read path rather than replacing it.
//
// SCOPE
//
// It only touches rows that are inside the refresh threshold — default 7 days,
// configurable via OAUTH_REFRESH_THRESHOLD_DAYS. A row comfortably fresh costs
// one row read and no network call, so a daily sweep over a large table is
// cheap. Rows already flagged for reauth are skipped: the creator has to
// re-authorize and hammering the provider will not change that.
//
// It never throws out of the loop. One provider being down must not stop the
// other three being refreshed.

const crypto = require('crypto');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const { Errors, sendOk } = require('../_utils/errors');
const { refreshIfNeeded, defaultThresholdMs } = require('../_utils/tokenRefresh');
const { REAUTH_STATUSES } = require('../_utils/socialAccounts');

// Columns refreshIfNeeded needs. Deliberately named rather than '*': the two
// token columns are required here (this is server-side, they get decrypted),
// but naming them keeps it obvious that this is a privileged read.
const REFRESH_COLUMNS = [
  'id',
  'user_id',
  'platform',
  'access_token_encrypted',
  'refresh_token_encrypted',
  'token_expires_at',
  'refresh_token_expires_at',
  'connection_status',
  'metadata',
  'created_at',
  'updated_at',
].join(', ');

module.exports = async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron/refresh-oauth-tokens] CRON_SECRET env var is not set');
    return Errors.internal(res, 'Cron not configured');
  }

  const incoming = req.headers.authorization || '';
  const expected = `Bearer ${cronSecret}`;
  const incomingHash = crypto.createHash('sha256').update(incoming).digest();
  const expectedHash = crypto.createHash('sha256').update(expected).digest();
  if (!crypto.timingSafeEqual(incomingHash, expectedHash)) {
    return Errors.unauthorized(res, 'Invalid cron secret');
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return Errors.methodNotAllowed(res);
  }

  // Fail before touching a row rather than flagging every account as broken
  // because the key is missing. An unset ENCRYPTION_KEY makes decrypt() throw,
  // and refreshIfNeeded would translate that into connection_status =
  // reauth_required for the entire table.
  const key = (process.env.ENCRYPTION_KEY || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    console.error('[cron/refresh-oauth-tokens] ENCRYPTION_KEY is missing or malformed');
    return Errors.internal(
      res,
      'ENCRYPTION_KEY is not configured; refusing to run rather than flag every account for reauth'
    );
  }

  const startedAt = Date.now();
  const thresholdMs = defaultThresholdMs();
  const cutoffIso = new Date(startedAt + thresholdMs).toISOString();

  const summary = {
    considered: 0,
    refreshed: 0,
    fresh: 0,
    needsReauth: 0,
    unsupported: 0,
    failed: 0,
    byPlatform: {},
    errors: [],
  };

  try {
    const supabase = getSupabaseAdminClient();

    // Only rows expiring inside the window. A NULL token_expires_at means the
    // provider issued no expiry (some Meta long-lived tokens), and there is
    // nothing to act on, so those are left alone.
    const { data: accounts, error } = await supabase
      .from('creator_social_accounts')
      .select(REFRESH_COLUMNS)
      .not('access_token_encrypted', 'is', null)
      .not('token_expires_at', 'is', null)
      .lte('token_expires_at', cutoffIso);

    if (error) {
      console.error('[cron/refresh-oauth-tokens] select failed:', error.message);
      return Errors.internal(res, error.message);
    }

    for (const account of accounts || []) {
      summary.considered += 1;

      // Already waiting on the creator. Retrying cannot help and each attempt
      // is a wasted provider call.
      if (REAUTH_STATUSES.has(account.connection_status)) {
        summary.needsReauth += 1;
        continue;
      }

      let result;
      try {
        result = await refreshIfNeeded(account, { supabase, now: Date.now() });
      } catch (err) {
        // refreshIfNeeded handles provider failure internally, so reaching
        // here means something unexpected. Record it and keep going.
        summary.failed += 1;
        summary.errors.push({
          accountId: account.id,
          platform: account.platform,
          reason: String((err && err.message) || err).slice(0, 200),
        });
        continue;
      }

      const p = account.platform || 'unknown';
      summary.byPlatform[p] = summary.byPlatform[p] || { refreshed: 0, fresh: 0, failed: 0 };

      switch (result.status) {
        case 'refreshed':
          summary.refreshed += 1;
          summary.byPlatform[p].refreshed += 1;
          break;
        case 'fresh':
          summary.fresh += 1;
          summary.byPlatform[p].fresh += 1;
          break;
        case 'failed':
          // The row is already flagged for reauth by refreshIfNeeded; this is
          // an expected outcome, not an error in the sweep.
          summary.needsReauth += 1;
          summary.byPlatform[p].failed += 1;
          summary.errors.push({
            accountId: account.id,
            platform: p,
            reason: String(result.error || 'refresh refused').slice(0, 200),
          });
          break;
        case 'unsupported':
        case 'no_token':
          summary.unsupported += 1;
          break;
        default:
          summary.unsupported += 1;
      }
    }

    summary.durationMs = Date.now() - startedAt;

    console.log(
      `[cron/refresh-oauth-tokens] considered=${summary.considered} ` +
      `refreshed=${summary.refreshed} fresh=${summary.fresh} ` +
      `needsReauth=${summary.needsReauth} failed=${summary.failed} ` +
      `(${summary.durationMs}ms, threshold ${Math.round(thresholdMs / 86400000)}d)`
    );

    return sendOk(res, summary);
  } catch (err) {
    console.error('[cron/refresh-oauth-tokens] Unexpected error:', err && err.message);
    return Errors.internal(res, err && err.message);
  }
};
