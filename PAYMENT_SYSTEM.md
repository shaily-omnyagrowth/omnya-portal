# Omnya Creator Payment System — Full Analysis

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [Database Schema](#database-schema)
4. [Role: Owner](#role-owner)
5. [Role: Account Manager](#role-account-manager)
6. [Role: Creator](#role-creator)
7. [Security Boundaries](#security-boundaries)
8. [Payment Flow Diagrams](#payment-flow-diagrams)
9. [API Reference](#api-reference)
10. [Email Notifications](#email-notifications)
11. [Stripe Connect Flow](#stripe-connect-flow)
12. [Environment Variables](#environment-variables)
13. [Production Checklist](#production-checklist)

---

## System Overview

The payment system is an **internal ledger and approval pipeline**. No money moves automatically unless a creator has connected Stripe. Every payout requires at least one explicit admin action before funds are released.

**Supported payout methods:**
- Bank Transfer — manual, owner processes externally then marks paid
- Zelle — manual, owner processes externally then marks paid
- Stripe Connect — automated ACH, 2–3 business days, triggered automatically when batch is marked paid

**Business rules:**
- Base pay: **$10.00 per approved final video** (flat)
- Performance bonus: view-based tier system, applied 10 days after posting
- Withdrawal cooldown: **14 days** between requests (enforced in Postgres, not just frontend)
- Currency: **USD only** (enforced by CHECK constraint)
- Withdrawal covers full available balance (no partial withdrawals)
- Paid earnings are never overwritten or deleted

---

## Architecture

```
Creator Portal (React CRA — localhost:3000 / Vercel)
        │
        ├── Supabase (PostgreSQL)
        │     ├── Tables: creator_earnings, withdrawal_requests,
        │     │           payments, payout_batches, payment_managers,
        │     │           payment_audit_logs
        │     ├── RLS policies (role-scoped row access)
        │     └── RPC functions (atomic multi-table transactions)
        │
        ├── Vercel Serverless Functions (/api/**)
        │     └── JWT auth + requirePaymentPermission on every route
        │
        ├── Resend — transactional email (7 payment email types)
        │
        └── Stripe Connect Express
              ├── Creator-hosted KYC onboarding
              ├── Automatic ACH transfers on mark-paid
              └── Webhook sync (account.updated, transfer.paid, transfer.failed)
```

---

## Database Schema

### Tables Overview

| Table | Purpose |
|---|---|
| `creator_earnings` | Internal ledger — one row per earning event per submission |
| `withdrawal_requests` | Creator cash-out requests with full approval audit trail |
| `payments` | Individual payment records linked to withdrawal requests and batches |
| `payout_batches` | Groups of approved payments processed together |
| `payment_managers` | Delegated admin permission grants (owner → team member) |
| `payment_audit_logs` | Immutable audit trail of every financial action |

### `creator_earnings` — Earning Ledger

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `creator_id` | UUID FK → creators | |
| `campaign_id` | UUID FK → campaigns | nullable |
| `submission_id` | UUID FK → submissions | nullable |
| `earning_type` | TEXT | `base_video_pay` / `performance_bonus` / `manual_bonus` / `manual_adjustment` / `deduction` |
| `amount` | NUMERIC(12,2) | Always ≥ 0 |
| `currency` | TEXT | Always `USD` |
| `status` | TEXT | See lifecycle below |
| `views_counted` | INTEGER | Views used for bonus calculation |
| `bonus_tier` | TEXT | Human label e.g. `500K views` |
| `approved_by` | UUID FK → auth.users | Who approved this earning |

**Earning status lifecycle:**
```
pending → eligible → approved → withdrawal_requested → batched → paid
                              ↘ needs_review → approved
                              ↘ forfeited
                              ↘ cancelled
```

**Duplicate protection (partial unique indexes):**
```sql
UNIQUE (submission_id) WHERE earning_type = 'base_video_pay'
UNIQUE (submission_id) WHERE earning_type = 'performance_bonus'
```

### `withdrawal_requests`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `creator_id` | UUID FK → creators | |
| `amount` | NUMERIC(12,2) | Full available balance at request time |
| `currency` | TEXT | Always `USD` (CHECK constraint) |
| `status` | TEXT | `pending_admin_approval` → `approved` → `batched` → `paid` |
| `payment_method` | TEXT | Snapshotted at request time |
| `payment_destination_summary` | TEXT | Safe masked destination string |
| `approved_by` / `rejected_by` | UUID FK | Who acted |
| `rejection_reason` | TEXT | Required on rejection |
| `batch_id` | UUID FK → payout_batches | Set when batched |
| `is_stripe_payout` | BOOLEAN | Whether Stripe handles transfer |

### `payments`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `creator_id` | UUID FK | |
| `withdrawal_request_id` | UUID FK | |
| `batch_id` | UUID FK → payout_batches | |
| `amount` | NUMERIC(12,2) | |
| `payment_method` | TEXT | `bank_transfer` / `zelle` / `stripe` |
| `status` | TEXT | `pending` → `approved` → `batched` → `processing` → `paid` / `failed` |
| `stripe_transfer_id` | TEXT | `tr_...` from Stripe |
| `stripe_transfer_status` | TEXT | `pending` / `paid` / `failed` |
| `stripe_transfer_error` | TEXT | Error message if failed |
| `processed_by` / `processed_at` | UUID / TIMESTAMPTZ | Who marked paid |

### `payout_batches`

| Column | Type | Notes |
|---|---|---|
| `batch_number` | TEXT UNIQUE | `BATCH-YYYYMMDD-001` format |
| `status` | TEXT | `draft` → `approved` → `exported` → `paid` / `cancelled` |
| `total_amount` | NUMERIC(12,2) | Sum of all payments |
| `total_creators` | INTEGER | Distinct creator count |
| `generated_by` / `generated_at` | UUID / TIMESTAMPTZ | Who created the batch |
| `exported_at` | TIMESTAMPTZ | When CSV was downloaded |
| `marked_paid_by` / `marked_paid_at` | UUID / TIMESTAMPTZ | Who finalized |

### `payment_managers`

| Column | Type | Default |
|---|---|---|
| `user_id` | UUID FK UNIQUE | |
| `can_view_payouts` | BOOLEAN | `true` |
| `can_approve_withdrawals` | BOOLEAN | `true` |
| `can_export_batches` | BOOLEAN | `true` |
| `can_mark_paid` | BOOLEAN | `false` |
| `active` | BOOLEAN | `true` |

### `creators` — Payment Columns Added

| Column | Purpose |
|---|---|
| `payment_method` | `bank_transfer` / `zelle` / `stripe` |
| `bank_name` | Bank name (safe — no full account stored) |
| `bank_account_last4` | Last 4 digits only |
| `zelle_email` / `zelle_phone_last4` | Zelle contact info |
| `payment_method_status` | `missing` / `submitted` / `verified` |
| `stripe_account_id` | Stripe Express account ID (`acct_...`) |
| `stripe_account_status` | `not_connected` / `onboarding` / `pending` / `active` / `disabled` |
| `stripe_charges_enabled` / `stripe_payouts_enabled` | Synced from Stripe webhook |

### `submissions` — Bonus Columns Added

| Column | Purpose |
|---|---|
| `posted_url` | URL of the live posted video |
| `posted_at` | When the video went live |
| `view_count_submitted` | Creator-submitted view count |
| `view_count_verified` | Admin-verified count (used first in bonus calc) |
| `bonus_eligible` | True when post is 10+ days old |
| `bonus_forfeited` | Admin forfeited the bonus |
| `bonus_forfeit_reason` | Reason stored for creator communication |

---

## Performance Bonus Tiers

| Views | Bonus | Label |
|---|---|---|
| ≥ 10,000,000 | **$1,000** | 10M+ views |
| ≥ 1,000,000 | **$500** | 1M views |
| ≥ 500,000 | **$350** | 500K views |
| ≥ 250,000 | **$250** | 250K views |
| ≥ 100,000 | **$150** | 100K views |
| ≥ 50,000 | **$50** | 50K views |
| < 50,000 | $0 | No bonus |

> **Important:** These are NOT additive. A video with 500,000 views earns **$350**, not $50 + $150 + $250 + $350. The highest matching tier wins.

---

## Role: Owner

The Owner has unrestricted access to every part of the payment system via the **Payout Manager** screen (`?page=payout-manager`).

### Dashboard Overview (on load)

Five stat cards fetched from Supabase on mount:

| Card | Query |
|---|---|
| Total Approved Unpaid | `SUM(creator_earnings.amount) WHERE status = 'approved'` |
| Pending Bonus Review | `COUNT(creator_earnings) WHERE status IN ('needs_review', 'eligible')` |
| Pending Withdrawals | `COUNT(withdrawal_requests) WHERE status = 'pending_admin_approval'` |
| Paid This Month | `SUM(payments.amount) WHERE status = 'paid' AND processed_at this month` |
| Missing Payment Method | `COUNT(creators) WHERE payment_method_status = 'missing' OR payment_method IS NULL` |

---

### Action 1 — Recalculate Earnings

**Trigger:** Owner clicks Recalculate Earnings → confirmation modal → POST `/api/earnings/recalculate`

**Pass 1 — Base Pay:**
1. Query all submissions with final approval status (`approved`, `final_approved`, `completed`)
2. For each: check if `base_video_pay` earning exists (partial unique index prevents duplicates)
3. If missing: `INSERT creator_earnings` with `amount = 10.00`, `status = 'approved'`
4. Already-paid earnings are never modified

**Pass 2 — Performance Bonuses:**
1. Find submissions with `posted_at` set and ≥ 10 days old
2. Use `view_count_verified` if > 0, else fall back to `view_count_submitted`
3. Apply bonus tier table (highest tier wins)
4. If bonus > 0 and no `performance_bonus` earning exists: `INSERT` with `status = 'eligible'`
5. If earning exists and is not `paid`/`forfeited`: update amount if tier changed

**Response:** `{ basePay: { created, skipped }, bonus: { created, updated, skipped } }`

---

### Action 2 — Bonus Review

**Panel:** Lists all `creator_earnings WHERE status IN ('needs_review', 'eligible')`

Columns: Creator, Submission, Views Submitted, Views Verified, Calculated Bonus, Days Since Post, Status

**Approve Bonus:**
```sql
UPDATE creator_earnings SET status = 'approved' WHERE id = X
```
Earning immediately counts toward creator's available balance.

**Forfeit Bonus:**
- Requires written reason
```sql
UPDATE creator_earnings
SET status = 'forfeited', bonus_forfeit_reason = reason
WHERE id = X
```
Permanently excluded from balance. Cannot be re-approved via UI.

---

### Action 3 — Withdrawal Approval / Rejection

**Tabs:** Pending | Approved | Rejected | Batched | Paid

Each tab queries `withdrawal_requests` joined with `creators` filtered by status.

**Approve:**
```javascript
supabase.rpc('approve_withdrawal_request', {
  p_request_id: id,
  p_approved_by: user.id
})
```
Postgres RPC (atomic):
1. `SELECT FOR UPDATE` — prevents concurrent approvals
2. Validates `status = 'pending_admin_approval'`
3. `UPDATE withdrawal_requests SET status = 'approved'`
4. `INSERT INTO payments` with `status = 'approved'`
5. Audit log → `withdrawal_approved`

After RPC: sends `withdrawal_approved` email to creator via Resend.

**Reject:**
```javascript
supabase.rpc('reject_withdrawal_request', {
  p_request_id: id,
  p_rejected_by: user.id,
  p_reason: reason  // required, non-empty
})
```
Postgres RPC (atomic):
1. `SELECT FOR UPDATE`
2. Validates reason is not empty
3. `UPDATE withdrawal_requests SET status = 'rejected', rejection_reason`
4. **Returns earnings to `approved`** — creator's balance is fully restored
5. Audit log → `withdrawal_rejected`

After RPC: sends `withdrawal_rejected` email with the reason.

---

### Action 4 — Create Payout Batch

**Trigger:** Check approved withdrawal requests → click Create Batch

```javascript
supabase.rpc('create_payout_batch', {
  p_withdrawal_request_ids: [uuid, uuid, ...],
  p_generated_by: user.id,
  p_notes: null
})
```

Postgres RPC (atomic):
1. Validates all IDs exist and have `status = 'approved'`
2. Generates `BATCH-YYYYMMDD-NNN` via Postgres sequence
3. `INSERT INTO payout_batches` with computed totals
4. `UPDATE withdrawal_requests SET status = 'batched', batch_id`
5. `UPDATE payments SET status = 'batched', batch_id`
6. `UPDATE creator_earnings SET status = 'batched'`
7. Audit log → `batch_created`

Returns: `{ batch_id, batch_number, total_amount, total_creators, total_payments }`

---

### Action 5 — Export CSV

**Trigger:** Click Export CSV on a batch → `GET /api/payouts/export?batchId=X`

**Server process:**
1. Joins `payout_batches → payments → creators → withdrawal_requests`
2. Builds UTF-8 BOM CSV (`﻿` prefix for Excel compatibility)
3. Masks all sensitive data:
   - Bank Transfer: `"Chase ****1234"`
   - Zelle email: `"j***@gmail.com"` (first char + `***@domain`)
   - Zelle phone: `"Zelle: ****5678"`
4. Filename: `omnya-payout-batch-BATCH-20260530-001-2026-05-30.csv`
5. Updates `payout_batches.exported_at = now()`
6. Logs `batch_exported` to audit trail

**CSV columns:** Batch Number, Creator Name, Creator Email, Payment Method, Payment Destination, Amount, Currency, Withdrawal Request ID, Requested Date, Approved Date, Notes

---

### Action 6 — Mark Batch Paid

**Trigger:** Click Mark Paid → confirmation modal → confirm

```javascript
supabase.rpc('mark_payout_batch_paid', {
  p_batch_id: batch.id,
  p_marked_paid_by: user.id
})
```

Postgres RPC (atomic — blocks double-payment with row lock):
1. `SELECT FOR UPDATE` on batch
2. Rejects if `status = 'paid'` or `status = 'cancelled'`
3. `UPDATE payout_batches SET status = 'paid', marked_paid_by, marked_paid_at`
4. `UPDATE payments SET status = 'paid', processed_by, processed_at`
5. `UPDATE withdrawal_requests SET status = 'paid', paid_at`
6. `UPDATE creator_earnings SET status = 'paid'` (all `batched` earnings for these creators)
7. Audit log → `batch_marked_paid`

**After RPC — Stripe Auto-Transfer:**
For each payment where `payment_method = 'stripe'` and creator's Stripe account is active:
```javascript
stripe.transfers.create({
  amount: amountCents,       // $10.50 → 1050
  currency: 'usd',
  destination: creator.stripe_account_id,
  metadata: { payment_id, creator_id, platform: 'omnya' }
})
// Sets payment.status = 'processing', stripe_transfer_id, stripe_initiated_at
```
Stripe fires `transfer.paid` webhook → `payment.status = 'paid'` (async, 2–3 business days).

**After RPC — Emails:**
Sends `payment_sent` email to every creator in the batch (consolidated by email address). Email failures are logged but do not affect payment status.

---

### Action 7 — Manage Payment Managers

**Visible to Owner only.** Delegates limited payout permissions to team members.

**Grant access:**
- Input: user ID or email (email auto-resolved to UUID via `user_profiles`)
- Check permission boxes
- Upserts into `payment_managers` on conflict (`user_id`)
- Logs `payment_manager_granted`

**Revoke access:**
- Sets `payment_managers.active = false` (soft delete — row retained for audit)
- Logs `payment_manager_revoked`

**Available permissions:**

| Permission | What it unlocks |
|---|---|
| View Payouts | See all payout data (not scoped to assigned creators) |
| Approve Withdrawals | Approve and reject withdrawal requests |
| Create Batches | Group approved requests into payout batches |
| Export CSV | Download batch CSV files |
| Mark Paid | Mark batches paid and trigger Stripe transfers |

---

## Role: Account Manager

Account Managers have **read-only access** scoped to their **assigned creators only**. They cannot take any payment action unless the Owner explicitly adds them as a Payment Manager.

### What an AM Can See

RLS enforces this at the database level — even direct Supabase queries from the browser only return assigned creator data:

```sql
-- RLS policy for AM on creator_earnings:
EXISTS (
  SELECT 1 FROM creators c
  JOIN account_managers am ON c.am_id = am.id
  WHERE c.id = creator_earnings.creator_id
    AND am.user_id = auth.uid()
)
```

**AM can view:**
- `creator_earnings` — amounts, statuses, bonus tiers for assigned creators
- `withdrawal_requests` — request status for assigned creators
- `payments` — payment history for assigned creators
- `creators.payment_method_status` — whether a creator is missing a payment method

**AM cannot:**
- Approve or reject withdrawals
- Create payout batches
- Export CSVs
- Mark payments paid
- See `payout_batches` (no RLS access at all)
- See other AMs' creators' financial data
- Access `payment_audit_logs`

### API-Level Scoping

`GET /api/earnings/summary` with AM role:
1. Requires `creatorId` query param
2. Verifies the creator is assigned to this AM (`account_managers.user_id = uid`)
3. Returns 403 if they try to access an unassigned creator

### AM Elevated to Payment Manager

If Owner grants AM payment manager permissions:
- `can_view_payouts` → sees **all** creators' data (not just assigned)
- Other permissions as checked by Owner
- Every API route checks `requirePaymentPermission` which reads `payment_managers` table on every request — permission can be revoked mid-session with immediate effect

---

## Role: Creator

Creators access their full earnings dashboard at `?page=earnings` via the Creator Earnings component.

### Balance Dashboard (on load)

Four cards fetched via `GET /api/earnings/summary`:

| Card | Calculation |
|---|---|
| Available Balance | `SUM(amount) WHERE status = 'approved'` |
| Pending Review | `SUM(amount) WHERE status IN ('pending', 'eligible', 'needs_review')` |
| Withdrawal Requested | `SUM(amount) WHERE status = 'withdrawal_requested'` |
| Total Paid | `SUM(amount) WHERE status = 'paid'` |

Also returned: `canRequestWithdrawal` (boolean) and `nextWithdrawalDate` from 14-day cooldown check.

---

### Action 1 — Set Up Payment Method

**Bank Transfer:**
- Required: Bank Name + Last 4 digits of account number
- Optional: Notes
- Validates: `bank_account_last4` must match `/^\d{4}$/`
- API rejects any body containing `account_number` or `full_account` field names

**Zelle:**
- Required: Zelle email OR phone last 4 (at least one)
- Email validated against email regex
- Phone last 4 must match `/^\d{4}$/`

**Stripe Connect (Automatic ACH):**
1. Creator clicks "Connect Stripe Account"
2. `POST /api/stripe/connect-url` creates a Stripe Express account
3. Server generates a Stripe-hosted onboarding link (expires in minutes)
4. Creator redirected to Stripe's KYC flow — bank details stored by Stripe, never by Omnya
5. After completion: Stripe redirects back to `/?page=earnings&stripe_connected=true`
6. `GET /api/stripe/connect-status` syncs capabilities
7. Stripe fires `account.updated` webhook → `creators.stripe_account_status = 'active'`

**Saved via:** `PATCH /api/creators/payment-method`
- Sets `payment_method_status = 'submitted'`
- Clears fields from previous method on switch
- Returns safe masked `destination_summary` only

---

### Action 2 — Submit Video View Counts

The Video Bonus Submission section shows all approved submissions with:

| Field | Source |
|---|---|
| Base Pay Status | $10 — `creator_earnings` status |
| Posted URL | Editable input |
| Posted Date | Date input |
| View Count | Number input (after 10-day mark) |
| Days Since Posting | Calculated in browser |
| Estimated Bonus | Calculated using `BONUS_TIERS` constant |
| Bonus Status | From `creator_earnings.status` |

**Bonus status display:**
- `"Waiting for 10-day mark"` — posted but < 10 days old
- `"Submit views"` — 10+ days but no view count entered
- `"Needs admin review"` — data submitted, awaiting admin
- `"Bonus approved — $X"` — admin approved
- `"Forfeited"` — admin forfeited
- `"Paid — $X"` — included in a paid batch

**Save button → `POST /api/creator/view-count`:**
1. Server verifies submission belongs to this creator
2. Validates URL, view count (≥ 0), posted date (not future)
3. `UPDATE submissions SET posted_url, posted_at, view_count_submitted, view_count_source = 'manual'`
4. If 10+ days old AND views > 0: `SET bonus_eligible = true`
5. Returns estimated bonus (server-calculated)

> **Note:** Submitting view counts does not directly create earnings. The `performance_bonus` earning row is created when the Owner runs **Recalculate Earnings**, which reads the submitted views.

---

### Action 3 — Request Withdrawal

**Button is enabled only when:**
1. `canRequestWithdrawal = true` (14-day cooldown passed)
2. `availableBalance > 0` (approved earnings exist)
3. Payment method is set and not `missing`

**When disabled, shows:**
- "Next eligible: June 13, 2026" — cooldown active
- "No available balance" — zero approved earnings
- "Set up your payment method first" — missing method

**On confirm → `POST /api/withdrawals/request`:**
1. Verifies role = `creator`
2. Gets creator record, validates payment method
3. Calls Postgres RPC `request_creator_withdrawal`:
   - Checks 14-day cooldown — returns `next_eligible_at` if blocked
   - SUMs approved earnings — rejects if $0
   - `INSERT withdrawal_requests` with full available balance
   - `UPDATE creator_earnings SET status = 'withdrawal_requested'` for all approved earnings
   - Audit log with `auth.uid()` as actor
4. Sends `withdrawal_requested` email to Owner/payment managers (fire-and-forget)

**After requesting:**
- Available Balance → $0
- Withdrawal Requested → full amount
- Request button disabled
- New entry in Withdrawal History with status `Pending`

**If approved:** Creator receives `withdrawal_approved` email; balance restored to Withdrawal Requested → moves to batch queue

**If rejected:** Creator receives `withdrawal_rejected` email with reason; all earnings returned to `approved`; 14-day cooldown resets; creator can request again immediately

**When paid:** Creator receives `payment_sent` email; balance appears under Total Paid; Stripe creators receive ACH in 2–3 business days

---

## Security Boundaries

| Action | Creator | Account Manager | Payment Manager | Owner |
|---|---|---|---|---|
| View own earnings | ✅ | N/A | ✅ | ✅ |
| View assigned creators' earnings | ❌ | ✅ | ✅ | ✅ |
| View all creators' earnings | ❌ | ❌ | ✅ | ✅ |
| Submit view counts | ✅ own only | ❌ | ❌ | ✅ any |
| Set payment method | ✅ own only | ❌ | ❌ | ✅ any |
| Request withdrawal | ✅ own only | ❌ | ❌ | ❌ |
| Approve / reject withdrawal | ❌ | ❌ | ✅ if granted | ✅ |
| Recalculate earnings | ❌ | ❌ | ❌ | ✅ |
| Approve / forfeit bonus | ❌ | ❌ | ❌ | ✅ |
| Create payout batch | ❌ | ❌ | ✅ if granted | ✅ |
| Export CSV | ❌ | ❌ | ✅ if granted | ✅ |
| Mark batch paid | ❌ | ❌ | ✅ if granted | ✅ |
| Manage payment managers | ❌ | ❌ | ❌ | ✅ |
| View payout batches | ❌ | ❌ | ✅ | ✅ |
| View audit logs | ❌ | ❌ | ❌ | ✅ |
| Store full bank account number | ❌ | ❌ | ❌ | ❌ |

Security is enforced at **two independent layers:**
1. **API layer** — JWT verification + `requirePaymentPermission` on every route
2. **Supabase RLS** — database-level policies block direct client access even if API is bypassed

---

## Payment Flow Diagrams

### Full Payout Lifecycle

```
Submission approved by admin
         │
         ▼
Owner clicks "Recalculate Earnings"
         │
         ├── base_video_pay: $10.00 → creator_earnings (status: approved)
         └── performance_bonus: $X  → creator_earnings (status: eligible)
                   │
                   ▼
         Admin reviews bonus (Bonus Review panel)
                   │
                   ├── Approve → status: approved (counts toward balance)
                   └── Forfeit (with reason) → status: forfeited
         │
         ▼
Creator sees Available Balance > $0
         │
Creator sets up payment method (Bank / Zelle / Stripe)
         │
         ▼
Creator clicks "Request Withdrawal"
         │
         ▼
Postgres RPC: request_creator_withdrawal
  ├── 14-day cooldown check → block if too soon
  ├── Balance check → block if $0
  ├── INSERT withdrawal_requests (status: pending_admin_approval)
  └── UPDATE creator_earnings → status: withdrawal_requested
         │
         ▼
Owner notified via email
         │
Owner opens Withdrawal Requests → Pending tab
         │
         ├── APPROVE
         │     ├── RPC: approve_withdrawal_request
         │     │     ├── UPDATE withdrawal_requests → approved
         │     │     └── INSERT payments (status: approved)
         │     └── Email → creator: "Your withdrawal was approved"
         │
         └── REJECT (with reason)
               ├── RPC: reject_withdrawal_request
               │     ├── UPDATE withdrawal_requests → rejected
               │     └── UPDATE creator_earnings → approved (balance restored)
               └── Email → creator: "Your withdrawal needs attention"
         │
         ▼ (if approved)
Owner selects approved requests → Create Batch
         │
         ▼
RPC: create_payout_batch
  ├── INSERT payout_batches (BATCH-20260601-001)
  ├── UPDATE withdrawal_requests → batched
  ├── UPDATE payments → batched
  └── UPDATE creator_earnings → batched
         │
         ▼
Owner exports CSV → makes Bank Transfer / Zelle payments manually
         │
         ▼
Owner clicks "Mark Paid"
         │
         ▼
RPC: mark_payout_batch_paid (SELECT FOR UPDATE — blocks double-payment)
  ├── UPDATE payout_batches → paid
  ├── UPDATE payments → paid
  ├── UPDATE withdrawal_requests → paid
  └── UPDATE creator_earnings → paid
         │
         ├── Stripe-method payments:
         │     stripe.transfers.create(amountCents, destination: stripe_account_id)
         │     → payments.status = 'processing'
         │     → Stripe fires transfer.paid webhook → payments.status = 'paid'
         │
         └── All creators → payment_sent email
```

### Stripe Connect Onboarding

```
Creator selects "Stripe" as payment method
         │
         ▼
POST /api/stripe/connect-url
  ├── stripe.accounts.create({ type: 'express' })   ← first time only
  └── stripe.accountLinks.create({ type: 'account_onboarding' })
         │
         ▼
Creator redirected to Stripe-hosted KYC
  (bank account linked, identity verified by Stripe)
         │
         ▼
Stripe redirects → /?page=earnings&stripe_connected=true
         │
         ▼
GET /api/stripe/connect-status (syncs capabilities)
         │
         ▼
Stripe fires account.updated webhook
  → creators.stripe_account_status = 'active'
  → stripe_charges_enabled = true
  → stripe_payouts_enabled = true
         │
         ▼
Creator's payment method is ready for automated payouts
```

---

## API Reference

### Earnings

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/api/earnings/summary` | Creator / AM / Owner | Balance totals, withdrawal eligibility, full earnings list |
| POST | `/api/earnings/recalculate` | Owner only | Scan approved submissions → create/update base pay and bonus earnings |

### Creator Actions

| Method | Route | Auth | Description |
|---|---|---|---|
| POST | `/api/creator/view-count` | Creator (own) / Owner | Submit posted URL, date, and view count for a video |
| PATCH | `/api/creators/payment-method` | Creator (own) / Owner | Save Bank Transfer or Zelle details |

### Withdrawals

| Method | Route | Auth | Description |
|---|---|---|---|
| POST | `/api/withdrawals/request` | Creator only | Request withdrawal via RPC |
| GET | `/api/withdrawals` | Role-scoped | List requests by status with pagination |
| POST | `/api/withdrawals/approve` | Owner / PM (approve) | Approve via RPC + send email |
| POST | `/api/withdrawals/reject` | Owner / PM (approve) | Reject via RPC + send email |

### Payout Batches

| Method | Route | Auth | Description |
|---|---|---|---|
| POST | `/api/payouts/create-batch` | Owner / PM (export) | Create batch via RPC |
| GET | `/api/payouts/export` | Owner / PM (export) | Download UTF-8 CSV with masked destinations |
| POST | `/api/payouts/mark-paid` | Owner / PM (mark_paid) | Mark paid via RPC + auto Stripe transfers + emails |
| POST | `/api/payouts/stripe-transfer` | Owner / PM (mark_paid) | Manually trigger or retry a single Stripe transfer |

### Stripe

| Method | Route | Auth | Description |
|---|---|---|---|
| POST | `/api/stripe/connect-url` | Creator / Owner | Generate Stripe Express onboarding URL |
| GET | `/api/stripe/connect-status` | Creator / Owner | Sync and return current Stripe account state |
| POST | `/api/stripe/webhook` | Stripe (signature-verified) | Handle account.updated, transfer.paid, transfer.failed |

### Admin Settings

| Method | Route | Auth | Description |
|---|---|---|---|
| POST | `/api/payment-managers/grant` | Owner only | Add or update payment manager permissions |
| POST | `/api/payment-managers/revoke` | Owner only | Soft-deactivate a payment manager |

---

## Email Notifications

All emails sent via Resend. All user-controlled fields are HTML-escaped before rendering.

| Type | Recipient | Trigger |
|---|---|---|
| `withdrawal_requested` | Owner + payment managers | Creator submits a withdrawal request |
| `withdrawal_approved` | Creator | Admin approves the request |
| `withdrawal_rejected` | Creator | Admin rejects with reason |
| `payment_sent` | Creator | Batch marked paid |
| `bonus_approved` | Creator | Admin approves a performance bonus |
| `bonus_forfeited` | Creator | Admin forfeits a bonus |
| `missing_payment_method` | Creator | Sent manually or on schedule |

---

## Stripe Connect Flow

### Creator Stripe Account States

| Status | Meaning |
|---|---|
| `not_connected` | Creator has not started onboarding |
| `onboarding` | Onboarding link generated, awaiting completion |
| `pending` | Submitted but Stripe still reviewing (typically 1–2 business days) |
| `active` | `charges_enabled AND payouts_enabled` — ready for transfers |
| `disabled` | Stripe disabled the account (compliance issue) |

### Webhook Events Handled

| Event | Action |
|---|---|
| `account.updated` | Sync `charges_enabled`, `payouts_enabled`, `details_submitted` to DB; update `stripe_account_status` |
| `transfer.paid` | Find payment by `stripe_transfer_id` → `status = 'paid'`, update `withdrawal_request` |
| `transfer.failed` | Find payment → `status = 'failed'`, store `stripe_transfer_error` |

### Stripe Payout Settings

- Payout schedule: **manual** — platform controls when funds are sent (no automatic Stripe-scheduled payouts)
- Account type: **Express** — Stripe handles KYC, creator manages their own dashboard
- Capability requested: **transfers** only
- Currency: **USD**

---

## Audit Trail

Every financial action writes to `payment_audit_logs`:

| Action | Triggered By |
|---|---|
| `withdrawal_requested` | Creator requests withdrawal |
| `withdrawal_approved` | Admin approves |
| `withdrawal_rejected` | Admin rejects |
| `batch_created` | Batch created from approved requests |
| `batch_exported` | CSV downloaded |
| `batch_marked_paid` | Batch finalized as paid |
| `stripe_transfer_initiated` | Stripe transfer triggered |
| `stripe_transfer_failed` | Stripe transfer failed |
| `payment_method_updated` | Creator updates payment method |
| `payment_manager_granted` | Owner grants permissions |
| `payment_manager_revoked` | Owner revokes permissions |

Logs include: `actor_user_id`, `action`, `entity_type`, `entity_id`, `metadata JSONB`, `created_at`

Only the Owner can read audit logs (RLS enforced).

---

## Environment Variables

```bash
# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Resend
RESEND_API_KEY=re_...

# Stripe (required for Stripe Connect payouts)
STRIPE_SECRET_KEY=sk_live_...        # use sk_test_... for testing
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app
```

---

## Production Checklist

### Database
- [ ] Run `20260530000000_payout_system.sql` in Supabase SQL Editor
- [ ] Run `20260530000001_payout_rpc_functions.sql` in Supabase SQL Editor
- [ ] Run `20260530000002_stripe_connect.sql` in Supabase SQL Editor
- [ ] Reload Supabase schema cache (API → Reload schema)
- [ ] Verify `get_my_payout_role()` returns correct role values for your `user_profiles` table

### Stripe
- [ ] Enable Stripe Connect in Stripe dashboard → choose Express
- [ ] Set platform name and branding in Stripe Connect settings
- [ ] Add redirect URL: `https://your-app.vercel.app/?page=earnings&stripe_connected=true`
- [ ] Create webhook endpoint: `https://your-app.vercel.app/api/stripe/webhook`
- [ ] Select events: `account.updated`, `transfer.paid`, `transfer.failed`
- [ ] Copy webhook signing secret → set as `STRIPE_WEBHOOK_SECRET`

### Vercel
- [ ] Set `STRIPE_SECRET_KEY` environment variable
- [ ] Set `STRIPE_WEBHOOK_SECRET` environment variable
- [ ] Set `NEXT_PUBLIC_APP_URL` environment variable
- [ ] Deploy: `git push origin main`

### First-Run
- [ ] Log in as Owner → Payment Management → Recalculate Earnings
- [ ] Review any bonus earnings that need approval
- [ ] Notify creators to add payment methods

### Smoke Test
- [ ] Creator adds Zelle payment method → status shows "Submitted"
- [ ] Owner runs Recalculate → $10 base pay appears for approved videos
- [ ] Creator requests withdrawal → appears in Pending tab
- [ ] Owner approves → creator receives email → appears in Approved tab
- [ ] Owner creates batch from approved requests → batch appears
- [ ] Owner exports CSV → file downloads with masked destinations
- [ ] Owner marks batch paid → creator receives payment email
- [ ] (Stripe) Creator connects Stripe → status shows Active
- [ ] (Stripe) Owner marks Stripe-method batch paid → transfer fires → status moves to processing
