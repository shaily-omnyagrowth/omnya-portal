-- ============================================================================
-- ROLLBACK: 20260823000000_owner_lifecycle_controls.rollback.sql
-- ============================================================================
--
-- READ THIS BEFORE RUNNING.
--
-- This reopens two things on purpose:
--
--   1. Hard deletion of payments, campaigns, creator_earnings and
--      withdrawal_requests becomes possible again. Scope §9.5 forbids the
--      first and third; §7.1 forbids the second. After this runs, a DELETE
--      that the database currently refuses will succeed silently.
--
--   2. A deactivated user regains their role. current_user_role() stops
--      consulting status, so anyone suspended is active again the moment
--      this commits.
--
-- The audit trail itself is kept. admin_audit_logs is append-only and dropping
-- it would destroy the record of every action taken while the feature was
-- live, which is the opposite of what an audit table is for. Drop it by hand
-- only if you are certain, using the commented block at the end.
--
-- The lifecycle columns are also kept. They are additive, nothing breaks by
-- leaving them, and dropping them discards who archived what and when.
-- ============================================================================

BEGIN;

-- ---- 1. hard-delete refusal ------------------------------------------------
DROP TRIGGER IF EXISTS trg_payments_no_delete            ON public.payments;
DROP TRIGGER IF EXISTS trg_campaigns_no_delete           ON public.campaigns;
DROP TRIGGER IF EXISTS trg_creator_earnings_no_delete    ON public.creator_earnings;
DROP TRIGGER IF EXISTS trg_withdrawal_requests_no_delete ON public.withdrawal_requests;
DROP FUNCTION IF EXISTS public.refuse_hard_delete();

-- ---- 2. audit triggers -----------------------------------------------------
DROP TRIGGER IF EXISTS trg_audit_user_profile      ON public.user_profiles;
DROP TRIGGER IF EXISTS trg_audit_campaign          ON public.campaigns;
DROP TRIGGER IF EXISTS trg_audit_client            ON public.clients;
DROP TRIGGER IF EXISTS trg_audit_account_manager   ON public.account_managers;
DROP TRIGGER IF EXISTS trg_audit_submission_review ON public.submissions;
DROP TRIGGER IF EXISTS trg_audit_payment_void      ON public.payments;

DROP FUNCTION IF EXISTS public.audit_user_profile_change();
DROP FUNCTION IF EXISTS public.audit_campaign_change();
DROP FUNCTION IF EXISTS public.audit_client_change();
DROP FUNCTION IF EXISTS public.audit_account_manager_change();
DROP FUNCTION IF EXISTS public.audit_submission_review();
DROP FUNCTION IF EXISTS public.audit_payment_void();

-- ---- 3. reconciliation wrapper ---------------------------------------------
DROP FUNCTION IF EXISTS public.payout_reconciliation_report();

-- ---- 4. current_user_role() back to the status-blind version ---------------
-- After this, `status = 'deactivated'` has no effect on access.
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT CASE WHEN role = 'account_manager' THEN 'am' ELSE role END
  FROM public.user_profiles
  WHERE id = auth.uid();
$$;

COMMENT ON FUNCTION public.current_user_role() IS
  'Returns the role of the calling user from user_profiles, normalized so '
  'account_manager -> am. SECURITY DEFINER so RLS policies can call it without '
  'recursing on user_profiles.';

COMMIT;


-- ============================================================================
-- OPTIONAL — destroy the audit trail as well
--
-- Not part of the rollback above. Everything recorded since the migration was
-- applied is lost and cannot be recovered from anywhere else.
-- ============================================================================
--
-- BEGIN;
--   DROP TRIGGER IF EXISTS trg_admin_audit_immutable ON public.admin_audit_logs;
--   DROP FUNCTION IF EXISTS public.admin_audit_immutable();
--   DROP FUNCTION IF EXISTS public.log_admin_action(TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, JSONB);
--   DROP TABLE IF EXISTS public.admin_audit_logs;
-- COMMIT;
--
--
-- OPTIONAL — drop the lifecycle columns
--
-- Discards who archived or deactivated what, and when.
--
-- BEGIN;
--   ALTER TABLE public.user_profiles
--     DROP CONSTRAINT IF EXISTS user_profiles_status_check,
--     DROP COLUMN IF EXISTS status,
--     DROP COLUMN IF EXISTS deactivated_at,
--     DROP COLUMN IF EXISTS deactivated_by,
--     DROP COLUMN IF EXISTS deactivation_reason,
--     DROP COLUMN IF EXISTS role_before_deactivation;
--   ALTER TABLE public.clients
--     DROP COLUMN IF EXISTS archived_at, DROP COLUMN IF EXISTS archived_by,
--     DROP COLUMN IF EXISTS archive_reason;
--   ALTER TABLE public.campaigns
--     DROP COLUMN IF EXISTS archived_at, DROP COLUMN IF EXISTS archived_by,
--     DROP COLUMN IF EXISTS archive_reason;
--   ALTER TABLE public.account_managers
--     DROP CONSTRAINT IF EXISTS account_managers_status_check,
--     DROP COLUMN IF EXISTS status, DROP COLUMN IF EXISTS archived_at,
--     DROP COLUMN IF EXISTS archived_by, DROP COLUMN IF EXISTS archive_reason;
--   ALTER TABLE public.payments
--     DROP COLUMN IF EXISTS voided_at, DROP COLUMN IF EXISTS voided_by,
--     DROP COLUMN IF EXISTS void_reason;
-- COMMIT;
