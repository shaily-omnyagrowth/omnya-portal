# Security Notes — Omnya Portal

This file documents the security model of the portal, which keys are safe to
expose, which must stay secret, and how to recover when something leaks.

It is intentionally short. The full risk register lives in [AUDIT.md](./AUDIT.md).

---

## TL;DR — current state

| Status | Item |
|---|---|
| URGENT | The Supabase **service-role key** and **anon key** were committed in `VERCEL_DEPLOY.md` revision history. **Both must be rotated in Supabase** before the project can be considered safe. |
| URGENT | RLS policies on every table are `USING (true)` — see [AUDIT.md §4.2](./AUDIT.md#42-rls-matrix). Until those are tightened, the anon key (which is in every client bundle by design) is effectively a master key. |
| Improved | Hardcoded anon-key fallbacks were removed from `src/supabaseClient.js`, `src/AnalyticsDashboard.js`, `src/CreatorConnections.js`, `src/PayoutManager.js`, `src/pages/CreatorDashboard.js`. The client now fails loudly if env vars are missing. |
| Improved | `VERCEL_DEPLOY.md` no longer contains live keys. Placeholders only. |
| Open | API endpoints (`mark-paid`, `export`, `send-email`, `get-upload-url`, `upload-to-drive`) still lack proper server-side authorization — see AUDIT.md §3 and the Phase 4 plan. |

---

## Key classification

### Safe to be public (bundled into the React build)

- `REACT_APP_SUPABASE_URL` — identifies the Supabase project. Already discoverable
  from the network tab; not secret.
- `REACT_APP_SUPABASE_ANON_KEY` — the Supabase "anon" JWT. **Designed to be
  public.** It identifies the project and the anon role. The only thing that
  prevents abuse is Row-Level Security. **If RLS is broken, this key becomes a
  master key.** That is exactly the situation today; see AUDIT.md §4.2.

### Must NEVER be public

- `SUPABASE_SERVICE_ROLE_KEY` — bypasses RLS entirely. Read/write/delete any row
  in any table. Treat like a database root password. Only used inside
  `api/**/*.js` (Vercel serverless), never imported anywhere under `src/`.
- `RESEND_API_KEY`, `ANTHROPIC_API_KEY`, `CRON_SECRET`, all OAuth client secrets
  (`*_CLIENT_SECRET`, `*_APP_SECRET`), `GOOGLE_REFRESH_TOKEN` — server-only.
- OAuth client IDs (`TIKTOK_CLIENT_KEY`, `INSTAGRAM_APP_ID`, etc.) — technically
  public per OAuth, but no reason to ever paste them into client code; keep in
  Vercel env vars.

---

## Key rotation runbook (do this NOW for Supabase)

1. **Open Supabase → your project → Settings → API.**
2. Click **Reset** next to the `service_role` key. Copy the new value once;
   it is shown only once.
3. (Recommended) Click **Reset** next to the `anon` key as well, since the old
   value is also in git history.
4. **Vercel → Project → Settings → Environment Variables.** Update both keys
   (`SUPABASE_SERVICE_ROLE_KEY`, plus `REACT_APP_SUPABASE_ANON_KEY` and
   `SUPABASE_ANON_KEY` if you keep that variant) in Production, Preview, and
   Development scopes. Trigger a new deployment.
5. **Local `.env.local`:** update the same two values for any developer machine.
6. Audit Supabase → Logs → API for any suspicious calls between the moment the
   key was first committed and the moment of rotation.

The same procedure applies to any other secret in the table above if it ever
shows up in a diff or screenshot. Treat any accidental disclosure as a leak
even if it was on a private repo — repos get cloned, forked, and forwarded.

---

## How to keep keys out of source

- Never paste a real key into a `.md`, `.js`, `.json`, or `.sql` file. Only into
  the Vercel dashboard, `vercel env add`, or `.env.local` (which is in
  `.gitignore`).
- If you must reference a key value in code, **fail loudly on missing env vars**
  (see `src/supabaseClient.js` for the pattern) rather than fall back to a
  hardcoded value.
- Before pushing: `git diff --name-only origin/main | xargs grep -lE
  "eyJhbGciOi[A-Za-z0-9_-]+|sk-[a-zA-Z0-9-_]+|rk_[a-zA-Z0-9]+"` will catch most
  JWT/Resend/Stripe-style secrets. Worth wiring as a pre-commit hook (planned
  Phase 14).

---

## Why the anon key in the client bundle is normally fine

Supabase issues two JWTs: `anon` (public) and `service_role` (secret). The anon
JWT identifies the project + the `authenticated` / `anon` Postgres roles. Every
query through `@supabase/supabase-js` from the browser is subject to RLS. If RLS
policies are written correctly, even someone with the anon key can only read or
modify what the policies allow.

**That's the whole security model.** If your RLS is `USING (true)`, the anon key
gives a stranger full database access — which is what this audit found. Fixing
RLS is therefore a prerequisite for considering the anon key safe to ship in the
client bundle.

---

## Open items (tracked in AUDIT.md §7)

- Phase 2/3: schema migration + role-scoped RLS policies (drafting next).
- Phase 4: server-side authorization on payouts/email/upload endpoints.
- Phase 7: OAuth state nonce + PKCE for TikTok; signed-and-stored state.
- Phase 8: analytics cron is currently a no-op (fixed in this branch — see
  commit log).
- Phase 14: CI secret-scanning + pre-commit hooks.
