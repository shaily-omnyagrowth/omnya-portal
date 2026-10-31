-- Omnya production schema as of 2026-10-30. Run once on a fresh Supabase project, then npm run db:migrate.

BEGIN;

SET LOCAL statement_timeout = 0;
SET LOCAL lock_timeout = 0;
SET LOCAL idle_in_transaction_session_timeout = 0;
SET LOCAL client_encoding = 'UTF8';
SET LOCAL standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', true);
SET LOCAL check_function_bodies = false;
SET LOCAL xmloption = content;
SET LOCAL client_min_messages = warning;
SET LOCAL row_security = off;

CREATE FUNCTION public.admin_audit_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION
        'admin_audit_logs is append-only: % is not permitted on entry %.',
        TG_OP, coalesce(OLD.id::text, '(unknown)');
END;
$$;

CREATE FUNCTION public.admin_migration_status(probes jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  hist   jsonb := '[]'::jsonb;
  result jsonb := '[]'::jsonb;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    -- to_jsonb(m)->>'name' rather than m.name: very old CLI versions created
    -- the table without a name column, and a missing column must not turn
    -- the whole panel red.
    SELECT COALESCE(
             jsonb_agg(jsonb_build_object('version', m.version,
                                          'name', to_jsonb(m)->>'name')
                       ORDER BY m.version),
             '[]'::jsonb)
      INTO hist
      FROM supabase_migrations.schema_migrations m;
  END IF;

  IF probes IS NOT NULL AND jsonb_typeof(probes) = 'array' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'file', r.file, 'present', r.present, 'detail', r.detail)), '[]'::jsonb)
      INTO result
      FROM (
        -- PROBE_SELECT (read by api/_lib/migrationProbes.js; keep the markers)
        SELECT p->>'file' AS file,
               COALESCE(CASE p->>'kind'
                 WHEN 'table'    THEN to_regclass(p->>'table') IS NOT NULL
                 WHEN 'index'    THEN to_regclass(p->>'index') IS NOT NULL
                 WHEN 'function' THEN to_regprocedure(p->>'signature') IS NOT NULL
                 WHEN 'function_body' THEN
                   position(p->>'marker' IN pg_get_functiondef(to_regprocedure(p->>'signature'))) > 0
                 WHEN 'columns' THEN (
                   SELECT count(DISTINCT c.column_name) = jsonb_array_length(p->'columns')
                     FROM information_schema.columns c
                    WHERE c.table_schema = split_part(p->>'table', '.', 1)
                      AND c.table_name   = split_part(p->>'table', '.', 2)
                      AND c.column_name IN (SELECT jsonb_array_elements_text(p->'columns')))
                 WHEN 'policy' THEN EXISTS (
                   SELECT 1 FROM pg_policies pp
                    WHERE pp.schemaname = split_part(p->>'table', '.', 1)
                      AND pp.tablename  = split_part(p->>'table', '.', 2)
                      AND pp.policyname = p->>'policy')
                 WHEN 'trigger' THEN EXISTS (
                   SELECT 1 FROM pg_trigger t
                    WHERE t.tgrelid = to_regclass(p->>'table')
                      AND t.tgname  = p->>'trigger')
                 WHEN 'constraint' THEN EXISTS (
                   SELECT 1 FROM pg_constraint k
                    WHERE k.conrelid = to_regclass(p->>'table')
                      AND k.conname  = p->>'constraint')
               END, false) AS present,
               p->>'kind' AS detail
          FROM jsonb_array_elements(probes) AS p
        -- end PROBE_SELECT
      ) r;
  END IF;

  RETURN jsonb_build_object('history', hist, 'probes', result);
END;
$$;

