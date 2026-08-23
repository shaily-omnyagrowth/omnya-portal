**TECHNICAL SCOPE BASELINE**

Omnya Portal\
Original Work Scope

Comprehensive functional and technical specification

**Purpose\
**Define, restore, verify, test and accept the original Omnya Portal
capabilities without absorbing the later UGCTrackr-inspired expansion.

  -----------------------------------------------------------------------
  **Document field**   **Value**
  -------------------- --------------------------------------------------
  Prepared for         Omnya project stakeholders

  Version              1.0

  Date                 20 August 2026

  Classification       Project scope and technical baseline

  Source basis         Historical conversation context; repository and
                       live-environment audit still required
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------
  **SCOPE CONTROL** This document is a reconstruction of the original
  scope from historical discussions. It is not proof that every item is
  currently deployed or defect-free. Status must be confirmed against the
  source repository, database, integrations and production environment.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------

# 1. Executive Summary

The original Omnya Portal is a responsive, role-based web application
for operating creator marketing campaigns. Its foundational purpose is
to let Omnya administrators, Account Managers, creators and clients
coordinate campaigns, content submissions, performance tracking and
creator payouts through controlled, auditable workflows.

The immediate objective is restoration and verification: identify what
was originally implemented, restore missing or regressed controls,
reconcile frontend behavior with persisted data, and validate the
complete portal before any later enhancement phase begins.

  -----------------------------------------------------------------------
  **BASELINE DECISION** The original layer includes core administration,
  role-scoped operations, campaigns, content tracking, social-data
  connections, creator earnings and payouts. The newer UGCTrackr-inspired
  aggregate dashboards, campaign calendar/Gantt views, Top Posts,
  breakout analytics, enhanced leaderboards and gallery/table explorers
  are out of scope here.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------

# 2. Document Purpose, Audience and Interpretation

-   Purpose: establish a single technical and acceptance baseline for
    the original portal.

-   Audience: product owner, developer, QA, operations, payment
    administrators and integration reviewers.

-   Use: guide audit, restoration, defect triage, verification,
    production hardening and sign-off.

-   Interpretation: "completed" means historically described as built or
    substantially delivered; it does not replace present-day
    verification.

-   Precedence: confirmed contracts, repository evidence, database
    migrations and production behavior override assumptions in this
    reconstructed document.

# 3. Scope Classification and Current-State Labels

  ------------------------------------------------------------------------
  **Label**      **Meaning**                   **Required treatment**
  -------------- ----------------------------- ---------------------------
  Original scope Capability belonged to the    Restore or complete; test
                 foundational portal           against acceptance criteria

  Historically   Conversation indicates it was Verify code, data,
  implemented    built in whole or part        permissions and production
                                               behavior

  Pending        Current state cannot be       Audit before claiming
  verification   proven from conversation      completion
                 alone                         

  External       Delivery depends on           Implement graceful
  dependency     third-party approval/API      fallback; track separately
                 behavior                      

  Out of scope   Later enhancement or          Do not implement under
                 materially new capability     original restoration work
  ------------------------------------------------------------------------

  -----------------------------------------------------------------------
  **Capability       **Historical evidence**      **Baseline
  area**                                          disposition**
  ------------------ ---------------------------- -----------------------
  Owner/Admin        Original scope; previously   Restore and verify
  operations         implemented in whole or part 

  Creator, Account   Original expected behavior;  Restore and
  Manager and Client regressions reported         regression-test
  CRUD                                            

  Role assignments   Original expected behavior   Verify end to end
  and scoped access                               

  Campaign/content   Original foundational scope  Verify data and UI
  workflows                                       consistency

  Payout ledger,     Described as a major         Reconcile and
  withdrawals,       completed area               regression-test
  batches and audit                               

  TikTok integration Built/tested in development; Pending external
                     production approval          approval and production
                     constrained                  verification

  Instagram          Earlier V1 scope             Confirm permissions,
  analytics                                       implementation and sync

  Responsive web     Original commitment          Cross-device validation
  portal                                          required

  UGCTrackr-style    Newer \$1,200 expansion      Explicitly out of this
  dashboards and                                  specification
  views                                           
  -----------------------------------------------------------------------

