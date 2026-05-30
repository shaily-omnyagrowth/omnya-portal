// api/creator/view-count.js
//
// POST /api/creator/view-count
//   Headers: Authorization: Bearer <supabase-jwt>
//   Body:    { submissionId, postedUrl?, postedAt?, viewCountSubmitted? }
//
// Updates view-count data on a submission.
//   - Creator: may only update submissions belonging to their own creator profile.
//   - Owner:   may update any submission.
//
// After the update, evaluates bonus eligibility:
//   - If the post is 10+ days old AND viewCountSubmitted > 0, sets bonus_eligible=true.
//   - Returns the updated submission row plus estimatedBonus and bonusEligible.

const { applyCors } = require('../_utils/cors');
const { requireRole, normalizeRole } = require('../_utils/auth');
const { Errors, sendOk } = require('../_utils/errors');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const { applyRateLimit } = require('../_utils/rateLimit');
const { isBonusEligible, calculateBonusByViews } = require('../_lib/paymentCalculations');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  // Authenticate: creator or owner only.
  const ctx = await requireRole(req, res, ['creator', 'owner']);
  if (!ctx) return;

  // Rate limit: 10 per minute per user.
  const blocked = await applyRateLimit(req, res, {
    max: 10,
    windowSecs: 60,
    endpoint: 'creator-view-count',
    userId: ctx.user.id,
  });
  if (blocked) return;

  const { user, profile } = ctx;
  const role = normalizeRole(profile.role);

  // Parse body.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const { submissionId, postedUrl, postedAt, viewCountSubmitted } = body;

  // --- Validation ---

  if (!submissionId || typeof submissionId !== 'string') {
    return Errors.badRequest(res, 'submissionId is required');
  }

  if (postedUrl !== undefined && postedUrl !== null && postedUrl !== '') {
    if (typeof postedUrl !== 'string' || !/^https?:\/\//i.test(postedUrl)) {
      return Errors.badRequest(res, 'postedUrl must start with http:// or https://');
    }
  }

  let parsedViewCount;
  if (viewCountSubmitted !== undefined && viewCountSubmitted !== null && viewCountSubmitted !== '') {
    parsedViewCount = parseInt(viewCountSubmitted, 10);
    if (isNaN(parsedViewCount) || parsedViewCount < 0) {
      return Errors.badRequest(res, 'viewCountSubmitted must be a non-negative integer');
    }
  }

  let parsedPostedAt;
  if (postedAt !== undefined && postedAt !== null && postedAt !== '') {
    parsedPostedAt = new Date(postedAt);
    if (isNaN(parsedPostedAt.getTime())) {
      return Errors.badRequest(res, 'postedAt is not a valid date');
    }
    if (parsedPostedAt.getTime() > Date.now()) {
      return Errors.badRequest(res, 'postedAt must not be in the future');
    }
  }

  const supabase = getSupabaseAdminClient();

  try {
    // Fetch the submission (with its creator's user_id for ownership checks).
    const { data: submission, error: fetchError } = await supabase
      .from('submissions')
      .select('id, creator_id, posted_at, view_count_submitted, bonus_eligible, creators!inner(id, user_id)')
      .eq('id', submissionId)
      .maybeSingle();

    if (fetchError) {
      console.error('[creator/view-count] submission fetch error:', fetchError.message);
      return Errors.internal(res, 'Failed to fetch submission');
    }
    if (!submission) {
      return Errors.notFound(res, 'Submission not found');
    }

    // Ownership check: creators may only update their own submissions.
    if (role === 'creator') {
      const submissionOwnerUserId = submission.creators?.user_id;
      if (!submissionOwnerUserId || submissionOwnerUserId !== user.id) {
        return Errors.forbidden(res, 'You are not authorized to update this submission');
      }
    }

    // Build the update payload — only include fields that were provided.
    const updatePayload = {
      view_count_source: 'manual',
      view_count_updated_at: new Date().toISOString(),
    };

    if (postedUrl !== undefined && postedUrl !== null && postedUrl !== '') {
      updatePayload.posted_url = postedUrl;
    }
    if (parsedPostedAt !== undefined) {
      updatePayload.posted_at = parsedPostedAt.toISOString();
    }
    if (parsedViewCount !== undefined) {
      updatePayload.view_count_submitted = parsedViewCount;
    }

    // Determine bonus eligibility.
    // Use the newly provided postedAt if present, otherwise fall back to the stored value.
    const effectivePostedAt = parsedPostedAt
      ? parsedPostedAt.toISOString()
      : submission.posted_at;

    const effectiveViewCount = parsedViewCount !== undefined
      ? parsedViewCount
      : (submission.view_count_submitted || 0);

    const postIsOldEnough = isBonusEligible(effectivePostedAt);

    if (postIsOldEnough && effectiveViewCount > 0) {
      updatePayload.bonus_eligible = true;
    }

    // Persist the update.
    const { data: updatedSubmission, error: updateError } = await supabase
      .from('submissions')
      .update(updatePayload)
      .eq('id', submissionId)
      .select()
      .single();

    if (updateError) {
      console.error('[creator/view-count] submission update error:', updateError.message);
      return Errors.internal(res, 'Failed to update submission');
    }

    // Compute estimated bonus from the effective view count.
    const estimatedBonus = calculateBonusByViews(effectiveViewCount);
    const bonusEligible = updatedSubmission.bonus_eligible || false;

    return sendOk(res, {
      submission: updatedSubmission,
      estimatedBonus,
      bonusEligible,
    });
  } catch (err) {
    console.error('[creator/view-count] unexpected error:', err && err.message);
    return Errors.internal(res, 'Unexpected error', { message: err && err.message });
  }
};