CREATE FUNCTION public.am_may_see_creator(p_creator_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
    SELECT EXISTS (
      SELECT 1
      FROM   public.campaign_creators cc
      JOIN   public.campaigns        ca ON ca.id = cc.campaign_id
      JOIN   public.clients          cl ON cl.id = ca.client_id
      JOIN   public.account_managers am ON am.id = cl.am_id
      WHERE  cc.creator_id = p_creator_id
        AND  am.user_id    = auth.uid()
    );
$$;

CREATE FUNCTION public.am_owns_campaign(p_campaign_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
    SELECT EXISTS (
      SELECT 1
      FROM   public.campaigns        ca
      JOIN   public.clients          cl ON cl.id = ca.client_id
      JOIN   public.account_managers am ON am.id = cl.am_id
      WHERE  ca.id      = p_campaign_id
        AND  am.user_id = auth.uid()
    );
$$;

CREATE FUNCTION public.apply_verified_views(p_submission_id uuid, p_views bigint, p_source text, p_user_id uuid, p_handle text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_id UUID;
BEGIN
    IF p_source IS DISTINCT FROM 'oauth' THEN
        RAISE EXCEPTION 'apply_verified_views: source must be oauth, got %', p_source USING ERRCODE = '22023';
    END IF;
    IF p_views IS NULL OR p_views < 0 THEN
        RAISE EXCEPTION 'apply_verified_views: views must be a non negative number' USING ERRCODE = '22023';
    END IF;

    UPDATE public.submissions s
       SET view_count_verified    = GREATEST(COALESCE(s.view_count_verified, 0), LEAST(p_views, 2147483647))::INTEGER,
           view_count_verified_at = now(),
           verified_views_source  = p_source
     WHERE s.id = p_submission_id
       AND EXISTS (SELECT 1 FROM public.creators c WHERE c.id = s.creator_id AND c.user_id = p_user_id)
    RETURNING s.id INTO v_id;

    RETURN v_id IS NOT NULL;
END;
$$;

CREATE FUNCTION public.approve_withdrawal_request(p_request_id uuid, p_approved_by uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
BEGIN
  PERFORM public.assert_payout_permission('approve_withdrawals');
  -- p_approved_by is deliberately ignored (F-8): the recorded actor is
  -- whoever is actually signed in, not whatever UUID the caller passed.
  RETURN public.approve_withdrawal_request_internal(p_request_id, auth.uid());
END;
$$;

CREATE FUNCTION public.approve_withdrawal_request_internal(p_request_id uuid, p_approved_by uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
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

CREATE FUNCTION public.assert_payout_permission(p_permission text) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
BEGIN
  IF NOT public.has_payout_permission(p_permission) THEN
    RAISE EXCEPTION 'Not authorized: % required', p_permission
      USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE FUNCTION public.audit_account_manager_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
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

CREATE FUNCTION public.audit_campaign_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
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

CREATE FUNCTION public.audit_client_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
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

CREATE FUNCTION public.audit_client_delete() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
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

CREATE FUNCTION public.audit_payment_void() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
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

CREATE FUNCTION public.audit_submission_review() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        PERFORM public.log_admin_action(
            'submission_review', 'submission', NEW.id, NULL,
            OLD.status, NEW.status, NEW.feedback,
            jsonb_build_object('creator_id', NEW.creator_id,
                               'campaign_id', NEW.campaign_id,
                               'submission_type', NEW.submission_type),
            NEW.reviewed_by
        );
    END IF;

    RETURN NEW;
END;
$$;

CREATE FUNCTION public.audit_user_profile_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
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

CREATE FUNCTION public.campaign_creators_sync_array() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_campaign UUID := COALESCE(NEW.campaign_id, OLD.campaign_id);
BEGIN
    IF public.cc_sync_in_progress() THEN
        RETURN NULL;
    END IF;
    PERFORM set_config('omnya.cc_sync', 'on', true);

    UPDATE public.campaigns c
    SET    assigned_creators = COALESCE((
               SELECT array_agg(cc.creator_id ORDER BY cc.creator_id)
               FROM   public.campaign_creators cc
               WHERE  cc.campaign_id = c.id
                 AND  cc.status = 'Approved'
           ), '{}'::uuid[])
    WHERE  c.id = v_campaign;

    IF TG_OP = 'UPDATE' AND OLD.campaign_id IS DISTINCT FROM NEW.campaign_id THEN
        UPDATE public.campaigns c
        SET    assigned_creators = COALESCE((
                   SELECT array_agg(cc.creator_id ORDER BY cc.creator_id)
                   FROM   public.campaign_creators cc
                   WHERE  cc.campaign_id = c.id
                     AND  cc.status = 'Approved'
               ), '{}'::uuid[])
        WHERE  c.id = OLD.campaign_id;
    END IF;

    PERFORM set_config('omnya.cc_sync', 'off', true);
    RETURN NULL;
END;
$$;

CREATE FUNCTION public.campaigns_guard_commission_rates() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() = 'owner' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- A manager creating a campaign gets the defaults, whatever was sent.
    NEW.sales_commission_rate   := 0.30;
    NEW.manager_commission_rate := NULL;
    RETURN NEW;
  END IF;

  IF NEW.sales_commission_rate   IS DISTINCT FROM OLD.sales_commission_rate
  OR NEW.manager_commission_rate IS DISTINCT FROM OLD.manager_commission_rate THEN
    RAISE EXCEPTION 'Only the owner can change commission rates'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.campaigns_sync_campaign_creators() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_valid   UUID[];
    v_dropped BIGINT;
BEGIN
    IF public.cc_sync_in_progress() THEN
        RETURN NULL;
    END IF;
    PERFORM set_config('omnya.cc_sync', 'on', true);

    SELECT COALESCE(array_agg(DISTINCT x.id ORDER BY x.id), '{}'::uuid[])
    INTO   v_valid
    FROM   unnest(COALESCE(NEW.assigned_creators, '{}'::uuid[])) AS x(id)
    WHERE  EXISTS (SELECT 1 FROM public.creators cr WHERE cr.id = x.id);

    SELECT count(DISTINCT x.id)
    INTO   v_dropped
    FROM   unnest(COALESCE(NEW.assigned_creators, '{}'::uuid[])) AS x(id)
    WHERE  NOT EXISTS (SELECT 1 FROM public.creators cr WHERE cr.id = x.id);

    DELETE FROM public.campaign_creators cc
    WHERE  cc.campaign_id = NEW.id
      AND  cc.status = 'Approved'
      AND  NOT (cc.creator_id = ANY (v_valid));

    INSERT INTO public.campaign_creators (campaign_id, creator_id, assigned_by, status, reviewed_by, reviewed_at)
    SELECT NEW.id, x.id, auth.uid(), 'Approved', auth.uid(), now()
    FROM   unnest(v_valid) AS x(id)
    ON CONFLICT (campaign_id, creator_id) DO UPDATE
       SET status      = 'Approved',
           reviewed_by = EXCLUDED.reviewed_by,
           reviewed_at = EXCLUDED.reviewed_at
     WHERE public.campaign_creators.status <> 'Approved';

    UPDATE public.campaigns
    SET    assigned_creators = v_valid
    WHERE  id = NEW.id
      AND  assigned_creators IS DISTINCT FROM v_valid;

    IF v_dropped > 0 THEN
        RAISE WARNING
            'campaigns.assigned_creators on campaign % contained % id(s) with no creators row; they were dropped. Write public.campaign_creators instead.',
            NEW.id, v_dropped;
    END IF;

    PERFORM set_config('omnya.cc_sync', 'off', true);
    RETURN NULL;
END;
$$;

CREATE FUNCTION public.cc_sync_in_progress() RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
    SELECT COALESCE(current_setting('omnya.cc_sync', true), 'off') = 'on';
$$;

COMMENT ON FUNCTION public.cc_sync_in_progress() IS 'True while a campaign_creators <-> campaigns.assigned_creators sync is already running in this transaction. Both mirror triggers bail out on it.';

CREATE FUNCTION public.claim_creator(p_creator_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_am_id UUID;
  v_done  UUID;
BEGIN
  IF public.current_user_role() <> 'am' THEN
    RAISE EXCEPTION 'Only an account manager can claim a creator' USING ERRCODE = '42501';
  END IF;

  SELECT am.id INTO v_am_id
  FROM   public.account_managers am
  WHERE  am.user_id = auth.uid()
  LIMIT  1;

  IF v_am_id IS NULL THEN
    RAISE EXCEPTION 'Your account manager profile is not linked yet' USING ERRCODE = '42501';
  END IF;

  -- am_id IS NULL in the WHERE is the whole point: two managers clicking at
  -- once cannot both win, and nobody can take a creator off a colleague.
  UPDATE public.creators
  SET    am_id = v_am_id
  WHERE  id = p_creator_id
    AND  am_id IS NULL
    AND  archived_at IS NULL
  RETURNING id INTO v_done;

  IF v_done IS NULL THEN
    RAISE EXCEPTION 'That creator is no longer available' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_done;
END;
$$;

CREATE FUNCTION public.client_may_see_creator(p_creator_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
    SELECT EXISTS (
      SELECT 1
      FROM   public.submissions s
      JOIN   public.campaigns   ca ON ca.id = s.campaign_id
      JOIN   public.clients     cl ON cl.id = ca.client_id
      WHERE  s.creator_id = p_creator_id
        AND  cl.user_id   = auth.uid()
        AND  s.status     = 'Approved'
    );
$$;

COMMENT ON FUNCTION public.client_may_see_creator(p_creator_id uuid) IS 'True when the calling client has an approved submission from this creator on one of its own campaigns. SECURITY DEFINER to break the creators <-> campaigns RLS policy cycle -- see 20260822000005 SECTION 2a.';

CREATE FUNCTION public.create_payout_batch(p_withdrawal_request_ids uuid[], p_generated_by uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
BEGIN
  PERFORM public.assert_payout_permission('export_batches');
  RETURN public.create_payout_batch_internal(p_withdrawal_request_ids, auth.uid(), p_notes);
END;
$$;

CREATE FUNCTION public.create_payout_batch_internal(p_withdrawal_request_ids uuid[], p_generated_by uuid, p_notes text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
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

CREATE FUNCTION public.creators_guard_overrides() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() IN ('owner', 'am') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.score_override := NULL;
    NEW.tier_override  := NULL;
    RETURN NEW;
  END IF;

  IF NEW.score_override IS DISTINCT FROM OLD.score_override
  OR NEW.tier_override  IS DISTINCT FROM OLD.tier_override THEN
    RAISE EXCEPTION 'Only the owner or an account manager can set a performance override'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.current_user_role() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT CASE
           WHEN status = 'deactivated' THEN 'deactivated'
           WHEN role   = 'account_manager' THEN 'am'
           ELSE role
         END
  FROM public.user_profiles
  WHERE id = auth.uid();
$$;

COMMENT ON FUNCTION public.current_user_role() IS 'Role of the calling user from user_profiles, normalized so account_manager -> am. Returns ''deactivated'' for a suspended account regardless of role, so a single check disables them across every policy that calls this.';

CREATE FUNCTION public.get_my_payout_role() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    SELECT
        CASE
            WHEN role = 'account_manager' THEN 'am'
            ELSE role
        END
    FROM public.user_profiles
    WHERE id = auth.uid();
$$;

COMMENT ON FUNCTION public.get_my_payout_role() IS 'Returns the normalized role (account_manager -> am) for the calling user from user_profiles. Used by payout-system RLS policies.';

CREATE FUNCTION public.guard_creator_handles() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
    IF current_user::text NOT IN ('authenticated', 'anon') THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' AND (NEW.tiktok_handle IS NOT NULL OR NEW.instagram_handle IS NOT NULL)
       OR TG_OP = 'UPDATE' AND (NEW.tiktok_handle IS DISTINCT FROM OLD.tiktok_handle
                                OR NEW.instagram_handle IS DISTINCT FROM OLD.instagram_handle) THEN
        RAISE EXCEPTION 'Handles come from connected accounts and cannot be edited.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_owner_role() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    IF NEW.role = 'owner'
       AND (TG_OP = 'INSERT' OR OLD.role IS DISTINCT FROM 'owner' OR NEW.email IS DISTINCT FROM OLD.email)
       AND session_user NOT IN ('postgres', 'supabase_admin')
       AND NOT EXISTS (SELECT 1 FROM public.owner_emails o WHERE o.email = lower(NEW.email)) THEN
        RAISE EXCEPTION 'Only an approved owner email can have the owner role.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_profile_self_update() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() = 'owner' THEN
    RETURN NEW;
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.email IS DISTINCT FROM OLD.email
     OR to_jsonb(NEW) -> 'is_active' IS DISTINCT FROM to_jsonb(OLD) -> 'is_active' THEN
    RAISE EXCEPTION 'Only an owner can change role, email or account status'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_verified_view_columns() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
    v_claims TEXT := nullif(current_setting('request.jwt.claims', true), '');
    v_role   TEXT := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                              CASE WHEN v_claims IS NULL THEN NULL ELSE v_claims::jsonb ->> 'role' END);
    v_bad    TEXT;
BEGIN
    IF current_user::text NOT IN ('authenticated','anon')
       AND coalesce(v_role, '') NOT IN ('authenticated','anon') THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        v_bad := CASE
            WHEN coalesce(NEW.view_count_verified, 0) <> 0 THEN 'view_count_verified'
            WHEN NEW.view_count_verified_at IS NOT NULL   THEN 'view_count_verified_at'
            WHEN NEW.verified_views_source  IS NOT NULL   THEN 'verified_views_source'
        END;
    ELSE
        v_bad := CASE
            WHEN NEW.view_count_verified    IS DISTINCT FROM OLD.view_count_verified    THEN 'view_count_verified'
            WHEN NEW.view_count_verified_at IS DISTINCT FROM OLD.view_count_verified_at THEN 'view_count_verified_at'
            WHEN NEW.verified_views_source  IS DISTINCT FROM OLD.verified_views_source  THEN 'verified_views_source'
        END;
    END IF;

    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'Only the server can set submissions.%', v_bad USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.handle_new_client_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    IF NEW.role = 'client' THEN
        INSERT INTO public.clients (name, user_id, created_at)
        VALUES (
            COALESCE(NULLIF(trim(NEW.full_name), ''), NEW.email, 'New Client'),
            NEW.id,
            now()
        )
        ON CONFLICT ON CONSTRAINT clients_user_id_unique DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_client_user() IS 'Auto-provisions a clients row whenever a user_profiles row is inserted or updated with role=''client''. Prevents ClientDashboard infinite spinner.';

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_requested TEXT;
BEGIN
    -- What the signup form asked for, kept as a request and nothing more.
    v_requested := nullif(trim(NEW.raw_user_meta_data ->> 'requested_role'), '');

    IF v_requested IS NULL OR v_requested NOT IN ('creator', 'am', 'account_manager', 'client') THEN
        v_requested := 'creator';
    END IF;

    -- 'account_manager' is the database spelling; 'am' is the UI's. Store the
    -- database spelling so the approval screen and the role checks agree.
    IF v_requested = 'am' THEN
        v_requested := 'account_manager';
    END IF;

    INSERT INTO public.user_profiles (id, email, full_name, role, requested_role)
    VALUES (
        NEW.id,
        NEW.email,
        nullif(trim(NEW.raw_user_meta_data ->> 'full_name'), ''),
        'pending',            -- <- the fix. Never the requested role.
        v_requested
    )
    ON CONFLICT (id) DO NOTHING;   -- signup retries must not error

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS 'Creates the user_profiles row for a new auth.users row with role=''pending''. The role the signup form asked for is recorded in requested_role and granted only by an owner on the Approve Users page (N-20).';

CREATE FUNCTION public.has_payout_permission(p_permission text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'auth'
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

CREATE FUNCTION public.is_payment_manager(p_permission text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
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
$_$;

COMMENT ON FUNCTION public.is_payment_manager(p_permission text) IS 'Returns TRUE if the calling user has an active payment_managers row with the given boolean permission set to TRUE. Allowed values for p_permission: can_view_payouts, can_approve_withdrawals, can_export_batches, can_mark_paid.';

CREATE FUNCTION public.list_unassigned_creators() RETURNS TABLE(id uuid, name text, tiktok_handle text, instagram_handle text, status text, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
    SELECT c.id, c.name, c.tiktok_handle, c.instagram_handle, c.status, c.created_at
    FROM   public.creators c
    WHERE  c.am_id IS NULL
      AND  c.archived_at IS NULL
      AND  public.current_user_role() IN ('owner', 'am')
    ORDER  BY c.created_at DESC NULLS LAST;
$$;

CREATE FUNCTION public.log_admin_action(p_action text, p_entity_type text, p_entity_id uuid, p_entity_label text DEFAULT NULL::text, p_from text DEFAULT NULL::text, p_to text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb, p_actor uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
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

CREATE FUNCTION public.mark_payout_batch_paid(p_batch_id uuid, p_marked_paid_by uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
BEGIN
  PERFORM public.assert_payout_permission('mark_paid');
  RETURN public.mark_payout_batch_paid_internal(p_batch_id, auth.uid());
END;
$$;

CREATE FUNCTION public.mark_payout_batch_paid_internal(p_batch_id uuid, p_marked_paid_by uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
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

CREATE FUNCTION public.payout_ledger_balance(p_creator_id uuid) RETURNS numeric
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
    SELECT coalesce(sum(amount_delta), 0)::NUMERIC
    FROM public.payout_ledger
    WHERE creator_id = p_creator_id
      AND entity_type = 'earning';
$$;

COMMENT ON FUNCTION public.payout_ledger_balance(p_creator_id uuid) IS 'The creator''s payable balance derived purely from the journal. Should equal SUM(amount) over creator_earnings in approved / withdrawal_requested / batched -- see payout_ledger_reconcile().';

CREATE FUNCTION public.payout_ledger_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION
        'payout_ledger is append-only: % is not permitted. To correct entry %, call reverse_ledger_entry(id, reason) -- it appends a reversing row and leaves the original intact.',
        TG_OP,
        coalesce(OLD.id::text, '(unknown)')
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE FUNCTION public.payout_ledger_reconcile(p_creator_id uuid DEFAULT NULL::uuid) RETURNS TABLE(creator_id uuid, ledger_balance numeric, table_balance numeric, drift numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
    WITH ledger AS (
        SELECT l.creator_id, coalesce(sum(l.amount_delta), 0) AS bal
        FROM public.payout_ledger l
        WHERE l.entity_type = 'earning'
          AND (p_creator_id IS NULL OR l.creator_id = p_creator_id)
        GROUP BY l.creator_id
    ),
    tbl AS (
        SELECT e.creator_id, coalesce(sum(e.amount), 0) AS bal
        FROM public.creator_earnings e
        WHERE e.status IN ('approved', 'withdrawal_requested', 'batched')
          AND (p_creator_id IS NULL OR e.creator_id = p_creator_id)
        GROUP BY e.creator_id
    )
    SELECT
        coalesce(ledger.creator_id, tbl.creator_id),
        coalesce(ledger.bal, 0),
        coalesce(tbl.bal, 0),
        coalesce(ledger.bal, 0) - coalesce(tbl.bal, 0)
    FROM ledger
    FULL OUTER JOIN tbl ON tbl.creator_id = ledger.creator_id;
$$;

COMMENT ON FUNCTION public.payout_ledger_reconcile(p_creator_id uuid) IS 'Journal balance vs table balance per creator. drift <> 0 means a status was written without passing through the ledger trigger.';

CREATE FUNCTION public.payout_reconciliation_report() RETURNS TABLE(creator_id uuid, creator_name text, ledger_balance numeric, table_balance numeric, drift numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
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
    $$;

CREATE FUNCTION public.payout_status_weight(p_entity_type text, p_status text) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
    SELECT CASE
        WHEN p_status IS NULL THEN 0
        WHEN p_entity_type = 'earning' AND lower(p_status) IN
             ('approved', 'withdrawal_requested', 'batched') THEN 1
        WHEN p_entity_type = 'withdrawal' AND lower(p_status) IN
             ('pending', 'approved', 'batched') THEN 1
        WHEN p_entity_type = 'payment' AND lower(p_status) IN
             ('pending', 'processing') THEN 1
        ELSE 0
    END;
$$;

COMMENT ON FUNCTION public.payout_status_weight(p_entity_type text, p_status text) IS 'Weight of a status for balance purposes: 1 = owed to the creator and not yet paid out, 0 = otherwise. Used to sign payout_ledger.amount_delta.';

CREATE FUNCTION public.purge_expired_oauth_states() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.oauth_states
  WHERE expires_at < now() - INTERVAL '1 hour';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

CREATE FUNCTION public.rate_limit_hit(p_key text, p_window_secs integer) RETURNS integer
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    INSERT INTO public.rate_limits AS r (key, count, window_ends)
    VALUES (p_key, 1, now() + make_interval(secs => p_window_secs))
    ON CONFLICT (key) DO UPDATE
       SET count       = CASE WHEN r.window_ends <= now() THEN 1 ELSE r.count + 1 END,
           window_ends = CASE WHEN r.window_ends <= now() THEN now() + make_interval(secs => p_window_secs) ELSE r.window_ends END
    RETURNING count;
$$;

CREATE FUNCTION public.record_payout_transition() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_entity    TEXT := TG_ARGV[0];
    v_amount    NUMERIC(12,2);
    v_currency  TEXT;
    v_creator   UUID;
    v_actor     UUID;
    v_role      TEXT;
    v_delta     NUMERIC(12,2);
BEGIN
    -- Nothing to journal if the status did not move.
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
    END IF;

    -- Pull the amount out of whichever column this table calls it. to_jsonb
    -- keeps the function generic across four tables with four different
    -- shapes, without one branch per table.
    v_amount := coalesce(
        (to_jsonb(NEW) ->> 'amount')::NUMERIC,
        (to_jsonb(NEW) ->> 'total_amount')::NUMERIC,
        (to_jsonb(NEW) ->> 'amount_owed')::NUMERIC,
        0
    );
    v_currency := coalesce(to_jsonb(NEW) ->> 'currency', 'USD');
    v_creator  := (to_jsonb(NEW) ->> 'creator_id')::UUID;   -- NULL for batches

    BEGIN
        v_actor := auth.uid();
    EXCEPTION WHEN OTHERS THEN
        v_actor := NULL;    -- applied by a migration or a service job
    END;

    IF v_actor IS NOT NULL THEN
        SELECT role INTO v_role FROM public.user_profiles WHERE id = v_actor;
    END IF;

    v_delta := v_amount * (
        public.payout_status_weight(v_entity, NEW.status)
      - public.payout_status_weight(v_entity, OLD.status)
    );

    INSERT INTO public.payout_ledger (
        entity_type, entity_id, creator_id,
        from_status, to_status,
        amount, amount_delta, currency,
        actor_user_id, actor_role,
        metadata
    ) VALUES (
        v_entity, NEW.id, v_creator,
        OLD.status, NEW.status,
        v_amount, v_delta, v_currency,
        v_actor, v_role,
        jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP)
    );

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.record_payout_transition() IS 'AFTER UPDATE trigger: appends a payout_ledger row whenever status changes. Takes the entity_type as its first trigger argument.';

CREATE FUNCTION public.refuse_hard_delete() RETURNS trigger
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

CREATE FUNCTION public.reject_withdrawal_request(p_request_id uuid, p_rejected_by uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
BEGIN
  PERFORM public.assert_payout_permission('approve_withdrawals');
  RETURN public.reject_withdrawal_request_internal(p_request_id, auth.uid(), p_reason);
END;
$$;

CREATE FUNCTION public.reject_withdrawal_request_internal(p_request_id uuid, p_rejected_by uuid, p_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
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

CREATE FUNCTION public.release_creator(p_creator_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_done UUID;
BEGIN
  IF public.current_user_role() <> 'am' THEN
    RAISE EXCEPTION 'Only an account manager can release a creator' USING ERRCODE = '42501';
  END IF;

  UPDATE public.creators c
  SET    am_id = NULL
  FROM   public.account_managers am
  WHERE  c.id = p_creator_id
    AND  am.id = c.am_id
    AND  am.user_id = auth.uid()
  RETURNING c.id INTO v_done;

  IF v_done IS NULL THEN
    RAISE EXCEPTION 'That creator is not on your roster' USING ERRCODE = '42501';
  END IF;

  RETURN v_done;
END;
$$;

CREATE FUNCTION public.request_creator_withdrawal(p_creator_id uuid, p_currency text DEFAULT 'USD'::text, p_payment_method text DEFAULT NULL::text, p_payment_destination_summary text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
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

CREATE FUNCTION public.reverse_ledger_entry(p_entry_id uuid, p_reason text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_orig public.payout_ledger%ROWTYPE;
    v_new  UUID;
    v_prior UUID;
BEGIN
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'reverse_ledger_entry: a reason is required. An unexplained reversal is worse than no ledger.';
    END IF;

    SELECT * INTO v_orig FROM public.payout_ledger WHERE id = p_entry_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'reverse_ledger_entry: no ledger entry %', p_entry_id;
    END IF;

    IF v_orig.reverses_entry_id IS NOT NULL THEN
        RAISE EXCEPTION 'reverse_ledger_entry: entry % is itself a reversal. Reverse the original instead.', p_entry_id;
    END IF;

    SELECT id INTO v_prior FROM public.payout_ledger WHERE reverses_entry_id = p_entry_id LIMIT 1;
    IF v_prior IS NOT NULL THEN
        RAISE EXCEPTION 'reverse_ledger_entry: entry % has already been reversed by %', p_entry_id, v_prior;
    END IF;

    INSERT INTO public.payout_ledger (
        entity_type, entity_id, creator_id,
        from_status, to_status,
        amount, amount_delta, currency,
        actor_user_id, actor_role, reason,
        reverses_entry_id, metadata
    ) VALUES (
        v_orig.entity_type, v_orig.entity_id, v_orig.creator_id,
        v_orig.to_status, v_orig.from_status,       -- the transition, undone
        v_orig.amount, -v_orig.amount_delta, v_orig.currency,
        auth.uid(),
        (SELECT role FROM public.user_profiles WHERE id = auth.uid()),
        p_reason,
        v_orig.id,
        jsonb_build_object('reversal_of', v_orig.id)
    )
    RETURNING id INTO v_new;

    RETURN v_new;
END;
$$;

COMMENT ON FUNCTION public.reverse_ledger_entry(p_entry_id uuid, p_reason text) IS 'Appends a reversing entry for a ledger row. The original is never modified. Refuses to reverse a reversal, or to reverse twice.';

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.trg_audit_creator_archive() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
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

CREATE FUNCTION public.trg_audit_submission_archive() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
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

SET LOCAL default_tablespace = '';

SET LOCAL default_table_access_method = heap;

CREATE TABLE public.account_managers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    name text NOT NULL,
    email text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    commission_rate numeric DEFAULT 0.1,
    status text DEFAULT 'Active'::text NOT NULL,
    archived_at timestamp with time zone,
    archived_by uuid,
    archive_reason text,
    CONSTRAINT account_managers_status_check CHECK ((status = ANY (ARRAY['Active'::text, 'Archived'::text])))
);

CREATE TABLE public.admin_audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_user_id uuid,
    actor_role text,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    entity_label text,
    from_value text,
    to_value text,
    reason text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.admin_audit_logs IS 'Append-only journal of sensitive non-financial actions (§5.1): role changes, deactivation, restoration, archiving and content review decisions. Written by trigger, never by application code, so a direct UPDATE is recorded too. payment_audit_logs covers the money path.';

CREATE SEQUENCE public.batch_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE public.campaign_analytics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid,
    total_views bigint DEFAULT 0,
    total_spend numeric DEFAULT 0,
    cost_per_view numeric,
    total_submissions integer DEFAULT 0,
    approved_videos integer DEFAULT 0,
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.campaign_creators (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    creator_id uuid NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_by uuid,
    status text DEFAULT 'Approved'::text NOT NULL,
    commitment integer,
    demo_video_url text,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    CONSTRAINT campaign_creators_commitment_check CHECK (((commitment IS NULL) OR ((commitment >= 1) AND (commitment <= 500)))),
    CONSTRAINT campaign_creators_status_check CHECK ((status = ANY (ARRAY['Applied'::text, 'Approved'::text, 'Declined'::text])))
);

COMMENT ON TABLE public.campaign_creators IS 'Authoritative campaign <-> creator assignment. campaigns.assigned_creators is a trigger-maintained mirror of this table and must not be written directly. See 20260822000003_campaign_creators.sql.';

COMMENT ON COLUMN public.campaign_creators.assigned_by IS 'auth.users id of whoever made the assignment. NULL for rows created by the backfill or by a service-role write.';

CREATE TABLE public.campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    client_id uuid,
    description text,
    format text DEFAULT 'TikTok'::text,
    videos_needed integer DEFAULT 10,
    pay_per_video numeric DEFAULT 10,
    deadline date,
    status text DEFAULT 'Open'::text,
    application_type text DEFAULT 'Open Application'::text,
    assigned_creators uuid[] DEFAULT '{}'::uuid[],
    created_at timestamp with time zone DEFAULT now(),
    brief_url text,
    delivery_day text,
    start_date date,
    due_date date,
    is_sales_sourced boolean DEFAULT false,
    archived_at timestamp with time zone,
    archived_by uuid,
    archive_reason text,
    share_token text DEFAULT (gen_random_uuid())::text,
    share_enabled boolean DEFAULT false,
    share_created_at timestamp with time zone DEFAULT now(),
    sales_commission_rate numeric(4,2) DEFAULT 0.30 NOT NULL,
    manager_commission_rate numeric(4,2),
    show_client_cpm boolean DEFAULT false NOT NULL,
    CONSTRAINT campaigns_manager_commission_rate_check CHECK (((manager_commission_rate IS NULL) OR ((manager_commission_rate >= (0)::numeric) AND (manager_commission_rate <= 0.50)))),
    CONSTRAINT campaigns_sales_commission_rate_check CHECK ((sales_commission_rate = ANY (ARRAY[0.10, 0.20, 0.30])))
);

CREATE TABLE public.clients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    deal_type text DEFAULT 'Monthly Retainer'::text,
    videos_per_month integer DEFAULT 20,
    budget numeric DEFAULT 0,
    status text DEFAULT 'Active'::text,
    contact_name text,
    contact_email text,
    contact_phone text,
    contract_terms text,
    drive_link text,
    am_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    description text,
    goals text,
    target_audience text,
    content_guidelines text,
    notes text,
    satisfaction_score integer,
    contract_notes text,
    contract_url text,
    user_id uuid,
    archived_at timestamp with time zone,
    archived_by uuid,
    archive_reason text
);

CREATE TABLE public.creators (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    name text NOT NULL,
    email text NOT NULL,
    tiktok_handle text,
    instagram_handle text,
    status text DEFAULT 'Active'::text,
    weekly_rate numeric DEFAULT 150,
    videos_per_week integer DEFAULT 15,
    payment_status text DEFAULT 'Current'::text,
    am_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    payout_email text,
    payout_preference text DEFAULT 'paypal'::text,
    tier text DEFAULT 'B'::text,
    payment_method text,
    payment_handle text,
    payment_email text,
    bank_name text,
    bank_account_last4 text,
    bank_transfer_notes text,
    zelle_email text,
    zelle_phone_last4 text,
    payment_method_status text DEFAULT 'missing'::text,
    payment_method_updated_at timestamp with time zone,
    stripe_account_id text,
    stripe_account_status text DEFAULT 'not_connected'::text,
    stripe_onboarding_url text,
    stripe_connected_at timestamp with time zone,
    stripe_charges_enabled boolean DEFAULT false,
    stripe_payouts_enabled boolean DEFAULT false,
    stripe_details_submitted boolean DEFAULT false,
    archived_at timestamp with time zone,
    archived_by uuid,
    archive_reason text,
    score_override integer,
    tier_override text,
    CONSTRAINT creators_score_override_check CHECK (((score_override IS NULL) OR ((score_override >= 0) AND (score_override <= 100)))),
    CONSTRAINT creators_tier_override_check CHECK (((tier_override IS NULL) OR (tier_override = ANY (ARRAY['A'::text, 'B'::text, 'C'::text, 'D'::text]))))
);

COMMENT ON COLUMN public.creators.archived_at IS 'When the creator was archived. NULL means active (status governs day-to-day).';

CREATE TABLE public.video_analytics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    platform text NOT NULL,
    creator_id uuid,
    campaign_id uuid,
    submission_id uuid,
    video_id text NOT NULL,
    views bigint DEFAULT 0,
    likes bigint DEFAULT 0,
    comments bigint DEFAULT 0,
    reach bigint DEFAULT 0,
    watch_time numeric,
    pulled_at timestamp with time zone DEFAULT now(),
    user_id uuid,
    video_url text,
    watch_time_seconds bigint DEFAULT 0,
    engagement_rate numeric DEFAULT 0,
    raw_metrics jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE VIEW public.client_safe_analytics WITH (security_invoker='true') AS
 SELECT va.id AS analytics_id,
    va.video_id,
    va.platform,
    va.submission_id,
    va.creator_id,
    cr.name AS creator_name,
    va.campaign_id,
    c.name AS campaign_name,
    c.client_id,
    va.views,
    va.likes,
    va.comments,
    va.reach,
    va.engagement_rate,
    va.pulled_at
   FROM (((public.video_analytics va
     JOIN public.creators cr ON ((va.creator_id = cr.id)))
     JOIN public.campaigns c ON ((va.campaign_id = c.id)))
     JOIN public.clients cl ON ((c.client_id = cl.id)))
  WHERE (cl.user_id = auth.uid());

CREATE VIEW public.client_safe_campaigns WITH (security_invoker='true') AS
 SELECT c.id AS campaign_id,
    c.client_id,
    c.name AS campaign_name,
    c.status AS campaign_status,
    c.brief_url,
    c.created_at,
    c.format,
    c.deadline,
    c.start_date,
    c.videos_needed,
    c.show_client_cpm
   FROM (public.campaigns c
     JOIN public.clients cl ON ((c.client_id = cl.id)))
  WHERE (cl.user_id = auth.uid());

CREATE TABLE public.submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    creator_id uuid,
    campaign_id uuid,
    submission_type text DEFAULT 'Concept'::text,
    concept_link text,
    posted_link text,
    platform text DEFAULT 'TikTok'::text,
    feedback text,
    approved_date date,
    views_24h bigint,
    views_72h bigint,
    views_1w bigint,
    views_2w bigint,
    views_1m bigint,
    likes bigint,
    comments bigint,
    payment_status text DEFAULT 'Unpaid'::text,
    ai_insights jsonb,
    created_at timestamp with time zone DEFAULT now(),
    payout_batch_id uuid,
    notes text,
    submitted_at timestamp with time zone DEFAULT now(),
    reviewed_at timestamp with time zone,
    due_date date,
    analytics_synced_at timestamp with time zone,
    posted_url text,
    posted_at timestamp with time zone,
    view_count_submitted integer DEFAULT 0,
    view_count_verified integer DEFAULT 0,
    view_count_source text DEFAULT 'manual'::text,
    view_count_updated_at timestamp with time zone,
    bonus_snapshot_at timestamp with time zone,
    bonus_locked boolean DEFAULT false,
    bonus_eligible boolean DEFAULT false,
    bonus_forfeited boolean DEFAULT false,
    bonus_forfeit_reason text,
    reviewed_by uuid,
    archived_at timestamp with time zone,
    archived_by uuid,
    archive_reason text,
    status text DEFAULT 'Draft'::text NOT NULL,
    view_count_verified_at timestamp with time zone,
    verified_views_source text,
    thumbnail_url text,
    CONSTRAINT submissions_status_check CHECK ((status = ANY (ARRAY['Draft'::text, 'Submitted'::text, 'Under Review'::text, 'Revision Requested'::text, 'Rejected'::text, 'Approved'::text, 'Published/Tracked'::text, 'Archived'::text])))
);

COMMENT ON COLUMN public.submissions.archived_at IS 'When the submission was archived. NULL means live.';

CREATE VIEW public.client_safe_submissions WITH (security_invoker='true') AS
 SELECT s.id AS submission_id,
    s.campaign_id,
    s.creator_id,
    cr.name AS creator_name,
    s.platform,
    s.submission_type,
    s.status,
    s.posted_link,
    s.created_at
   FROM (((public.submissions s
     JOIN public.campaigns ca ON ((s.campaign_id = ca.id)))
     JOIN public.clients cl ON ((ca.client_id = cl.id)))
     JOIN public.creators cr ON ((s.creator_id = cr.id)))
  WHERE ((cl.user_id = auth.uid()) AND (s.status = 'Approved'::text));

CREATE TABLE public.creator_earnings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    creator_id uuid NOT NULL,
    campaign_id uuid,
    submission_id uuid,
    earning_type text NOT NULL,
    amount numeric(12,2) NOT NULL,
    currency text DEFAULT 'USD'::text,
    status text DEFAULT 'pending'::text,
    description text,
    views_counted integer DEFAULT 0,
    bonus_tier text,
    eligible_at timestamp with time zone,
    locked_at timestamp with time zone,
    approved_at timestamp with time zone,
    approved_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT creator_earnings_amount_non_negative CHECK ((amount >= (0)::numeric)),
    CONSTRAINT creator_earnings_earning_type_check CHECK ((earning_type = ANY (ARRAY['base_video_pay'::text, 'performance_bonus'::text, 'weekly_rate'::text, 'adjustment'::text, 'bonus'::text, 'other'::text]))),
    CONSTRAINT creator_earnings_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'needs_review'::text, 'eligible'::text, 'locked'::text, 'approved'::text, 'withdrawal_requested'::text, 'batched'::text, 'paid'::text, 'forfeited'::text, 'cancelled'::text])))
);

CREATE TABLE public.creator_social_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    creator_id uuid,
    workspace_id uuid,
    platform text NOT NULL,
    platform_user_id text,
    username text,
    display_name text,
    profile_image_url text,
    access_token_encrypted text,
    refresh_token_encrypted text,
    token_expires_at timestamp with time zone,
    refresh_token_expires_at timestamp with time zone,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    connection_status text DEFAULT 'not_connected'::text NOT NULL,
    last_synced_at timestamp with time zone,
    last_error text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT creator_social_accounts_connection_status_check CHECK ((connection_status = ANY (ARRAY['not_connected'::text, 'connected'::text, 'disconnected'::text, 'reauth_required'::text]))),
    CONSTRAINT creator_social_accounts_platform_check CHECK ((platform = ANY (ARRAY['tiktok'::text, 'instagram'::text, 'facebook'::text, 'youtube'::text])))
);

COMMENT ON TABLE public.creator_social_accounts IS 'One connected social account per (user_id, platform). Tokens are stored as AES-256-GCM ciphertext produced by api/_utils/encryption.js. Read from the browser through creator_social_accounts_safe, never from this table.';

COMMENT ON COLUMN public.creator_social_accounts.access_token_encrypted IS 'base64([IV 12B | GCM tag 16B | ciphertext]). Never exposed to anon or to authenticated -- see the column grants in SECTION 7.';

CREATE VIEW public.creator_social_accounts_safe WITH (security_invoker='true') AS
 SELECT id,
    user_id,
    creator_id,
    workspace_id,
    platform,
    platform_user_id,
    username,
    display_name,
    profile_image_url,
    token_expires_at,
    refresh_token_expires_at,
    scopes,
    connection_status,
    last_synced_at,
    last_error,
    metadata,
    created_at,
    updated_at
   FROM public.creator_social_accounts;

CREATE TABLE public.creator_videos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    creator_id uuid,
    workspace_id uuid,
    social_account_id uuid,
    platform text DEFAULT 'tiktok'::text NOT NULL,
    platform_video_id text NOT NULL,
    video_url text,
    caption text,
    thumbnail_url text,
    posted_at timestamp with time zone,
    view_count bigint DEFAULT 0 NOT NULL,
    like_count bigint DEFAULT 0 NOT NULL,
    comment_count bigint DEFAULT 0 NOT NULL,
    duration_seconds integer,
    sync_status text DEFAULT 'synced'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.creator_videos IS 'Latest known state of one published video. The per-pull history lives in video_metrics; this table is overwritten on every sync.';

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid,
    user_id uuid,
    sender_name text,
    content text,
    is_pinned boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    reactions jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE public.oauth_states (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    platform text NOT NULL,
    state_hash text NOT NULL,
    code_verifier text,
    redirect_after text,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);

COMMENT ON TABLE public.oauth_states IS 'Short-lived OAuth state + PKCE verifier store. Server-only; deny-all RLS.';

CREATE TABLE public.owner_emails (
    email text NOT NULL,
    CONSTRAINT owner_emails_email_check CHECK ((email = lower(email)))
);

CREATE TABLE public.payment_audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_user_id uuid,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.payment_managers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    granted_by uuid,
    can_view_payouts boolean DEFAULT true,
    can_approve_withdrawals boolean DEFAULT true,
    can_export_batches boolean DEFAULT true,
    can_mark_paid boolean DEFAULT false,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    creator_id uuid,
    campaign_id uuid,
    submission_id uuid,
    week_ending date,
    videos_approved integer DEFAULT 0,
    amount_owed numeric DEFAULT 0,
    status text DEFAULT 'Pending'::text,
    payment_method text,
    paid_date date,
    created_at timestamp with time zone DEFAULT now(),
    batch_id uuid,
    withdrawal_request_id uuid,
    amount numeric(12,2),
    currency text DEFAULT 'USD'::text,
    payment_reference text,
    payment_destination_summary text,
    processed_by uuid,
    processed_at timestamp with time zone,
    notes text,
    updated_at timestamp with time zone DEFAULT now(),
    stripe_transfer_id text,
    stripe_transfer_status text,
    stripe_transfer_error text,
    stripe_initiated_at timestamp with time zone,
    voided_at timestamp with time zone,
    voided_by uuid,
    void_reason text,
    CONSTRAINT payments_status_payout_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'batched'::text, 'processing'::text, 'paid'::text, 'failed'::text, 'cancelled'::text])))
);

CREATE TABLE public.payout_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    status text DEFAULT 'draft'::text,
    period_start date,
    period_end date,
    total_amount numeric(10,2) DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    paid_at timestamp with time zone,
    period_type text,
    batch_number text,
    currency text DEFAULT 'USD'::text,
    total_creators integer DEFAULT 0,
    total_payments integer DEFAULT 0,
    generated_by uuid,
    generated_at timestamp with time zone DEFAULT now(),
    exported_at timestamp with time zone,
    approved_by uuid,
    approved_at timestamp with time zone,
    marked_paid_by uuid,
    marked_paid_at timestamp with time zone,
    notes text,
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.payout_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    creator_id uuid,
    from_status text,
    to_status text,
    amount numeric(12,2),
    amount_delta numeric(12,2) DEFAULT 0 NOT NULL,
    currency text DEFAULT 'USD'::text,
    actor_user_id uuid,
    actor_role text,
    reason text,
    reverses_entry_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payout_ledger_entity_type_check CHECK ((entity_type = ANY (ARRAY['earning'::text, 'withdrawal'::text, 'payment'::text, 'batch'::text])))
);

COMMENT ON TABLE public.payout_ledger IS 'Append-only journal of every status transition on the money path (F-7). Rows are written by trigger and can never be updated or deleted; a correction is a new reversing row. SUM(amount_delta) per creator is that creator''s payable balance.';

COMMENT ON COLUMN public.payout_ledger.amount_delta IS 'Signed effect on the creator''s payable balance. See the migration header for the weighting rule.';

COMMENT ON COLUMN public.payout_ledger.reverses_entry_id IS 'Set when this row corrects an earlier one. The earlier row is never modified -- that is the point of the table.';

CREATE TABLE public.payout_line_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    batch_id uuid,
    user_id uuid,
    role text,
    amount numeric(10,2) NOT NULL,
    payment_method text,
    payment_details jsonb,
    status text DEFAULT 'pending'::text
);

CREATE TABLE public.rate_limits (
    key text NOT NULL,
    count integer NOT NULL,
    window_ends timestamp with time zone NOT NULL
);

CREATE TABLE public.user_profiles (
    id uuid NOT NULL,
    email text NOT NULL,
    full_name text,
    role text DEFAULT 'pending'::text,
    created_at timestamp with time zone DEFAULT now(),
    requested_role text,
    status text DEFAULT 'active'::text NOT NULL,
    deactivated_at timestamp with time zone,
    deactivated_by uuid,
    deactivation_reason text,
    role_before_deactivation text,
    role_changed_by uuid,
    role_changed_at timestamp with time zone,
    CONSTRAINT user_profiles_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'am'::text, 'account_manager'::text, 'creator'::text, 'client'::text, 'pending'::text, 'denied'::text]))),
    CONSTRAINT user_profiles_status_check CHECK ((status = ANY (ARRAY['active'::text, 'deactivated'::text])))
);

