# Omnya Portal — Full System Audit

**Generated:** 2026-05-21
**Scope:** Architecture, data flow, security, database/schema, code quality
**Stack:** React 19 (CRA) + Supabase (Postgres + Auth + RLS) + Vercel (serverless API + cron)
**Branch audited:** `main` @ `8e9b6ca`

---

## 0. Executive Summary

Omnya is a creator-management portal that handles **user auth, social-media OAuth (TikTok / Instagram / YouTube / Facebook / Meta), file uploads to Google Drive, transactional email via Resend, and payouts (money movement)**. The product surface works end-to-end, but the audit found severe gaps in three areas that together make the app **not production-safe** for handling financial data in its current state:

1. **Row-Level Security is effectively off** — every table uses `USING (true)` policies, so the Supabase anon key (which is in the client bundle by design) is functionally a master key.
2. **Money-handling and email endpoints lack server-side authorization** — any authenticated user can mark batches paid, export payouts, or send emails.
3. **Schema and code disagree** in places that will fail in production — `payments.batch_id` and `payout_batches.period_type` are written by the API but not defined in any SQL file; `creator_tokens` is defined twice with conflicting foreign keys.

### Severity counts (deduplicated across audits)

| Severity | Count | Examples |
|---|---|---|
| **Critical** | 9 | Broken RLS, no auth on `mark-paid` / `export` / `get-upload-url` / `send-email`, missing schema columns, Drive access token leaked to browser |
| **High** | 14 | OAuth boilerplate duplication, no PKCE on TikTok, weak OAuth state, no CSRF / CORS lockdown, service-role key used widely, hardcoded owner email, App.js monolith, silent `catch (e) {}` |
| **Medium** | 11 | No token refresh, no rate limiting, no indexes, missing RLS write policies, ad-hoc error shapes, list virtualization, polling without unmount guard, XSS in email templates |
| **Low / Info** | 8 | No tests beyond CRA default, no pre-commit hooks, source-map handling, TikTok verification files (harmless), HSTS / CSP headers absent |

### Top-10 most urgent

