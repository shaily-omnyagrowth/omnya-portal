// api/withdrawals/index.js — Vercel serverless function
//
// GET /api/withdrawals
//
// Lists withdrawal requests with creator details.
//
// Auth / visibility rules:
//   creator        — sees only their own requests
//   am             — sees requests for creators assigned to them
//   owner / pm     — sees all requests
//
// Query params:
//   status       (string)  — filter by withdrawal status
//   creatorId    (string)  — filter by a specific creator ID
//   startDate    (string)  — ISO date; filters created_at >= startDate
//   endDate      (string)  — ISO date; filters created_at <= endDate
//   page         (number)  — page number, default 1
//   limit        (number)  — page size, default 20, max 100
//
// Response: { ok: true, data: { data, total, page, limit } }

const { applyCors } = require('../_utils/cors');
const { requireRole } = require('../_utils/auth');
const { Errors, sendOk } = require('../_utils/errors');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const { applyRateLimit } = require('../_utils/rateLimit');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') return Errors.methodNotAllowed(res);

  // Rate limit: 60 reads per minute per caller IP.
  const blocked = await applyRateLimit(req, res, {
    max: 60,
    windowSecs: 60,
    endpoint: 'withdrawals-list',
  });
  if (blocked) return;

  const authCtx = await requireRole(req, res, [
    'owner',
    'am',
    'account_manager',
    'creator',
    'payment_manager',
  ]);
  if (!authCtx) return;

  const { user, profile } = authCtx;
  const role = profile.role; // already normalized by requireRole
  const supabase = getSupabaseAdminClient();

  try {
    // --- Parse and validate query params ---
    const query = req.query || {};

    const rawPage  = parseInt(query.page,  10);
    const rawLimit = parseInt(query.limit, 10);

    const page  = rawPage  > 0  ? rawPage  : 1;
    const limit = rawLimit > 0  ? Math.min(rawLimit, 100) : 20;
    const from  = (page - 1) * limit;
    const to    = from + limit - 1;

    const { status, creatorId, startDate, endDate } = query;

    // --- Role-based access control ---
    //
    // creator:         resolve their creators row, then scope to that creator_id
    // am:              resolve all creator IDs assigned to them, optionally narrow by creatorId
    // owner / pm:      unrestricted; optionally narrow by creatorId param

    let scopedCreatorId = null;        // single creator_id restriction
    let amCreatorIds    = null;        // set of creator IDs for AM scope

    if (role === 'creator') {
      // Resolve the creators row that belongs to this authenticated user.
      const { data: creatorRow, error: creatorErr } = await supabase
        .from('creators')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (creatorErr) throw creatorErr;
      if (!creatorRow) {
        return Errors.notFound(res, 'Creator profile not found for this user');
      }

      scopedCreatorId = creatorRow.id;

    } else if (role === 'am') {
      // Fetch all creators assigned to this AM.
      const { data: assignedCreators, error: amErr } = await supabase
        .from('creators')
        .select('id')
        .eq('account_manager_id', user.id);

      if (amErr) throw amErr;

      const allIds = (assignedCreators || []).map((c) => c.id);

      if (allIds.length === 0) {
        // AM has no assigned creators — return empty result immediately.
        return sendOk(res, { data: [], total: 0, page, limit });
      }

      if (creatorId) {
        // Ensure the requested creatorId is actually assigned to this AM.
        if (!allIds.includes(creatorId)) {
          return Errors.forbidden(res, 'Creator is not assigned to this account manager');
        }
        scopedCreatorId = creatorId;
      } else {
        amCreatorIds = allIds;
      }

    } else {
      // owner or payment_manager — unrestricted, but honour the optional creatorId filter.
      if (creatorId) {
        scopedCreatorId = creatorId;
      }
    }

    // --- Build Supabase query ---
    //
    // Join creators for name, email, payment_method, and payment_method_status.
    let dbQuery = supabase
      .from('withdrawal_requests')
      .select(
        `id,
         creator_id,
         amount,
         method,
         status,
         notes,
         created_at,
         updated_at,
         creators (
           id,
           name,
           email,
           payment_method,
           payment_method_status
         )`,
        { count: 'exact' }
      );

    // --- Apply access-control filters ---
    if (scopedCreatorId) {
      dbQuery = dbQuery.eq('creator_id', scopedCreatorId);
    } else if (amCreatorIds) {
      dbQuery = dbQuery.in('creator_id', amCreatorIds);
    }

    // --- Apply optional query-param filters ---
    if (status) {
      dbQuery = dbQuery.eq('status', status);
    }

    if (startDate) {
      dbQuery = dbQuery.gte('created_at', startDate);
    }

    if (endDate) {
      // Include the full end day by appending end-of-day time if no time component given.
      const endValue = endDate.includes('T') ? endDate : `${endDate}T23:59:59.999Z`;
      dbQuery = dbQuery.lte('created_at', endValue);
    }

    // --- Paginate and sort ---
    dbQuery = dbQuery
      .order('created_at', { ascending: false })
      .range(from, to);

    const { data: rows, error: queryErr, count } = await dbQuery;

    if (queryErr) throw queryErr;

    return sendOk(res, {
      data:  rows  || [],
      total: count ?? 0,
      page,
      limit,
    });

  } catch (err) {
    console.error('[withdrawals/index] Error:', err.message);
    return Errors.internal(res, err.message);
  }
};