COMMENT ON COLUMN public.user_profiles.status IS 'active | deactivated. Separate from role on purpose: role says what the user may do, status says whether they may do anything at all. Restoring reads role_before_deactivation.';

CREATE TABLE public.video_metrics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    video_id uuid NOT NULL,
    user_id uuid NOT NULL,
    snapshot_at timestamp with time zone DEFAULT now() NOT NULL,
    view_count bigint DEFAULT 0 NOT NULL,
    like_count bigint DEFAULT 0 NOT NULL,
    comment_count bigint DEFAULT 0 NOT NULL,
    engagement_rate numeric,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.video_metrics IS 'Immutable metric snapshots for creator_videos rows. One row per sync.';

CREATE TABLE public.withdrawal_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    creator_id uuid NOT NULL,
    amount numeric(12,2) NOT NULL,
    currency text DEFAULT 'USD'::text,
    status text DEFAULT 'pending_admin_approval'::text,
    payment_method text NOT NULL,
    payment_destination_summary text,
    requested_at timestamp with time zone DEFAULT now(),
    approved_at timestamp with time zone,
    approved_by uuid,
    rejected_at timestamp with time zone,
    rejected_by uuid,
    rejection_reason text,
    batch_id uuid,
    paid_at timestamp with time zone,
    marked_paid_by uuid,
    admin_notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    is_stripe_payout boolean DEFAULT false,
    CONSTRAINT withdrawal_requests_amount_positive CHECK ((amount > (0)::numeric)),
    CONSTRAINT withdrawal_requests_currency_usd_only CHECK ((currency = 'USD'::text)),
    CONSTRAINT withdrawal_requests_status_check CHECK ((status = ANY (ARRAY['pending_admin_approval'::text, 'approved'::text, 'rejected'::text, 'batched'::text, 'paid'::text, 'cancelled'::text])))
);

