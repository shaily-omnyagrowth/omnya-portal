// api/payouts/export.js
//
// GET /api/payouts/export?batchId=<uuid>
//
// Exports a single payout batch as a UTF-8 CSV download.
//
// Auth: owner, OR payment manager with can_export_batches = true.
// Rate limit: 10 requests / 60 s per caller.

const { applyCors } = require('../_utils/cors');
const { Errors } = require('../_utils/errors');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const { applyRateLimit } = require('../_utils/rateLimit');
const { requirePaymentPermission, logPaymentAction } = require('../_lib/paymentPermissions');

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

/** Wrap a field value in double-quotes and escape any internal double-quotes. */
function csvField(value) {
  const str = value == null ? '' : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

/** Join an array of raw values into a single CSV row string. */
function csvRow(fields) {
  return fields.map(csvField).join(',');
}

// ---------------------------------------------------------------------------
// Payment destination resolver
// ---------------------------------------------------------------------------

/**
 * Return a display-safe payment destination string.
 *
 * Priority:
 *   1. payment_destination_summary (pre-computed, already masked)
 *   2. Bank transfer — "<bank_name> ****<last4>"
 *   3. Zelle email  — "<first-char>***@<domain>"
 *   4. Zelle phone  — "****<last4>"
 *   5. Empty string (unknown)
 *
 * Full account numbers are NEVER included.
 */
function resolveDestination(payment, creator) {
  if (payment.payment_destination_summary) {
    return payment.payment_destination_summary;
  }

  const method = (payment.payment_method || '').toLowerCase();

  if (method === 'bank' || method === 'bank_transfer') {
    const bankName = creator.bank_name || 'Bank';
    const last4 = creator.bank_account_last4 || '';
    return last4 ? `${bankName} ****${last4}` : bankName;
  }

  if (method === 'zelle') {
    // Prefer e-mail masking; fall back to phone masking.
    if (creator.zelle_email) {
      const atIdx = creator.zelle_email.indexOf('@');
      if (atIdx > 0) {
        const first = creator.zelle_email.charAt(0);
        const domain = creator.zelle_email.slice(atIdx); // includes @
        return `${first}***${domain}`;
      }
      return '***@unknown';
    }
    if (creator.zelle_phone_last4) {
      return `****${creator.zelle_phone_last4}`;
    }
  }

  return '';
}

// ---------------------------------------------------------------------------
// Date formatter — YYYY-MM-DD from an ISO string or Date
// ---------------------------------------------------------------------------
function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

module.exports = async (req, res) => {
  // -- CORS preflight --
  if (applyCors(req, res)) return;

  // -- Method guard --
  if (req.method !== 'GET') return Errors.methodNotAllowed(res);

  // -- Rate limit: 10 exports per minute --
  const blocked = await applyRateLimit(req, res, {
    max: 10,
    windowSecs: 60,
    endpoint: 'payouts-export',
  });
  if (blocked) return;

  // -- Auth: owner OR payment manager with export_batches permission --
  // SECURITY FIX: the original file had no auth check at all.
  const authCtx = await requirePaymentPermission(req, res, 'export_batches');
  if (!authCtx) return;

  // -- Required query param --
  const { batchId } = req.query;
  if (!batchId) {
    return Errors.badRequest(res, 'Missing required query parameter: batchId');
  }

  const supabase = getSupabaseAdminClient();

  try {
    // -----------------------------------------------------------------------
    // Fetch batch + payments + creators + withdrawal requests
    // -----------------------------------------------------------------------
    const { data: rows, error: queryError } = await supabase
      .from('payout_batches')
      .select(`
        batch_number,
        created_at,
        payments (
          id,
          amount,
          currency,
          payment_method,
          payment_destination_summary,
          notes,
          withdrawal_request_id,
          withdrawal_requests (
            id,
            requested_at,
            approved_at
          ),
          creator_id,
          creators (
            name,
            email,
            bank_name,
            bank_account_last4,
            zelle_email,
            zelle_phone_last4
          )
        )
      `)
      .eq('id', batchId)
      .single();

    if (queryError) {
      if (queryError.code === 'PGRST116') {
        // PostgREST "exactly one row" not satisfied → batch not found
        return Errors.notFound(res, 'Payout batch not found');
      }
      throw queryError;
    }

    if (!rows) {
      return Errors.notFound(res, 'Payout batch not found');
    }

    const payments = rows.payments || [];

    // -----------------------------------------------------------------------
    // Build CSV
    // -----------------------------------------------------------------------
    const CSV_HEADER = [
      'Batch Number',
      'Creator Name',
      'Creator Email',
      'Payment Method',
      'Payment Destination',
      'Amount',
      'Currency',
      'Withdrawal Request ID',
      'Requested Date',
      'Approved Date',
      'Notes',
    ].join(',');

    const dataRows = payments.map((payment) => {
      const creator = payment.creators || {};
      const wr = payment.withdrawal_requests || {};

      const destination = resolveDestination(payment, creator);

      return csvRow([
        rows.batch_number,
        creator.name,
        creator.email,
        payment.payment_method,
        destination,
        payment.amount,
        payment.currency,
        wr.id || payment.withdrawal_request_id,
        formatDate(wr.requested_at),
        formatDate(wr.approved_at),
        payment.notes,
      ]);
    });

    // UTF-8 BOM ensures Excel and other tools render non-ASCII characters correctly.
    const BOM = '﻿';
    const csvContent = BOM + [CSV_HEADER, ...dataRows].join('\r\n');

    // -----------------------------------------------------------------------
    // Mark batch as exported
    // -----------------------------------------------------------------------
    await supabase
      .from('payout_batches')
      .update({ exported_at: new Date().toISOString() })
      .eq('id', batchId);

    // -----------------------------------------------------------------------
    // Audit log
    // -----------------------------------------------------------------------
    await logPaymentAction(
      supabase,
      authCtx.user.id,
      'batch_exported',
      'payout_batch',
      batchId,
      { batch_number: rows.batch_number, payment_count: payments.length }
    );

    // -----------------------------------------------------------------------
    // Send CSV response
    // -----------------------------------------------------------------------
    const dateStr = formatDate(rows.created_at) || formatDate(new Date().toISOString());
    const filename = `omnya-payout-batch-${rows.batch_number}-${dateStr}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csvContent);
  } catch (err) {
    console.error('[payouts/export] Unexpected error:', err.message);
    return Errors.internal(res, 'CSV export failed');
  }
};
