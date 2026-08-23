// api/_lib/adminGuard.js
//
// Shared guards for the owner-only administration routes in api/admin/*.
//
// These routes change who can log in and what they may do, so three rules are
// enforced in one place rather than repeated (and eventually forgotten) per
// route:
//
//   1. Only an owner may call them.
//   2. An owner may never act on their own account. Every lockout starts with
//      somebody demoting or suspending themselves "just to test it".
//   3. The last active owner may never be demoted or deactivated. Otherwise
//      two owners can lock each other out and nobody can undo it, because the
//      only role that can restore an owner is owner.
//
// Rule 3 is checked against the database at call time rather than trusting a
// count the caller passes in.

const { requireRole } = require('../_utils/auth');
const { Errors } = require('../_utils/errors');

const OWNER_ROLES = ['owner', 'admin'];

/**
 * Owner-only guard. Returns { user, profile } or null (response already sent).
 */
async function requireOwner(req, res) {
  return requireRole(req, res, ['owner']);
}

/**
 * Load the target user's profile, or send 404.
 * Returns the profile row or null.
 */
async function loadTargetProfile(supabase, res, userId) {
  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    Errors.badRequest(res, 'userId is required and must be a non-empty string');
    return null;
  }

  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, email, full_name, role, status, role_before_deactivation')
    .eq('id', userId.trim())
    .maybeSingle();

  if (error) {
    Errors.internal(res, error.message);
    return null;
  }
  if (!data) {
    Errors.notFound(res, 'User not found');
    return null;
  }
  return data;
}

/**
 * Rule 2 — refuse self-targeting. Returns true when the response has been sent.
 */
function refuseSelfTarget(res, actorId, targetId, action) {
  if (actorId === targetId) {
    Errors.badRequest(
      res,
      `You cannot ${action} your own account. Ask another owner to do it.`
    );
    return true;
  }
  return false;
}

/**
 * Rule 3 — refuse removing the last active owner.
 * Returns true when the response has been sent.
 */
async function refuseLastOwnerRemoval(supabase, res, targetProfile, action) {
  if (!OWNER_ROLES.includes(targetProfile.role)) return false;

  const { count, error } = await supabase
    .from('user_profiles')
    .select('id', { count: 'exact', head: true })
    .in('role', OWNER_ROLES)
    .eq('status', 'active');

  if (error) {
    // Fail closed: if we cannot prove another owner exists, do not proceed.
    Errors.internal(
      res,
      'Could not verify how many active owners remain, so the change was not applied.'
    );
    return true;
  }

  if ((count ?? 0) <= 1) {
    Errors.badRequest(
      res,
      `This is the only active owner. Promote another owner before you ${action} this one.`
    );
    return true;
  }

  return false;
}

function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  return body || {};
}

module.exports = {
  OWNER_ROLES,
  requireOwner,
  loadTargetProfile,
  refuseSelfTarget,
  refuseLastOwnerRemoval,
  parseBody,
};