ALTER TABLE ONLY public.account_managers
    ADD CONSTRAINT account_managers_email_key UNIQUE (email);

ALTER TABLE ONLY public.account_managers
    ADD CONSTRAINT account_managers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.admin_audit_logs
    ADD CONSTRAINT admin_audit_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.campaign_analytics
    ADD CONSTRAINT campaign_analytics_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.campaign_creators
    ADD CONSTRAINT campaign_creators_campaign_creator_key UNIQUE (campaign_id, creator_id);

ALTER TABLE ONLY public.campaign_creators
    ADD CONSTRAINT campaign_creators_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_share_token_key UNIQUE (share_token);

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_user_id_unique UNIQUE (user_id);

ALTER TABLE ONLY public.creator_earnings
    ADD CONSTRAINT creator_earnings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.creator_social_accounts
    ADD CONSTRAINT creator_social_accounts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.creator_social_accounts
    ADD CONSTRAINT creator_social_accounts_user_id_platform_key UNIQUE (user_id, platform);

ALTER TABLE ONLY public.creator_videos
    ADD CONSTRAINT creator_videos_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.creator_videos
    ADD CONSTRAINT creator_videos_user_platform_video_key UNIQUE (user_id, platform, platform_video_id);

ALTER TABLE ONLY public.creators
    ADD CONSTRAINT creators_email_key UNIQUE (email);

ALTER TABLE ONLY public.creators
    ADD CONSTRAINT creators_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.oauth_states
    ADD CONSTRAINT oauth_states_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.owner_emails
    ADD CONSTRAINT owner_emails_pkey PRIMARY KEY (email);

ALTER TABLE ONLY public.payment_audit_logs
    ADD CONSTRAINT payment_audit_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.payment_managers
    ADD CONSTRAINT payment_managers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.payment_managers
    ADD CONSTRAINT payment_managers_user_id_key UNIQUE (user_id);

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.payout_batches
    ADD CONSTRAINT payout_batches_batch_number_unique UNIQUE (batch_number);

ALTER TABLE ONLY public.payout_batches
    ADD CONSTRAINT payout_batches_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.payout_ledger
    ADD CONSTRAINT payout_ledger_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.payout_line_items
    ADD CONSTRAINT payout_line_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.rate_limits
    ADD CONSTRAINT rate_limits_pkey PRIMARY KEY (key);

ALTER TABLE ONLY public.submissions
    ADD CONSTRAINT submissions_pkey PRIMARY KEY (id);

ALTER TABLE public.submissions
    ADD CONSTRAINT submissions_verified_views_source_check CHECK (((verified_views_source IS NULL) OR (verified_views_source = 'oauth'::text))) NOT VALID;

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_email_key UNIQUE (email);

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.video_analytics
    ADD CONSTRAINT video_analytics_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.video_analytics
    ADD CONSTRAINT video_analytics_platform_video_id_key UNIQUE (platform, video_id);

ALTER TABLE ONLY public.video_analytics
    ADD CONSTRAINT video_analytics_submission_id_key UNIQUE (submission_id);

ALTER TABLE ONLY public.video_metrics
    ADD CONSTRAINT video_metrics_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.withdrawal_requests
    ADD CONSTRAINT withdrawal_requests_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX creator_earnings_base_pay_per_submission ON public.creator_earnings USING btree (submission_id) WHERE ((earning_type = 'base_video_pay'::text) AND (submission_id IS NOT NULL));

CREATE UNIQUE INDEX creator_earnings_bonus_per_submission ON public.creator_earnings USING btree (submission_id) WHERE ((earning_type = 'performance_bonus'::text) AND (submission_id IS NOT NULL));

CREATE INDEX idx_admin_audit_actor ON public.admin_audit_logs USING btree (actor_user_id, occurred_at DESC);

CREATE INDEX idx_admin_audit_entity ON public.admin_audit_logs USING btree (entity_type, entity_id, occurred_at DESC);

CREATE INDEX idx_admin_audit_occurred ON public.admin_audit_logs USING btree (occurred_at DESC);

CREATE INDEX idx_campaign_analytics_campaign_id ON public.campaign_analytics USING btree (campaign_id);

CREATE INDEX idx_campaign_creators_campaign_id ON public.campaign_creators USING btree (campaign_id);

CREATE INDEX idx_campaign_creators_creator_id ON public.campaign_creators USING btree (creator_id);

CREATE INDEX idx_campaigns_client_id ON public.campaigns USING btree (client_id);

CREATE INDEX idx_campaigns_share_token ON public.campaigns USING btree (share_token) WHERE (share_token IS NOT NULL);

CREATE INDEX idx_clients_am_id ON public.clients USING btree (am_id);

CREATE UNIQUE INDEX idx_clients_user_id ON public.clients USING btree (user_id) WHERE (user_id IS NOT NULL);

CREATE INDEX idx_creator_earnings_campaign_id ON public.creator_earnings USING btree (campaign_id);

CREATE INDEX idx_creator_earnings_creator_id ON public.creator_earnings USING btree (creator_id);

CREATE INDEX idx_creator_earnings_status ON public.creator_earnings USING btree (status);

CREATE INDEX idx_creator_earnings_submission_id ON public.creator_earnings USING btree (submission_id);

CREATE INDEX idx_creator_social_accounts_creator_id ON public.creator_social_accounts USING btree (creator_id);

CREATE INDEX idx_creator_social_accounts_status ON public.creator_social_accounts USING btree (connection_status);

CREATE INDEX idx_creator_social_accounts_token_expiry ON public.creator_social_accounts USING btree (token_expires_at) WHERE (token_expires_at IS NOT NULL);

CREATE INDEX idx_creator_social_accounts_user_id ON public.creator_social_accounts USING btree (user_id);

CREATE INDEX idx_creator_videos_creator_id ON public.creator_videos USING btree (creator_id);

CREATE INDEX idx_creator_videos_posted_at ON public.creator_videos USING btree (posted_at DESC);

CREATE INDEX idx_creator_videos_social_account_id ON public.creator_videos USING btree (social_account_id);

CREATE INDEX idx_creator_videos_user_id ON public.creator_videos USING btree (user_id);

CREATE INDEX idx_creators_am_id ON public.creators USING btree (am_id);

CREATE UNIQUE INDEX idx_creators_stripe_account_id ON public.creators USING btree (stripe_account_id) WHERE (stripe_account_id IS NOT NULL);

CREATE INDEX idx_messages_campaign_id ON public.messages USING btree (campaign_id);

CREATE INDEX idx_oauth_states_expires_at ON public.oauth_states USING btree (expires_at);

CREATE INDEX idx_oauth_states_state_hash ON public.oauth_states USING btree (state_hash);

CREATE INDEX idx_oauth_states_user_platform ON public.oauth_states USING btree (user_id, platform);

CREATE INDEX idx_payment_audit_logs_action ON public.payment_audit_logs USING btree (action);

CREATE INDEX idx_payment_audit_logs_actor_user_id ON public.payment_audit_logs USING btree (actor_user_id);

CREATE INDEX idx_payment_audit_logs_entity_id ON public.payment_audit_logs USING btree (entity_id);

CREATE INDEX idx_payments_batch_id ON public.payments USING btree (batch_id);

CREATE INDEX idx_payments_batch_id_payout ON public.payments USING btree (batch_id);

CREATE INDEX idx_payments_creator_id ON public.payments USING btree (creator_id);

CREATE INDEX idx_payments_creator_id_payout ON public.payments USING btree (creator_id);

CREATE INDEX idx_payments_status ON public.payments USING btree (status);

CREATE INDEX idx_payments_status_payout ON public.payments USING btree (status);

CREATE INDEX idx_payments_stripe_transfer_id ON public.payments USING btree (stripe_transfer_id) WHERE (stripe_transfer_id IS NOT NULL);

CREATE INDEX idx_payments_withdrawal_request_id ON public.payments USING btree (withdrawal_request_id);

CREATE INDEX idx_payout_batches_period ON public.payout_batches USING btree (period_start, period_end, period_type);

CREATE INDEX idx_payout_batches_status ON public.payout_batches USING btree (status);

CREATE INDEX idx_payout_ledger_creator ON public.payout_ledger USING btree (creator_id, occurred_at DESC);

CREATE INDEX idx_payout_ledger_entity ON public.payout_ledger USING btree (entity_type, entity_id, occurred_at DESC);

CREATE INDEX idx_payout_ledger_occurred ON public.payout_ledger USING btree (occurred_at DESC);

CREATE INDEX idx_payout_ledger_reverses ON public.payout_ledger USING btree (reverses_entry_id) WHERE (reverses_entry_id IS NOT NULL);

CREATE INDEX idx_submissions_campaign_id ON public.submissions USING btree (campaign_id);

CREATE INDEX idx_submissions_creator_id ON public.submissions USING btree (creator_id);

CREATE INDEX idx_submissions_payout_batch_id ON public.submissions USING btree (payout_batch_id);

CREATE INDEX idx_video_analytics_campaign_id ON public.video_analytics USING btree (campaign_id);

CREATE INDEX idx_video_analytics_creator_id ON public.video_analytics USING btree (creator_id);

CREATE INDEX idx_video_analytics_submission_id ON public.video_analytics USING btree (submission_id);

CREATE INDEX idx_video_analytics_user_id ON public.video_analytics USING btree (user_id);

CREATE INDEX idx_video_metrics_user_id ON public.video_metrics USING btree (user_id);

CREATE INDEX idx_video_metrics_video_id ON public.video_metrics USING btree (video_id);

CREATE INDEX idx_video_metrics_video_snapshot ON public.video_metrics USING btree (video_id, snapshot_at DESC);

CREATE INDEX idx_withdrawal_requests_batch_id ON public.withdrawal_requests USING btree (batch_id);

CREATE INDEX idx_withdrawal_requests_creator_id ON public.withdrawal_requests USING btree (creator_id);

CREATE INDEX idx_withdrawal_requests_status ON public.withdrawal_requests USING btree (status);

CREATE TRIGGER on_client_role_assigned AFTER INSERT OR UPDATE OF role ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION public.handle_new_client_user();

CREATE TRIGGER trg_account_managers_no_delete BEFORE DELETE ON public.account_managers FOR EACH ROW EXECUTE FUNCTION public.refuse_hard_delete('scope §11.1: an account manager anchors creator/client assignment history', 'UPDATE account_managers SET status = ''Archived'', archived_at = now(), archived_by = ..., archive_reason = ...');

CREATE TRIGGER trg_admin_audit_immutable BEFORE DELETE OR UPDATE ON public.admin_audit_logs FOR EACH ROW EXECUTE FUNCTION public.admin_audit_immutable();

CREATE TRIGGER trg_audit_account_manager AFTER UPDATE ON public.account_managers FOR EACH ROW EXECUTE FUNCTION public.audit_account_manager_change();

CREATE TRIGGER trg_audit_campaign AFTER UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.audit_campaign_change();

CREATE TRIGGER trg_audit_client AFTER UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.audit_client_change();

CREATE TRIGGER trg_audit_client_delete BEFORE DELETE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.audit_client_delete();

CREATE TRIGGER trg_audit_creator_archive AFTER UPDATE ON public.creators FOR EACH ROW EXECUTE FUNCTION public.trg_audit_creator_archive();

CREATE TRIGGER trg_audit_payment_void AFTER UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.audit_payment_void();

CREATE TRIGGER trg_audit_submission_archive AFTER UPDATE ON public.submissions FOR EACH ROW EXECUTE FUNCTION public.trg_audit_submission_archive();

CREATE TRIGGER trg_audit_submission_review AFTER UPDATE ON public.submissions FOR EACH ROW EXECUTE FUNCTION public.audit_submission_review();

CREATE TRIGGER trg_audit_user_profile AFTER UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION public.audit_user_profile_change();

CREATE TRIGGER trg_campaign_creators_sync_array AFTER INSERT OR DELETE OR UPDATE ON public.campaign_creators FOR EACH ROW EXECUTE FUNCTION public.campaign_creators_sync_array();

CREATE TRIGGER trg_campaigns_guard_commission_rates BEFORE INSERT OR UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.campaigns_guard_commission_rates();

CREATE TRIGGER trg_campaigns_no_delete BEFORE DELETE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.refuse_hard_delete('scope §7.1: a campaign closes or archives, preserving history and financial links', 'UPDATE campaigns SET status = ''Archived'', archived_at = now(), archive_reason = ...');

CREATE TRIGGER trg_campaigns_sync_cc_insert AFTER INSERT ON public.campaigns FOR EACH ROW WHEN (((new.assigned_creators IS NOT NULL) AND (array_length(new.assigned_creators, 1) > 0))) EXECUTE FUNCTION public.campaigns_sync_campaign_creators();

CREATE TRIGGER trg_campaigns_sync_cc_update AFTER UPDATE OF assigned_creators ON public.campaigns FOR EACH ROW WHEN ((new.assigned_creators IS DISTINCT FROM old.assigned_creators)) EXECUTE FUNCTION public.campaigns_sync_campaign_creators();

CREATE TRIGGER trg_creator_earnings_no_delete BEFORE DELETE ON public.creator_earnings FOR EACH ROW EXECUTE FUNCTION public.refuse_hard_delete('scope §9.5: no hard deletion of financial records', 'UPDATE creator_earnings SET status = ''cancelled''');

CREATE TRIGGER trg_creator_earnings_updated_at BEFORE UPDATE ON public.creator_earnings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_creator_social_accounts_updated_at BEFORE UPDATE ON public.creator_social_accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_creator_videos_updated_at BEFORE UPDATE ON public.creator_videos FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_creators_guard_overrides BEFORE INSERT OR UPDATE ON public.creators FOR EACH ROW EXECUTE FUNCTION public.creators_guard_overrides();

CREATE TRIGGER trg_creators_no_delete BEFORE DELETE ON public.creators FOR EACH ROW EXECUTE FUNCTION public.refuse_hard_delete();

CREATE TRIGGER trg_guard_creator_handles BEFORE INSERT OR UPDATE ON public.creators FOR EACH ROW EXECUTE FUNCTION public.guard_creator_handles();

CREATE TRIGGER trg_guard_owner_role BEFORE INSERT OR UPDATE OF role, email ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION public.guard_owner_role();

CREATE TRIGGER trg_guard_profile_self_update BEFORE UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION public.guard_profile_self_update();

CREATE TRIGGER trg_guard_verified_views BEFORE INSERT OR UPDATE ON public.submissions FOR EACH ROW EXECUTE FUNCTION public.guard_verified_view_columns();

CREATE TRIGGER trg_ledger_batch AFTER UPDATE OF status ON public.payout_batches FOR EACH ROW EXECUTE FUNCTION public.record_payout_transition('batch');

CREATE TRIGGER trg_ledger_earning AFTER UPDATE OF status ON public.creator_earnings FOR EACH ROW EXECUTE FUNCTION public.record_payout_transition('earning');

