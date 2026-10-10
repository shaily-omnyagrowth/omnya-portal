// api/_lib/configRules.js
//
// What System Config checks about each environment variable (spec 0001,
// AC-8 and AC-9). Pure: takes an env object, returns states, so the rules can
// be tested without a deployment.
//
// Each value is one of
//   set          present and, in production, well formed
//   missing      unset or blank
//   placeholder  still the .env.example value
//   invalid      present but malformed (production only), with a fixed reason
//   not live     a social key for a platform not listed in LIVE_PLATFORMS
//
// Format rules apply only when VERCEL_ENV=production. Previews legitimately
// run on Stripe test keys and preview URLs, so elsewhere a value is just set
// or missing (placeholders are still flagged everywhere).
//
// SECRET SAFETY: a reason is a fixed string per rule. Never the value, a
// prefix of it, or its length: "expected 64 hexadecimal characters, found 63"
// narrows a search, so it is "expected 64 hexadecimal characters".

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

const PLATFORMS = ['tiktok', 'instagram', 'facebook', 'youtube'];

const EMAIL = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;

// Each rule returns null when well formed, else its fixed reason.
const FORMAT = {
  SUPABASE_URL: (v) => (/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(v) ? null : 'expected https://<project ref>.supabase.co'),
  SUPABASE_SERVICE_ROLE_KEY: (v) =>
    (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v) || v.startsWith('sb_secret_')
      ? null : 'expected a service role JWT or an sb_secret_ key'),
  APP_BASE_URL: (v) => {
    let u;
    try { u = new URL(v); } catch { return 'expected an https URL'; }
    if (u.protocol !== 'https:') return 'expected an https URL';
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(u.hostname)) return 'points at localhost';
    if (v.endsWith('/')) return 'remove the trailing slash';
    return null;
  },
  ENCRYPTION_KEY: (v) => {
    if (!/^[0-9a-fA-F]+$/.test(v)) return 'not hexadecimal';
    return v.length === 64 ? null : 'expected 64 hexadecimal characters';
  },
  CRON_SECRET: (v) => (v.length >= 32 ? null : 'expected at least 32 characters'),
  UPSTASH_REDIS_REST_URL: (v) => (/^https:\/\/[a-z0-9.-]+\.upstash\.io\/?$/i.test(v) ? null : 'expected https://<name>.upstash.io'),
  UPSTASH_REDIS_REST_TOKEN: (v) => (v.length >= 20 ? null : 'expected at least 20 characters'),
  RESEND_API_KEY: (v) => (v.startsWith('re_') ? null : 'expected a Resend key (re_…)'),
  RESEND_FROM_EMAIL: (v) => {
    const named = v.match(/^[^<>]+<([^<>]+)>$/);
    return EMAIL.test(named ? named[1].trim() : v) ? null : 'expected addr@domain or Name <addr@domain>';
  },
  OWNER_NOTIFICATION_EMAIL: (v) => (EMAIL.test(v) ? null : 'expected an email address'),
  STRIPE_SECRET_KEY: (v) => (/^(sk|rk)_live_/.test(v) ? null : 'expected the live mode key'),
  STRIPE_WEBHOOK_SECRET: (v) => (v.startsWith('whsec_') ? null : 'expected a webhook signing secret (whsec_…)'),
};

const GROUPS = [
  {
    group: 'Core',
    note: 'The portal cannot run without these.',
    vars: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'APP_BASE_URL'],
  },
  {
    group: 'Security',
    note: 'In production, payouts, withdrawals, user admin and email refuse requests (503) while the rate limit store is unset or unreachable. Other routes run unlimited.',
    vars: ['ENCRYPTION_KEY', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'CRON_SECRET'],
  },
  {
    group: 'Email',
    note: 'Withdrawal receipts, approvals and rejections all go through Resend. If this is unset, none of them send.',
    vars: ['RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'OWNER_NOTIFICATION_EMAIL'],
  },
  {
    group: 'Payments',
    note: 'Production needs the live mode Stripe key. A test key there moves no real money.',
    vars: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
  },
];

