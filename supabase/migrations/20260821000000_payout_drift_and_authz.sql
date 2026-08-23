-- ============================================================================
-- 20260821000000_payout_drift_and_authz.sql
--
-- Repairs the deployed payout system and closes the privilege-escalation hole
-- in the payout RPCs. Addresses audit findings N-03, N-04, N-11 and features
-- F-2, F-8, F-9.
--
-- ORDERING IS LOAD-BEARING. Read this before running anything:
--
--   The five payout RPCs in production are SECURITY DEFINER with no
--   authorization of any kind. A creator or a client can call
--   approve_withdrawal_request on any withdrawal. Today they fail only because
--   the deployed function bodies are stale and reference a dropped column
--   (payment_audit_logs.performed_by). That bug is currently the only thing
--   preventing self-approval of payouts.
--
--   Applying 20260530000001_payout_rpc_functions.sql ON ITS OWN repairs the
--   bodies and therefore REMOVES THE ACCIDENTAL BRAKE while leaving the door
--   open. Do not do that.
--
--   Correct order, in one session:
--     1. supabase/migrations/20260530000001_payout_rpc_functions.sql   (bodies)
--     2. THIS FILE                                                     (authz)
--
--   Section 2 below hard-fails if step 1 has not been run, so the unsafe
--   order cannot be applied by accident. Section 6 revokes PUBLIC/anon
--   execute rights, which is safe to run at any time.
--
-- Idempotent: safe to re-run.
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1 — N-03: creator_earnings status CHECK
--
-- The deployed constraint rejects 'needs_review', 'withdrawal_requested' and
-- 'batched'. request_creator_withdrawal cannot lock earnings and
-- create_payout_batch cannot stamp them, so no withdrawal can complete.
-- Verified by probing every value against production.
-- ============================================================================

ALTER TABLE public.creator_earnings
  DROP CONSTRAINT IF EXISTS creator_earnings_status_check;

ALTER TABLE public.creator_earnings
  ADD CONSTRAINT creator_earnings_status_check CHECK (
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
  );


-- ============================================================================
-- SECTION 2 — ordering guard
--
-- Refuse to install the authorization layer on top of stale bodies. Wrapping
-- a stale function would leave the escalation path open behind a wrapper that
-- looks like it closed it.
-- ============================================================================

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM   pg_proc p
    JOIN   pg_namespace n ON n.oid = p.pronamespace
    WHERE  n.nspname = 'public'
      AND  p.proname IN (
             'approve_withdrawal_request',
             'reject_withdrawal_request',
             'create_payout_batch',
             'mark_payout_batch_paid'
           )
      AND  pg_get_functiondef(p.oid) LIKE '%performed_by%'
  ) THEN
    RAISE EXCEPTION
      'Stale payout RPC bodies detected (they still reference performed_by). '
      'Apply supabase/migrations/20260530000001_payout_rpc_functions.sql first, '
      'then re-run this migration in the same session.';
  END IF;
END
$guard$;


