-- Blocks non-owners from changing role, email or account status on their own
-- user_profiles row. The update policy still lets a user edit their own row
-- (full_name from Settings), but its WITH CHECK allowed a pending user to set
-- role = 'am' or 'creator' on themselves. Owners and the service role
-- (auth.uid() IS NULL) are unaffected.

BEGIN;

CREATE OR REPLACE FUNCTION public.guard_profile_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

DROP TRIGGER IF EXISTS trg_guard_profile_self_update ON public.user_profiles;
CREATE TRIGGER trg_guard_profile_self_update
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_self_update();

COMMIT;
