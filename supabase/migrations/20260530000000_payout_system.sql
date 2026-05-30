-- ============================================================================
-- MIGRATION: 20260530000000_payout_system.sql
-- Omnya Portal — Payout System
-- ============================================================================
--
-- Introduces the full creator payout system:
--   • Payment method fields on creators
--   • Video bonus fields on submissions
--   • Rebuilt payout_batches (new columns added idempotently)
--   • creator_earnings — per-submission earnings ledger
--   • withdrawal_requests — creator-initiated cash-out requests
--   • Rebuilt payments table (new columns added idempotently)
--   • payment_managers — delegated payout permission table
--   • payment_audit_logs — immutable audit trail
--   • Indexes, updated_at triggers, RLS, and helper functions
--
-- Safety rules applied throughout:
--   • ADD COLUMN IF NOT EXISTS — never re-adds existing columns
--   • CREATE TABLE IF NOT EXISTS — never fails on re-run
--   • CREATE INDEX IF NOT EXISTS — idempotent
--   • CREATE SEQUENCE IF NOT EXISTS — idempotent
--   • DROP POLICY IF EXISTS before CREATE POLICY — idempotent
--   • CREATE OR REPLACE FUNCTION — idempotent
--   • No DROP COLUMN, no DELETE of existing data
--   • FK dependency order: payout_batches exists before withdrawal_requests
--     and payments reference it
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1 — creators: payment method fields
-- ============================================================================

ALTER TABLE public.creators
    ADD COLUMN IF NOT EXISTS payment_method               TEXT,
    ADD COLUMN IF NOT EXISTS payment_handle               TEXT,
    ADD COLUMN IF NOT EXISTS payment_email                TEXT,
    ADD COLUMN IF NOT EXISTS bank_name                    TEXT,
    ADD COLUMN IF NOT EXISTS bank_account_last4           TEXT,
    ADD COLUMN IF NOT EXISTS bank_transfer_notes          TEXT,
    ADD COLUMN IF NOT EXISTS zelle_email                  TEXT,
    ADD COLUMN IF NOT EXISTS zelle_phone_last4            TEXT,
    ADD COLUMN IF NOT EXISTS payment_method_status        TEXT DEFAULT 'missing',
    ADD COLUMN IF NOT EXISTS payment_method_updated_at    TIMESTAMPTZ;

-- ============================================================================
-- SECTION 2 — submissions: video bonus fields
-- ============================================================================

ALTER TABLE public.submissions
    ADD COLUMN IF NOT EXISTS posted_url                   TEXT,
    ADD COLUMN IF NOT EXISTS posted_at                    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS view_count_submitted         INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS view_count_verified          INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS view_count_source            TEXT DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS view_count_updated_at        TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS bonus_snapshot_at            TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS bonus_locked                 BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS bonus_eligible               BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS bonus_forfeited              BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS bonus_forfeit_reason         TEXT;

-- ============================================================================
-- SECTION 3 — payout_batches: sequence + new columns
-- ============================================================================
-- The table already exists. We add missing columns idempotently and create
-- the batch_number sequence used to generate human-readable identifiers.

CREATE SEQUENCE IF NOT EXISTS public.batch_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

-- Columns added by earlier migrations (period_type) are skipped automatically
-- via IF NOT EXISTS.
ALTER TABLE public.payout_batches
    ADD COLUMN IF NOT EXISTS batch_number       TEXT,
    ADD COLUMN IF NOT EXISTS currency           TEXT DEFAULT 'USD',
    ADD COLUMN IF NOT EXISTS total_creators     INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_payments     INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS generated_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS generated_at       TIMESTAMPTZ DEFAULT now(),
    ADD COLUMN IF NOT EXISTS exported_at        TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS approved_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS approved_at        TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS marked_paid_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS marked_paid_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS notes              TEXT,
    ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ DEFAULT now();

-- Unique constraint on batch_number (applied only if it does not yet exist).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM   pg_constraint
        WHERE  conname  = 'payout_batches_batch_number_unique'
          AND  conrelid = 'public.payout_batches'::regclass
    ) THEN
        -- Exclude existing NULL batch_numbers from the uniqueness check.
        ALTER TABLE public.payout_batches
            ADD CONSTRAINT payout_batches_batch_number_unique UNIQUE (batch_number);
    END IF;
END
$$;