# 4. Product Architecture

The target architecture is a layered web application. Exact technologies
must be confirmed from the repository; the logical responsibilities
below are requirements, not an unsupported claim about the current
stack.

  ----------------------------------------------------------------------------
  **Layer**         **Responsibilities**                **Key controls**
  ----------------- ----------------------------------- ----------------------
  Responsive web    Role-specific dashboards, forms,    Route guards,
  client            tables, campaign/content views,     client-side
                    payout screens                      validation, accessible
                                                        responsive layouts

  Application/API   Authentication, authorization,      Server-side RBAC,
  layer             CRUD, workflow transitions,         schema validation,
                    validation, reporting queries       idempotency, error
                                                        normalization

  Domain services   Assignments, campaign lifecycle,    Transactional
                    content review, earnings, bonuses,  invariants and
                    withdrawals, payout batches         explicit state
                                                        machines

  Integration       TikTok, Instagram/Meta, Stripe      OAuth token handling,
  services          Connect, email/notifications, CSV   retries, rate limits,
                    export                              webhooks and audit
                                                        logs

  Persistence       Users, roles, assignments,          Constraints, indexes,
                    campaigns, content, metrics,        migrations, backups
                    ledgers, payouts and audit events   and tenant/record
                                                        scoping

  Operations        Hosting, secrets, scheduled         Environment
                    synchronization, monitoring and     separation, least
                    deployment                          privilege,
                                                        observability and
                                                        rollback
  ----------------------------------------------------------------------------

## 4.1 Logical Request Flow

1.  User authenticates and receives a server-validated identity and role
    context.

2.  The client requests a permitted resource; the API independently
    evaluates role, ownership and assignment scope.

3.  Domain validation checks the requested state transition and
    financial/data invariants.

4.  A transaction persists the change and any ledger or audit entries
    atomically.

5.  Notifications or third-party actions are queued or executed with
    idempotency and retry controls.

6.  The API returns a sanitized response containing only fields
    permitted for that role.

# 5. Roles and RBAC Model

  -------------------------------------------------------------------------
  **Role**       **Primary responsibility**      **Permitted data
                                                 boundary**
  -------------- ------------------------------- --------------------------
  Owner/Admin    System-wide operations, users,  All authorized
                 assignments, campaigns,         organization records
                 approvals, configuration and    
                 audit                           

  Payment        Withdrawal review, payout       Financial records
  Manager        batches, external payment       explicitly assigned by
                 reconciliation and status       policy
                 changes                         

  Account        Operate assigned creators,      Only assigned or delegated
  Manager        clients and campaigns; monitor  records
                 content and performance         

  Creator        Manage own profile/connections, Own records only
                 view assignments, submit        
                 content, see own earnings and   
                 request withdrawal              

  Client/Brand   View assigned campaigns,        Assigned client/campaign
  Partner        deliverables, approved content  records; no creator payout
                 and agreed reporting            data
  -------------------------------------------------------------------------

## 5.1 Permission Principles

-   Deny by default; every API operation requires an explicit
    permission.

-   Record-level scope is enforced server-side, not merely by hidden
    navigation or disabled buttons.

-   Financial permissions are separate from general administration.

-   Clients cannot access creator payout amounts, withdrawal records,
    payment methods or internal notes.

-   Creators cannot view another creator's campaigns, content, metrics,
    earnings or payout history.

-   Account Manager access follows active assignments and must be
    revoked when an assignment ends.

-   Sensitive actions---role changes, deletions, approvals, rejections,
    batch creation and payment marking---generate audit events.

## 5.2 Representative Authorization Matrix

  ----------------------------------------------------------------------------------------------
  **Action**                   **Owner/Admin**    **Account     **Creator**        **Client**
                                                  Manager**                        
  ---------------------------- ------------------ ------------- ------------------ -------------
  Create/edit users and roles  Yes                No            Own profile only   Own profile
                                                                                   only

  Assign                       Yes                Within        No                 No
  creators/clients/campaigns                      delegated                        
                                                  policy                           

  Manage campaign              Yes                Assigned only View/participate   View assigned

  Submit content               Override/support   Review        Own submission     No
                                                  assigned                         

  Approve content              Yes                If delegated  No                 If
                                                                                   contractual
                                                                                   workflow
                                                                                   allows

  View creator earnings        Yes/payment role   Only if       Own only           Never
                                                  explicitly                       
                                                  permitted                        

  Approve/reject withdrawal    Payment role       No unless     No                 Never
                                                  explicitly                       
                                                  delegated                        

  View audit history           Yes                Scoped        Own material       No
                                                  operational   events             
                                                  events                           
  ----------------------------------------------------------------------------------------------

