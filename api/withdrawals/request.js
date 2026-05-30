// api/withdrawals/request.js — Vercel serverless function
// Allows a creator to submit a withdrawal request for their available balance.
// The actual amount and eligibility checks are enforced by the DB-side RPC
// (request_creator_withdrawal). This route handles auth, validation, and
// post-success admin notification.

const { applyCors } = require('../_utils/cors');
const { requireRole } = require('../_utils/auth');
const { Errors, sendOk } = require('../_utils/errors');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const { applyRateLimit } = require('../_utils/rateLimit');
const { formatPayoutDestination } = require('../_lib/paymentCalculations');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  // Rate limit: 3 requests per hour per caller (financial write).
  const blocked = await applyRateLimit(req, res, {
    max: 3,
    windowSecs: 3600,
    endpoint: 'withdrawals-request',
  });
  if (blocked) return;

  // Creator role only.
  const authCtx = await requireRole(req, res, ['creator']);
  if (!authCtx) return;

  const { user, profile } = authCtx;
  const supabase = getSupabaseAdminClient();

  try {
    // 1. Fetch the creator record linked to this user.
    const { data: creator, error: creatorError } = await supabase
      .from('creators')
      .select(
        'id, display_name, payout_method, payout_method_status, zelle_destination, bank_account_number'
      )
      .eq('user_id', user.id)
      .maybeSingle();

    if (creatorError) throw creatorError;

    if (!creator) {
      return Errors.notFound(res, 'Creator profile not found');
    }

    // 2. Guard: payment method must be configured and not missing.
    if (!creator.payout_method || creator.payout_method_status === 'missing') {
      return Errors.badRequest(
        res,
        'Please set up your payment method before requesting a withdrawal'
      );
    }

    // 3. Build a human-readable summary of where the money will go.
    //    formatPayoutDestination masks sensitive details (last-4 / masked email).
    const payment_destination_summary = formatPayoutDestination(creator);

    // 4. Delegate all financial logic (balance check, cooldown, minimum amount)
    //    to the DB-side RPC so there is a single authoritative source of truth.
    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      'request_creator_withdrawal',
      {
        p_creator_id: creator.id,
        p_currency: 'USD',
        p_payment_method: creator.payout_method,
        p_payment_destination_summary: payment_destination_summary,
      }
    );

    if (rpcError) throw rpcError;

    // 5. The RPC signals business-rule failures via success=false rather than
    //    raising a Postgres exception, so we inspect the result explicitly.
    if (!rpcResult || rpcResult.success === false) {
      const responsePayload = {
        message: rpcResult?.message || 'Withdrawal request failed',
      };
      // Surface cooldown timing when the RPC includes it.
      if (rpcResult?.next_eligible_at) {
        responsePayload.next_eligible_at = rpcResult.next_eligible_at;
      }
      return Errors.badRequest(res, responsePayload.message, responsePayload);
    }

    const { withdrawal_request_id: withdrawalRequestId, amount } = rpcResult;

    // 6. Notify admin about the new withdrawal request.
    //    Fire-and-forget: a notification failure must not block the creator's
    //    success response since the DB record is already committed.
    const adminEmail = process.env.OWNER_NOTIFICATION_EMAIL;
    const resendApiKey = process.env.RESEND_API_KEY;

    if (adminEmail && resendApiKey) {
      const fromEmail =
        process.env.RESEND_FROM_EMAIL || 'Omnya Growth <onboarding@resend.dev>';
      const portalUrl = 'https://www.portalomnyagrowth.com';
      const creatorName = creator.display_name || profile.email;
      const amountDisplay = amount != null ? `$${Number(amount).toFixed(2)}` : '—';

      const emailHtml = `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#f9f9f9;">
          <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e5e5e5;">
            <div style="font-size:24px;font-weight:700;margin-bottom:4px;">Withdrawal Requested</div>
            <div style="color:#888;font-size:13px;margin-bottom:20px;">A creator has submitted a withdrawal request</div>
            <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
              <tr><td style="padding:6px 0;color:#555;width:160px;">Creator</td><td style="padding:6px 0;font-weight:600;">${creatorName}</td></tr>
              <tr><td style="padding:6px 0;color:#555;">Amount</td><td style="padding:6px 0;font-weight:700;font-size:16px;color:#1a7a4a;">${amountDisplay}</td></tr>
              <tr><td style="padding:6px 0;color:#555;">Method</td><td style="padding:6px 0;">${payment_destination_summary}</td></tr>
              <tr><td style="padding:6px 0;color:#555;">Request ID</td><td style="padding:6px 0;font-size:12px;color:#888;">${withdrawalRequestId}</td></tr>
            </table>
            <a href="${portalUrl}" style="display:inline-block;background:#0a0a0a;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Review in Portal →</a>
          </div>
          <div style="text-align:center;margin-top:16px;font-size:11px;color:#aaa;">Omnya Growth · Creator Portal</div>
        </div>`;

      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [adminEmail],
          subject: `Withdrawal Request: ${creatorName} — ${amountDisplay}`,
          html: emailHtml,
        }),
      })
        .then((r) => r.json())
        .then((result) => {
          if (result.id) {
            console.log(`[withdrawals/request] Admin notified (email id: ${result.id})`);
          } else {
            console.warn('[withdrawals/request] Admin notification may have failed:', result);
          }
        })
        .catch((emailErr) => {
          console.error('[withdrawals/request] Admin notification error:', emailErr.message);
        });
    } else {
      if (!adminEmail) {
        console.warn('[withdrawals/request] OWNER_NOTIFICATION_EMAIL not set — admin notification skipped');
      }
      if (!resendApiKey) {
        console.warn('[withdrawals/request] RESEND_API_KEY not set — admin notification skipped');
      }
    }

    // 7. Return success to the creator.
    return sendOk(res, {
      success: true,
      withdrawalRequestId,
      amount,
      message: 'Withdrawal request submitted',
    });
  } catch (err) {
    console.error('[withdrawals/request] Error:', err.message);
    return Errors.internal(res, err.message);
  }
};
