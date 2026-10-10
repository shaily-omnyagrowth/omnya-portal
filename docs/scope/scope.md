# Scope: Omnya Portal

A portal for a UGC agency. Owners and account managers run campaigns and review content, creators connect their social accounts, submit videos and get paid, and clients see how their campaigns perform. Most of it is built. This pass makes it actually work in production and proves it.

**Build approach:** Tracer Bullet (prove one real thread works end to end in production first, then thicken one segment at a time).
**Workflow:** GA (after `/develop`: `/check verify`, `/test`, a fresh model `/check review`, then `/document`). The project default level of rigor. `/architect` is the recommended first stop for a feature with a real decision, but skippable when you already know the build. Any feature can carry its own tag (e.g. `· Alpha`) to do more or less.

_These are recommendations to keep your build orderly, not requirements. Skip anything that does not fit: if you already know how to build a feature, use `/develop` and skip `/architect`. You decide when a feature is `done`._

## At a glance

| # | Feature | Phase | Status |
|---|---------|-------|--------|
| A | Sign up, approval and roles | Existing | existing |
| B | Owner administration | Existing | existing |
| C | Client, creator and manager management | Existing | existing |
| D | Campaigns, applications and assignment | Existing | existing |
| E | Content submission and review | Existing | existing |
| F | Client portal | Existing | existing |
| 1 | Production config and migrations | Foundation | in-progress |
| 2 | Backup restore drill | Foundation | planned |
| 3 | First live platform connection | Slice 1 | in-progress |
| 4 | Live analytics sync | Slice 1 | in-progress |
| 5 | Live payout run | Slice 1 | in-progress |
| 6 | Remaining platforms live | Slice 2 | in-progress |
| 7 | Campaign share links live | Slice 2 | in-progress |
| 8 | Observability and alerts | Slice 2 | planned |
| 9 | Email delivery reliability | Slice 2 | planned |
| 10 | AI Video Insights, server side | Slice 2 | in-progress |
| 11 | Data retention and deletion | Slice 2 | planned |
| 12 | Responsive and accessibility QA | Slice 2 | planned |
| 13 | Go live evidence and sign off | Slice 2 | planned |
| G | UGC dashboards | Deferred | in-progress |
| H | Shared migration credentials | Deferred | planned |

## Already built

Enrolled for context. These predate the workflow, so `/develop` and `/sync` leave them alone.

### A. Sign up, approval and roles · existing
Email sign up lands in `pending` until an owner approves. Clients self serve. Roles come from `user_profiles.role`, and an owner can preview other roles. code in `src/App.js`, `api/_utils/auth.js`

### B. Owner administration · existing
User management with create, deactivate, restore and role change, plus audit history and system config (including the env status check). code in `src/pages/`, `api/admin/`

### C. Client, creator and manager management · existing
Owner lifecycle for clients and creators. Managers claim and release creators, with the owner as a scoped manager. Commissions are editable by the owner only. code in `src/App.js`, `supabase/migrations/20260918000000_creator_portal_fixes.sql`

### D. Campaigns, applications and assignment · existing
Campaign lifecycle, vetted creator applications (Applied, Approved, Declined), and the `campaign_creators` assignment, plus client CPM. code in `src/App.js`

### E. Content submission and review · existing
Creators submit content, managers review it in the queue (revisions, finals), and the content library shows the result. Uses the unified submission status. code in `src/App.js`

### F. Client portal · existing
Brand insights, campaign overview and delivered content for clients, isolated per tenant by RLS. code in `src/pages/ClientDashboard.js`

## Foundations

