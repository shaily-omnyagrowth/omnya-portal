BEGIN;

DROP TRIGGER IF EXISTS trg_archive_replaced_revision ON public.submissions;
DROP FUNCTION IF EXISTS public.archive_replaced_revision();

COMMIT;
