# Omnya Portal — Complete System Audit

> Updated: 2026-05-28 (post security-hardening session)

---

## System Architecture Overview

**Tech Stack:** Create React App (CRA, NOT Next.js) · Supabase (PostgreSQL + Auth + Realtime) · Vercel serverless functions (`/api`) · Resend email · Google Drive uploads · Upstash Redis (rate limiting)

**Routing:** Manual string-based routing via `page` state in `src/App.js` — no React Router

---

## 1. The Four Characters — Who They Are and How They Relate

```
OWNER
  │
  ├── approves signups
  ├── oversees all AMs, Creators, Clients
  ├── manages payouts (generate → export → mark paid)
  └── full read/write on every table

ACCOUNT MANAGER (am)
  │
  ├── assigned to Creators (creators.am_id → account_managers.id)
  ├── assigned to Clients (clients.am_id → account_managers.id)
  ├── reviews Creator submissions in their queue
  └── manages Campaigns under their Clients

CLIENT (brand)
  │
  ├── owns Campaigns (campaigns.client_id → clients.id)
  ├── views approved Submissions in their campaigns
  └── views analytics for their campaigns only

CREATOR
  │
  ├── belongs to an AM (creators.am_id → account_managers.id)
  ├── submits to Campaigns (submissions.creator_id → creators.id)
  ├── connects social platforms (creator_tokens)
  └── earns payments per approved submission
```

**The central data spine:**
```
clients → campaigns → submissions → video_analytics
                           ↑
                       creators ──→ creator_tokens (OAuth)
                           ↑
                    account_managers
```

### Database Relationships

| Table | Purpose | Key Foreign Keys |
|---|---|---|
| `user_profiles` | Auth → role mapping | `id` → `auth.users` |
| `account_managers` | AM records | `user_id` → `auth.users` |
| `creators` | Creator profiles | `user_id` → `auth.users`, `am_id` → `account_managers` |
| `clients` | Brand/client accounts | `user_id` → `auth.users`, `am_id` → `account_managers` |
| `campaigns` | Campaign definitions | `client_id` → `clients` |
| `submissions` | Video submissions | `creator_id` → `creators`, `campaign_id` → `campaigns` |
| `payments` | Payment ledger | `creator_id` → `creators`, `campaign_id` → `campaigns`, `batch_id` → `payout_batches` |
| `creator_tokens` | OAuth tokens | `user_id` → `auth.users`, `creator_id` → `creators` |
| `video_analytics` | Video performance | `submission_id` → `submissions`, `campaign_id` → `campaigns` |
| `payout_batches` | Batch payment groups | — |
| `messages` | Campaign forum | `campaign_id` → `campaigns`, `user_id` (untyped) |
| `oauth_states` | OAuth nonces + PKCE verifier | `user_id` → `auth.users`, `expires_at` |

---

## 2. Data Flow by Journey

### A. Creator Journey
```
Signup → pending role → Owner approves → creator role
→ Browse JobBoard → Apply to Campaign
→ Submit concept (SubmitContent) → AM notified via email
→ AM approves concept → Creator films/posts
→ Creator submits final link → AM approves final
→ Cron job fetches analytics every 12h
→ Owner generates payout batch → exports CSV → marks paid → email sent
```

### B. Account Manager Journey
```
AM is added manually by Owner (no self-signup flow for AMs)
→ AM sees creators assigned via creators.am_id (RLS-enforced)
→ AM sees clients/campaigns assigned via clients.am_id (RLS-enforced)
→ AM reviews submissions in ReviewQueue
→ AM approves or requests revisions
→ AM monitors creator performance and revenue analytics
```

### C. Client Journey
```
Client signs up → role = 'client' (no owner approval required)
→ Trigger auto-creates clients row linked to user_id
→ loadDB fetches from client_safe_* views (security_invoker, RLS-enforced)
→ ClientDashboard → sees campaigns, approved submissions, analytics
```

### D. Owner Journey
```
Owner role stored in user_profiles.role = 'owner'
→ Approves/denies pending users
→ Creates campaigns, assigns to clients
→ Generates/exports/marks payout batches
→ Sees all data across the system
```

---

## 3. Authentication & Authorization

### Role Definitions

