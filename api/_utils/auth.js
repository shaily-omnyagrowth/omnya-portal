// api/_utils/auth.js
//
// JWT + role authorization helpers for serverless API routes.
//
//   getBearerToken(req)              -> string | null
//   getUserFromRequest(req)          -> { user, token } | null
//   requireAuth(req, res)            -> user | null (sends 401 on failure)
//   requireRole(req, res, allowed[]) -> { user, profile } | null (sends 401/403)
//   normalizeRole(role)              -> 'owner'|'am'|'creator'|'pending'|'denied'

const { getSupabaseAdminClient } = require('./supabaseAdmin');
const { Errors } = require('./errors');

function normalizeRole(role) {
  if (!role) return null;
  if (role === 'account_manager') return 'am';
  return role;
}

function getBearerToken(req) {
  const header = req.headers && req.headers.authorization;
  if (!header || typeof header !== 'string') return null;
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

async function getUserFromRequest(req) {
  const token = getBearerToken(req);
  if (!token) return null;
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data || !data.user) return null;
  return { user: data.user, token };
}

async function requireAuth(req, res) {
  const ctx = await getUserFromRequest(req);
  if (!ctx) {
    Errors.unauthorized(res);
    return null;
  }
  return ctx.user;
}

async function requireRole(req, res, allowedRoles) {
  const user = await requireAuth(req, res);
  if (!user) return null; // requireAuth already responded

  const supabase = getSupabaseAdminClient();
  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select('id, email, role')
    .eq('id', user.id)
    .single();

  if (error || !profile) {
    Errors.forbidden(res, 'Profile not found');
    return null;
  }

  const role = normalizeRole(profile.role);
  const normalizedAllowed = (allowedRoles || []).map(normalizeRole);

  if (!normalizedAllowed.includes(role)) {
    Errors.forbidden(res, `Role '${role}' is not allowed for this action`);
    return null;
  }

  return { user, profile: { ...profile, role } };
}

module.exports = {
  normalizeRole,
  getBearerToken,
  getUserFromRequest,
  requireAuth,
  requireRole,
};
