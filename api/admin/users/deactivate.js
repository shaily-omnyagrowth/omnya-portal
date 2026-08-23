// api/admin/users/deactivate.js
//
// POST /api/admin/users/deactivate
// Body: { userId, reason }
//
// Scope §6.1 — the "deactivate" verb. §11.1 says soft deletion or inactive
// states apply where historical records must remain referentially intact, and
// a user is the clearest case of that: their submissions, earnings, approvals
// and audit entries all point at them.
//
// What deactivation does:
//   * user_profiles.status  -> 'deactivated'
//   * the role is preserved in role_before_deactivation so restore is exact
//   * current_user_role() then returns 'deactivated' for them, which every RLS
//     policy in the schema consults — so access stops at the database, not
//     merely in the navigation
//   * the linked creator / account-manager record is marked inactive too
//
// What it does not do: delete anything. Erasure waits on the retention policy
// that Appendix C still lists as an open decision.
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

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  const blocked = await applyRateLimit(req, res, {
    max: 30,
    windowSecs: 3600,
    endpoint: 'admin-users-deactivate',
  });
  if (blocked) return;

  const authCtx = await requireOwner(req, res);
  if (!authCtx) return;

  const { user: actor } = authCtx;
  const supabase = getSupabaseAdminClient();

  const body = parseBody(req);
  const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

  // §5.1 puts deactivation among the actions that generate audit events, and
  // an audit entry with no reason is barely an audit entry.
  if (!reason) {
    return Errors.badRequest(res, 'A reason is required so the audit entry means something.');
  }

  if (refuseSelfTarget(res, actor.id, userId, 'deactivate')) return;

  try {
    const target = await loadTargetProfile(supabase, res, userId);
    if (!target) return;

    if (target.status === 'deactivated') {
      return sendOk(res, {
        success: true,
        unchanged: true,
        message: `${target.email} is already deactivated.`,
      });
    }

    if (await refuseLastOwnerRemoval(supabase, res, target, 'deactivate')) return;

    // deactivated_by is what the audit trigger reads for the actor, because
    // auth.uid() is NULL on a service-role connection.
    const { data: updated, error } = await supabase
      .from('user_profiles')
      .update({
        status: 'deactivated',
        role_before_deactivation: target.role,
        deactivated_at: new Date().toISOString(),
        deactivated_by: actor.id,
        deactivation_reason: reason,
      })
      .eq('id', userId)
      .select('id, email, role')
      .maybeSingle();

    if (error) throw error;
    if (!updated) return Errors.notFound(res, 'User not found');

    // Mirror onto the domain record so lists that filter on status agree.
    const mirrors = [];
    mirrors.push(
      supabase.from('creators').update({ status: 'Offboarded' }).eq('user_id', userId)
    );
    mirrors.push(
      supabase.from('account_managers').update({
        status: 'Archived',
        archived_at: new Date().toISOString(),
        archived_by: actor.id,
        archive_reason: reason,
      }).eq('user_id', userId)
    );
    const results = await Promise.allSettled(mirrors);
    results.forEach((r) => {
      if (r.status === 'fulfilled' && r.value?.error) {
        console.warn('[admin/users/deactivate] mirror:', r.value.error.message);
      }
    });

    // Existing sessions survive until their JWT expires, so revoke them.
    // Without this a suspended user keeps working until their token rolls over.
    try {
      await supabase.auth.admin.signOut(userId, 'global');
    } catch (signOutErr) {
      console.warn('[admin/users/deactivate] session revoke failed:', signOutErr.message);
    }

    return sendOk(res, {
      success: true,
      userId,
      email: updated.email,
      previousRole: target.role,
      message: `${updated.email} is deactivated. Their records are kept and they can be restored.`,
    });
  } catch (err) {
    console.error('[admin/users/deactivate] Error:', err.message);
    return Errors.internal(res, err.message);
  }
};
