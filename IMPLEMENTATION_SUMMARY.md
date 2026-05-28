# Omnya Portal — Implementation Summary

Snapshot of everything implemented on the `main-dev` branch as part of the
production-hardening + social-media-integration work. This is the operator
view — what's in the code today, what's open, what you can do.

For deeper detail see [AUDIT.md](./AUDIT.md), [SOCIAL_MEDIA_INTEGRATION.md](./SOCIAL_MEDIA_INTEGRATION.md), [SECURITY_NOTES.md](./SECURITY_NOTES.md), and [supabase/migrations/README.md](./supabase/migrations/README.md).

---

## Commit history (since pre-audit `main`)

```
7c6ae00  Merge pull request #2 from shaily-omnyagrowth/main-dev
9be0144  fix(db): make SETUP_FROM_SCRATCH idempotent on legacy policies
60b19de  db: add SETUP_FROM_SCRATCH.sql one-shot bundle
4180099  fix(nav): stop force-redirecting to dashboard after token refresh
c50f503  ui: rewrite CreatorConnections.js against new safe endpoints + docs
35d4b71  auth: rewrite OAuth flows for TikTok+PKCE, Meta/IG/FB, YouTube with secure state
9d17f23  api: add shared server utilities for auth + OAuth (api/_utils/)
e0b3725  db: add social-media feature migration (oauth_states + new columns + safe view)
bd5fa64  fix(sidebar): use App-computed role prop instead of recomputing locally
2b14f43  db: add production-hardening migration (schema + role-scoped RLS)
57d4e52  fix(guards): RequireRole should gate on role, not a non-existent status column
b6a2782  fix(analytics): correct submission_type filter and creator/submission joins in sync job
f161a99  security: remove hardcoded Supabase keys, require env vars, document rotation
11ad200  chore(deps): prune stale typescript peer-dep entry from package-lock
03cd5ce  docs: add full system audit report
```

---

## 1. Documentation

| File | What it contains |
|---|---|
| `AUDIT.md` | 765-line four-agent audit — architecture, security findings, RLS matrix, code-quality issues, prioritized remediation plan. |
| `SECURITY_NOTES.md` | Key classification (public vs secret), Supabase rotation runbook, pre-push secret-scan recipe. |
| `SOCIAL_MEDIA_INTEGRATION.md` | 304-line guide — OAuth flow diagrams, provider console setup, database / RLS / API reference, common errors, per-environment deployment checklist. |
| `supabase/migrations/README.md` | Migration apply procedure, smoke tests, per-role manual QA matrix. |
| `IMPLEMENTATION_SUMMARY.md` *(this file)* | Operator-facing summary of everything implemented. |

---

## 2. Database

All applied via `supabase/SETUP_FROM_SCRATCH.sql` against a fresh Supabase project (one paste in SQL Editor → Run).

### New tables
| Table | Purpose |
|---|---|
| `oauth_states` | Short-lived OAuth state nonces + PKCE verifier store. Server-only — deny-all RLS for authenticated users; service-role functions read/write. 10-min TTL. |
| `creator_connection_status` *(view)* | Safe projection of `creator_tokens` for the browser — omits `access_token` and `refresh_token`. `security_invoker = true` so RLS on the base table is enforced. |

### Schema additions (additive only — no DROP COLUMN)
- `payments.batch_id` → FK to `payout_batches.id`
- `payout_batches.period_type`
- `creators.payout_email`, `creators.payout_preference`
- `creator_tokens` gains: `user_id` (canonical, auth.users FK), `status`, `last_synced_at`, `last_error`, `platform_user_id`, `platform_username`, `token_type`, `scope`, `refresh_expires_at`, `metadata`
- `video_analytics` gains: `user_id`, `video_url`, `watch_time_seconds`, `engagement_rate`, `raw_metrics`, `created_at`, `updated_at`
- New `UNIQUE(platform, video_id)` on `video_analytics` (coexists with `UNIQUE(submission_id)`)

