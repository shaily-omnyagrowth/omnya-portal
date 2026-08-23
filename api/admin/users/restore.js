// api/admin/users/restore.js
//
// POST /api/admin/users/restore
// Body: { userId, role? }
//
// Scope §6.1 — "…deactivate/delete and restore users". Restore is the verb
// that settles what "delete" was ever allowed to mean here: you cannot restore
// a hard-deleted row, so deletion in this portal has always been the
// reversible kind. This is the other half of deactivate.js.
//
// The role comes back from role_before_deactivation, so a suspended account
// manager returns as an account manager rather than as whatever the caller
// happens to pass. An explicit `role` overrides that when the owner wants to
// restore someone into a different seat.
//
// Auth: owner only.

const { applyCors } = require('../../_utils/cors');
const { Errors, sendOk } = require('../../_utils/errors');
const { getSupabaseAdminClient } = require('../../_utils/supabaseAdmin');
const { applyRateLimit } = require('../../_utils/rateLimit');
const { requireOwner, loadTargetProfile, parseBody } = require('../../_lib/adminGuard');

const ASSIGNABLE_ROLES = [
  'pending', 'creator', 'am', 'account_manager', 'client', 'owner',
];

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  const blocked = await applyRateLimit(req, res, {
    max: 30,
    windowSecs: 3600,
    endpoint: 'admin-users-restore',
  });
  if (blocked) return;

  const authCtx = await requireOwner(req, res);
  if (!authCtx) return;

  const { user: actor } = authCtx;
  const supabase = getSupabaseAdminClient();

  const body = parseBody(req);
  const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
  const overrideRole = typeof body.role === 'string' ? body.role.trim() : null;

  if (overrideRole && !ASSIGNABLE_ROLES.includes(overrideRole)) {
    return Errors.badRequest(res, `role must be one of: ${ASSIGNABLE_ROLES.join(', ')}`);
  }

  try {
    const target = await loadTargetProfile(supabase, res, userId);
    if (!target) return;

    if (target.status !== 'deactivated') {
      return sendOk(res, {
        success: true,
        unchanged: true,
        message: `${target.email} is already active.`,
      });
    }

    // Fall back through: explicit override, then what they were before, then
    // 'pending' so a restored account with no history needs a deliberate role
    // decision rather than silently landing somewhere privileged.
    const restoredRole = overrideRole || target.role_before_deactivation || 'pending';

    const patch = {
      status: 'active',
      role: restoredRole,
      deactivated_at: null,
      deactivated_by: null,
      deactivation_reason: null,
      role_before_deactivation: null,
    };

    // Only stamp the role-change actor when the role actually moves, so the
    // audit does not show a role_changed entry for an unchanged role.
    if (restoredRole !== target.role) {
      patch.role_changed_by = actor.id;
      patch.role_changed_at = new Date().toISOString();
    }

    const { data: updated, error } = await supabase
      .from('user_profiles')
      .update(patch)
      .eq('id', userId)
      .select('id, email, full_name, role')
      .maybeSingle();

    if (error) throw error;
    if (!updated) return Errors.notFound(res, 'User not found');

    const displayName = updated.full_name || updated.email.split('@')[0];

    // Bring the domain record back with them.
    if (restoredRole === 'creator') {
      await supabase.from('creators').upsert(
        { user_id: userId, email: updated.email, name: displayName, status: 'Active' },
        { onConflict: 'email' }
      );
    } else if (restoredRole === 'am' || restoredRole === 'account_manager') {
      await supabase.from('account_managers').upsert(
        {
          user_id: userId, email: updated.email, name: displayName,
          status: 'Active', archived_at: null, archived_by: null, archive_reason: null,
        },
        { onConflict: 'email' }
      );
    }

    return sendOk(res, {
      success: true,
      userId,
      email: updated.email,
      role: restoredRole,
      message: `${updated.email} is active again as ${restoredRole}.`,
    });
  } catch (err) {
    console.error('[admin/users/restore] Error:', err.message);
    return Errors.internal(res, err.message);
  }
};