### 1. Production config and migrations · in-progress
Every required secret set in production, and every migration applied and confirmed live. Right now `db push` can't be used (the history table is empty and access is refused), so migrations land out of order and by hand.
**Done when:** the System Config check shows every required value set and well formed (encryption key, cron secret, rate limit store, email, payments), every file in `supabase/migrations/` is probed present on the live database, and rate limits actually reject over limit calls.
spec [0001](../specs/0001-production-config-migrations/index.md) · code in `scripts/db-migrate.cjs`, `api/_lib/migrationProbes.js`, `api/_lib/configRules.js`, `api/admin/config-status.js`, `api/admin/config-test.js`, `api/_utils/rateLimit.js`, `src/pages/SystemConfig.js`
- [x] Design it (spec): `/architect production config and migrations`
- [ ] Build it: `/develop production config and migrations`
  - [ ] Clean folder, probe manifest and status RPC (AC-1, AC-2, AC-7)
  - [ ] Migration runner live on production: status, baseline, first push of 20260908 and 20261001 (AC-3, AC-4, AC-5, AC-6)
  - [ ] System Config shows migrations, config rules, readiness and Test connections (AC-7, AC-8, AC-9, AC-10)
  - [ ] Rate limits that really reject: fail closed, window fix, live 429 test (AC-11, AC-12, AC-13)
  - [x] Expand only guard and runbook docs (AC-14, AC-15)
- [ ] Verify it: `/check verify production config and migrations`
- [ ] Test it: `/test production config and migrations`
- [x] Review it (fresh model): `/check review production config and migrations`
- [ ] Document it: `/document production config and migrations`

### 2. Backup restore drill · needs a decision · Alpha
Prove the database can be brought back, before anything risky touches live data.
**Done when:** a recent backup is restored into a scratch project and checked, and the rollback and forward fix steps are written down where the team will find them.
- [ ] Design it (spec): `/architect backup restore drill`

## Slice 1: One creator, live, end to end

The thinnest real thread through production: one creator connects one platform, their views sync, they earn, and they get paid.

### 3. First live platform connection · in-progress · needs a decision
The OAuth code is built for all four platforms, but none is live yet, because every provider limits an unreviewed app to named test accounts. Pick one platform and get it working for real.
**Done when:** a real creator connects that platform in production, the token is stored encrypted, the nightly refresh keeps it alive, and disconnecting works.
- [ ] Design it (spec): `/architect first live platform connection`

### 4. Live analytics sync · in-progress · needs a decision
The sync and token path exist but have never run on a real token. Make the scheduled sync pull real numbers for that connected account.
**Done when:** the cron pulls real view counts for the connected account, and the creator, manager and client screens all show them. A failed pull marks the account for reconnect instead of failing silently.
- [ ] Design it (spec): `/architect live analytics sync`

### 5. Live payout run · in-progress · needs a decision
Earnings, bonuses, withdrawals, batches, export and mark paid are built, but the chain has never completed in production. The bonus rule (cumulative or highest tier only) is still an open question in the original scope.
**Done when:** one creator goes from earned to paid in production by a manual method, the ledger reconciles (payments equal earnings, batch totals match), and the payout acceptance test passes against the live database.
- [ ] Design it (spec): `/architect live payout run`

## Slice 2: Thicken the thread

### 6. Remaining platforms live · in-progress · needs a decision
Bring the other three platforms live, including what each provider needs to approve the app: privacy policy, data use statement, and a demo.
**Done when:** each remaining platform connects in production for real creators, and each provider's review pack is submitted (or the test account limit is documented as a known limit).
- [ ] Design it (spec): `/architect remaining platforms live`

### 7. Campaign share links live · in-progress
Share links and the public campaign report are built, but their migration isn't applied, so "Share" fails in production.
**Done when:** a manager enables a share link with one click, the public report loads without sign in, and turning the link off makes it stop working.
- [ ] Build it: `/develop campaign share links live`

### 8. Observability and alerts · needs a decision
Know when something breaks before a creator tells you: health checks, error monitoring, and alerts on cron and token refresh failures.
**Done when:** a failed sync, refresh or payout call raises an alert someone sees, a health check reports each dependency, and server errors are captured with enough context to act on.
- [ ] Design it (spec): `/architect observability and alerts`

### 9. Email delivery reliability · needs a decision
Notifications are fire and forget today. Creators must hear about withdrawal receipt, approval, rejection and payment.
**Done when:** transient send failures retry with a limit, each notification's delivery state is stored and visible to staff, and rejection emails carry the reason without leaking internal notes.
- [ ] Design it (spec): `/architect email delivery reliability`