-- ============================================================================
-- SECTION 4 — creator_earnings (new table)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.creator_earnings (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id      UUID        NOT NULL REFERENCES public.creators(id) ON DELETE CASCADE,
    campaign_id     UUID        REFERENCES public.campaigns(id) ON DELETE SET NULL,
    submission_id   UUID        REFERENCES public.submissions(id) ON DELETE SET NULL,
    earning_type    TEXT        NOT NULL,
    amount          NUMERIC(12,2) NOT NULL,
    currency        TEXT        DEFAULT 'USD',
    status          TEXT        DEFAULT 'pending',
    description     TEXT,
    views_counted   INTEGER     DEFAULT 0,
    bonus_tier      TEXT,
    eligible_at     TIMESTAMPTZ,
    locked_at       TIMESTAMPTZ,
    approved_at     TIMESTAMPTZ,
    approved_by     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT creator_earnings_earning_type_check CHECK (
        earning_type IN (
            'base_video_pay',
            'performance_bonus',
            'weekly_rate',
            'adjustment',
            'bonus',
            'other'
        )
    ),
    CONSTRAINT creator_earnings_status_check CHECK (
        status IN (
            'pending',
            'needs_review',
            'eligible',
            'locked',
            'approved',
            'withdrawal_requested',
            'batched',
            'paid',
            'forfeited',
            'cancelled'
        )
    ),
    CONSTRAINT creator_earnings_amount_non_negative CHECK (amount >= 0)
);

-- Partial unique indexes prevent duplicate base-pay or bonus rows per submission.
CREATE UNIQUE INDEX IF NOT EXISTS creator_earnings_base_pay_per_submission
    ON public.creator_earnings (submission_id)
    WHERE earning_type = 'base_video_pay'
      AND submission_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS creator_earnings_bonus_per_submission
    ON public.creator_earnings (submission_id)
    WHERE earning_type = 'performance_bonus'
      AND submission_id IS NOT NULL;

-- ============================================================================
-- SECTION 5 — withdrawal_requests (new table)
-- ============================================================================
-- Depends on payout_batches (FK); payout_batches already exists above.

CREATE TABLE IF NOT EXISTS public.withdrawal_requests (
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id                  UUID        NOT NULL REFERENCES public.creators(id) ON DELETE CASCADE,
    amount                      NUMERIC(12,2) NOT NULL,
    currency                    TEXT        DEFAULT 'USD',
    status                      TEXT        DEFAULT 'pending_admin_approval',
    payment_method              TEXT        NOT NULL,
    payment_destination_summary TEXT,
    requested_at                TIMESTAMPTZ DEFAULT now(),
    approved_at                 TIMESTAMPTZ,
    approved_by                 UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
    rejected_at                 TIMESTAMPTZ,
    rejected_by                 UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
    rejection_reason            TEXT,
    batch_id                    UUID        REFERENCES public.payout_batches(id) ON DELETE SET NULL,
    paid_at                     TIMESTAMPTZ,
    marked_paid_by              UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
    admin_notes                 TEXT,
    created_at                  TIMESTAMPTZ DEFAULT now(),
    updated_at                  TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT withdrawal_requests_amount_positive    CHECK (amount > 0),
    CONSTRAINT withdrawal_requests_currency_usd_only  CHECK (currency = 'USD'),
    CONSTRAINT withdrawal_requests_status_check       CHECK (
        status IN (
            'pending_admin_approval',
            'approved',
            'rejected',
            'batched',
            'paid',
            'cancelled'
        )
    )
);

