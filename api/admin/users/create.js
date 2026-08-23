// api/admin/users/create.js
//
// POST /api/admin/users/create
// Body: { email, fullName?, role, sendInvite? }
//
// Scope §6.1 — the "create" verb the owner was granted and never had. Until
// now the only way into the portal was self-registration followed by approval,
// which means an owner could not onboard anyone directly.
//
// Two modes:
//   sendInvite: true  (default) — Supabase emails an invitation link. The user
//                                 sets their own password. No password ever
//                                 passes through this codebase.
//   sendInvite: false           — creates a confirmed account with a random
//                                 password nobody is told, for the case where
//                                 the owner will trigger a reset separately.
//
// The role is applied to user_profiles AFTER creation, because the
// handle_new_user trigger deliberately forces every new row to 'pending'
// (20260822000006). That is correct for self-signup and wrong for an
// owner-created account, so this route overrides it explicitly and the
// override is what the audit trigger records.
//
// Auth: owner only.

const { applyCors } = require('../../_utils/cors');
const { Errors, sendOk } = require('../../_utils/errors');
const { getSupabaseAdminClient } = require('../../_utils/supabaseAdmin');
const { applyRateLimit } = require('../../_utils/rateLimit');
const { requireOwner, parseBody } = require('../../_lib/adminGuard');

// Roles an owner may hand out at creation time. 'pending' is allowed so an
// owner can pre-create an account and decide the role later. 'denied' is not:
// creating an account in order to refuse it is not a workflow.
const ASSIGNABLE_ROLES = ['pending', 'creator', 'am', 'account_manager', 'client', 'owner'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  // Account creation is a privileged, outward-facing action (it sends mail).
  const blocked = await applyRateLimit(req, res, {
    max: 20,
    windowSecs: 3600,
    endpoint: 'admin-users-create',
  });
  if (blocked) return;

  const authCtx = await requireOwner(req, res);
  if (!authCtx) return;

  const { user: actor } = authCtx;
  const supabase = getSupabaseAdminClient();

  const body = parseBody(req);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  const role = typeof body.role === 'string' ? body.role.trim() : 'pending';
  const sendInvite = body.sendInvite !== false;

  if (!email || !EMAIL_RE.test(email)) {
    return Errors.badRequest(res, 'A valid email address is required');
  }
  if (!ASSIGNABLE_ROLES.includes(role)) {
    return Errors.badRequest(
      res,
      `role must be one of: ${ASSIGNABLE_ROLES.join(', ')}`
    );
  }

  try {
    // Refuse early if the address is already in use, so the caller gets a clear
    // message instead of a generic auth error.
    const { data: existing } = await supabase
      .from('user_profiles')
      .select('id, email, role, status')
      .eq('email', email)
      .maybeSingle();

    if (existing) {
      return Errors.badRequest(
        res,
        `${email} already has an account (role: ${existing.role}, status: ${existing.status}). ` +
        'Change their role or restore them instead of creating a second account.'
      );
    }

    // --- 1. Create the auth user -------------------------------------------
    let authUser;

    if (sendInvite) {
      const redirectTo = `${(process.env.APP_BASE_URL || '').replace(/\/$/, '')}/`;
      const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
        data: { full_name: fullName || null, requested_role: role },
        ...(redirectTo && redirectTo !== '/' ? { redirectTo } : {}),
      });
      if (error) {
        console.error('[admin/users/create] invite failed:', error.message);
        return Errors.badRequest(res, `Could not invite ${email}: ${error.message}`);
      }
      authUser = data?.user;
    } else {
      const { randomBytes } = require('crypto');
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        // Never returned, never logged. The owner is expected to send a reset.
        password: randomBytes(24).toString('base64url'),
        email_confirm: true,
        user_metadata: { full_name: fullName || null, requested_role: role },
      });
      if (error) {
        console.error('[admin/users/create] createUser failed:', error.message);
        return Errors.badRequest(res, `Could not create ${email}: ${error.message}`);
      }
      authUser = data?.user;
    }

    if (!authUser?.id) {
      return Errors.internal(res, 'The account was not created; no user id was returned.');
    }

    // --- 2. Apply the role --------------------------------------------------
    // handle_new_user() forces 'pending'. Overriding it here is the whole point
    // of an owner-created account. role_changed_by is what lets the audit
    // trigger attribute this to the owner rather than to the service role.
    const profilePatch = {
      id: authUser.id,
      email,
      full_name: fullName || email.split('@')[0],
      role,
      status: 'active',
      role_changed_by: actor.id,
      role_changed_at: new Date().toISOString(),
    };

    const { error: profileErr } = await supabase
      .from('user_profiles')
      .upsert(profilePatch, { onConflict: 'id' });

    if (profileErr) {
      console.error('[admin/users/create] profile upsert failed:', profileErr.message);
      return Errors.internal(
        res,
        `The account was created but its role could not be set: ${profileErr.message}. ` +
        'Set it from the user directory.'
      );
    }

    // --- 3. Provision the domain record the role implies --------------------
    // Without this a new creator has no creators row, so submissions, earnings
    // and social connections all have nothing to hang off.
    const displayName = fullName || email.split('@')[0];

    if (role === 'creator') {
      const { error } = await supabase
        .from('creators')
        .upsert({ user_id: authUser.id, email, name: displayName, status: 'Active' },
                { onConflict: 'email' });
      if (error) console.warn('[admin/users/create] creator provisioning:', error.message);
    } else if (role === 'am' || role === 'account_manager') {
      const { error } = await supabase
        .from('account_managers')
        .upsert({ user_id: authUser.id, email, name: displayName, status: 'Active' },
                { onConflict: 'email' });
      if (error) console.warn('[admin/users/create] manager provisioning:', error.message);
    }

    return sendOk(res, {
      success: true,
      userId: authUser.id,
      email,
      role,
      invited: sendInvite,
      message: sendInvite
        ? `Invitation sent to ${email}.`
        : `Account created for ${email}. Send them a password reset to let them in.`,
    });
  } catch (err) {
    console.error('[admin/users/create] Unexpected error:', err.message);
    return Errors.internal(res, err.message);
  }
};