# 6. Core Functional Scope by Role

## 6.1 Owner/Admin

-   Dashboard and operational summaries available in the original
    portal.

-   Create, view, edit, deactivate/delete and restore users according to
    data-retention policy.

-   Manage creators, Account Managers and clients/brand partners.

-   Assign creators and clients/campaigns to Account Managers.

-   Create and manage campaigns, campaign relationships and access.

-   Monitor content submissions, creator activity and campaign activity.

-   Control role and permission assignments.

-   Operate payout approvals, batches, exports and reconciliation where
    authorized.

-   Review system analytics, history and administrative configuration.

## 6.2 Account Manager

-   Authenticate into a dedicated role experience.

-   See only assigned creators, clients and campaigns.

-   Monitor campaign status, content submissions and creator
    performance.

-   Review or progress submissions where delegated.

-   Access only payment-related information expressly permitted by
    policy.

-   Perform operational work without receiving owner-level
    administration rights.

## 6.3 Creator

-   Maintain own profile and payout method details.

-   Connect supported social accounts through approved OAuth flows.

-   View assigned campaigns, briefs, dates and required deliverables.

-   Submit video/post URLs and required evidence.

-   Track content approval state and performance status.

-   View own earnings ledger, available balance, pending bonus and
    payout history.

-   Request an eligible withdrawal subject to balance and cooldown
    rules.

## 6.4 Client / Brand Partner

-   Access only assigned brand/campaign records.

-   Review campaign progress, creator deliverables and approved content
    where permitted.

-   Access agreed performance reporting without internal financial data.

-   Participate in approval/comment workflows only if configured in the
    original portal.

# 7. Campaign and Assignment Workflows

## 7.1 Campaign Lifecycle

7.  Owner/Admin creates a campaign with client, brief, dates, status,
    deliverables and applicable rates or goals.

8.  Authorized staff assigns an Account Manager and participating
    creators.

9.  Creators receive role-appropriate campaign information and submit
    required content.

10. Account Manager/Owner reviews submissions and records approval,
    rejection or requested revision.

11. Approved content becomes an eligible earning source and enters
    performance tracking.

12. Campaign activity, content status and authorized analytics remain
    visible to permitted stakeholders.

13. Campaign closes or archives while preserving history, financial
    links and audit records.

## 7.2 Assignment Requirements

-   Assignments must have explicit creator, campaign/client, Account
    Manager, status and timestamps.

-   Reassignment must not orphan submissions, metrics, approvals or
    earnings.

-   Removal/deactivation must preserve historical references.

-   Duplicate active assignments should be prevented by a unique
    constraint or equivalent validation.

-   Changes must be reflected consistently in dashboards, APIs and
    access checks.

# 8. Content and Performance Tracking

Content tracking existed in the original portal before the later visual
expansion. The foundational record links submitted content to a creator
and campaign and supports review, performance capture and payout
attribution.

  -----------------------------------------------------------------------
  **Data group**  **Required fields / behavior**
  --------------- -------------------------------------------------------
  Identity        Content ID, creator, campaign, platform, external URL,
                  platform post ID where available

  Submission      Submitted date/time, caption/title or description,
                  deliverable type, evidence/attachment references

  Review          Status, reviewer, review timestamp, notes/rejection
                  reason, revision history

  Publishing      Posting date, live URL, active/deleted state

  Metrics         Views and other API-permitted metrics, source,
                  captured-at timestamp, sync status

  Financial       Base earning transaction, bonus evaluation window,
  linkage         bonus transaction, payout linkage

  Audit           Who changed what, previous/new status, timestamp and
                  correlation/reference ID
  -----------------------------------------------------------------------

