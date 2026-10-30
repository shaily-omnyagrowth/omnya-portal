-- Creator handles come only from connected accounts: the browser cannot set them.

BEGIN;

CREATE OR REPLACE FUNCTION public.guard_creator_handles() RETURNS trigger
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

DROP TRIGGER IF EXISTS trg_guard_creator_handles ON public.creators;
CREATE TRIGGER trg_guard_creator_handles BEFORE INSERT OR UPDATE ON public.creators
    FOR EACH ROW EXECUTE FUNCTION public.guard_creator_handles();

COMMIT;
