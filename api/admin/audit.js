// api/admin/audit.js
//
// GET /api/admin/audit?limit=&before=&entityType=&action=&actorId=
//
// Scope §5.2 — "View audit history: Owner Yes". The events existed; nothing
// ever displayed them.
//
// Merges the two journals into one feed, because they are one history split by
// subject matter rather than two different things:
//
//   admin_audit_logs    role changes, deactivation, restoration, archiving,
//                       content review decisions, payment voids   (§5.1)
//   payment_audit_logs  withdrawal approve/reject, batch creation,
//                       mark-paid, exports, manager grants        (money path)
//
// Both are append-only, so paging by timestamp is stable — a row can never
// move between pages.
//
// Auth: owner. Narrower roles read the tables directly through RLS, which
// already scopes them per §5.2; this route is the owner's full view.

const { applyCors } = require('../_utils/cors');
const { Errors, sendOk } = require('../_utils/errors');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const { applyRateLimit } = require('../_utils/rateLimit');
const { requireOwner } = require('../_lib/adminGuard');

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

// Human sentences beat raw column diffs in a history view. Anything not listed
// falls back to the action slug, so a new action type still renders.
function describe(row) {
  const who = row.actor_label || 'Someone';
  const what = row.entity_label || row.entity_type;

  switch (row.action) {
    case 'role_changed':
      return `${who} changed ${what}'s role from ${row.from_value} to ${row.to_value}`;
    case 'user_deactivated':
      return `${who} deactivated ${what}`;
    case 'user_restored':
      return `${who} restored ${what}`;
    case 'campaign_archived':
      return `${who} archived the campaign ${what}`;
    case 'campaign_restored':
      return `${who} restored the campaign ${what}`;
    case 'client_archived':
      return `${who} archived the client ${what}`;
    case 'client_restored':
      return `${who} restored the client ${what}`;
    case 'account_manager_archived':
      return `${who} archived the account manager ${what}`;
    case 'account_manager_restored':
      return `${who} restored the account manager ${what}`;
    case 'concept_review':
      return `${who} set a concept to ${row.to_value}`;
    case 'final_review':
      return `${who} set a final to ${row.to_value}`;
    case 'payment_voided':
      return `${who} voided a payment`;
    case 'approve_withdrawal':
      return `${who} approved a withdrawal`;
    case 'reject_withdrawal':
      return `${who} rejected a withdrawal`;
    case 'withdrawal_requested':
      return `${who} requested a withdrawal`;
    case 'batch_created':
      return `${who} created a payout batch`;
    case 'batch_marked_paid':
      return `${who} marked a payout batch paid`;
    case 'export_batch':
      return `${who} exported a payout batch`;
    case 'payment_manager_granted':
      return `${who} granted payment manager access`;
    case 'payment_manager_revoked':
      return `${who} revoked payment manager access`;
    default:
      return `${who}: ${row.action.replace(/_/g, ' ')}`;
  }
}

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') return Errors.methodNotAllowed(res);

  const blocked = await applyRateLimit(req, res, {
    max: 60,
    windowSecs: 60,
    endpoint: 'admin-audit',
  });
  if (blocked) return;

  const authCtx = await requireOwner(req, res);
  if (!authCtx) return;

  const supabase = getSupabaseAdminClient();

  const q = req.query || {};
  const limit = Math.min(
    Math.max(parseInt(q.limit, 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT
  );
  const before = typeof q.before === 'string' && q.before ? q.before : null;
  const entityType = typeof q.entityType === 'string' && q.entityType ? q.entityType : null;
  const action = typeof q.action === 'string' && q.action ? q.action : null;
  const actorId = typeof q.actorId === 'string' && q.actorId ? q.actorId : null;

  try {
    // Over-fetch from each side: after merging and trimming to `limit`, the
    // cut has to be correct even when one journal supplied every row.
    const fetchSize = limit + 1;

    let adminQ = supabase
      .from('admin_audit_logs')
      .select('id, occurred_at, actor_user_id, actor_role, action, entity_type, entity_id, entity_label, from_value, to_value, reason, metadata')
      .order('occurred_at', { ascending: false })
      .limit(fetchSize);

    let payQ = supabase
      .from('payment_audit_logs')
      .select('id, created_at, actor_user_id, action, entity_type, entity_id, metadata')
      .order('created_at', { ascending: false })
      .limit(fetchSize);

    if (before) {
      adminQ = adminQ.lt('occurred_at', before);
      payQ = payQ.lt('created_at', before);
    }
    if (entityType) {
      adminQ = adminQ.eq('entity_type', entityType);
      payQ = payQ.eq('entity_type', entityType);
    }
    if (action) {
      adminQ = adminQ.eq('action', action);
      payQ = payQ.eq('action', action);
    }
    if (actorId) {
      adminQ = adminQ.eq('actor_user_id', actorId);
      payQ = payQ.eq('actor_user_id', actorId);
    }

    const [adminRes, payRes] = await Promise.all([adminQ, payQ]);

    if (adminRes.error) throw adminRes.error;
    // payment_audit_logs predates this feature and may not exist on a database
    // that stopped short of the payout migrations. Missing is not fatal here.
    if (payRes.error) {
      console.warn('[admin/audit] payment_audit_logs unavailable:', payRes.error.message);
    }

    const merged = [
      ...(adminRes.data || []).map((r) => ({ ...r, source: 'admin' })),
      ...(payRes.data || []).map((r) => ({
        id: r.id,
        occurred_at: r.created_at,
        actor_user_id: r.actor_user_id,
        actor_role: null,
        action: r.action,
        entity_type: r.entity_type,
        entity_id: r.entity_id,
        entity_label: null,
        from_value: null,
        to_value: null,
        reason: r.metadata?.reason ?? null,
        metadata: r.metadata || {},
        source: 'payment',
      })),
    ].sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));

    const page = merged.slice(0, limit);
    const hasMore = merged.length > limit;

    // Resolve actor ids to something a person recognises, in one query.
    const actorIds = [...new Set(page.map((r) => r.actor_user_id).filter(Boolean))];
    let actorById = new Map();
    if (actorIds.length) {
      const { data: actors } = await supabase
        .from('user_profiles')
        .select('id, email, full_name, role')
        .in('id', actorIds);
      actorById = new Map((actors || []).map((a) => [a.id, a]));
    }

    const events = page.map((r) => {
      const actor = actorById.get(r.actor_user_id);
      const actorLabel = actor
        ? (actor.full_name || actor.email)
        : (r.actor_user_id ? 'Removed user' : 'System');
      const withActor = { ...r, actor_label: actorLabel };
      return {
        ...withActor,
        actor_email: actor?.email || null,
        actor_role: r.actor_role || actor?.role || null,
        summary: describe(withActor),
      };
    });

    return sendOk(res, {
      events,
      hasMore,
      // Feed this back as ?before= to page. Safe because both journals are
      // append-only, so nothing shifts between requests.
      nextBefore: hasMore && page.length ? page[page.length - 1].occurred_at : null,
    });
  } catch (err) {
    console.error('[admin/audit] Error:', err.message);
    return Errors.internal(res, err.message);
  }
};
