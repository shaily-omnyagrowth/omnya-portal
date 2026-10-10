# 0001. Production config and migrations pipeline: rationale

The build spec is [index.md](index.md). This file is the decision record.

## Context

> ⚠️ Premise note: the scope row joins three concerns: how migrations reach production, how config is proven correct, and whether rate limits really enforce. They are separate decisions, but each is small and they share one done condition ("System Config is green and limits reject"). So they stay in one spec. If any of them grows (for example CI driven migrations), give it its own spec.

Production is one Supabase project (`aglikzyarmqbdmjvkvyj`), shared by production and every Vercel preview. There is no staging project and no CI. Every migration so far was pasted into the SQL Editor by hand, following `APPLY_*.md`. As a result the CLI history table (`supabase_migrations.schema_migrations`) is empty, files landed out of order, and nobody can say from one place which of the 25 files are live. Two incidents already came from this. On 2026-09-04 a `db push` started replaying everything from the first file, rollbacks included. And `20260821000001` is a file that would break every read of `campaigns` (SQLSTATE 42P17) if applied, yet it still sits in the forward folder.

`db push` from a linked project failed on 2026-09-18 with a 403. Recent CLI versions create a temporary login role through the Management API, which needs an org role the CLI login doesn't have. The connected Supabase MCP can't reach the Omnya org either. The only credential that reliably reaches the database is the DB password.

On config, `api/admin/config-status.js` checks 19 values, but only `ENCRYPTION_KEY` for shape. A Stripe test key, a wrong Resend sender, or a revoked token all show green. Its schema probes cover five objects, not every migration.

`api/_utils/rateLimit.js` fails open whenever Upstash is unset or errors, and logs a warning once. Every limit on payouts, withdrawals, user admin, and email becomes a no op without anyone seeing it. Its `EXPIRE` is fire and forget, so one failed call leaves a counter that never resets.

## Options considered

### Option 1: CLI over a direct DB URL, wrapped by a probing runner (chosen)

Fill in history with `migration repair` for files proven present, then `db push --db-url`, all inside a local script that backs up, confirms, and probes before and after.

**Pros**: uses the standard Supabase tool and history format; skips the Management API; applies only what's missing, in order; proof comes from the catalog, not memory.
**Cons**: still a single operator on a laptop; depends on the CLI keeping `--db-url` free of the Management API (a fallback is needed); one more manifest to maintain.

### Option 2: Keep the SQL Editor, add a checklist and probes

Paste by hand as today, then run a probe script.

**Pros**: nothing new to learn; works without any CLI.
**Cons**: order and history stay manual, which is exactly how the drift happened; nothing stops a pasted superseded file.

### Option 3: Fix the org role, then link the CLI normally

Have the org owner grant the right role, then use `supabase link` and `db push`.

**Pros**: the CLI's default path, with no URL handling.
**Cons**: blocked on another person's access; still needs the history baseline and the probes; ties the apply path to an org membership that could change again.

### Option 4: GitHub Action runs `db push` on merge to main

**Pros**: automatic, with an audit trail in CI logs; no laptop dependency.
**Cons**: there is no CI today; the production DB password would live in GitHub secrets; a merge would change production schema with no human looking at the dry run, which matters more with no staging.

For proof, "history plus probes" beat "probes only" (no order or record) and "history only" (a hand applied or half applied file makes the history lie). For staging, PGlite plus a dry run beat a second project, because keeping two schemas aligned costs more than the extra safety buys at this team size, and feature 2 covers recovery.

## Rationale

The forces are a single production database shared with previews, no CI, no reliable Management API access, and a history already broken by hand applies. Option 1 is the only one that fixes ordering and the record without waiting on anyone else's access. The DB password is the one credential known to work. The probes answer the question history alone can't (is it really there?), and that is what makes the baseline safe on a database whose past is unknown.

The runner exists because the dangerous steps (backup, right target, nothing superseded in the folder, verify after) are the ones people skip under pressure. Typing the project ref back guards against pointing a URL at the wrong project. The `pg` fallback is decided now because the 403 already happened once. If `--db-url` turns out to need the Management API too, the build should not stop to redesign.

Failing closed only on sensitive routes in production is the middle path. Failing closed everywhere would make an Upstash blip take the portal down. Staying open leaves the abuse prone routes (money, email, user lifecycle) unprotected without anyone seeing it, which is the state the scope says must end. The 429 test against `config-status` works because that route applies the limit before auth, so it proves enforcement with no credentials and no side effects.

`LIVE_PLATFORMS` as an env var keeps readiness honest while platforms come live one at a time (feature 3, then feature 6), without a database setting and its write path for something that changes a few times a year. The format plus ping depth was chosen because a well shaped but revoked or test mode key is the realistic failure. Pinging only on demand keeps page loads free of provider calls.

The engineer chose every recommended pick in the conversation. No preference conflicts with this design.
