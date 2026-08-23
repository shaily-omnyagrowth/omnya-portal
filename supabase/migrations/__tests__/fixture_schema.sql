-- Minimal stand-in for the Omnya production schema, built from the live column
-- lists captured during the audit. Enough to let the 20260821 migrations parse,
-- create their objects, and be exercised. Not a faithful copy of every policy.

CREATE SCHEMA IF NOT EXISTS auth;

-- raw_user_meta_data is where Supabase puts the options.data payload from
-- supabase.auth.signUp(), which is how the signup form passes requested_role
-- and full_name. The N-20 trigger reads it, so the fixture has to carry it or
-- that migration fails here for a reason that does not exist in production.
CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,
  raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Supabase exposes the caller's id here. We back it with a GUC so tests can
-- switch identity with set_config('request.jwt.claim.sub', ...).
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID
$$;

DO $$ BEGIN
  CREATE ROLE anon;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE authenticated;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE service_role;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------- core tables
CREATE TABLE public.user_profiles (
  id UUID PRIMARY KEY,
  email TEXT, full_name TEXT, role TEXT, created_at TIMESTAMPTZ DEFAULT now(),
  requested_role TEXT
);

CREATE TABLE public.account_managers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID, name TEXT, email TEXT
);

CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID, name TEXT, am_id UUID REFERENCES public.account_managers(id),
  status TEXT, budget NUMERIC, contact_email TEXT
);

CREATE TABLE public.creators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID, name TEXT, email TEXT,
  am_id UUID REFERENCES public.account_managers(id),
  status TEXT, weekly_rate NUMERIC, videos_per_week INT,
  payment_method TEXT, payment_method_status TEXT,
  zelle_email TEXT, zelle_phone_last4 TEXT,
  bank_name TEXT, bank_account_last4 TEXT,
  payout_preference TEXT, payout_email TEXT
);

CREATE TABLE public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT, client_id UUID REFERENCES public.clients(id),
  status TEXT, videos_needed INT, pay_per_video NUMERIC,
  assigned_creators UUID[]
);

CREATE TABLE public.submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID REFERENCES public.creators(id),
  campaign_id UUID REFERENCES public.campaigns(id),
  submission_type TEXT, concept_status TEXT, final_status TEXT,
  platform TEXT, posted_url TEXT, posted_at TIMESTAMPTZ,
  view_count_submitted BIGINT
);

CREATE TABLE public.creator_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID REFERENCES public.creators(id),
  campaign_id UUID, submission_id UUID,
  earning_type TEXT, amount NUMERIC(10,2), currency TEXT DEFAULT 'USD',
  status TEXT,
  description TEXT, views_counted BIGINT, bonus_tier TEXT,
  eligible_at TIMESTAMPTZ, locked_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ, approved_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);

-- The DEPLOYED constraint, i.e. the one missing the three payout states.
-- Section 1 of the migration must replace this.
ALTER TABLE public.creator_earnings
  ADD CONSTRAINT creator_earnings_status_check CHECK (
    status IN ('pending','eligible','locked','approved','paid','forfeited','cancelled')
  );

CREATE TABLE public.payout_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number TEXT, status TEXT, total_amount NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.withdrawal_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID REFERENCES public.creators(id),
  amount NUMERIC(10,2), currency TEXT, status TEXT,
  payment_method TEXT, payment_destination_summary TEXT,
  requested_at TIMESTAMPTZ DEFAULT now(),
  approved_at TIMESTAMPTZ, approved_by UUID,
  rejected_at TIMESTAMPTZ, rejected_by UUID, rejection_reason TEXT,
  batch_id UUID REFERENCES public.payout_batches(id),
  paid_at TIMESTAMPTZ, marked_paid_by UUID, admin_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID, amount NUMERIC, currency TEXT, status TEXT,
  payment_method TEXT, batch_id UUID, withdrawal_request_id UUID,
  payment_destination_summary TEXT, processed_by UUID, processed_at TIMESTAMPTZ
);

CREATE TABLE public.payment_managers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE, granted_by UUID,
  can_view_payouts BOOLEAN DEFAULT true,
  can_approve_withdrawals BOOLEAN DEFAULT true,
  can_export_batches BOOLEAN DEFAULT true,
  can_mark_paid BOOLEAN DEFAULT false,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.payment_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID, action TEXT NOT NULL, entity_type TEXT NOT NULL,
  entity_id UUID, metadata JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT now()
);

-- Must normalise account_manager -> am, exactly as the real one in
-- 20260521000000_omnya_hardening.sql does. Without the CASE, a user stored as
-- role='account_manager' fails every `current_user_role() = 'am'` test in
-- every policy, and an AM appears correctly confined to their own tenant --
-- for entirely the wrong reason. A tenant-isolation test run against that
-- fixture would pass while the real system leaked.
CREATE OR REPLACE FUNCTION public.current_user_role() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT CASE WHEN role = 'account_manager' THEN 'am' ELSE role END
  FROM public.user_profiles WHERE id = auth.uid()
$$;

