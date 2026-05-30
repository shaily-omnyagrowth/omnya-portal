const { applyCors } = require('../_utils/cors');
const { Errors, sendOk } = require('../_utils/errors');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const { applyRateLimit } = require('../_utils/rateLimit');
const { requirePaymentPermission } = require('../_lib/paymentPermissions');
const {
  calculateBonusByViews,
  getBonusTier,
} = require('../_lib/paymentCalculations');

// How long after posted_at a submission becomes bonus-eligible (matches
// BONUS_ELIGIBILITY_DAYS = 10 in paymentCalculations.js).
const BONUS_ELIGIBILITY_DAYS = 10;
const BONUS_ELIGIBILITY_MS = BONUS_ELIGIBILITY_DAYS * 24 * 60 * 60 * 1000;

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  // Rate limit: recalculation is a potentially expensive bulk write operation.
  // Cap at 10 requests per minute per caller IP.
  const blocked = await applyRateLimit(req, res, {
    max: 10,
    windowSecs: 60,
    endpoint: 'earnings-recalculate',
  });
  if (blocked) return;

  // Owner-only: use manage_payment_managers which is unconditionally granted
  // only to the owner role (no PM column grants this permission).
  const authCtx = await requirePaymentPermission(req, res, 'manage_payment_managers');
  if (!authCtx) return;

  const supabase = getSupabaseAdminClient();

  try {
    // -------------------------------------------------------------------------
    // STEP 1 — Fetch all fully-approved submissions.
    //
    // final_status has no CHECK constraint; the codebase canonically writes
    // 'Approved' (capital A). The IN clause also covers lower-case variants
    // that may exist from earlier manual data entry.
    // creator_id and campaign_id are direct columns on submissions, so no join
    // to campaigns is required.
    // -------------------------------------------------------------------------
    const { data: approvedSubmissions, error: fetchError } = await supabase
      .from('submissions')
      .select(
        'id, creator_id, campaign_id, posted_at, view_count_submitted, view_count_verified'
      )
      .in('final_status', ['Approved', 'approved', 'final_approved', 'completed'])
      .not('creator_id', 'is', null);

    if (fetchError) {
      console.error('[earnings/recalculate] fetch submissions error:', fetchError.message);
      return Errors.internal(res, 'Failed to fetch approved submissions');
    }

    if (!approvedSubmissions || approvedSubmissions.length === 0) {
      return sendOk(res, {
        success: true,
        basePay: { created: 0, skipped: 0 },
        bonus: { created: 0, updated: 0, skipped: 0 },
      });
    }

    // -------------------------------------------------------------------------
    // STEP 2 — Base-pay pass.
    //
    // For each approved submission, check whether a base_video_pay earning row
    // already exists (the partial unique index on submission_id WHERE
    // earning_type = 'base_video_pay' would block a duplicate INSERT anyway,
    // but we prefer an explicit check to count skipped rows accurately and to
    // avoid relying on catching constraint errors in a loop).
    // -------------------------------------------------------------------------
    const submissionIds = approvedSubmissions.map((s) => s.id);

    // Fetch all existing base-pay rows for these submissions in one query.
    const { data: existingBasePay, error: bpFetchError } = await supabase
      .from('creator_earnings')
      .select('submission_id')
      .eq('earning_type', 'base_video_pay')
      .in('submission_id', submissionIds);

    if (bpFetchError) {
      console.error('[earnings/recalculate] fetch existing base pay error:', bpFetchError.message);
      return Errors.internal(res, 'Failed to fetch existing base-pay earnings');
    }

    const existingBasePayIds = new Set(
      (existingBasePay || []).map((r) => r.submission_id)
    );

    const basePayToInsert = approvedSubmissions
      .filter((s) => !existingBasePayIds.has(s.id))
      .map((s) => ({
        creator_id:   s.creator_id,
        campaign_id:  s.campaign_id,
        submission_id: s.id,
        earning_type: 'base_video_pay',
        amount:       10.00,
        currency:     'USD',
        status:       'approved',
        description:  'Base pay for approved video',
      }));

    let basePayCreated = 0;
    const basePaySkipped = existingBasePayIds.size;

    if (basePayToInsert.length > 0) {
      // Insert in chunks of 100 to stay within Supabase payload limits.
      const CHUNK = 100;
      for (let i = 0; i < basePayToInsert.length; i += CHUNK) {
        const chunk = basePayToInsert.slice(i, i + CHUNK);
        const { error: insertError } = await supabase
          .from('creator_earnings')
          .insert(chunk);

        if (insertError) {
          console.error(
            '[earnings/recalculate] base pay insert error (chunk starting at %d): %s',
            i,
            insertError.message
          );
          return Errors.internal(res, 'Failed to insert base-pay earnings');
        }
        basePayCreated += chunk.length;
      }
    }

    // -------------------------------------------------------------------------
    // STEP 3 — Bonus pass.
    //
    // Only process submissions where:
    //   - posted_at is set
    //   - posted_at is at least BONUS_ELIGIBILITY_DAYS (10) days before now
    //
    // View count: prefer view_count_verified when > 0, else view_count_submitted.
    // -------------------------------------------------------------------------
    const now = Date.now();
    const bonusEligibleSubmissions = approvedSubmissions.filter((s) => {
      if (!s.posted_at) return false;
      const postedMs = new Date(s.posted_at).getTime();
      return (now - postedMs) >= BONUS_ELIGIBILITY_MS;
    });

    let bonusCreated = 0;
    let bonusUpdated = 0;
    let bonusSkipped = 0;

    if (bonusEligibleSubmissions.length > 0) {
      const bonusSubmissionIds = bonusEligibleSubmissions.map((s) => s.id);

      // Fetch all existing performance_bonus rows for these submissions.
      const { data: existingBonus, error: bonusFetchError } = await supabase
        .from('creator_earnings')
        .select('id, submission_id, amount, bonus_tier, status')
        .eq('earning_type', 'performance_bonus')
        .in('submission_id', bonusSubmissionIds);

      if (bonusFetchError) {
        console.error('[earnings/recalculate] fetch existing bonus error:', bonusFetchError.message);
        return Errors.internal(res, 'Failed to fetch existing bonus earnings');
      }

      // Build a lookup: submission_id -> existing bonus row
      const existingBonusMap = new Map(
        (existingBonus || []).map((r) => [r.submission_id, r])
      );

      // Statuses that are terminal — do not update these rows.
      const TERMINAL_STATUSES = new Set(['paid', 'forfeited', 'cancelled']);

      for (const sub of bonusEligibleSubmissions) {
        const views =
          sub.view_count_verified > 0
            ? sub.view_count_verified
            : (sub.view_count_submitted || 0);

        const bonusAmount = calculateBonusByViews(views);

        if (bonusAmount <= 0) {
          // No tier matched — nothing to do regardless of existing row state.
          bonusSkipped += 1;
          continue;
        }

        const tier = getBonusTier(views);
        const tierLabel = tier ? tier.label : null;
        const existing = existingBonusMap.get(sub.id);

        if (!existing) {
          // INSERT new performance_bonus row.
          const { error: bonusInsertError } = await supabase
            .from('creator_earnings')
            .insert({
              creator_id:    sub.creator_id,
              campaign_id:   sub.campaign_id,
              submission_id: sub.id,
              earning_type:  'performance_bonus',
              amount:        bonusAmount,
              currency:      'USD',
              status:        'eligible',
              description:   `Performance bonus — ${tierLabel}`,
              views_counted: views,
              bonus_tier:    tierLabel,
            });

          if (bonusInsertError) {
            console.error(
              '[earnings/recalculate] bonus insert error for submission %s: %s',
              sub.id,
              bonusInsertError.message
            );
            // Non-fatal: continue processing remaining submissions.
            bonusSkipped += 1;
            continue;
          }
          bonusCreated += 1;
        } else if (!TERMINAL_STATUSES.has(existing.status)) {
          // UPDATE only if amount or tier label has changed.
          const amountChanged = parseFloat(existing.amount) !== bonusAmount;
          const tierChanged   = existing.bonus_tier !== tierLabel;

          if (amountChanged || tierChanged) {
            const { error: bonusUpdateError } = await supabase
              .from('creator_earnings')
              .update({
                amount:        bonusAmount,
                bonus_tier:    tierLabel,
                description:   `Performance bonus — ${tierLabel}`,
                views_counted: views,
              })
              .eq('id', existing.id);

            if (bonusUpdateError) {
              console.error(
                '[earnings/recalculate] bonus update error for earning %s: %s',
                existing.id,
                bonusUpdateError.message
              );
              bonusSkipped += 1;
              continue;
            }
            bonusUpdated += 1;
          } else {
            // Existing row is correct — nothing to do.
            bonusSkipped += 1;
          }
        } else {
          // Terminal status (paid / forfeited / cancelled) — do not touch.
          bonusSkipped += 1;
        }
      }
    }

    return sendOk(res, {
      success: true,
      basePay: {
        created: basePayCreated,
        skipped: basePaySkipped,
      },
      bonus: {
        created: bonusCreated,
        updated: bonusUpdated,
        skipped: bonusSkipped,
      },
    });
  } catch (err) {
    console.error('[earnings/recalculate] unexpected error:', err.message);
    return Errors.internal(res, err.message);
  }
};
