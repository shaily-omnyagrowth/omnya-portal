// api/analytics/sync.js
//
// Vercel cron — runs every 12h per vercel.json. Authenticates via CRON_SECRET
// header. Fetches all Final Post submissions with posted_link and pushes their
// metrics into video_analytics via the shared helper in api/_utils/analytics.js.
//
// Returns a structured summary instead of leaking token-bearing logs.

const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const { Errors, sendOk } = require('../_utils/errors');
const { syncSubmissions, fetchAllFinalSubmissions } = require('../_utils/analytics');

module.exports = async (req, res) => {
  // Verify cron auth. Vercel sends Authorization: Bearer ${CRON_SECRET}.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[analytics/sync] CRON_SECRET env var is not set');
    return Errors.internal(res, 'Cron not configured');
  }
  if (req.headers.authorization !== `Bearer ${cronSecret}`) {
    return Errors.unauthorized(res, 'Invalid cron secret');
  }

  const startedAt = Date.now();
  try {
    const supabase = getSupabaseAdminClient();
    const submissions = await fetchAllFinalSubmissions(supabase);

    const summary = await syncSubmissions(supabase, submissions);
    const durationMs = Date.now() - startedAt;

    // Structured log — no tokens, no user IDs, just counts.
    console.log(JSON.stringify({
      event: 'analytics_sync_completed',
      submissions_total: submissions.length,
      processed: summary.processed,
      updated: summary.updated,
      failed: summary.failed,
      skipped: summary.skipped,
      duration_ms: durationMs,
      error_buckets: summarizeErrors(summary.errors),
    }));

    return sendOk(res, {
      submissionsTotal: submissions.length,
      ...summary,
      durationMs,
    });
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    console.error(JSON.stringify({
      event: 'analytics_sync_failed',
      message: err && err.message,
      duration_ms: durationMs,
    }));
    return Errors.internal(res, 'Sync failed', { message: err && err.message });
  }
};

// Group errors by reason for compact logging — never includes raw IDs/tokens.
function summarizeErrors(errors) {
  const counts = {};
  for (const e of errors || []) {
    const key = e.reason || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}
