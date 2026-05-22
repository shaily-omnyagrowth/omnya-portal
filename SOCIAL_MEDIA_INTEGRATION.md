# Social Media Integration — Omnya Portal

This document covers the **OAuth-based social-media integration** for creators:
TikTok, Instagram, Facebook, and YouTube. It explains the data flow, the
required env vars, how to wire each provider's developer console, the database
tables involved, the RLS model, and how to troubleshoot the most common
failure modes.

The analytics-sync side of this feature (cron, manual refresh, dashboard
rendering) is being delivered in the next iteration; this document focuses on
**connect / disconnect / status** and the shared foundations.

---

## 1. Supported platforms

| Platform   | Provider OAuth          | Refresh token? | Notes |
|------------|-------------------------|----------------|-------|
| TikTok     | TikTok v2 OAuth + PKCE  | Yes            | PKCE required for SPA clients. |
| Instagram  | Meta Login              | No (long-lived ~60d) | Stored under `platform='instagram'`. |
| Facebook   | Meta Login              | No (long-lived ~60d) | Stored under `platform='facebook'`. |
| Meta       | Meta Login              | No (long-lived ~60d) | "Generic" Meta connection (`platform='meta'`). |
| YouTube    | Google OAuth (offline)  | Yes            | `access_type=offline&prompt=consent`. |

Each branded button writes a separately-labelled row in `creator_tokens`. The
three Meta-backed flows share one callback (`/api/auth/meta/callback`); the
callback figures out the correct platform label from the `oauth_states`
record.

---

## 2. End-to-end OAuth flow

```
┌──────────────┐                    ┌────────────────────────┐                       ┌────────────────┐
│  React SPA   │   1 POST + JWT    │ /api/auth/<p>/start    │                       │  OAuth         │
│              ├──────────────────►│ (verifies JWT)         │                       │  Provider      │
│              │                   │ (writes oauth_states)  │                       │ (TikTok / Meta │
│              │   2 { authUrl }   │ (returns authUrl)      │                       │  / Google)     │
│              │◄──────────────────┤                        │                       │                │
│              │                                            │                       │                │
│  window.     │   3 window.location = authUrl              │                       │                │
│  location ───┼────────────────────────────────────────────┼──────────────────────►│                │
│              │                                            │                       │                │
│              │                       4 user consents                              │                │
│              │                                            ┌────────────────────────┤                │
│              │                                            │ /api/auth/<p>/callback │                │
│              │                                            │ (consumes oauth_state) │                │
│              │                                            │ (exchanges code)       │                │
│              │                                            │ (upserts creator_tokens│                │
│              │   5 302 → /?connected=<p>                  │                        │                │
│              │◄───────────────────────────────────────────┤                        │                │
└──────────────┘                                            └────────────────────────┘                │
                                                                                                       │
                                                                                                       ▼
```

Key properties:

1. **State is server-stored and hashed.** The browser only ever sees the
   random opaque string; the server holds the SHA-256 hash plus
   `(user_id, platform, expires_at, used_at)`. A callback with a state we
   didn't issue, an expired state, or a state already consumed is rejected.
2. **State is bound to the platform.** A `tiktok` state can't be replayed
   against the `youtube` callback.
3. **PKCE for TikTok.** The `code_verifier` is stored alongside the state and
   sent to TikTok on code exchange. The browser never sees the verifier.
4. **Tokens stay server-side.** The frontend never receives
   `access_token`/`refresh_token`. The browser-readable connection state
   comes from `/api/social/connections` (or, defensively, the
   `creator_connection_status` view), which omits both columns.

---

## 3. Required environment variables

Place these in Vercel (Production, Preview, Development) and mirror in
`.env.local` for local dev. The portal's `.env.example` is the source of
truth for naming.

### Shared
| Variable | Purpose |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Server-side Supabase admin client. |
| `REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_ANON_KEY` | Client-side Supabase. |
| `APP_BASE_URL` | Base URL of the deployed portal (e.g. `https://www.portalomnyagrowth.com`). Used to compose default redirect URIs and post-callback redirects. |
| `ADDITIONAL_ALLOWED_ORIGINS` (optional) | Comma-separated extra origins to add to the CORS allow-list (e.g. preview deployments). |

### TikTok
| Variable | Purpose |
|---|---|
| `TIKTOK_CLIENT_KEY` | TikTok app client key. |
| `TIKTOK_CLIENT_SECRET` | TikTok app client secret. |
| `TIKTOK_REDIRECT_URI` (optional) | Override for `${APP_BASE_URL}/api/auth/tiktok/callback`. Must match what's registered in the TikTok developer portal. |

### Meta / Instagram / Facebook
| Variable | Purpose |
|---|---|
| `META_APP_ID` *or* `FACEBOOK_APP_ID` *or* `INSTAGRAM_APP_ID` | Meta app id. The three names are tried in order; supply whichever matches your existing convention. |
| `META_APP_SECRET` *or* `FACEBOOK_APP_SECRET` *or* `INSTAGRAM_APP_SECRET` | Meta app secret. |
| `META_REDIRECT_URI` (optional) | Override for `${APP_BASE_URL}/api/auth/meta/callback`. Must match Meta App > Settings > Valid OAuth Redirect URIs. |