### Backfills
- `creator_tokens.user_id` populated from `creators.user_id` where only `creator_id` was set previously
- `creator_tokens.platform_user_id` / `platform_username` populated from legacy `account_id` / `account_name`
- `video_analytics.user_id` populated from `creators.user_id`

### Indexes
Every FK + hot query column: submissions (creator_id, campaign_id, payout_batch_id), payments (creator_id, batch_id, status), video_analytics (creator_id, submission_id, campaign_id, user_id), creator_tokens (user_id, creator_id), creators.am_id, clients.am_id, campaigns.client_id, messages.campaign_id, oauth_states (user_id+platform, expires_at, state_hash), payout_batches (period composite).

### Helper functions
- `public.current_user_role()` — SECURITY DEFINER, normalizes `account_manager → am`, used by every RLS policy.
- `public.purge_expired_oauth_states()` — manual cleanup helper.

### RLS rewrite
Every `USING (true)` policy replaced with role-scoped policies on 12 tables. The model:
- **owner** sees everything
- **am** sees only their assigned creators / clients / campaigns
- **creator** sees only their own rows
- **pending** sees only their own profile row
- **service-role** (server-side endpoints) bypasses RLS — protections re-enforced explicitly in code

---

## 3. Server utilities — `api/_utils/`

Shared infrastructure for every API route. CommonJS, matches existing patterns.

| File | Exports |
|---|---|
| `supabaseAdmin.js` | `getSupabaseAdminClient()` — cached service-role client; throws loudly if env missing. |
| `errors.js` | `sendOk(res, data)`, `sendError(res, status, code, message, details)`, `Errors.{unauthorized, forbidden, badRequest, notFound, methodNotAllowed, rateLimited, internal}`. Unified `{ ok, data }` / `{ ok, error: { code, message } }` shape. |
| `cors.js` | `applyCors(req, res)` — locked to portal origin + localhost + `ADDITIONAL_ALLOWED_ORIGINS`. Returns true on OPTIONS preflight so callers exit early. |
| `auth.js` | `getBearerToken`, `getUserFromRequest`, `requireAuth(req, res)`, `requireRole(req, res, [allowed])`, `normalizeRole`. JWT verification via service-role client; user_profiles lookup for role. |
| `oauth.js` | `generateRandomState` (32-byte url-safe), `hashState` (sha256), `generateCodeVerifier` + `generateCodeChallenge` (PKCE S256), `storeOAuthState`, `consumeOAuthState` — one-time-use, platform-bound, TTL-checked. |

---

## 4. OAuth endpoints — `api/auth/`

### Start endpoints (POST, JWT-required)
All return `{ ok: true, data: { authorizationUrl } }`. The frontend then `window.location`s to the returned URL.

| File | Provider | Notable |
|---|---|---|
| `api/auth/tiktok/start.js` | TikTok | PKCE S256 (code_verifier server-side only) |
| `api/auth/instagram/start.js` | Meta | `platform='instagram'` in `oauth_states` |
| `api/auth/facebook/start.js` | Meta | `platform='facebook'` in `oauth_states` |
| `api/auth/meta/start.js` | Meta | `platform='meta'` (generic) |
| `api/auth/youtube/start.js` | Google | `access_type=offline` + `prompt=consent` for refresh token |

### Callback endpoints (GET, provider-driven)
| File | What it does |
|---|---|
| `api/auth/tiktok/callback.js` | Verifies state via `consumeOAuthState`, exchanges code + verifier, upserts `creator_tokens`, redirects to portal with `?connected=tiktok` |
| `api/auth/meta/callback.js` | Shared callback for IG / FB / Meta. Tries each platform label until state matches. Short-lived → long-lived token upgrade (`fb_exchange_token`, ~60d). Best-effort `/me` fetch for `platform_user_id` / `platform_username`. |
| `api/auth/youtube/callback.js` | Exchanges code, fetches channel info, stores `refresh_token` |