const isProduction = (env) => env.VERCEL_ENV === 'production';

function raw(env, name) {
  const v = env[name];
  return v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim();
}

const isPlaceholder = (v) => PLACEHOLDERS.includes(v.toLowerCase()) || /^your[-_]/i.test(v);

function classify(env, name, { required = true, format = FORMAT[name] } = {}) {
  const v = raw(env, name);
  if (v === null) return { name, required, state: 'missing', reason: 'not set' };
  if (isPlaceholder(v)) return { name, required, state: 'placeholder', reason: 'still the example value' };
  if (isProduction(env) && format) {
    const reason = format(v);
    if (reason) return { name, required, state: 'invalid', reason };
  }
  return { name, required, state: 'set', reason: null };
}

// LIVE_PLATFORMS: which social platforms must have keys. Unset means none.
function livePlatforms(env) {
  const v = raw(env, 'LIVE_PLATFORMS');
  if (v === null) return { list: [], unknown: [] };
  const items = v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return { list: items.filter((p) => PLATFORMS.includes(p)), unknown: items.filter((p) => !PLATFORMS.includes(p)) };
}

function platformVars(env, platform, live) {
  const pick = (names) => names.map((n) => {
    if (!live) return { name: n, required: false, state: 'not live', reason: 'not in LIVE_PLATFORMS' };
    return classify(env, n, { format: null });
  });
  switch (platform) {
    case 'tiktok': return pick(['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET']);
    // The pair instagramAppCredentials() reads first.
    case 'instagram': return pick(['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET']);
    case 'facebook': {
      // META_* first, FACEBOOK_* as the fallback the handlers also accept.
      const metaSet = raw(env, 'META_APP_ID') && raw(env, 'META_APP_SECRET');
      const fbSet = raw(env, 'FACEBOOK_APP_ID') && raw(env, 'FACEBOOK_APP_SECRET');
      return pick(!metaSet && fbSet ? ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'] : ['META_APP_ID', 'META_APP_SECRET']);
    }
    case 'youtube': return pick(['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET']);
    default: return [];
  }
}

const LABEL = { tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube' };

function evaluateConfig(env = process.env) {
  const groups = GROUPS.map((g) => ({ group: g.group, note: g.note, vars: g.vars.map((n) => classify(env, n)) }));

  const live = livePlatforms(env);
  const liveVar = classify(env, 'LIVE_PLATFORMS', { required: false, format: null });
  if (liveVar.state === 'set' && isProduction(env) && live.unknown.length) {
    liveVar.state = 'invalid';
    liveVar.reason = 'unknown platform in the list (allowed: tiktok, instagram, facebook, youtube)';
  }
  groups.push({
    group: 'Social integrations',
    note: 'Keys are required only for platforms listed in LIVE_PLATFORMS. The rest show "not live" and do not count against readiness.',
    vars: [liveVar, ...PLATFORMS.flatMap((p) =>
      platformVars(env, p, live.list.includes(p)).map((v) => ({ ...v, platform: LABEL[p] })))],
  });

  const flat = groups.flatMap((g) => g.vars);
  const blocking = flat.filter((v) => v.required && v.state !== 'set');
  const count = (s) => flat.filter((v) => v.state === s).length;

  return {
    production: isProduction(env),
    livePlatforms: live.list,
    groups,
    summary: {
      set: count('set'),
      missing: count('missing'),
      placeholder: count('placeholder'),
      invalid: count('invalid'),
      notLive: count('not live'),
    },
    notReadyReasons: blocking.map((v) => `${v.name}: ${v.state}${v.reason && v.state !== 'missing' ? ` (${v.reason})` : ''}`),
  };
}

module.exports = { evaluateConfig, classify, livePlatforms, PLACEHOLDERS, PLATFORMS, FORMAT };