| Role value | Who | How assigned |
|---|---|---|
| `owner` | System admin | `user_profiles.role = 'owner'` — set via DB seed or manual SQL |
| `am` / `account_manager` | Account managers | Manual DB insert; normalized to `am` in `api/_utils/auth.js` |
| `creator` | Content creators | Owner approves after signup |
| `client` | Brand accounts | Auto-assigned on signup |
| `pending` | Awaiting approval | Default on signup |
| `denied` | Rejected | Manual DB update |

> **Note:** The hardcoded owner email bypass (`shaily@omnyagrowth.com`) has been removed from `src/App.js`. Role is now read exclusively from `user_profiles.role`. Owner role must be seeded via SQL: `UPDATE user_profiles SET role = 'owner' WHERE email = '...'`.

### Auth Flow
```
Signup → Supabase Auth.signUp() → email verification
→ AuthContext.onAuthStateChange()
→ Fetch user_profiles → role determined
→ RequireRole guard → redirect to /pending if not approved
→ Role-based navigation shown
```

### API Authorization
- `api/_utils/auth.js` — `requireRole(req, res, allowedRoles)` validates JWT and checks `user_profiles.role`
- `api/_utils/auth.js` — `requireAuth(req, res)` validates JWT only (no role check)
- `api/_utils/rateLimit.js` — Upstash Redis sliding-window rate limiter; degrades gracefully if env vars absent

### RLS Status by Table (current, post all migrations)

Migrations applied in order:
1. `20260521000000_omnya_hardening.sql` — full role-scoped policies for all tables
2. `20260522000000_social_media_feature.sql` — oauth_states, creator_connection_status view
3. `20260527120000_client_system_integration.sql` — client system views (pre-fix)
4. `20260527130000_client_rls_security.sql` — client-specific RLS (campaigns, submissions, video_analytics)
5. `20260528000000_security_hardening.sql` — security_invoker views, brief_url, trigger

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `user_profiles` | ✅ self + owner + AM(assigned) | ✅ self or owner | ✅ owner/self (role escalation blocked by WITH CHECK) | ✅ owner only |
| `account_managers` | ✅ self + owner + any AM | ✅ owner only | ✅ owner only | ✅ owner only |
| `creators` | ✅ self + owner + assigned AM | ✅ self or owner/AM | ✅ self or owner/AM | ✅ owner only |
| `clients` | ✅ own row (client) + owner + assigned AM | ✅ owner/AM | ✅ owner/AM | ✅ owner/AM |
| `campaigns` | ✅ owner + AM + creator(assigned) + client(own) | ✅ owner/AM | ✅ owner/AM | ✅ owner/AM |
| `submissions` | ✅ owner + creator(own) + AM(assigned) + client(own campaigns) | ✅ scoped | ✅ scoped | ✅ owner only |
| `payments` | ✅ owner + creator(own) + AM(assigned) | ✅ owner/AM only | ✅ owner/AM only | ✅ owner/AM only |
| `creator_tokens` | ✅ self + owner | ❌ service-role only | ❌ service-role only | ✅ self + owner |
| `video_analytics` | ✅ owner + creator(own) + AM(assigned) + client(own campaigns) | service-role only | service-role only | service-role only |
| `payout_batches` | ✅ owner + AM | ✅ owner only | ✅ owner only | ✅ owner only |
| `messages` | ✅ campaign-scoped | ✅ self + campaign access | — | — |
| `oauth_states` | ❌ deny-all for authenticated | service-role only | service-role only | service-role only |

---

## 4. Feature Analysis — Current Status

### Creator Features

| Feature | Status | Notes |
|---|---|---|
| Browse campaigns (JobBoard) | ✅ Working | |
| Submit concept + final link | ✅ Working | |
| Track submission status | ✅ Working | |
| View earnings | ✅ Working | |
| Connect social platforms | ✅ Working | OAuth + PKCE implemented; TikTok, Meta/IG/FB, YouTube |
| View video analytics | ⚠️ Partial | Cron refreshes every 12h; no auto-refresh on OAuth token expiry |
| Manual analytics refresh | ✅ Working | `POST /api/analytics/manual-sync` — rate-limited at 5/min |
| Request payout | ✅ Working | |

