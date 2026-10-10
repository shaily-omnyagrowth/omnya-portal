# Review, feat/ugc, 2026-10-01

**Reviewed by**: Claude Sonnet 5.5 (review subagent; author model not stated)
**Scope**: about 53 files (36 modified, 17 new), uncommitted vs origin/main (HEAD c01b3b6)
**Verdict**: Changes requested

## Summary
Implements spec 0001: a probing migration runner (`scripts/db-migrate.cjs`), a shared probe manifest and evaluator, a service-role-only status RPC, an extended `config-status` plus a new `config-test`, and a reworked fail-closed rate limiter applied to 20 sensitive routes. The design is careful and mostly matches the spec (refusal ordering, password kept out of argv for pg_dump, SECURITY DEFINER hygiene, secret-free responses). The headline problems are in the runner's failure path: the pg fallback re-applies from a stale target list, and the verify step reuses a connection that may have gone idle. Two smaller regressions: `creators/payment-method` lost its per-user rate-limit key, and stuck legacy limiter keys are not repaired.

## Major
### 🟠 pg fallback re-applies files from a stale target list, `scripts/db-migrate.cjs:415`
**Problem**: The fallback decision is `r.status !== 0 && looksForbidden(out)`, and `looksForbidden` is `/\b403\b|forbidden|management api/i` over the whole CLI output (stdout plus stderr). The CLI output also carries "Applying migration ..." lines and the echoed failing SQL statement. `applyWithPg(sys, client, targets)` then replays every file in `targets`, which was computed before the CLI ran, without re-reading history.
**Why it matters**: If `db push` lands file 1 and fails on file 2 with any error text that contains "403", "forbidden" or "management api" (a value in a statement, a constraint message), the runner treats it as the Management API 403 and re-applies file 1 through `pg`. The spec itself warns that some files are not safe to repeat (20260530000001 brings back unguarded payout RPCs), and this is the production money database. The test suite only exercises the case where the CLI fails before applying anything. Likelihood is low, blast radius is high.
**Suggested fix**: Anchor the 403 detection to the specific Management API failure (the CLI's "unexpected status 403" text) and not to the SQL echo. Before the fallback, re-read history and probes and apply only files that are still unrecorded. Add a test where the CLI stub lands the first file, then fails with 403-looking text on the second.

## Minor
### 🟡 Verify step reuses a connection that sat idle through the dumps and the CLI, `scripts/db-migrate.cjs:330`
**Problem**: One `pg` client is opened before the state read and reused after the dumps, the confirmation prompt and the CLI push. No keepalive is set and nothing reconnects.
**Why it matters**: A session pooler or network device can drop an idle connection during a long data dump or push. `readState(client)` then throws, the catch prints a stack trace, and the exit is 1 even though the push may have fully succeeded. The operator loses the AC-6 verification table and the "Landed" list, and `migrate.log` records no applied files.
**Suggested fix**: Open a fresh connection for the post-apply probe (and for the fallback apply), or enable `keepAlive` on the client.

### 🟡 `creators/payment-method` rate limit lost its per-user key, `api/creators/payment-method.js:52`
**Problem**: Moving the limiter before auth removed `userId`. The limit of 5 per hour is now per IP only, shared by every creator behind the same address.
**Why it matters**: Creators on a shared network (office, university, mobile carrier NAT) now exhaust one bucket together, and an unauthenticated caller can burn a victim IP's budget. The other failClosed routes were already IP keyed, so this is the one real behavior change.
**Suggested fix**: Keep the pre-auth IP limit as spec 0001 dictates, but raise it, or add a second post-auth per-user limit. State the tradeoff in the comment.

### 🟡 Legacy limiter keys without a TTL are never repaired, `api/_utils/rateLimit.js:107`
**Problem**: `SET key 0 EX n NX` is a no-op when the key already exists. Keys created by the old INCR-then-EXPIRE code whose EXPIRE was lost still have no TTL, and `INCR` keeps them that way. There is also a very narrow window where the key expires between the two pipeline commands and `INCR` recreates it with no TTL (the pipeline is not MULTI/EXEC).
**Why it matters**: Any IP already stuck over its max stays locked out indefinitely, which is the exact failure AC-12 is meant to end. The fix does not take effect for them until someone flushes `rl:*` by hand.
**Suggested fix**: Document a one-time flush of `rl:*` in the rollout notes, or use the transactional endpoint. A cheap runtime guard: if the count exceeds `max` and `TTL` is -1, set the expiry.

### 🟡 A failed connection or repair exits 1, not 2, `scripts/db-migrate.cjs:450`
**Problem**: Any non-`Refusal` error (database connect failure, `migration repair` failing for a non-403 reason) is exit 1 "gaps remain". Confirms the known item.
**Why it matters**: Callers that read exit 1 as "migrations pending" will be misled by an unreachable database. The spec reserves 1 for gaps.
**Suggested fix**: Map connection and prerequisite-time failures to 2. Keep 1 for failures after the apply step has started.

### 🟡 Two `manual` probes mean `ready` can never be true and the first push re-runs them, `supabase/migrations/probes.json:30`
**Problem**: Confirms the known spec gap, with a consequence beyond `ready`. `computeRows` returns `manual` even for a recorded row, and baseline never records manual files, so the first push re-runs `20260528000001` and `20260822000002` against production. I checked both: they are drop-and-recreate and drop-all-policies on creator_tokens, so they are idempotent today, and no later migration touches `user_profiles_insert_self_or_owner`. That safety is by inspection only.
**Why it matters**: The status table and `ready` stay red permanently, which trains the owner to ignore the banner.
**Suggested fix**: Add a probe kind that checks a policy definition for a marker (or a comment marker via `obj_description`), or let a recorded manual row count as applied once someone has verified it.

### 🟡 TLS is not verified and the CLI gets the password in argv, `scripts/db-migrate.cjs:160`
**Problem**: (a) `ssl: { rejectUnauthorized: false }` and `PGSSLMODE=require` mean the DB password goes to whoever answers on the host; pinning by host and ref does not authenticate the server. (b) `supabase db push|dump|migration repair --db-url` put the password in the process arguments, unlike the pg_dump path, which uses `PGPASSWORD`.
**Why it matters**: Low likelihood on a single operator laptop, but this is the production DB credential and the runner is the only apply path.
**Suggested fix**: Pin Supabase's CA certificate and use full verification. For the CLI calls, check whether the URL can be passed through an environment variable.

### 🟡 `config-status` says "not applied" for any error that mentions the function, `api/admin/config-status.js:48`
**Problem**: `missingFn` is `error.code === 'PGRST202' || /admin_migration_status/.test(error.message)`. A "permission denied for function admin_migration_status" or a runtime error in the function also matches.
**Why it matters**: The owner is told to apply a migration that is already applied. AC-7 asks for the migration hint on PGRST202 only.
**Suggested fix**: Key the hint on PGRST202 (and 42883) only; show other errors as generic.

### 🟡 Resend domain check ignores pagination, `api/admin/config-test.js:85`
**Problem**: `GET /domains` returns one page. A verified sender domain beyond the first page is reported `domain_not_found`.
**Why it matters**: Low (few domains per account), but it produces a red result for a working setup.
**Suggested fix**: Request the maximum page size, or follow the cursor.

### 🟡 The primary CLI path is untested, `tests/db-migrate.test.cjs`
**Problem**: Every write test stubs the CLI to answer 403, so only the pg fallback runs. CLI push success, a non-403 CLI failure end to end, a CLI failure after one file landed, and a baseline through CLI repair are not covered.
**Why it matters**: The spec names the CLI as the primary path, and the fallback exists for a failure that is not yet confirmed to happen. The Major finding above lives in the uncovered mixed case.
**Suggested fix**: Add stub scenarios for CLI success, CLI failure after landing one file, and CLI repair success.

## Nits
- ⚪ `scripts/db-migrate.cjs:107`, a Git Bash path such as `/c/Users/...` resolves to `C:\c\Users\...` on Windows (confirms the known item). Not an OneDrive bypass, but the backup lands somewhere unintended. Junctions and symlinks are also not resolved with `realpath` before the repo and OneDrive containment check.
- ⚪ `scripts/db-migrate.cjs:332`, `--status` requires a dump tool and creates the backup root and a `migrate.log` entry. This matches spec step 1 but makes the read-only mode fail on a machine that only wants to look.
- ⚪ `scripts/db-migrate.cjs:410`, baseline adds `targets` to `applied` before verifying the repair recorded them; the Landed line can overstate on a silent no-op.
- ⚪ `scripts/db-migrate.cjs:463`, no advisory lock, so two operators could run at once; state is read once and not rechecked after the (possibly long) backup.
- ⚪ `scripts/db-migrate.cjs:243`, the backup directory has default permissions; the dump has password hashes and PII.
- ⚪ `api/admin/config-test.js:142`, comment names `tests/config-rules.test.cjs`; the file is `tests/config-status.test.cjs`.
- ⚪ `supabase/migrations/20261001000000_admin_migration_status.sql:42`, add `pg_temp` last in the SECURITY DEFINER `search_path` as usual hardening.
- ⚪ `api/_utils/rateLimit.js:139`, `Retry-After` is always the full window, not the remaining TTL (pre-existing).

## Dismissed
- The 503 body `{error, code}` differing from the `{ok:false,error:{...}}` envelope: the spec dictates it, and `SystemConfig.js` reads `payload.code` consistently.

## Strengths
- Refusal logic is thorough and well ordered: unknown args, the 6543 pooler, ref mismatch, typed confirmation (TTY only), dump success and non-empty check, and the drift and broken guards before any write. The drift guard in push mode protects the payout-RPC re-run hazard.
- The probe SQL exists once, in the migration, and the runner lifts it out with markers, so the runner and the System Config panel cannot disagree. The RPC uses only parameters (no dynamic SQL), revokes from PUBLIC/anon/authenticated, grants service_role only, and ends with `NOTIFY pgrst`.
- Rate limiter: the SET NX EX plus INCR pipeline checks every element, has a 2 s abort, and closes only in production; limiter-before-auth ordering holds on all 20 routes and a test guards both route lists.
- Secret safety in `configRules.js` and `config-test.js` is deliberate: fixed reason strings, no lengths, no provider messages passed through.
- Probe choices I spot-checked hold up (`p_entity_label` appears only in the fixed trigger body, the signup marker exists once, the `payout_email` columns have no earlier source).

## Test coverage
Configured harness; coverage is strong for the new logic. `db-migrate.test.cjs` runs the runner against PGlite (status, baseline, partial failure, wrong ref, empty and failed dumps, happy push), `migration-guards.test.cjs` covers AC-1, 2, 14 and 15 with self-tests of the validators, `rate-limit.test.cjs` covers the pipeline body, fail-closed versus open, timeout and route ordering, and `config-status.test.cjs` covers the owner gate, states and `ready`. Gaps: the real CLI success path and the mixed CLI-then-fallback failure, the stale connection case, and legacy no-TTL keys.
