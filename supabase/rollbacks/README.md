# Rollback scripts

**These files must never live in `supabase/migrations/`.**

The Supabase CLI treats *every* file matching `<timestamp>_name.sql` in the
migrations directory as a forward migration to apply, in filename order. A
rollback file sitting next to its forward migration therefore gets applied as
if it were a migration — and because `.rollback.sql` sorts *before* `.sql`
(`r` < `s`), it runs **first**.

On 2026-09-04 a `npx supabase db push` did exactly that: the first thing it
tried to apply was `20260521000000_omnya_hardening.rollback.sql`, which drops
every role-scoped RLS policy and restores the legacy `"Allow all" USING (true)`
policies. It failed part-way through, at `DROP FUNCTION current_user_role()`,
because other policies still depended on that function.

The only reason production survived is that the file is wrapped in
`BEGIN; … COMMIT;`, so the failure rolled the whole thing back and the
permissive policies were never committed.

Two rules follow from that:

1. **Rollback scripts live here, not in `migrations/`.**
2. **Every migration and every rollback is wrapped in `BEGIN; … COMMIT;`.**
   That wrapper is what turned a production security incident into a no-op.
   A migration that is not transactional can leave the database half-rolled-back
   with no way to tell what landed.

## Applying one

Deliberately manual — a rollback should never be something a routine command
can trigger. Paste the file into the Supabase SQL Editor, or:

```bash
psql "$DATABASE_URL" -f supabase/rollbacks/<file>.rollback.sql
```

Then tell the CLI the migration is no longer applied, so its bookkeeping
matches reality:

```bash
npx supabase migration repair --status reverted <version>
```