### Account Manager Features

| Feature | Status | Notes |
|---|---|---|
| View assigned creators | ✅ Working | RLS-enforced — only assigned creators returned |
| Review submission queue | ✅ Working | |
| Approve / request revisions | ✅ Working | |
| Manage clients & campaigns | ✅ Working | RLS-enforced — only assigned clients/campaigns |
| Revenue & analytics dashboard | ✅ Working | |

### Client (Brand) Features

| Feature | Status | Notes |
|---|---|---|
| Dashboard overview | ✅ Working | Auto-created clients row via trigger on signup |
| View campaigns | ✅ Working | Filtered by clientProfile.id; RLS-enforced via client_safe_campaigns view |
| Content gallery | ✅ Working | Filtered by client's campaign IDs |
| Analytics | ✅ Working | client_safe_analytics has security_invoker=true; scoped by auth.uid() |
| Campaign briefs | ✅ Working | brief_url column exists; shown in dashboard |

### Owner Features

| Feature | Status | Notes |
|---|---|---|
| Approve / deny signups | ✅ Working | |
| View all data | ✅ Working | |
| Generate payout batches | ✅ Working | Rate-limited at 5/min |
| Export CSV | ✅ Working | |
| Mark batch paid | ✅ Working | Rate-limited at 10/min |
| Full analytics | ✅ Working | |
| Create campaigns / clients | ✅ Working | |

---

## 5. Remaining Open Issues

---

### HIGH SEVERITY

#### Issue #1 — `user_profiles` INSERT policy allows self-assigned `owner` role
**File:** `supabase/migrations/20260521000000_omnya_hardening.sql:257-262`

The INSERT policy only checks `id = auth.uid()` — it does not restrict which `role` value the user may set on their own row. A new user could call `supabase.from('user_profiles').insert({ id: myId, role: 'owner' })` and self-promote to owner before the row is blocked.

The migration comment acknowledges this and marks it for tightening after the hardcoded email bypass was removed. That removal is now done.

**Fix:**
```sql
DROP POLICY IF EXISTS user_profiles_insert_self_or_owner ON public.user_profiles;
CREATE POLICY user_profiles_insert_self_or_owner ON public.user_profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    id = auth.uid()
    AND role IN ('pending', 'creator', 'client')
    OR public.current_user_role() = 'owner'
  );
```

---

#### Issue #2 — Owner notification email has hardcoded fallback
**File:** `api/send-email.js:148`

```js
to: process.env.OWNER_NOTIFICATION_EMAIL || 'shaily@omnyagrowth.com',
```

The `OWNER_NOTIFICATION_EMAIL` env var is used but falls back to a hardcoded address. This is not a security bypass (the email is used for notification delivery only, not for role resolution), but it means the wrong person gets notified if the env var is not set in production.

**Fix:** Set `OWNER_NOTIFICATION_EMAIL` in Vercel environment variables. Remove or replace the fallback with a server error if unset.

---

### MEDIUM SEVERITY

#### Issue #3 — Analytics cron does not auto-refresh expired OAuth tokens
**File:** `api/analytics/sync.js`, `api/_utils/analytics.js`

When a creator's OAuth token is expired, `sync.js` logs an error and moves to the next creator. It never attempts to use the stored `refresh_token` to renew access. Analytics for that creator silently go stale.

Creators with expired tokens must manually reconnect via the CreatorConnections UI. The `POST /api/analytics/manual-sync` endpoint exists and works but it also does not refresh tokens — it just re-fetches with the current token and will fail the same way.

**Fix:** In `api/_utils/analytics.js`, before each platform fetch attempt, check if the token is expired and attempt a refresh using the stored `refresh_token`. On success, upsert the new token to `creator_tokens`.

---

#### Issue #4 — Dead API routes remain deployed
**Files:** `api/analytics/fetch.js`, `api/analytics/refresh.js`, `api/analytics.js` (if still present — verify with `ls api/analytics/`)

These routes are marked as dead in `IMPLEMENTATION_SUMMARY.md` but may still be deployed as live Vercel functions. Each holds env-var access including `SUPABASE_SERVICE_ROLE_KEY`. An attacker who discovers them may probe their behavior.

