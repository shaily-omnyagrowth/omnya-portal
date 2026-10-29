// api/social/connections.js
//
// GET /api/social/connections
//   Headers: Authorization: Bearer <supabase-jwt>
//   Query:   ?userId=<uuid> (optional; only honored for owner/AM with scope)
//
// The browser's only view of a creator's OAuth connections. It reads
// creator_social_accounts and projects a fixed, token-free column list — the
// browser must never see a token column, encrypted or not.
//
// F-3 guard: assertNoTokenColumns() runs over the projection on every request
// and throws if a token column ever appears in it. A 500 here is loud and
// obvious; a silently widened SELECT would not be.
//
//   Response:
//   { ok: true, data: { connections: [ {
//       platform, status, connectionStatus, needsReauth,
//       platformUserId, username, displayName, profileImageUrl, scopes,
//       expiresAt, refreshExpiresAt, lastSyncedAt, lastError,
//       createdAt, updatedAt
//   } ], viewedUserId } }

const { applyCors } = require('../_utils/cors');
const { requireAuth, normalizeRole } = require('../_utils/auth');
const { Errors, sendOk } = require('../_utils/errors');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const {
  PLATFORMS,
  SAFE_COLUMNS,
  assertNoTokenColumns,
  needsReauth,
} = require('../_utils/socialAccounts');

// The projection this endpoint sends to the browser. Deliberately narrower
// than SAFE_COLUMNS: metadata can carry provider detail the UI has no use for.
const PUBLIC_COLUMNS = [
  'platform',
  'platform_user_id',
  'username',
  'display_name',
  'profile_image_url',
  'connection_status',
  'scopes',
  'token_expires_at',
  'refresh_token_expires_at',
  'last_synced_at',
  'last_error',
  'created_at',
  'updated_at',
];

function shapeRow(row) {
  return {
    platform: row.platform,
    // `status` is kept for callers written against the creator_tokens shape.
    status: row.connection_status || 'disconnected',
    connectionStatus: row.connection_status || 'disconnected',
    needsReauth: needsReauth(row),
    platformUserId: row.platform_user_id || null,
    username: row.username || null,
    // The old shape called this platformUsername.
    platformUsername: row.username || row.display_name || null,
    displayName: row.display_name || null,
    profileImageUrl: row.profile_image_url || null,
    scopes: row.scopes || [],
    expiresAt: row.token_expires_at || null,
    refreshExpiresAt: row.refresh_token_expires_at || null,
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
    // The guard, on every request. PUBLIC_COLUMNS must stay a subset of the
    // token-free SAFE_COLUMNS, and must never name a token column itself.
    assertNoTokenColumns(PUBLIC_COLUMNS, 'social/connections PUBLIC_COLUMNS');
    const unknown = PUBLIC_COLUMNS.filter((c) => !SAFE_COLUMNS.includes(c));
    if (unknown.length) {
      throw new Error(
        `social/connections projects column(s) not in the safe set: ${unknown.join(', ')}`
      );
    }

    const { data, error } = await supabase
      .from('creator_social_accounts')
      .select(PUBLIC_COLUMNS.join(', '))
      .eq('user_id', targetUserId);

    if (error) {
      console.error('[social/connections] select failed:', error.message);
      return Errors.internal(res, 'Failed to load connections');
    }

    const byPlatform = new Map((data || []).map((r) => [r.platform, r]));
    // One entry per known platform, 'not_connected' for the ones with no row.
    const connections = PLATFORMS.map((p) =>
      shapeRow(byPlatform.get(p) || { platform: p, connection_status: 'not_connected' })
    );

    return sendOk(res, { connections, viewedUserId: targetUserId });
  } catch (err) {
    console.error('[social/connections] unexpected error:', err && err.message);
    return Errors.internal(res, 'Internal server error');
  }
};
