-- ============================================================================
-- ROLLBACK: 20260904000001_fix_archive_audit_signature.sql
--
-- Restores the argument order shipped in 20260825000000. Note that doing so
-- reinstates the bug: archiving or restoring a creator or submission will
-- fail again, because the call resolves to no function. Roll back only to
-- match a rolled-back 20260825, never on its own.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.trg_audit_creator_archive()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
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

CREATE OR REPLACE FUNCTION public.trg_audit_submission_archive()
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

COMMIT;
