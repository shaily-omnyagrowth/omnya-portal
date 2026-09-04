-- Add hard-delete prevention triggers for remaining core entities

CREATE TRIGGER trg_creators_no_delete
  BEFORE DELETE ON creators
  FOR EACH ROW
  EXECUTE FUNCTION refuse_hard_delete();

-- Remove the RLS policy that allowed owners to hard-delete creators
DROP POLICY IF EXISTS "creators_delete_owner" ON creators;

CREATE TRIGGER trg_submissions_no_delete
  BEFORE DELETE ON submissions
  FOR EACH ROW
  EXECUTE FUNCTION refuse_hard_delete();

-- Remove the RLS policy that allowed owners to hard-delete submissions
DROP POLICY IF EXISTS "submissions_delete_owner" ON submissions;

CREATE TRIGGER trg_user_profiles_no_delete
  BEFORE DELETE ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION refuse_hard_delete();

-- Remove the RLS policy that allowed owners to hard-delete user profiles
DROP POLICY IF EXISTS "user_profiles_delete_owner" ON user_profiles;
