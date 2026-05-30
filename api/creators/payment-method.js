// api/creators/payment-method.js — Vercel serverless function
//
// PATCH /api/creators/payment-method
//
// Allows a creator to update their own payment method, or an owner / PM to
// update the method for any creator.
//
// Supported methods:
//   bank_transfer — requires bank_name + bank_account_last4 (last-4 digits only)
//                   optional bank_transfer_notes
//   zelle         — requires zelle_email and/or zelle_phone_last4 (last-4 digits)
//
// Security:
//   - Storing full account numbers is prohibited; the endpoint rejects any body
//     containing 'account_number' or 'full_account' keys.
//   - bank_account_last4 and zelle_phone_last4 must be exactly 4 digits.
//   - zelle_email, when provided, must pass a basic email-format check.
//   - Switching methods clears all fields belonging to the previous method so
//     stale data never leaks into payout exports.

const { applyCors } = require('../_utils/cors');
const { requireRole } = require('../_utils/auth');
const { Errors, sendOk } = require('../_utils/errors');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const { applyRateLimit } = require('../_utils/rateLimit');
const { formatPayoutDestination } = require('../_lib/paymentCalculations');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_METHODS = ['bank_transfer', 'zelle'];

const FOUR_DIGITS_RE = /^\d{4}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Fields that are prohibited in any request body (full account numbers).
const FORBIDDEN_BODY_KEYS = ['account_number', 'full_account'];

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'PATCH') return Errors.methodNotAllowed(res);

  // Auth: creators, owners, and account managers may call this endpoint.
  const authCtx = await requireRole(req, res, ['creator', 'owner', 'am', 'account_manager']);
  if (!authCtx) return;

  const { user, profile } = authCtx;
  const callerRole = profile.role; // already normalised by requireRole

  // Rate limit: 5 requests per hour per authenticated user.
  const blocked = await applyRateLimit(req, res, {
    max: 5,
    windowSecs: 3600,
    endpoint: 'creators-payment-method',
    userId: user.id,
  });
  if (blocked) return;

  // ---------------------------------------------------------------------------
  // Parse body
  // ---------------------------------------------------------------------------

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) {}
  }
  if (!body || typeof body !== 'object') {
    return Errors.badRequest(res, 'Request body is required');
  }

  // Security: reject any body that contains full account number fields.
  for (const key of FORBIDDEN_BODY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      return Errors.badRequest(res, 'Storing full account numbers is not permitted');
    }
  }

  const {
    payment_method,
    bank_name,
    bank_account_last4,
    bank_transfer_notes,
    zelle_email,
    zelle_phone_last4,
    creatorId: bodyCreatorId,
  } = body;

  // ---------------------------------------------------------------------------
  // Validate payment_method
  // ---------------------------------------------------------------------------

  if (!payment_method) {
    return Errors.badRequest(res, 'payment_method is required');
  }
  if (!ALLOWED_METHODS.includes(payment_method)) {
    return Errors.badRequest(
      res,
      `payment_method must be one of: ${ALLOWED_METHODS.join(', ')}`
    );
  }

  // ---------------------------------------------------------------------------
  // Method-specific field validation
  // ---------------------------------------------------------------------------

  if (payment_method === 'bank_transfer') {
    if (!bank_name || typeof bank_name !== 'string' || !bank_name.trim()) {
      return Errors.badRequest(res, 'bank_name is required for bank_transfer');
    }
    if (!bank_account_last4) {
      return Errors.badRequest(res, 'bank_account_last4 is required for bank_transfer');
    }
    if (!FOUR_DIGITS_RE.test(String(bank_account_last4))) {
      return Errors.badRequest(res, 'bank_account_last4 must be exactly 4 digits');
    }
  }

  if (payment_method === 'zelle') {
    // At least one of zelle_email or zelle_phone_last4 must be supplied.
    const hasEmail = zelle_email && typeof zelle_email === 'string' && zelle_email.trim();
    const hasPhone = zelle_phone_last4 && typeof zelle_phone_last4 === 'string';

    if (!hasEmail && !hasPhone) {
      return Errors.badRequest(
        res,
        'At least one of zelle_email or zelle_phone_last4 is required for zelle'
      );
    }
    if (hasEmail && !EMAIL_RE.test(zelle_email.trim())) {
      return Errors.badRequest(res, 'zelle_email must be a valid email address');
    }
    if (hasPhone && !FOUR_DIGITS_RE.test(String(zelle_phone_last4))) {
      return Errors.badRequest(res, 'zelle_phone_last4 must be exactly 4 digits');
    }
  }

  // ---------------------------------------------------------------------------
  // Resolve the target creator record
  // ---------------------------------------------------------------------------

  const supabase = getSupabaseAdminClient();

  let creatorId;

  if (callerRole === 'creator') {
    // Creator may only update their own record; ignore any creatorId in body.
    const { data: creatorRow, error: creatorError } = await supabase
      .from('creators')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (creatorError) {
      console.error('[payment-method] Creator lookup error:', creatorError.message);
      return Errors.internal(res, 'Failed to look up creator profile');
    }
    if (!creatorRow) {
      return Errors.notFound(res, 'Creator profile not found for this account');
    }
    creatorId = creatorRow.id;
  } else {
    // Owner / PM: creatorId must be supplied in the request body.
    if (!bodyCreatorId) {
      return Errors.badRequest(res, 'creatorId is required for owner/PM updates');
    }
    // Confirm the target creator exists.
    const { data: targetRow, error: targetError } = await supabase
      .from('creators')
      .select('id')
      .eq('id', bodyCreatorId)
      .maybeSingle();

    if (targetError) {
      console.error('[payment-method] Target creator lookup error:', targetError.message);
      return Errors.internal(res, 'Failed to look up target creator');
    }
    if (!targetRow) {
      return Errors.notFound(res, `Creator not found: ${bodyCreatorId}`);
    }
    creatorId = targetRow.id;
  }

  // ---------------------------------------------------------------------------
  // Build the update object (only safe last-4 / masked fields)
  // Switching methods clears all fields belonging to the previous method.
  // ---------------------------------------------------------------------------

  const updatePayload = {
    payment_method,
    payment_method_status: 'submitted',
    payment_method_updated_at: new Date().toISOString(),
  };

  if (payment_method === 'bank_transfer') {
    updatePayload.bank_name = bank_name.trim();
    updatePayload.bank_account_last4 = String(bank_account_last4);
    updatePayload.bank_transfer_notes =
      bank_transfer_notes && typeof bank_transfer_notes === 'string'
        ? bank_transfer_notes.trim() || null
        : null;

    // Clear zelle fields when switching to bank_transfer.
    updatePayload.zelle_email = null;
    updatePayload.zelle_phone_last4 = null;
  }

  if (payment_method === 'zelle') {
    updatePayload.zelle_email =
      zelle_email && typeof zelle_email === 'string' ? zelle_email.trim() || null : null;
    updatePayload.zelle_phone_last4 =
      zelle_phone_last4 && typeof zelle_phone_last4 === 'string'
        ? String(zelle_phone_last4)
        : null;

    // Clear bank fields when switching to zelle.
    updatePayload.bank_name = null;
    updatePayload.bank_account_last4 = null;
    updatePayload.bank_transfer_notes = null;
  }

  // ---------------------------------------------------------------------------
  // Persist to database
  // ---------------------------------------------------------------------------

  try {
    const { error: updateError } = await supabase
      .from('creators')
      .update(updatePayload)
      .eq('id', creatorId);

    if (updateError) throw updateError;

    // ---------------------------------------------------------------------------
    // Audit log — fire-and-forget; never blocks the success response.
    // ---------------------------------------------------------------------------
    (async () => {
      try {
        await supabase.from('payment_audit_logs').insert({
          actor_user_id: user.id,
          action: 'payment_method_updated',
          entity_type: 'creator',
          entity_id: creatorId,
          metadata: {
            payment_method,
            updated_by_role: callerRole,
          },
          created_at: new Date().toISOString(),
        });
      } catch (auditErr) {
        console.error('[payment-method] Audit log error:', auditErr.message);
      }
    })();

    // ---------------------------------------------------------------------------
    // Build destination summary using formatPayoutDestination.
    // The helper reads `payout_method`, `zelle_destination`, and
    // `bank_account_number` (legacy column names).  We pass a shim that maps
    // the new columns to the shape it expects so it can produce a masked label.
    // ---------------------------------------------------------------------------
    const creatorShim = {
      // Primary method key used by formatPayoutDestination.
      payout_method: payment_method,

      // Bank transfer: the helper reads `bank_account_number` and slices last 4.
      // We already have exactly last 4, so we pass it directly.
      bank_account_number: updatePayload.bank_account_last4 || null,

      // Zelle: the helper reads `zelle_destination` and branches on '@'.
      zelle_destination:
        updatePayload.zelle_email ||
        (updatePayload.zelle_phone_last4
          ? `****${updatePayload.zelle_phone_last4}`
          : null),
    };

    const destination_summary = formatPayoutDestination(creatorShim);

    return sendOk(res, {
      success: true,
      payment_method,
      payment_method_status: 'submitted',
      destination_summary,
    });
  } catch (err) {
    console.error('[payment-method] Update error:', err.message);
    return Errors.internal(res, err.message);
  }
};
