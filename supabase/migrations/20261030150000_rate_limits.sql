-- Rate limit counters in Postgres: one fixed window per key.

BEGIN;

CREATE TABLE IF NOT EXISTS public.rate_limits (
    key         text PRIMARY KEY,
    count       integer NOT NULL,
    window_ends timestamptz NOT NULL
);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limits FROM anon, authenticated;
GRANT ALL ON public.rate_limits TO service_role;

-- Counts one hit and returns the count in the current window.
CREATE OR REPLACE FUNCTION public.rate_limit_hit(p_key text, p_window_secs integer) RETURNS integer
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    INSERT INTO public.rate_limits AS r (key, count, window_ends)
    VALUES (p_key, 1, now() + make_interval(secs => p_window_secs))
    ON CONFLICT (key) DO UPDATE
       SET count       = CASE WHEN r.window_ends <= now() THEN 1 ELSE r.count + 1 END,
           window_ends = CASE WHEN r.window_ends <= now() THEN now() + make_interval(secs => p_window_secs) ELSE r.window_ends END
    RETURNING count;
$$;

REVOKE ALL ON FUNCTION public.rate_limit_hit(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(text, integer) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
