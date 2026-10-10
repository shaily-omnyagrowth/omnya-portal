// api/admin/config-status.js
//
// GET /api/admin/config-status
//
// Scope §6.1 — "Review system analytics, history and administrative
// configuration." Note the verb: review, not edit. So this reports what is
// configured; it never changes anything and there is no matching POST.
// (POST /api/admin/config-test pings the providers; it changes nothing either.)
//
// It answers "is production configured and migrated?" in one place
// (spec 0001):
//
//   * groups      every required env var as set / missing / placeholder /
//                 invalid, with a fixed reason (api/_lib/configRules.js)
//   * migrations  one row per file in supabase/migrations/probes.json as
//                 applied / broken / pending / drift / manual, from the
//                 admin_migration_status() RPC (api/_lib/migrationProbes.js)
//   * ready       true only when every required value is set and every
//                 migration row is applied; notReadyReasons says why not
//
// SECRET SAFETY: this returns states and fixed reason strings only — never a
// secret, never a prefix, never a length that would narrow a search. A route
// that reports configuration is a route an attacker would love to read, so it
// is owner-gated and deliberately uninformative about the values themselves.
//
// The rate limit here stays fail OPEN on purpose: this page is how the owner
// sees that the limiter is down, so it must still load when it is.
//
// Auth: owner only.

const { applyCors } = require('../_utils/cors');
const { Errors, sendOk } = require('../_utils/errors');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');
const { applyRateLimit } = require('../_utils/rateLimit');
const { requireOwner } = require('../_lib/adminGuard');
const { redirectUriFor } = require('../_utils/oauth');
const { instagramAppCredentials } = require('../_utils/meta');
const { evaluateConfig } = require('../_lib/configRules');
const migrationProbes = require('../_lib/migrationProbes');

const STATUS_MIGRATION = migrationProbes.STATUS_MIGRATION;

// PostgREST answers PGRST202 when the function is not in its schema cache,
// which here means 20261001000000 has not been applied yet.
async function readMigrations(supabase) {
  const { data, error } = await supabase.rpc('admin_migration_status', {
    probes: migrationProbes.probePayload(),
  });

  if (error) {
    const missingFn = error.code === 'PGRST202' || /admin_migration_status/.test(error.message || '');
    return {
      available: false,
      code: error.code || null,
      hint: missingFn
        ? `Migration status is unavailable until supabase/migrations/${STATUS_MIGRATION} is applied (npm run db:migrate).`
        : `Migration status could not be read: ${error.message}`,
      rows: [],
      summary: null,
    };
  }

  const present = Object.fromEntries(((data && data.probes) || []).map((p) => [p.file, p.present === true]));
  const rows = migrationProbes.computeRows({
    files: Object.keys(migrationProbes.manifest).sort(),
    history: (data && data.history) || [],
    present,
  }).map((r) => ({
    file: r.file,
    label: r.label,
    state: r.state,
    recorded: r.recorded,
    probe: r.probe,
    checks: r.checks,
    why: r.why || null,
    retiredBy: r.retiredBy || null,
  }));

  return { available: true, code: null, hint: null, rows, summary: migrationProbes.summarize(rows) };
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

  const config = evaluateConfig(process.env);

  let migrations;
  try {
    migrations = await readMigrations(getSupabaseAdminClient());
  } catch (err) {
    console.warn('[admin/config-status] migration status failed:', err.message);
    migrations = { available: false, code: null, hint: `Migration status could not be read: ${err.message}`, rows: [], summary: null };
  }

  // AC-9: one flag, and every reason it is false.
  const notReadyReasons = [...config.notReadyReasons];
  if (!migrations.available) {
    notReadyReasons.push(migrations.hint);
  } else {
    for (const r of migrations.rows.filter((x) => x.state !== 'applied')) {
      notReadyReasons.push(`migration ${r.file}: ${r.state}${r.state === 'manual' ? ' (needs a machine probe)' : ''}`);
    }
  }

  // Not secrets: a redirect URI is sent in the clear in every authorize URL.
  // Listed because "does this match what is registered in the provider's
  // console, character for character?" is the first question when a connect
  // fails on the provider's own error page, and until now answering it meant
  // reading the source.
  const oauth = [
    { platform: 'TikTok',    console: 'TikTok for Developers → your app → Login Kit → Redirect URI', env: 'TIKTOK_REDIRECT_URI',    key: 'tiktok' },
    { platform: 'Instagram', console: 'Meta for Developers → Instagram → API setup with Instagram login → OAuth redirect URIs', env: 'INSTAGRAM_REDIRECT_URI', key: 'instagram' },
    { platform: 'Facebook',  console: 'Meta for Developers → Facebook Login → Settings → Valid OAuth Redirect URIs', env: 'META_REDIRECT_URI', key: 'facebook' },
    { platform: 'YouTube',   console: 'Google Cloud Console → Credentials → your OAuth client → Authorized redirect URIs', env: 'YOUTUBE_REDIRECT_URI', key: 'youtube' },
  ].map((o) => ({
    platform: o.platform,
    console: o.console,
    redirectUri: redirectUriFor(o.key),
    source: process.env[o.env] ? `${o.env} (override)` : 'APP_BASE_URL (default)',
    // A credential fault we can detect from here. Instagram Business Login uses
    // its own app id, and setting it to the Facebook one fails on Instagram's
    // side with "Invalid platform app" -- a page that names nothing.
    problem: o.key === 'instagram' ? (instagramAppCredentials().error || null) : null,
  }));

  return sendOk(res, {
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown',
    production: config.production,
    livePlatforms: config.livePlatforms,
    groups: config.groups,
    oauth,
    migrations,
    ready: notReadyReasons.length === 0,
    notReadyReasons,
    summary: config.summary,
    checkedAt: new Date().toISOString(),
  });
};
