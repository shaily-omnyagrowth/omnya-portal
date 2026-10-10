# api (Vercel serverless functions)

## Overview

Every privileged operation: user lifecycle, payouts and Stripe Connect, social OAuth and analytics sync, email, public campaign share reports, and the cron jobs. Each file is one Vercel function; the folder path is the URL (`api/payouts/create-batch.js` is `POST /api/payouts/create-batch`).

## Key files

| File | Owns |
|---|---|
| `_utils/errors.js` | The response shape `{ ok: true, data }` / `{ ok: false, error: { code, message } }`, `Errors.*` shorthands, `isSchemaMissing()` |
| `_utils/auth.js` | `requireAuth`, `requireRole(req, res, roles)`, `normalizeRole` |
| `_lib/adminGuard.js` | Owner only guard for `admin/*`: no acting on yourself, never remove the last owner |
| `_lib/paymentPermissions.js` | `requirePaymentPermission(req, res, perm)`: owner or a payment manager holding that permission |
| `_utils/cors.js`, `_utils/rateLimit.js` | `applyCors`, `applyRateLimit` (Upstash) |
| `_utils/supabaseAdmin.js` | The service role client. Bypasses RLS, so authorize before using it |
| `_utils/socialAccounts.js`, `_utils/encryption.js`, `_utils/tokenRefresh.js`, `_utils/oauth.js` | OAuth connections, AES-256-GCM token storage, refresh, state plus PKCE |

## Conventions

- CommonJS (`require` / `module.exports = async (req, res) => …`), not ESM.
- Handler order: `applyCors` (return if it handled a preflight), method check, `applyRateLimit` (return if blocked), auth guard (return if null, it already responded), parse `req.body` that may arrive as a string, then work.
- Respond only via `sendOk` and `Errors.*`. Map `isSchemaMissing(err)` to a message naming the missing migration.
- Supabase RPCs report domain failures as `{ success: false }` in the payload. Check it and return 400, never 200.
- OAuth tokens live encrypted in `creator_social_accounts`. `creator_tokens` is legacy plaintext; do not read or write it.
- Allowed values are what the live CHECK constraints accept: platform `tiktok | instagram | facebook | youtube` (never `meta`; the Meta flow stores on the `facebook` row), reauth status `reauth_required` (never `needs_reauth`).

## Gotchas

- `ENCRYPTION_KEY` (64 hex chars) is required for any token write but is missing from `.env.example`. `GET /api/admin/config-status` reports which env vars are unset or malformed.
- Rate limiting fails open when `UPSTASH_*` is unset, so a missing limiter is silent.
- Cron routes (`cron/*`, `analytics/sync`) authenticate with `CRON_SECRET`; schedules live in `vercel.json`.
- Instagram uses its own Instagram App ID, not the Facebook one; Meta, Facebook and Instagram buttons otherwise share one Meta app.
- TikTok "correct the following: client_key" means the app is in sandbox, not a bad redirect URI. See `SOCIAL_MEDIA_INTEGRATION.md`.

## Agent skills

- [stripe-best-practices](../.agents/skills/stripe-best-practices/): `stripe/ai`, Stripe Connect payouts, transfers and webhooks in `stripe/` and `payouts/`
- [upstash-ratelimit-js](../.agents/skills/upstash-ratelimit-js/): `upstash/skills`, rate limiting behind `_utils/rateLimit.js` (which calls the REST API directly, no SDK)
- [resend](../.agents/skills/resend/): `resend/resend-skills`, transactional email in `send-email.js`

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
