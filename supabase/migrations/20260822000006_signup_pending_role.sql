-- ============================================================================
-- MIGRATION: 20260822000006_signup_pending_role.sql
-- Omnya Portal — public signup lands in 'pending', not 'creator'  (N-20)
-- ============================================================================
--
-- THE PROBLEM
--
-- Anyone who signs up is granted role='creator' the instant the auth row is
-- written, with no approval step. They can immediately read the job board,
-- apply to campaigns and appear in AM creator lists.
--
-- The approval workflow this contradicts is already built and shipped:
--
--   · user_profiles.requested_role                  — the column exists
--   · the owner's "Approve Users" sidebar entry     — src/App.js navs.owner
--   · <PendingUsers/>                               — src/App.js
--   · role='pending' handling in App                — src/App.js
--
-- So the fix is not to design an approval flow. It is to stop the trigger
-- from routing around the one that is already there.
--
--
-- WHY THERE IS NOTHING TO DIFF AGAINST
--
-- No migration in this repository has ever created a trigger on auth.users.
-- The live one was applied by hand and exists only in production, which is
-- also why nobody could say what it does without looking. This file makes the
-- trigger part of the repository for the first time (F-12).
--
--
-- THE auth.users PROBLEM, AND WHY THIS FILE DOES NOT SOLVE IT SILENTLY
--
-- auth.users is Supabase-managed. Blind-dropping unknown triggers on it can
-- break password recovery, email confirmation or SSO — none of which we can
-- see from here. So this migration:
--
--   · drops and recreates ONLY the trigger name it owns
--     (on_auth_user_created), and
--   · RAISEs a NOTICE listing every other trigger on auth.users, so the apply
--     log tells the operator whether a competing trigger still exists.
--
-- If SECTION 3 lists a trigger you do not recognise, stop and inspect it
-- before trusting this fix. Two triggers both inserting into user_profiles
-- means whichever runs second hits the primary key and one of them wins
-- silently.
--
--
-- OPERATIONAL CONSEQUENCE — READ THIS BEFORE APPLYING
--
-- After this lands, a newly signed-up user CANNOT use the portal until an
-- owner approves them on the Approve Users page. That is the intended
-- behaviour and it is a visible product change. Existing users are untouched:
-- SECTION 4 deliberately does not rewrite anybody's current role.
--
-- Rollback: 20260822000006_signup_pending_role.rollback.sql
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1 — handle_new_user()
-- ============================================================================
--
-- SECURITY DEFINER because the inserting role during signup is not one that
-- may write user_profiles. search_path is pinned so a later schema on the
-- caller's path cannot shadow public.user_profiles — the standard hardening
-- this repo applies to every SECURITY DEFINER function.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

COMMENT ON FUNCTION public.handle_new_user() IS
    'Creates the user_profiles row for a new auth.users row with role=''pending''. '
    'The role the signup form asked for is recorded in requested_role and granted '
    'only by an owner on the Approve Users page (N-20).';

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;


-- ============================================================================
-- SECTION 2 — the trigger
-- ============================================================================

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();


-- ============================================================================
-- SECTION 3 — report any competing trigger (does not drop them)
-- ============================================================================

DO $$
DECLARE
    r        RECORD;
    v_others INT := 0;
BEGIN
    FOR r IN
        SELECT t.tgname, p.proname, n.nspname
        FROM pg_trigger t
        JOIN pg_proc      p ON p.oid = t.tgfoid
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE t.tgrelid = 'auth.users'::regclass
          AND NOT t.tgisinternal
          AND t.tgname <> 'on_auth_user_created'
        ORDER BY t.tgname
    LOOP
        v_others := v_others + 1;
        RAISE NOTICE
            'N-20: OTHER trigger on auth.users -> % (runs %.%()). Inspect it: if it also writes user_profiles it will fight on_auth_user_created.',
            r.tgname, r.nspname, r.proname;
    END LOOP;

    IF v_others = 0 THEN
        RAISE NOTICE 'N-20: on_auth_user_created is the only non-internal trigger on auth.users. Clean.';
    ELSE
        RAISE WARNING
            'N-20: % other trigger(s) on auth.users listed above. This migration did NOT drop them -- auth.users is Supabase-managed and dropping the wrong one breaks password recovery or email confirmation. Review them by hand.',
            v_others;
    END IF;
END;
$$;


-- ============================================================================
-- SECTION 4 — existing users are NOT touched
-- ============================================================================
--
-- Deliberately empty of UPDATEs. Demoting live accounts to 'pending' would
-- lock out every creator currently working, which is a far worse outcome than
-- the hole this migration closes. It reports the exposure instead so the owner
-- can decide.

DO $$
DECLARE
    v_creators INT;
BEGIN
    SELECT count(*) INTO v_creators
    FROM public.user_profiles
    WHERE role = 'creator';

    RAISE NOTICE
        'N-20: % existing user_profiles row(s) hold role=creator. They keep it. Only signups from now on land in pending.',
        v_creators;
END;
$$;


-- ============================================================================
-- SECTION 5 — verification
-- ============================================================================

DO $$
DECLARE
    v_ok BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'auth.users'::regclass
          AND tgname  = 'on_auth_user_created'
          AND NOT tgisinternal
    ) INTO v_ok;

    IF NOT v_ok THEN
        RAISE EXCEPTION 'N-20: on_auth_user_created was not created. Refusing to report success.';
    END IF;

    RAISE NOTICE 'N-20: trigger installed. New signups now land in pending.';
END;
$$;

COMMIT;