CREATE TRIGGER trg_ledger_payment AFTER UPDATE OF status ON public.payments FOR EACH ROW EXECUTE FUNCTION public.record_payout_transition('payment');

CREATE TRIGGER trg_ledger_withdrawal AFTER UPDATE OF status ON public.withdrawal_requests FOR EACH ROW EXECUTE FUNCTION public.record_payout_transition('withdrawal');

CREATE TRIGGER trg_payment_managers_updated_at BEFORE UPDATE ON public.payment_managers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_payments_no_delete BEFORE DELETE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.refuse_hard_delete('scope §9.5: no hard deletion of financial records', 'UPDATE payments SET status = ''cancelled'', voided_at = now(), void_reason = ...');

CREATE TRIGGER trg_payments_updated_at BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_payout_batches_updated_at BEFORE UPDATE ON public.payout_batches FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_payout_ledger_immutable BEFORE DELETE OR UPDATE ON public.payout_ledger FOR EACH ROW EXECUTE FUNCTION public.payout_ledger_immutable();

CREATE TRIGGER trg_submissions_no_delete BEFORE DELETE ON public.submissions FOR EACH ROW EXECUTE FUNCTION public.refuse_hard_delete();

CREATE TRIGGER trg_user_profiles_no_delete BEFORE DELETE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION public.refuse_hard_delete();

CREATE TRIGGER trg_withdrawal_requests_no_delete BEFORE DELETE ON public.withdrawal_requests FOR EACH ROW EXECUTE FUNCTION public.refuse_hard_delete('scope §9.5: no hard deletion of financial records', 'UPDATE withdrawal_requests SET status = ''cancelled''');

CREATE TRIGGER trg_withdrawal_requests_updated_at BEFORE UPDATE ON public.withdrawal_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE ONLY public.account_managers
    ADD CONSTRAINT account_managers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE ONLY public.campaign_analytics
    ADD CONSTRAINT campaign_analytics_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.campaign_creators
    ADD CONSTRAINT campaign_creators_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.campaign_creators
    ADD CONSTRAINT campaign_creators_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.campaign_creators
    ADD CONSTRAINT campaign_creators_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.creators(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id);

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_am_id_fkey FOREIGN KEY (am_id) REFERENCES public.account_managers(id);

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.creator_earnings
    ADD CONSTRAINT creator_earnings_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.creator_earnings
    ADD CONSTRAINT creator_earnings_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.creator_earnings
    ADD CONSTRAINT creator_earnings_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.creators(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.creator_earnings
    ADD CONSTRAINT creator_earnings_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.submissions(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.creator_social_accounts
    ADD CONSTRAINT creator_social_accounts_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.creators(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.creator_social_accounts
    ADD CONSTRAINT creator_social_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.creator_videos
    ADD CONSTRAINT creator_videos_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.creators(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.creator_videos
    ADD CONSTRAINT creator_videos_social_account_id_fkey FOREIGN KEY (social_account_id) REFERENCES public.creator_social_accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.creator_videos
    ADD CONSTRAINT creator_videos_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.creators
    ADD CONSTRAINT creators_am_id_fkey FOREIGN KEY (am_id) REFERENCES public.account_managers(id);

ALTER TABLE ONLY public.creators
    ADD CONSTRAINT creators_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id);

ALTER TABLE ONLY public.oauth_states
    ADD CONSTRAINT oauth_states_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.payment_audit_logs
    ADD CONSTRAINT payment_audit_logs_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.payment_managers
    ADD CONSTRAINT payment_managers_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.payment_managers
    ADD CONSTRAINT payment_managers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.payout_batches(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id);

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.creators(id);

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_processed_by_fkey FOREIGN KEY (processed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.submissions(id);

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_withdrawal_request_id_fkey FOREIGN KEY (withdrawal_request_id) REFERENCES public.withdrawal_requests(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.payout_batches
    ADD CONSTRAINT payout_batches_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.payout_batches
    ADD CONSTRAINT payout_batches_generated_by_fkey FOREIGN KEY (generated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.payout_batches
    ADD CONSTRAINT payout_batches_marked_paid_by_fkey FOREIGN KEY (marked_paid_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.payout_ledger
    ADD CONSTRAINT payout_ledger_reverses_entry_id_fkey FOREIGN KEY (reverses_entry_id) REFERENCES public.payout_ledger(id);

ALTER TABLE ONLY public.payout_line_items
    ADD CONSTRAINT payout_line_items_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.payout_batches(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.payout_line_items
    ADD CONSTRAINT payout_line_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE ONLY public.submissions
    ADD CONSTRAINT submissions_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id);

ALTER TABLE ONLY public.submissions
    ADD CONSTRAINT submissions_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.creators(id);

ALTER TABLE ONLY public.submissions
    ADD CONSTRAINT submissions_payout_batch_id_fkey FOREIGN KEY (payout_batch_id) REFERENCES public.payout_batches(id);

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id);

ALTER TABLE ONLY public.video_analytics
    ADD CONSTRAINT video_analytics_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id);

ALTER TABLE ONLY public.video_analytics
    ADD CONSTRAINT video_analytics_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.creators(id);

ALTER TABLE ONLY public.video_analytics
    ADD CONSTRAINT video_analytics_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.submissions(id);

ALTER TABLE ONLY public.video_analytics
    ADD CONSTRAINT video_analytics_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.video_metrics
    ADD CONSTRAINT video_metrics_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.video_metrics
    ADD CONSTRAINT video_metrics_video_id_fkey FOREIGN KEY (video_id) REFERENCES public.creator_videos(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.withdrawal_requests
    ADD CONSTRAINT withdrawal_requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.withdrawal_requests
    ADD CONSTRAINT withdrawal_requests_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.payout_batches(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.withdrawal_requests
    ADD CONSTRAINT withdrawal_requests_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.creators(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.withdrawal_requests
    ADD CONSTRAINT withdrawal_requests_marked_paid_by_fkey FOREIGN KEY (marked_paid_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.withdrawal_requests
    ADD CONSTRAINT withdrawal_requests_rejected_by_fkey FOREIGN KEY (rejected_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.account_managers ENABLE ROW LEVEL SECURITY;

CREATE POLICY account_managers_modify_owner ON public.account_managers TO authenticated USING ((public.current_user_role() = 'owner'::text)) WITH CHECK ((public.current_user_role() = 'owner'::text));

CREATE POLICY account_managers_select ON public.account_managers FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR (public.current_user_role() = 'owner'::text) OR (public.current_user_role() = 'am'::text)));

CREATE POLICY admin_audit_am_select ON public.admin_audit_logs FOR SELECT TO authenticated USING (((public.current_user_role() = 'am'::text) AND ((actor_user_id = auth.uid()) OR ((entity_type = 'submission'::text) AND (EXISTS ( SELECT 1
   FROM ((public.submissions s
     JOIN public.creators c ON ((c.id = s.creator_id)))
     JOIN public.account_managers m ON ((m.id = c.am_id)))
  WHERE ((s.id = admin_audit_logs.entity_id) AND (m.user_id = auth.uid()))))))));

CREATE POLICY admin_audit_creator_select ON public.admin_audit_logs FOR SELECT TO authenticated USING (((public.current_user_role() = 'creator'::text) AND (((entity_type = 'user'::text) AND (entity_id = auth.uid())) OR ((entity_type = 'submission'::text) AND (EXISTS ( SELECT 1
   FROM (public.submissions s
     JOIN public.creators c ON ((c.id = s.creator_id)))
  WHERE ((s.id = admin_audit_logs.entity_id) AND (c.user_id = auth.uid()))))))));

ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_audit_owner_select ON public.admin_audit_logs FOR SELECT TO authenticated USING ((public.current_user_role() = 'owner'::text));

ALTER TABLE public.campaign_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY campaign_analytics_staff_select ON public.campaign_analytics FOR SELECT TO authenticated USING (((public.current_user_role() = 'owner'::text) OR ((public.current_user_role() = 'am'::text) AND (EXISTS ( SELECT 1
   FROM ((public.campaigns ca
     JOIN public.clients cl ON ((cl.id = ca.client_id)))
     JOIN public.account_managers am ON ((am.id = cl.am_id)))
  WHERE ((ca.id = campaign_analytics.campaign_id) AND (am.user_id = auth.uid())))))));

ALTER TABLE public.campaign_creators ENABLE ROW LEVEL SECURITY;

CREATE POLICY campaign_creators_creator_apply ON public.campaign_creators FOR INSERT TO authenticated WITH CHECK (((public.current_user_role() = 'creator'::text) AND (status = 'Applied'::text) AND (EXISTS ( SELECT 1
   FROM public.creators c
  WHERE ((c.id = campaign_creators.creator_id) AND (c.user_id = auth.uid()) AND (c.archived_at IS NULL)))) AND (EXISTS ( SELECT 1
   FROM public.campaigns ca
  WHERE ((ca.id = campaign_creators.campaign_id) AND (ca.status = 'Open'::text) AND (ca.application_type = 'Open Application'::text))))));

CREATE POLICY campaign_creators_modify_owner_am ON public.campaign_creators TO authenticated USING (((public.current_user_role() = 'owner'::text) OR ((public.current_user_role() = 'am'::text) AND (EXISTS ( SELECT 1
   FROM ((public.campaigns ca
     JOIN public.clients cl ON ((cl.id = ca.client_id)))
     JOIN public.account_managers am ON ((am.id = cl.am_id)))
  WHERE ((ca.id = campaign_creators.campaign_id) AND (am.user_id = auth.uid()))))))) WITH CHECK (((public.current_user_role() = 'owner'::text) OR ((public.current_user_role() = 'am'::text) AND (EXISTS ( SELECT 1
   FROM ((public.campaigns ca
     JOIN public.clients cl ON ((cl.id = ca.client_id)))
     JOIN public.account_managers am ON ((am.id = cl.am_id)))
  WHERE ((ca.id = campaign_creators.campaign_id) AND (am.user_id = auth.uid())))))));

CREATE POLICY campaign_creators_select_scoped ON public.campaign_creators FOR SELECT TO authenticated USING (((public.current_user_role() = 'owner'::text) OR ((public.current_user_role() = 'am'::text) AND (EXISTS ( SELECT 1
   FROM ((public.campaigns ca
     JOIN public.clients cl ON ((cl.id = ca.client_id)))
     JOIN public.account_managers am ON ((am.id = cl.am_id)))
  WHERE ((ca.id = campaign_creators.campaign_id) AND (am.user_id = auth.uid()))))) OR ((public.current_user_role() = 'creator'::text) AND (EXISTS ( SELECT 1
   FROM public.creators c
  WHERE ((c.id = campaign_creators.creator_id) AND (c.user_id = auth.uid())))))));

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY campaigns_modify_owner_or_am ON public.campaigns TO authenticated USING (((public.current_user_role() = 'owner'::text) OR ((public.current_user_role() = 'am'::text) AND (EXISTS ( SELECT 1
   FROM (public.clients cl
     JOIN public.account_managers am ON ((cl.am_id = am.id)))
  WHERE ((cl.id = campaigns.client_id) AND (am.user_id = auth.uid()))))))) WITH CHECK (((public.current_user_role() = 'owner'::text) OR ((public.current_user_role() = 'am'::text) AND (EXISTS ( SELECT 1
   FROM (public.clients cl
     JOIN public.account_managers am ON ((cl.am_id = am.id)))
  WHERE ((cl.id = campaigns.client_id) AND (am.user_id = auth.uid())))))));

CREATE POLICY campaigns_select_open_jobs ON public.campaigns FOR SELECT TO authenticated USING (((public.current_user_role() = 'creator'::text) AND (status = 'Open'::text) AND (application_type = 'Open Application'::text)));

CREATE POLICY campaigns_select_scoped ON public.campaigns FOR SELECT TO authenticated USING (((public.current_user_role() = 'owner'::text) OR ((public.current_user_role() = 'am'::text) AND (EXISTS ( SELECT 1
   FROM (public.clients cl
     JOIN public.account_managers am ON ((cl.am_id = am.id)))
  WHERE ((cl.id = campaigns.client_id) AND (am.user_id = auth.uid()))))) OR ((public.current_user_role() = 'creator'::text) AND (EXISTS ( SELECT 1
   FROM public.creators c
  WHERE ((c.user_id = auth.uid()) AND (c.id = ANY (campaigns.assigned_creators))))))));

CREATE POLICY client_select_creators_on_own_campaigns ON public.creators FOR SELECT TO authenticated USING (((public.current_user_role() = 'client'::text) AND public.client_may_see_creator(id)));

CREATE POLICY client_select_own_analytics ON public.video_analytics FOR SELECT TO authenticated USING (((public.current_user_role() = 'client'::text) AND (EXISTS ( SELECT 1
   FROM ((public.submissions s
     JOIN public.campaigns ca ON ((ca.id = s.campaign_id)))
     JOIN public.clients cl ON ((cl.id = ca.client_id)))
  WHERE ((s.id = video_analytics.submission_id) AND (cl.user_id = auth.uid()))))));

CREATE POLICY client_select_own_campaigns ON public.campaigns FOR SELECT TO authenticated USING (((public.current_user_role() = 'client'::text) AND (EXISTS ( SELECT 1
   FROM public.clients cl
  WHERE ((cl.user_id = auth.uid()) AND (cl.id = campaigns.client_id))))));

CREATE POLICY client_select_own_profile ON public.clients FOR SELECT TO authenticated USING (((public.current_user_role() = 'client'::text) AND (user_id = auth.uid())));

CREATE POLICY client_select_own_submissions ON public.submissions FOR SELECT TO authenticated USING (((public.current_user_role() = 'client'::text) AND (EXISTS ( SELECT 1
   FROM (public.campaigns c
     JOIN public.clients cl ON ((c.client_id = cl.id)))
  WHERE ((cl.user_id = auth.uid()) AND (c.id = submissions.campaign_id))))));

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY clients_delete_owner ON public.clients FOR DELETE TO authenticated USING ((public.current_user_role() = 'owner'::text));

CREATE POLICY clients_modify_owner ON public.clients TO authenticated USING ((public.current_user_role() = 'owner'::text)) WITH CHECK ((public.current_user_role() = 'owner'::text));

CREATE POLICY clients_select_scoped ON public.clients FOR SELECT TO authenticated USING (((public.current_user_role() = 'owner'::text) OR ((public.current_user_role() = 'am'::text) AND (EXISTS ( SELECT 1
   FROM public.account_managers am
  WHERE ((am.id = clients.am_id) AND (am.user_id = auth.uid())))))));

ALTER TABLE public.creator_earnings ENABLE ROW LEVEL SECURITY;

CREATE POLICY creator_earnings_am_select ON public.creator_earnings FOR SELECT TO authenticated USING (((public.get_my_payout_role() = ANY (ARRAY['am'::text, 'account_manager'::text])) AND (EXISTS ( SELECT 1
   FROM (public.creators cr
     JOIN public.account_managers am ON ((cr.am_id = am.id)))
  WHERE ((cr.id = creator_earnings.creator_id) AND (am.user_id = auth.uid()))))));

CREATE POLICY creator_earnings_creator_select ON public.creator_earnings FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.creators cr
  WHERE ((cr.id = creator_earnings.creator_id) AND (cr.user_id = auth.uid())))));

CREATE POLICY creator_earnings_owner_delete ON public.creator_earnings FOR DELETE TO authenticated USING ((public.get_my_payout_role() = 'owner'::text));

CREATE POLICY creator_earnings_owner_insert ON public.creator_earnings FOR INSERT TO authenticated WITH CHECK ((public.get_my_payout_role() = 'owner'::text));

CREATE POLICY creator_earnings_owner_pm_select ON public.creator_earnings FOR SELECT TO authenticated USING (((public.get_my_payout_role() = 'owner'::text) OR public.is_payment_manager('can_view_payouts'::text)));

CREATE POLICY creator_earnings_owner_update ON public.creator_earnings FOR UPDATE TO authenticated USING ((public.get_my_payout_role() = 'owner'::text)) WITH CHECK ((public.get_my_payout_role() = 'owner'::text));

ALTER TABLE public.creator_social_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY creator_social_accounts_delete_self ON public.creator_social_accounts FOR DELETE TO authenticated USING (((user_id = auth.uid()) OR (public.current_user_role() = 'owner'::text)));

CREATE POLICY creator_social_accounts_insert_self ON public.creator_social_accounts FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) OR (public.current_user_role() = 'owner'::text)));

CREATE POLICY creator_social_accounts_select_am ON public.creator_social_accounts FOR SELECT TO authenticated USING (((public.current_user_role() = 'am'::text) AND (EXISTS ( SELECT 1
   FROM (public.creators c
     JOIN public.account_managers am ON ((am.id = c.am_id)))
  WHERE ((am.user_id = auth.uid()) AND ((c.user_id = creator_social_accounts.user_id) OR (c.id = creator_social_accounts.creator_id)))))));

CREATE POLICY creator_social_accounts_select_owner_pm ON public.creator_social_accounts FOR SELECT TO authenticated USING (((public.current_user_role() = 'owner'::text) OR public.is_payment_manager('can_view_payouts'::text)));

CREATE POLICY creator_social_accounts_select_self ON public.creator_social_accounts FOR SELECT TO authenticated USING ((user_id = auth.uid()));

CREATE POLICY creator_social_accounts_update_self ON public.creator_social_accounts FOR UPDATE TO authenticated USING (((user_id = auth.uid()) OR (public.current_user_role() = 'owner'::text))) WITH CHECK (((user_id = auth.uid()) OR (public.current_user_role() = 'owner'::text)));

ALTER TABLE public.creator_videos ENABLE ROW LEVEL SECURITY;

CREATE POLICY creator_videos_delete_self ON public.creator_videos FOR DELETE TO authenticated USING (((user_id = auth.uid()) OR (public.current_user_role() = 'owner'::text)));

CREATE POLICY creator_videos_insert_self ON public.creator_videos FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) OR (public.current_user_role() = 'owner'::text)));

