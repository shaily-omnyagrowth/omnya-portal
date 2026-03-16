-- Fix user_profiles role check constraint
-- Allowed roles: creator, am, account_manager, owner, pending, denied

ALTER TABLE user_profiles 
DROP CONSTRAINT IF EXISTS user_profiles_role_check;

ALTER TABLE user_profiles 
ADD CONSTRAINT user_profiles_role_check 
CHECK (role IN ('creator', 'am', 'account_manager', 'owner', 'pending', 'denied'));
