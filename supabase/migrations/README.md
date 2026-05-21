# Database migrations

This folder is the new home for forward-and-rollback SQL migrations against the
Supabase database. The earlier loose SQL files in the repo root
(`database_setup.sql`, `database_update.sql`, `analytics_setup.sql`,
`meta_setup.sql`, `fix_role_constraint.sql`) are kept for historical reference
but are **not** the source of truth going forward — new schema changes belong
here, with numeric timestamps in the filename.

## Files

| File | Purpose |
|---|---|
| `20260521000000_omnya_hardening.sql` | Phase 2/3 migration: adds missing columns (`payments.batch_id`, `payout_batches.period_type`, `creators.payout_email/payout_preference`), aligns `creator_tokens` on the canonical `user_id` key, adds foreign-key indexes, replaces `USING (true)` RLS with role-scoped policies. |
| `20260521000000_omnya_hardening.rollback.sql` | Restores the original `Allow all` policies + drops the new indexes/helper. Intentionally does NOT drop columns; see notes inside. |

## ⚠️ Before you apply

This migration changes the database security model. Once it lands, anything
that used to silently work because RLS was permissive will need to either:

1. Pass through one of the role-scoped policies (creator viewing their own
   submissions, AM viewing their assigned creators, owner viewing everything),
   OR
2. Run server-side under the service-role key (which bypasses RLS).

Most of the existing client code reads via the anon key and was implicitly
filtered in JavaScript. Once policies are in place, those queries will return
*only the rows the policy allows*. That's the desired outcome — it's actual
security — but it means you should test in staging first.

### Pre-flight checklist

- [ ] **Rotate the leaked Supabase keys** (see SECURITY_NOTES.md). Both anon
      and service-role keys were in `VERCEL_DEPLOY.md` revision history.
- [ ] Have a **staging Supabase project** ready, with a copy of production data.
- [ ] Backup production: Supabase → Settings → Database → Backups. Make sure
      a recent point-in-time recovery point exists.
- [ ] Confirm the app is on the `hardening` branch (or merged version) so the
      analytics sync fix and removed hardcoded keys are deployed.
- [ ] Confirm `REACT_APP_SUPABASE_URL` and `REACT_APP_SUPABASE_ANON_KEY` are
      set in Vercel — the new `supabaseClient.js` throws if they're missing.

## Apply procedure

### Option A — Supabase SQL Editor (simplest)

1. Open Supabase → your project → **SQL Editor**.
2. Open `20260521000000_omnya_hardening.sql` in your editor, copy the full
   contents.
3. Paste into a new SQL Editor query and click **Run**.
4. The script is wrapped in `BEGIN; ... COMMIT;` so it's all-or-nothing.
5. Inspect the output for errors. If any step fails, the whole transaction
   rolls back — nothing is applied.

### Option B — Supabase CLI (recommended for repeatable deploys)

```bash
# One-time: install and login
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>

# Apply this migration (and any others in supabase/migrations/)
supabase db push
```

### Order of staging deploy

1. Apply forward migration on staging.
2. Run the smoke tests below.
3. Test the affected user flows manually (see Manual QA section).
4. If all passes, apply on production.
5. Keep the rollback file at hand for the first 24h.

## Smoke tests after applying

Run these from the SQL Editor or `supabase db query`. Expected results assume
your test users exist and have known roles.

### 1. Helper function exists and resolves your role
```sql
-- Run as authenticated user via Supabase JS, or impersonate in SQL Editor.
SELECT public.current_user_role();
-- Expected: 'owner' | 'am' | 'creator' | 'pending' | 'denied'
```

### 2. Schema additions
```sql
-- All four should return rows.
SELECT column_name FROM information_schema.columns
WHERE table_name = 'payments' AND column_name = 'batch_id';

SELECT column_name FROM information_schema.columns
WHERE table_name = 'payout_batches' AND column_name = 'period_type';

SELECT column_name FROM information_schema.columns
WHERE table_name = 'creators'
  AND column_name IN ('payout_email','payout_preference');

SELECT column_name FROM information_schema.columns
WHERE table_name = 'creator_tokens'
  AND column_name IN ('user_id','account_id','account_name','scopes');
```

