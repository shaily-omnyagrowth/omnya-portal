// api/admin/users/index.js
//
// GET /api/admin/users
//
// The owner's user directory: every profile with its role, lifecycle status
// and the linked creator / account-manager record where one exists.
//
// Scope §6.1 — "Create, view, edit, deactivate/delete and restore users".
// This is the "view" half; the other verbs live alongside it in this folder.
//
// Auth: owner only.

const { applyCors } = require('../../_utils/cors');
const { Errors, sendOk } = require('../../_utils/errors');
const { getSupabaseAdminClient } = require('../../_utils/supabaseAdmin');
const { applyRateLimit } = require('../../_utils/rateLimit');
const { requireOwner } = require('../../_lib/adminGuard');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') return Errors.methodNotAllowed(res);

  const blocked = await applyRateLimit(req, res, {
    max: 60,
    windowSecs: 60,
    endpoint: 'admin-users-list',
  });
  if (blocked) return;

  const authCtx = await requireOwner(req, res);
  if (!authCtx) return;

  const supabase = getSupabaseAdminClient();

  try {
    const { data: profiles, error } = await supabase
      .from('user_profiles')
      .select(
        'id, email, full_name, role, requested_role, status, created_at, ' +
        'deactivated_at, deactivation_reason, role_before_deactivation, role_changed_at'
      )
      .order('created_at', { ascending: false });

    if (error) throw error;

    const ids = (profiles || []).map((p) => p.id);

    // Resolve the domain record each profile maps to, so the directory can say
    // "creator, Active" rather than only "creator". Two small queries beat one
    // per row.
    const [{ data: creators }, { data: managers }] = await Promise.all([
      supabase.from('creators').select('id, user_id, name, status').in('user_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']),
      supabase.from('account_managers').select('id, user_id, name, status').in('user_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']),
    ]);

    const creatorByUser = new Map((creators || []).map((c) => [c.user_id, c]));
    const managerByUser = new Map((managers || []).map((m) => [m.user_id, m]));

    const users = (profiles || []).map((p) => ({
      ...p,
      linked_creator: creatorByUser.get(p.id) || null,
      linked_manager: managerByUser.get(p.id) || null,
    }));

    const activeOwners = users.filter(
      (u) => ['owner', 'admin'].includes(u.role) && u.status === 'active'
    ).length;

    return sendOk(res, {
      users,
      counts: {
        total: users.length,
        active: users.filter((u) => u.status === 'active').length,
        deactivated: users.filter((u) => u.status === 'deactivated').length,
        pending: users.filter((u) => u.role === 'pending').length,
        activeOwners,
      },
    });
  } catch (err) {
    console.error('[admin/users] Error:', err.message);
    return Errors.internal(res, err.message);
  }
};
