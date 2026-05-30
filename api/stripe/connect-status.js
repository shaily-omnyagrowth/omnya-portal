// api/stripe/connect-status.js
//
// GET /api/stripe/connect-status
//
// Returns the Stripe Connect account status for the calling creator.
// Also syncs current capabilities from Stripe if the account exists.
//
// Auth  : Creator (own status) or Owner/admin (any creatorId via query param)
// Query : ?creatorId=UUID   — optional for owner/admin
// Return: { status, chargesEnabled, payoutsEnabled, detailsSubmitted, accountId }

const { requireAuth }          = require('../_utils/auth');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const { Errors }               = require('../_utils/errors');
const { getStripe }            = require('../_lib/stripeClient');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireAuth(req, res);
  if (!user) return;

  const supabase = getSupabaseAdminClient();

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  const role    = profile?.role || '';
  const isAdmin = role === 'owner' || role === 'admin';

  let creatorId = req.query?.creatorId || null;

  if (!isAdmin) {
    const { data: creatorRow } = await supabase
      .from('creators')
      .select('id')
      .eq('user_id', user.id)
      .single();
    if (!creatorRow) return Errors.notFound(res, 'Creator profile not found');
    creatorId = creatorRow.id;
  }

  if (!creatorId) return Errors.badRequest(res, 'creatorId required');

  const { data: creator } = await supabase
    .from('creators')
    .select('id, stripe_account_id, stripe_account_status, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted, stripe_connected_at')
    .eq('id', creatorId)
    .single();

  if (!creator) return Errors.notFound(res, 'Creator not found');

  // If no Stripe account yet, return quickly
  if (!creator.stripe_account_id) {
    return res.status(200).json({
      status: 'not_connected',
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      accountId: null,
    });
  }

  // Sync with Stripe to get current state
  try {
    const stripe  = getStripe();
    const account = await stripe.accounts.retrieve(creator.stripe_account_id);

    const chargesEnabled   = account.charges_enabled;
    const payoutsEnabled   = account.payouts_enabled;
    const detailsSubmitted = account.details_submitted;

    let newStatus = creator.stripe_account_status;
    if (account.requirements?.disabled_reason) {
      newStatus = 'disabled';
    } else if (chargesEnabled && payoutsEnabled) {
      newStatus = 'active';
    } else if (detailsSubmitted) {
      newStatus = 'pending';
    } else if (creator.stripe_account_status === 'onboarding') {
      newStatus = 'onboarding';
    }

    // Persist synced state
    await supabase
      .from('creators')
      .update({
        stripe_account_status:    newStatus,
        stripe_charges_enabled:   chargesEnabled,
        stripe_payouts_enabled:   payoutsEnabled,
        stripe_details_submitted: detailsSubmitted,
        stripe_connected_at: chargesEnabled && !creator.stripe_connected_at ? new Date().toISOString() : creator.stripe_connected_at,
      })
      .eq('id', creatorId);

    return res.status(200).json({
      status: newStatus,
      chargesEnabled,
      payoutsEnabled,
      detailsSubmitted,
      accountId: creator.stripe_account_id,
    });
  } catch (err) {
    // Stripe API unreachable — return cached state
    console.error('Stripe account retrieve failed:', err.message);
    return res.status(200).json({
      status: creator.stripe_account_status,
      chargesEnabled:   creator.stripe_charges_enabled,
      payoutsEnabled:   creator.stripe_payouts_enabled,
      detailsSubmitted: creator.stripe_details_submitted,
      accountId: creator.stripe_account_id,
      cached: true,
    });
  }
};
