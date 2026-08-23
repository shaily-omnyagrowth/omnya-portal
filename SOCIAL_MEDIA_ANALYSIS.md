# Social Media Integration — Full Analysis

## Platforms Supported

| Platform | OAuth Flow | Token Type |
|---|---|---|
| TikTok | PKCE OAuth 2.0 | Access + Refresh (60 days) |
| Instagram | Meta Business Login | Long-lived only (~60 days) |
| Facebook | Meta Login + Pages | Long-lived only (~60 days) |
| YouTube | Google OAuth 2.0 | Access + Refresh (offline) |
| Meta | Generic Meta provider | Long-lived only |

---

## Technology Stack

- **Auth Protocol**: OAuth 2.0 with PKCE (TikTok), standard OAuth 2.0 (others)
- **Backend**: Vercel Serverless Functions (`/api/auth/<platform>/`)
- **Database**: Supabase Postgres — `oauth_states` + `creator_tokens` tables
- **Security Utilities**: `api/_utils/oauth.js` — SHA-256 state hashing, RFC 7636 PKCE
- **Frontend**: React component `src/CreatorConnections.js`
- **Cron Sync**: Vercel Cron every 12h → `api/analytics/sync.js`

---

## API Endpoints

### TikTok

#### `api/auth/tiktok/start.js`
- Generates OAuth state with PKCE verifier, returns TikTok authorization URL
- Auth: JWT required (`requireAuth`)
- Generates 32-byte random state + 48-byte PKCE code verifier
- Stores hashed state in `oauth_states` table with 10-min TTL
- Returns authorization URL to `https://www.tiktok.com/v2/auth/authorize/`
- Scopes: `user.info.basic`, `video.list`
- Security: PKCE verifier stored server-side only (never sent to browser)

#### `api/auth/tiktok/callback.js`
- Handles OAuth callback, exchanges code for tokens
- Validates state via `consumeOAuthState()` (one-time use, platform-bound)
- Exchanges code + PKCE verifier at `https://open.tiktokapis.com/v2/oauth/token/`
- Upserts `creator_tokens` table with `platform='tiktok'`
- Stores: `access_token`, `refresh_token`, `expires_at`, `refresh_expires_at`, `platform_user_id` (from `open_id`)

---

### Instagram

#### `api/auth/instagram/start.js`
- Initiates Instagram Business Login flow
- Endpoint: `https://www.instagram.com/oauth/authorize`
- Scopes: `instagram_business_basic`, `instagram_business_manage_insights`

#### `api/auth/instagram/callback.js`
- Exchanges code at `https://api.instagram.com/oauth/access_token` (short-lived token)
- Upgrades to long-lived token (~60 days) via `https://graph.instagram.com/access_token` using `ig_exchange_token` grant
- Fetches user profile from `https://graph.instagram.com/me` for username/ID
- Upserts with `platform='instagram'` and `metadata.provider='instagram'`
- No refresh token (long-lived only); token can be refreshed before expiry

---

### Facebook

#### `api/auth/facebook/start.js`
- Facebook Pages OAuth flow
- Scopes: `pages_show_list`, `pages_read_engagement`, `pages_read_user_content`
- Uses `/api/auth/meta/callback` shared handler
- Stored as `platform='facebook'` in `creator_tokens`

---

### YouTube

#### `api/auth/youtube/start.js`
- Provider: Google OAuth 2.0
- Endpoint: `https://accounts.google.com/o/oauth2/v2/auth`
- Key params: `access_type=offline`, `prompt=consent` (forces refresh token re-issue)
- Scopes: `https://www.googleapis.com/auth/youtube.readonly`, `https://www.googleapis.com/auth/yt-analytics.readonly`

#### `api/auth/youtube/callback.js`
- Exchanges code at `https://oauth2.googleapis.com/token`
- Fetches channel info from YouTube API `/channels?part=snippet&mine=true`
- Stores `platform='youtube'`, channel ID as `platform_user_id`, channel title as `platform_username`

---

### Meta (Generic)

#### `api/auth/meta/start.js`
- Endpoint: `https://www.facebook.com/v19.0/dialog/oauth`
- Scopes: `instagram_basic`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`
- Stored as `platform='meta'`

#### `api/auth/meta/callback.js`
- Shared callback for Facebook, Instagram, and Meta flows
- Smart routing: tries to match state against `['facebook', 'meta']` platforms
- Two-stage token upgrade:
  1. Short-lived token exchange at `https://graph.facebook.com/v19.0/oauth/access_token`
  2. Long-lived upgrade via `fb_exchange_token` grant (~60 days)
- Meta does NOT issue refresh tokens; uses long-lived tokens only