### YouTube
| Variable | Purpose |
|---|---|
| `YOUTUBE_CLIENT_ID` | Google OAuth client id (Web application type). |
| `YOUTUBE_CLIENT_SECRET` | Google OAuth client secret. |
| `YOUTUBE_REDIRECT_URI` (optional) | Override for `${APP_BASE_URL}/api/auth/youtube/callback`. Must match Authorized redirect URIs in Google Cloud Console. |

---

## 4. Provider console setup

For each platform, register the callback URL exactly as the routes expect:

| Platform | Where to register | URL to register |
|---|---|---|
| TikTok | TikTok Developer Portal → your app → Login Kit → Redirect URI | `${APP_BASE_URL}/api/auth/tiktok/callback` |
| Meta (IG/FB) | Meta App Dashboard → Login → Settings → Valid OAuth Redirect URIs | `${APP_BASE_URL}/api/auth/meta/callback` |
| YouTube | Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client → Authorized redirect URIs | `${APP_BASE_URL}/api/auth/youtube/callback` |

For local development, register `http://localhost:3000/api/auth/<p>/callback`
*and* set `APP_BASE_URL=http://localhost:3000` in `.env.local`. Some providers
(TikTok in particular) require an HTTPS URL for production but accept
localhost for development.

---

## 5. Database tables

Defined in `supabase/migrations/20260522000000_social_media_feature.sql`
(plus columns added in the hardening migration).

### `creator_tokens`
The canonical token store. Keyed by `(user_id, platform)` UNIQUE.

| Column | Purpose |
|---|---|
| `user_id`, `platform` | Composite key. `platform` ∈ {tiktok, instagram, facebook, meta, youtube}. |
| `access_token`, `refresh_token` | OAuth credentials. **Never returned to the browser.** |
| `token_type`, `scope` | From the provider's token response. |
| `expires_at`, `refresh_expires_at` | TTLs for the two tokens. |
| `platform_user_id`, `platform_username` | Provider identity (e.g. TikTok `open_id`, YouTube channel id/title). |
| `status` | `connected` / `expired` / `revoked` / `error` / `disconnected`. |
| `last_synced_at`, `last_error` | Updated by analytics sync. |
| `metadata` | JSONB sidecar for provider-specific fields. |

`creator_id` is kept (nullable) for compatibility with legacy callers — see
AUDIT.md §4.8 for the schism resolution.

### `oauth_states`
Short-lived nonce store. Service-role only; deny-all RLS.

| Column | Purpose |
|---|---|
| `state_hash` | SHA-256 of the random state we sent to the provider. |
| `code_verifier` | PKCE verifier (TikTok only). |
| `platform`, `user_id` | Binding — a state can only be consumed by the matching callback. |
| `expires_at` | 10-minute TTL. |
| `used_at` | Set on first successful consume; prevents replay. |

### `creator_connection_status` (view)
Defensive frontend projection. Same data as `creator_tokens` minus the raw
token columns. Inherits RLS from the base table via `security_invoker=true`.

### `video_analytics`
Holds per-submission social metrics. The next iteration's analytics-sync work
populates `user_id`, `video_url`, `watch_time_seconds`, `engagement_rate`, and
`raw_metrics` — all added by this migration.

---

## 6. RLS model

| Table | Authenticated reads | Authenticated writes |
|---|---|---|
| `creator_tokens` | `user_id = auth.uid()` OR `owner` | None — server-side only |
| `oauth_states` | none (deny-all) | none — server-side only |
| `video_analytics` | owner / self / assigned-AM | None — server-side only |
| `creator_connection_status` | inherits creator_tokens | view is read-only |

Service-role endpoints (`api/auth/**/*`, `api/social/connections`,
`api/auth/disconnect`) bypass RLS but each one re-checks authorization
explicitly using the helpers in `api/_utils/auth.js`.

---

