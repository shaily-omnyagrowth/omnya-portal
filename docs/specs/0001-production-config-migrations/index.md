# 0001. Production config and migrations pipeline

**Date**: 2026-10-01
**Status**: In Progress

## Summary

Production gets one repeatable command for database changes. It backs the database up, shows what it will apply, asks you to confirm, applies the changes in order with the Supabase CLI over a direct database connection, and then proves each change is really there. System Config then shows every migration and every required secret as green, amber, or red, and checks that the secrets are well formed and really work. Sensitive routes stop quietly letting traffic through when the rate limit store is down.

## Requirements

**User stories**:
- As the owner, I want one command that applies pending migrations safely, so changes land in order and I can prove they did.
- As the owner, I want System Config to tell me exactly which migration or secret is missing or wrong, so I don't have to guess from the Vercel and Supabase dashboards.
- As the owner, I want rate limits to really reject abuse in production, so sign up, payouts, and email can't be hammered when the limiter is broken.

**Acceptance criteria**:
- **AC-1**: `20260821000001_client_creator_visibility.sql` lives in `supabase/superseded/` with a note pointing to `20260822000005`. `VERIFY_20260821.sql` moves to `supabase/verify/`. The only `.sql` files left directly in `supabase/migrations/` are migration files, meaning names matching `^\d{14}_[a-z0-9_]+\.sql$`. `full-chain.test.cjs` and `migration.test.cjs` load the superseded file from its new path and still pass.
- **AC-2**: Every migration file (pattern above) has exactly one entry in `supabase/migrations/probes.json`. An offline test fails if a file has no entry, if an entry names a file that does not exist, or if a `manual` entry has no `why`.
- **AC-3**: `npm run db:migrate -- --status` is read only. Against production it prints one table with columns `file`, `recorded` (yes/no), `probe` (present/missing/manual/retired), and `state`, and changes nothing. Exit codes for every mode: 0 = every row `applied`, 1 = gaps remain, 2 = refused (prerequisite, target, or confirmation failed).
- **AC-4**: `npm run db:migrate -- --baseline` records in the history table exactly the files whose probes pass. It never records a file whose probe is missing. It asks for the typed confirmation (AC-5) before writing.
- **AC-5**: `npm run db:migrate` refuses to push (exit 2) unless all of these hold: prerequisites pass (see runner step 1), the DB URL is not the transaction pooler (port 6543), the project ref parsed from the DB URL equals `SUPABASE_PROJECT_REF`, the operator types that ref back, and a schema dump plus a data dump (schemas `public`, `auth`, `storage`, `supabase_migrations`) both succeeded to a timestamped folder outside the repo and outside OneDrive. The dry run list is printed before the confirmation prompt.
- **AC-6**: After a push, the runner probes again. It exits 0 only when every file is both recorded and probed present. Otherwise it exits non zero and lists each gap. If a file fails partway, the runner stops, probes again, prints which files landed, the failed file and its Postgres error, and the matching path in `supabase/rollbacks/` if one exists. It never runs a rollback itself.
- **AC-7**: System Config shows a Migrations panel with one row per file in one of four states: applied (recorded and present, green), broken (recorded but missing, red), pending (not recorded and missing, amber), drift (present but not recorded, amber). Only the owner can see it. Anyone else gets 403. If the status RPC isn't applied yet, the panel names migration `20261001000000` (PGRST202) instead of showing a generic error.
- **AC-8**: System Config classifies every required value as `set`, `missing`, `placeholder`, or `invalid` with a fixed reason string, using *Config rules* below. Placeholder means the value is in the existing `PLACEHOLDERS` list or matches `^your[-_]` (case insensitive). Format rules apply only when `VERCEL_ENV=production`; elsewhere a value is just `set` or `missing`. A Stripe test mode key in production is `invalid`. Social keys are required only for platforms listed in `LIVE_PLATFORMS`. Other platforms show `not live` and do not count against readiness.
- **AC-9**: `config-status` returns `ready: true` only when every required value is `set` and every migration row is `applied`. Any `broken`, `pending`, `drift`, or `manual` row, and any required value not `set`, blocks it, and each appears in `notReadyReasons`. Optional values and `not live` platforms never block it. System Config shows one overall banner from that flag, plus the reasons it is false.
- **AC-10**: A **Test connections** button (owner only) calls `POST /api/admin/config-test`. That route pings Upstash, Stripe, and Resend with read only calls (5 s timeout each, run in parallel) and confirms the `RESEND_FROM_EMAIL` domain is verified in Resend. Each result is `ok`, `restricted_key` (the provider accepted the key but it lacks permission for this read: Stripe 403 on balance, Resend 401/403 `restricted_api_key` on domains), or `failed`, with the provider's error code or HTTP status. No secret material is ever returned.
- **AC-11**: In production (`VERCEL_ENV=production`), when Upstash is unset or unreachable (missing env, non 2xx, an error element in the pipeline response, network error, 2 s timeout), routes marked `failClosed` return 503 `{ code: 'rate_limit_unavailable' }`. On every `failClosed` route the limiter runs before auth, so the 503 never depends on who is calling. Other routes are allowed through. Preview and local keep failing open with a warning.
- **AC-12**: A rate limit window always expires. One Upstash pipeline request sends `SET key 0 EX <window> NX` then `INCR key` (this works on any Redis version, unlike `EXPIRE … NX`), and every element of the response is checked for an error.
- **AC-13**: A live test sends up to 31 unauthenticated `GET /api/admin/config-status` calls to production, one after another. It passes when a 429 with `Retry-After` arrives within those 31 calls and every earlier response is 401. It reports FAILED (not BLOCKED) when no 429 arrives. It prints a warning that the caller's IP is locked out of `config-status` for up to 60 s.
- **AC-14**: An offline check fails on any migration dated `20261001000000` or later that matches `DROP\s+TABLE`, `DROP\s+COLUMN`, `RENAME\s+TO`, or `RENAME\s+COLUMN` (case insensitive), unless the file carries a `-- contract:` line naming the release that stopped reading it (the expand only rule). Policy, function, trigger, view, and index drops are not matched.
- **AC-15**: `supabase/migrations/README.md` documents the runner as the only production apply path. Each `APPLY_*.md` gets a top line marking it historical.

