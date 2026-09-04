-- =============================================================================
-- Migration: Add archival columns to creators and submissions
-- =============================================================================
-- The owner_lifecycle_controls migration (20260823) added archival columns to
-- clients, campaigns, and account_managers but missed these two tables.
-- The hard-delete triggers already exist (20260824000000), so this migration
-- only adds the metadata columns and audit triggers.
-- =============================================================================

BEGIN;

-- ---- creators --------------------------------------------------------------
ALTER TABLE public.creators
    ADD COLUMN IF NOT EXISTS archived_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS archived_by    UUID,
    ADD COLUMN IF NOT EXISTS archive_reason TEXT;

COMMENT ON COLUMN public.creators.archived_at IS
    'When the creator was archived. NULL means active (status governs day-to-day).';

-- ---- submissions -----------------------------------------------------------
ALTER TABLE public.submissions
    ADD COLUMN IF NOT EXISTS archived_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS archived_by    UUID,
    ADD COLUMN IF NOT EXISTS archive_reason TEXT;

COMMENT ON COLUMN public.submissions.archived_at IS
    'When the submission was archived. NULL means live.';

-- ---- audit triggers --------------------------------------------------------
-- Reuse the existing log_admin_action() helper from the lifecycle migration.
-- These triggers fire when a creator or submission is archived or restored,
-- writing an immutable row to admin_audit_logs.

CREATE OR REPLACE FUNCTION trg_audit_creator_archive()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    -- Fire only when archived_at changes (archive or restore)
    IF (OLD.archived_at IS DISTINCT FROM NEW.archived_at) THEN
        PERFORM log_admin_action(
            COALESCE(NEW.archived_by, auth.uid()),
            CASE WHEN NEW.archived_at IS NOT NULL THEN 'creator_archived' ELSE 'creator_restored' END,
            'creators',
            NEW.id::text,
            jsonb_build_object(
                'name', NEW.name,
                'reason', NEW.archive_reason,
                'old_status', OLD.status,
                'new_status', NEW.status
            )
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_creator_archive ON public.creators;
CREATE TRIGGER trg_audit_creator_archive
    AFTER UPDATE ON public.creators
    FOR EACH ROW
    EXECUTE FUNCTION trg_audit_creator_archive();

CREATE OR REPLACE FUNCTION trg_audit_submission_archive()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF (OLD.archived_at IS DISTINCT FROM NEW.archived_at) THEN
        PERFORM log_admin_action(
            COALESCE(NEW.archived_by, auth.uid()),
            CASE WHEN NEW.archived_at IS NOT NULL THEN 'submission_archived' ELSE 'submission_restored' END,
            'submissions',
            NEW.id::text,
            jsonb_build_object(
                'creator_id', NEW.creator_id,
                'campaign_id', NEW.campaign_id,
                'reason', NEW.archive_reason
            )
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_submission_archive ON public.submissions;
CREATE TRIGGER trg_audit_submission_archive
    AFTER UPDATE ON public.submissions
    FOR EACH ROW
    EXECUTE FUNCTION trg_audit_submission_archive();

COMMIT;