-- ============================================================================
-- SECTION 6 — payments: add missing columns (table already exists)
-- ============================================================================
-- The payments table exists from earlier migrations. We add the new payout-
-- system columns idempotently. Pre-existing columns (creator_id, campaign_id,
-- submission_id, week_ending, videos_approved, amount_owed, status,
-- payment_method, paid_date, created_at, batch_id) are untouched.

ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS withdrawal_request_id      UUID REFERENCES public.withdrawal_requests(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS amount                     NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS currency                   TEXT DEFAULT 'USD',
    ADD COLUMN IF NOT EXISTS payment_reference          TEXT,
    ADD COLUMN IF NOT EXISTS payment_destination_summary TEXT,
    ADD COLUMN IF NOT EXISTS processed_by               UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS processed_at               TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS notes                      TEXT,
    ADD COLUMN IF NOT EXISTS updated_at                 TIMESTAMPTZ DEFAULT now();

-- Add status CHECK constraint only if not yet present.
-- Note: existing data may contain mixed-case values ('Pending', 'Paid') from
-- earlier code. The CHECK is intentionally lenient: add casing normalisation
-- in a follow-up migration once the API has been updated.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM   pg_constraint
        WHERE  conname  = 'payments_status_payout_check'
          AND  conrelid = 'public.payments'::regclass
    ) THEN
        -- Only add the CHECK if every existing row already conforms.
        -- This prevents a migration failure on a production database that
        -- contains legacy cased values.
        IF NOT EXISTS (
            SELECT 1 FROM public.payments
            WHERE status IS NOT NULL
              AND status NOT IN (
                    'pending', 'approved', 'batched',
                    'processing', 'paid', 'failed', 'cancelled'
                  )
        ) THEN
            ALTER TABLE public.payments
                ADD CONSTRAINT payments_status_payout_check CHECK (
                    status IN (
                        'pending', 'approved', 'batched',
                        'processing', 'paid', 'failed', 'cancelled'
                    )
                );
        END IF;
    END IF;
END
$$;

-- ============================================================================
-- SECTION 7 — payment_managers (new table)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.payment_managers (
    id                      UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID    NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    granted_by              UUID    REFERENCES auth.users(id) ON DELETE SET NULL,
    can_view_payouts        BOOLEAN DEFAULT true,
    can_approve_withdrawals BOOLEAN DEFAULT true,
    can_export_batches      BOOLEAN DEFAULT true,
    can_mark_paid           BOOLEAN DEFAULT false,
    active                  BOOLEAN DEFAULT true,
    created_at              TIMESTAMPTZ DEFAULT now(),
    updated_at              TIMESTAMPTZ DEFAULT now()
);

-- ============================================================================
-- SECTION 8 — payment_audit_logs (new table)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.payment_audit_logs (
    id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id  UUID    REFERENCES auth.users(id) ON DELETE SET NULL,
    action         TEXT    NOT NULL,
    entity_type    TEXT    NOT NULL,
    entity_id      UUID,
    metadata       JSONB   DEFAULT '{}',
    created_at     TIMESTAMPTZ DEFAULT now()
);

-- ============================================================================
-- SECTION 9 — Indexes
-- ============================================================================

-- creator_earnings
CREATE INDEX IF NOT EXISTS idx_creator_earnings_creator_id
    ON public.creator_earnings (creator_id);

CREATE INDEX IF NOT EXISTS idx_creator_earnings_status
    ON public.creator_earnings (status);

CREATE INDEX IF NOT EXISTS idx_creator_earnings_submission_id
    ON public.creator_earnings (submission_id);

CREATE INDEX IF NOT EXISTS idx_creator_earnings_campaign_id
    ON public.creator_earnings (campaign_id);

-- withdrawal_requests
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_creator_id
    ON public.withdrawal_requests (creator_id);

CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status
    ON public.withdrawal_requests (status);

CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_batch_id
    ON public.withdrawal_requests (batch_id);

-- payments
CREATE INDEX IF NOT EXISTS idx_payments_creator_id_payout
    ON public.payments (creator_id);

CREATE INDEX IF NOT EXISTS idx_payments_status_payout
    ON public.payments (status);

CREATE INDEX IF NOT EXISTS idx_payments_batch_id_payout
    ON public.payments (batch_id);

CREATE INDEX IF NOT EXISTS idx_payments_withdrawal_request_id
    ON public.payments (withdrawal_request_id);

-- payout_batches
CREATE INDEX IF NOT EXISTS idx_payout_batches_status
    ON public.payout_batches (status);

-- payment_audit_logs
CREATE INDEX IF NOT EXISTS idx_payment_audit_logs_actor_user_id
    ON public.payment_audit_logs (actor_user_id);

CREATE INDEX IF NOT EXISTS idx_payment_audit_logs_entity_id
    ON public.payment_audit_logs (entity_id);

CREATE INDEX IF NOT EXISTS idx_payment_audit_logs_action
    ON public.payment_audit_logs (action);

-- ============================================================================
-- SECTION 10 — updated_at trigger function and application
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

REVOKE ALL  ON FUNCTION public.set_updated_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO service_role;