## Decision

**Chosen option**: Option 1: Supabase CLI over a direct DB URL, wrapped by a probing runner, with probes plus history as proof.

Apply migrations with `supabase migration repair` and `supabase db push --db-url` from a local wrapper script (`npm run db:migrate`). Prove each file with a probe manifest that both the runner and System Config read. Fail closed on sensitive rate limited routes in production.

**Implementation skills**: `supabase-postgres-best-practices` (`supabase/agent-skills`, `.agents/skills/supabase-postgres-best-practices/`) · `pglite` (`oakoss/agent-skills`, `.agents/skills/pglite/`) · `upstash-ratelimit-js` (`upstash/skills`, `.agents/skills/upstash-ratelimit-js/`) · `stripe-best-practices` (`stripe/ai`, `.agents/skills/stripe-best-practices/`) · `resend` (`resend/resend-skills`, `.agents/skills/resend/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

### Data model sketch

No new tables. One migration adds one read only function.

`supabase/migrations/20261001000000_admin_migration_status.sql` (wrapped in `BEGIN; … COMMIT;`, safe to run twice):
- `public.admin_migration_status(probes jsonb) RETURNS jsonb`, `SECURITY DEFINER`, `SET search_path = pg_catalog, public`, `STABLE`.
  - Returns `{ history: [{version, name}], probes: [{file, present, detail}] }`.
  - `history` reads `supabase_migrations.schema_migrations` when `to_regclass('supabase_migrations.schema_migrations')` is not null, else `[]`.
  - Each probe is checked against the catalog with parameters only (no dynamic SQL from input): `table` → `to_regclass`; `columns` → `information_schema.columns`; `function` → `to_regprocedure(signature)`; `function_body` → `to_regprocedure(signature)` exists and `position(marker in pg_get_functiondef(oid)) > 0`; `policy` → `pg_policies (schemaname, tablename, policyname)`; `trigger` → `pg_trigger` by `tgrelid = to_regclass(table)` and `tgname`; `index` → `to_regclass(index)`; `constraint` → `pg_constraint` by `conrelid = to_regclass(table)` and `conname`. Kinds `manual` and any entry with `retiredBy` are not sent to the RPC.
  - `REVOKE ALL … FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO service_role;`
  - The file ends with `NOTIFY pgrst, 'reload schema';` inside the transaction, so PostgREST sees the function without waiting for a cache reload.
- Rollback `supabase/rollbacks/20261001000000_admin_migration_status.rollback.sql` drops the function.
- Its own probe entry: `{ "kind": "function", "signature": "public.admin_migration_status(jsonb)" }`.

`supabase/migrations/probes.json` (shared manifest, loaded with a static `require()` from `api/_lib/migrationProbes.js`; `vercel.json` also lists it under `functions["api/admin/config-status.js"].includeFiles` as a safety net, and the first preview deploy confirms the route can read it):
```json
{
  "20260908000000_campaign_shares_and_progress.sql": {
    "label": "Campaign share links",
    "kind": "columns", "table": "public.campaigns",
    "columns": ["share_token", "share_enabled", "share_created_at"]
  },
  "20260822000005_tenant_policy_reset.sql": {
    "kind": "policy", "table": "campaigns", "policy": "campaigns_select_scoped"
  },
  "20260904000001_fix_archive_audit_signature.sql": {
    "kind": "function_body", "signature": "public.<fn>(<args>)", "marker": "<a string only the fixed body contains>"
  }
}
```
Fields: `kind` (required), `label` (optional; the UI falls back to the file name), `why` (required for `manual`), `retiredBy` (optional, see the state model). Kinds: `table`, `columns`, `function`, `function_body`, `policy`, `trigger`, `index`, `constraint`, `manual`.

Each probe names the most specific object the file leaves behind that no earlier file created. A file that only changes policies uses `policy`. A file that only rewrites a function body uses `function_body` with a marker string from the new body. A file whose object a later file replaced or dropped carries `"retiredBy": "<later file>"`. `manual` is a last resort, needs a `why`, and blocks `ready` until it is replaced. One shared evaluator, `api/_lib/migrationProbes.js`, builds the catalog query for the runner (via `pg`) and the RPC payload for System Config.

### State model (per migration row)

| Recorded in history | Probe | State | Colour |
|---|---|---|---|
| yes | present | applied | green |
| yes | missing | broken | red |
| no | missing | pending | amber |
| no | present | drift | amber |

A `retiredBy` row is `applied` when recorded and `pending` when not, whatever its probe says (its object is meant to be gone). Baseline treats a not recorded `retiredBy` row as `drift` when its `retiredBy` file probes present, because the later file could only have run after it. A `manual` row shows its `why` and counts as not ready.

Version = the 14 digit filename prefix (`20260908000000`), which is what the CLI stores in `schema_migrations.version`.

The runner moves `pending → applied` (push) and `drift → applied` (baseline repair). Nothing moves a row into `broken`. It is a symptom of a hand edit or a partial failure, and a person resolves it.

### Runner: `scripts/db-migrate.cjs` (`npm run db:migrate`)

Modes: `--status` (read only), `--baseline` (repair), default (push).

1. **Prerequisites** (any miss exits 2 with the fix):
   - Supabase CLI ≥ 2.20 through `npx supabase --version` (pinned as a devDependency `supabase` so the version is the repo's, not the machine's).
   - `.env.migrate` exists with `SUPABASE_DB_URL` and `SUPABASE_PROJECT_REF`.
   - The DB URL parses in either form: pooler (`postgres.<ref>@aws-…pooler.supabase.com:5432`, ref from the user part) or direct (`postgres@db.<ref>.supabase.co:5432`, ref from the host). Port 6543 (transaction pooler) is refused. The parsed ref equals `SUPABASE_PROJECT_REF`.
   - A dump tool: `pg_dump` on PATH whose major version is ≥ the server's major (`SHOW server_version_num` through `pg`) is preferred, since it needs no Docker. Else `supabase db dump` with Docker running. Else stop.
2. **Probe**: run every probe through `pg` and read the history table. Print the table from AC-3.
3. `--status` stops here.
4. **Backup**: to `${MIGRATE_BACKUP_DIR:-~/omnya-backups}/<UTC timestamp>/`: a schema dump, plus a data dump of schemas `public`, `auth`, `storage`, `supabase_migrations`. Resolve the folder to an absolute path first and refuse if it starts with the repo root, `%OneDrive%`, or `%OneDriveCommercial%` (the dump holds PII). Refuse if either dump exits non zero or writes an empty file.
5. **Plan**: `--baseline` lists the `drift` files it will record. Push mode runs `supabase db push --db-url … --include-all --dry-run` and prints its list (`--include-all` because older missing files sit between recorded ones). Any `broken` row stops both modes.
6. **Confirm**: the operator types the project ref.
7. **Apply**: `--baseline` runs `supabase migration repair --db-url … --status applied <version…>` for `drift` files only. Push mode runs `supabase db push --db-url … --include-all`.
8. **Verify**: probe again. Print the table. Exit per AC-3 (AC-6).

Failure fallback (decided now, so the build doesn't stall): if step 7 still hits the Management API 403 with `--db-url`, the runner falls back to applying each pending file itself through `pg`, one transaction per file in filename order. After each file it inserts only `(version, name)` into `supabase_migrations.schema_migrations`, creating the schema and table as the CLI does if they are absent. Any other columns are left to their defaults. The probes and exit rules stay the same.

### Config rules (`api/admin/config-status.js`)

| Value | Required | Well formed when |
|---|---|---|
| `SUPABASE_URL` | always | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | always | a JWT with three dot separated parts, or starts `sb_secret_` |
| `APP_BASE_URL` | always | https URL, no trailing slash, not localhost in production |
| `ENCRYPTION_KEY` | always | 64 hex characters (unchanged) |
| `CRON_SECRET` | always | at least 32 characters |
| `UPSTASH_REDIS_REST_URL` | always | `https://…upstash.io` |
| `UPSTASH_REDIS_REST_TOKEN` | always | at least 20 characters |
| `RESEND_API_KEY` | always | starts `re_` |
| `RESEND_FROM_EMAIL` | always | `addr@domain` or `Name <addr@domain>` |
| `OWNER_NOTIFICATION_EMAIL` | always | an email address |
| `STRIPE_SECRET_KEY` | always | `sk_live_` or `rk_live_` in production; `sk_test_`/`rk_test_` elsewhere |
| `STRIPE_WEBHOOK_SECRET` | always | starts `whsec_` |
| `LIVE_PLATFORMS` | optional | comma list from `tiktok`, `instagram`, `facebook`, `youtube`; unknown entry → `invalid` |
| TikTok keys | if `tiktok` live | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` set |
| Instagram keys | if `instagram` live | `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` set (the pair `instagramAppCredentials()` reads first) |
| Facebook keys | if `facebook` live | `META_APP_ID`, `META_APP_SECRET` set, else `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` |
| YouTube keys | if `youtube` live | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` set |

The format column applies only when `VERCEL_ENV=production`. On previews and locally each value is just `set` or `missing`, because previews legitimately use test keys and preview URLs.

The existing secret safety rule stands. Responses carry states and fixed reason strings ("expected the live mode key", "expected at least 32 characters", "not hexadecimal"), never a value, prefix of the value, or length of the value.

### Rate limiter (`api/_utils/rateLimit.js`)

- New option `failClosed: boolean` (default false). When true and `VERCEL_ENV === 'production'`, any path that fails open today (env missing, non 2xx, an `{error}` element in the pipeline response, thrown error, timeout) sends 503 `{ error: 'Rate limiting is unavailable. Please try again shortly.', code: 'rate_limit_unavailable' }` and returns `true`.
- One request to `${restUrl}/pipeline` with `[["SET",key,"0","EX",String(windowSecs),"NX"],["INCR",key]]`, with a 2 s timeout through `AbortController`. The count is the second element's `result`. Fix the header comment: this is a fixed window, not a sliding window.
- On every `failClosed` route the `applyRateLimit` call sits before the auth guard (move it where it doesn't today).
- `failClosed: true` on these files in `api/`: `send-email.js`, `admin/users/create.js`, `admin/users/deactivate.js`, `admin/users/restore.js`, `admin/users/role.js`, `payment-managers/grant.js`, `payment-managers/revoke.js`, `payments/void.js`, `payouts/create-batch.js`, `payouts/export.js`, `payouts/generate.js`, `payouts/mark-paid.js`, `payouts/reconcile.js`, `payouts/stripe-transfer.js`, `withdrawals/request.js`, `withdrawals/approve.js`, `withdrawals/reject.js`, `creators/payment-method.js`, `stripe/connect-url.js`, and the new `admin/config-test.js` (endpoint key `admin-config-test`, 5 per 60 s).
- Stays open: `admin/audit.js`, `admin/config-status.js` (it must load to show the limiter red), `admin/users/index.js`, `analytics/manual-sync.js`, `creator/view-count.js`, `earnings/recalculate.js`, `earnings/summary.js`, `withdrawals/index.js`, `integrations/tiktok/sync.js`.

### API surface

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/admin/config-status` (extended) | GET | none | `groups[]` (state, reason per var), `migrations[]` (file, state), `ready`, `notReadyReasons[]` | owner (`requireOwner`) | 401, 403, 429, `migrations.unavailable` with hint when PGRST202 |
| `/api/admin/config-test` (new) | POST | none | `results[]`: `{provider, result: 'ok'│'restricted_key'│'failed', code, ms}` for `upstash`, `stripe`, `resend`, `resend_domain` | owner | 401, 403, 429, 503 (limit 5 per 60 s, `failClosed`) |
| `admin_migration_status(probes)` | RPC | probes jsonb | history plus probe results | `service_role` only | PGRST202 when not applied |

Provider calls in `config-test`: Upstash `PING`; Stripe `GET /v1/balance` (read only, proves the key and its mode); Resend `GET /domains`, then match the domain part of `RESEND_FROM_EMAIL` against a domain with `status: verified`.

### Value sourcing

| Action | Value produced / displayed | Source |
|---|---|---|
| runner | target database | `SUPABASE_DB_URL` in `.env.migrate` (session pooler URL, port 5432) |
| runner | expected project | `SUPABASE_PROJECT_REF` in `.env.migrate`; prod is `aglikzyarmqbdmjvkvyj` |
| runner | backup folder | `MIGRATE_BACKUP_DIR` in `.env.migrate`, default `~/omnya-backups` |
| runner, System Config | file list | filenames in `supabase/migrations/*.sql` (runner); keys of `probes.json` (System Config, which can't list the folder at runtime; AC-2 keeps them equal) |
| runner, System Config | recorded state | `supabase_migrations.schema_migrations.version` (`pg` in the runner; the RPC in System Config) |
| runner, System Config | present state | `probes.json` entry evaluated against the catalog |
| config-status | environment is production | `VERCEL_ENV` |
| config-status | platforms that require keys | `LIVE_PLATFORMS` env (new) |
| config-status | Stripe mode | prefix of `STRIPE_SECRET_KEY`, checked server side, never returned |
| config-test | sender domain | domain part of `RESEND_FROM_EMAIL` |
| rate limiter | fail closed decision | `failClosed` option at the call site plus `VERCEL_ENV` |
| 429 test | production base URL | `APP_BASE_URL` in the test env, as the existing live suites use |

### Key invariants

- Only forward `.sql` files live in `supabase/migrations/`. No rollbacks, no superseded files.
- Every migration is expand only: it adds, never drops or renames something the deployed code reads, because previews and production share one database. Contracting happens in a later release with a `-- contract:` line (AC-14).
- Migrate first, then merge. The PR that reads new schema merges only after `db:migrate` reports it `applied`. The app's 42703/PGRST204 hints stay as the safety net.
- The runner never records a file it hasn't proven present, and never runs a rollback.
- The DB password never leaves `.env.migrate` on the operator's machine. It is never in Vercel, GitHub, or the repo.

### Security model

- `config-status`, `config-test`, and the Migrations panel are owner only, checked on the server through `requireOwner` (role from `user_profiles.role`).
- The RPC can be executed only by `service_role`. The browser never calls it.
- `.env.migrate` gets added to `.gitignore`. Backups go outside the repo and outside OneDrive, since they contain PII and financial records.
- Payments and PII are in play (payout ledger, creator emails in the dumps). Each runner run appends a line to `${MIGRATE_BACKUP_DIR}/migrate.log` (timestamp, OS user, mode, files applied, exit code) as its audit trail.

### Configuration required

- `LIVE_PLATFORMS` (Vercel, server only): comma list of platforms that are live, for example `tiktok`.
- `.env.migrate` (local, untracked): `SUPABASE_DB_URL` (session pooler string with the DB password), `SUPABASE_PROJECT_REF`, optional `MIGRATE_BACKUP_DIR`.
- New devDependencies: `pg` and `supabase` (the CLI, pinned at ≥ 2.20). Runner only, never bundled into the SPA.
- `vercel.json`: `functions["api/admin/config-status.js"].includeFiles` set to `supabase/migrations/probes.json`.

### Critical test scenarios

- Happy path: `--status` shows `20260908…` and `20261001…` pending; `db:migrate` dumps, lists both, applies, then shows all files `applied`; verifies **AC-3**, **AC-5**, **AC-6**.
- Baseline: on an empty history, `--baseline` records only probed present files, and a probe forced missing stays pending (PGlite plus a fake history schema); verifies **AC-4**.
- Partial failure: the second of two pending files raises; the first is recorded, the second isn't, the runner exits non zero naming the file, error, and rollback path; verifies **AC-6**.
- Wrong target: the ref in the URL differs from `SUPABASE_PROJECT_REF`, or the typed ref is wrong → refuses before dumping; verifies **AC-5**.
- Manifest drift: add a `.sql` with no entry → offline test fails; verifies **AC-2**.
- RPC: run as `authenticated` in PGlite → permission denied; run as `service_role` → returns probes; verifies **AC-7**.
- Config: a Stripe test key with `VERCEL_ENV=production` → `invalid`; `LIVE_PLATFORMS=tiktok` with TikTok unset → not ready; YouTube unset → `not live`; verifies **AC-8**, **AC-9**.
- Fail closed: Upstash env unset in production → `withdrawals/request` returns 503 and `earnings/summary` passes; the same on preview → both pass; verifies **AC-11**.
- Expiry: the pipeline body is `SET … EX … NX` then `INCR`, and an `{error}` element in a 200 response counts as unavailable (unit test on a fetch stub); verifies **AC-11**, **AC-12**.
- Probe kinds: PGlite cases for `function_body`, `trigger`, `constraint`, and a `retiredBy` row whose object is gone but which still shows `applied`; verifies **AC-7**.
- Live 429; verifies **AC-13**.
- Auth: AM and creator tokens get 403 from `config-status` and `config-test`; verifies **AC-7**, **AC-10**.

## Build plan

Tracer Bullet: the first thread proves one real migration reaches production through the runner and is proven live. Later slices thicken the System Config, config check, and limiter segments.

**Slice 1: one migration, end to end**
1. Move `20260821000001_client_creator_visibility.sql` to `supabase/superseded/` with a README note, and `VERIFY_20260821.sql` to `supabase/verify/`; repoint `full-chain.test.cjs` (`EXCLUDED`), `migration.test.cjs`, and any doc that names the VERIFY path; satisfies **AC-1**.
2. Write `probes.json` with one entry per file (read each file to pick its most specific object), `api/_lib/migrationProbes.js`, and the offline manifest test; satisfies **AC-2**.
3. Write `20261001000000_admin_migration_status.sql` (ending in `NOTIFY pgrst`), its rollback, and a PGlite test covering every probe kind, run as `authenticated` and as `service_role`; satisfies **AC-7**.
4. Build `scripts/db-migrate.cjs` with `--status` only (prerequisites, `pg` probe, table). Run it against production and record the output in the PR; satisfies **AC-3**.
5. Add `--baseline` (backup, confirmation, `migration repair --db-url`, probe again). Run it on production. This is the first proof that `--db-url` avoids the 403; if not, switch to the `pg` fallback here; satisfies **AC-4**, **AC-5**.
6. Add push mode (dry run, confirmation, push, probe again, failure report, `migrate.log`). Run it on production to apply `20260908…` and `20261001…`; satisfies **AC-5**, **AC-6**.

**Slice 2: System Config shows migrations**
7. Extend `config-status` to call the RPC with `probes.json`, map the four states plus `retiredBy` and `manual`, and replace the old hand written `probeTable`/`probeColumns` list. Add the `includeFiles` entry to `vercel.json` and confirm on a preview deploy that the route reads the manifest; satisfies **AC-7**.
8. Add the Migrations panel to `src/pages/SystemConfig.js`, including the PGRST202 hint; satisfies **AC-7**.

**Slice 3: config rules and readiness**
9. Add the format rules, `LIVE_PLATFORMS`, `not live` handling, `ready`, and `notReadyReasons` to `config-status`, with offline unit tests; satisfies **AC-8**, **AC-9**.
10. Show per value reasons and the readiness banner in System Config; satisfies **AC-8**, **AC-9**.
11. Add `api/admin/config-test.js` and the Test connections button; satisfies **AC-10**.

**Slice 4: limits that really reject**
12. Rework `applyRateLimit`: `SET NX EX` plus `INCR` pipeline with a check on every element, 2 s timeout, `failClosed`; unit tests; satisfies **AC-11**, **AC-12**.
13. Set `failClosed: true` on the files listed above, moving the limiter ahead of the auth guard where needed; satisfies **AC-11**.
14. Add `tests/rate-limit-live.test.cjs` (up to 31 calls, a 429 must arrive, earlier calls 401, lockout warning) and register it in `run-all.cjs`; satisfies **AC-13**.

**Slice 5: guard and docs**
15. Add the expand only check (offline test over migrations dated `20261001000000` or later); satisfies **AC-14**.
16. Rewrite `supabase/migrations/README.md` around the runner, add `.env.migrate.example`, add `.env.migrate` to `.gitignore`, and mark each `APPLY_*.md` historical; satisfies **AC-15**.

## Migration plan

**Strategy**: strangler. The runner takes over from hand pasting one step at a time. History is filled in from probes, not assumed.
**Phases**:
1. Read only: `--status` against production. Nothing changes.
2. Baseline: record the `drift` files. Only the history table changes.
3. First push: `20260908…` and `20261001…`. This also unblocks scope feature 7 (share links).
4. From then on, every schema change goes through `db:migrate` before its PR merges.
**Rollback**: phase 2 is reversed with `supabase migration repair --status reverted <version>` (history only). Phase 3 files have rollbacks in `supabase/rollbacks/` and the dump taken in step 4 of the runner. Code slices revert by reverting their commit.
**Risks**: `--db-url` may still trigger the 403 (handled by the `pg` fallback); `pg_dump` older than the server refuses to dump (checked in prerequisites; `supabase db dump` with Docker is the fallback); a weak probe could record a half applied file (mitigated by picking the most specific object, with `manual` blocking `ready`).

## Consequences

**Positive**:
- Order and history become real. `db push` stops being dangerous, and feature 7 is unblocked.
- One place (System Config) answers "is production configured and migrated?", with reasons.
- Abuse prone routes no longer quietly lose their limits when Upstash fails.

**Negative / tradeoffs**:
- An Upstash outage now returns 503 on payouts, withdrawals, user admin, and email until it recovers.
- `probes.json` is a second thing to update with every migration. AC-2 enforces it, but it is still friction.
- Migrations still run from one person's laptop with the DB password. There is no CI, so the bus factor stays one until the password is shared through a team vault.
- Expand only means a rename or drop takes two releases.
- Local dumps of production data now exist on a laptop and need care.

**Neutral**:
- Adds `pg` and `supabase` as devDependencies and a `scripts/` runner.
- The old `probeTable`/`probeColumns` list in `config-status` is replaced by the manifest.
- `supabase/AGENTS.md` (Commands, Gotchas) and `api/AGENTS.md` (rate limit fail closed rule) go stale and need `/sync`.

## Follow-up

- [ ] Run `/sync` after this ships: `supabase/AGENTS.md` should name `npm run db:migrate` as the apply path and drop the raw `db push` command; `api/AGENTS.md` should state the `failClosed` rule for new sensitive routes.
- [ ] Store the DB password and `.env.migrate` values in a shared password vault so a second person can run migrations.
- [ ] Scope feature 2 (backup restore drill) should restore one of the runner's dumps into a scratch project, which proves the dumps are usable.
- [ ] Scope feature 8 (observability) should alert on `rate_limit_unavailable` 503s and on a `ready: false` state.
- [ ] Scope feature 3 sets `LIVE_PLATFORMS` when its platform goes live.