CREATE POLICY creator_videos_select_am ON public.creator_videos FOR SELECT TO authenticated USING (((public.current_user_role() = 'am'::text) AND (EXISTS ( SELECT 1
   FROM (public.creators c
     JOIN public.account_managers am ON ((am.id = c.am_id)))
  WHERE ((am.user_id = auth.uid()) AND ((c.user_id = creator_videos.user_id) OR (c.id = creator_videos.creator_id)))))));

CREATE POLICY creator_videos_select_owner_pm ON public.creator_videos FOR SELECT TO authenticated USING (((public.current_user_role() = 'owner'::text) OR public.is_payment_manager('can_view_payouts'::text)));

CREATE POLICY creator_videos_select_self ON public.creator_videos FOR SELECT TO authenticated USING ((user_id = auth.uid()));

CREATE POLICY creator_videos_update_self ON public.creator_videos FOR UPDATE TO authenticated USING (((user_id = auth.uid()) OR (public.current_user_role() = 'owner'::text))) WITH CHECK (((user_id = auth.uid()) OR (public.current_user_role() = 'owner'::text)));

ALTER TABLE public.creators ENABLE ROW LEVEL SECURITY;

CREATE POLICY creators_insert_self_or_staff ON public.creators FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) OR (public.current_user_role() = ANY (ARRAY['owner'::text, 'am'::text]))));

CREATE POLICY creators_select_am_campaign ON public.creators FOR SELECT TO authenticated USING (((public.current_user_role() = 'am'::text) AND public.am_may_see_creator(id)));

CREATE POLICY creators_select_scoped ON public.creators FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR (public.current_user_role() = 'owner'::text) OR ((public.current_user_role() = 'am'::text) AND (EXISTS ( SELECT 1
   FROM public.account_managers am
  WHERE ((am.id = creators.am_id) AND (am.user_id = auth.uid())))))));

CREATE POLICY creators_update_scoped ON public.creators FOR UPDATE TO authenticated USING (((user_id = auth.uid()) OR (public.current_user_role() = 'owner'::text) OR ((public.current_user_role() = 'am'::text) AND (EXISTS ( SELECT 1
   FROM public.account_managers am
  WHERE ((am.id = creators.am_id) AND (am.user_id = auth.uid()))))))) WITH CHECK (((public.current_user_role() = ANY (ARRAY['owner'::text, 'am'::text])) OR (user_id = auth.uid())));

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY messages_delete_self_or_owner ON public.messages FOR DELETE TO authenticated USING (((user_id = auth.uid()) OR (public.current_user_role() = 'owner'::text)));

CREATE POLICY messages_insert_self ON public.messages FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.campaigns ca
  WHERE ((ca.id = messages.campaign_id) AND ((public.current_user_role() = 'owner'::text) OR ((public.current_user_role() = 'am'::text) AND (EXISTS ( SELECT 1
           FROM (public.clients cl
             JOIN public.account_managers am ON ((cl.am_id = am.id)))
          WHERE ((cl.id = ca.client_id) AND (am.user_id = auth.uid()))))) OR ((public.current_user_role() = 'creator'::text) AND (EXISTS ( SELECT 1
           FROM public.creators c
          WHERE ((c.user_id = auth.uid()) AND (c.id = ANY (ca.assigned_creators))))))))))));

CREATE POLICY messages_select_by_campaign ON public.messages FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.campaigns ca
  WHERE ((ca.id = messages.campaign_id) AND ((public.current_user_role() = 'owner'::text) OR ((public.current_user_role() = 'am'::text) AND (EXISTS ( SELECT 1
           FROM (public.clients cl
             JOIN public.account_managers am ON ((cl.am_id = am.id)))
          WHERE ((cl.id = ca.client_id) AND (am.user_id = auth.uid()))))) OR ((public.current_user_role() = 'creator'::text) AND (EXISTS ( SELECT 1
           FROM public.creators c
          WHERE ((c.user_id = auth.uid()) AND (c.id = ANY (ca.assigned_creators)))))))))));

CREATE POLICY messages_update_self_or_owner ON public.messages FOR UPDATE TO authenticated USING (((user_id = auth.uid()) OR (public.current_user_role() = 'owner'::text))) WITH CHECK (((user_id = auth.uid()) OR (public.current_user_role() = 'owner'::text)));

ALTER TABLE public.oauth_states ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.owner_emails ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.payment_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY payment_audit_logs_owner_select ON public.payment_audit_logs FOR SELECT TO authenticated USING ((public.get_my_payout_role() = 'owner'::text));

ALTER TABLE public.payment_managers ENABLE ROW LEVEL SECURITY;

CREATE POLICY payment_managers_owner_delete ON public.payment_managers FOR DELETE TO authenticated USING ((public.get_my_payout_role() = 'owner'::text));

CREATE POLICY payment_managers_owner_insert ON public.payment_managers FOR INSERT TO authenticated WITH CHECK ((public.get_my_payout_role() = 'owner'::text));

CREATE POLICY payment_managers_owner_select ON public.payment_managers FOR SELECT TO authenticated USING ((public.get_my_payout_role() = 'owner'::text));

CREATE POLICY payment_managers_owner_update ON public.payment_managers FOR UPDATE TO authenticated USING ((public.get_my_payout_role() = 'owner'::text)) WITH CHECK ((public.get_my_payout_role() = 'owner'::text));

CREATE POLICY payment_managers_self_select ON public.payment_managers FOR SELECT TO authenticated USING ((user_id = auth.uid()));

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY payments_am_insert_own_campaign ON public.payments FOR INSERT TO authenticated WITH CHECK (((public.current_user_role() = 'am'::text) AND (status = 'pending'::text) AND public.am_owns_campaign(campaign_id) AND (EXISTS ( SELECT 1
   FROM public.campaigns ca
  WHERE ((ca.id = payments.campaign_id) AND (COALESCE(payments.amount_owed, (0)::numeric) <= (COALESCE(ca.pay_per_video, (0)::numeric) * (GREATEST(COALESCE(payments.videos_approved, 1), 1))::numeric)))))));

CREATE POLICY payments_am_select ON public.payments FOR SELECT TO authenticated USING (((public.get_my_payout_role() = ANY (ARRAY['am'::text, 'account_manager'::text])) AND (EXISTS ( SELECT 1
   FROM (public.creators cr
     JOIN public.account_managers am ON ((cr.am_id = am.id)))
  WHERE ((cr.id = payments.creator_id) AND (am.user_id = auth.uid()))))));

CREATE POLICY payments_creator_select ON public.payments FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.creators cr
  WHERE ((cr.id = payments.creator_id) AND (cr.user_id = auth.uid())))));

CREATE POLICY payments_owner_delete ON public.payments FOR DELETE TO authenticated USING ((public.get_my_payout_role() = 'owner'::text));

CREATE POLICY payments_owner_pm_insert ON public.payments FOR INSERT TO authenticated WITH CHECK (((public.get_my_payout_role() = 'owner'::text) OR public.is_payment_manager('can_export_batches'::text)));

CREATE POLICY payments_owner_pm_select ON public.payments FOR SELECT TO authenticated USING (((public.get_my_payout_role() = 'owner'::text) OR public.is_payment_manager('can_view_payouts'::text)));

CREATE POLICY payments_owner_pm_update ON public.payments FOR UPDATE TO authenticated USING (((public.get_my_payout_role() = 'owner'::text) OR public.is_payment_manager('can_mark_paid'::text))) WITH CHECK (((public.get_my_payout_role() = 'owner'::text) OR public.is_payment_manager('can_mark_paid'::text)));

CREATE POLICY payments_select_scoped ON public.payments FOR SELECT TO authenticated USING (((public.current_user_role() = 'owner'::text) OR (EXISTS ( SELECT 1
   FROM public.creators c
  WHERE ((c.id = payments.creator_id) AND (c.user_id = auth.uid())))) OR ((public.current_user_role() = 'am'::text) AND (EXISTS ( SELECT 1
   FROM (public.creators c
     JOIN public.account_managers am ON ((c.am_id = am.id)))
  WHERE ((c.id = payments.creator_id) AND (am.user_id = auth.uid())))))));

ALTER TABLE public.payout_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY payout_batches_modify_owner ON public.payout_batches TO authenticated USING ((public.current_user_role() = 'owner'::text)) WITH CHECK ((public.current_user_role() = 'owner'::text));

CREATE POLICY payout_batches_owner_delete ON public.payout_batches FOR DELETE TO authenticated USING ((public.get_my_payout_role() = 'owner'::text));

CREATE POLICY payout_batches_owner_pm_insert ON public.payout_batches FOR INSERT TO authenticated WITH CHECK (((public.get_my_payout_role() = 'owner'::text) OR public.is_payment_manager('can_export_batches'::text)));

CREATE POLICY payout_batches_owner_pm_select ON public.payout_batches FOR SELECT TO authenticated USING (((public.get_my_payout_role() = 'owner'::text) OR public.is_payment_manager('can_view_payouts'::text)));

CREATE POLICY payout_batches_owner_pm_update ON public.payout_batches FOR UPDATE TO authenticated USING (((public.get_my_payout_role() = 'owner'::text) OR public.is_payment_manager('can_mark_paid'::text))) WITH CHECK (((public.get_my_payout_role() = 'owner'::text) OR public.is_payment_manager('can_mark_paid'::text)));

CREATE POLICY payout_batches_select_owner_or_am ON public.payout_batches FOR SELECT TO authenticated USING ((public.current_user_role() = ANY (ARRAY['owner'::text, 'am'::text])));

ALTER TABLE public.payout_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY payout_ledger_creator_select ON public.payout_ledger FOR SELECT USING ((creator_id IN ( SELECT c.id
   FROM public.creators c
  WHERE (c.user_id = auth.uid()))));

CREATE POLICY payout_ledger_owner_pm_select ON public.payout_ledger FOR SELECT USING (((public.get_my_payout_role() = 'owner'::text) OR public.is_payment_manager('can_view_payouts'::text)));

ALTER TABLE public.payout_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY payout_line_items_owner_only ON public.payout_line_items TO authenticated USING ((public.current_user_role() = 'owner'::text)) WITH CHECK ((public.current_user_role() = 'owner'::text));

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY submissions_insert_scoped ON public.submissions FOR INSERT TO authenticated WITH CHECK (((public.current_user_role() = 'owner'::text) OR (EXISTS ( SELECT 1
   FROM public.creators c
  WHERE ((c.id = submissions.creator_id) AND (c.user_id = auth.uid())))) OR ((public.current_user_role() = 'am'::text) AND (EXISTS ( SELECT 1
   FROM (public.creators c
     JOIN public.account_managers am ON ((c.am_id = am.id)))
  WHERE ((c.id = submissions.creator_id) AND (am.user_id = auth.uid())))))));

CREATE POLICY submissions_select_am_campaign ON public.submissions FOR SELECT TO authenticated USING (((public.current_user_role() = 'am'::text) AND public.am_owns_campaign(campaign_id)));

CREATE POLICY submissions_select_scoped ON public.submissions FOR SELECT TO authenticated USING (((public.current_user_role() = 'owner'::text) OR (EXISTS ( SELECT 1
   FROM public.creators c
  WHERE ((c.id = submissions.creator_id) AND (c.user_id = auth.uid())))) OR ((public.current_user_role() = 'am'::text) AND (EXISTS ( SELECT 1
   FROM (public.creators c
     JOIN public.account_managers am ON ((c.am_id = am.id)))
  WHERE ((c.id = submissions.creator_id) AND (am.user_id = auth.uid())))))));

CREATE POLICY submissions_update_am_campaign ON public.submissions FOR UPDATE TO authenticated USING (((public.current_user_role() = 'am'::text) AND public.am_owns_campaign(campaign_id))) WITH CHECK (((public.current_user_role() = 'am'::text) AND public.am_owns_campaign(campaign_id)));

CREATE POLICY submissions_update_scoped ON public.submissions FOR UPDATE TO authenticated USING (((public.current_user_role() = 'owner'::text) OR (EXISTS ( SELECT 1
   FROM public.creators c
  WHERE ((c.id = submissions.creator_id) AND (c.user_id = auth.uid())))) OR ((public.current_user_role() = 'am'::text) AND (EXISTS ( SELECT 1
   FROM (public.creators c
     JOIN public.account_managers am ON ((c.am_id = am.id)))
  WHERE ((c.id = submissions.creator_id) AND (am.user_id = auth.uid()))))))) WITH CHECK (((public.current_user_role() = 'owner'::text) OR (EXISTS ( SELECT 1
   FROM public.creators c
  WHERE ((c.id = submissions.creator_id) AND (c.user_id = auth.uid())))) OR ((public.current_user_role() = 'am'::text) AND (EXISTS ( SELECT 1
   FROM (public.creators c
     JOIN public.account_managers am ON ((c.am_id = am.id)))
  WHERE ((c.id = submissions.creator_id) AND (am.user_id = auth.uid())))))));

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_profiles_insert_self_or_owner ON public.user_profiles FOR INSERT TO authenticated WITH CHECK (((public.current_user_role() = 'owner'::text) OR ((id = auth.uid()) AND (role = ANY (ARRAY['pending'::text, 'client'::text])))));

COMMENT ON POLICY user_profiles_insert_self_or_owner ON public.user_profiles IS 'Allows self-insert only for pending/client roles. Blocks self-promotion to owner, am, or account_manager. Owners can insert any row for provisioning.';

CREATE POLICY user_profiles_select_self_or_scoped ON public.user_profiles FOR SELECT TO authenticated USING (((id = auth.uid()) OR (public.current_user_role() = 'owner'::text) OR ((public.current_user_role() = 'am'::text) AND (EXISTS ( SELECT 1
   FROM (public.creators c
     JOIN public.account_managers am ON ((c.am_id = am.id)))
  WHERE ((c.user_id = user_profiles.id) AND (am.user_id = auth.uid())))))));

CREATE POLICY user_profiles_update_self_or_owner ON public.user_profiles FOR UPDATE TO authenticated USING (((id = auth.uid()) OR (public.current_user_role() = 'owner'::text))) WITH CHECK (((public.current_user_role() = 'owner'::text) OR ((id = auth.uid()) AND (role = ANY (ARRAY['pending'::text, 'creator'::text, 'am'::text, 'account_manager'::text, 'denied'::text])))));

ALTER TABLE public.video_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY video_analytics_select_scoped ON public.video_analytics FOR SELECT TO authenticated USING (((public.current_user_role() = 'owner'::text) OR (EXISTS ( SELECT 1
   FROM (public.submissions s
     JOIN public.creators c ON ((c.id = s.creator_id)))
  WHERE ((s.id = video_analytics.submission_id) AND (c.user_id = auth.uid())))) OR ((public.current_user_role() = 'am'::text) AND (EXISTS ( SELECT 1
   FROM ((public.submissions s
     JOIN public.creators c ON ((c.id = s.creator_id)))
     JOIN public.account_managers am ON ((c.am_id = am.id)))
  WHERE ((s.id = video_analytics.submission_id) AND (am.user_id = auth.uid())))))));

