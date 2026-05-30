// api/payouts/mark-paid.js
//
// POST /api/payouts/mark-paid
//
// Marks a payout batch and all its child payments as Paid via the
// mark_payout_batch_paid RPC, then fires payment_sent emails to every
// creator in the batch (fire-and-forget per creator).
//
// Auth:  owner  OR  payment manager with can_mark_paid = true
// Rate:  5 requests / minute

const { applyCors } = require('../_utils/cors');
const { Errors, sendOk } = require('../_utils/errors');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const { applyRateLimit } = require('../_utils/rateLimit');
const { requirePaymentPermission } = require('../_lib/paymentPermissions');
const { getStripe } = require('../_lib/stripeClient');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  // Rate limit: 5 per minute — destructive financial write.
  const blocked = await applyRateLimit(req, res, {
    max: 5,
    windowSecs: 60,
    endpoint: 'payouts-mark-paid',
  });
  if (blocked) return;

  // Auth: owner or payment manager with can_mark_paid
  const authCtx = await requirePaymentPermission(req, res, 'mark_paid');
  if (!authCtx) return;

  const { user } = authCtx;
  const supabase = getSupabaseAdminClient();

  try {
    // --- Parse body ---
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) {}
    }

    // Accept both batchId (camelCase) and batch_id (snake_case) — fixes existing mismatch bug.
    const id = (body && (body.batchId || body.batch_id)) || null;
    if (!id) return Errors.badRequest(res, 'Missing batchId');

    // --- Call RPC to flip batch + payments transactionally ---
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'mark_payout_batch_paid',
      {
        p_batch_id: id,
        p_marked_paid_by: user.id,
      }
    );

    if (rpcError) throw rpcError;

    // RPC may signal a domain-level failure via success: false
    if (rpcData && rpcData.success === false) {
      return Errors.badRequest(
        res,
        rpcData.message || 'Batch could not be marked as paid',
        { error: rpcData.error || null }
      );
    }

    const paidCount = (rpcData && rpcData.paid_count) || 0;
    const totalAmount = (rpcData && rpcData.total_amount) || 0;

    // --- Auto-trigger Stripe transfers for Stripe-method payments ---
    const { data: stripePayments } = await supabase
      .from('payments')
      .select(`
        id, amount, currency, payment_method,
        creators!inner (
          id, name, email,
          stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled
        )
      `)
      .eq('batch_id', id)
      .eq('payment_method', 'stripe')
      .in('status', ['approved', 'batched']);

    if (stripePayments && stripePayments.length > 0) {
      const stripe = getStripe();
      await Promise.allSettled(stripePayments.map(async (payment) => {
        const creator = payment.creators;
        if (!creator?.stripe_account_id || !creator.stripe_charges_enabled || !creator.stripe_payouts_enabled) {
          console.warn(`[mark-paid] Skipping Stripe transfer for payment ${payment.id} — creator account not ready`);
          return;
        }
        try {
          const amountCents = Math.round(parseFloat(payment.amount) * 100);
          const transfer = await stripe.transfers.create({
            amount:      amountCents,
            currency:    (payment.currency || 'usd').toLowerCase(),
            destination: creator.stripe_account_id,
            description: `Omnya payout — payment ${payment.id}`,
            metadata:    { payment_id: payment.id, creator_id: payment.creators.id, platform: 'omnya' },
          });
          await supabase
            .from('payments')
            .update({
              stripe_transfer_id:     transfer.id,
              stripe_transfer_status: 'pending',
              stripe_initiated_at:    new Date().toISOString(),
              status:                 'processing',
            })
            .eq('id', payment.id);
          console.log(`[mark-paid] Stripe transfer ${transfer.id} initiated for payment ${payment.id}`);
        } catch (err) {
          console.error(`[mark-paid] Stripe transfer failed for payment ${payment.id}:`, err.message);
          await supabase
            .from('payments')
            .update({ stripe_transfer_status: 'failed', stripe_transfer_error: err.message, status: 'failed' })
            .eq('id', payment.id);
        }
      }));
    }

    // --- Fetch creator details for email notifications ---
    const { data: creatorRows, error: creatorFetchError } = await supabase
      .from('payments')
      .select(`
        amount,
        payment_method,
        creators!inner (
          id,
          email,
          name
        )
      `)
      .eq('batch_id', id);

    if (creatorFetchError) {
      // Non-fatal: log and skip emails rather than failing the response.
      console.error('[mark-paid] Failed to fetch creators for email notifications:', creatorFetchError.message);
    }

    // --- Deduplicate by creator email, accumulating amount + video count ---
    // payment_sent requires: creatorEmail, amount, method, campaignName, videosApproved
    // Group by creator so each creator receives one consolidated email per batch.
    const creatorMap = {};
    if (creatorRows && creatorRows.length > 0) {
      for (const row of creatorRows) {
        const creator = row.creators;
        if (!creator || !creator.email) continue;

        const key = creator.email;
        if (!creatorMap[key]) {
          creatorMap[key] = {
            email: creator.email,
            name: creator.name || creator.email,
            amount: 0,
            method: row.payment_method || 'Bank Transfer',
            videosApproved: 0,
          };
        }
        creatorMap[key].amount += parseFloat(row.amount || 0);
        creatorMap[key].videosApproved += 1;
      }
    }

    // --- Send payment_sent emails (fire-and-forget per creator) ---
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000');

    let emailsSent = 0;
    let emailsFailed = 0;

    const emailPromises = Object.values(creatorMap).map(async (creator) => {
      try {
        const emailRes = await fetch(`${baseUrl}/api/send-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            type: 'payment_sent',
            data: {
              creatorEmail: creator.email,
              amount: creator.amount.toFixed(2),
              method: creator.method,
              campaignName: 'Omnya Campaign',
              videosApproved: creator.videosApproved,
            },
          }),
        });

        if (!emailRes.ok) {
          const errText = await emailRes.text().catch(() => '');
          console.warn(
            `[mark-paid] payment_sent email non-2xx for ${creator.email}: ${emailRes.status} ${errText}`
          );
          emailsFailed += 1;
        } else {
          emailsSent += 1;
        }
      } catch (emailErr) {
        console.error(
          `[mark-paid] payment_sent email error for ${creator.email}:`,
          emailErr.message
        );
        emailsFailed += 1;
      }
    });

    // Wait for all email attempts before returning so the counts are accurate.
    await Promise.allSettled(emailPromises);

    return sendOk(res, {
      success: true,
      paidCount,
      totalAmount,
      emailsSent,
      emailsFailed,
    });
  } catch (err) {
    console.error('[mark-paid] Unexpected error:', err);
    return Errors.internal(res, err.message);
  }
};
