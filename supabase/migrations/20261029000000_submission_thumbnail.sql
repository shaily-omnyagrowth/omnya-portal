BEGIN;

ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS thumbnail_url text;

COMMIT;
