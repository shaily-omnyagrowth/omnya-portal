// api/social/connections.js
//
// GET /api/social/connections
//   Headers: Authorization: Bearer <supabase-jwt>
//   Query:   ?userId=<uuid> (optional; only honored for owner/AM with scope)
//
// Returns the safe projection of creator_tokens (no access_token / refresh_token)
// for the calling user, or — for owner/AM with the right scope — for the
// requested user.
//
//   Response:
//   { ok: true, data: { connections: [ {
//       platform, status, platformUsername, platformUserId,
//       expiresAt, refreshExpiresAt, lastSyncedAt, lastError,
//       createdAt, updatedAt
//   } ] } }

const { applyCors } = require('../_utils/cors');
const { requireAuth, normalizeRole } = require('../_utils/auth');
const { Errors, sendOk } = require('../_utils/errors');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');

const PLATFORMS = ['tiktok', 'instagram', 'facebook', 'meta', 'youtube'];

function shapeRow(row) {
  if (!row) return null;
  return {
    platform: row.platform,
    status: row.status || 'disconnected',
    platformUserId: row.platform_user_id || null,
    platformUsername: row.platform_username || null,
    expiresAt: row.expires_at || null,
    refreshExpiresAt: row.refresh_expires_at || null,
    lastSyncedAt: row.last_synced_at || null,
    lastError: row.last_error || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

// For owner / AM viewing another user's connections, verify scope.
async function canViewUser({ viewer, targetUserId, supabase }) {
  if (viewer.role === 'owner') return true;
  if (viewer.role !== 'am') return false;

  // AM can view connections only for creators assigned to them.
  // creators.am_id -> account_managers.id; account_managers.user_id == viewer.id
  const { data, error } = await supabase
    .from('creators')
    .select('id, account_managers!inner(user_id)')
    .eq('user_id', targetUserId)
    .eq('account_managers.user_id', viewer.userId)
    .maybeSingle();
  return !error && !!data;
}

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') return Errors.methodNotAllowed(res);

  const user = await requireAuth(req, res);
  if (!user) return;

  const supabase = getSupabaseAdminClient();

  // Resolve viewer's role.
  const { data: viewerProfile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  const viewerRole = normalizeRole((viewerProfile && viewerProfile.role) || 'creator');

  // Determine which user_id's connections to return.
  const requestedUserId = (req.query && req.query.userId) || null;
  let targetUserId = user.id;

  if (requestedUserId && requestedUserId !== user.id) {
    const allowed = await canViewUser({
      viewer: { userId: user.id, role: viewerRole },
      targetUserId: requestedUserId,
      supabase,
    });
    if (!allowed) {
      return Errors.forbidden(res, 'Not authorized to view this user\'s connections');
    }
    targetUserId = requestedUserId;
  }

  try {
    const { data, error } = await supabase
      .from('creator_tokens')
      .select(
        'platform, status, platform_user_id, platform_username, expires_at, refresh_expires_at, last_synced_at, last_error, created_at, updated_at'
      )
      .eq('user_id', targetUserId);

    if (error) {
      console.error('[social/connections] select failed:', error.message);
      return Errors.internal(res, 'Failed to load connections');
    }

    const byPlatform = new Map((data || []).map((r) => [r.platform, r]));
    // Return one entry per known platform, with status='disconnected' for missing.
    const connections = PLATFORMS.map((p) =>
      shapeRow(byPlatform.get(p) || { platform: p, status: 'disconnected' })
    );

    return sendOk(res, { connections, viewedUserId: targetUserId });
  } catch (err) {
    console.error('[social/connections] unexpected error:', err && err.message);
    return Errors.internal(res, 'Internal server error');
  }
};
