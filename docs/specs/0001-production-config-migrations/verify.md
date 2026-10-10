# Verify: Production config and migrations · spec 0001 · updated 2026-10-01
_Steps derived from spec 0001 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## Before anything else
- [x] Move `supabase/migrations/20260821000001_client_creator_visibility.sql` to `supabase/superseded/` and `supabase/migrations/VERIFY_20260821.sql` to `supabase/verify/` → AC-1
- [ ] Have a dump tool: PostgreSQL 17 client tools (`pg_dump --version` shows 17 or newer), or Docker running → AC-5
- [ ] Copy `.env.migrate.example` to `.env.migrate` and fill in the session pooler URL (port 5432), `SUPABASE_PROJECT_REF=aglikzyarmqbdmjvkvyj`, and a `MIGRATE_BACKUP_DIR` outside the repo and OneDrive → AC-5

## Commands (offline)
- [x] `node tests/migration-guards.test.cjs` → all pass (folder clean, manifest complete, expand only, docs) → AC-1, AC-2, AC-14, AC-15
- [x] `node supabase/migrations/__tests__/migration-status.test.cjs` → all pass (privileges, every probe kind, runner and RPC agree, probes present after the chain) → AC-7
- [x] `node supabase/migrations/__tests__/full-chain.test.cjs` and `migration.test.cjs` → pass, loading the superseded and verify files from their new folders → AC-1
- [x] `node tests/db-migrate.test.cjs` → all pass (refusals, read only status, baseline, partial failure, push) → AC-3, AC-4, AC-5, AC-6
- [x] `node tests/config-status.test.cjs` → all pass → AC-7, AC-8, AC-9, AC-10
- [x] `node tests/rate-limit.test.cjs` → all pass → AC-11, AC-12
- [x] `CI=true npm run build` → succeeds

## Commands (production, in this order)
- [ ] `npm run db:migrate -- --status` → one table; nothing written; `20260908…` and `20261001…` pending; exit 1 → AC-3
- [ ] Put `SUPABASE_PROJECT_REF=wrongref` in `.env.migrate`, run `--status` → `REFUSED`, exit 2, no connection made; restore it → AC-5
- [ ] `npm run db:migrate -- --baseline`, type a wrong ref → exit 2, no dump folder created → AC-5
- [ ] `npm run db:migrate -- --baseline`, type `aglikzyarmqbdmjvkvyj` → `schema.sql` and `data.sql` (both non empty) in a new timestamped folder; only `drift` rows recorded; `20260908…`/`20261001…` stay pending; manual rows not recorded. Note whether the CLI or the `pg` fallback recorded them (first proof about the 403) → AC-4, AC-5
- [ ] `npm run db:migrate` → dry run list printed before the prompt; type the ref; both files applied; after table shows no pending, drift or broken rows; `migrate.log` has a line per run → AC-5, AC-6
- [ ] `npm run db:migrate -- --status` → exit is 1 only because of the two manual rows (see heads up in the build report) → AC-3

## UI / manual (production System Config, after a deploy)
- [ ] As owner, open System Config → Migrations panel lists 25 rows, all Applied except 2 Manual → AC-7
- [ ] As an account manager and as a creator, `GET /api/admin/config-status` and `POST /api/admin/config-test` → 403 → AC-7, AC-10
- [ ] Before `20261001…` is applied (or on a preview where it is not), the panel shows the hint naming `20261001000000_admin_migration_status.sql`, not a generic error → AC-7
- [ ] Each env var shows Set / Not set / Placeholder / Invalid with a reason; no value, prefix or length appears anywhere in the response JSON → AC-8
- [ ] Set `LIVE_PLATFORMS=tiktok` in Vercel: TikTok keys become required; YouTube shows Not live and is not in the reasons → AC-8, AC-9
- [ ] Banner says Ready only when every reason is gone; otherwise it lists each reason → AC-9
- [ ] Click Test connections → four rows (Upstash, Stripe, Resend, sender domain), each OK / Restricted key / Failed with a code; within a few seconds → AC-10

## Value sourcing checks
- [x] Target database: change one character of the ref inside `SUPABASE_DB_URL` → refused before connecting → AC-5
- [x] Expected project: `SUPABASE_PROJECT_REF` mismatch → refused → AC-5
- [x] Backup folder: set `MIGRATE_BACKUP_DIR` inside the repo, then inside `%OneDrive%` → both refused → AC-5
- [ ] File list: add an empty `29990101000000_tmp.sql` with no `probes.json` entry → guard test fails and a write run refuses; delete it → AC-2
- [ ] Recorded state: the runner's `recorded` column matches `select version from supabase_migrations.schema_migrations` → AC-3
- [ ] Present state: for one file, compare the runner's `probe` with the object in the catalog by hand → AC-3, AC-7
- [ ] Environment is production: the same Stripe test key is Invalid on production and Set on a preview → AC-8
- [ ] Platforms that require keys: toggle `LIVE_PLATFORMS` between `tiktok` and empty, re-check → AC-8
- [ ] Stripe mode: a `sk_test_` key in production → Invalid "expected the live mode key", key never echoed → AC-8
- [ ] Sender domain: `RESEND_FROM_EMAIL` on an unverified domain → sender domain row Failed `domain_not_found` or `domain_<status>` → AC-10
- [ ] Fail closed decision: on production with Upstash unset or wrong, `POST /api/withdrawals/request` with no token → 503 `rate_limit_unavailable`; `GET /api/earnings/summary` → 401 → AC-11
- [ ] Production base URL: set `APP_BASE_URL` to production, run `node tests/rate-limit-live.test.cjs` → a 429 with Retry-After within 31 calls, earlier calls 401 (your IP is locked out of config-status for 60 s) → AC-13

## Acceptance-criteria coverage
- AC-1 … folder moves, guard test, chain tests · AC-2 … guard test, file list check · AC-3 … production status, recorded state · AC-4 … baseline run · AC-5 … refusals, target and folder checks · AC-6 … push run, db-migrate test · AC-7 … panel, 403s, PGRST202 hint, migration-status test · AC-8 … per value states, Stripe mode, LIVE_PLATFORMS · AC-9 … banner · AC-10 … Test connections, sender domain · AC-11 … fail closed check, rate-limit test · AC-12 … rate-limit test · AC-13 … live 429 · AC-14 … guard test · AC-15 … guard test
