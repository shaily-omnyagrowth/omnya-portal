-- =============================================================================
-- Payout RPC Functions — Atomic payout operations
-- Migration: 20260530000001_payout_rpc_functions.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- FUNCTION 1: request_creator_withdrawal
-- ---------------------------------------------------------------------------
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
BEGIN
  -- Reject non-USD currencies
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

  -- Calculate available balance from approved creator_earnings
  SELECT COALESCE(SUM(amount), 0)
  INTO   v_available_balance
  FROM   creator_earnings
  WHERE  creator_id = p_creator_id
    AND  status = 'approved';

  IF v_available_balance <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'no_balance',
      'message', 'No approved earnings available for withdrawal'
    );
  END IF;

  -- Resolve payment method: param > creators table > error
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

  -- Insert withdrawal request
  INSERT INTO withdrawal_requests (
    creator_id,
    amount,
    currency,
    payment_method,
    payment_destination_summary,
    status,
    requested_at
  )
  VALUES (
    p_creator_id,
    v_available_balance,
    p_currency,
    v_payment_method,
    p_payment_destination_summary,
    'pending_admin_approval',
    now()
  )
  RETURNING id INTO v_withdrawal_request_id;

  -- Lock earnings to this withdrawal request
  UPDATE creator_earnings
  SET    status = 'withdrawal_requested'
  WHERE  creator_id = p_creator_id
    AND  status = 'approved';

  -- Audit log (actor_user_id = auth.users.id of the requesting creator)
  INSERT INTO payment_audit_logs (
    entity_type,
    entity_id,
    action,
    actor_user_id,
    metadata,
    created_at
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
    'success',                true,
    'withdrawal_request_id', v_withdrawal_request_id,
    'amount',                v_available_balance,
    'currency',              p_currency,
    'payment_method',        v_payment_method,
    'status',                'pending_admin_approval'
  );
END;
$$;