ALTER TABLE public.video_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY video_metrics_insert_self ON public.video_metrics FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) OR (public.current_user_role() = 'owner'::text)));

CREATE POLICY video_metrics_select_am ON public.video_metrics FOR SELECT TO authenticated USING (((public.current_user_role() = 'am'::text) AND (EXISTS ( SELECT 1
   FROM (public.creators c
     JOIN public.account_managers am ON ((am.id = c.am_id)))
  WHERE ((am.user_id = auth.uid()) AND (c.user_id = video_metrics.user_id))))));

CREATE POLICY video_metrics_select_owner_pm ON public.video_metrics FOR SELECT TO authenticated USING (((public.current_user_role() = 'owner'::text) OR public.is_payment_manager('can_view_payouts'::text)));

CREATE POLICY video_metrics_select_self ON public.video_metrics FOR SELECT TO authenticated USING ((user_id = auth.uid()));

ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY withdrawal_requests_am_select ON public.withdrawal_requests FOR SELECT TO authenticated USING (((public.get_my_payout_role() = ANY (ARRAY['am'::text, 'account_manager'::text])) AND (EXISTS ( SELECT 1
   FROM (public.creators cr
     JOIN public.account_managers am ON ((cr.am_id = am.id)))
  WHERE ((cr.id = withdrawal_requests.creator_id) AND (am.user_id = auth.uid()))))));

CREATE POLICY withdrawal_requests_creator_cancel ON public.withdrawal_requests FOR UPDATE TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.creators cr
  WHERE ((cr.id = withdrawal_requests.creator_id) AND (cr.user_id = auth.uid())))) AND (public.get_my_payout_role() = 'creator'::text) AND (status = 'pending_admin_approval'::text))) WITH CHECK ((status = 'cancelled'::text));

CREATE POLICY withdrawal_requests_creator_insert ON public.withdrawal_requests FOR INSERT TO authenticated WITH CHECK (((EXISTS ( SELECT 1
   FROM public.creators cr
  WHERE ((cr.id = withdrawal_requests.creator_id) AND (cr.user_id = auth.uid())))) AND (public.get_my_payout_role() = 'creator'::text)));

CREATE POLICY withdrawal_requests_creator_select ON public.withdrawal_requests FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.creators cr
  WHERE ((cr.id = withdrawal_requests.creator_id) AND (cr.user_id = auth.uid())))));

CREATE POLICY withdrawal_requests_owner_delete ON public.withdrawal_requests FOR DELETE TO authenticated USING ((public.get_my_payout_role() = 'owner'::text));

CREATE POLICY withdrawal_requests_owner_pm_insert ON public.withdrawal_requests FOR INSERT TO authenticated WITH CHECK (((public.get_my_payout_role() = 'owner'::text) OR public.is_payment_manager('can_approve_withdrawals'::text)));

CREATE POLICY withdrawal_requests_owner_pm_select ON public.withdrawal_requests FOR SELECT TO authenticated USING (((public.get_my_payout_role() = 'owner'::text) OR public.is_payment_manager('can_view_payouts'::text)));

CREATE POLICY withdrawal_requests_owner_pm_update ON public.withdrawal_requests FOR UPDATE TO authenticated USING (((public.get_my_payout_role() = 'owner'::text) OR public.is_payment_manager('can_approve_withdrawals'::text))) WITH CHECK (((public.get_my_payout_role() = 'owner'::text) OR public.is_payment_manager('can_approve_withdrawals'::text)));

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated, service_role;

GRANT ALL ON FUNCTION public.admin_audit_immutable() TO anon;
GRANT ALL ON FUNCTION public.admin_audit_immutable() TO authenticated;
GRANT ALL ON FUNCTION public.admin_audit_immutable() TO service_role;