## 8.1 Suggested State Model

Draft → Submitted → Under Review → Revision Requested or Rejected →
Approved → Published/Tracked → Archived. Exact legacy labels should be
mapped rather than renamed during restoration unless the owner approves
a migration.

## 8.2 Metric Integrity

-   Store metric snapshots with source and retrieval time; do not
    silently overwrite provenance.

-   Protect against duplicate content records for the same platform
    post.

-   Treat third-party counts as eventually consistent and subject to API
    availability.

-   Do not calculate payouts from stale or unverified values without an
    explicit review state.

-   Expose sync failures to authorized operators and provide a safe
    retry path.

# 9. Creator Earnings and Payout System

## 9.1 Confirmed Historical Business Rules

  -----------------------------------------------------------------------
  **Rule**              **Original baseline**
  --------------------- -------------------------------------------------
  Base creator pay      \$10 per approved video

  Performance           Approximately 10 days after posting/submission,
  evaluation            with supporting information reviewed

  Withdrawal cadence    14-day cooldown between eligible withdrawal
                        requests

  Manual methods        Bank transfer and Zelle, completed externally and
                        reconciled in the portal

  Automated option      Stripe Connect Express where configured and
                        operational

  Batching              Approved withdrawals may be grouped into a payout
                        batch

  Export                CSV export supports manual payout processing
  -----------------------------------------------------------------------

## 9.2 Performance Bonus Schedule

  -----------------------------------------------------------------------
  **Verified view threshold**         **Bonus**
  ----------------------------------- -----------------------------------
  50,000                              +\$50

  100,000                             +\$150

  250,000                             +\$250

  500,000                             +\$350

  1,000,000                           +\$500

  10,000,000+                         +\$1,000
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------
  **RULE REQUIRING CONFIRMATION** The threshold schedule is documented
  historically, but the calculation mode must be confirmed: tiered
  "highest qualifying bonus only" versus cumulative awards. Restoration
  must not guess; production data and prior code should determine the
  existing rule.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------

## 9.3 Ledger Requirements

-   Use immutable or append-only ledger transactions rather than editing
    a displayed balance.

-   Track base earnings, pending/approved bonuses, withdrawals,
    reversals/returns and paid amounts.

-   Every entry records creator, type, amount, currency, source record,
    status, timestamps and actor/system origin.

-   Available balance is derived from posted credits less
    locked/requested/paid debits, with reconciliation controls.

-   A content approval or bonus evaluation must not create duplicate
    ledger credits when retried.

## 9.4 Withdrawal State Machine

14. Creator requests a permitted amount (historically full
    available-balance withdrawals were supported).

15. System validates positive available balance, cooldown eligibility,
    payout method and absence of duplicate active requests.

16. Requested funds are atomically locked or moved out of available
    balance.

17. Authorized payment staff approve or reject the request; rejection
    requires a reason and returns funds through a reversal/unlock
    transaction.

18. Approved requests may enter a payout batch or Stripe transfer flow.

19. External payment completion is reconciled and marked paid with
    reference, date and actor.

20. Creator receives status notification and can view the completed
    history.

## 9.5 Financial Controls

-   Idempotency keys for approval, batch and transfer operations.

-   Database transactions for withdrawal locking, rejection reversal and
    ledger posting.

-   No hard deletion of financial records.

-   Currency stored explicitly; amounts use fixed-precision
    decimal/minor units.

-   Batch totals must equal included withdrawal totals before export or
    payment.

-   CSV export and mark-paid actions are audited.

-   Stripe webhooks are signature-verified and replay-safe.

# 10. Social Platform Integrations

## 10.1 TikTok

Creators should connect their own TikTok accounts through an approved
OAuth/API flow. Development testing was historically successful, while
production approval remained an external dependency after TikTok
interpreted the use case as internal/company-managed account display.

-   Store encrypted access/refresh tokens or secure references; never
    expose them to clients or logs.

-   Request only approved scopes and show clear consent/reconnection
    states.

-   Retrieve permitted post/profile metrics, associate posts with Omnya
    content, and synchronize on a controlled schedule.

