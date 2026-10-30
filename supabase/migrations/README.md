# Database migrations

`supabase/SETUP.sql` is the production schema as of 2026-10-30. Every change after it is a new `YYYYMMDDHHMMSS_short_name.sql` file here, applied in filename order.

A fresh project runs `SETUP.sql` once in the SQL editor, then `npm run db:migrate`.

## The only way to apply to production: `npm run db:migrate`

Do not run a bare `supabase db push`. If you do paste a file into the SQL editor, run `--baseline` afterwards so the history records it.

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
- For a risky change, keep a rollback in `supabase/rollbacks/<version>.rollback.sql`. The runner prints its path on failure and never runs it.
- **Migrate first, then merge.** The PR whose code reads the new schema merges only after `npm run db:migrate` reports the file applied. The app's `42703` / `PGRST204` hints stay as the safety net.

## Only forward migrations belong in this directory

`db push` applies every `<timestamp>_name.sql` file here, in filename order. Keep rollbacks and scratch SQL out of this folder: a `<version>.rollback.sql` sorts before `<version>.sql` and would run first.

## Where to see the state

`npm run db:migrate -- --status` shows one row per file as applied, broken, pending, drift or manual.
