// api/campaigns/manage-share.js
//
// POST /api/campaigns/manage-share
// Body: { campaignId: uuid, action: 'toggle' | 'regenerate', enabled?: boolean }
//
// Authenticated endpoint for AMs and Owners to control campaign share links.

const { applyCors } = require('../_utils/cors');
const { requireRole, normalizeRole } = require('../_utils/auth');
const { Errors, sendOk } = require('../_utils/errors');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const crypto = require('crypto');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  const ctx = await requireRole(req, res, ['owner', 'admin', 'am', 'account_manager']);
  if (!ctx) return;

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const { campaignId, action, enabled } = body || {};
  if (!campaignId) {
    return Errors.badRequest(res, 'campaignId is required.');
  }

  const supabase = getSupabaseAdminClient();
  const { user, profile } = ctx;
  const role = normalizeRole(profile.role);

  // If role is AM, ensure the campaign's client is assigned to this AM
  if (role === 'am') {
    const { data: amRow } = await supabase
      .from('account_managers')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!amRow) {
      return Errors.forbidden(res, 'Account manager record not found.');
    }

    const { data: camp } = await supabase
      .from('campaigns')
      .select('id, client_id, clients(am_id)')
      .eq('id', campaignId)
      .maybeSingle();

    if (!camp || (camp.clients && camp.clients.am_id !== amRow.id)) {
      return Errors.forbidden(res, 'You do not manage the client for this campaign.');
    }
  }

  const updateFields = {};

  if (action === 'toggle') {
    if (typeof enabled === 'boolean') {
      updateFields.share_enabled = enabled;
    } else {
      // Toggle current value
      const { data: current } = await supabase
        .from('campaigns')
        .select('share_enabled, share_token')
        .eq('id', campaignId)
        .single();
      
      updateFields.share_enabled = !current?.share_enabled;
      if (!current?.share_token) {
        updateFields.share_token = crypto.randomUUID();
        updateFields.share_created_at = new Date().toISOString();
      }
    }
  } else if (action === 'regenerate') {
    updateFields.share_token = crypto.randomUUID();
    updateFields.share_created_at = new Date().toISOString();
    updateFields.share_enabled = true;
  } else {
    return Errors.badRequest(res, 'Invalid action. Supported: toggle, regenerate');
  }

  const { data: updated, error: uErr } = await supabase
    .from('campaigns')
    .update(updateFields)
    .eq('id', campaignId)
    .select('id, share_token, share_enabled, share_created_at')
    .single();

  if (uErr) {
    console.error('Failed to update campaign share settings:', uErr.message);
    return Errors.internal(res, 'Failed to update share settings.');
  }

  sendOk(res, updated);
};