-   Implement token refresh, revocation handling, rate-limit backoff,
    retry limits and operator-visible sync errors.

-   Degrade gracefully when production access is unavailable; manual
    submission and evidence review must remain possible.

## 10.2 Instagram / Meta

Instagram analytics belonged to earlier V1 discussions. The expected
flow is creator/account connection, supported post or reel discovery,
metric retrieval, content matching, scheduled refresh and
campaign/creator analytics. Exact fields remain bounded by Meta
permissions and account eligibility.

## 10.3 Integration Acceptance

-   OAuth success, denial, expiration, refresh failure and disconnect
    are handled.

-   Only the connecting creator and authorized staff can view connection
    state.

-   Metrics include source and freshness timestamps.

-   Duplicate synchronization does not duplicate posts, metrics or
    earnings.

-   Revoked permissions stop synchronization without corrupting
    historical data.

-   Third-party outages do not block unrelated portal operations.

# 11. Data Model and Database Requirements

  -----------------------------------------------------------------------
  **Entity**          **Purpose / key relationships**
  ------------------- ---------------------------------------------------
  User / Role /       Identity, lifecycle, roles and granular
  Permission          authorization

  Creator Profile     User extension, social connections, payout
                      preferences and status

  Client / Brand      Client identity and relationship to campaigns

  Account Manager     Scopes managers to creators, clients and campaigns
  Assignment          

  Campaign            Client, brief, dates, status, deliverables and
                      operational metadata

  Campaign Creator    Many-to-many participation and assignment status

  Content Submission  Creator + campaign + platform content and review
                      state

  Metric Snapshot     Time-stamped platform metrics and synchronization
                      provenance

  Earnings Ledger     Immutable credit/debit/reversal linked to content,
  Entry               bonus or withdrawal

  Bonus Evaluation    Threshold, evidence, evaluation date, result and
                      ledger link

  Withdrawal Request  Amount, cooldown basis, method and approval state

  Payout Batch /      Groups approved withdrawals and preserves
  Batch Item          reconciliation

  Social Connection   Provider account, encrypted token reference, scopes
                      and expiry

  Audit Event         Actor, action, target, before/after summary,
                      timestamp and correlation ID

  Notification        Template/event, recipient, delivery status and
                      retry metadata
  -----------------------------------------------------------------------

## 11.1 Persistence Constraints

-   Foreign keys preserve campaign, creator, content and financial
    relationships.

-   Soft deletion or inactive states apply where historical records must
    remain referentially intact.

-   Unique constraints prevent duplicate active assignments, provider
    accounts, platform posts and idempotency keys.

-   Indexes support role-scoped lists, campaign/content filters, metric
    refresh queries and payout queues.

-   Schema changes use versioned migrations with rollback or forward-fix
    plans and tested backups.

# 12. Infrastructure and Operations

-   Separate development, staging and production environments with
    isolated data and credentials.

-   Secrets managed outside source code and rotated when exposure is
    suspected.

-   TLS enforced in transit; supported encryption at rest for databases,
    backups and token material.

-   Scheduled workers handle metric synchronization, notification
    delivery and time-based bonus evaluation.

-   Centralized structured logs include correlation IDs but exclude
    tokens, passwords and unnecessary personal/financial data.

-   Health checks and monitoring cover application availability, job
    failures, database health, integration errors and payout failures.

-   Automated, encrypted backups are retained and restoration is
    periodically tested.

-   Deployments use versioned builds, migrations, smoke tests and an
    actionable rollback/forward-fix procedure.

# 13. Security, Privacy and Auditability

  --------------------------------------------------------------------------
  **Control area**     **Minimum requirement**
  -------------------- -----------------------------------------------------
  Authentication       Secure password hashing or trusted identity provider;
                       session expiry; reset protections; optional MFA for
                       privileged users

  Authorization        Server-side role + record-scope checks for every
                       protected operation

  Input/API security   Schema validation, parameterized queries, output
                       encoding, CSRF protection where applicable, secure
                       CORS and rate limiting

  Data minimization    Collect and return only data required for the user's
                       role and workflow

  Sensitive data       Encrypt tokens and sensitive payout details; redact
                       logs and error messages

  Audit                Append important administrative, content approval and
                       financial actions with actor and timestamp

  Deletion/retention   Define retention; prevent destructive removal of
                       records needed for financial or audit history

  Dependencies         Patch supported runtimes and libraries; scan for
                       known vulnerabilities

  Incident readiness   Logging, alerting, access revocation, credential
                       rotation and recovery runbooks
  --------------------------------------------------------------------------

