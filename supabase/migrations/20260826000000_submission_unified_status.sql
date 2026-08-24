-- =============================================================================
-- Migration: Unify Submission Status
-- =============================================================================

BEGIN;

-- 1. Add the unified status column
ALTER TABLE public.submissions
  ADD COLUMN status TEXT DEFAULT 'Draft';

-- 2. Add constraint for the full lifecycle
ALTER TABLE public.submissions
  ADD CONSTRAINT submissions_status_check
  CHECK (status IN (
    'Draft',
    'Submitted',
    'Under Review',
    'Revision Requested',
    'Rejected',
    'Approved',
    'Published/Tracked',
    'Archived'
  ));

-- 3. Migrate existing data
UPDATE public.submissions
SET status = CASE
  WHEN final_status = 'Approved' THEN 'Approved'
  WHEN final_status = 'Rejected' OR concept_status = 'Rejected' THEN 'Rejected'
  WHEN final_status = 'Pending' AND concept_status = 'Approved' THEN 'Under Review'
  WHEN concept_status = 'Pending' THEN 'Submitted'
  ELSE 'Draft'
END;

-- 4. Set NOT NULL after migration
ALTER TABLE public.submissions
  ALTER COLUMN status SET NOT NULL;

-- 5. Drop old columns
-- Use CASCADE to automatically drop dependent objects like the client_safe_submissions view
ALTER TABLE public.submissions
  DROP COLUMN concept_status CASCADE,
  DROP COLUMN final_status CASCADE;

-- 6. Recreate client_safe_submissions view with the new status column
CREATE OR REPLACE VIEW public.client_safe_submissions
WITH (security_invoker = true)
AS
SELECT
    s.id              AS submission_id,
    s.campaign_id,
    s.creator_id,
    cr.name           AS creator_name,
    s.platform,
    s.submission_type,
    s.status,
    s.posted_link,
    s.created_at
FROM   public.submissions s
JOIN   public.campaigns   ca ON s.campaign_id  = ca.id
JOIN   public.clients     cl ON ca.client_id   = cl.id
JOIN   public.creators    cr ON s.creator_id   = cr.id
WHERE  cl.user_id    = auth.uid()
  AND  s.status = 'Approved';
    
GRANT SELECT ON public.client_safe_submissions TO authenticated;

COMMIT;
