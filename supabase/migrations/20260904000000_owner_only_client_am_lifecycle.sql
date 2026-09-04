-- ============================================================================
-- MIGRATION: 20260904000000_owner_only_client_am_lifecycle.sql
--
-- Three changes, all owner-scoped:
--
--   1. account_managers gets the BEFORE DELETE refusal every other lifecycle
--      table already has (20260823/20260824 covered payments, campaigns,
--      creator_earnings, withdrawal_requests, creators, submissions,
--      user_profiles — clients and account_managers were missed).
--
--   2. Client writes narrow to owner-only. clients_modify_owner_or_assigned_am
--      was FOR ALL and granted the assigned AM INSERT/UPDATE/DELETE, so an AM
--      could edit or remove their clients straight from the browser regardless
--      of what the UI showed. clients_select_scoped is untouched: AMs still
--      read their assigned clients.
--
--   3. Clients become hard-deletable BY THE OWNER ONLY — a deliberate
--      exception to the archive-only rule, for clearing test and duplicate
--      records. Two things make it safe rather than reckless:
--
--        - campaigns.client_id REFERENCES clients with no ON DELETE clause,
--          i.e. NO ACTION. A client that has any campaign cannot be deleted;
--          Postgres raises 23503 and the row stays. So real clients with work
--          against them are protected by the foreign key itself, and only
--          genuinely empty records can go. Nothing cascades, nothing is
--          silently orphaned.
--
--        - The deletion is audited BEFORE it happens, so admin_audit_logs
--          keeps the record (who, when, which client, what it was worth)
--          after the row itself is gone. §5.1 names deletions as auditable.
--
--      Archive remains the right answer for a client with history: it is
--      reversible and keeps the financial trail attached. Delete is for
--      records that should never have existed.
--
-- Rollback: 20260904000000_owner_only_client_am_lifecycle.rollback.sql
-- ============================================================================

BEGIN;

DO $$
BEGIN
    IF to_regprocedure('public.refuse_hard_delete()') IS NULL THEN
        RAISE EXCEPTION
            'public.refuse_hard_delete() is missing. Apply 20260823000000_owner_lifecycle_controls.sql first.';
    END IF;
END;
$$;


-- ============================================================================
-- SECTION 1 — account_managers: refuse hard deletes
--
-- Not clients: see SECTION 3. An AM anchors creator and client assignment
-- history, and unlike clients there is no foreign key that would stop the
-- delete — creators.am_id and clients.am_id would simply be left pointing at
-- an id that no longer exists.
-- ============================================================================

DROP TRIGGER IF EXISTS trg_account_managers_no_delete ON public.account_managers;
CREATE TRIGGER trg_account_managers_no_delete
    BEFORE DELETE ON public.account_managers
    FOR EACH ROW EXECUTE FUNCTION public.refuse_hard_delete(
        'scope §11.1: an account manager anchors creator/client assignment history',
        'UPDATE account_managers SET status = ''Archived'', archived_at = now(), archived_by = ..., archive_reason = ...'
    );

-- If an earlier revision of this migration installed the clients refusal,
-- remove it: clients are deletable by the owner as of this version.
DROP TRIGGER IF EXISTS trg_clients_no_delete ON public.clients;


-- ============================================================================
-- SECTION 2 — narrow client writes to owner-only
-- ============================================================================

DROP POLICY IF EXISTS clients_modify_owner_or_assigned_am ON public.clients;
DROP POLICY IF EXISTS clients_modify_owner ON public.clients;

-- INSERT/UPDATE only. DELETE is granted separately below so that the two can
-- be reasoned about — and revoked — independently.
CREATE POLICY clients_modify_owner ON public.clients
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'owner')
  WITH CHECK (public.current_user_role() = 'owner');


-- ============================================================================
-- SECTION 3 — owner may hard-delete a client, and it is audited first
-- ============================================================================

CREATE OR REPLACE FUNCTION public.audit_client_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    -- BEFORE DELETE: the row still exists here, so its label and value can be
    -- denormalised into the audit entry that outlives it.
    PERFORM public.log_admin_action(
        'client_deleted',
        'client',
        OLD.id,
        OLD.name,
        OLD.status,
        NULL,
        OLD.archive_reason,
        jsonb_build_object(
            'budget',        OLD.budget,
            'deal_type',     OLD.deal_type,
            'contact_email', OLD.contact_email,
            'am_id',         OLD.am_id,
            'was_archived',  (OLD.archived_at IS NOT NULL)
        ),
        NULL
    );
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_client_delete ON public.clients;
CREATE TRIGGER trg_audit_client_delete
    BEFORE DELETE ON public.clients
    FOR EACH ROW EXECUTE FUNCTION public.audit_client_delete();

DROP POLICY IF EXISTS clients_delete_owner ON public.clients;
CREATE POLICY clients_delete_owner ON public.clients
  FOR DELETE TO authenticated
  USING (public.current_user_role() = 'owner');


-- ============================================================================
-- SECTION 4 — verification
-- ============================================================================

DO $$
DECLARE
    v_missing TEXT := '';
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_account_managers_no_delete') THEN
        v_missing := v_missing || ' trg_account_managers_no_delete';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_client_delete') THEN
        v_missing := v_missing || ' trg_audit_client_delete';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_clients_no_delete') THEN
        v_missing := v_missing || ' (stale)trg_clients_no_delete';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies
                   WHERE schemaname = 'public' AND tablename = 'clients'
                     AND policyname = 'clients_modify_owner') THEN
        v_missing := v_missing || ' clients_modify_owner';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies
                   WHERE schemaname = 'public' AND tablename = 'clients'
                     AND policyname = 'clients_delete_owner') THEN
        v_missing := v_missing || ' clients_delete_owner';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_policies
               WHERE schemaname = 'public' AND tablename = 'clients'
                 AND policyname = 'clients_modify_owner_or_assigned_am') THEN
        v_missing := v_missing || ' (stale)clients_modify_owner_or_assigned_am';
    END IF;

    IF v_missing <> '' THEN
        RAISE EXCEPTION 'Owner-only client/AM lifecycle migration incomplete, missing:%', v_missing;
    END IF;

    RAISE NOTICE 'clients: owner-only writes + audited owner delete. account_managers: hard-delete refused.';
END;
$$;

COMMIT;
