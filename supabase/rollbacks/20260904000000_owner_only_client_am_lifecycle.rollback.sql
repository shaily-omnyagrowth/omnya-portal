-- ============================================================================
-- ROLLBACK: 20260904000000_owner_only_client_am_lifecycle.sql
--
-- Restores AM write access to assigned clients, removes the owner's ability to
-- delete a client, and drops the account_managers delete refusal.
-- ============================================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_account_managers_no_delete ON public.account_managers;

DROP POLICY  IF EXISTS clients_delete_owner    ON public.clients;
DROP TRIGGER IF EXISTS trg_audit_client_delete ON public.clients;
DROP FUNCTION IF EXISTS public.audit_client_delete();

DROP POLICY IF EXISTS clients_modify_owner ON public.clients;

CREATE POLICY clients_modify_owner_or_assigned_am ON public.clients
  FOR ALL TO authenticated
  USING (
    public.current_user_role() = 'owner'
    OR (
      public.current_user_role() = 'am'
      AND EXISTS (
        SELECT 1 FROM public.account_managers am
        WHERE am.id = clients.am_id AND am.user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    public.current_user_role() = 'owner'
    OR (
      public.current_user_role() = 'am'
      AND EXISTS (
        SELECT 1 FROM public.account_managers am
        WHERE am.id = clients.am_id AND am.user_id = auth.uid()
      )
    )
  );

COMMIT;
