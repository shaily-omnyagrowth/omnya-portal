# Omnya Portal

Creator, client and staff portal for a UGC agency: campaigns, content submissions, social analytics, creator earnings and payouts.

## Stack

- **Language / Runtime**: JavaScript (no TypeScript). Browser SPA plus Node serverless functions (CommonJS)
- **Framework**: React 19 on Create React App (`react-scripts` 5). No router library
- **Backend**: Vercel functions in `api/`, Vercel cron (see `vercel.json`), Supabase Postgres with RLS, Auth and Storage
- **Key dependencies**: `@supabase/supabase-js`, `stripe` (Connect payouts), Resend (email over REST), Upstash Redis (rate limits over REST)
- **Package manager**: npm

## Build approach

<TBD, set by /scope>

## Commands

```bash
# Install
npm install

# Dev server (SPA only, port 3000; /api/* is NOT served here)
npm start
node tests/lib/devServer.cjs   # serves /api/* on :3100 and proxies the rest to CRA

# Build (CI runs it with CI=true, so lint warnings fail the build)
npm run build

# Test (custom harness, not Jest; see tests/AGENTS.md)
node tests/run-all.cjs --offline-only   # fast lane, no servers
node tests/run-all.cjs                  # everything; exit 3 means blocked on a migration
```

## Specs

Stored in `docs/specs/`. Format: `docs/specs/NNNN-title.md`.

## Rules

- Roles come from `user_profiles.role` in the database, never from email or client input. Values: `owner`, `am` (stored as `account_manager`), `creator`, `client`, `pending`, `denied`. Normalize `account_manager` to `am` everywhere.
- Anything privileged (service role key, money, user lifecycle, OAuth tokens) runs in `api/`, never in the browser. The browser only uses the anon key under RLS.
- Every schema change is a new timestamped file in `supabase/migrations/`, wrapped in `BEGIN; … COMMIT;`. Code must expect that a migration may not be applied yet in production and say so (PostgREST `42703` / `PGRST204`) rather than fail generically.
- Writes must report when they did not happen: check `error` and ask for the row back (`.select()`), since RLS filtering returns zero rows, not an error.
- Server only env vars never get a `REACT_APP_` prefix; only `REACT_APP_*` values are bundled into the browser.
- Comments explain why, often citing an audit finding id (`N-10`, `F-3`). Keep those ids when editing nearby code.
- Commits use Conventional Commits with a scope, e.g. `fix(share): …`, `feat(db): …`. `main` deploys to production through PRs.

## Gotchas

- `vercel.json` uses `cleanUrls`, so rewrite destinations must not end in `.html` or deep links 404. `tests/vercel-rewrites.test.cjs` guards this.
- Preview deployments sit behind Vercel SSO, so automated checks against them get a login page.
- The CSP in `vercel.json` only allows `connect-src` to Supabase. Any new browser side third party call must go through `api/`.
- Root `*.sql` files (`database_setup.sql` and friends) are historical. `supabase/migrations/` is the source of truth.
- The many root `*.md` reports (`AUDIT.md`, `SYSTEM_AUDIT.md`, etc.) are dated snapshots, not current truth.

## Agent skills

Installed skills live in `.agents/skills/` and are listed in the area doc they govern (`api/`, `supabase/`, `tests/`).

MCP servers: Supabase (connected), Stripe (recommended), Upstash (recommended), Resend (recommended)

## Context files

- [src/AGENTS.md](src/AGENTS.md): the React SPA, its page state routing in `App.js`, and write helpers
- [api/AGENTS.md](api/AGENTS.md): Vercel function conventions, auth guards, OAuth and token encryption
- [supabase/AGENTS.md](supabase/AGENTS.md): migration and rollback rules, PGlite migration tests
- [tests/AGENTS.md](tests/AGENTS.md): the custom test harness, BLOCKED vs FAILED, live database safety

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
