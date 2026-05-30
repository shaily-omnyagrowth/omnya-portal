// api/stripe/connect-url.js
//
// POST /api/stripe/connect-url
//
// Creates (or reuses) a Stripe Connect Express account for the calling creator
// and returns a one-time onboarding URL.
//
// Auth  : Creator only — for their own account.
//         Owner/PM may pass creatorId in body to generate a link for any creator.
// Body  : { creatorId? }           — optional for owner/PM override
// Return: { url, accountId, alreadyActive }

const { requireAuth }          = require('../_utils/auth');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const { Errors }               = require('../_utils/errors');
const { getStripe }            = require('../_lib/stripeClient');
const { applyRateLimit }       = require('../_utils/rateLimit');

const APP_URL = process.env.NEXT_PUBLIC_APP_URL
  || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const blocked = await applyRateLimit(req, res, { max: 10, windowSecs: 60, endpoint: 'stripe-connect-url' });
  if (blocked) return;

  const user = await requireAuth(req, res);
  if (!user) return;

  const supabase = getSupabaseAdminClient();
  const stripe   = getStripe();

  // Resolve which creator to connect
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  const role = profile?.role || '';
  const isAdmin = role === 'owner' || role === 'admin';

  let creatorId = req.body?.creatorId || null;

  if (!isAdmin) {
    // Creator: resolve their own creator row
    const { data: creatorRow } = await supabase
      .from('creators')
      .select('id')
      .eq('user_id', user.id)
      .single();
    if (!creatorRow) return Errors.notFound(res, 'Creator profile not found');
    creatorId = creatorRow.id;
  }

  if (!creatorId) return Errors.badRequest(res, 'creatorId is required');

  // Fetch creator record
  const { data: creator, error: creatorErr } = await supabase
    .from('creators')
    .select('id, name, email, stripe_account_id, stripe_account_status, stripe_charges_enabled, stripe_payouts_enabled')
    .eq('id', creatorId)
    .single();

  if (creatorErr || !creator) return Errors.notFound(res, 'Creator not found');

  // If already fully active, return early
  if (creator.stripe_account_status === 'active' && creator.stripe_charges_enabled && creator.stripe_payouts_enabled) {
    return res.status(200).json({
      alreadyActive: true,
      accountId: creator.stripe_account_id,
      url: null,
      message: 'Stripe account is already active and ready for payouts.',
    });
  }

  let accountId = creator.stripe_account_id;

  // Create Stripe Express account if one doesn't exist
  if (!accountId) {
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'US',
      email: creator.email || undefined,
      capabilities: {
        transfers: { requested: true },
      },
      settings: {
        payouts: {
          schedule: { interval: 'manual' }, // platform controls when funds are sent
        },
      },
      metadata: {
        creator_id: creatorId,
        platform: 'omnya',
      },
    });

    accountId = account.id;

    await supabase
      .from('creators')
      .update({
        stripe_account_id: accountId,
        stripe_account_status: 'onboarding',
      })
      .eq('id', creatorId);
  }

  // Generate a fresh onboarding link (they expire after a few minutes)
  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${APP_URL}/?page=earnings&stripe_refresh=true`,
    return_url:  `${APP_URL}/?page=earnings&stripe_connected=true`,
    type: 'account_onboarding',
    collect: 'eventually_due',
  });

  // Mark as onboarding
  await supabase
    .from('creators')
    .update({ stripe_account_status: 'onboarding', stripe_onboarding_url: accountLink.url })
    .eq('id', creatorId);

  return res.status(200).json({
    alreadyActive: false,
    accountId,
    url: accountLink.url,
  });
};
