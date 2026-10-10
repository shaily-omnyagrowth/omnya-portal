# Superseded migrations

Files here were written as migrations and must never be applied. They live outside `supabase/migrations/` because `supabase db push` (and `npm run db:migrate`) applies every `.sql` file in that folder.

| File | Superseded by | Why it must not run |
|---|---|---|
| `20260821000001_client_creator_visibility.sql` | `20260822000005_tenant_policy_reset.sql` | Its `creators` policy reads `campaigns` while `campaigns_select_scoped` reads `creators`. PostgreSQL refuses the cycle (`42P17`) and every campaign read fails for every role. `20260822000005` gives clients the same narrow read through a `SECURITY DEFINER` helper, with no cycle. |

The PGlite suites still load these files from here to prove the reason holds (`supabase/migrations/__tests__/full-chain.test.cjs`, `migration.test.cjs`).