-- creator_earnings
DROP TRIGGER IF EXISTS trg_creator_earnings_updated_at ON public.creator_earnings;
CREATE TRIGGER trg_creator_earnings_updated_at
    BEFORE UPDATE ON public.creator_earnings
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- withdrawal_requests
DROP TRIGGER IF EXISTS trg_withdrawal_requests_updated_at ON public.withdrawal_requests;
CREATE TRIGGER trg_withdrawal_requests_updated_at
    BEFORE UPDATE ON public.withdrawal_requests
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- payments
DROP TRIGGER IF EXISTS trg_payments_updated_at ON public.payments;
CREATE TRIGGER trg_payments_updated_at
    BEFORE UPDATE ON public.payments
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- payout_batches
DROP TRIGGER IF EXISTS trg_payout_batches_updated_at ON public.payout_batches;
CREATE TRIGGER trg_payout_batches_updated_at
    BEFORE UPDATE ON public.payout_batches
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- payment_managers
DROP TRIGGER IF EXISTS trg_payment_managers_updated_at ON public.payment_managers;
CREATE TRIGGER trg_payment_managers_updated_at
    BEFORE UPDATE ON public.payment_managers
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- SECTION 11 — Enable RLS on all new / updated tables
-- ============================================================================

ALTER TABLE public.creator_earnings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_batches       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_managers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_audit_logs   ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- SECTION 12 — RLS helper functions
-- ============================================================================

-- ---------------------------------------------------------------------------
-- get_my_payout_role()
-- Returns the normalized role for the calling user, read from user_profiles.
-- Reuses the same normalization logic as current_user_role() to stay
-- consistent. Kept as a separate function so payout policies are self-
-- contained and can be read in isolation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_payout_role()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT
        CASE
            WHEN role = 'account_manager' THEN 'am'
            ELSE role
        END
    FROM public.user_profiles
    WHERE id = auth.uid();
$$;

REVOKE ALL  ON FUNCTION public.get_my_payout_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_payout_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_payout_role() TO service_role;

COMMENT ON FUNCTION public.get_my_payout_role() IS
    'Returns the normalized role (account_manager -> am) for the calling user '
    'from user_profiles. Used by payout-system RLS policies.';

