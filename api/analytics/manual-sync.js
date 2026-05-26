// api/analytics/manual-sync.js
//
// POST /api/analytics/manual-sync
//   Headers: Authorization: Bearer <supabase-jwt>
//   Body:    { submissionId?: uuid, platform?: 'tiktok'|... }
//
// User-initiated analytics refresh. Role-scoped:
//   - creator → only their own submissions
//   - am      → only submissions for creators assigned to them
//   - owner   → any submission
//
// If submissionId is provided, refreshes just that submission (after scope check).
// Otherwise refreshes ALL the caller's in-scope Final Post submissions,
// optionally filtered by platform.

const { applyCors } = require('../_utils/cors');
const { requireRole, normalizeRole } = require('../_utils/auth');
const { Errors, sendOk } = require('../_utils/errors');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const {
  syncSubmissions,
  fetchSubmissionsByIds,
  fetchSubmissionsForUser,
} = require('../_utils/analytics');

const ALLOWED_PLATFORMS = new Set(['tiktok', 'instagram', 'facebook', 'youtube', 'meta']);

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  const ctx = await requireRole(req, res, ['owner', 'am', 'account_manager', 'creator']);
  if (!ctx) return;
  const { user, profile } = ctx;
  const role = normalizeRole(profile.role);

  // Parse body
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const submissionId = body && typeof body.submissionId === 'string' ? body.submissionId : null;
  const platform = body && typeof body.platform === 'string' ? body.platform.toLowerCase() : null;
  if (platform && !ALLOWED_PLATFORMS.has(platform)) {
    return Errors.badRequest(res, `Unsupported platform: ${platform}`);
  }

  const supabase = getSupabaseAdminClient();
  const startedAt = Date.now();

  try {
    let submissions = [];

    if (submissionId) {
      // Single-submission path. Look it up + verify scope.
      submissions = await fetchSubmissionsByIds(supabase, [submissionId]);
      if (submissions.length === 0) {
        return Errors.notFound(res, 'Submission not found');
      }
      const sub = submissions[0];
      const allowed = await canAccessSubmission(supabase, role, user.id, sub);
      if (!allowed) {
        return Errors.forbidden(res, 'Not authorized to refresh this submission');
      }
    } else {
      // Batch path. Determine which user_ids the caller may refresh.
      if (role === 'owner') {
        const { fetchAllFinalSubmissions } = require('../_utils/analytics');
        submissions = await fetchAllFinalSubmissions(supabase);
      } else if (role === 'am') {
        const userIds = await fetchUserIdsForAm(supabase, user.id);
        submissions = await fetchSubmissionsForUserIds(supabase, userIds);
      } else {
        // creator → their own submissions only
        submissions = await fetchSubmissionsForUser(supabase, user.id, null);
      }
      if (platform) submissions = submissions.filter((s) => (s.platform || '').toLowerCase() === platform);
    }

    if (submissions.length === 0) {
      return sendOk(res, {
        submissionsTotal: 0,
        processed: 0,
        updated: 0,
        failed: 0,
        skipped: 0,
        errors: [],
        durationMs: Date.now() - startedAt,
        message: 'No matching submissions found',
      });
    }

    const summary = await syncSubmissions(supabase, submissions);

    return sendOk(res, {
      submissionsTotal: submissions.length,
      ...summary,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    console.error('[analytics/manual-sync] error:', err && err.message);
    return Errors.internal(res, 'Manual sync failed', { message: err && err.message });
  }
};

// -----------------------------------------------------------------------------
// Scope helpers
// -----------------------------------------------------------------------------

// Owner: yes. Creator: yes if creator_id maps to their own creators row.
// AM: yes if creator's am_id is the AM's record.
async function canAccessSubmission(supabase, role, userId, sub) {
  if (role === 'owner') return true;
  const creatorUserId = sub.creators?.user_id;
  if (!creatorUserId) return false;
  if (role === 'creator') return creatorUserId === userId;
  if (role === 'am' || role === 'account_manager') {
    // Look up the creator's am_id and verify it belongs to this AM.
    const { data, error } = await supabase
      .from('creators')
      .select('id, account_managers!inner(user_id)')
      .eq('id', sub.creator_id)
      .eq('account_managers.user_id', userId)
      .maybeSingle();
    return !error && !!data;
  }
  return false;
}

// Return the auth.users.id list for creators assigned to the given AM.
async function fetchUserIdsForAm(supabase, amUserId) {
  const { data, error } = await supabase
    .from('account_managers')
    .select('id, creators(user_id)')
    .eq('user_id', amUserId)
    .maybeSingle();
  if (error || !data) return [];
  return (data.creators || []).map((c) => c.user_id).filter(Boolean);
}

// Submissions whose creators.user_id is in the given list.
async function fetchSubmissionsForUserIds(supabase, userIds) {
  if (!userIds || userIds.length === 0) return [];
  const { data, error } = await supabase
    .from('submissions')
    .select('id, creator_id, campaign_id, platform, posted_link, submission_type, creators!inner(user_id)')
    .in('creators.user_id', userIds)
    .not('posted_link', 'is', null)
    .eq('submission_type', 'Final Post');
  if (error) return [];
  return data || [];
}
