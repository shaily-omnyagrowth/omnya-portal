-- ====================================================================
-- MIGRATION: 20260528000001_fix_user_profiles_insert_policy.sql
-- ====================================================================
--
-- Problem: The INSERT policy on user_profiles only checks `id = auth.uid()`
-- with no restriction on the `role` column. A newly-signed-up user could
-- call supabase.from('user_profiles').insert({ id: myId, role: 'owner' })
-- and self-promote to owner before any approval step.
--
-- Fix: Restrict self-inserts to safe initial roles only.
-- The only valid roles a user can self-assign on first insert are:
--   'pending'  — default for creator/AM signups awaiting approval
--   'client'   — auto-assigned on client self-signup
-- Owners and AMs are provisioned server-side (service-role or owner SQL).
-- ====================================================================

BEGIN;

DROP POLICY IF EXISTS user_profiles_insert_self_or_owner ON public.user_profiles;

CREATE POLICY user_profiles_insert_self_or_owner ON public.user_profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    -- Owners (seeded via service-role SQL) can insert any row.
    public.current_user_role() = 'owner'
    OR (
      -- Self-insert is only permitted for safe initial roles.
      id = auth.uid()
      AND role IN ('pending', 'client')
    )
  );

COMMENT ON POLICY user_profiles_insert_self_or_owner ON public.user_profiles IS
  'Allows self-insert only for pending/client roles. Blocks self-promotion to '
  'owner, am, or account_manager. Owners can insert any row for provisioning.';

COMMIT;
