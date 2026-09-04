-- ============================================================================
-- MIGRATION: 20260904000001_fix_archive_audit_signature.sql
--
-- 20260825000000_creator_submission_archival.sql calls log_admin_action() with
-- the actor first and the entity type in the entity_id position:
--
--     log_admin_action(NEW.archived_by, 'creator_archived', 'creators',
--                      NEW.id::text, jsonb_build_object(...))
--
-- The function is declared (p_action TEXT, p_entity_type TEXT, p_entity_id UUID,
-- p_entity_label TEXT, p_from TEXT, p_to TEXT, p_reason TEXT, p_metadata JSONB,
-- p_actor UUID) and the older 8-arg overload was dropped in 20260823, so that
-- call resolves to nothing: Postgres has no implicit uuid->text or jsonb->text
-- cast, and 'creators' is not valid uuid input.
--
-- Effect: the trigger raises on every UPDATE that changes archived_at, which
-- aborts the UPDATE. Archiving or restoring a creator or a submission fails
-- outright — the feature has never been able to work since 20260825 landed.
--
-- This replaces both functions with correctly-ordered calls. Columns, triggers
-- and the hard-delete refusals from 20260824 are unchanged.
--
-- Rollback: 20260904000001_fix_archive_audit_signature.rollback.sql
-- ============================================================================

BEGIN;

DO $$
BEGIN
    IF to_regprocedure(
         'public.log_admin_action(text,text,uuid,text,text,text,text,jsonb,uuid)'
       ) IS NULL THEN
        RAISE EXCEPTION
            'log_admin_action(text,text,uuid,...) is missing. Apply 20260823000000_owner_lifecycle_controls.sql first.';
    END IF;
END;
$$;


-- ---- creators --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_audit_creator_archive()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    -- Fire only when archived_at changes (archive or restore).
    IF (OLD.archived_at IS DISTINCT FROM NEW.archived_at) THEN
        PERFORM public.log_admin_action(
            CASE WHEN NEW.archived_at IS NOT NULL THEN 'creator_archived'
                 ELSE 'creator_restored' END,   -- p_action
            'creator',                          -- p_entity_type
            NEW.id,                             -- p_entity_id (uuid)
            NEW.name,                           -- p_entity_label
            OLD.status,                         -- p_from
            NEW.status,                         -- p_to
            NEW.archive_reason,                 -- p_reason
            jsonb_build_object('email', NEW.email, 'am_id', NEW.am_id),
            NEW.archived_by                     -- p_actor
        );
    END IF;
    RETURN NEW;
END;
$$;


-- ---- submissions -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_audit_submission_archive()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    IF (OLD.archived_at IS DISTINCT FROM NEW.archived_at) THEN
        PERFORM public.log_admin_action(
            CASE WHEN NEW.archived_at IS NOT NULL THEN 'submission_archived'
                 ELSE 'submission_restored' END,
            'submission',
            NEW.id,
            NULL,
            NULL,
            NULL,
            NEW.archive_reason,
            jsonb_build_object('creator_id',  NEW.creator_id,
                               'campaign_id', NEW.campaign_id),
            NEW.archived_by
        );
    END IF;
    RETURN NEW;
END;
$$;


-- ============================================================================
-- Verification — prove the call actually resolves, rather than trusting that
-- the function body compiled (plpgsql does not resolve calls until run time).
-- ============================================================================

DO $$
DECLARE
    v_creator public.creators%ROWTYPE;
BEGIN
    SELECT * INTO v_creator FROM public.creators LIMIT 1;

    IF NOT FOUND THEN
        RAISE NOTICE 'No creators to smoke-test against; precondition check only.';
        RETURN;
    END IF;

    -- admin_audit_logs is append-only (trg_admin_audit_immutable refuses both
    -- UPDATE and DELETE), so the test row cannot be cleaned up afterwards.
    -- Run it in a subtransaction and abort that, which leaves nothing behind
    -- while still proving the call resolves at run time — plpgsql does not
    -- resolve function calls when the body is compiled, so a catalog lookup
    -- alone would not have caught the original bug.
    BEGIN
        PERFORM public.log_admin_action(
            'creator_archived', 'creator', v_creator.id, v_creator.name,
            v_creator.status, v_creator.status, 'migration smoke test',
            '{}'::jsonb, NULL
        );
        RAISE EXCEPTION 'omnya_smoke_test_rollback';
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLERRM <> 'omnya_smoke_test_rollback' THEN
                RAISE;
            END IF;
    END;

    RAISE NOTICE 'log_admin_action() resolves with the corrected argument order.';
END;
$$;

COMMIT;