---

### Disconnect

#### `api/auth/disconnect.js`
- Soft-deletes OAuth connection (clears tokens, marks disconnected)
- Auth: JWT required
- Sets `status='disconnected'`, clears `access_token`/`refresh_token`, retains audit row
- Supported platforms: `tiktok`, `instagram`, `facebook`, `meta`, `youtube`

---

## How TikTok Connection Works (Step by Step)

### Start Flow

1. User clicks "Connect TikTok" in `src/CreatorConnections.js`
2. Frontend POSTs to `/api/auth/tiktok/start` with JWT
3. Server generates a 32-byte random `state` + 48-byte PKCE `code_verifier`
4. Stores **SHA-256 hash** of state + verifier in `oauth_states` table (10-min TTL)
5. Returns auth URL: `https://www.tiktok.com/v2/auth/authorize/?client_key=...&code_challenge=...`
6. Frontend does `window.location.href = authorizationUrl` → user lands on TikTok

### Callback Flow

1. TikTok redirects to `/api/auth/tiktok/callback?code=...&state=...`
2. Server calls `consumeOAuthState()` — validates state hash, marks it one-time-used
3. Exchanges `code` + the stored PKCE `code_verifier` at `https://open.tiktokapis.com/v2/oauth/token/`
4. Upserts `creator_tokens` table: `platform='tiktok'`, tokens, `open_id`, expiry
5. Redirects to `/?page=social-connections&connected=tiktok`
6. Frontend detects URL param, shows success toast, refreshes connection list

---

## Shared OAuth Utilities — `api/_utils/oauth.js`

| Function | Purpose |
|---|---|
| `generateRandomState()` | 32-byte URL-safe random string |
| `hashState(state)` | SHA-256 digest (persisted, not the raw state) |
| `generateCodeVerifier()` | RFC 7636 PKCE verifier (43-128 chars) |
| `generateCodeChallenge(verifier)` | S256 hash (base64url) |
| `storeOAuthState(...)` | Writes to `oauth_states` table |
| `consumeOAuthState(...)` | Validates, marks used (one-time only) |

---

## Social Connections API — `api/social/connections.js`

- **Endpoint**: `GET /api/social/connections?userId=<optional>`
- **Auth**: JWT required
- **Function**: Returns safe connection status (no raw tokens)

**Access Control**:
- Creators see only their own connections
- AMs see connections for creators assigned to them
- Owners see any user's connections

**Response Structure**:
```json
{
  "ok": true,
  "data": {
    "connections": [
      {
        "platform": "tiktok",
        "status": "connected|expired|error|disconnected",
        "platformUserId": "...",
        "platformUsername": "...",
        "expiresAt": "2026-06-10T...",
        "refreshExpiresAt": "2026-07-10T...",
        "lastSyncedAt": "2026-06-04T...",
        "lastError": null,
        "createdAt": "...",
        "updatedAt": "..."
      }
    ]
  }
}
```

---

## Frontend — `src/CreatorConnections.js`

**Components**:
- `CreatorConnections` — main React component
- `ConnectionCard` — per-platform UI card

**Platform Metadata**:
```javascript
PLATFORM_META = {
  tiktok:    { label: 'TikTok',     icon: '📱', subtitle: 'Videos & Analytics' },
  instagram: { label: 'Instagram',  icon: '📸', subtitle: 'Analytics & Insights' },
  facebook:  { label: 'Facebook',   icon: '👤', subtitle: 'Pages & Feed' },
  youtube:   { label: 'YouTube',    icon: '🎥', subtitle: 'Channel & Videos' },
}
```

**Status States**:
| Status | Badge Color | Action Button |
|---|---|---|
| `connected` | Green | — |
| `expired` | Orange | Reconnect |
| `error` | Red | Reconnect |
| `disconnected` | Gray | Connect Account |

---

## Database Schema

### `oauth_states` Table