-- ---------------------------------------------------------------------------
-- is_payment_manager(p_permission TEXT)
-- Returns TRUE when the calling user has an active payment_managers row and
-- the specified boolean permission column is TRUE.
-- p_permission must be one of: can_view_payouts, can_approve_withdrawals,
--   can_export_batches, can_mark_paid.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_payment_manager(p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
    v_result BOOLEAN := false;
BEGIN
    -- Guard: only allow known column names to prevent SQL injection via the
    -- function parameter.
    IF p_permission NOT IN (
        'can_view_payouts',
        'can_approve_withdrawals',
        'can_export_batches',
        'can_mark_paid'
    ) THEN
        RETURN false;
    END IF;

    EXECUTE format(
        'SELECT %I FROM public.payment_managers WHERE user_id = $1 AND active = true',
        p_permission
    )
    INTO v_result
    USING auth.uid();

    RETURN coalesce(v_result, false);
END;
$$;

REVOKE ALL  ON FUNCTION public.is_payment_manager(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_payment_manager(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_payment_manager(TEXT) TO service_role;

COMMENT ON FUNCTION public.is_payment_manager(TEXT) IS
    'Returns TRUE if the calling user has an active payment_managers row with '
    'the given boolean permission set to TRUE. Allowed values for p_permission: '
    'can_view_payouts, can_approve_withdrawals, can_export_batches, can_mark_paid.';

-- ============================================================================
-- SECTION 13 — RLS policies
-- ============================================================================
-- Pattern: DROP IF EXISTS then CREATE (idempotent).
-- Scoping tiers used throughout:
--   owner  — role = 'owner' (full access)
--   am     — role IN ('am','account_manager'), scoped to their creators
--   creator — role = 'creator', scoped to their own creators row via user_id
--   PM     — is_payment_manager(permission) = true
-- ---------------------------------------------------------------------------

-- ============================================================================
-- 13a. creator_earnings
-- ============================================================================

-- Creator sees their own earnings (creators.user_id = auth.uid()).
DROP POLICY IF EXISTS creator_earnings_creator_select ON public.creator_earnings;
CREATE POLICY creator_earnings_creator_select ON public.creator_earnings
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.creators cr
            WHERE cr.id = creator_earnings.creator_id
              AND cr.user_id = auth.uid()
        )
    );

-- AM sees earnings for creators assigned to them.
DROP POLICY IF EXISTS creator_earnings_am_select ON public.creator_earnings;
CREATE POLICY creator_earnings_am_select ON public.creator_earnings
    FOR SELECT
    TO authenticated
    USING (
        get_my_payout_role() IN ('am', 'account_manager')
        AND EXISTS (
            SELECT 1 FROM public.creators cr
            JOIN public.account_managers am ON cr.am_id = am.id
            WHERE cr.id = creator_earnings.creator_id
              AND am.user_id = auth.uid()
        )
    );

-- Owner and payment managers (with view permission) see all.
DROP POLICY IF EXISTS creator_earnings_owner_pm_select ON public.creator_earnings;
CREATE POLICY creator_earnings_owner_pm_select ON public.creator_earnings
    FOR SELECT
    TO authenticated
    USING (
        get_my_payout_role() = 'owner'
        OR is_payment_manager('can_view_payouts')
    );

-- Only owner can insert / update / delete earnings records.
DROP POLICY IF EXISTS creator_earnings_owner_insert ON public.creator_earnings;
CREATE POLICY creator_earnings_owner_insert ON public.creator_earnings
    FOR INSERT
    TO authenticated
    WITH CHECK (get_my_payout_role() = 'owner');

DROP POLICY IF EXISTS creator_earnings_owner_update ON public.creator_earnings;
CREATE POLICY creator_earnings_owner_update ON public.creator_earnings
    FOR UPDATE
    TO authenticated
    USING  (get_my_payout_role() = 'owner')
    WITH CHECK (get_my_payout_role() = 'owner');

DROP POLICY IF EXISTS creator_earnings_owner_delete ON public.creator_earnings;
CREATE POLICY creator_earnings_owner_delete ON public.creator_earnings
    FOR DELETE
    TO authenticated
    USING (get_my_payout_role() = 'owner');

-- ============================================================================
-- 13b. withdrawal_requests
-- ============================================================================

-- Creator sees their own withdrawal requests.
DROP POLICY IF EXISTS withdrawal_requests_creator_select ON public.withdrawal_requests;
CREATE POLICY withdrawal_requests_creator_select ON public.withdrawal_requests
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.creators cr
            WHERE cr.id = withdrawal_requests.creator_id
              AND cr.user_id = auth.uid()
        )
    );

-- Creator can create their own withdrawal request.
DROP POLICY IF EXISTS withdrawal_requests_creator_insert ON public.withdrawal_requests;
CREATE POLICY withdrawal_requests_creator_insert ON public.withdrawal_requests
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.creators cr
            WHERE cr.id = withdrawal_requests.creator_id
              AND cr.user_id = auth.uid()
        )
        AND get_my_payout_role() = 'creator'
    );

-- Creator can cancel only their own pending request.
DROP POLICY IF EXISTS withdrawal_requests_creator_cancel ON public.withdrawal_requests;
CREATE POLICY withdrawal_requests_creator_cancel ON public.withdrawal_requests
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.creators cr
            WHERE cr.id = withdrawal_requests.creator_id
              AND cr.user_id = auth.uid()
        )
        AND get_my_payout_role() = 'creator'
        AND status = 'pending_admin_approval'
    )
    WITH CHECK (
        status = 'cancelled'
    );

-- AM sees withdrawal requests for their assigned creators.
DROP POLICY IF EXISTS withdrawal_requests_am_select ON public.withdrawal_requests;
CREATE POLICY withdrawal_requests_am_select ON public.withdrawal_requests
    FOR SELECT
    TO authenticated
    USING (
        get_my_payout_role() IN ('am', 'account_manager')
        AND EXISTS (
            SELECT 1 FROM public.creators cr
            JOIN public.account_managers am ON cr.am_id = am.id
            WHERE cr.id = withdrawal_requests.creator_id
              AND am.user_id = auth.uid()
        )
    );

-- Owner and payment managers (with view permission) see all.
DROP POLICY IF EXISTS withdrawal_requests_owner_pm_select ON public.withdrawal_requests;
CREATE POLICY withdrawal_requests_owner_pm_select ON public.withdrawal_requests
    FOR SELECT
    TO authenticated
    USING (
        get_my_payout_role() = 'owner'
        OR is_payment_manager('can_view_payouts')
    );