### 3. Indexes present
```sql
SELECT indexname FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'idx\_%'
ORDER BY indexname;
-- Expected: 16 idx_ entries (see migration file for full list).
```

### 4. RLS policies are role-scoped (not `Allow all`)
```sql
SELECT tablename, policyname
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
-- Expected: no policy named "Allow all". Each table should have one or more
-- policies prefixed with <table>_select_..., <table>_modify_..., etc.
```

### 5. Cross-tenant smoke (the actual security test)

Sign in as **Creator A** in a browser, open DevTools, and run:

```js
// Should return only Creator A's payments.
const { data, error } = await supabase.from('payments').select('*');
console.log('rows:', data?.length, 'error:', error);
```

Then sign in as **Creator B** and run the same query — you should see B's
rows, not A's. Repeat for `submissions`, `creator_tokens`, `video_analytics`.
Repeat for an **AM** account — should see only their assigned creators'
data.

If any creator sees another creator's rows, **roll back immediately** and
investigate the offending policy.

## Manual QA after applying (production)

| Role | Flow | Expected |
|---|---|---|
| Owner | Sign in, open Owner Dashboard | All clients/campaigns/creators visible. |
| Owner | Generate a payout batch | Succeeds. `payments.batch_id` populated. |
| Owner | Export CSV | CSV downloads with creator names and `payout_email`/`payout_preference` columns (which will be NULL/default for existing creators — fill in via Creator profile). |
| Owner | Mark batch paid | Status flips; `payment_sent` emails dispatched. |
| AM | Sign in | Only their assigned creators/clients visible. Cannot see other AMs' clients. |
| AM | Try to load another AM's client URL | RLS returns empty; UI shows "not found" or similar. |
| Creator | Sign in | Sees own profile, own submissions, own payments. |
| Creator | Try `supabase.from('payments').select('*')` in DevTools | Returns only their own rows, NOT another creator's. |
| Creator | Connect TikTok | OAuth flow completes; token written to `creator_tokens` keyed by user_id. |
| Pending user | Sign up, click verification link | Lands on "waiting for approval" page; cannot read other tables. |

## What this migration does NOT do (deferred)

- **Status case normalization.** The schema default is lowercase
  (`'draft'`, `'pending'`, `'paid'`) but the API writes Capitalized values
  (`'Pending'`, `'Paid'`). Adding `CHECK` constraints now would break the
  running app. Phase 5 (API hardening) normalizes the API to write lowercase;
  a follow-up migration then adds the CHECKs.
- **Dropping dead columns/tables** like `payout_line_items` or the legacy
  `creator_tokens.platform_account_id`. Kept for now; a separate cleanup
  migration follows once Phase 10 confirms no callers.
- **Renaming columns** to the names the user spec recommends
  (`platform_user_id`, `platform_username`). The existing names
  (`account_id`, `account_name`) match what `src/CreatorConnections.js` reads.
  Rename can happen after Phase 4 cleans up the API surface.
- **Encrypting OAuth tokens at rest.** AUDIT.md §3.8 recommends pgcrypto for
  `creator_tokens.access_token`/`refresh_token`. Not in this migration —
  needs a code change so the API can encrypt-on-write and decrypt-on-read.

## If something goes wrong

1. Apply `20260521000000_omnya_hardening.rollback.sql` (same procedure as
   forward — paste into SQL Editor and run).
2. After rollback, the database is back to permissive `Allow all` policies.
   That restores app behavior but undoes the security improvements.
3. Filing what failed is more useful than guessing. Capture:
   - The exact error message (from `SELECT ... ` failures or from the app's
     Supabase error responses).
   - Which role was running.
   - Which table.
4. Open an issue with the above. Most failures will be policy logic that
   needs adjustment (e.g. an AM workflow we didn't anticipate). Adjust the
   policy in a follow-up migration rather than reverting wholesale.
