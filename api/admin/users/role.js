// api/admin/users/role.js
//
// POST /api/admin/users/role
// Body: { userId, role, fullName? }
//
// Scope §6.1 / §5.2 — "Create/edit users and roles: Owner Yes".
//
// The portal could previously only assign a role to a user sitting in
// 'pending'. Once assigned it was permanent: there was no screen anywhere that
// changed the role of an existing user. This route is that missing verb, and
// it works at any point in the account's life.
//
// The audit entry is written by trg_audit_user_profile, not here, so a role
// change made any other way is recorded too.
//
// Auth: owner only.

const { applyCors } = require('../../_utils/cors');
const { Errors, sendOk } = require('../../_utils/errors');
const { getSupabaseAdminClient } = require('../../_utils/supabaseAdmin');
const { applyRateLimit } = require('../../_utils/rateLimit');
const {
  requireOwner,
  loadTargetProfile,
  refuseSelfTarget,
  refuseLastOwnerRemoval,
  parseBody,
} = require('../../_lib/adminGuard');

const ASSIGNABLE_ROLES = [
  'pending', 'creator', 'am', 'account_manager', 'client', 'owner', 'denied',
];

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  const blocked = await applyRateLimit(req, res, {
    max: 30,
    windowSecs: 3600,
    endpoint: 'admin-users-role',
  });
  if (blocked) return;

  const authCtx = await requireOwner(req, res);
  if (!authCtx) return;

  const { user: actor } = authCtx;
  const supabase = getSupabaseAdminClient();

  const body = parseBody(req);
  const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
  const role = typeof body.role === 'string' ? body.role.trim() : '';
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : null;

  if (!ASSIGNABLE_ROLES.includes(role)) {
    return Errors.badRequest(res, `role must be one of: ${ASSIGNABLE_ROLES.join(', ')}`);
  }

  // An owner changing their own role is how you lock yourself out.
  if (refuseSelfTarget(res, actor.id, userId, 'change the role on')) return;

  try {
    const target = await loadTargetProfile(supabase, res, userId);
    if (!target) return;

    if (target.role === role) {
      return sendOk(res, {
        success: true,
        unchanged: true,
        message: `${target.email} is already ${role}.`,
      });
    }

    // Demoting the last remaining owner leaves nobody who can undo it.
    if (!['owner', 'admin'].includes(role)) {
      if (await refuseLastOwnerRemoval(supabase, res, target, 'demote')) return;
    }

    if (target.status === 'deactivated') {
      return Errors.badRequest(
        res,
        `${target.email} is deactivated. Restore them first, then change the role.`
      );
    }

    const patch = {
      role,
      role_changed_by: actor.id,
      role_changed_at: new Date().toISOString(),
    };
    if (fullName) patch.full_name = fullName;

    const { data: updated, error } = await supabase
      .from('user_profiles')
      .update(patch)
      .eq('id', userId)
      .select('id, email, full_name, role')
      .maybeSingle();

    if (error) throw error;
    if (!updated) return Errors.notFound(res, 'User not found');

    // Keep the domain record in step. A user promoted to creator with no
    // creators row cannot submit anything; a user promoted to AM with no
    // account_managers row cannot be assigned creators.
    const displayName = updated.full_name || updated.email.split('@')[0];

    if (role === 'creator') {
      await supabase.from('creators').upsert(
        { user_id: userId, email: updated.email, name: displayName, status: 'Active' },
        { onConflict: 'email' }
      );
    } else if (role === 'am' || role === 'account_manager') {
      await supabase.from('account_managers').upsert(
        { user_id: userId, email: updated.email, name: displayName, status: 'Active' },
        { onConflict: 'email' }
      );
    }

    return sendOk(res, {
      success: true,
      userId,
      from: target.role,
      to: role,
      message: `${updated.email} is now ${role}.`,
    });
  } catch (err) {
    console.error('[admin/users/role] Error:', err.message);
    return Errors.internal(res, err.message);
  }
};
