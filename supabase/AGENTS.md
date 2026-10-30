# supabase (schema and migrations)

## Overview

The database schema, RLS policies and `SECURITY DEFINER` functions. `SETUP.sql` is always the full current schema. Each change is also a migration for databases that already exist, and the live database can lag behind this folder until it's applied.

## Key files

| File | Owns |
|---|---|
| `SETUP.sql` | The whole schema; run once on a fresh project |
| `migrations/<timestamp>_name.sql` | Changes after `SETUP.sql`, applied in filename order |
| `migrations/probes.json` | One probe per migration, so status can tell applied from pending |
| `migrations/__tests__/*.test.cjs` | Schema behaviour against real Postgres in memory (PGlite); `db.cjs` builds `SETUP.sql` plus every migration |

## Commands

```bash
node supabase/migrations/__tests__/<name>.test.cjs   # one suite, offline
npm run db:migrate -- --status                        # what production has applied
```

## Conventions

- Name new files `YYYYMMDDHHMMSS_short_name.sql`, wrap the whole file in `BEGIN; … COMMIT;`, and add its `probes.json` entry.
- Add every migration to `SETUP.sql` in the same PR. `tests/setup-sql.test.cjs` fails when a probe's object is missing from it.
- Write migrations to be safe to run twice (`IF NOT EXISTS`, `CREATE OR REPLACE`, drop policy before create). The PGlite tests apply them twice.
- RLS policies go through `current_user_role()` and helpers like `is_payment_manager()`. A policy for one tenant must test the row, not just the role (finding N-10).
- When a migration adds a column the app reads, also update the migration hint the app shows (`MIGRATION_HINT` in `src/lib/db.js`, `isSchemaMissing` in `api/`).

## Gotchas

- Never put a rollback file in `migrations/`. `.rollback.sql` sorts before `.sql`, so `db push` runs it first.
- PGlite connects as a superuser, which bypasses RLS. Tests must measure as `authenticated` and assert RLS is live first.
- When the app reports a missing column, check whether the migration is applied (`npm run db:migrate -- --status`) before debugging code.

## Agent skills

- [supabase-postgres-best-practices](../.agents/skills/supabase-postgres-best-practices/): `supabase/agent-skills`, Postgres schema, RLS policies and indexes
- [pglite](../.agents/skills/pglite/): `oakoss/agent-skills` (community), the in memory Postgres used by `migrations/__tests__/`

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
