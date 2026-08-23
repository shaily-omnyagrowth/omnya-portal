-- ============================================================================
-- VERIFY_20260821.sql
--
-- Read-only checks for the 20260821 migrations. Writes nothing. Run in the
-- Supabase SQL editor after applying, and read the STATUS column: every row
-- should say PASS.
--
-- Also answers the open question from audit finding N-10, which could not be
-- resolved from outside the database: section 6 lists the live RLS policies on
-- clients and campaigns so the extra permissive policy can be identified.
-- ============================================================================

-- ---- 1. N-03: the status CHECK accepts the payout states -------------------
SELECT
  '1. creator_earnings status CHECK' AS check_name,
  CASE WHEN c.consrc_text LIKE '%withdrawal_requested%'
        AND c.consrc_text LIKE '%batched%'
        AND c.consrc_text LIKE '%needs_review%'
       THEN 'PASS' ELSE 'FAIL' END AS status,
  c.consrc_text AS detail
FROM (
  SELECT pg_get_constraintdef(oid) AS consrc_text
  FROM   pg_constraint
  WHERE  conrelid = 'public.creator_earnings'::regclass
    AND  conname  = 'creator_earnings_status_check'
) c;

-- ---- 2. N-04: no stale bodies remain ---------------------------------------
SELECT
  '2. no performed_by in any payout RPC' AS check_name,
  CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  COALESCE(string_agg(p.proname, ', '), 'none') AS detail
FROM   pg_proc p
JOIN   pg_namespace n ON n.oid = p.pronamespace
WHERE  n.nspname = 'public'
  AND  (p.proname LIKE '%withdrawal%' OR p.proname LIKE '%payout%')
  AND  pg_get_functiondef(p.oid) LIKE '%performed_by%';

-- ---- 3. N-11 / F-2: anon and PUBLIC cannot execute the payout RPCs ---------
SELECT
  '3. anon EXECUTE revoked' AS check_name,
  CASE WHEN bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
       THEN 'PASS' ELSE 'FAIL' END AS status,
  string_agg(p.proname || '=' ||
    CASE WHEN has_function_privilege('anon', p.oid, 'EXECUTE')
         THEN 'STILL EXECUTABLE' ELSE 'revoked' END, ', ') AS detail
FROM   pg_proc p
JOIN   pg_namespace n ON n.oid = p.pronamespace
WHERE  n.nspname = 'public'
  AND  p.proname IN (
        'request_creator_withdrawal','approve_withdrawal_request',
        'reject_withdrawal_request','create_payout_batch','mark_payout_batch_paid');

-- ---- 4. F-2: the wrappers and the sealed internals both exist --------------
SELECT
  '4. guarded wrappers installed' AS check_name,
  CASE WHEN count(*) FILTER (WHERE p.proname LIKE '%_internal') = 4
        AND count(*) FILTER (WHERE p.proname NOT LIKE '%_internal') = 4
       THEN 'PASS' ELSE 'FAIL' END AS status,
  string_agg(p.proname, ', ' ORDER BY p.proname) AS detail
FROM   pg_proc p
JOIN   pg_namespace n ON n.oid = p.pronamespace
WHERE  n.nspname = 'public'
  AND  p.proname IN (
        'approve_withdrawal_request','approve_withdrawal_request_internal',
        'reject_withdrawal_request','reject_withdrawal_request_internal',
        'create_payout_batch','create_payout_batch_internal',
        'mark_payout_batch_paid','mark_payout_batch_paid_internal');

-- ---- 5. F-9: the row lock is present in request_creator_withdrawal ---------
SELECT
  '5. FOR UPDATE lock present' AS check_name,
  CASE WHEN pg_get_functiondef(p.oid) LIKE '%FOR UPDATE%'
       THEN 'PASS' ELSE 'FAIL' END AS status,
  'request_creator_withdrawal' AS detail
FROM   pg_proc p
JOIN   pg_namespace n ON n.oid = p.pronamespace
WHERE  n.nspname = 'public' AND p.proname = 'request_creator_withdrawal';

-- ---- 6. N-10: WHICH LIVE POLICIES ARE IN NO MIGRATION? ---------------------
-- Not a pass/fail. An Account Manager with zero assigned clients could read
-- every client in production, which the repo's policies do not allow.
--
-- tests/role-boundaries.test.cjs later showed the same leak on campaigns AND
-- submissions, so this is not one stray policy on one table -- it is a pattern
-- of unscoped AM access across the core tables. All three repo policies are
-- correctly written and would return zero rows; production simply has more
-- policies than the repo does.
--
-- Compare this list against 20260521000000_omnya_hardening.sql. Anything
-- present here and absent there is a candidate for dropping.
SELECT
  '6. live policies on the core tables' AS check_name,
  tablename,
  policyname,
  cmd,
  roles::text,
  qual AS using_expression
FROM   pg_policies
WHERE  schemaname = 'public'
  AND  tablename IN ('clients', 'campaigns', 'submissions', 'creators', 'user_profiles')
ORDER BY tablename, policyname;

-- ---- 7. F-6: the client creator-visibility policy exists -------------------
SELECT
  '7. client creator visibility policy' AS check_name,
  CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS status,
  COALESCE(string_agg(policyname, ', '), 'missing') AS detail
FROM   pg_policies
WHERE  schemaname = 'public'
  AND  tablename  = 'creators'
  AND  policyname = 'client_select_creators_on_own_campaigns';

-- ---- 8. N-08: is the Stripe schema actually applied? -----------------------
SELECT
  '8. stripe columns present' AS check_name,
  CASE WHEN count(*) >= 6 THEN 'PASS' ELSE 'FAIL -- apply 20260530000002_stripe_connect.sql' END AS status,
  COALESCE(string_agg(column_name, ', '), 'none') AS detail
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'creators'
  AND  column_name LIKE 'stripe_%';
