-- Only emails in owner_emails can hold the owner role. The SQL editor (postgres) is exempt.

BEGIN;

CREATE TABLE IF NOT EXISTS public.owner_emails (
    email text PRIMARY KEY CHECK (email = lower(email))
);

ALTER TABLE public.owner_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.owner_emails FROM anon, authenticated, service_role;

INSERT INTO public.owner_emails (email) VALUES ('shaily@omnyagrowth.com') ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.guard_owner_role() RETURNS trigger
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

DROP TRIGGER IF EXISTS trg_guard_owner_role ON public.user_profiles;
CREATE TRIGGER trg_guard_owner_role BEFORE INSERT OR UPDATE OF role, email ON public.user_profiles
    FOR EACH ROW EXECUTE FUNCTION public.guard_owner_role();

COMMIT;