-- --------------------------------------------- the four privileged RPCs
-- Stand-ins with the CORRECTED audit column (actor_user_id), i.e. the state
-- after 20260530000001 has been applied. The migration's ordering guard should
-- accept these. A separate run swaps in a performed_by version to prove the
-- guard actually fires.

CREATE OR REPLACE FUNCTION public.approve_withdrawal_request(p_request_id UUID, p_approved_by UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  UPDATE withdrawal_requests SET status='approved', approved_at=now(), approved_by=p_approved_by
   WHERE id=p_request_id;
  INSERT INTO payment_audit_logs(entity_type,entity_id,action,actor_user_id,metadata)
  VALUES ('withdrawal_request',p_request_id,'withdrawal_approved',p_approved_by,'{}'::jsonb);
  RETURN jsonb_build_object('success',true,'actor',p_approved_by);
END $$;

CREATE OR REPLACE FUNCTION public.reject_withdrawal_request(p_request_id UUID, p_rejected_by UUID DEFAULT NULL, p_reason TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  UPDATE withdrawal_requests SET status='rejected', rejected_at=now(), rejected_by=p_rejected_by,
         rejection_reason=p_reason WHERE id=p_request_id;
  INSERT INTO payment_audit_logs(entity_type,entity_id,action,actor_user_id,metadata)
  VALUES ('withdrawal_request',p_request_id,'withdrawal_rejected',p_rejected_by,'{}'::jsonb);
  RETURN jsonb_build_object('success',true,'actor',p_rejected_by);
END $$;

CREATE OR REPLACE FUNCTION public.create_payout_batch(p_withdrawal_request_ids UUID[], p_generated_by UUID DEFAULT NULL, p_notes TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE v_batch UUID;
BEGIN
  INSERT INTO payout_batches(batch_number,status,total_amount)
  VALUES ('B-'||to_char(now(),'YYYYMMDDHH24MISS'),'pending',0) RETURNING id INTO v_batch;
  UPDATE creator_earnings SET status='batched'
   WHERE creator_id IN (SELECT creator_id FROM withdrawal_requests WHERE id = ANY(p_withdrawal_request_ids))
     AND status='withdrawal_requested';
  INSERT INTO payment_audit_logs(entity_type,entity_id,action,actor_user_id,metadata)
  VALUES ('payout_batch',v_batch,'batch_created',p_generated_by,'{}'::jsonb);
  RETURN jsonb_build_object('success',true,'batch_id',v_batch,'actor',p_generated_by);
END $$;

CREATE OR REPLACE FUNCTION public.mark_payout_batch_paid(p_batch_id UUID, p_marked_paid_by UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM payout_batches WHERE id=p_batch_id) THEN
    RAISE EXCEPTION 'Payout batch % not found', p_batch_id;
  END IF;
  UPDATE payout_batches SET status='paid' WHERE id=p_batch_id;
  INSERT INTO payment_audit_logs(entity_type,entity_id,action,actor_user_id,metadata)
  VALUES ('payout_batch',p_batch_id,'batch_paid',p_marked_paid_by,'{}'::jsonb);
  RETURN jsonb_build_object('success',true,'actor',p_marked_paid_by);
END $$;

-- request_creator_withdrawal is replaced wholesale by the migration, so a
-- placeholder with the right signature is enough here.
CREATE OR REPLACE FUNCTION public.request_creator_withdrawal(
  p_creator_id UUID, p_currency TEXT DEFAULT 'USD',
  p_payment_method TEXT DEFAULT NULL, p_payment_destination_summary TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN RETURN jsonb_build_object('success',false,'error','placeholder'); END $$;

-- Mirror production: PUBLIC can execute all of them.
GRANT EXECUTE ON FUNCTION public.request_creator_withdrawal(UUID,TEXT,TEXT,TEXT) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_withdrawal_request(UUID,UUID)            TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_withdrawal_request(UUID,UUID,TEXT)        TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_payout_batch(UUID[],UUID,TEXT)            TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_payout_batch_paid(UUID,UUID)                TO PUBLIC;

ALTER TABLE public.creators ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- is_payment_manager(TEXT)
--
-- Created for real by 20260530000000_payout_system.sql, which sorts BEFORE
-- 20260604000000_tiktok_integration.sql, so the real apply order satisfies the
-- dependency. The fixture is not a faithful copy of every migration, so
-- without this stand-in the TikTok baseline fails here for a reason that does
-- not exist in a real database -- a fault in the test, not in the migration.
--
-- Kept semantically identical to the real one, including the allow-list guard
-- against SQL injection through the parameter, so a policy that depends on its
-- behaviour is exercised honestly.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_payment_manager(p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
    v_result BOOLEAN := false;
BEGIN
    IF p_permission NOT IN (
        'can_view_payouts', 'can_approve_withdrawals',
        'can_export_batches', 'can_mark_paid'
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
$$;

CREATE OR REPLACE FUNCTION public.get_my_payout_role()
RETURNS TEXT LANGUAGE SQL SECURITY DEFINER SET search_path = public STABLE AS $$
    SELECT CASE WHEN role = 'account_manager' THEN 'am' ELSE role END
    FROM public.user_profiles WHERE id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.is_payment_manager(TEXT) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_payout_role()     TO PUBLIC;