### 10. AI Video Insights, server side · in-progress · needs a decision
The insights screen calls the AI provider straight from the browser with no key, and the CSP blocks it, so it can't work. Move the call behind the API.
**Done when:** a creator or client gets insights for a video through an authenticated, rate limited server route, the key never reaches the browser, and the CSP stays as strict as it is now.
- [ ] Design it (spec): `/architect ai video insights`

### 11. Data retention and deletion · needs a decision
Decide how long data is kept and how a person leaves, without ever hard deleting financial records.
**Done when:** a written retention policy exists, a creator or client deletion request removes or anonymizes personal data and revokes social tokens, and ledger history survives intact.
- [ ] Design it (spec): `/architect data retention and deletion`

### 12. Responsive and accessibility QA · Alpha
Check every role's screens on phone and tablet, and fix contrast, keyboard use and missing labels along the way.
**Done when:** each role's main screens work at phone and tablet widths with no horizontal scroll, every control is reachable by keyboard, and text meets contrast.
- [ ] Build it: `/develop responsive and accessibility QA`

### 13. Go live evidence and sign off · needs a decision
The readiness gate from the original scope: proof for each area, then the owner accepts it along with the known limits.
**Done when:** every gate (scope, data integrity, RBAC, payout safety, integrations, observability, recovery, quality, security) links to its proof, third party blockers are listed, and the owner signs off.
- [ ] Design it (spec): `/architect go live evidence and sign off`

## Deferred

Out of scope for this pass, kept so the plan stays honest. The original scope says to sign off on go live before starting new expansion.

### G. UGC dashboards · in-progress
Calendar, creator leaderboard, top posts and posts gallery are built on `feat/ugc`, running on demo data behind `REACT_APP_ENABLE_DEMO_MODE`. Finish them on live data after sign off. code in `src/components/UGCDashboardView.js`

### H. Shared migration credentials · planned · from spec 0001
Put the DB password and `.env.migrate` values in a team password vault so a second person can run `npm run db:migrate`. Today only one laptop can.

## Legend

**The decision box.** Every feature carries exactly one, the sub task whose label ends with `(spec)`. Its wording varies, so skills locate it by that `(spec)` suffix, never by an exact label. Every other box is an execution box and `/architect` never ticks one.

**Feature lifecycle**: the scope updates as a feature moves; each row is what it shows and who sets it:

| State | Set by | The feature shows |
|---|---|---|
| `planned` · needs a decision | `/scope` | one box: `Design it (spec): /architect <feature>` |
| `in-progress` (designed) | **`/architect` at spec capture** | `Design it` ticked; spec linked; `Build it: /develop <feature>` + **2 to 5 milestones**; the tier's closing boxes (`Verify it` Alpha+, `Test it` Beta+, `Review it` + `Document it` GA); any surfaced follow up enrolled |
| `in-progress` (building) | `/develop` | milestone sub boxes tick one by one; code pointer filled |
| `in-progress` (verified) | `/check verify` | `Build it` + milestones ticked; `Verify it` ticked |
| `done` | **you, when you decide it is** (any skill sets it when you say so); `/sync` reconciles | boxes you ran ticked, skipped ones marked skipped; the tier's last stage is the suggested point to call it done |

- **Next step** = the first unticked box (always a command or a tracked milestone).
- **needs a decision** = run `/architect` first; otherwise straight to `/develop`. The tag drops once the spec is captured.
- **Atomic build tasks live in the spec's `## Build plan`, not here**: the scope carries only the milestone rollup.
- **Status** `planned` → `in-progress` → `done`, plus `existing` (built before this workflow) and `dropped` (de-scoped, kept for history). Here, `in-progress` on an undesigned feature means code exists but doesn't work in production yet.
- **Workflow tier tag** beside a heading (e.g. `· Alpha`) sets that one feature's rigor; no tag inherits the GA default.
- **Workflow**: **Prototype** = nothing after develop; **Alpha** = `/check verify`; **Beta** = `/check verify` then `/test`; **GA** = adds a fresh model `/check review` then `/document`. A feature built on an unratified decision (an `Assumed` spec) stays flagged, but that never blocks `done`.
- **Pointer line** (`spec <n> · code in <path>`): the spec link added by `/architect`, the code path by `/develop`.