# 14. Notifications and Exports

-   Notify creators of withdrawal receipt, approval, rejection and
    payment completion.

-   Include rejection reasons where appropriate without leaking
    internal-only notes.

-   Retry transient delivery failures with limits and preserve delivery
    state.

-   CSV payout export contains only fields needed for the authorized
    manual payment process.

-   Exports are permission-controlled, logged and protected against
    spreadsheet formula injection.

-   Daily Slack Top Posts automation is not part of the original scope.

# 15. Testing Strategy

## 15.1 Automated Tests

-   Unit tests: permissions, campaign/content transitions, bonus
    thresholds, cooldown logic, available-balance calculations and CSV
    sanitization.

-   Integration tests: database constraints, OAuth/token lifecycle,
    metric upserts, Stripe webhook replay, ledger/withdrawal
    transactions and notification jobs.

-   API tests: authentication, field-level response filtering,
    unauthorized access, validation and idempotency.

-   End-to-end tests: each role's critical workflow using staging data
    representative of real campaigns.

## 15.2 Manual and Non-Functional QA

-   Owner, Account Manager, Creator and Client workflows on desktop and
    mobile breakpoints.

-   Real campaign-data scenarios covering assignments, submissions,
    metrics, bonuses and payouts.

-   Cross-browser checks, keyboard navigation, visible focus, labels,
    contrast and usable error messages.

-   Failure injection for expired tokens, API rate limits, notification
    failure and payout retry.

-   Performance checks for large creator/content lists and common
    filtered queries.

-   Security tests for horizontal privilege escalation, client
    payout-data exposure, injection and session handling.

-   Regression audit for missing edit/delete controls, buttons that work
    once, stale UI state and frontend/database mismatch.

# 16. Production Readiness Gate

  -----------------------------------------------------------------------
  **Gate**           **Evidence required**
  ------------------ ----------------------------------------------------
  Scope              Original requirements mapped to routes, services,
  reconciliation     tables and test cases

  Data integrity     Migration rehearsal, constraint checks,
                     orphan/duplicate report and reconciliation totals

  RBAC               Role/action matrix tested with positive and negative
                     cases

  Payout safety      Ledger invariants, idempotency, reconciliation and
                     manual recovery tested

  Integrations       Approved credentials/scopes, token lifecycle,
                     webhook verification and outage behavior tested

  Observability      Health checks, actionable logs, alerts and job
                     dashboards configured

  Recovery           Backup restore demonstrated; rollback/forward-fix
                     procedure documented

  Quality            Automated suite passes; critical manual regression
                     and responsive QA pass

  Security           Secrets reviewed; high-severity findings resolved;
                     privileged access reviewed

  Sign-off           Owner accepts evidence and known limitations;
                     third-party blockers documented
  -----------------------------------------------------------------------

# 17. Completed vs. Pending Baseline

The table below is intentionally conservative because no repository or
production inspection was supplied with this request.

  -----------------------------------------------------------------------
  **Area**           **Historical status**        **Current action**
  ------------------ ---------------------------- -----------------------
  Owner/Admin        Original scope; previously   Restore and verify
  operations         implemented in whole or part 

  Creator, Account   Original expected behavior;  Restore and
  Manager and Client regressions reported         regression-test
  CRUD                                            

  Role assignments   Original expected behavior   Verify end to end
  and scoped access                               

  Campaign/content   Original foundational scope  Verify data and UI
  workflows                                       consistency

  Payout ledger,     Described as a major         Reconcile and
  withdrawals,       completed area               regression-test
  batches and audit                               

  TikTok integration Built/tested in development; Pending external
                     production approval          approval and production
                     constrained                  verification

  Instagram          Earlier V1 scope             Confirm permissions,
  analytics                                       implementation and sync

  Responsive web     Original commitment          Cross-device validation
  portal                                          required

  UGCTrackr-style    Newer \$1,200 expansion      Explicitly out of this
  dashboards and                                  specification
  views                                           
  -----------------------------------------------------------------------

