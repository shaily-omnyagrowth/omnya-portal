// api/payouts/stripe-transfer.js
//
// POST /api/payouts/stripe-transfer
//
// Triggers a Stripe transfer to a creator's connected Express account
// for a single approved payment record.
//
// Called by mark-paid flow for payments where payment_method = 'stripe'.
// Can also be called manually by admin to retry a failed Stripe transfer.
//
// Auth  : Owner or payment manager with can_mark_paid
// Body  : { paymentId }
// Return: { success, transferId, amount, currency }

const { requirePaymentPermission } = require('../_lib/paymentPermissions');
const { getSupabaseAdminClient }   = require('../_utils/supabaseAdmin');
const { Errors }                   = require('../_utils/errors');
const { getStripe }                = require('../_lib/stripeClient');
const { applyRateLimit }           = require('../_utils/rateLimit');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const blocked = await applyRateLimit(req, res, { max: 10, windowSecs: 60, endpoint: 'stripe-transfer' });
  if (blocked) return;

  const authCtx = await requirePaymentPermission(req, res, 'mark_paid');
  if (!authCtx) return;

  const { paymentId } = req.body || {};
  if (!paymentId) return Errors.badRequest(res, 'paymentId is required');

  const supabase = getSupabaseAdminClient();
  const stripe   = getStripe();

  // Fetch the payment record with creator info
  const { data: payment, error: payErr } = await supabase
    .from('payments')
    .select(`
      id, amount, currency, status, payment_method,
      stripe_transfer_id, stripe_transfer_status,
      creator_id,
      creators (
        id, name, email,
        stripe_account_id, stripe_account_status,
        stripe_charges_enabled, stripe_payouts_enabled
      )
    `)
    .eq('id', paymentId)
    .single();

  if (payErr || !payment) return Errors.notFound(res, 'Payment not found');

  const creator = payment.creators;

  // Validate payment method
  if (payment.payment_method !== 'stripe') {
    return Errors.badRequest(res, 'This payment is not a Stripe payout. Use the manual payout flow.');
  }

  // Validate payment status
  if (payment.status === 'paid') {
    return res.status(200).json({ success: true, alreadyPaid: true, transferId: payment.stripe_transfer_id });
  }

  if (!['approved', 'batched', 'failed'].includes(payment.status)) {
    return Errors.badRequest(res, `Cannot transfer a payment with status "${payment.status}"`);
  }

  // Validate creator Stripe account
  if (!creator?.stripe_account_id) {
    return Errors.badRequest(res, 'Creator does not have a connected Stripe account.');
  }

  if (!creator.stripe_charges_enabled || !creator.stripe_payouts_enabled) {
    return Errors.badRequest(
      res,
      `Creator's Stripe account is not ready for payouts (status: ${creator.stripe_account_status}). ` +
      'Ask the creator to complete Stripe onboarding.'
    );
  }

  // Convert amount to cents (Stripe uses smallest currency unit)
  const amountCents = Math.round(parseFloat(payment.amount) * 100);
  if (amountCents <= 0) {
    return Errors.badRequest(res, 'Transfer amount must be greater than $0');
  }

  // Create the Stripe transfer
  let transfer;
  try {
    transfer = await stripe.transfers.create({
      amount:      amountCents,
      currency:    (payment.currency || 'USD').toLowerCase(),
      destination: creator.stripe_account_id,
      description: `Omnya creator payout — payment ${payment.id}`,
      metadata: {
        payment_id:  payment.id,
        creator_id:  payment.creator_id,
        platform:    'omnya',
      },
    });
  } catch (stripeErr) {
    // Log and return failure — don't mark as paid
    console.error('[stripe-transfer] Stripe transfer error:', stripeErr.message);

    await supabase
      .from('payments')
      .update({
        stripe_transfer_status: 'failed',
        stripe_transfer_error:  stripeErr.message,
        status: 'failed',
      })
      .eq('id', paymentId);

    await supabase.from('payment_audit_logs').insert({
      actor_user_id: authCtx.user.id,
      action:        'stripe_transfer_failed',
      entity_type:   'payment',
      entity_id:     paymentId,
      metadata: { error: stripeErr.message, stripe_code: stripeErr.code },
    });

    return res.status(502).json({
      success: false,
      error:   'stripe_transfer_failed',
      message: stripeErr.message,
    });
  }

  // Update payment record with transfer details
  await supabase
    .from('payments')
    .update({
      stripe_transfer_id:     transfer.id,
      stripe_transfer_status: 'pending',
      stripe_initiated_at:    new Date().toISOString(),
      // Note: status moves to 'paid' via webhook (transfer.paid) not here,
      // because the transfer is async. Mark as 'processing' now.
      status: 'processing',
    })
    .eq('id', paymentId);

  await supabase.from('payment_audit_logs').insert({
    actor_user_id: authCtx.user.id,
    action:        'stripe_transfer_initiated',
    entity_type:   'payment',
    entity_id:     paymentId,
    metadata: {
      transfer_id:    transfer.id,
      amount_cents:   amountCents,
      destination:    creator.stripe_account_id,
      creator_name:   creator.name,
    },
  });

  return res.status(200).json({
    success:    true,
    transferId: transfer.id,
    amount:     payment.amount,
    currency:   payment.currency,
    status:     'processing',
    note:       'Transfer initiated. Status will update to paid via Stripe webhook.',
  });
};
