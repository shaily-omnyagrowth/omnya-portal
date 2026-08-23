-- ============================================================================
-- MIGRATION: 20260823000000_owner_lifecycle_controls.sql
-- Omnya Portal — owner lifecycle controls: deactivate, restore, archive, audit
-- ============================================================================
--
-- WHAT THIS CLOSES
--
-- The scope baseline grants the owner a set of controls over records that
-- already exist. Almost none of them were built, and the two that were are
-- built the wrong way round:
--
--   §6.1   "Create, view, edit, deactivate/delete and restore users according
--          to data-retention policy."
--   §7.1   "Campaign closes or archives while preserving history, financial
--          links and audit records."
--   §9.5   "No hard deletion of financial records."
--   §11.1  "Soft deletion or inactive states apply where historical records
--          must remain referentially intact."
--   §5.1   "Sensitive actions -- role changes, deletions, approvals,
--          rejections, batch creation and payment marking -- generate audit
--          events."
--   §5.2   Owner: "View audit history: Yes".
--
-- The word that settles the mechanism is §6.1's own: "deactivate/delete AND
-- RESTORE". A hard-deleted row cannot be restored. So "delete" here has always
-- meant a reversible state change, and this migration makes that the only
-- thing it can be.
--
--
-- WHY THE AUDIT IS WRITTEN BY TRIGGER
--
-- payment_audit_logs is written by the API layer, which works because every
-- money action goes through /api/*. Archive and deactivate do not: the owner
-- has UPDATE on these tables through RLS and the browser writes them directly.
-- An API-layer audit would therefore record only the actions that happened to
-- go through an endpoint, which is worse than none -- it would look complete.
--
-- Triggers capture auth.uid() regardless of who wrote the row or how, which
-- includes an UPDATE typed into the SQL editor at 2am. Same reasoning as the
-- payout_ledger in 20260822000004.
--
--
-- WHAT IS DELIBERATELY NOT HERE
--
-- No retention period, and no purge job. §6.1 makes the owner's delete
-- conditional on a data-retention policy, and Appendix C lists that policy as
-- an open decision. This migration therefore implements the reversible half --
-- which is safe under every possible retention answer -- and leaves erasure
-- alone until somebody decides the rule. deactivated_at gives a future purge
-- job the timestamp it will need.
--
-- Rollback: 20260823000000_owner_lifecycle_controls.rollback.sql
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 0 — preconditions
-- ============================================================================

DO $$
BEGIN
    IF to_regprocedure('public.current_user_role()') IS NULL THEN
        RAISE EXCEPTION
            'public.current_user_role() is missing. Apply 20260521000000_omnya_hardening.sql first.';
    END IF;
END;
$$;


-- ============================================================================
-- SECTION 1 — admin_audit_logs
--
-- The non-financial complement to payment_audit_logs. Same shape on purpose,
-- so the two can be UNIONed into one history view without translation.
--
-- Append-only, enforced the same three ways as payout_ledger: no UPDATE/DELETE
-- grant, a trigger that raises, and no policy that permits either.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    actor_user_id UUID,
    actor_role    TEXT,

    action        TEXT NOT NULL,
    entity_type   TEXT NOT NULL,
    entity_id     UUID,

    -- Denormalised so the row stays readable if the target is later archived
    -- or its label changes.
    entity_label  TEXT,

    from_value    TEXT,
    to_value      TEXT,
    reason        TEXT,

    metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.admin_audit_logs IS
    'Append-only journal of sensitive non-financial actions (§5.1): role '
    'changes, deactivation, restoration, archiving and content review '
    'decisions. Written by trigger, never by application code, so a direct '
    'UPDATE is recorded too. payment_audit_logs covers the money path.';

CREATE INDEX IF NOT EXISTS idx_admin_audit_occurred
    ON public.admin_audit_logs (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_entity
    ON public.admin_audit_logs (entity_type, entity_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_actor
    ON public.admin_audit_logs (actor_user_id, occurred_at DESC);


CREATE OR REPLACE FUNCTION public.admin_audit_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'admin_audit_logs is append-only: % is not permitted on entry %.',
        TG_OP, coalesce(OLD.id::text, '(unknown)');
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_audit_immutable ON public.admin_audit_logs;
CREATE TRIGGER trg_admin_audit_immutable
    BEFORE UPDATE OR DELETE ON public.admin_audit_logs
    FOR EACH ROW EXECUTE FUNCTION public.admin_audit_immutable();

REVOKE UPDATE, DELETE ON public.admin_audit_logs FROM PUBLIC, anon, authenticated;


-- Helper: one place that knows how to append. SECURITY DEFINER so the trigger
-- can write even when the caller has no direct INSERT right on the table.
--
-- p_actor exists because auth.uid() is NULL for a service-role connection, and
-- every api/admin/* route uses one. Without the override, an action taken
-- through an endpoint would be recorded with no actor at all -- which is worse
-- than not recording it, because the row looks complete. The endpoints
-- therefore stamp the actor onto the row they are updating (deactivated_by,
-- archived_by, voided_by, role_changed_by) and each trigger passes that column
-- through here as the fallback.
--
-- auth.uid() still wins when it is present, so a browser write cannot forge an
-- actor by setting the column to somebody else.
CREATE OR REPLACE FUNCTION public.log_admin_action(
    p_action      TEXT,
    p_entity_type TEXT,
    p_entity_id   UUID,
    p_entity_label TEXT DEFAULT NULL,
    p_from        TEXT DEFAULT NULL,
    p_to          TEXT DEFAULT NULL,
    p_reason      TEXT DEFAULT NULL,
    p_metadata    JSONB DEFAULT '{}'::jsonb,
    p_actor       UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_id    UUID;
    v_actor UUID;
    v_role  TEXT;
BEGIN
    v_actor := coalesce(auth.uid(), p_actor);

    IF v_actor IS NOT NULL THEN
        SELECT CASE WHEN role = 'account_manager' THEN 'am' ELSE role END
        INTO   v_role
        FROM   public.user_profiles
        WHERE  id = v_actor;
    END IF;

    INSERT INTO public.admin_audit_logs (
        actor_user_id, actor_role, action, entity_type, entity_id,
        entity_label, from_value, to_value, reason, metadata
    )
    VALUES (
        v_actor,
        coalesce(v_role, 'system'),
        p_action, p_entity_type, p_entity_id,
        p_entity_label, p_from, p_to, p_reason, coalesce(p_metadata, '{}'::jsonb)
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_admin_action(TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, JSONB, UUID)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_admin_action(TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, JSONB, UUID)
    TO authenticated, service_role;

-- An earlier draft of this migration shipped an 8-argument version. Drop it so
-- a re-run does not leave two overloads and an ambiguous call.
DROP FUNCTION IF EXISTS public.log_admin_action(TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, JSONB);


-- ============================================================================
-- SECTION 2 — lifecycle columns
--
-- Every table that the owner can deactivate or archive gets the same four:
-- a state column it already had or now has, plus when / by whom / why.
-- ============================================================================

-- ---- user_profiles ---------------------------------------------------------
-- Deliberately a separate column from `role`. Setting role='denied' conflates
-- "never approved" with "was active, now suspended", and loses what the role
-- was so it cannot be restored.
ALTER TABLE public.user_profiles
    ADD COLUMN IF NOT EXISTS status              TEXT NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS deactivated_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deactivated_by      UUID,
    ADD COLUMN IF NOT EXISTS deactivation_reason TEXT,
    ADD COLUMN IF NOT EXISTS role_before_deactivation TEXT,
    ADD COLUMN IF NOT EXISTS role_changed_by     UUID,
    ADD COLUMN IF NOT EXISTS role_changed_at     TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'user_profiles_status_check'
          AND conrelid = 'public.user_profiles'::regclass
    ) THEN
        ALTER TABLE public.user_profiles
            ADD CONSTRAINT user_profiles_status_check
            CHECK (status IN ('active', 'deactivated'));
    END IF;
END;
$$;

COMMENT ON COLUMN public.user_profiles.status IS
    'active | deactivated. Separate from role on purpose: role says what the '
    'user may do, status says whether they may do anything at all. Restoring '
    'reads role_before_deactivation.';

-- ---- clients ---------------------------------------------------------------
ALTER TABLE public.clients
    ADD COLUMN IF NOT EXISTS archived_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS archived_by    UUID,
    ADD COLUMN IF NOT EXISTS archive_reason TEXT;

-- ---- campaigns -------------------------------------------------------------
ALTER TABLE public.campaigns
    ADD COLUMN IF NOT EXISTS archived_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS archived_by    UUID,
    ADD COLUMN IF NOT EXISTS archive_reason TEXT;

-- ---- account_managers ------------------------------------------------------
ALTER TABLE public.account_managers
    ADD COLUMN IF NOT EXISTS status         TEXT NOT NULL DEFAULT 'Active',
    ADD COLUMN IF NOT EXISTS archived_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS archived_by    UUID,
    ADD COLUMN IF NOT EXISTS archive_reason TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'account_managers_status_check'
          AND conrelid = 'public.account_managers'::regclass
    ) THEN
        ALTER TABLE public.account_managers
            ADD CONSTRAINT account_managers_status_check
            CHECK (status IN ('Active', 'Archived'));
    END IF;
END;
$$;

-- ---- payments --------------------------------------------------------------
-- §9.5 forbids hard deletion. A payment that should not have existed is
-- voided: status moves to 'cancelled' (already an accepted value) and the
-- reason is kept. The row itself never leaves.
ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS voided_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS voided_by  UUID,
    ADD COLUMN IF NOT EXISTS void_reason TEXT;

-- ---- submissions -----------------------------------------------------------
-- reviewed_at already exists; reviewed_by did not, so the review audit had no
-- actor when the write came from an endpoint rather than the browser.
ALTER TABLE public.submissions
    ADD COLUMN IF NOT EXISTS reviewed_by UUID;


-- ============================================================================
-- SECTION 3 — refuse hard deletes
--
-- Blocked at the table rather than in the UI, because the UI is not the only
-- caller. The error names the alternative so whoever hits it knows what to do
-- instead of reaching for a way around it.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.refuse_hard_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        '% rows are never hard-deleted (%). Set the archive/void state instead: %',
        TG_TABLE_NAME,
        TG_ARGV[0],
        TG_ARGV[1]
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_payments_no_delete ON public.payments;
CREATE TRIGGER trg_payments_no_delete
    BEFORE DELETE ON public.payments
    FOR EACH ROW EXECUTE FUNCTION public.refuse_hard_delete(
        'scope §9.5: no hard deletion of financial records',
        'UPDATE payments SET status = ''cancelled'', voided_at = now(), void_reason = ...'
    );

DROP TRIGGER IF EXISTS trg_campaigns_no_delete ON public.campaigns;
CREATE TRIGGER trg_campaigns_no_delete
    BEFORE DELETE ON public.campaigns
    FOR EACH ROW EXECUTE FUNCTION public.refuse_hard_delete(
        'scope §7.1: a campaign closes or archives, preserving history and financial links',
        'UPDATE campaigns SET status = ''Archived'', archived_at = now(), archive_reason = ...'
    );

DROP TRIGGER IF EXISTS trg_creator_earnings_no_delete ON public.creator_earnings;
CREATE TRIGGER trg_creator_earnings_no_delete
    BEFORE DELETE ON public.creator_earnings
    FOR EACH ROW EXECUTE FUNCTION public.refuse_hard_delete(
        'scope §9.5: no hard deletion of financial records',
        'UPDATE creator_earnings SET status = ''cancelled'''
    );

DROP TRIGGER IF EXISTS trg_withdrawal_requests_no_delete ON public.withdrawal_requests;
CREATE TRIGGER trg_withdrawal_requests_no_delete
    BEFORE DELETE ON public.withdrawal_requests
    FOR EACH ROW EXECUTE FUNCTION public.refuse_hard_delete(
        'scope §9.5: no hard deletion of financial records',
        'UPDATE withdrawal_requests SET status = ''cancelled'''
    );


-- ============================================================================
-- SECTION 4 — audit triggers
--
-- One per sensitive transition named in §5.1. Each fires only when the thing
-- it watches actually changed, so an unrelated UPDATE does not produce noise
-- that makes the real entries hard to find.
-- ============================================================================

-- ---- 4a. user role and status ---------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_user_profile_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
        PERFORM public.log_admin_action(
            'role_changed', 'user', NEW.id, NEW.email,
            OLD.role, NEW.role, NULL,
            jsonb_build_object('email', NEW.email),
            NEW.role_changed_by
        );
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
        PERFORM public.log_admin_action(
            CASE WHEN NEW.status = 'deactivated' THEN 'user_deactivated'
                 ELSE 'user_restored' END,
            'user', NEW.id, NEW.email,
            OLD.status, NEW.status, NEW.deactivation_reason,
            jsonb_build_object('email', NEW.email, 'role', NEW.role),
            NEW.deactivated_by
        );
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_user_profile ON public.user_profiles;
CREATE TRIGGER trg_audit_user_profile
    AFTER UPDATE ON public.user_profiles
    FOR EACH ROW EXECUTE FUNCTION public.audit_user_profile_change();


-- ---- 4b. campaign archive --------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_campaign_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status
       AND (NEW.status = 'Archived' OR OLD.status = 'Archived') THEN
        PERFORM public.log_admin_action(
            CASE WHEN NEW.status = 'Archived' THEN 'campaign_archived'
                 ELSE 'campaign_restored' END,
            'campaign', NEW.id, NEW.name,
            OLD.status, NEW.status, NEW.archive_reason,
            jsonb_build_object('client_id', NEW.client_id),
            NEW.archived_by
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_campaign ON public.campaigns;
CREATE TRIGGER trg_audit_campaign
    AFTER UPDATE ON public.campaigns
    FOR EACH ROW EXECUTE FUNCTION public.audit_campaign_change();


-- ---- 4c. client archive ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_client_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status
       AND (NEW.status = 'Archived' OR OLD.status = 'Archived') THEN
        PERFORM public.log_admin_action(
            CASE WHEN NEW.status = 'Archived' THEN 'client_archived'
                 ELSE 'client_restored' END,
            'client', NEW.id, NEW.name,
            OLD.status, NEW.status, NEW.archive_reason, '{}'::jsonb,
            NEW.archived_by
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_client ON public.clients;
CREATE TRIGGER trg_audit_client
    AFTER UPDATE ON public.clients
    FOR EACH ROW EXECUTE FUNCTION public.audit_client_change();


-- ---- 4d. account manager archive -------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_account_manager_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        PERFORM public.log_admin_action(
            CASE WHEN NEW.status = 'Archived' THEN 'account_manager_archived'
                 ELSE 'account_manager_restored' END,
            'account_manager', NEW.id, NEW.name,
            OLD.status, NEW.status, NEW.archive_reason,
            jsonb_build_object('email', NEW.email),
            NEW.archived_by
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_account_manager ON public.account_managers;
CREATE TRIGGER trg_audit_account_manager
    AFTER UPDATE ON public.account_managers
    FOR EACH ROW EXECUTE FUNCTION public.audit_account_manager_change();


-- ---- 4e. content review decisions ------------------------------------------
-- §5.1 names approvals and rejections. Both live on submissions as a status
-- transition, so one trigger covers concept and final review alike.
CREATE OR REPLACE FUNCTION public.audit_submission_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    IF NEW.concept_status IS DISTINCT FROM OLD.concept_status THEN
        PERFORM public.log_admin_action(
            'concept_review', 'submission', NEW.id, NULL,
            OLD.concept_status, NEW.concept_status, NEW.feedback,
            jsonb_build_object('creator_id', NEW.creator_id,
                               'campaign_id', NEW.campaign_id),
            NEW.reviewed_by
        );
    END IF;

    IF NEW.final_status IS DISTINCT FROM OLD.final_status THEN
        PERFORM public.log_admin_action(
            'final_review', 'submission', NEW.id, NULL,
            OLD.final_status, NEW.final_status, NEW.feedback,
            jsonb_build_object('creator_id', NEW.creator_id,
                               'campaign_id', NEW.campaign_id),
            NEW.reviewed_by
        );
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_submission_review ON public.submissions;
CREATE TRIGGER trg_audit_submission_review
    AFTER UPDATE ON public.submissions
    FOR EACH ROW EXECUTE FUNCTION public.audit_submission_review();


-- ---- 4f. payment void ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_payment_void()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    IF NEW.voided_at IS NOT NULL AND OLD.voided_at IS NULL THEN
        PERFORM public.log_admin_action(
            'payment_voided', 'payment', NEW.id, NULL,
            OLD.status, NEW.status, NEW.void_reason,
            jsonb_build_object('creator_id', NEW.creator_id,
                               'amount', coalesce(NEW.amount, NEW.amount_owed)),
            NEW.voided_by
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_payment_void ON public.payments;
CREATE TRIGGER trg_audit_payment_void
    AFTER UPDATE ON public.payments
    FOR EACH ROW EXECUTE FUNCTION public.audit_payment_void();


-- ============================================================================
-- SECTION 5 — RLS on admin_audit_logs
--
-- §5.2: owner sees all; AM sees "scoped operational events"; creator sees
-- "own material events"; client sees none.
-- ============================================================================

ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_audit_owner_select   ON public.admin_audit_logs;
DROP POLICY IF EXISTS admin_audit_am_select      ON public.admin_audit_logs;
DROP POLICY IF EXISTS admin_audit_creator_select ON public.admin_audit_logs;

CREATE POLICY admin_audit_owner_select ON public.admin_audit_logs
    FOR SELECT TO authenticated
    USING (public.current_user_role() = 'owner');

-- An AM sees review decisions on submissions by creators assigned to them,
-- plus anything they themselves did. Not role changes, not archives.
CREATE POLICY admin_audit_am_select ON public.admin_audit_logs
    FOR SELECT TO authenticated
    USING (
        public.current_user_role() = 'am'
        AND (
            actor_user_id = auth.uid()
            OR (
                entity_type = 'submission'
                AND EXISTS (
                    SELECT 1
                    FROM   public.submissions s
                    JOIN   public.creators c         ON c.id = s.creator_id
                    JOIN   public.account_managers m ON m.id = c.am_id
                    WHERE  s.id = admin_audit_logs.entity_id
                      AND  m.user_id = auth.uid()
                )
            )
        )
    );

-- A creator sees events about their own user row and their own submissions.
CREATE POLICY admin_audit_creator_select ON public.admin_audit_logs
    FOR SELECT TO authenticated
    USING (
        public.current_user_role() = 'creator'
        AND (
            (entity_type = 'user' AND entity_id = auth.uid())
            OR (
                entity_type = 'submission'
                AND EXISTS (
                    SELECT 1
                    FROM   public.submissions s
                    JOIN   public.creators c ON c.id = s.creator_id
                    WHERE  s.id = admin_audit_logs.entity_id
                      AND  c.user_id = auth.uid()
                )
            )
        )
    );

-- No INSERT policy: rows arrive only through log_admin_action(), which is
-- SECURITY DEFINER. No UPDATE or DELETE policy, by design.


-- ============================================================================
-- SECTION 6 — deactivated users lose their access
--
-- Deactivation has to mean something at the data layer, not only in the UI.
-- current_user_role() is what every RLS policy in this schema consults, so
-- teaching it about status disables a deactivated user everywhere at once.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT CASE
           WHEN status = 'deactivated' THEN 'deactivated'
           WHEN role   = 'account_manager' THEN 'am'
           ELSE role
         END
  FROM public.user_profiles
  WHERE id = auth.uid();
$$;

COMMENT ON FUNCTION public.current_user_role() IS
  'Role of the calling user from user_profiles, normalized so account_manager '
  '-> am. Returns ''deactivated'' for a suspended account regardless of role, '
  'so a single check disables them across every policy that calls this.';


-- ============================================================================
-- SECTION 7 — reconciliation helper for the owner view
--
-- payout_ledger_reconcile() from 20260822000004 reports drift per creator.
-- This wraps it with the creator's name and an authorization check so the UI
-- can call it directly instead of joining in the browser.
-- ============================================================================

DO $$
BEGIN
    IF to_regprocedure('public.payout_ledger_reconcile(uuid)') IS NULL THEN
        RAISE NOTICE
            'payout_ledger_reconcile() not found -- apply 20260822000004_payout_ledger.sql '
            'to enable the reconciliation view. Skipping SECTION 7.';
        RETURN;
    END IF;

    IF to_regprocedure('public.has_payout_permission(text)') IS NULL THEN
        RAISE NOTICE
            'has_payout_permission() not found -- apply 20260821000000_payout_drift_and_authz.sql '
            'to enable the reconciliation view. Skipping SECTION 7.';
        RETURN;
    END IF;

    EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.payout_reconciliation_report()
    RETURNS TABLE (
        creator_id      UUID,
        creator_name    TEXT,
        ledger_balance  NUMERIC,
        table_balance   NUMERIC,
        drift           NUMERIC
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, auth
    AS $body$
    -- The OUT parameters share names with the columns returned by
    -- payout_ledger_reconcile(). Prefer the column in that collision.
    #variable_conflict use_column
    BEGIN
        IF NOT public.has_payout_permission('view_payouts') THEN
            RAISE EXCEPTION 'Not authorized: view_payouts required'
                USING ERRCODE = '42501';
        END IF;

        RETURN QUERY
        SELECT r.creator_id,
               c.name,
               r.ledger_balance,
               r.table_balance,
               r.drift
        FROM   public.payout_ledger_reconcile(NULL) r
        LEFT   JOIN public.creators c ON c.id = r.creator_id
        ORDER  BY abs(coalesce(r.drift, 0)) DESC, c.name;
    END;
    $body$;
    $fn$;

    EXECUTE 'REVOKE ALL ON FUNCTION public.payout_reconciliation_report() FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.payout_reconciliation_report() TO authenticated, service_role';
END;
$$;


-- ============================================================================
-- SECTION 8 — verification
-- ============================================================================

DO $$
DECLARE
    v_missing TEXT := '';
BEGIN
    IF to_regclass('public.admin_audit_logs') IS NULL THEN
        v_missing := v_missing || ' admin_audit_logs';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='user_profiles'
                     AND column_name='status') THEN
        v_missing := v_missing || ' user_profiles.status';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_payments_no_delete') THEN
        v_missing := v_missing || ' trg_payments_no_delete';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_campaigns_no_delete') THEN
        v_missing := v_missing || ' trg_campaigns_no_delete';
    END IF;

    IF v_missing <> '' THEN
        RAISE EXCEPTION 'Owner lifecycle controls incomplete, missing:%', v_missing;
    END IF;

    RAISE NOTICE 'Owner lifecycle controls installed: deactivate/restore, archive, hard-delete refusal, admin audit trail.';
END;
$$;

COMMIT;