## 17.1 Restoration Priority

21. Audit repository, database and deployed routes against this
    document.

22. Restore user/creator/Account Manager/client CRUD, assignments,
    edit/delete and broken actions.

23. Verify original campaign and content workflows and reconcile legacy
    data.

24. Reconcile payout ledger, withdrawals, batches, exports and
    notification behavior.

25. Verify social connection and metric synchronization status without
    blocking manual workflows.

26. Complete RBAC, responsive, error-handling and real-data regression
    testing.

27. Produce a signed evidence matrix before starting any newer
    expansion.

# 18. Assumptions

-   The portal is a single Omnya organization unless the repository
    proves multi-tenancy.

-   A browser-based responsive portal---not a separate native mobile
    app---is the original delivery surface.

-   Owner/Admin may delegate payment administration, but that delegation
    is explicit.

-   Manual bank/Zelle transfers happen outside the portal and are
    reconciled inside it.

-   Third-party metrics and OAuth features are limited by approved
    provider scopes and policies.

-   Existing labels and database semantics should be preserved during
    restoration unless migration is approved.

-   Historical descriptions are sufficient for a baseline but not for
    certifying current implementation status.

# 19. Risks and Mitigations

  -----------------------------------------------------------------------------
  **Risk**            **Impact**                 **Mitigation**
  ------------------- -------------------------- ------------------------------
  Legacy regression   Core operations blocked    Route-by-route audit; restore
  or missing controls                            surgical changes; regression
                                                 suite

  Frontend/database   Stale or incorrect         Trace API contracts; reconcile
  mismatch            user-visible state         migrations and records;
                                                 transactional updates

  RBAC leakage        Unauthorized               Server-side record scoping;
                      client/creator/financial   negative tests; audit
                      access                     privileged actions

  Duplicate earnings  Financial loss and         Immutable ledger, constraints,
  or withdrawals      reconciliation failure     idempotency and atomic locking

  Ambiguous bonus     Incorrect creator          Confirm legacy rule and
  calculation         compensation               production examples before
                                                 modification

  TikTok/Meta         Metrics unavailable or     Manual fallback, explicit
  approval or API     stale                      freshness, retry/backoff and
  change                                         dependency register

  Token or            Security/privacy incident  Encryption, least privilege,
  payout-data                                    secret rotation and log
  exposure                                       redaction

  Scope creep into    Cost and schedule dispute  Use explicit boundaries and
  newer expansion                                change control

  Insufficient        False completion claim     Require acceptance evidence
  production evidence                            matrix and stakeholder
                                                 sign-off
  -----------------------------------------------------------------------------

# 20. Acceptance Criteria

## 20.1 Functional Acceptance

-   Owner can create, edit, deactivate/delete as permitted, and assign
    creators, Account Managers, clients and campaigns repeatedly without
    one-time-action defects.

-   Account Managers can access only assigned records and complete
    delegated campaign/content operations.

-   Creators can view assignments, submit content, see only their own
    earnings and request eligible withdrawals.

-   Clients can access assigned campaign/content reporting and cannot
    access creator payout information.

-   Campaign and content state transitions persist correctly and retain
    history.

-   Approved content produces exactly one correct base earning; bonus
    evaluation produces no duplicate credits.

-   Withdrawal approval, rejection, balance restoration, batching,
    export and mark-paid flows reconcile exactly.

-   TikTok/Instagram connection and sync operate where approved, with
    clear failure states and manual fallback.

## 20.2 Security and Quality Acceptance

-   Unauthorized route/API/record access returns a safe denial with no
    sensitive payload.

-   Critical changes and financial actions are auditable.

-   No high-severity known security issue remains open at release.

-   Critical automated and manual regression tests pass in staging.

-   Responsive workflows are usable at agreed desktop, tablet and mobile
    breakpoints.

-   Backups, migration procedure, monitoring and rollback/forward-fix
    readiness are demonstrated.

## 20.3 Evidence Package

-   Requirement-to-test traceability matrix.