REVOKE ALL ON FUNCTION public.admin_migration_status(probes jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_migration_status(probes jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.am_may_see_creator(p_creator_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.am_may_see_creator(p_creator_id uuid) TO anon;
GRANT ALL ON FUNCTION public.am_may_see_creator(p_creator_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.am_may_see_creator(p_creator_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public.am_owns_campaign(p_campaign_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.am_owns_campaign(p_campaign_id uuid) TO anon;
GRANT ALL ON FUNCTION public.am_owns_campaign(p_campaign_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.am_owns_campaign(p_campaign_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public.apply_verified_views(p_submission_id uuid, p_views bigint, p_source text, p_user_id uuid, p_handle text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.apply_verified_views(p_submission_id uuid, p_views bigint, p_source text, p_user_id uuid, p_handle text) TO service_role;

REVOKE ALL ON FUNCTION public.approve_withdrawal_request(p_request_id uuid, p_approved_by uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.approve_withdrawal_request(p_request_id uuid, p_approved_by uuid) TO authenticated;
GRANT ALL ON FUNCTION public.approve_withdrawal_request(p_request_id uuid, p_approved_by uuid) TO service_role;

REVOKE ALL ON FUNCTION public.approve_withdrawal_request_internal(p_request_id uuid, p_approved_by uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.approve_withdrawal_request_internal(p_request_id uuid, p_approved_by uuid) TO service_role;

REVOKE ALL ON FUNCTION public.assert_payout_permission(p_permission text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.assert_payout_permission(p_permission text) TO authenticated;
GRANT ALL ON FUNCTION public.assert_payout_permission(p_permission text) TO service_role;

GRANT ALL ON FUNCTION public.audit_account_manager_change() TO anon;
GRANT ALL ON FUNCTION public.audit_account_manager_change() TO authenticated;
GRANT ALL ON FUNCTION public.audit_account_manager_change() TO service_role;

GRANT ALL ON FUNCTION public.audit_campaign_change() TO anon;
GRANT ALL ON FUNCTION public.audit_campaign_change() TO authenticated;
GRANT ALL ON FUNCTION public.audit_campaign_change() TO service_role;

GRANT ALL ON FUNCTION public.audit_client_change() TO anon;
GRANT ALL ON FUNCTION public.audit_client_change() TO authenticated;
GRANT ALL ON FUNCTION public.audit_client_change() TO service_role;

GRANT ALL ON FUNCTION public.audit_client_delete() TO anon;
GRANT ALL ON FUNCTION public.audit_client_delete() TO authenticated;
GRANT ALL ON FUNCTION public.audit_client_delete() TO service_role;

GRANT ALL ON FUNCTION public.audit_payment_void() TO anon;
GRANT ALL ON FUNCTION public.audit_payment_void() TO authenticated;
GRANT ALL ON FUNCTION public.audit_payment_void() TO service_role;

GRANT ALL ON FUNCTION public.audit_submission_review() TO anon;
GRANT ALL ON FUNCTION public.audit_submission_review() TO authenticated;
GRANT ALL ON FUNCTION public.audit_submission_review() TO service_role;

GRANT ALL ON FUNCTION public.audit_user_profile_change() TO anon;
GRANT ALL ON FUNCTION public.audit_user_profile_change() TO authenticated;
GRANT ALL ON FUNCTION public.audit_user_profile_change() TO service_role;

REVOKE ALL ON FUNCTION public.campaign_creators_sync_array() FROM PUBLIC;
GRANT ALL ON FUNCTION public.campaign_creators_sync_array() TO anon;
GRANT ALL ON FUNCTION public.campaign_creators_sync_array() TO authenticated;
GRANT ALL ON FUNCTION public.campaign_creators_sync_array() TO service_role;

REVOKE ALL ON FUNCTION public.campaigns_guard_commission_rates() FROM PUBLIC;
GRANT ALL ON FUNCTION public.campaigns_guard_commission_rates() TO anon;
GRANT ALL ON FUNCTION public.campaigns_guard_commission_rates() TO authenticated;
GRANT ALL ON FUNCTION public.campaigns_guard_commission_rates() TO service_role;

REVOKE ALL ON FUNCTION public.campaigns_sync_campaign_creators() FROM PUBLIC;
GRANT ALL ON FUNCTION public.campaigns_sync_campaign_creators() TO anon;
GRANT ALL ON FUNCTION public.campaigns_sync_campaign_creators() TO authenticated;
GRANT ALL ON FUNCTION public.campaigns_sync_campaign_creators() TO service_role;

GRANT ALL ON FUNCTION public.cc_sync_in_progress() TO anon;
GRANT ALL ON FUNCTION public.cc_sync_in_progress() TO authenticated;
GRANT ALL ON FUNCTION public.cc_sync_in_progress() TO service_role;

REVOKE ALL ON FUNCTION public.claim_creator(p_creator_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_creator(p_creator_id uuid) TO anon;
GRANT ALL ON FUNCTION public.claim_creator(p_creator_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.claim_creator(p_creator_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public.client_may_see_creator(p_creator_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.client_may_see_creator(p_creator_id uuid) TO anon;
GRANT ALL ON FUNCTION public.client_may_see_creator(p_creator_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.client_may_see_creator(p_creator_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public.create_payout_batch(p_withdrawal_request_ids uuid[], p_generated_by uuid, p_notes text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_payout_batch(p_withdrawal_request_ids uuid[], p_generated_by uuid, p_notes text) TO authenticated;
GRANT ALL ON FUNCTION public.create_payout_batch(p_withdrawal_request_ids uuid[], p_generated_by uuid, p_notes text) TO service_role;

REVOKE ALL ON FUNCTION public.create_payout_batch_internal(p_withdrawal_request_ids uuid[], p_generated_by uuid, p_notes text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_payout_batch_internal(p_withdrawal_request_ids uuid[], p_generated_by uuid, p_notes text) TO service_role;

REVOKE ALL ON FUNCTION public.creators_guard_overrides() FROM PUBLIC;
GRANT ALL ON FUNCTION public.creators_guard_overrides() TO anon;
GRANT ALL ON FUNCTION public.creators_guard_overrides() TO authenticated;
GRANT ALL ON FUNCTION public.creators_guard_overrides() TO service_role;

REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC;
GRANT ALL ON FUNCTION public.current_user_role() TO anon;
GRANT ALL ON FUNCTION public.current_user_role() TO authenticated;
GRANT ALL ON FUNCTION public.current_user_role() TO service_role;

REVOKE ALL ON FUNCTION public.get_my_payout_role() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_payout_role() TO anon;
GRANT ALL ON FUNCTION public.get_my_payout_role() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_payout_role() TO service_role;

GRANT ALL ON FUNCTION public.guard_creator_handles() TO anon;
GRANT ALL ON FUNCTION public.guard_creator_handles() TO authenticated;
GRANT ALL ON FUNCTION public.guard_creator_handles() TO service_role;

GRANT ALL ON FUNCTION public.guard_owner_role() TO anon;
GRANT ALL ON FUNCTION public.guard_owner_role() TO authenticated;
GRANT ALL ON FUNCTION public.guard_owner_role() TO service_role;

GRANT ALL ON FUNCTION public.guard_profile_self_update() TO anon;
GRANT ALL ON FUNCTION public.guard_profile_self_update() TO authenticated;
GRANT ALL ON FUNCTION public.guard_profile_self_update() TO service_role;

GRANT ALL ON FUNCTION public.guard_verified_view_columns() TO anon;
GRANT ALL ON FUNCTION public.guard_verified_view_columns() TO authenticated;
GRANT ALL ON FUNCTION public.guard_verified_view_columns() TO service_role;

REVOKE ALL ON FUNCTION public.handle_new_client_user() FROM PUBLIC;
GRANT ALL ON FUNCTION public.handle_new_client_user() TO anon;
GRANT ALL ON FUNCTION public.handle_new_client_user() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_client_user() TO service_role;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT ALL ON FUNCTION public.handle_new_user() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;

REVOKE ALL ON FUNCTION public.has_payout_permission(p_permission text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.has_payout_permission(p_permission text) TO authenticated;
GRANT ALL ON FUNCTION public.has_payout_permission(p_permission text) TO service_role;

REVOKE ALL ON FUNCTION public.is_payment_manager(p_permission text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_payment_manager(p_permission text) TO anon;
GRANT ALL ON FUNCTION public.is_payment_manager(p_permission text) TO authenticated;
GRANT ALL ON FUNCTION public.is_payment_manager(p_permission text) TO service_role;

REVOKE ALL ON FUNCTION public.list_unassigned_creators() FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_unassigned_creators() TO anon;
GRANT ALL ON FUNCTION public.list_unassigned_creators() TO authenticated;
GRANT ALL ON FUNCTION public.list_unassigned_creators() TO service_role;

REVOKE ALL ON FUNCTION public.log_admin_action(p_action text, p_entity_type text, p_entity_id uuid, p_entity_label text, p_from text, p_to text, p_reason text, p_metadata jsonb, p_actor uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_admin_action(p_action text, p_entity_type text, p_entity_id uuid, p_entity_label text, p_from text, p_to text, p_reason text, p_metadata jsonb, p_actor uuid) TO authenticated;
GRANT ALL ON FUNCTION public.log_admin_action(p_action text, p_entity_type text, p_entity_id uuid, p_entity_label text, p_from text, p_to text, p_reason text, p_metadata jsonb, p_actor uuid) TO service_role;

REVOKE ALL ON FUNCTION public.mark_payout_batch_paid(p_batch_id uuid, p_marked_paid_by uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_payout_batch_paid(p_batch_id uuid, p_marked_paid_by uuid) TO authenticated;
GRANT ALL ON FUNCTION public.mark_payout_batch_paid(p_batch_id uuid, p_marked_paid_by uuid) TO service_role;

REVOKE ALL ON FUNCTION public.mark_payout_batch_paid_internal(p_batch_id uuid, p_marked_paid_by uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_payout_batch_paid_internal(p_batch_id uuid, p_marked_paid_by uuid) TO service_role;

GRANT ALL ON FUNCTION public.payout_ledger_balance(p_creator_id uuid) TO anon;
GRANT ALL ON FUNCTION public.payout_ledger_balance(p_creator_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.payout_ledger_balance(p_creator_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.payout_ledger_immutable() TO anon;
GRANT ALL ON FUNCTION public.payout_ledger_immutable() TO authenticated;
GRANT ALL ON FUNCTION public.payout_ledger_immutable() TO service_role;

GRANT ALL ON FUNCTION public.payout_ledger_reconcile(p_creator_id uuid) TO anon;
GRANT ALL ON FUNCTION public.payout_ledger_reconcile(p_creator_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.payout_ledger_reconcile(p_creator_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public.payout_reconciliation_report() FROM PUBLIC;
GRANT ALL ON FUNCTION public.payout_reconciliation_report() TO authenticated;
GRANT ALL ON FUNCTION public.payout_reconciliation_report() TO service_role;

GRANT ALL ON FUNCTION public.payout_status_weight(p_entity_type text, p_status text) TO anon;
GRANT ALL ON FUNCTION public.payout_status_weight(p_entity_type text, p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.payout_status_weight(p_entity_type text, p_status text) TO service_role;

REVOKE ALL ON FUNCTION public.purge_expired_oauth_states() FROM PUBLIC;
GRANT ALL ON FUNCTION public.purge_expired_oauth_states() TO anon;
GRANT ALL ON FUNCTION public.purge_expired_oauth_states() TO authenticated;
GRANT ALL ON FUNCTION public.purge_expired_oauth_states() TO service_role;

REVOKE ALL ON FUNCTION public.rate_limit_hit(p_key text, p_window_secs integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rate_limit_hit(p_key text, p_window_secs integer) TO service_role;

GRANT ALL ON FUNCTION public.record_payout_transition() TO anon;
GRANT ALL ON FUNCTION public.record_payout_transition() TO authenticated;
GRANT ALL ON FUNCTION public.record_payout_transition() TO service_role;

GRANT ALL ON FUNCTION public.refuse_hard_delete() TO anon;
GRANT ALL ON FUNCTION public.refuse_hard_delete() TO authenticated;
GRANT ALL ON FUNCTION public.refuse_hard_delete() TO service_role;

REVOKE ALL ON FUNCTION public.reject_withdrawal_request(p_request_id uuid, p_rejected_by uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reject_withdrawal_request(p_request_id uuid, p_rejected_by uuid, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.reject_withdrawal_request(p_request_id uuid, p_rejected_by uuid, p_reason text) TO service_role;

REVOKE ALL ON FUNCTION public.reject_withdrawal_request_internal(p_request_id uuid, p_rejected_by uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reject_withdrawal_request_internal(p_request_id uuid, p_rejected_by uuid, p_reason text) TO service_role;

REVOKE ALL ON FUNCTION public.release_creator(p_creator_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.release_creator(p_creator_id uuid) TO anon;
GRANT ALL ON FUNCTION public.release_creator(p_creator_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.release_creator(p_creator_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public.request_creator_withdrawal(p_creator_id uuid, p_currency text, p_payment_method text, p_payment_destination_summary text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.request_creator_withdrawal(p_creator_id uuid, p_currency text, p_payment_method text, p_payment_destination_summary text) TO authenticated;
GRANT ALL ON FUNCTION public.request_creator_withdrawal(p_creator_id uuid, p_currency text, p_payment_method text, p_payment_destination_summary text) TO service_role;

REVOKE ALL ON FUNCTION public.reverse_ledger_entry(p_entry_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reverse_ledger_entry(p_entry_id uuid, p_reason text) TO anon;
GRANT ALL ON FUNCTION public.reverse_ledger_entry(p_entry_id uuid, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.reverse_ledger_entry(p_entry_id uuid, p_reason text) TO service_role;

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_updated_at() TO service_role;

GRANT ALL ON FUNCTION public.trg_audit_creator_archive() TO anon;
GRANT ALL ON FUNCTION public.trg_audit_creator_archive() TO authenticated;
GRANT ALL ON FUNCTION public.trg_audit_creator_archive() TO service_role;

GRANT ALL ON FUNCTION public.trg_audit_submission_archive() TO anon;
GRANT ALL ON FUNCTION public.trg_audit_submission_archive() TO authenticated;
GRANT ALL ON FUNCTION public.trg_audit_submission_archive() TO service_role;

GRANT ALL ON TABLE public.account_managers TO anon;
GRANT ALL ON TABLE public.account_managers TO authenticated;
GRANT ALL ON TABLE public.account_managers TO service_role;

GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE ON TABLE public.admin_audit_logs TO anon;
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE ON TABLE public.admin_audit_logs TO authenticated;
GRANT ALL ON TABLE public.admin_audit_logs TO service_role;

GRANT ALL ON SEQUENCE public.batch_number_seq TO anon;
GRANT ALL ON SEQUENCE public.batch_number_seq TO authenticated;
GRANT ALL ON SEQUENCE public.batch_number_seq TO service_role;

GRANT ALL ON TABLE public.campaign_analytics TO anon;
GRANT ALL ON TABLE public.campaign_analytics TO authenticated;
GRANT ALL ON TABLE public.campaign_analytics TO service_role;

GRANT ALL ON TABLE public.campaign_creators TO authenticated;
GRANT ALL ON TABLE public.campaign_creators TO service_role;

GRANT ALL ON TABLE public.campaigns TO anon;
GRANT ALL ON TABLE public.campaigns TO authenticated;
GRANT ALL ON TABLE public.campaigns TO service_role;

GRANT ALL ON TABLE public.clients TO anon;
GRANT ALL ON TABLE public.clients TO authenticated;
GRANT ALL ON TABLE public.clients TO service_role;

GRANT ALL ON TABLE public.creators TO anon;
GRANT ALL ON TABLE public.creators TO authenticated;
GRANT ALL ON TABLE public.creators TO service_role;

GRANT ALL ON TABLE public.video_analytics TO anon;
GRANT ALL ON TABLE public.video_analytics TO authenticated;
GRANT ALL ON TABLE public.video_analytics TO service_role;

GRANT ALL ON TABLE public.client_safe_analytics TO anon;
GRANT ALL ON TABLE public.client_safe_analytics TO authenticated;
GRANT ALL ON TABLE public.client_safe_analytics TO service_role;

GRANT ALL ON TABLE public.client_safe_campaigns TO anon;
GRANT ALL ON TABLE public.client_safe_campaigns TO authenticated;
GRANT ALL ON TABLE public.client_safe_campaigns TO service_role;

GRANT ALL ON TABLE public.submissions TO anon;
GRANT ALL ON TABLE public.submissions TO authenticated;
GRANT ALL ON TABLE public.submissions TO service_role;

GRANT ALL ON TABLE public.client_safe_submissions TO anon;
GRANT ALL ON TABLE public.client_safe_submissions TO authenticated;
GRANT ALL ON TABLE public.client_safe_submissions TO service_role;

GRANT ALL ON TABLE public.creator_earnings TO anon;
GRANT ALL ON TABLE public.creator_earnings TO authenticated;
GRANT ALL ON TABLE public.creator_earnings TO service_role;

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.creator_social_accounts TO authenticated;
GRANT ALL ON TABLE public.creator_social_accounts TO service_role;

GRANT SELECT(id) ON TABLE public.creator_social_accounts TO authenticated;

GRANT SELECT(user_id) ON TABLE public.creator_social_accounts TO authenticated;

GRANT SELECT(creator_id) ON TABLE public.creator_social_accounts TO authenticated;

GRANT SELECT(workspace_id) ON TABLE public.creator_social_accounts TO authenticated;

GRANT SELECT(platform) ON TABLE public.creator_social_accounts TO authenticated;

GRANT SELECT(platform_user_id) ON TABLE public.creator_social_accounts TO authenticated;

GRANT SELECT(username) ON TABLE public.creator_social_accounts TO authenticated;

GRANT SELECT(display_name) ON TABLE public.creator_social_accounts TO authenticated;

GRANT SELECT(profile_image_url) ON TABLE public.creator_social_accounts TO authenticated;

GRANT SELECT(token_expires_at) ON TABLE public.creator_social_accounts TO authenticated;

GRANT SELECT(refresh_token_expires_at) ON TABLE public.creator_social_accounts TO authenticated;

GRANT SELECT(scopes) ON TABLE public.creator_social_accounts TO authenticated;

GRANT SELECT(connection_status) ON TABLE public.creator_social_accounts TO authenticated;

GRANT SELECT(last_synced_at) ON TABLE public.creator_social_accounts TO authenticated;

GRANT SELECT(last_error) ON TABLE public.creator_social_accounts TO authenticated;

GRANT SELECT(metadata) ON TABLE public.creator_social_accounts TO authenticated;

GRANT SELECT(created_at) ON TABLE public.creator_social_accounts TO authenticated;

GRANT SELECT(updated_at) ON TABLE public.creator_social_accounts TO authenticated;

GRANT ALL ON TABLE public.creator_social_accounts_safe TO authenticated;
GRANT ALL ON TABLE public.creator_social_accounts_safe TO service_role;

GRANT ALL ON TABLE public.creator_videos TO authenticated;
GRANT ALL ON TABLE public.creator_videos TO service_role;

GRANT ALL ON TABLE public.messages TO anon;
GRANT ALL ON TABLE public.messages TO authenticated;
GRANT ALL ON TABLE public.messages TO service_role;

GRANT ALL ON TABLE public.oauth_states TO anon;
GRANT ALL ON TABLE public.oauth_states TO authenticated;
GRANT ALL ON TABLE public.oauth_states TO service_role;

GRANT ALL ON TABLE public.payment_audit_logs TO anon;
GRANT ALL ON TABLE public.payment_audit_logs TO authenticated;
GRANT ALL ON TABLE public.payment_audit_logs TO service_role;

GRANT ALL ON TABLE public.payment_managers TO anon;
GRANT ALL ON TABLE public.payment_managers TO authenticated;
GRANT ALL ON TABLE public.payment_managers TO service_role;

GRANT ALL ON TABLE public.payments TO anon;
GRANT ALL ON TABLE public.payments TO authenticated;
GRANT ALL ON TABLE public.payments TO service_role;

GRANT ALL ON TABLE public.payout_batches TO anon;
GRANT ALL ON TABLE public.payout_batches TO authenticated;
GRANT ALL ON TABLE public.payout_batches TO service_role;

GRANT SELECT,REFERENCES,TRIGGER ON TABLE public.payout_ledger TO authenticated;
GRANT SELECT,INSERT,REFERENCES,TRIGGER ON TABLE public.payout_ledger TO service_role;

GRANT ALL ON TABLE public.payout_line_items TO anon;
GRANT ALL ON TABLE public.payout_line_items TO authenticated;
GRANT ALL ON TABLE public.payout_line_items TO service_role;

GRANT ALL ON TABLE public.rate_limits TO service_role;

GRANT ALL ON TABLE public.user_profiles TO anon;
GRANT ALL ON TABLE public.user_profiles TO authenticated;
GRANT ALL ON TABLE public.user_profiles TO service_role;

GRANT ALL ON TABLE public.video_metrics TO authenticated;
GRANT ALL ON TABLE public.video_metrics TO service_role;

GRANT ALL ON TABLE public.withdrawal_requests TO anon;
GRANT ALL ON TABLE public.withdrawal_requests TO authenticated;
GRANT ALL ON TABLE public.withdrawal_requests TO service_role;

INSERT INTO public.owner_emails (email) VALUES ('shaily@omnyagrowth.com') ON CONFLICT DO NOTHING;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.campaign_approved_videos(p_campaign_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT count(*)::integer FROM public.submissions
  WHERE campaign_id = p_campaign_id
    AND submission_type = 'Final'
    AND status IN ('Approved', 'Published/Tracked')
    AND archived_at IS NULL;
$$;

-- Final videos holding a spot: approved, in review, or awaiting a creator's revision.
CREATE OR REPLACE FUNCTION public.campaign_videos_taken(p_campaign_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT count(*)::integer FROM public.submissions s
  WHERE s.campaign_id = p_campaign_id
    AND s.submission_type = 'Final'
    AND s.archived_at IS NULL
    AND (
      s.status IN ('Submitted', 'Under Review', 'Approved', 'Published/Tracked')
      OR (s.status = 'Revision Requested' AND NOT EXISTS (
        SELECT 1 FROM public.submissions newer
        WHERE newer.campaign_id = s.campaign_id
          AND newer.creator_id = s.creator_id
          AND newer.submission_type = 'Final'
          AND newer.created_at > s.created_at
      ))
    );
$$;

-- Spots left per campaign; NULL means no limit. Counts only, so creators can read it.
CREATE OR REPLACE FUNCTION public.campaign_spots(p_campaign_ids uuid[])
RETURNS TABLE (campaign_id uuid, spots_left integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT c.id,
    CASE WHEN COALESCE(c.videos_needed, 0) > 0
      THEN GREATEST(c.videos_needed - public.campaign_videos_taken(c.id), 0)
    END
  FROM public.campaigns c
  WHERE c.id = ANY(p_campaign_ids);
$$;

-- Refuses submissions once every spot is taken, and approvals past videos needed.
CREATE OR REPLACE FUNCTION public.enforce_videos_needed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_needed integer;
BEGIN
  IF NEW.campaign_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NOT (
    NEW.submission_type = 'Final'
    AND NEW.status IN ('Approved', 'Published/Tracked')
    AND OLD.status NOT IN ('Approved', 'Published/Tracked')
  ) THEN
    RETURN NEW;
  END IF;

  SELECT videos_needed INTO v_needed FROM public.campaigns WHERE id = NEW.campaign_id FOR UPDATE;
  IF COALESCE(v_needed, 0) = 0 THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' THEN
    IF public.campaign_approved_videos(NEW.campaign_id) >= v_needed THEN
      RAISE EXCEPTION 'This campaign already has the % approved % it needs. Raise videos needed on the campaign to approve more.', v_needed, CASE WHEN v_needed = 1 THEN 'video' ELSE 'videos' END;
    END IF;
    RETURN NEW;
  END IF;

  -- A creator resending after requested changes keeps the spot they already hold.
  IF public.campaign_videos_taken(NEW.campaign_id) >= v_needed AND NOT EXISTS (
    SELECT 1 FROM public.submissions s
    WHERE s.campaign_id = NEW.campaign_id
      AND s.creator_id = NEW.creator_id
      AND s.submission_type = 'Final'
      AND s.status = 'Revision Requested'
      AND s.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'This campaign is full. All its videos are approved or in review.';
  END IF;
  RETURN NEW;
END;
$$;

-- Marks a campaign Completed when its last needed video is approved.
CREATE OR REPLACE FUNCTION public.complete_campaign_when_full()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.campaign_id IS NOT NULL
    AND NEW.submission_type = 'Final'
    AND NEW.status IN ('Approved', 'Published/Tracked')
  THEN
    UPDATE public.campaigns SET status = 'Completed'
    WHERE id = NEW.campaign_id
      AND COALESCE(videos_needed, 0) > 0
      AND status NOT IN ('Completed', 'Archived', 'Cancelled')
      AND public.campaign_approved_videos(id) >= videos_needed;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.campaign_approved_videos(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.campaign_videos_taken(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.campaign_spots(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.campaign_spots(uuid[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_videos_needed() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_campaign_when_full() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_videos_needed ON public.submissions;
CREATE TRIGGER trg_enforce_videos_needed
  BEFORE INSERT OR UPDATE OF status ON public.submissions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_videos_needed();

DROP TRIGGER IF EXISTS trg_complete_campaign_when_full ON public.submissions;
CREATE TRIGGER trg_complete_campaign_when_full
  AFTER INSERT OR UPDATE OF status ON public.submissions
  FOR EACH ROW EXECUTE FUNCTION public.complete_campaign_when_full();

CREATE OR REPLACE FUNCTION public.campaign_videos_taken(p_campaign_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT count(*)::integer FROM public.submissions
  WHERE campaign_id = p_campaign_id
    AND submission_type = 'Final'
    AND status IN ('Submitted', 'Under Review', 'Revision Requested', 'Approved', 'Published/Tracked')
    AND archived_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.enforce_videos_needed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_needed integer;
BEGIN
  IF NEW.campaign_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NOT (
    NEW.submission_type = 'Final'
    AND NEW.status IN ('Approved', 'Published/Tracked')
    AND OLD.status NOT IN ('Approved', 'Published/Tracked')
  ) THEN
    RETURN NEW;
  END IF;

  SELECT videos_needed INTO v_needed FROM public.campaigns WHERE id = NEW.campaign_id FOR UPDATE;
  IF COALESCE(v_needed, 0) = 0 THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' THEN
    IF public.campaign_approved_videos(NEW.campaign_id) >= v_needed THEN
      RAISE EXCEPTION 'This campaign already has the % approved % it needs. Raise videos needed on the campaign to approve more.', v_needed, CASE WHEN v_needed = 1 THEN 'video' ELSE 'videos' END;
    END IF;
    RETURN NEW;
  END IF;

  -- A creator resending after requested changes keeps the spot they already hold.
  IF public.campaign_videos_taken(NEW.campaign_id) >= v_needed AND NOT EXISTS (
    SELECT 1 FROM public.submissions s
    WHERE s.campaign_id = NEW.campaign_id
      AND s.creator_id = NEW.creator_id
      AND s.status = 'Revision Requested'
      AND s.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'This campaign is full. All its videos are approved or in review.';
  END IF;
  RETURN NEW;
END;
$$;

-- A new submission replaces the creator's oldest open revision on that campaign.
CREATE OR REPLACE FUNCTION public.archive_replaced_revision()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE public.submissions
  SET status = 'Archived', archived_at = now(), archive_reason = 'Replaced by a newer submission'
  WHERE id = (
    SELECT s.id FROM public.submissions s
    WHERE s.campaign_id = NEW.campaign_id
      AND s.creator_id = NEW.creator_id
      AND s.status = 'Revision Requested'
      AND s.archived_at IS NULL
      AND s.id <> NEW.id
    ORDER BY s.created_at
    LIMIT 1
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_replaced_revision() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_archive_replaced_revision ON public.submissions;
CREATE TRIGGER trg_archive_replaced_revision
  AFTER INSERT ON public.submissions
  FOR EACH ROW EXECUTE FUNCTION public.archive_replaced_revision();

-- Clears revisions that were already resent before this trigger existed.
UPDATE public.submissions old
SET status = 'Archived', archived_at = now(), archive_reason = 'Replaced by a newer submission'
WHERE old.status = 'Revision Requested'
  AND old.archived_at IS NULL
  AND EXISTS (
    SELECT 1 FROM public.submissions newer
    WHERE newer.campaign_id = old.campaign_id
      AND newer.creator_id = old.creator_id
      AND newer.created_at > old.created_at
  );

COMMIT;