### Disconnect
| File | What it does |
|---|---|
| `api/auth/disconnect.js` | POST, JWT-required. Soft-delete: clears `access_token` + `refresh_token`, sets `status='disconnected'`, keeps audit row. Only touches the caller's own `user_id × platform` row. |

---

## 5. Social status — `api/social/`

| File | What it does |
|---|---|
| `api/social/connections.js` | `GET`, JWT-required. Returns safe projection (no access_token / refresh_token) for the caller. Supports `?userId=` for owner (any user) and AM (only creators assigned to them). Always returns one entry per platform — `status='disconnected'` if no row. |

---

## 6. Analytics — `api/analytics/`

| File | What it does |
|---|---|
| `api/analytics/sync.js` | Vercel cron (every 12h per `vercel.json`). `CRON_SECRET`-authed. Bug fixes from `b6a2782` — `submission_type` (not `type`), `creators!inner(user_id)` join, `onConflict: 'submission_id'`. Per-platform inline handlers for YouTube / TikTok / Meta. |
| `api/analytics/fetch.js`, `api/analytics/refresh.js`, `api/analytics.js` | Legacy creator_id-keyed routes; not currently called from anywhere. Slated for removal in cleanup. |

---

## 7. Frontend (`src/`)

| File | Change |
|---|---|
| `src/supabaseClient.js` | Throws if `REACT_APP_SUPABASE_URL` / `REACT_APP_SUPABASE_ANON_KEY` missing. No silent fallback to leaked keys. |
| `src/CreatorConnections.js` | Full rewrite. Uses `/api/social/connections` for status (no direct `creator_tokens` query). POST + JWT to start endpoints, then `window.location` to returned `authorizationUrl`. Four-state cards (connected / disconnected / expired / error). Connect / Disconnect / Reconnect buttons. Surfaces `last_error` and relative `last_synced_at`. |
| `src/AnalyticsDashboard.js` | Reads `video_analytics`; rollup cards + per-video table. |
| `src/pages/CreatorDashboard.js`, `src/PayoutManager.js`, `src/AnalyticsDashboard.js` | Each had its own duplicate `createClient(...)` with hardcoded anon keys — all now `import { supabase } from './supabaseClient'`. |
| `src/PayoutManager.js` | Removed the `const [batches, setBatches] = [useState(null), useState([])][1]` hooks hack. |
| `src/App.js` | Sidebar receives App-level `role` as a prop (no recompute). `onAuthStateChange` on `TOKEN_REFRESHED` no longer clobbers profile fields with `auth.users.role`. Page-validation effect refuses to reset `page` when role is unknown. |
| `src/components/Guards/RequireRole.js` | Gates on `profile.role` instead of a non-existent `profile.status` column. |
| `api/send-email.js` | Removed hardcoded Supabase URL fallback. |

---

## 8. Configuration

| File | Change |
|---|---|
| `.env.example` | Rewritten to match what code actually reads — `REACT_APP_*` client prefix, `APP_BASE_URL`, `CRON_SECRET`, `RESEND_FROM_EMAIL`, `META_APP_ID`, `*_REDIRECT_URI` overrides, `ADDITIONAL_ALLOWED_ORIGINS`, Upstash slots. |
| `VERCEL_DEPLOY.md` | Live keys removed; placeholder table + security notice. |

---

## What's NOT yet implemented (open follow-ups)

