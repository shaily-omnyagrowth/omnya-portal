// api/_lib/paymentPermissions.js
//
// Payment-specific authorization helpers.
//
//   requirePaymentPermission(req, res, permission)
//     -> { user, role, isOwner?, isAM?, isPM?, permissions? } | null
//
//   logPaymentAction(supabaseAdmin, actorUserId, action, entityType, entityId, metadata)
//     -> Promise<void>  (never throws)
//
// Valid permission strings:
//   view_payouts | approve_withdrawals | export_batches | mark_paid | manage_payment_managers

const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const { getBearerToken, normalizeRole } = require('../_utils/auth');

// Map permission string -> payment_managers column name
const PERMISSION_COLUMN_MAP = {
  view_payouts:            'can_view_payouts',
  approve_withdrawals:     'can_approve_withdrawals',
  export_batches:          'can_export_batches',
  mark_paid:               'can_mark_paid',
  manage_payment_managers: 'can_manage_payment_managers',
};

/**
 * Verify the caller holds the given payment permission.
 *
 * Access is granted if any of the following is true (in order):
 *   1. The caller's role is 'owner'  — full access to everything.
 *   2. permission === 'view_payouts' AND role is 'am' or 'account_manager'.
 *   3. The caller has an active row in payment_managers whose mapped column is true.
 *
 * Returns the auth context object on success, or null after sending a 403.
 */
async function requirePaymentPermission(req, res, permission) {
  // --- 1. Extract and verify token ---
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Unauthorized', message: 'Missing or invalid Authorization header' });
    return null;
  }

  const supabase = getSupabaseAdminClient();

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData || !authData.user) {
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired token' });
    return null;
  }

  const user = authData.user;

  // --- 2. Fetch role from user_profiles ---
  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('id, email, role')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    res.status(403).json({ error: 'Forbidden', message: 'User profile not found' });
    return null;
  }

  const role = normalizeRole(profile.role);

  // --- 3. Owner: unconditional access ---
  if (role === 'owner') {
    return { user, role, isOwner: true };
  }

  // --- 4. AM shortcut: view_payouts only ---
  if (permission === 'view_payouts' && (role === 'am' || profile.role === 'account_manager')) {
    return { user, role, isAM: true };
  }

  // --- 5. payment_managers table check ---
  const column = PERMISSION_COLUMN_MAP[permission];
  if (!column) {
    // Unknown permission string — treat as forbidden
    res.status(403).json({ error: 'Forbidden', message: `Unknown permission: ${permission}` });
    return null;
  }

  const { data: pmRow, error: pmError } = await supabase
    .from('payment_managers')
    .select(`id, user_id, active, ${column}`)
    .eq('user_id', user.id)
    .eq('active', true)
    .maybeSingle();

  if (pmError) {
    console.error('[paymentPermissions] payment_managers query error:', pmError.message);
    res.status(500).json({ error: 'Internal Server Error', message: 'Permission check failed' });
    return null;
  }

  if (pmRow && pmRow[column] === true) {
    return { user, role, permissions: pmRow, isPM: true };
  }

  // --- 6. Not authorized ---
  res.status(403).json({ error: 'Forbidden', message: 'Insufficient payment permissions' });
  return null;
}

/**
 * Insert a row into payment_audit_logs.
 * Never throws — errors are logged to console only.
 *
 * @param {object} supabaseAdmin  - Service-role Supabase client
 * @param {string} actorUserId    - UUID of the user performing the action
 * @param {string} action         - Human-readable action name (e.g. 'mark_paid')
 * @param {string} entityType     - Table / resource type (e.g. 'payout_batch')
 * @param {string} entityId       - UUID of the affected row
 * @param {object} [metadata]     - Any extra key/value context
 */
async function logPaymentAction(supabaseAdmin, actorUserId, action, entityType, entityId, metadata) {
  try {
    const { error } = await supabaseAdmin
      .from('payment_audit_logs')
      .insert({
        actor_user_id: actorUserId,
        action,
        entity_type: entityType,
        entity_id: entityId,
        metadata: metadata || null,
        created_at: new Date().toISOString(),
      });

    if (error) {
      console.error('[paymentPermissions] logPaymentAction insert error:', error.message);
    }
  } catch (err) {
    console.error('[paymentPermissions] logPaymentAction unexpected error:', err.message);
  }
}

module.exports = {
  requirePaymentPermission,
  logPaymentAction,
};
