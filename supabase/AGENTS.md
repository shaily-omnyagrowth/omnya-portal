# supabase (schema and migrations)

## Overview

The source of truth for the database schema, RLS policies and `SECURITY DEFINER` functions. Migrations are applied to production by hand or with the Supabase CLI, so the live database can lag behind this folder.

## Key files

| File | Owns |
|---|---|
| `migrations/<timestamp>_name.sql` | Forward migrations, applied in filename order |
| `migrations/APPLY_<date>.md` | Step by step apply notes for a migration batch |
| `migrations/__tests__/*.test.cjs` | Run migrations against real Postgres in memory (PGlite) on `fixture_schema.sql` |
| `rollbacks/*.rollback.sql` | Manual rollbacks, never applied by a routine command |
| `SETUP_FROM_SCRATCH.sql` | Bootstrap for a fresh project |

## Commands

```bash
node supabase/migrations/__tests__/<name>.test.cjs   # one migration suite, offline
npx supabase db push                                  # applies EVERY file in migrations/
```

## Conventions

- Name new files `YYYYMMDDHHMMSS_short_name.sql` and wrap the whole file in `BEGIN; … COMMIT;`. Write a matching rollback in `rollbacks/` for anything that changes security or data.
- Write migrations to be safe to run twice (`IF NOT EXISTS`, `CREATE OR REPLACE`, drop policy before create). The PGlite tests apply them twice.
- RLS policies go through `current_user_role()` and helpers like `is_payment_manager()`. A policy for one tenant must test the row, not just the role (finding N-10).
- When a migration adds a column the app reads, also update the migration hint the app shows (`MIGRATION_HINT` in `src/App.js`, `isSchemaMissing` in `api/`).

## Gotchas

- Never put a rollback file in `migrations/`. `.rollback.sql` sorts before `.sql`, so `db push` runs it first. That nearly reverted production security on 2026-09-04.
- PGlite connects as a superuser, which bypasses RLS. Tests must measure as `authenticated` and assert RLS is live first.
- When the app reports a missing column, check whether the migration is applied (e.g. `node scripts/check-migration-20260918.cjs`) before debugging code.

## Agent skills

- [supabase-postgres-best-practices](../.agents/skills/supabase-postgres-best-practices/): `supabase/agent-skills`, Postgres schema, RLS policies and indexes
- [pglite](../.agents/skills/pglite/): `oakoss/agent-skills` (community), the in memory Postgres used by `migrations/__tests__/`

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