-- Owner (and PM with approve permission) can insert / update.
DROP POLICY IF EXISTS withdrawal_requests_owner_pm_insert ON public.withdrawal_requests;
CREATE POLICY withdrawal_requests_owner_pm_insert ON public.withdrawal_requests
    FOR INSERT
    TO authenticated
    WITH CHECK (
        get_my_payout_role() = 'owner'
        OR is_payment_manager('can_approve_withdrawals')
    );

DROP POLICY IF EXISTS withdrawal_requests_owner_pm_update ON public.withdrawal_requests;
CREATE POLICY withdrawal_requests_owner_pm_update ON public.withdrawal_requests
    FOR UPDATE
    TO authenticated
    USING (
        get_my_payout_role() = 'owner'
        OR is_payment_manager('can_approve_withdrawals')
    )
    WITH CHECK (
        get_my_payout_role() = 'owner'
        OR is_payment_manager('can_approve_withdrawals')
    );

-- Only owner can delete.
DROP POLICY IF EXISTS withdrawal_requests_owner_delete ON public.withdrawal_requests;
CREATE POLICY withdrawal_requests_owner_delete ON public.withdrawal_requests
    FOR DELETE
    TO authenticated
    USING (get_my_payout_role() = 'owner');

-- ============================================================================
-- 13c. payments
-- ============================================================================

-- Creator sees their own payments.
DROP POLICY IF EXISTS payments_creator_select ON public.payments;
CREATE POLICY payments_creator_select ON public.payments
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.creators cr
            WHERE cr.id = payments.creator_id
              AND cr.user_id = auth.uid()
        )
    );

-- AM sees payments for their assigned creators.
DROP POLICY IF EXISTS payments_am_select ON public.payments;
CREATE POLICY payments_am_select ON public.payments
    FOR SELECT
    TO authenticated
    USING (
        get_my_payout_role() IN ('am', 'account_manager')
        AND EXISTS (
            SELECT 1 FROM public.creators cr
            JOIN public.account_managers am ON cr.am_id = am.id
            WHERE cr.id = payments.creator_id
              AND am.user_id = auth.uid()
        )
    );

-- Owner and payment managers (with view permission) see all.
DROP POLICY IF EXISTS payments_owner_pm_select ON public.payments;
CREATE POLICY payments_owner_pm_select ON public.payments
    FOR SELECT
    TO authenticated
    USING (
        get_my_payout_role() = 'owner'
        OR is_payment_manager('can_view_payouts')
    );

-- Owner and payment managers (with export permission) can insert.
DROP POLICY IF EXISTS payments_owner_pm_insert ON public.payments;
CREATE POLICY payments_owner_pm_insert ON public.payments
    FOR INSERT
    TO authenticated
    WITH CHECK (
        get_my_payout_role() = 'owner'
        OR is_payment_manager('can_export_batches')
    );

-- Owner and payment managers (with mark-paid permission) can update.
DROP POLICY IF EXISTS payments_owner_pm_update ON public.payments;
CREATE POLICY payments_owner_pm_update ON public.payments
    FOR UPDATE
    TO authenticated
    USING (
        get_my_payout_role() = 'owner'
        OR is_payment_manager('can_mark_paid')
    )
    WITH CHECK (
        get_my_payout_role() = 'owner'
        OR is_payment_manager('can_mark_paid')
    );

-- Only owner can delete payments.
DROP POLICY IF EXISTS payments_owner_delete ON public.payments;
CREATE POLICY payments_owner_delete ON public.payments
    FOR DELETE
    TO authenticated
    USING (get_my_payout_role() = 'owner');

-- ============================================================================
-- 13d. payout_batches
-- ============================================================================

-- Owner and payment managers (with view permission) can read batches.
DROP POLICY IF EXISTS payout_batches_owner_pm_select ON public.payout_batches;
CREATE POLICY payout_batches_owner_pm_select ON public.payout_batches
    FOR SELECT
    TO authenticated
    USING (
        get_my_payout_role() = 'owner'
        OR is_payment_manager('can_view_payouts')
    );