-- ============================================================================
-- SECTION 3 — F-2: the permission helper
--
-- Mirrors api/_lib/paymentPermissions.js so the database and the API layer
-- agree. Owner has everything. An active payment_managers row grants the
-- mapped permission. AMs may view only. manage_payment_managers is owner-only
-- and has no column, matching the fix applied to the API.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.has_payout_permission(p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role TEXT;
  v_ok   BOOLEAN := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  SELECT role INTO v_role
  FROM   user_profiles
  WHERE  id = auth.uid();

  IF v_role IS NULL THEN
    RETURN false;
  END IF;

  -- Owner: unconditional.
  IF v_role IN ('owner', 'admin') THEN
    RETURN true;
  END IF;

  -- manage_payment_managers cannot be delegated.
  IF p_permission = 'manage_payment_managers' THEN
    RETURN false;
  END IF;

  -- AM shortcut: view only.
  IF p_permission = 'view_payouts' AND v_role IN ('am', 'account_manager') THEN
    RETURN true;
  END IF;

  -- Delegated payment managers.
  SELECT CASE p_permission
           WHEN 'view_payouts'        THEN pm.can_view_payouts
           WHEN 'approve_withdrawals' THEN pm.can_approve_withdrawals
           WHEN 'export_batches'      THEN pm.can_export_batches
           WHEN 'mark_paid'           THEN pm.can_mark_paid
           ELSE false
         END
  INTO   v_ok
  FROM   payment_managers pm
  WHERE  pm.user_id = auth.uid()
    AND  pm.active  = true;

  RETURN COALESCE(v_ok, false);
END;
$$;

REVOKE ALL ON FUNCTION public.has_payout_permission(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_payout_permission(TEXT) TO authenticated;


CREATE OR REPLACE FUNCTION public.assert_payout_permission(p_permission TEXT)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.has_payout_permission(p_permission) THEN
    RAISE EXCEPTION 'Not authorized: % required', p_permission
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_payout_permission(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_payout_permission(TEXT) TO authenticated;


-- ============================================================================
-- SECTION 4 — request_creator_withdrawal, replaced in full
--
-- Three changes against the repo version:
--   F-2  the caller must own the creator row (or hold approve_withdrawals);
--        previously any authenticated user could request a withdrawal for any
--        creator by passing someone else's p_creator_id.
--   F-9  the balance read now takes FOR UPDATE row locks, so two concurrent
--        requests cannot both see the same balance and both commit it.
--   The audit actor was already auth.uid() here and stays that way.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.request_creator_withdrawal(
  p_creator_id              UUID,
  p_currency                TEXT    DEFAULT 'USD',
  p_payment_method          TEXT    DEFAULT NULL,
  p_payment_destination_summary TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_latest_request        RECORD;
  v_next_eligible_at      TIMESTAMPTZ;
  v_available_balance     NUMERIC(10,2);
  v_payment_method        TEXT;
  v_withdrawal_request_id UUID;
  v_owns_creator          BOOLEAN;
BEGIN
  -- ---- F-2: authorization -------------------------------------------------
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM creators c
    WHERE  c.id = p_creator_id AND c.user_id = auth.uid()
  ) INTO v_owns_creator;

  IF NOT v_owns_creator AND NOT public.has_payout_permission('approve_withdrawals') THEN
    RAISE EXCEPTION 'Not authorized to request a withdrawal for this creator'
      USING ERRCODE = '42501';
  END IF;
  -- -------------------------------------------------------------------------

  IF p_currency <> 'USD' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'unsupported_currency',
      'message', 'Only USD is supported at this time'
    );
  END IF;

  -- 14-day cooldown check
  SELECT *
  INTO   v_latest_request
  FROM   withdrawal_requests
  WHERE  creator_id = p_creator_id
    AND  status NOT IN ('rejected', 'cancelled')
  ORDER BY requested_at DESC
  LIMIT  1;

  IF FOUND AND v_latest_request.requested_at > (now() - INTERVAL '14 days') THEN
    v_next_eligible_at := v_latest_request.requested_at + INTERVAL '14 days';
    RETURN jsonb_build_object(
      'success',          false,
      'error',            'withdrawal_cooldown',
      'message',          'A withdrawal was requested recently. Please wait before requesting again.',
      'next_eligible_at', v_next_eligible_at
    );
  END IF;

  -- ---- F-9: lock the rows before reading the balance ----------------------
  -- Without these locks two concurrent calls both read the same balance and
  -- both create a request, committing the money twice.
  PERFORM 1
  FROM   creator_earnings
  WHERE  creator_id = p_creator_id
    AND  status = 'approved'
  FOR UPDATE;

  SELECT COALESCE(SUM(amount), 0)
  INTO   v_available_balance
  FROM   creator_earnings
  WHERE  creator_id = p_creator_id
    AND  status = 'approved';
  -- -------------------------------------------------------------------------

  IF v_available_balance <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'no_balance',
      'message', 'No approved earnings available for withdrawal'
    );
  END IF;

  v_payment_method := p_payment_method;

  IF v_payment_method IS NULL THEN
    SELECT payment_method
    INTO   v_payment_method
    FROM   creators
    WHERE  id = p_creator_id;
  END IF;

  IF v_payment_method IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'no_payment_method',
      'message', 'No payment method configured. Please set a payout preference first.'
    );
  END IF;

  INSERT INTO withdrawal_requests (
    creator_id, amount, currency, payment_method,
    payment_destination_summary, status, requested_at
  )
  VALUES (
    p_creator_id, v_available_balance, p_currency, v_payment_method,
    p_payment_destination_summary, 'pending_admin_approval', now()
  )
  RETURNING id INTO v_withdrawal_request_id;

  UPDATE creator_earnings
  SET    status = 'withdrawal_requested'
  WHERE  creator_id = p_creator_id
    AND  status = 'approved';

  INSERT INTO payment_audit_logs (
    entity_type, entity_id, action, actor_user_id, metadata, created_at
  )
  VALUES (
    'withdrawal_request',
    v_withdrawal_request_id,
    'withdrawal_requested',
    auth.uid(),
    jsonb_build_object(
      'creator_id',     p_creator_id,
      'amount',         v_available_balance,
      'currency',       p_currency,
      'payment_method', v_payment_method
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success',               true,
    'withdrawal_request_id', v_withdrawal_request_id,
    'amount',                v_available_balance,
    'currency',              p_currency,
    'payment_method',        v_payment_method,
    'status',                'pending_admin_approval'
  );
END;
$$;


-- ============================================================================
-- SECTION 5 — F-2 / F-8: guarded wrappers for the four privileged RPCs
--
-- The corrected bodies are moved aside under _internal names and stripped of
-- all execute rights. The public entry point keeps its original name and
-- signature (so no API or UI caller changes) but now:
--   * checks the caller's permission before doing anything, and
--   * ignores the caller-supplied actor id and passes auth.uid() instead,
--     which is F-8 -- the audit trail can no longer be forged by passing
--     somebody else's UUID.
-- ============================================================================

-- Move each corrected body aside under an _internal name and strip every
-- execute right from it, then publish a guarded wrapper under the original
-- name and signature. Written as one idempotent block: the rename only happens
-- when the _internal target does not already exist, so re-running is a no-op.

DO $seal$
DECLARE
  fn   TEXT;
  args TEXT;
  pair TEXT[];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ARRAY['approve_withdrawal_request', 'UUID, UUID'],
    ARRAY['reject_withdrawal_request',  'UUID, UUID, TEXT'],
    ARRAY['create_payout_batch',        'UUID[], UUID, TEXT'],
    ARRAY['mark_payout_batch_paid',     'UUID, UUID']
  ]
  LOOP
    fn   := pair[1];
    args := pair[2];

    -- Rename only if the sealed copy is not already in place.
    IF NOT EXISTS (
          SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = fn || '_internal')
       AND EXISTS (
          SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = fn)
    THEN
      EXECUTE format('ALTER FUNCTION public.%I(%s) RENAME TO %I', fn, args, fn || '_internal');
    END IF;

    -- Seal the internal: only the function owner (and therefore the
    -- SECURITY DEFINER wrapper) may execute it.
    IF EXISTS (
          SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = fn || '_internal')
    THEN
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated',
        fn || '_internal', args);
    END IF;
  END LOOP;
