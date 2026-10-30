# tests/

Test harness for the Omnya portal, written after an audit in which **three
separate "failures" turned out to be faults in the test rather than the app**.
Each fix below targets one of those root causes, so the harness cannot repeat
them silently.

A test that is wrong should fail as a broken test, never as a false bug report.

## Setup

```bash
npm i -D playwright-core @electric-sql/pglite
```

`playwright-core` drives a browser you already have. Set `CHROME_PATH` if Chrome
is not at the Windows default. `@electric-sql/pglite` is only needed by the
migration test.

## Running

```bash
# terminal 1 — the app
npm start

# terminal 2 — /api/* in front of it  (see "The API gap" below)
node tests/lib/devServer.cjs

# terminal 3
node tests/regression.test.cjs           # the three former false alarms
node tests/role-boundaries.test.cjs      # the authorization matrix
node tests/payout-acceptance.test.cjs    # the money path, end to end
node supabase/migrations/__tests__/migration.test.cjs
node tests/vercel-rewrites.test.cjs        # does vercel.json route the SPA? (path-to-regexp 6, in devDependencies)
```

`payout-acceptance.test.cjs` needs only the dev server, not CRA.

`regression.test.cjs` talks to the **real Supabase project**. It creates four
accounts named `claude-test-<role>+<timestamp>@example.com`, uses them, and
deletes them in a `finally` block. Teardown discovers dependent rows rather than
trusting a manifest, and throws if anything survives.

## The three fixes

### 1. The API gap — `lib/devServer.cjs`

`react-scripts start` serves the SPA but knows nothing about `/api/*`; those are
Vercel functions. Browser tests against `:3000` therefore saw a 404 on every API
call, and pages that are healthy in production looked broken. That is how the
creator **Social Channels** page got reported as failing.

`devServer.cjs` listens on `:3100`, dispatches `/api/*` to the real handler
files in `api/`, and proxies everything else to CRA. Point tests at `:3100` and
an API error means an actual defect.

It also surfaces defects the 404 was hiding. `/api/send-email` returns **500**
locally because `RESEND_API_KEY` in `.env` is still the literal placeholder
`your-resend-api-key` from `.env.example`. That is an environment gap rather
than an application bug, so `watchForProblems()` reports it separately via
`envGaps()` instead of failing the run. Set a real key to exercise that path.

### 2. Assumed screen state — `lib/ui.cjs`

The harness reported "no revisions action offered" because it read the Review
Queue's default tab — which the previous assertion had just emptied. It also
once reported an empty sidebar that was React still mounting, and a blank page
that simply does not use the `.content` wrapper.

- `selectTab(page, /Finals Waiting/i)` picks the tab explicitly and **throws,
  listing the tabs it did find**, rather than returning nothing.
- `login()` waits for the role label to populate instead of sleeping.
- `contentText()` tries `.content`, then `main`, then the document minus the
  sidebar, polling until content arrives so a lazy chunk has time to load.
- `goto()` throws with the available sidebar entries if the label is missing.

### 3. Unchecked column names — `lib/schema.cjs`

The costliest one, hit three times. A test asserts on `am_feedback`; the column
is `feedback`. PostgREST returns an error instead of rows, the assertion reads
`undefined`, and the test reports *"the app did not save the revision"* — when
it saved perfectly. Same shape for `posted_link` (the value was in
`concept_link`) and for reading `.ok` off a body that was a JSON string.

`schema.cjs` reads the live schema from PostgREST's OpenAPI document and
validates every column **before** querying:

```
TEST BUG: submissions has no column(s) "am_feedback".
  "am_feedback" -> did you mean "feedback" / "final_status"?
This is a fault in the test, not in the application. Fix the test.
```

Use `select(table, columns, filter)` and `selectOne(...)` rather than raw
fetches, and `parseBody(res)` for handler responses, which are JSON strings.

`regression.test.cjs` asserts the guard rejects `am_feedback` before running
anything else — a guard that does not guard is worse than none.


## The payout acceptance test

`payout-acceptance.test.cjs` is the answer to "does the payout system actually
work?" — a question nobody could answer before, because the chain had never
once completed in production.

It walks one creator from earned to paid through the same calls the app makes,
then reconciles the ledger: every earning `paid`, the withdrawal `paid`, and the
sum of payments equal to the sum of earnings.

Crucially it distinguishes **blocked** from **failed**. A known pre-migration
condition is reported with the finding and the migration step that fixes it,
rather than as an anonymous 500:

```
  PASS    4. owner approves the earnings      status=approved
  BLOCKED 5. creator requests a withdrawal    N-03: the live CHECK rejects
                                              withdrawal_requested / batched

  Blocked on migrations that have not been applied:
    · N-03 — the live CHECK rejects withdrawal_requested / batched
           fix: npm run db:migrate (supabase/SETUP.sql on a fresh project)
```

Exit codes: `0` all passed · `1` a real failure · `3` blocked on a pending
migration. So CI can treat "not migrated yet" differently from "broken".

Run it after applying the migrations. Every step reading PASS is the proof the
money path works.


## The role-boundary suite

`role-boundaries.test.cjs` builds **two independent tenants** — each with its
own AM, creator, client, campaign and submission — then asks every role whether
it can reach the other tenant's data.

Two tenants matter. With one client in the system, "the AM sees all clients" and
"the AM sees their own client" produce identical results. That ambiguity is how
N-10 survived until an AM with zero assigned clients was seen reading all ten.

It currently reports **17 boundaries held, 7 open**, and the open ones are the
two known unfixed findings:

- **N-10** — an AM reads the other tenant's client, campaign *and submission*.
  The submission leak was found by this suite; single-tenant checks could not
  see it. Red until the extra live policies are identified and dropped.
- **N-11** — creator, client and anon all reach the body of
  `approve_withdrawal_request`. Red until migration step 2 is applied.

Everything else holds: creators and clients are properly confined, neither can
grant itself payment-manager rights, and every API auth gate refuses correctly.

Once those two are fixed this suite should be all green, and it then guards the
payout authorization permanently — the next edit to a `SECURITY DEFINER` body
cannot quietly reopen the hole.

## Files

| File | Purpose |
|---|---|
| `lib/devServer.cjs` | Serves `/api/*` from the real handlers, proxies the rest to CRA |
| `lib/schema.cjs` | Schema-checked reads; refuses unknown columns |
| `lib/ui.cjs` | Login, navigation, explicit tab selection, problem classification |
| `lib/fixture.cjs` | Disposable accounts and records; teardown that verifies itself |
| `regression.test.cjs` | Re-runs the three checks that previously misreported |
| `role-boundaries.test.cjs` | Two-tenant authorization matrix; guards N-10 and N-11 |
| `payout-acceptance.test.cjs` | Walks money from earned to paid; the acceptance criterion for the payout migrations |
| `../supabase/migrations/__tests__/*.test.cjs` | Schema behaviour (RLS, payouts, audit, guards) against real Postgres (PGlite) |

## Database suites

`supabase/migrations/__tests__/*.test.cjs` run against real Postgres in memory (PGlite). `db.cjs` builds each database the way Supabase would: auth stubs, the `anon` / `authenticated` / `service_role` roles and their default grants, then `supabase/SETUP.sql` and every migration after it.

PGlite connects as a superuser, which bypasses RLS. Measure as `authenticated` with a JWT subject, and assert the instrument is live (a role that should see one row sees one) before trusting any count.
