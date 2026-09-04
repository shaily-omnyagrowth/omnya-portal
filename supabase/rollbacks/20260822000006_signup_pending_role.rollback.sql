-- ============================================================================
-- ROLLBACK: 20260822000006_signup_pending_role.sql   (N-20)
-- ============================================================================
--
-- Restores instant self-granted access for new signups.
--
-- READ THIS FIRST. Rolling this back does not return you to a neutral state --
-- it re-opens the hole on purpose: anybody who signs up is a creator
-- immediately, with no approval. Only run it if the approval workflow is
-- actively blocking real users and you have decided that is the worse problem.
--
-- The safer alternative is usually to leave the trigger in place and approve
-- the backlog on the Approve Users page.
--
-- Note this restores the BEHAVIOUR of the pre-existing production trigger, not
-- that trigger byte for byte: its source was never in the repository, so there
-- is nothing to restore it from. See the forward migration's header.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_requested TEXT;
BEGIN
    v_requested := nullif(trim(NEW.raw_user_meta_data ->> 'requested_role'), '');

    IF v_requested IS NULL OR v_requested NOT IN ('creator', 'am', 'account_manager', 'client') THEN
        v_requested := 'creator';
    END IF;

    IF v_requested = 'am' THEN
        v_requested := 'account_manager';
    END IF;

    -- Pre-N-20 behaviour: the requested role is granted on the spot.
    INSERT INTO public.user_profiles (id, email, full_name, role, requested_role)
    VALUES (
        NEW.id,
        NEW.email,
        nullif(trim(NEW.raw_user_meta_data ->> 'full_name'), ''),
        v_requested,
        v_requested
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
    'ROLLED BACK to pre-N-20 behaviour: a new signup is granted the role it '
    'asked for with no approval step. This is a known security exposure.';

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

DO $$
BEGIN
    RAISE WARNING
        'N-20 ROLLED BACK: public signup now self-grants its requested role with no approval.';
END;
$$;

COMMIT;
