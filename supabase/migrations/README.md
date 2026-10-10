# Database migrations

This folder is the source of truth for the production schema. Every schema change is a new `YYYYMMDDHHMMSS_short_name.sql` file here. The root `*.sql` files and `SETUP_FROM_SCRATCH.sql` are historical.

## The only way to apply to production: `npm run db:migrate`

Spec: [`docs/specs/0001-production-config-migrations`](../../docs/specs/0001-production-config-migrations/index.md). Do not paste files into the SQL editor and do not run a bare `supabase db push`. Production's migration history was empty for months while files were pasted by hand, so a bare push would run everything again, and some files are not safe to repeat (`20260530000001` would bring back the unguarded payout functions).

```bash
npm run db:migrate -- --status     # read only: what is recorded, what is present
npm run db:migrate -- --baseline   # record files that are present but unrecorded (history only)
npm run db:migrate                 # apply pending files
```

What a write run (`--baseline` or push) does, in order:

1. **Prerequisites.** Supabase CLI 2.20 or newer (a devDependency, so `npm install` is enough), `.env.migrate`, a session pooler or direct URL (never port 6543), the URL's project ref equal to `SUPABASE_PROJECT_REF`, and a dump tool: `pg_dump` whose major version is at least the server's (install the PostgreSQL 17 client tools), or Docker running for `supabase db dump`.
2. **Probe.** For every file, two witnesses: is it recorded in `supabase_migrations.schema_migrations`, and is the object it creates present (from `probes.json`)? The table it prints:

   | recorded | probe | state |
   |---|---|---|
   | yes | present | applied |
   | yes | missing | broken (a person resolves it) |
   | no | missing | pending (push applies it) |
   | no | present | drift (baseline records it) |

3. **Plan.** Lists what it will record or apply (push also prints the CLI's dry run). Push refuses while any row is `drift`: run `--baseline` first. Both refuse on a `broken` row, or when `probes.json` and this folder disagree.
4. **Confirm.** You type the project ref.
5. **Backup.** A schema dump and a data dump (schemas `public`, `auth`, `storage`, `supabase_migrations`) into `MIGRATE_BACKUP_DIR/<UTC timestamp>/`. The folder must be outside the repo and outside OneDrive, because the dump holds creator emails and the payout ledger.
6. **Apply.** `supabase migration repair --status applied` (baseline) or `supabase db push --include-all` (push), over `--db-url`. If the CLI still hits the Management API 403, the runner applies each file itself through `pg`, one transaction per file, recording each only after it commits.
7. **Probe again.** Exit 0 only when every row is applied. If a file fails, it stops and prints what landed, the failed file, the Postgres error, and the matching file in `supabase/rollbacks/`. It never runs a rollback.

Exit codes: `0` every row applied, `1` gaps remain or an apply failed, `2` refused. Every run appends a line to `MIGRATE_BACKUP_DIR/migrate.log`.

### One time setup

```bash
cp .env.migrate.example .env.migrate   # then fill it in; it is gitignored
```

`SUPABASE_DB_URL` is the session pooler string from Supabase → Project Settings → Database (port 5432), with the database password. That password stays in `.env.migrate` on your machine. It never goes into Vercel, GitHub, or this repo.

## Writing a migration

- Name it `YYYYMMDDHHMMSS_short_name.sql` and wrap the whole file in `BEGIN; … COMMIT;`.
- Make it safe to run twice (`IF NOT EXISTS`, `CREATE OR REPLACE`, drop policy before create). The PGlite tests apply files twice.
- **Add its entry to `probes.json` in the same commit.** Name the most specific object the file leaves behind that no earlier file created. Kinds: `table`, `columns`, `function`, `function_body` (with a `marker` only the new body contains), `policy`, `trigger`, `index`, `constraint`. `manual` (with a `why`) is a last resort and blocks readiness. When a later file replaces or drops an earlier file's object, give the earlier entry `"retiredBy": "<later file>"`. `tests/migration-guards.test.cjs` fails if a file has no entry.
- **Expand only.** Previews and production share one database, so a migration may add but must not drop or rename anything the deployed code reads. `DROP TABLE`, `DROP COLUMN`, `RENAME TO` and `RENAME COLUMN` fail `tests/migration-guards.test.cjs` unless the file carries a `-- contract: <release that stopped reading it>` line. Contracting happens a release later.
- Write a rollback in [`supabase/rollbacks/`](../rollbacks/README.md) for anything that changes security or data.
- **Migrate first, then merge.** The PR whose code reads the new schema merges only after `npm run db:migrate` reports the file applied. The app's `42703` / `PGRST204` hints stay as the safety net.

## Only forward migrations belong in this directory

`db push` applies every `<timestamp>_name.sql` file here, in filename order. So:

- Rollbacks live in [`supabase/rollbacks/`](../rollbacks/README.md). Left here, `<version>.rollback.sql` sorts before `<version>.sql` and runs first, which on 2026-09-04 meant a push began by undoing the security hardening on production.
- Superseded files live in [`supabase/superseded/`](../superseded/README.md).
- Read only verify scripts live in `supabase/verify/`.

## Where to see the state

System Config (owner only) shows one row per file as applied, broken, pending, drift or manual, from the same probes the runner uses, and a single ready banner for configuration plus migrations.

## Historical runbooks

`APPLY_*.md` in this folder describe how batches were pasted by hand before the runner existed. They are kept for their reasoning, not as instructions.
