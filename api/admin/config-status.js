// api/admin/config-status.js
//
// GET /api/admin/config-status
//
// Scope §6.1 — "Review system analytics, history and administrative
// configuration." Note the verb: review, not edit. So this reports what is
// configured; it never changes anything and there is no matching POST.
//
// It answers the questions that currently require someone to open the Vercel
// dashboard and guess:
//
//   * is rate limiting actually enforcing, or silently failing open?
//   * will email send, or is RESEND_API_KEY still the placeholder?
//   * can tokens be encrypted, or is ENCRYPTION_KEY missing?
//   * did the payout migrations land?
//
// SECRET SAFETY: this returns booleans and value *shapes* only — never a
// secret, never a prefix, never a length that would narrow a search. A route
// that reports configuration is a route an attacker would love to read, so it
// is owner-gated and deliberately uninformative about the values themselves.
//
// Auth: owner only.

const { applyCors } = require('../_utils/cors');
const { Errors, sendOk } = require('../_utils/errors');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const { applyRateLimit } = require('../_utils/rateLimit');
const { requireOwner } = require('../_lib/adminGuard');

// Values that mean "somebody copied .env.example and never came back".
const PLACEHOLDERS = [
  'your-resend-api-key', 'your-anon-key', 'your-service-role-key',
  'your-cron-secret', 'your-tiktok-client-key', 'your-tiktok-client-secret',
  'your-instagram-app-id', 'your-instagram-app-secret',
  'your-facebook-app-id', 'your-facebook-app-secret',
  'your-youtube-client-id', 'your-youtube-client-secret',
  'your-anthropic-api-key', 'your-google-client-id', 'your-google-client-secret',
  'your-refresh-token', 'admin@yourcompany.com',
];

function classify(name, { hexBytes } = {}) {
  const raw = process.env[name];

  if (raw === undefined || raw === null || raw.trim() === '') {
    return { name, state: 'missing' };
  }
  const value = raw.trim();

  if (PLACEHOLDERS.includes(value.toLowerCase())) {
    return { name, state: 'placeholder' };
  }

  // ENCRYPTION_KEY has a shape requirement that is worth checking here,
  // because getting it wrong fails at the first token write rather than at
  // deploy time.
  if (hexBytes) {
    if (!/^[0-9a-fA-F]+$/.test(value)) {
      return { name, state: 'invalid', detail: 'not hexadecimal' };
    }
    if (value.length !== hexBytes * 2) {
      return {
        name,
        state: 'invalid',
        detail: `expected ${hexBytes * 2} hex characters, found ${value.length}`,
      };
    }
  }

  return { name, state: 'set' };
}

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') return Errors.methodNotAllowed(res);

  const blocked = await applyRateLimit(req, res, {
    max: 30,
    windowSecs: 60,
    endpoint: 'admin-config-status',
  });
  if (blocked) return;

  const authCtx = await requireOwner(req, res);
  if (!authCtx) return;

  const groups = [
    {
      group: 'Core',
      note: 'The portal cannot run without these.',
      vars: [classify('SUPABASE_URL'), classify('SUPABASE_SERVICE_ROLE_KEY'), classify('APP_BASE_URL')],
    },
    {
      group: 'Security',
      note: 'Rate limits fail open when Upstash is unset — every limit in the codebase becomes a no-op, including the ones on login and payouts.',
      vars: [
        classify('ENCRYPTION_KEY', { hexBytes: 32 }),
        classify('UPSTASH_REDIS_REST_URL'),
        classify('UPSTASH_REDIS_REST_TOKEN'),
        classify('CRON_SECRET'),
      ],
    },
    {
      group: 'Email',
      note: 'Withdrawal receipts, approvals and rejections all go through Resend. If this is unset, none of them send.',
      vars: [classify('RESEND_API_KEY'), classify('RESEND_FROM_EMAIL'), classify('OWNER_NOTIFICATION_EMAIL')],
    },
    {
      group: 'Payments',
      note: 'Stripe Connect is optional; manual bank and Zelle payouts work without it.',
      vars: [classify('STRIPE_SECRET_KEY'), classify('STRIPE_WEBHOOK_SECRET')],
    },
    {
      group: 'Social integrations',
      note: 'Each provider is independent. A missing one disables that connect button only.',
      vars: [
        classify('TIKTOK_CLIENT_KEY'), classify('TIKTOK_CLIENT_SECRET'),
        classify('META_APP_ID'), classify('META_APP_SECRET'),
        classify('YOUTUBE_CLIENT_ID'), classify('YOUTUBE_CLIENT_SECRET'),
      ],
    },
  ];

  // Database side: has the remediation set landed? These are the objects whose
  // absence changes how the portal behaves, so reporting them here saves a
  // trip to the SQL editor.
  const supabase = getSupabaseAdminClient();
  const schema = [];

  async function probeTable(table, label, why) {
    const { error } = await supabase.from(table).select('*', { head: true, count: 'exact' }).limit(1);
    schema.push({
      object: table,
      label,
      why,
      present: !error,
      detail: error ? error.message : null,
    });
  }

  try {
    await Promise.all([
      probeTable('payout_ledger', 'Append-only payout ledger',
        'Without it there is no reconcilable history of the money path (§9.3).'),
      probeTable('admin_audit_logs', 'Admin audit trail',
        'Without it, role changes, archiving and review decisions leave no record (§5.1).'),
      probeTable('campaign_creators', 'Campaign assignment table',
        'Without it, assignment has no referential integrity (§7.2).'),
      probeTable('creator_social_accounts', 'Encrypted social tokens',
        'Without it, OAuth tokens have nowhere encrypted to live (§10.1).'),
    ]);
  } catch (err) {
    console.warn('[admin/config-status] schema probe failed:', err.message);
  }

  const flat = groups.flatMap((g) => g.vars);
  const summary = {
    set: flat.filter((v) => v.state === 'set').length,
    missing: flat.filter((v) => v.state === 'missing').length,
    placeholder: flat.filter((v) => v.state === 'placeholder').length,
    invalid: flat.filter((v) => v.state === 'invalid').length,
    schemaPresent: schema.filter((s) => s.present).length,
    schemaTotal: schema.length,
  };

  return sendOk(res, {
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown',
    groups,
    schema,
    summary,
    checkedAt: new Date().toISOString(),
  });
};