**Fix:** Delete files and redeploy. Confirm no callers exist by grepping for `analytics/fetch` and `analytics/refresh` in `src/`.

---

### ARCHITECTURE ISSUES (non-blocking, long term)

#### Issue #5 — App.js Monolith (~5,000 Lines, 50+ Inline Components)
**File:** `src/App.js`

All page components are defined as closures inside a single file. Code splitting is impossible, a syntax error crashes the entire app, and the root component has dozens of `useState` hooks causing cascading re-renders. This is the root cause of most future maintainability risk.

**Migration path:** Extract components one at a time to `src/pages/` and `src/components/`. Start with `JobBoard`, `ReviewQueue`, `PaymentManagement`, and `PendingUsers` as they are the most self-contained.

---

#### Issue #6 — String-Based Page Routing
**File:** `src/App.js`

All navigation uses `setPage(string)`. No browser history entries are created for most navigations, deep links are fragile, and code splitting is not possible. React Router (or TanStack Router) should replace this.

---

#### Issue #7 — `loadDB` Has No Pagination
**File:** `src/App.js`

Every table is loaded in full with `select('*')` on every login. RLS correctly scopes what rows are returned, but as data volume grows this becomes a performance and memory bottleneck. Queries should add `range()` or cursor-based pagination, especially for `submissions` and `payments`.

---

#### Issue #8 — OAuth Tokens Stored Plaintext
**File:** `supabase/migrations/20260521000000_omnya_hardening.sql`, AUDIT.md §3.8

`creator_tokens.access_token` and `refresh_token` are stored as plaintext text columns, protected by RLS only. A database dump or a Supabase Dashboard session exposes all tokens.

**Fix (long term):** Use `pgcrypto` extension to encrypt on write and decrypt on read. All write paths (OAuth callbacks, token refresh) encrypt before insert. All read paths (`api/analytics/sync.js`, `api/analytics/manual-sync.js`) decrypt after select.

---

#### Issue #9 — No Automated Test Suite
The only test file is the CRA boilerplate `App.test.js`. No integration tests, no RLS smoke tests run in CI, no API endpoint tests.