| Item | Why it's open | Effort estimate |
|---|---|---|
| **Token refresh inside sync** | sync.js logs the 401 but doesn't auto-refresh and retry. Creators with expired tokens see stale analytics until they click Reconnect. | ~30 min — needs the refresh helpers added to `api/_utils/`. |
| **Manual analytics refresh endpoint** | `POST /api/analytics/manual-sync` so creators / AMs / owners can trigger a sync on demand. Currently waits for the 12h cron. | ~30 min |
| **Dashboard refresh button + platform filter** | AnalyticsDashboard reads new columns natively but no "Refresh now" button yet. | ~30 min once the manual endpoint exists. |
| **Dead-route cleanup** | `api/analytics.js` (mock), `api/analytics/fetch.js`, `api/analytics/refresh.js`, `api/auth/tiktok/disconnect.js`, `api/auth/meta/disconnect.js` all still ship as deployed functions despite zero callers. Each holds env-var access (including `SUPABASE_SERVICE_ROLE_KEY`). | ~10 min — `rm` + commit. |
| **OAuth token encryption at rest** | AUDIT.md §3.8. Tokens currently plaintext, RLS-protected. | ~1h — pgcrypto + encrypt-on-write / decrypt-on-read in callbacks + sync. |
| **Upstash rate limiting** | Env slots exist (`UPSTASH_REDIS_REST_URL/TOKEN`); not wired into endpoints yet. | ~20 min once Upstash is provisioned. |
| **Automated tests + CI** | Only the original CRA boilerplate test exists. | Multi-session. Needs Jest/Vitest + Supabase mocking strategy + GitHub Actions. |
| **App.js refactor** | 5049 lines, 56 inline components. Hot-fixes prevent regressions but the structural issue remains. | Multi-week. |
| **App Review per social platform** | Required if non-tester creators are expected to connect. | External — Privacy / Terms URLs, screen recordings, scope justifications. TikTok ~5-10 business days; Meta 2-6 weeks; Google 4-6 weeks for sensitive scopes. |

---

## Operational status — what you can do today

| Action | Status |
|---|---|
| Apply full database schema cleanly to a new Supabase project | ✅ `SETUP_FROM_SCRATCH.sql` |
| Sign creators up + owner approves via portal UI | ✅ |
| Run portal locally with secure env vars (no leaked-key fallback) | ✅ |
| Test OAuth flows | ✅ via `vercel dev` + provider tester lists |
| Creators see only their own data | ✅ RLS-enforced |
| AMs see only their assigned creators / clients / campaigns | ✅ RLS + endpoint scope checks |
| Owner sees everything | ✅ |
| Push branches to upstream repo | ✅ (collaborator access confirmed) |
| Auto-sync analytics every 12h | ⚠️ Works but doesn't auto-refresh expired tokens |
| Manual analytics refresh from UI | ❌ Not yet wired |
| Public (non-tester) creators connect their socials | ❌ Requires App Review per platform |

---

## Deployment dependencies (what you must do externally)

1. **Apply `SETUP_FROM_SCRATCH.sql`** in Supabase SQL Editor (target project: whichever your `.env` points at).
2. **Set env vars** in `.env` (local) AND Vercel project (deployed):
   - Supabase: `REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - Base: `APP_BASE_URL`
   - Cron: `CRON_SECRET`
   - Email: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
   - TikTok: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`
   - Meta: `META_APP_ID` / `INSTAGRAM_APP_ID` / `FACEBOOK_APP_ID`, plus `*_SECRET`
   - YouTube: `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`
3. **Register redirect URIs** in each provider's developer dashboard — must match `${APP_BASE_URL}/api/auth/<platform>/callback` exactly. See SOCIAL_MEDIA_INTEGRATION.md §4.
4. **Per creator** (until App Review): add their account to each provider's tester list (TikTok Sandbox, Meta App Roles → Testers, Google OAuth consent screen → Test Users).
5. **Rotate keys** if the project still uses the originals that were committed in `VERCEL_DEPLOY.md` (see SECURITY_NOTES.md rotation runbook).

---

## Where to read next

- **For audit / risk context:** `AUDIT.md`
- **For social media setup specifics:** `SOCIAL_MEDIA_INTEGRATION.md`
- **For database migration mechanics:** `supabase/migrations/README.md`
- **For security model + key rotation:** `SECURITY_NOTES.md`
- **For deployment env vars:** `.env.example` + `VERCEL_DEPLOY.md`