END
$seal$;


CREATE OR REPLACE FUNCTION public.approve_withdrawal_request(
  p_request_id  UUID,
  p_approved_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  PERFORM public.assert_payout_permission('approve_withdrawals');
  -- p_approved_by is deliberately ignored (F-8): the recorded actor is
  -- whoever is actually signed in, not whatever UUID the caller passed.
  RETURN public.approve_withdrawal_request_internal(p_request_id, auth.uid());
END;
$$;


CREATE OR REPLACE FUNCTION public.reject_withdrawal_request(
  p_request_id  UUID,
  p_rejected_by UUID DEFAULT NULL,
  p_reason      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  PERFORM public.assert_payout_permission('approve_withdrawals');
  RETURN public.reject_withdrawal_request_internal(p_request_id, auth.uid(), p_reason);
END;
$$;


CREATE OR REPLACE FUNCTION public.create_payout_batch(
  p_withdrawal_request_ids UUID[],
  p_generated_by           UUID DEFAULT NULL,
  p_notes                  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  PERFORM public.assert_payout_permission('export_batches');
  RETURN public.create_payout_batch_internal(p_withdrawal_request_ids, auth.uid(), p_notes);
END;
$$;


CREATE OR REPLACE FUNCTION public.mark_payout_batch_paid(
  p_batch_id       UUID,
  p_marked_paid_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  PERFORM public.assert_payout_permission('mark_paid');
  RETURN public.mark_payout_batch_paid_internal(p_batch_id, auth.uid());
END;
$$;


-- ============================================================================
-- SECTION 6 — N-11: strip PUBLIC and anon execute rights
--
-- PostgreSQL grants EXECUTE to PUBLIC on every new function. That is why an
-- unauthenticated caller could reach all five payout RPCs. Safe to run alone.
-- ============================================================================

REVOKE ALL ON FUNCTION public.request_creator_withdrawal(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_withdrawal_request(UUID, UUID)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reject_withdrawal_request(UUID, UUID, TEXT)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_payout_batch(UUID[], UUID, TEXT)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_payout_batch_paid(UUID, UUID)                 FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.request_creator_withdrawal(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_withdrawal_request(UUID, UUID)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_withdrawal_request(UUID, UUID, TEXT)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_payout_batch(UUID[], UUID, TEXT)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_payout_batch_paid(UUID, UUID)                 TO authenticated;

COMMIT;