-- ---------------------------------------------------------------------------
-- FUNCTION 2: approve_withdrawal_request
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_withdrawal_request(
  p_request_id  UUID,
  p_approved_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_request   RECORD;
  v_payment_id UUID;
BEGIN
  -- Lock the row to prevent concurrent approval/rejection
  SELECT *
  INTO   v_request
  FROM   withdrawal_requests
  WHERE  id = p_request_id
  FOR    UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal request % not found', p_request_id;
  END IF;

  IF v_request.status <> 'pending_admin_approval' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'invalid_status',
      'message', 'Request is not in pending_admin_approval status',
      'status',  v_request.status
    );
  END IF;

  -- Approve the request
  UPDATE withdrawal_requests
  SET    status      = 'approved',
         approved_at = now(),
         approved_by = p_approved_by
  WHERE  id = p_request_id;

  -- Create payment record
  INSERT INTO payments (
    creator_id,
    withdrawal_request_id,
    amount,
    currency,
    payment_method,
    payment_destination_summary,
    status,
    created_at
  )
  VALUES (
    v_request.creator_id,
    p_request_id,
    v_request.amount,
    v_request.currency,
    v_request.payment_method,
    v_request.payment_destination_summary,
    'approved',
    now()
  )
  RETURNING id INTO v_payment_id;

  -- Audit log
  INSERT INTO payment_audit_logs (
    entity_type,
    entity_id,
    action,
    actor_user_id,
    metadata,
    created_at
  )
  VALUES (
    'withdrawal_request',
    p_request_id,
    'withdrawal_approved',
    p_approved_by,
    jsonb_build_object(
      'request_id',  p_request_id,
      'payment_id',  v_payment_id,
      'creator_id',  v_request.creator_id,
      'amount',      v_request.amount,
      'approved_by', p_approved_by
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success',    true,
    'payment_id', v_payment_id,
    'request_id', p_request_id,
    'amount',     v_request.amount
  );
END;
$$;


-- ---------------------------------------------------------------------------
-- FUNCTION 3: reject_withdrawal_request
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_withdrawal_request(
  p_request_id  UUID,
  p_rejected_by UUID,
  p_reason      TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_request RECORD;
BEGIN
  -- Validate rejection reason
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'missing_reason',
      'message', 'A rejection reason is required'
    );
  END IF;

  -- Lock the row
  SELECT *
  INTO   v_request
  FROM   withdrawal_requests
  WHERE  id = p_request_id
  FOR    UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal request % not found', p_request_id;
  END IF;

  IF v_request.status <> 'pending_admin_approval' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'invalid_status',
      'message', 'Request is not in pending_admin_approval status',
      'status',  v_request.status
    );
  END IF;

  -- Reject the request
  UPDATE withdrawal_requests
  SET    status           = 'rejected',
         rejected_at      = now(),
         rejected_by      = p_rejected_by,
         rejection_reason = p_reason
  WHERE  id = p_request_id;

  -- Release locked earnings back to approved so the creator can re-request later
  UPDATE creator_earnings
  SET    status = 'approved'
  WHERE  creator_id = v_request.creator_id
    AND  status = 'withdrawal_requested';

  -- Audit log
  INSERT INTO payment_audit_logs (
    entity_type,
    entity_id,
    action,
    actor_user_id,
    metadata,
    created_at
  )
  VALUES (
    'withdrawal_request',
    p_request_id,
    'withdrawal_rejected',
    p_rejected_by,
    jsonb_build_object(
      'request_id',       p_request_id,
      'creator_id',       v_request.creator_id,
      'amount',           v_request.amount,
      'rejected_by',      p_rejected_by,
      'rejection_reason', p_reason
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success',    true,
    'request_id', p_request_id,
    'status',     'rejected'
  );
END;
$$;


-- ---------------------------------------------------------------------------
-- Sequence for batch numbers (idempotent)
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.batch_number_seq
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;


-- ---------------------------------------------------------------------------
-- FUNCTION 4: create_payout_batch
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_payout_batch(
  p_withdrawal_request_ids UUID[],
  p_generated_by           UUID,
  p_notes                  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_invalid_count   INTEGER;
  v_batch_seq       BIGINT;
  v_batch_number    TEXT;
  v_batch_id        UUID;
  v_total_amount    NUMERIC(10,2);
  v_total_creators  INTEGER;
  v_total_payments  INTEGER;
  v_creator_ids     UUID[];
BEGIN
  -- Guard: empty array
  IF p_withdrawal_request_ids IS NULL OR array_length(p_withdrawal_request_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'p_withdrawal_request_ids must not be empty';
  END IF;

  -- Validate all IDs exist and are in approved status
  SELECT COUNT(*)
  INTO   v_invalid_count
  FROM   unnest(p_withdrawal_request_ids) AS t(id)
  WHERE  NOT EXISTS (
    SELECT 1
    FROM   withdrawal_requests wr
    WHERE  wr.id = t.id
      AND  wr.status = 'approved'
  );

  IF v_invalid_count > 0 THEN
    RETURN jsonb_build_object(
      'success',        false,
      'error',          'invalid_requests',
      'message',        'One or more withdrawal request IDs are invalid or not in approved status',
      'invalid_count',  v_invalid_count
    );
  END IF;

  -- Generate batch number: BATCH-YYYYMMDD-NNN
  v_batch_seq    := nextval('batch_number_seq');
  v_batch_number := 'BATCH-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(v_batch_seq::TEXT, 3, '0');

  -- Aggregate totals from the approved requests
  SELECT
    COALESCE(SUM(wr.amount), 0),
    COUNT(DISTINCT wr.creator_id),
    ARRAY_AGG(DISTINCT wr.creator_id)
  INTO
    v_total_amount,
    v_total_creators,
    v_creator_ids
  FROM withdrawal_requests wr
  WHERE wr.id = ANY(p_withdrawal_request_ids);

  -- Insert payout_batches row
  INSERT INTO payout_batches (
    batch_number,
    status,
    total_amount,
    total_creators,
    generated_by,
    notes,
    created_at
  )
  VALUES (
    v_batch_number,
    'draft',
    v_total_amount,
    v_total_creators,
    p_generated_by,
    p_notes,
    now()
  )
  RETURNING id INTO v_batch_id;

  -- Stamp withdrawal requests
  UPDATE withdrawal_requests
  SET    status   = 'batched',
         batch_id = v_batch_id
  WHERE  id = ANY(p_withdrawal_request_ids);

  -- Stamp linked payments
  UPDATE payments
  SET    status   = 'batched',
         batch_id = v_batch_id
  WHERE  withdrawal_request_id = ANY(p_withdrawal_request_ids);

  GET DIAGNOSTICS v_total_payments = ROW_COUNT;

  -- Stamp creator_earnings
  UPDATE creator_earnings
  SET    status = 'batched'
  WHERE  creator_id = ANY(v_creator_ids)
    AND  status = 'withdrawal_requested';

  -- Audit log
  INSERT INTO payment_audit_logs (
    entity_type,
    entity_id,
    action,
    actor_user_id,
    metadata,
    created_at
  )
  VALUES (
    'payout_batch',
    v_batch_id,
    'batch_created',
    p_generated_by,
    jsonb_build_object(
      'batch_id',                  v_batch_id,
      'batch_number',              v_batch_number,
      'total_amount',              v_total_amount,
      'total_creators',            v_total_creators,
      'withdrawal_request_ids',    p_withdrawal_request_ids,
      'notes',                     p_notes
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success',         true,
    'batch_id',        v_batch_id,
    'batch_number',    v_batch_number,
    'total_amount',    v_total_amount,
    'total_creators',  v_total_creators,
    'total_payments',  v_total_payments
  );
END;
$$;


-- ---------------------------------------------------------------------------
-- FUNCTION 5: mark_payout_batch_paid
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_payout_batch_paid(
  p_batch_id       UUID,
  p_marked_paid_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_batch        RECORD;
  v_creator_ids  UUID[];
  v_paid_count   INTEGER;
  v_total_amount NUMERIC(10,2);
BEGIN
  -- Lock the batch row
  SELECT *
  INTO   v_batch
  FROM   payout_batches
  WHERE  id = p_batch_id
  FOR    UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout batch % not found', p_batch_id;
  END IF;

  IF v_batch.status = 'paid' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'already_paid',
      'message', 'This payout batch has already been marked as paid'
    );
  END IF;

  IF v_batch.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'cancelled',
      'message', 'Cannot mark a cancelled batch as paid'
    );
  END IF;

  -- Collect creator IDs linked to this batch
  SELECT ARRAY_AGG(DISTINCT creator_id)
  INTO   v_creator_ids
  FROM   withdrawal_requests
  WHERE  batch_id = p_batch_id;

  -- Mark the batch paid
  UPDATE payout_batches
  SET    status         = 'paid',
         marked_paid_by = p_marked_paid_by,
         marked_paid_at = now()
  WHERE  id = p_batch_id;

  -- Mark payments paid
  UPDATE payments
  SET    status       = 'paid',
         processed_by = p_marked_paid_by,
         processed_at = now()
  WHERE  batch_id = p_batch_id;

  GET DIAGNOSTICS v_paid_count = ROW_COUNT;

  -- Mark withdrawal requests paid
  UPDATE withdrawal_requests
  SET    status         = 'paid',
         paid_at        = now(),
         marked_paid_by = p_marked_paid_by
  WHERE  batch_id = p_batch_id;

  -- Mark creator_earnings paid
  UPDATE creator_earnings
  SET    status = 'paid'
  WHERE  creator_id = ANY(v_creator_ids)
    AND  status = 'batched';

  v_total_amount := v_batch.total_amount;

  -- Audit log
  INSERT INTO payment_audit_logs (
    entity_type,
    entity_id,
    action,
    actor_user_id,
    metadata,
    created_at
  )
  VALUES (
    'payout_batch',
    p_batch_id,
    'batch_marked_paid',
    p_marked_paid_by,
    jsonb_build_object(
      'batch_id',        p_batch_id,
      'batch_number',    v_batch.batch_number,
      'total_amount',    v_total_amount,
      'paid_count',      v_paid_count,
      'marked_paid_by',  p_marked_paid_by
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success',      true,
    'batch_id',     p_batch_id,
    'paid_count',   v_paid_count,
    'total_amount', v_total_amount
  );
END;
$$;


-- ---------------------------------------------------------------------------
-- Grant EXECUTE to authenticated role (owner/admin callers gate via RLS/app)
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.request_creator_withdrawal(UUID, TEXT, TEXT, TEXT)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_withdrawal_request(UUID, UUID)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_withdrawal_request(UUID, UUID, TEXT)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_payout_batch(UUID[], UUID, TEXT)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_payout_batch_paid(UUID, UUID)                        TO authenticated;