-   Role/permission test results, including negative tests.

-   Data reconciliation report for users, assignments, content, ledger
    and payouts.

-   Integration status with approved scopes and known external blockers.

-   Release notes, migration record, deployment identifier and rollback
    plan.

-   Open-risk register and owner sign-off.

# 21. Scope Boundaries and Change Control

## 21.1 Explicitly Included

-   Original Owner/Admin, Account Manager, Creator and Client
    experiences.

-   Original CRUD, assignments, campaigns, content
    submission/review/tracking and role-scoped reporting.

-   Original payout ledger, bonus rules, withdrawals,
    approval/rejection, batches, manual export, reconciliation and
    notifications.

-   Earlier TikTok and Instagram connection/analytics work, limited by
    provider approvals and verified legacy scope.

-   Responsive behavior, RBAC, audit, testing, restoration and
    production hardening.

## 21.2 Explicitly Out of Original Scope

-   UGCTrackr-inspired aggregate analytics dashboard and Top Posts
    module.

-   Campaign progress cards, campaign timeline, calendar/Gantt and
    Cards/Table/Calendar view modes.

-   Week X badges, enhanced sortable creator leaderboard, Breakouts and
    Recent Breakouts.

-   Improved Posts Explorer with new gallery/table experiences, new
    filtering/presentation and breadcrumb overhaul.

-   Daily Slack Top Posts automation.

-   UGCTrackr-specific Pending Funding presentation or Book a Demo beta
    gate.

-   YouTube integration unless separately approved.

-   A separate native iOS/Android Omnya application.

-   Any materially new workflow, provider, payment rail, reporting
    concept or redesign not evidenced as original scope.

## 21.3 Change Control

A proposed change is evaluated against this baseline. If it changes
users, data entities, workflow states, integrations, financial rules,
acceptance tests, delivery schedule or operational burden, it requires a
written change request with impact, assumptions, estimate, dependencies
and acceptance criteria before implementation.

# Appendix A. Restoration Audit Checklist

-   Inventory deployed pages, API endpoints, database tables/migrations,
    jobs and third-party credentials.

-   Map each role to visible navigation, permitted routes, actions and
    record filters.

-   Exercise add/edit/delete/deactivate and repeated actions for
    creators, managers and clients.

-   Verify assignments and reassignment across campaigns and clients.

-   Trace one real content item from submission through approval,
    metrics, base earning, bonus and payout.

-   Reconcile ledger totals to withdrawal and paid totals; identify
    duplicates and orphan records.

-   Review social OAuth and sync logs, token states, job schedules and
    rate-limit handling.

-   Test responsive layouts, form validation, empty/loading/error states
    and dead controls.

-   Record each discrepancy with severity, owner, evidence, fix, test
    and release status.

# Appendix B. Requirement Traceability Template

  ------------------------------------------------------------------------------------
  **ID**    **Requirement**           **Evidence**    **Test**            **Status**
  --------- ------------------------- --------------- ------------------- ------------
  RBAC-01   Creator cannot access     API/route       Negative            Open
            another creator's records mapping         authorization test  

  PAY-01    Approved video creates    Ledger          Retry/idempotency   Open
            one \$10 credit           transaction +   test                
                                      content link                        

  WDR-01    Rejected withdrawal       Ledger reversal Workflow            Open
            restores locked funds                     integration test    

  SOC-01    Expired provider token    Sync log and    Token-expiry test   Open
            fails safely              connection                          
                                      state                               

  OPS-01    Backup can be restored    Restore log     Recovery drill      Open
  ------------------------------------------------------------------------------------

# Appendix C. Open Decisions Requiring Evidence

-   Exact technology stack, hosting provider, database engine and
    deployment topology.

-   Whether bonus tiers are cumulative or highest-tier-only.

-   Exact content status labels and which role can approve at each
    stage.

-   Whether Account Managers have any financial visibility or approval
    authority.

-   Exact withdrawal amount behavior, cooldown anchor and exception
    policy.

-   Current TikTok/Meta approved scopes, production status and
    synchronization cadence.

-   Retention periods, deletion policy, supported currencies and
    privacy/compliance obligations.