-- Owner (or PM with export permission) can create batches.
DROP POLICY IF EXISTS payout_batches_owner_pm_insert ON public.payout_batches;
CREATE POLICY payout_batches_owner_pm_insert ON public.payout_batches
    FOR INSERT
    TO authenticated
    WITH CHECK (
        get_my_payout_role() = 'owner'
        OR is_payment_manager('can_export_batches')
    );

-- Owner (or PM with mark-paid permission) can update batches.
DROP POLICY IF EXISTS payout_batches_owner_pm_update ON public.payout_batches;
CREATE POLICY payout_batches_owner_pm_update ON public.payout_batches
    FOR UPDATE
    TO authenticated
    USING (
        get_my_payout_role() = 'owner'
        OR is_payment_manager('can_mark_paid')
    )
    WITH CHECK (
        get_my_payout_role() = 'owner'
        OR is_payment_manager('can_mark_paid')
    );

-- Only owner can delete batches.
DROP POLICY IF EXISTS payout_batches_owner_delete ON public.payout_batches;
CREATE POLICY payout_batches_owner_delete ON public.payout_batches
    FOR DELETE
    TO authenticated
    USING (get_my_payout_role() = 'owner');

-- ============================================================================
-- 13e. payment_managers
-- ============================================================================

-- Users can see their own row (to know what they are allowed to do in the UI).
DROP POLICY IF EXISTS payment_managers_self_select ON public.payment_managers;
CREATE POLICY payment_managers_self_select ON public.payment_managers
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

-- Owner sees all rows.
DROP POLICY IF EXISTS payment_managers_owner_select ON public.payment_managers;
CREATE POLICY payment_managers_owner_select ON public.payment_managers
    FOR SELECT
    TO authenticated
    USING (get_my_payout_role() = 'owner');

-- Only owner can grant, revoke, or modify payment manager records.
DROP POLICY IF EXISTS payment_managers_owner_insert ON public.payment_managers;
CREATE POLICY payment_managers_owner_insert ON public.payment_managers
    FOR INSERT
    TO authenticated
    WITH CHECK (get_my_payout_role() = 'owner');

DROP POLICY IF EXISTS payment_managers_owner_update ON public.payment_managers;
CREATE POLICY payment_managers_owner_update ON public.payment_managers
    FOR UPDATE
    TO authenticated
    USING  (get_my_payout_role() = 'owner')
    WITH CHECK (get_my_payout_role() = 'owner');

DROP POLICY IF EXISTS payment_managers_owner_delete ON public.payment_managers;
CREATE POLICY payment_managers_owner_delete ON public.payment_managers
    FOR DELETE
    TO authenticated
    USING (get_my_payout_role() = 'owner');

-- ============================================================================
-- 13f. payment_audit_logs
-- ============================================================================

-- Only owner can read audit logs.
DROP POLICY IF EXISTS payment_audit_logs_owner_select ON public.payment_audit_logs;
CREATE POLICY payment_audit_logs_owner_select ON public.payment_audit_logs
    FOR SELECT
    TO authenticated
    USING (get_my_payout_role() = 'owner');

-- Insert is done server-side (service_role); deny all authenticated inserts
-- so logs cannot be fabricated by client-side code.
-- No INSERT / UPDATE / DELETE policies for authenticated role intentionally.

COMMIT;

-- ============================================================================
-- Regression verification (run manually in Supabase SQL editor):
-- ============================================================================
--
-- 1. Confirm new creator columns exist:
--      SELECT column_name FROM information_schema.columns
--      WHERE table_name = 'creators' AND column_name = 'payment_method';
--
-- 2. Confirm creator_earnings partial unique indexes:
--      SELECT indexname FROM pg_indexes
--      WHERE tablename = 'creator_earnings'
--        AND indexname LIKE 'creator_earnings_%_per_submission';
--
-- 3. Confirm payout_batches batch_number sequence:
--      SELECT nextval('public.batch_number_seq');
--
-- 4. Confirm RLS is on:
--      SELECT tablename, rowsecurity FROM pg_tables
--      WHERE tablename IN (
--          'creator_earnings','withdrawal_requests','payments',
--          'payout_batches','payment_managers','payment_audit_logs'
--      );
--
-- 5. As a creator user, confirm they cannot read another creator's earnings:
--      SET LOCAL role = authenticated;
--      SET LOCAL "request.jwt.claims" = '{"sub":"<other-creator-auth-uid>"}';
--      SELECT count(*) FROM public.creator_earnings;  -- should return 0
-- ============================================================================
