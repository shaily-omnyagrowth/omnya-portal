// api/stripe/webhook.js
//
// POST /api/stripe/webhook
//
// Receives and verifies Stripe webhook events.
// Handles:
//   account.updated       — sync Connect account status
//   transfer.paid         — mark payment as paid
//   transfer.failed       — mark payment as failed, flag for review
//
// IMPORTANT: Vercel must not parse the body for this route — raw body
// needed for signature verification. Add to vercel.json:
//   { "src": "/api/stripe/webhook", "headers": { "Content-Type": "application/json" } }
//
// Set STRIPE_WEBHOOK_SECRET from the Stripe dashboard webhook signing secret.

const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const { getStripe }              = require('../_lib/stripeClient');

// Disable body parsing so we get the raw buffer for signature verification
module.exports.config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripe     = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET is not set');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  const sig     = req.headers['stripe-signature'];
  const rawBody = await getRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Webhook signature invalid' });
  }

  const supabase = getSupabaseAdminClient();

  try {
    switch (event.type) {

      // ── account.updated ─────────────────────────────────────────────────────
      // Fired when a Connect account's capabilities or requirements change.
      case 'account.updated': {
        const account = event.data.object;
        const accountId = account.id;

        const chargesEnabled   = account.charges_enabled;
        const payoutsEnabled   = account.payouts_enabled;
        const detailsSubmitted = account.details_submitted;
        const disabledReason   = account.requirements?.disabled_reason || null;

        let status = 'pending';
        if (disabledReason) {
          status = 'disabled';
        } else if (chargesEnabled && payoutsEnabled) {
          status = 'active';
        } else if (detailsSubmitted) {
          status = 'pending';
        }

        await supabase
          .from('creators')
          .update({
            stripe_account_status:    status,
            stripe_charges_enabled:   chargesEnabled,
            stripe_payouts_enabled:   payoutsEnabled,
            stripe_details_submitted: detailsSubmitted,
          })
          .eq('stripe_account_id', accountId);

        console.log(`[stripe/webhook] account.updated: ${accountId} → ${status}`);
        break;
      }

      // ── transfer.paid ────────────────────────────────────────────────────────
      // Fired when a transfer to a connected account succeeds.
      case 'transfer.paid': {
        const transfer = event.data.object;
        const transferId = transfer.id;

        const { data: payment } = await supabase
          .from('payments')
          .select('id, withdrawal_request_id')
          .eq('stripe_transfer_id', transferId)
          .single();

        if (payment) {
          await supabase
            .from('payments')
            .update({ stripe_transfer_status: 'paid', status: 'paid', processed_at: new Date().toISOString() })
            .eq('id', payment.id);

          if (payment.withdrawal_request_id) {
            await supabase
              .from('withdrawal_requests')
              .update({ status: 'paid', paid_at: new Date().toISOString() })
              .eq('id', payment.withdrawal_request_id);
          }
        }

        console.log(`[stripe/webhook] transfer.paid: ${transferId}`);
        break;
      }

      // ── transfer.failed ──────────────────────────────────────────────────────
      // Fired when a transfer fails (e.g. invalid bank account).
      case 'transfer.failed': {
        const transfer = event.data.object;
        const transferId = transfer.id;
        const failureMsg = transfer.failure_message || 'Transfer failed';

        const { data: payment } = await supabase
          .from('payments')
          .select('id')
          .eq('stripe_transfer_id', transferId)
          .single();

        if (payment) {
          await supabase
            .from('payments')
            .update({
              stripe_transfer_status: 'failed',
              stripe_transfer_error:  failureMsg,
              status: 'failed',
            })
            .eq('id', payment.id);
        }

        console.error(`[stripe/webhook] transfer.failed: ${transferId} — ${failureMsg}`);
        break;
      }

      default:
        // Ignore unhandled event types
        break;
    }
  } catch (err) {
    console.error('[stripe/webhook] Handler error:', err);
    // Still return 200 so Stripe doesn't retry — log the error instead
  }

  return res.status(200).json({ received: true });
};