Priority test areas: cross-tenant RLS isolation (Creator A cannot see Creator B's payments), client view scoping, cron auth, and rate-limit enforcement.

---

#### Issue #10 — App Review Required for Public Social Connections
Until each provider approves the app for public use:
- **TikTok:** only Sandbox users can connect
- **Meta (Instagram/Facebook):** only app Testers can connect  
- **YouTube (Google):** only OAuth consent screen Test Users can connect

This is an external dependency, not a code defect. It requires submitting privacy policy URLs, demo videos, and scope justifications. Typical timelines: TikTok 5–10 business days, Meta 2–6 weeks, Google 4–6 weeks for sensitive scopes.

---

## 6. Working vs Open Summary

### ✅ Working (Production-Ready)
- User signup and email verification
- Owner approval workflow (PendingUsers)
- Creator browse campaigns and submit content
- AM review queue — approve / request revisions
- OAuth social connection (TikTok + PKCE, Instagram, Facebook/Meta, YouTube)
- OAuth disconnect with audit trail
- Analytics cron sync (12h interval via Vercel cron)
- Manual analytics refresh (`POST /api/analytics/manual-sync`)
- Email sending via Resend (HTML-escaped, rate-limited, recipient-validated)
- Google Drive resumable uploads
- Payout batch generation, CSV export, mark-paid
- Creator connections UI (no raw tokens in browser)
- Role normalization (`account_manager` → `am`)
- Hardcoded owner email **removed** — role from DB only
- Rate limiting on send-email (10/min), payouts (5–10/min), manual-sync (5/min)
- Realtime subscriptions scoped by role (no cross-role data leaks)
- Client dashboard — auto-provisioned clients row on signup
- Client safe views with `security_invoker=true`
- Full RLS coverage: SELECT + INSERT + UPDATE + DELETE on all 12 sensitive tables
- Timing-safe cron secret comparison

### ⚠️ Partially Working
- Analytics freshness (works for active tokens; no auto-refresh on expiry)
- Social connections for non-tester users (pending provider App Review)

### ❌ Not Yet Implemented
- OAuth token auto-refresh inside analytics cron
- OAuth tokens encrypted at rest
- `user_profiles` INSERT policy role restriction (allows self-assigned `owner`)
- Automated test suite
- Dead route cleanup (`api/analytics/fetch.js` etc. — verify existence)
- App.js refactor (architectural, long term)
- `loadDB` pagination

---

## 7. Prioritized Fix Plan

### This Sprint (Security Blockers) — DONE
1. ✅ Tighten `user_profiles_insert_self_or_owner` policy — `20260528000001_fix_user_profiles_insert_policy.sql`
2. ✅ Remove hardcoded `shaily@omnyagrowth.com` fallback from `api/send-email.js`
3. ✅ Dead route audit — `api/analytics/fetch.js`, `api/analytics/refresh.js`, `api/analytics.js` do not exist

### Next Sprint
4. Implement OAuth token auto-refresh in `api/_utils/analytics.js`
5. Add pagination to `loadDB` for `submissions` and `payments`
6. Add cross-tenant RLS smoke tests to CI

### Long Term
7. Encrypt OAuth tokens at rest with pgcrypto
8. Extract `src/App.js` into per-page module files
9. Replace string routing with React Router
10. Submit provider App Reviews (TikTok, Meta, Google)
11. Add automated test suite (Jest + Supabase test project)

---

## 8. Server Utilities Reference

All in `api/_utils/`:

| File | Purpose |
|---|---|
| `supabaseAdmin.js` | Cached service-role client; throws if env missing |
| `errors.js` | `sendOk`, `Errors.{unauthorized, forbidden, badRequest, notFound, methodNotAllowed, rateLimited, internal}` |
| `cors.js` | `applyCors` — locked to portal origin + localhost + `ADDITIONAL_ALLOWED_ORIGINS` |
| `auth.js` | `getBearerToken`, `requireAuth`, `requireRole`, `normalizeRole` — JWT via service-role, role from `user_profiles` |
| `oauth.js` | `generateRandomState`, `hashState`, `generateCodeVerifier`, `generateCodeChallenge`, `storeOAuthState`, `consumeOAuthState` — PKCE S256, one-time-use, TTL-checked |
| `rateLimit.js` | `applyRateLimit` — Upstash REST API, sliding window, degrades to no-op if env vars absent |
| `analytics.js` | `syncSubmissions`, `fetchAllFinalSubmissions`, `fetchSubmissionsForUser`, `fetchSubmissionsByIds` |

---

## 9. Environment Variables Reference

| Variable | Required | Used By |
|---|---|---|
| `REACT_APP_SUPABASE_URL` | ✅ | Browser (supabaseClient.js) |
| `REACT_APP_SUPABASE_ANON_KEY` | ✅ | Browser (supabaseClient.js) |
| `REACT_APP_APP_BASE_URL` | Optional | Browser links |
| `SUPABASE_URL` | ✅ | All API routes |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | All API routes |
| `APP_BASE_URL` | ✅ | OAuth redirect URIs |
| `CRON_SECRET` | ✅ | `api/analytics/sync.js` |
| `OWNER_NOTIFICATION_EMAIL` | ✅ (should be set) | `api/send-email.js` |
| `RESEND_API_KEY` | ✅ | `api/send-email.js` |
| `RESEND_FROM_EMAIL` | Optional | `api/send-email.js` |
| `UPSTASH_REDIS_REST_URL` | Optional | `api/_utils/rateLimit.js` |
| `UPSTASH_REDIS_REST_TOKEN` | Optional | `api/_utils/rateLimit.js` |
| `TIKTOK_CLIENT_KEY` | OAuth | TikTok start/callback |
| `TIKTOK_CLIENT_SECRET` | OAuth | TikTok start/callback |
| `META_APP_ID` / `INSTAGRAM_APP_ID` | OAuth | Meta/IG/FB start/callback |
| `META_APP_SECRET` / `INSTAGRAM_APP_SECRET` | OAuth | Meta/IG/FB start/callback |
| `YOUTUBE_CLIENT_ID` | OAuth | YouTube start/callback |
| `YOUTUBE_CLIENT_SECRET` | OAuth | YouTube start/callback |
| `ANTHROPIC_API_KEY` | Future | AI insights (Phase 6) |
