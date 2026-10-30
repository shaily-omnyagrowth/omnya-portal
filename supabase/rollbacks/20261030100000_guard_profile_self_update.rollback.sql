-- ROLLBACK for 20261030100000_guard_profile_self_update.sql
--
-- Manual only. Never move this file into supabase/migrations/.
-- Removing the guard lets a signed in user change their own role again.

BEGIN;
DROP TRIGGER IF EXISTS trg_guard_profile_self_update ON public.user_profiles;
DROP FUNCTION IF EXISTS public.guard_profile_self_update();
COMMIT;