## 7. API surface

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/auth/tiktok/start` | POST | JWT | Generate state + PKCE, return authorization URL. |
| `/api/auth/tiktok/callback` | GET | None (provider) | Exchange code, store tokens, redirect to portal. |
| `/api/auth/instagram/start` | POST | JWT | Same shape as TikTok, no PKCE. Label='instagram'. |
| `/api/auth/facebook/start` | POST | JWT | Label='facebook'. |
| `/api/auth/meta/start` | POST | JWT | Label='meta' (generic). |
| `/api/auth/meta/callback` | GET | None | Shared callback for IG/FB/Meta. |
| `/api/auth/youtube/start` | POST | JWT | Requests offline access + refresh token. |
| `/api/auth/youtube/callback` | GET | None | |
| `/api/auth/disconnect` | POST | JWT | Soft-delete creator's token for given platform. |
| `/api/social/connections` | GET | JWT | Safe status read; supports `?userId=` for owner/AM. |
| `/api/analytics/sync` | POST | `CRON_SECRET` | 12-hour cron (next iteration: aligned with new schema). |

**Response shape** for all `/api/*` endpoints that return JSON:

```json
{ "ok": true, "data": { ... } }
{ "ok": false, "error": { "code": "forbidden", "message": "...", "details": {} } }
```

---

## 8. Connect flow (frontend)

`src/CreatorConnections.js` implements:

1. On mount, calls `GET /api/social/connections`. Renders one card per
   platform, defaulting unconfigured platforms to `disconnected`.
2. **Connect button** → `POST /api/auth/<platform>/start` with the user's
   JWT. Server returns `{ authorizationUrl }`. Frontend sets
   `window.location.href = authorizationUrl`.
3. Provider redirects back to `${APP_BASE_URL}/?page=social-connections&connected=<platform>`
   on success, or `&error=<code>` on failure. The mount-effect surfaces a
   toast and scrubs the query string.
4. **Disconnect button** → `POST /api/auth/disconnect` with `{ platform }`.
   Server soft-deletes (clears tokens, sets `status='disconnected'`).
5. **Reconnect button** appears when `status === 'expired'` or
   `expires_at < now()`. It runs the same connect flow.

---

## 9. Manual reconnection of a creator

If a creator reports their connection isn't working and the UI doesn't
auto-detect the failure:

1. As **owner**, hit `GET /api/social/connections?userId=<creator-user-id>`
   to see their status across all platforms.
2. If `last_error` is informative, fix the underlying issue (e.g. re-grant
   permissions in the provider's settings).
3. Ask the creator to click **Reconnect** in the portal. Their token row is
   upserted with fresh credentials; no manual SQL needed.

For owners who want to invalidate a creator's token (e.g. they're offboarding):
have them click Disconnect, or run via SQL:

```sql
UPDATE creator_tokens
SET access_token = NULL, refresh_token = NULL, status = 'revoked',
    updated_at = now()
WHERE user_id = '<creator-user-id>' AND platform = '<platform>';
```

---

## 10. Common errors

| Symptom | Likely cause | Fix |
|---|---|---|
| Connect button does nothing | Browser blocking JS errors. Inspect DevTools — most likely missing env var on server. | Check Vercel env vars for the relevant `*_CLIENT_KEY` / `*_APP_ID`. |
| `?error=tiktok_invalid_state` | State expired (>10 min) or already used. | Re-click Connect; state is single-use. |
| `?error=tiktok_token_exchange_failed` | Redirect URI mismatch, or wrong client key/secret. | Verify the URI in TikTok dev portal matches `TIKTOK_REDIRECT_URI`. |
| `?error=meta_token_exchange_failed` | Meta app secret mismatch, or unapproved scope. | Re-issue secret in Meta dashboard. Confirm scopes are available for the app's current review status. |
| Connection succeeds but `lastError` says permission issue | Provider account lacks IG Business account / page admin rights. | Have the creator promote their IG account to Business and re-connect. |
| `?error=youtube_misconfigured` | `YOUTUBE_CLIENT_ID`/`SECRET` missing. | Set them in Vercel and redeploy. |
| User says "I disconnected but the button still shows Connect" | Browser cache. | Force refresh — the disconnect API updates DB synchronously. |

For deeper debugging, check Vercel function logs for `[<platform>/callback]
*_failed` lines. Logs intentionally omit token bodies; you'll see HTTP status
and a short error description only.

---

## 11. Deployment checklist (per environment)

- [ ] Apply migrations in order: `20260521000000_omnya_hardening.sql`, then
      `20260522000000_social_media_feature.sql`.
- [ ] Set all env vars listed in §3. `APP_BASE_URL` must match the
      environment's actual URL.
- [ ] Register every callback URL with its respective provider (see §4).
- [ ] Verify Supabase RLS is on for `creator_tokens`, `oauth_states`,
      `video_analytics`.
- [ ] Smoke test: sign in as a creator, click Connect for each platform, verify
      the creator card shows the connected username and Last synced shows
      "—" (until the next cron run).
- [ ] Smoke test: sign in as owner, hit `GET /api/social/connections?userId=<creator>`,
      confirm no `access_token` / `refresh_token` appears in the JSON.
- [ ] Smoke test: try a forged state URL (`/api/auth/tiktok/callback?code=foo&state=bar`)
      and confirm a clean redirect to `?error=tiktok_invalid_state`.

---

## 12. Next iteration (analytics)

Tracked separately:

- Analytics sync rewrite against the new `creator_tokens` schema, with token
  refresh, per-platform error reporting, and structured logging.
- `POST /api/analytics/manual-sync` for creator-initiated refresh.
- `src/AnalyticsDashboard.js` rewrite to query the new normalized columns
  and surface `last_error` per submission.
- Removal of the legacy `creator_id`-based routes
  (`api/analytics/refresh.js`, `api/analytics/fetch.js`, `api/analytics.js`,
  `api/auth/tiktok/disconnect.js`, `api/auth/meta/disconnect.js`).