| # | Finding | File | Section |
|---|---|---|---|
| 1 | All RLS policies are `USING (true)` — authorization is off | [database_setup.sql:140-147](database_setup.sql#L140-L147) | §3.2 / §4.2 |
| 2 | `api/payouts/mark-paid.js` and `api/payouts/export.js` accept any authenticated caller (creators can mark batches paid) | [api/payouts/mark-paid.js](api/payouts/mark-paid.js), [api/payouts/export.js](api/payouts/export.js) | §3.3 |
| 3 | `api/get-upload-url.js` is unauthenticated and returns a Google Drive access token to the browser | [api/get-upload-url.js](api/get-upload-url.js) | §3.4, §3.10 |
| 4 | `api/send-email.js` is unauthenticated and lets the caller pick recipients — abuse vector for phishing/spam from the brand domain | [api/send-email.js](api/send-email.js) | §3.9 |
| 5 | `payments.batch_id` and `payout_batches.period_type` columns are written by the API but missing from schema — payout flow is one deploy away from breaking | [api/payouts/generate.js](api/payouts/generate.js), [database_update.sql](database_update.sql) | §4.1 |
| 6 | `creator_tokens` table defined twice with conflicting FKs (`auth.users` vs `creators`) | [database_update.sql](database_update.sql), [meta_setup.sql](meta_setup.sql) | §4.1 |
| 7 | Owner role assigned by hardcoded email `shaily@omnyagrowth.com` (no DB audit trail) | [src/App.js:4510](src/App.js#L4510) | §5.5 |
| 8 | OAuth state is just base64(`{userId}`) — no nonce, no CSRF binding, no PKCE on TikTok | [api/auth/*/start.js](api/auth/) | §3.5, §3.6 |
| 9 | `vercel.json` cron auth is a single static `CRON_SECRET` header — no Vercel signature verification | [api/analytics/sync.js:10-15](api/analytics/sync.js#L10-L15) | §3.7 |
| 10 | `App.js` is 5049 lines / 93 `useState` / 56 inline components — recent `f0305a1` and `53244a9` commits show this monolith already ships broken to prod via missing-import ReferenceErrors | [src/App.js](src/App.js) | §2.7, §5.4 |

### Suggested remediation order

1. **Stop the bleeding (this week):** Add role checks + JWT validation to `mark-paid`, `export`, `get-upload-url`, `send-email`. Stop returning the Drive `access_token` to the client. Lock CORS to the portal origin.
2. **Lock RLS down (this week):** Replace `USING (true)` policies with `auth.uid()`-based ownership policies on `payments`, `creator_tokens`, `submissions`, `user_profiles`. Add missing INSERT/UPDATE/DELETE policies on `creator_tokens` and `video_analytics`.
3. **Fix the broken schema (next deploy):** Add `payments.batch_id`, `payout_batches.period_type`, resolve the two `creator_tokens` definitions, add indexes on FKs.
4. **Harden auth (next sprint):** Replace OAuth state with a signed-and-stored nonce, add PKCE to TikTok, implement refresh-token flows, signature-verify Vercel cron.
5. **Refactor (next month):** Split App.js into per-page files, factor OAuth boilerplate, add ESLint `no-undef` + `react-hooks/exhaustive-deps`, real tests for payout and auth.

---

## 1. System Overview

### 1.1 What it does

A portal for managing creators across multiple roles:

- **Creators** — submit concepts/final videos to campaigns, connect TikTok / Instagram / YouTube / Facebook, see their earnings.
- **Account Managers (AMs)** — review submissions, manage assigned creators and clients.
- **Owners** — approve new users, manage all clients/campaigns/AMs, generate and pay out batches.

### 1.2 Actors and trust boundaries

```
┌─ Browser (React SPA, public Supabase anon key) ────────────────────────┐
│  AuthContext → Supabase Auth (JWT in localStorage)                     │
│  Direct table queries via @supabase/supabase-js (RLS-enforced)         │
│  fetch() → /api/* with Authorization: Bearer <user JWT>                │
└────────────────┬───────────────────────────────────────────────────────┘
                 │
┌────────────────▼ Vercel serverless (/api/*) ───────────────────────────┐
│  Most endpoints use SUPABASE_SERVICE_ROLE_KEY → bypasses RLS           │
│  → endpoints MUST do their own authz; today most don't                 │
└────────┬──────────────┬──────────────┬──────────────┬─────────────────┘
         │              │              │              │
    Supabase       Resend         Google           TikTok / Meta /
    Postgres        email          Drive           YouTube OAuth + APIs
   (single DB,    (transactional) (service-acct    (per-creator tokens
   RLS broken)                     refresh token)   in creator_tokens)
```

The trust boundary that matters most: **the SPA → API hop**. The SPA is fully untrusted; the API is the only place where authz can be enforced because RLS is currently a no-op (§4.2). Today, most API endpoints fail to do that authz.

### 1.3 Major flows (covered in detail in §2.3)

1. Signup → email verify → owner approves → role-scoped dashboard.
2. Creator connects social platform → OAuth callback writes to `creator_tokens` → analytics fetch enabled.
3. Cron (every 12h) → `api/analytics/sync` → per-platform fetch → upsert `video_analytics`.
4. Owner generates payout batch → exports CSV → marks paid → Resend emails creators.
5. Owner uploads campaign brief → resumable upload to Google Drive → URL stored on campaign.

---

## 2. Architecture & Data Flow

### 2.1 Module map

**Frontend (`src/`)**

| File | Responsibility |
|---|---|
| [src/index.js](src/index.js) | React 19 entry; StrictMode. |
| [src/App.js](src/App.js) (5049 lines) | Monolith. Routing-by-state, 56 inline components (Login, Sidebar, OwnerDashboard, AMDashboard, ReviewQueue, CampaignsPage, CampaignDetail, ClientsPage, ContentLibrary, PaymentManagement, PendingUsers, CreatorsManage, ResetPassword, SQLSetupModal, …), all `useState`/`useEffect` for auth, db, page, polling, realtime subscriptions. |
| [src/contexts/AuthContext.js](src/contexts/AuthContext.js) | `useAuth()` hook. Wraps Supabase session, fetches `user_profiles`, normalizes `account_manager` → `am`. |
| [src/components/Guards/RequireRole.js](src/components/Guards/RequireRole.js) | Role guard. **Bug:** line 11 checks `profile.status`, which is not a column in `user_profiles` — guard is non-functional (§5.5). |
| [src/supabaseClient.js](src/supabaseClient.js) | Singleton Supabase client. Hardcoded URL + anon key as env fallback (§3.1). |
| [src/utils.js](src/utils.js) (24 lines) | `getAvatarColor`, `getInitials`, `fmtDate`, `fmtMoney`, `fmtNum`, `statusBadge`, `scoreColor`. |
| [src/AnalyticsDashboard.js](src/AnalyticsDashboard.js) | Per-creator analytics view; reads `video_analytics`. |
| [src/CreatorConnections.js](src/CreatorConnections.js) | OAuth-connect UI. Queries `creator_tokens` by `user_id` — but `meta_setup.sql` defines the table with `creator_id` (§4.8). |
| [src/PayoutManager.js](src/PayoutManager.js) | Owner UI for payout batches. Hardcoded `periodType: 'custom'` (commit `a46bd61`) is a workaround for an undefined column. |
| [src/Legal.js](src/Legal.js) | Terms/Privacy. |
| [src/pages/CreatorDashboard.js](src/pages/CreatorDashboard.js) | Creator dashboard (largely superseded by inline App.js components). |

**Serverless API (`api/`)**

| File | Responsibility | Notes |
|---|---|---|
| `api/analytics/fetch.js` | Single-video analytics fetch. | Calls per-platform code; mocks for some. |
| `api/analytics/refresh.js` | Token refresh. | Largely unused; refresh not wired into sync. |
| `api/analytics/sync.js` | Cron (every 12h via vercel.json). Batches all submissions, dispatches per-platform sync. | §3.7 (auth), §3.15 (logs leak user_id). |
| `api/analytics.js` | Top-level handler (placeholder?). | Possibly dead. |
| `api/auth/{tiktok,facebook,instagram,meta,youtube}/start.js` | Build OAuth URL, redirect. | Duplicated boilerplate (§5.3). |
| `api/auth/{tiktok,instagram,youtube,meta}/callback.js` | Exchange code for token, upsert `creator_tokens`. | No PKCE on TikTok (§3.6); weak state (§3.5). |
| `api/auth/disconnect.js` | Delete token. | Auth check needed. |
| `api/payouts/generate.js` | Create batch. Writes `period_type` (not in schema) and `payments.batch_id` (not in schema). | §4.1, §3.3. Has role check ✓. |
| `api/payouts/export.js` | CSV of batch. | **No auth/role check.** §3.3. |
| `api/payouts/mark-paid.js` | Mark batch paid, send emails. | **No auth/role check.** §3.3. |
| `api/send-email.js` | Resend proxy. Templates: `new_submission`, `revision_requested`, `final_approved`, `payment_sent`, `campaign_assigned`, `user_approved`, `user_signup_waiting_approval`, `supabase_auth`. | **Unauthenticated, caller-controlled recipients.** §3.9. |
| `api/get-upload-url.js` | Returns Drive resumable upload URL + access token. | **Unauthenticated, returns access token to browser.** §3.4, §3.10. |
| `api/upload-to-drive.js` | Direct multipart upload, makes file public. | Auth check needed. |

### 2.2 State architecture

- Global: `AuthContext` (user, profile, loading).
- App-level (in App.js): `page` (string, persisted in `localStorage.last_page`), `user`, `db` (one giant object: `{creators[], clients[], campaigns[], submissions[], payments[], accountManagers[], userProfiles[]}`), plus 90 other `useState` variables.
- No state-management library (Redux/Zustand/SWR/React Query). Every component does Supabase mutations directly; cache invalidation is "call `loadDB()` again". No request deduplication, no optimistic updates.
- Routing: **no React Router**; conditional render on `page` string against per-role nav arrays. The vercel.json catch-all rewrite ensures direct URL hits land on index.html, which then reads `?page=` from the URL.

### 2.3 Critical data flows

**A — Signup → email verify → dashboard**

```
1. Login component → supabase.auth.signUp(email,pw)
2. Supabase Auth → /api/send-email (type: supabase_auth) → Resend
3. User clicks link → onAuthStateChange fires
4. AuthContext.fetchProfile → user_profiles row
5. App.js handleLogin (line 4814):
   • INSERT user_profiles if missing (role defaults to 'pending';
     special case: email in hardcoded ['shaily@omnyagrowth.com'] gets 'owner')
   • Sends 'user_signup_waiting_approval' email
   • Starts a 10s setInterval polling for role !== 'pending' (NOT cleared
     on unmount/logout — leak risk, §5.1)
6. Owner approves in PendingUsers component → UPDATE user_profiles.role
7. Poll detects change → re-fetch profile → land on role-appropriate page
```

**B — OAuth connect (TikTok)**

```
1. /api/auth/tiktok/start
   • state = base64(JSON.stringify({userId}))   ← no nonce, no PKCE
   • Redirect to TikTok consent screen
2. TikTok → /api/auth/tiktok/callback?code=X&state=Y
   • Decode state, exchange code → access_token + refresh_token
   • Upsert creator_tokens (user_id, platform=tiktok, …)
3. Redirect to /?page=social-connections&success=tiktok
```

The shape is identical for Instagram/YouTube/Meta — see §5.3 for duplication scale. Instagram has no dedicated callback; it piggybacks on `meta/callback`.

**C — Analytics sync cron**

```
Vercel cron → POST /api/analytics/sync (Authorization: Bearer CRON_SECRET)
  1. Fetch all creator_tokens where access_token IS NOT NULL
  2. Fetch all submissions where posted_link IS NOT NULL AND type='Final Post'
  3. Extract video_id from posted_link via regex (TikTok /video/(\d+), IG /p/…)
  4. Group by (user_id, platform), join tokens
  5. Per group:
     • TikTok: POST /v2/video/query (batches of 20)
     • YouTube: GET /youtube/v3/videos?part=statistics
     • Meta/IG: graph.facebook.com/v19.0 — accounts → media → insights
  6. Upsert video_analytics ON CONFLICT (video_id, platform)
  7. Token expiry only checked for TikTok; no refresh on 401 anywhere
     (§3.18, comment on sync.js:101 admits this gap)
```

**D — Payout flow**

```
1. PayoutManager → "Generate New Batch"
   POST /api/payouts/generate { periodStart, periodEnd, periodType:'custom' }
   • Role check: owner | am | account_manager  ✓
   • Idempotency on (period_start, period_end, period_type)
   • period_type is NOT in schema — this column gets implicitly created or
     the insert silently drops the field. Why 'custom' was the magic value
     in commit a46bd61: it's the only value that survives whatever
     constraint actually exists in prod.
   • Query payments WHERE status='Pending' AND created_at BETWEEN [start,end]
   • payments.batch_id = newBatch.id  ← column not in schema (§4.1)
   • Sum amount_owed → payout_batches.total_amount

2. "Download CSV" → GET /api/payouts/export?batchId=X
   • NO AUTH CHECK (§3.3) — any user can grab any batch
   • Returns Creator Name, Payout Email, Preference, Amount, Status

3. "Mark Paid" → POST /api/payouts/mark-paid { batch_id }
   • NO AUTH CHECK (§3.3) — any creator can mark any batch paid
   • UPDATE payout_batches.status='paid'
   • UPDATE payments.status='Paid'
   • For each payment, POST /api/send-email (payment_sent)
   • No audit trail (who, when, from what IP)
```

**E — Drive upload**

```
POST /api/get-upload-url  ← UNAUTHENTICATED, CORS: *
  • Resumable upload init against drive.google.com
  • Returns { uploadUrl, accessToken } ← access token to browser (§3.10)
Frontend PUTs file to uploadUrl
POST /api/upload-to-drive  ← also needs auth, sets public permissions
```

**F — Email**

`api/send-email.js` accepts `{ type, data }`, no JWT check, hardcoded `portalUrl = 'https://www.portalomnyagrowth.com'`. Returns 200 even on Resend errors, so the frontend can't distinguish success from silent failure.

### 2.4 Realtime

App.js subscribes to `postgres_changes` on every major table (`sync_creators`, `sync_clients`, etc.) and patches the `db` object in place. Subscriptions are cleaned up on user logout, but not always on component unmount paths.

### 2.5 External integrations

| Service | Where wired | Env vars |
|---|---|---|
| Supabase | `supabaseClient.js`, every API endpoint | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_ANON_KEY` |
| TikTok | `api/auth/tiktok/*`, `api/analytics/sync.js` | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` |
| Instagram / Meta | `api/auth/{instagram,meta}/*`, `sync.js` | `INSTAGRAM_CLIENT_ID/SECRET`, `FACEBOOK_APP_ID/SECRET` |
| YouTube | `api/auth/youtube/*`, `sync.js` | `YOUTUBE_CLIENT_ID/SECRET` |
| Facebook | shares Meta flow | (same) |
| Resend | `api/send-email.js` | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` |
| Google Drive | `api/get-upload-url.js`, `api/upload-to-drive.js` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` |
| Anthropic | Referenced in README; `fetchAIInsights` calls `/api/ai-insights` which **doesn't exist** (§5.2) | `ANTHROPIC_API_KEY` |
| Vercel Cron | `vercel.json` → `/api/analytics/sync` 0 */12 * * * | `CRON_SECRET` |

### 2.6 Cross-cutting

- **Error handling:** try/catch with `setMessage({text,type:'error'})` on the client; API returns mix of 200/400/401/403/500 and sometimes redirects. No unified error shape.
- **Loading:** `loading`, `dbLoading`, `working`, `submitting`, `saving`, `loadingStatus` — ad hoc per component.
- **ErrorBoundary:** defined inline in App.js around line 4994.
- **Logging/observability:** `console.log` only. No Sentry / Datadog / structured logs.
- **Environment:** the only `.env` documented is the README; no `.env.example` for engineers cloning the repo.

### 2.7 Architectural risks

1. **App.js is unmaintainable.** 56 inline components, 93 `useState`, 11 `useEffect`. Recent commits `f0305a1` ("import missing page components to resolve ReferenceErrors causing blank pages") and `53244a9` ("Import utility helper functions to resolve getAvatarColor ReferenceError") prove the codebase already ships broken to prod via missing-import runtime errors. There's nothing structural preventing this from happening again.
2. **No state management.** Direct `supabase.from(...)` calls scattered across components → race conditions, stale data, refetch storms (every `onRefresh` calls `loadDB()` which re-fetches all tables).
3. **OAuth duplication.** 4 platforms × 2 endpoints × ~50 lines of boilerplate. Bug fixes don't propagate (e.g. only TikTok has token-expiry checks).
4. **No layer between UI and DB.** Mutations live wherever they're triggered. No service layer means RLS is the only intended safety net — and RLS is broken (§4.2).
5. **No migration system.** SQL files are run manually, order undocumented; `creator_tokens` is defined twice (§4.1).
6. **Hardcoded portal URL** (`send-email.js:13`) blocks multi-env deploys.

---

## 3. Security Findings

Severities use the convention: **Critical** = exploitable today, financial/data impact; **High** = exploitable with modest effort or once a Critical is fixed; **Medium** = defensive gap; **Low** = hygiene.

### 3.1 Supabase anon key + URL hardcoded in source — **High** (Critical in combination with §3.2)

[src/supabaseClient.js:3-4](src/supabaseClient.js#L3-L4), also duplicated in [src/AnalyticsDashboard.js](src/AnalyticsDashboard.js), [src/CreatorConnections.js](src/CreatorConnections.js), [src/PayoutManager.js](src/PayoutManager.js), [src/pages/CreatorDashboard.js](src/pages/CreatorDashboard.js).

```js
export const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || "https://aglikzyarmqbdmjvkvyj.supabase.co";
const SUPABASE_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY || "eyJhbGc…";
```

**Nuance:** Supabase anon keys are *designed* to be public — they identify the project and the anon role, and RLS is the layer that gates access. So the anon key being in the bundle is normal. **What's wrong here is:** (a) it's committed to git as a fallback, so it's in history forever and can't be rotated without a code change, (b) it's duplicated in 5 files so any rotation is error-prone, and (c) combined with §3.2, this anon key is effectively a master key today.

**Fix:** Remove all hardcoded fallbacks, fail loudly at startup if env vars are missing, rotate the key once RLS is fixed.

### 3.2 RLS policies are `USING (true)` on every table — **Critical**

[database_setup.sql:140-147](database_setup.sql#L140-L147)

```sql
create policy "Allow all" on user_profiles for all using (true) with check (true);
-- ... and the same line repeated for every other table
```

Every authenticated user can SELECT/INSERT/UPDATE/DELETE every row in:
- `user_profiles` (incl. roles — privilege escalation)
- `creators`, `account_managers`, `clients`, `campaigns`, `submissions`
- `payments`, `payout_batches`, `payout_line_items` (money)
- `creator_tokens` (OAuth access + refresh tokens for every connected creator)
- `messages`

The Supabase JS client respects these policies, so the attack is trivially: open DevTools → call `supabase.from('payments').update({status:'Paid'}).eq('id','<any id>')`.

**Fix:** Replace with `auth.uid()`-scoped policies. See §4.2 for a per-table policy matrix.

### 3.3 No authorization on `mark-paid`, `export`, and weak checks on `generate` — **Critical**

- [api/payouts/mark-paid.js](api/payouts/mark-paid.js): verifies the caller's JWT but doesn't read `user_profiles.role`. Any creator can `POST { batch_id }` and mark a batch paid.
- [api/payouts/export.js](api/payouts/export.js): no auth or role check at all. Returns CSV with creator emails + payment amounts.
- [api/payouts/generate.js:31-35](api/payouts/generate.js#L31-L35): checks role `∈ {owner, am, account_manager}` ✓, but doesn't bind the batch to the caller's organization — an AM can generate a batch covering all creators including ones not assigned to them.

**Fix:** All three endpoints must (a) verify JWT, (b) look up the caller's role from `user_profiles`, (c) verify ownership of the batch/period. Add an audit row (`marked_paid_by`, `marked_paid_at`) so reversals are possible.

### 3.4 `get-upload-url` is unauthenticated and CORS `*` — **Critical**

[api/get-upload-url.js](api/get-upload-url.js): no JWT check, `Access-Control-Allow-Origin: *`, no file-size or MIME validation, no rate limit. Anyone on the internet can hit it.

### 3.5 OAuth state is `base64({userId})` — no CSRF binding — **Critical**

[api/auth/tiktok/start.js](api/auth/tiktok/start.js), [api/auth/meta/start.js](api/auth/meta/start.js), and the rest follow the same pattern. State should be a random nonce stored server-side (Redis/Vercel KV) and verified on callback. Right now anyone who knows a user's UUID can forge a valid state.

### 3.6 TikTok OAuth missing PKCE — **Critical** per TikTok's own policy

[api/auth/tiktok/start.js](api/auth/tiktok/start.js), [api/auth/tiktok/callback.js:30-40](api/auth/tiktok/callback.js#L30-L40). PKCE is mandatory for SPA/public clients in TikTok's v2 OAuth. Add `code_challenge` (S256 of a `code_verifier`) on start and `code_verifier` on token exchange.

### 3.7 Cron secret is a static bearer token — **Critical**

[api/analytics/sync.js:10-15](api/analytics/sync.js#L10-L15). `if (authHeader !== \`Bearer ${process.env.CRON_SECRET}\`)`. There's no Vercel signature, no replay protection, no rate cap. If the secret leaks (it's set in Vercel and visible to every team member), an attacker can trigger the sync infinitely — exhausting TikTok/IG/YouTube quotas and amplifying any sync bug.

### 3.8 `creator_tokens` lacks INSERT/UPDATE/DELETE policies — **Critical**

[meta_setup.sql](meta_setup.sql) defines a SELECT policy only. Without WITH CHECK policies for write operations, either (a) writes are blocked entirely (broken OAuth) or (b) the API uses service-role and bypasses RLS (current state) — in which case the SELECT policy is irrelevant too because everything reads via service-role. Add explicit per-operation policies scoped to `auth.uid() = user_id` and audit which call sites actually need service-role.

### 3.9 `api/send-email.js` is unauthenticated with caller-controlled `to` — **Critical**

[api/send-email.js](api/send-email.js). Anyone can `POST { type:'user_approved', data:{ userEmail:'victim@…', displayName:'Admin', role:'owner' } }` and Resend will dispatch the email from the omnya domain. This is a phishing kit. Add JWT auth + look up the recipient server-side (never trust caller-supplied addresses) + per-user rate limit.

### 3.10 Drive access token leaked to browser — **Critical**

[api/get-upload-url.js:49-52](api/get-upload-url.js#L49-L52) returns `{ uploadUrl, accessToken }`. The access token is broadly scoped on the shared Drive service account. Browser code (or any caller of the endpoint) can hit `https://www.googleapis.com/drive/v3/files` directly and read/modify any file the service account owns.

**Fix:** Return only the `uploadUrl` (Drive resumable URLs are themselves capability tokens scoped to the specific upload, which is fine). Never expose `tokenData.access_token`.

### 3.11 No redirect_uri validation in OAuth callbacks — **High**

All `api/auth/*/start.js` hardcode redirect_uri, but no callback verifies the response was actually issued for our app. Combined with §3.5, this widens the CSRF surface.

### 3.12 Service-role key used in most API endpoints — **High**

`SUPABASE_SERVICE_ROLE_KEY` is used in `mark-paid`, `generate`, `export`, `sync`, every OAuth callback, `disconnect`. It bypasses RLS, which means any missing authz check (§3.3, §3.9) inherits full database access. Prefer creating user-scoped clients (forward the user JWT) for endpoints that don't need to write across users.

### 3.13 No rate limiting anywhere — **High**

No endpoint has per-IP or per-user rate limiting. Send-email, OAuth callbacks, upload URLs, sync — all spammable. Add Upstash/Vercel KV-backed limits.

### 3.14 CORS / CSRF — **High**

Several endpoints set `Access-Control-Allow-Origin: *` or echo `req.headers.origin`. Combined with Supabase storing the JWT in localStorage (accessible to any same-origin JS), any XSS or any caller from another origin can act as the logged-in user. Lock CORS to `https://www.portalomnyagrowth.com` and add a CSRF token for state-changing endpoints.

### 3.15 Analytics sync logs `user_id` on error — **High** (privacy/info-disclosure)

[api/analytics/sync.js:101](api/analytics/sync.js#L101). Vercel logs are accessible to the whole team and may be aggregated externally. Structured-log with redaction; never log full UUIDs alongside platform identifiers.

### 3.16 Hardcoded owner email — **High** (privilege escalation if email is compromised)

[src/App.js:4510](src/App.js#L4510): `if (['shaily@omnyagrowth.com'].includes(user.email)) rawRole = "owner";`. There is no DB trail of who was promoted; an attacker who compromises this mailbox auto-becomes owner on next signup. Owner role should be set explicitly in the DB by an existing owner only.

### 3.17 Silent error swallowing — **High**

[src/App.js:4464](src/App.js#L4464): `catch (e) {}` in the password reset path. User sees no feedback when reset fails. Multiple similar patterns elsewhere — see §5.1.

### 3.18 No token refresh — **Medium**

Tokens are stored with `expires_at` but no refresh path is wired into `sync.js`. The code at `sync.js:101` even has a comment acknowledging the gap ("Here you would normally detect 401s and trigger token refresh logic"). After a few hours/days, analytics silently goes stale per creator with no UX signal.

### 3.19 XSS-via-email-template — **Medium**

[api/send-email.js:117-118](api/send-email.js#L117-L118) interpolates user-controlled fields (e.g. `data.description`) directly into HTML strings. Resend doesn't execute JS, but layout injection / phishing-link injection is trivial. Escape with a template engine.

### 3.20 Vercel SPA rewrite — **Low**

[vercel.json:31](vercel.json#L31) regex `/((?!api|static|.*\\..*).*)` works (commit `8e9b6ca` fixed an earlier blank-screen incident). One residual concern: source maps. Set `GENERATE_SOURCEMAP=false` in the build script to avoid shipping originals.

### 3.21 Missing security headers — **Low**

`vercel.json` sets none. Add: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Content-Security-Policy` (start permissive, tighten).

### 3.22 TikTok verification files — **Info**

The four `public/tiktok*.txt` files are platform domain-verification artifacts. Harmless.

---

## 4. Database & Schema

### 4.1 Schema inventory + critical mismatches

Defined across `database_setup.sql` (147 lines), `database_update.sql` (45), `analytics_setup.sql` (32), `meta_setup.sql` (28), `fix_role_constraint.sql` (9). No migration runner — files are pasted into Supabase SQL Editor in undocumented order.

Tables (truncated to flag issues):

| Table | Source | Key issues |
|---|---|---|
| `user_profiles` | database_setup.sql:4 | `role` check constraint redefined in `fix_role_constraint.sql` (no-op? — same value set). Frontend `RequireRole.js:11` reads `profile.status` which **doesn't exist** on this table. |
| `creators` | database_setup.sql:22 | No CASCADE on FK to `auth.users`/`account_managers`. |
| `account_managers` | database_setup.sql:13 | — |
| `clients` | database_setup.sql:38 | — |
| `campaigns` | database_setup.sql:55 | `assigned_creators uuid[]` — denormalized; should be a junction table for proper indexing. |
| `submissions` | database_setup.sql:71 (+ALTER in database_update.sql:43) | `payout_batch_id` added via ALTER. |
| `payments` | database_setup.sql:91 | **Missing `batch_id` column**, but `api/payouts/generate.js:75` writes to it. Either the table was altered out-of-band in prod or the write silently fails. |
| `messages` | database_setup.sql:106 | `user_id` is plain UUID, not FK. |
| `creator_tokens` (v1) | database_update.sql:2 | FK to `auth.users(id)`. UNIQUE `(user_id, platform)`. |
| `creator_tokens` (v2) | meta_setup.sql:2 | **Duplicate table name**, FK to `creators(id)`, UNIQUE `(creator_id, platform)`. The second `CREATE TABLE IF NOT EXISTS` is silently no-op, so whichever ran first wins. Frontend queries by `user_id` — works iff v1 won. |
| `payout_batches` | database_update.sql:18 | **Missing `period_type` column**, but `api/payouts/generate.js:42,53` reads and writes it (and commit `a46bd61` shows the value had to be `'custom'` to satisfy a check constraint — which check constraint?). `status` has no CHECK; API writes both `'Pending'` and `'Paid'` (capitalized) but the schema default is `'draft'` (lowercase). |
| `payout_line_items` | database_update.sql:28 | **Never queried** anywhere in frontend or API. Dead schema. |
| `video_analytics` | analytics_setup.sql:2 | UNIQUE on `submission_id` means each new sync overwrites the prior snapshot — analytics *history* is lost; only the most recent pull survives. |

**Top fixes:**

```sql
-- Critical: align schema with API
ALTER TABLE payments ADD COLUMN batch_id UUID REFERENCES payout_batches(id);
ALTER TABLE payout_batches ADD COLUMN period_type TEXT;
ALTER TABLE payout_batches ADD CONSTRAINT payout_batches_status_chk
  CHECK (status IN ('draft','pending','paid'));

-- Pick one creator_tokens definition; drop the other; backfill data.
-- (Investigate prod first to see which is live.)

-- Decide whether to retain analytics history. If yes:
ALTER TABLE video_analytics DROP CONSTRAINT video_analytics_submission_id_key;
-- and add a (submission_id, pulled_at) index instead.
```

### 4.2 RLS matrix

| Table | RLS on | SELECT | INSERT | UPDATE | DELETE | Verdict |
|---|---|---|---|---|---|---|
| user_profiles | ✓ | `true` | `true` | `true` | `true` | **Critical** |
| creators | ✓ | `true` | `true` | `true` | `true` | **Critical** |
| account_managers | ✓ | `true` | `true` | `true` | `true` | **High** |
| clients | ✓ | `true` | `true` | `true` | `true` | **High** |
| campaigns | ✓ | `true` | `true` | `true` | `true` | **High** |
| submissions | ✓ | `true` | `true` | `true` | `true` | **High** |
| payments | ✓ | `true` | `true` | `true` | `true` | **Critical** |
| messages | ✓ | `true` | `true` | `true` | `true` | **Medium** |
| creator_tokens | ✓ | `creators.user_id = auth.uid()` (meta_setup.sql) | **missing** | **missing** | **missing** | **Critical** — writes work only via service-role |
| video_analytics | ✓ | `creators.user_id = auth.uid()` | **missing** | **missing** | **missing** | **High** — cron writes only via service-role |
| payout_batches | ✓ | `true` | `true` | `true` | `true` | **Critical** |
| payout_line_items | ✓ | `true` | `true` | `true` | `true` | (Dead table.) |

Recommended baseline (`payments` shown):

```sql
DROP POLICY "Allow all" ON payments;

CREATE POLICY payments_select ON payments FOR SELECT USING (
  EXISTS (SELECT 1 FROM creators c WHERE c.id = payments.creator_id AND c.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','am','account_manager'))
);

CREATE POLICY payments_modify ON payments FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','am','account_manager'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('owner','am','account_manager'))
);
```

Apply analogous policies to every table.

### 4.3 Indexes

**None.** Every FK is unindexed. Hot paths that table-scan today:

- `submissions.creator_id` / `.campaign_id` / `.payout_batch_id`
- `payments.creator_id` / `.batch_id`
- `video_analytics.creator_id` / `.campaign_id` / `.submission_id` — cron upserts every 12h
- `creator_tokens.user_id` (or `.creator_id`)
- `creators.am_id`

Minimum index set:

```sql
CREATE INDEX idx_submissions_creator_id ON submissions(creator_id);
CREATE INDEX idx_submissions_campaign_id ON submissions(campaign_id);
CREATE INDEX idx_submissions_payout_batch_id ON submissions(payout_batch_id);
CREATE INDEX idx_payments_creator_id ON payments(creator_id);
CREATE INDEX idx_payments_batch_id ON payments(batch_id);
CREATE INDEX idx_video_analytics_creator_id ON video_analytics(creator_id);
CREATE INDEX idx_video_analytics_submission_id ON video_analytics(submission_id);
CREATE INDEX idx_creator_tokens_user_id ON creator_tokens(user_id);
CREATE INDEX idx_creators_am_id ON creators(am_id);
```

### 4.4 Constraints

- `user_profiles.role` — CHECK constraint OK after `fix_role_constraint.sql`.
- `payout_batches.status` — **no CHECK**, casing inconsistent across writes.
- `submissions.payment_status`, `creators.status`, `creators.payment_status` — free-form text, no constraint. Typos pass silently and break filters.
- `campaigns.assigned_creators uuid[]` — no constraint that elements actually exist in `creators.id`.

### 4.5 Migrations hygiene

No migrations table, no order documented, no rollback, no idempotency on ALTERs. Adopt Supabase Migrations or sqitch/flyway. Until then, document order in the README and add a `schema_migrations` audit table.

### 4.6 Data lifecycle

- `creator_tokens` — expired tokens never deleted.
- `video_analytics` — UNIQUE(submission_id) destroys history; either drop the constraint (keep timeline) or move snapshots to a sidecar table.
- `payout_line_items` — dead, never read.
- No soft deletes anywhere; deleting a creator orphans submissions and payments without cascade.

### 4.7 Frontend ↔ DB contract drift

| What the code does | What the schema says | Effect |
|---|---|---|
| `RequireRole.js:11` reads `profile.status` | No `status` column on `user_profiles` | Guard always falls back, often non-functional |
| `CreatorConnections.js:50` queries `creator_tokens.user_id` | meta_setup.sql defines `creator_id` | Works only if v1 of the duplicate table ran first |
| `payouts/generate.js:75` writes `payments.batch_id` | No `batch_id` column in schema | Silent drop or runtime failure |
| `payouts/generate.js:42,53` reads/writes `payout_batches.period_type` | Column not defined | Same |
| `App.js` calls `/api/ai-insights` (via `fetchAIInsights`) | Endpoint doesn't exist | 404 at runtime |

### 4.8 `creator_tokens` schism

The two definitions disagree on the most important question: **what is a token bound to?** A `user_id` (then every Supabase user owns their own tokens, which is how the frontend treats it) or a `creator_id` (then only creators get tokens, AMs/owners can't, and the FK enforces it)? Pick one. The current state means OAuth flows work iff the v1 file ran first; the v2 RLS policy then attaches to the wrong table — neither part of the system is doing what it looks like it's doing.

### 4.9 Audit trail / reversibility

Payouts have no audit row. Once `mark-paid.js` runs, there is no record of who clicked the button, when, or from what IP. Add a `payout_audit_log` table populated from the endpoint.

---

## 5. Code Quality, Bugs & Dead Code

### 5.1 Bug-prone patterns

**Silent catches** ([src/App.js:4464](src/App.js#L4464))
```js
catch (e) {}
```
Password-reset failures are invisible to the user.

**Polling without unmount cleanup** ([src/App.js:4952-4967](src/App.js#L4952-L4967))
A 10s `setInterval` polling for `role !== 'pending'`. Cleared only if the user role is still `pending`; if they log out or role changes mid-cycle, the interval keeps firing and calls `setUser` on an unmounted tree.

**`mounted` ref used in only one place** ([src/App.js:4559](src/App.js#L4559))
Auth init uses it. Every other async useEffect (lines 4581, 4611, 4956, 4974) lacks the same guard.

**Hardcoded 5-second timeout overwrites status messages** ([src/App.js:4566-4572](src/App.js#L4566-L4572))
`setLoadingStatus("")` wipes any in-flight error, leaving the user with no feedback when auth init times out.

**`Promise.all` in `api/payouts/generate.js:78`** — if a single payment update fails, the entire batch operation reports failure with no partial-success info.

**Inconsistent fetch error handling** — `api/auth/youtube/callback.js:30-36` calls `.json()` without checking `response.ok`. A 401 response with a JSON error body will not throw and will be treated as success.

### 5.2 Dead / undefined code

- **`fetchAIInsights` and `AIInsightsPanel`** ([src/App.js:654,685](src/App.js#L654)) — defined and called within an inline component, but the `/api/ai-insights` endpoint doesn't exist. Either remove or implement. 77 lines of unused AI logic.
- **`showBypass` state** ([src/App.js:4516](src/App.js#L4516)) — initialized, never set, never read. Leftover from auth bypass testing.
- **`useCallback` imported but never used** ([src/App.js:2](src/App.js#L2)).
- **`api/analytics.js`** — exists at the top level but appears to be a placeholder; `fetch.js` and `sync.js` are the live endpoints.
- **`payout_line_items`** table — never queried (§4.1).

### 5.3 OAuth duplication

4 platforms × `start.js` + `callback.js`, ~50-65 lines each. ~200-250 lines of copy-paste with subtle drift (only TikTok checks `expires_at`; Meta doesn't store `refresh_token`; Instagram lacks a dedicated callback). Factor into:

```js
// api/auth/_handler.js
export function createCallback({ tokenEndpoint, tokenBody, platformId }) { /* ... */ }
```

Each callback then becomes 5-10 lines of config.

### 5.4 App.js monolith

- **5049 lines, 93 `useState`, 11 `useEffect`, 56 inline components.**
- **22 inline JSX blocks > 50 lines.**
- Most components live nowhere else and are only callable through the one `App` render tree.

Concrete extraction plan (file:line ranges from the audit):

| Extract to | From App.js lines |
|---|---|
| `src/components/{ErrorBoundary,Spinner,ErrorMsg,Sidebar,Login,SetupScreen,ResetPassword,SQLSetupModal}.js` | 637-1230, 3992-4180, 4438-4501 |
| `src/pages/AMDashboard.js` | 1789-1860 |
| `src/pages/ReviewQueue.js` | 1861-2063 |
| `src/pages/MyCreators.js` | 2064-2106 |
| `src/pages/CampaignsPage.js` | 2107-2190 |
| `src/pages/CampaignDetail.js` | 2191-2475 |
| `src/pages/ClientsPage.js` + `ClientProfile.js` | 2709-2900 |
| `src/pages/ContentLibrary.js` | 2901-2953 |
| `src/pages/Analytics.js` | 2954-2992 |
| `src/pages/OwnerDashboard.js` | 2993-3191 |
| `src/pages/PaymentManagement.js` | 3192-3563 |
| `src/pages/RevenueAnalytics.js` | 3673-3839 |
| `src/pages/TeamPerformance.js` | 3840-3991 |
| `src/pages/PendingUsers.js` | 4181-4285 |
| `src/pages/CreatorsManage.js` | 4286-4437 |
| `src/hooks/{useAuthInit,usePageSync,useRolePoll,useDB}.js` | 4528-4664, 4765-4864, 4952-4967 |

End state: App.js ≈ 300 lines of routing + provider boilerplate.

### 5.5 Latent ReferenceErrors

Recent commits `f0305a1` and `53244a9` both fixed runtime ReferenceErrors caused by missing imports. The current ESLint config is just `react-app` defaults, which **does not catch undefined references at the project level** as errors. Enable:

```json
"eslintConfig": {
  "extends": ["react-app", "react-app/jest"],
  "rules": {
    "no-undef": "error",
    "no-unused-vars": "warn",
    "react-hooks/exhaustive-deps": "warn",
    "react-hooks/rules-of-hooks": "error",
    "no-console": ["warn", { "allow": ["error","warn"] }]
  }
}
```

Make CI fail on lint errors; add Husky pre-commit to run `eslint --max-warnings 0` on changed files.

Also: `RequireRole.js:11` reads `profile.status` which doesn't exist (§4.7) — that's not a ReferenceError but the same family of "code references a name that isn't defined where you think it is" bug.

### 5.6 Error-handling consistency

API endpoints return:
- 200 with `{ skipped: true }` ([send-email.js:224,275,283](api/send-email.js#L224))
- 405 / 401 / 403 / 400 / 200 (correct, in [payouts/generate.js](api/payouts/generate.js))
- 302 redirect with `?error=…` ([tiktok/callback.js:9,47,64](api/auth/tiktok/callback.js#L9))
- 302 redirect mixed with JSON ([meta/callback.js:26,42](api/auth/meta/callback.js#L26))

Standardize on:
```json
{ "ok": true, "data": {...} }   // success
{ "ok": false, "error": { "code": "FORBIDDEN", "message": "..." } }  // failure
```
For OAuth callbacks (which must redirect), use a single `?error=<code>` convention.

### 5.7 Tests

- [src/App.test.js](src/App.test.js): 8 lines, CRA's default "renders learn react link" — the app has no such link; the test would not pass. Effectively zero coverage.
- No coverage on auth init, OAuth, payout generation, RLS expectations, role guards. Minimum viable test plan:

1. `useAuthInit` happy path + timeout (jest, mocked Supabase).
2. `/api/payouts/generate` (unit): role check, idempotency, sum math.
3. OAuth state encode/decode (when replaced with signed nonces, this becomes important).
4. `RequireRole` guard for each role.

### 5.8 Build / deploy

- `vercel.json` rewrite works after `8e9b6ca`. Verify the regex against any new file types you add (anything without a `.` or not under `/api`/`/static` becomes index.html).
- Build with `GENERATE_SOURCEMAP=false` for prod.
- No CSP or security headers — add via `vercel.json` `headers` block.

### 5.9 Performance smells

- Every fetch is `select('*')` with no `limit/offset`. ReviewQueue, ContentLibrary, PaymentManagement all paginate-by-rendering.
- `getRetentionScore` (App.js:2679) is recomputed on every render in O(n²) over clients.
- `loadDB()` triggered from many `onRefresh` callbacks with no debounce → refetch storms.
- `useCallback` is imported but unused; handlers are recreated every render, blowing past memoization on any child that uses `React.memo` (none currently do, but adding any later won't help).
- Realtime + `loadDB` together can double-fetch on every mutation.

### 5.10 Lint / format / hooks

- ESLint: only CRA defaults.
- No Prettier, no editorconfig, no Husky/lint-staged.
- 27 `console.log/error` calls left in `src/**`. Some are useful (auth init traces), but they should be behind a `DEBUG` flag or routed to a structured logger.

### 5.11 TODOs / commented-out

Two TODO-shaped markers near lines 65-66 of App.js (full content not captured). Recommend a sweep before splitting the file.

---

## 6. Themes Where All Four Audits Agreed

These are the items each audit independently surfaced — i.e., the issues with the highest signal:

1. **App.js is structurally unsafe** — Architecture (§2.7), Code Quality (§5.4), and Security (the broken-imports incidents are part of a fragile auth flow) all flagged the monolith as the root cause for several other findings.
2. **RLS is off** — Architecture (§2.7 #4), Security (§3.2), and Database (§4.2) all called this out as the single biggest exposure.
3. **Payout endpoints lack authz** — Security (§3.3), Architecture (§2.5 D), and Database (§4.9) all flagged the same money path.
4. **Schema drift on `payments.batch_id` and `payout_batches.period_type`** — Database (§4.1) discovered it; Architecture (§2.7 #7) and Security (§16 in original report) confirmed the API writes columns the schema doesn't define.
5. **`creator_tokens` duplicated** — Architecture, Database, and Security all noted this. Architecture pointed out the frontend queries the wrong shape; Database confirmed the duplicate `CREATE`; Security flagged the resulting RLS gap.
6. **OAuth boilerplate duplication, no PKCE, weak state** — Architecture (§2.7 #5), Security (§3.5, §3.6), Code Quality (§5.3).

When multiple independent passes converge, those are the bets to make first.

---

## 7. Prioritized Remediation Plan

### Wave 1 — Stop the bleeding (1 week)
- [ ] Add JWT + role-from-DB check to `mark-paid`, `export`, `get-upload-url`, `send-email`, `upload-to-drive`, `disconnect`.
- [ ] Stop returning the Drive `access_token` to the browser.
- [ ] Lock CORS to `https://www.portalomnyagrowth.com`.
- [ ] Replace every `"Allow all"` RLS policy with `auth.uid()`-scoped policies on `payments`, `payout_batches`, `creator_tokens`, `user_profiles`. (Submissions/clients/campaigns can come right after.)
- [ ] Rotate the Supabase anon key after RLS is verified working in staging.
- [ ] Add `payments.batch_id` and `payout_batches.period_type` columns; pick a single `creator_tokens` definition and drop the other; backfill from prod.

### Wave 2 — Harden auth (2 weeks)
- [ ] Replace OAuth state with a server-stored nonce (Vercel KV / Redis), 10-min TTL, one-time-use.
- [ ] Add PKCE to TikTok start + callback.
- [ ] Verify cron via Vercel signature instead of static `CRON_SECRET`.
- [ ] Wire refresh-token flow for YouTube/Meta; surface "reconnect needed" to the creator in the UI.
- [ ] Remove the `['shaily@omnyagrowth.com']` owner shortcut; create a proper "promote user" admin action gated by another owner.
- [ ] Add rate limiting (Upstash) to `send-email`, OAuth callbacks, `get-upload-url`.

### Wave 3 — Schema & migrations (2 weeks)
- [ ] Adopt Supabase Migrations; convert existing SQL files into numbered migrations.
- [ ] Add indexes on FKs (§4.3).
- [ ] Add CHECK constraints on `status` columns (case-normalize first).
- [ ] Decide `video_analytics` history policy; remove or relax the `submission_id` UNIQUE.
- [ ] Add `payout_audit_log`.

### Wave 4 — Refactor (3-4 weeks)
- [ ] Split App.js per §5.4 plan; introduce React Router.
- [ ] Factor OAuth handlers into a shared module.
- [ ] Add a service layer (`src/services/*`) so components stop calling Supabase directly.
- [ ] Enable strict ESLint rules + Husky pre-commit.
- [ ] Add tests for auth init, payouts, role guards, OAuth state.
- [ ] Add Sentry (or equivalent) for client + server error reporting.
- [ ] Add CSP / HSTS / X-Frame-Options via `vercel.json`.

### Wave 5 — Hygiene (ongoing)
- [ ] Delete dead code: `AIInsightsPanel`, `showBypass`, `payout_line_items`, unused imports.
- [ ] Standardize API response shape.
- [ ] Document required env vars in `VERCEL_DEPLOY.md`.
- [ ] Disable source maps in production builds.

---

## Appendix A — Files inspected

```
src/App.js (5049 lines)            src/index.js
src/AnalyticsDashboard.js          src/CreatorConnections.js
src/PayoutManager.js               src/Legal.js
src/supabaseClient.js              src/utils.js
src/contexts/AuthContext.js        src/components/Guards/RequireRole.js
src/pages/CreatorDashboard.js      src/App.test.js / setupTests.js

api/analytics/{fetch,refresh,sync}.js
api/analytics.js
api/auth/disconnect.js
api/auth/{tiktok,facebook,instagram,meta,youtube}/{start,callback}.js
api/payouts/{generate,export,mark-paid}.js
api/send-email.js
api/get-upload-url.js
api/upload-to-drive.js

database_setup.sql                  database_update.sql
analytics_setup.sql                 meta_setup.sql
fix_role_constraint.sql

vercel.json                         package.json
README.md                           public/*
```

## Appendix B — What this audit did NOT cover

- Live database state — all DB conclusions are from SQL files; the actual prod schema may differ (especially since some columns are written by the API but not defined in any file).
- Vercel project settings, env var values, OAuth app configurations (redirect_uris, scopes registered with each platform).
- Bundle analysis / actual production build artifacts.
- Network traffic / runtime behavior under load.
- Dependency CVE scan (Dependabot / Snyk recommended).
- Penetration testing of the live deployment.