```sql
CREATE TABLE public.oauth_states (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL,
  state_hash      TEXT NOT NULL,        -- SHA-256 of the random state
  code_verifier   TEXT,                  -- PKCE verifier (TikTok only)
  redirect_after  TEXT,                  -- e.g., "/?page=social-connections"
  expires_at      TIMESTAMPTZ NOT NULL,  -- 10-minute TTL
  used_at         TIMESTAMPTZ,           -- set on consume, prevents replay
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

**Indexes**: `(user_id, platform)`, `(expires_at)`, `(state_hash)`  
**RLS**: Deny-all for authenticated users; service-role only

### `creator_tokens` Table (Key Columns)

| Column | Type | Purpose |
|---|---|---|
| `status` | TEXT | `connected\|expired\|error\|revoked\|disconnected` |
| `platform_user_id` | TEXT | Provider's user ID (e.g., TikTok `open_id`) |
| `platform_username` | TEXT | Provider's username / channel title |
| `token_type` | TEXT | `bearer` or provider-specific |
| `scope` | TEXT | Comma-separated scopes granted |
| `expires_at` | TIMESTAMPTZ | Access token expiry |
| `refresh_expires_at` | TIMESTAMPTZ | Refresh token expiry (TikTok, YouTube) |
| `last_synced_at` | TIMESTAMPTZ | Last analytics sync timestamp |
| `last_error` | TEXT | Error message from last sync attempt |
| `metadata` | JSONB | Provider-specific fields |

**Unique Constraint**: `(user_id, platform)`

### `creator_connection_status` View

Safe projection for browser reads (no raw tokens):
```sql
CREATE OR REPLACE VIEW public.creator_connection_status AS
SELECT id, user_id, platform, platform_user_id, platform_username, status,
       expires_at, refresh_expires_at, last_synced_at, last_error,
       created_at, updated_at
FROM public.creator_tokens;
```

**RLS**: `security_invoker=true` — inherits RLS from base table

---

## Analytics Sync System

### Auto Sync — `api/analytics/sync.js`
- Trigger: Vercel Cron every 12 hours
- Auth: `CRON_SECRET` header (timing-safe comparison)
- Syncs metrics for all Final Post submissions

### Manual Sync — `api/analytics/manual-sync.js`
- Endpoint: `POST /api/analytics/manual-sync`
- Auth: JWT required (role-scoped)
- Rate limit: 5 manual syncs per minute per user
- Scope: Creators → own submissions; AMs → assigned creators; Owners → any

### Shared Utilities — `api/_utils/analytics.js`

**Video ID Extraction (regex per platform)**:
```
TikTok:    /video/(\d+)
Instagram: /(?:p|reel|tv)/([A-Za-z0-9_-]+)
Facebook:  v=, /videos/, /posts/, fb.watch/
YouTube:   watch?v=, youtu.be/, shorts/
```

**Token Refresh Strategy**:
| Platform | Refresh Method |
|---|---|
| TikTok | `POST open.tiktokapis.com/v2/oauth/token/` with `grant_type=refresh_token` |
| YouTube | `POST oauth2.googleapis.com/token` |
| Instagram | `GET graph.instagram.com/refresh_access_token` |
| Meta/Facebook | No refresh — long-lived token only, returns `null` |

**Metrics Fetchers**:
| Platform | Endpoint |
|---|---|
| TikTok | `POST /v2/video/query/` → views, likes, comments, shares |
| YouTube | `GET /youtube/v3/videos?part=statistics` |
| Instagram | Instagram Business API via `graph.instagram.com` |
| Facebook | `GET /v19.0/{video_id}?fields=likes,comments,shares` |

---

## Security Model

| Feature | Implementation |
|---|---|
| Server-side state | Browser never sees the PKCE verifier |
| One-time state | Consumed states cannot be replayed |
| Platform-bound state | TikTok state cannot be used with YouTube callback |
| PKCE for TikTok | Code verifier stored server-side only |
| JWT verification | All `/api/auth/` start endpoints require bearer JWT |
| RLS deny-all | `oauth_states` accessible only via service role |
| Tokens never logged | Callbacks emit success/error codes only |
| Safe frontend view | `/api/social/connections` omits all token columns |
| Rate limiting | Manual sync capped at 5 calls/min per user |
| Timing-safe auth | Cron secret compared with constant-time hash |

---

## Environment Variables

| Group | Variable |
|---|---|
| TikTok | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` |
| Meta / Instagram / Facebook | `META_APP_ID`, `META_APP_SECRET` |
| YouTube | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` |
| Supabase | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| App | `APP_BASE_URL`, `CRON_SECRET` |

Optional overrides: `TIKTOK_REDIRECT_URI`, `META_REDIRECT_URI`, `YOUTUBE_REDIRECT_URI`, `ADDITIONAL_ALLOWED_ORIGINS`

---

## Related Documentation

- `SOCIAL_MEDIA_INTEGRATION.md` — OAuth flow diagrams, provider setup, DB reference, error troubleshooting, deployment checklist
- `IMPLEMENTATION_SUMMARY.md` — Operator overview of all changes
- `AUDIT.md` — Security findings and architecture review
- `SECURITY_NOTES.md` — Key classification and Supabase rotation runbook
- `supabase/migrations/README.md` — Migration apply procedures and QA matrix
- `supabase/migrations/20260522000000_social_media_feature.sql` — Full schema migration
