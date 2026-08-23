-- ============================================================================
-- MIGRATION: 20260822000004_payout_ledger.sql
-- Omnya Portal — append-only ledger for the money path  (F-7)
-- ============================================================================
--
-- THE PROBLEM
--
-- Every money-bearing table overwrites status in place:
--
--   creator_earnings.status     pending -> approved -> paid
--   withdrawal_requests.status  pending -> approved -> paid
--   payments.status             Pending -> Paid
--   payout_batches.status       draft   -> paid
--
-- An UPDATE destroys what was there before. There is no history, no record of
-- who moved it, and no way to answer "this creator says they were approved for
-- 400 and paid 250 -- what happened?" after the fact. There is also no way to
-- correct a mistake other than another in-place UPDATE, which destroys the
-- evidence of the mistake as well.
--
-- payment_audit_logs records that an action happened. It does not record the
-- state transition or the amount, so it cannot be reconciled against a
-- balance. This is the complement, not a replacement.
--
--
-- THE FIX
--
-- One append-only journal, public.payout_ledger, with a row per status
-- transition, written by trigger so nothing can move money without leaving a
-- trace -- including a direct UPDATE run in the SQL editor.
--
-- Append-only is enforced three ways, because one is not enough:
--
--   1. REVOKE UPDATE, DELETE from every role that is not the table owner.
--   2. A BEFORE UPDATE OR DELETE trigger that RAISEs. This catches the
--      superuser / owner path that grants cannot, which is exactly the path a
--      panicked operator uses at 2am.
--   3. No policy grants UPDATE or DELETE, so RLS refuses them as well.
--
-- A correction is never an edit. It is a new row with reverses_entry_id set
-- and amount_delta negated -- see reverse_ledger_entry().
--
--
-- WHAT amount_delta MEANS
--
-- The signed effect on what the agency owes that creator, so that
--   SUM(amount_delta) = the creator's current payable balance.
--
-- It is derived from a weight per status: 1 for the statuses that mean "owed
-- to the creator and not yet paid out", 0 for everything else. A transition
-- from a 0-weight status to a 1-weight status is +amount; the reverse is
-- -amount; a move between two statuses of equal weight is 0 and is still
-- journalled, because the transition itself is the thing worth keeping.
--
-- For creator_earnings the owed statuses are approved, withdrawal_requested
-- and batched. 'paid' is deliberately weight 0: once paid it is no longer
-- owed, so approved -> paid produces -amount and the balance returns to zero.
-- That is what makes SUM(amount_delta) reconcilable against the earnings table
-- rather than merely suggestive of it.
--
-- Rollback: 20260822000004_payout_ledger.rollback.sql
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1 — the journal
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.payout_ledger (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    entity_type       TEXT NOT NULL
                      CHECK (entity_type IN ('earning', 'withdrawal', 'payment', 'batch')),
    entity_id         UUID NOT NULL,

    -- Denormalised on purpose: the ledger must stay readable and reconcilable
    -- even if the row it describes is later deleted.
    creator_id        UUID,

    from_status       TEXT,
    to_status         TEXT,

    amount            NUMERIC(12,2),
    amount_delta      NUMERIC(12,2) NOT NULL DEFAULT 0,
    currency          TEXT DEFAULT 'USD',

    actor_user_id     UUID,
    actor_role        TEXT,
    reason            TEXT,

    reverses_entry_id UUID REFERENCES public.payout_ledger(id),

    metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.payout_ledger IS
    'Append-only journal of every status transition on the money path (F-7). '
    'Rows are written by trigger and can never be updated or deleted; a '
    'correction is a new reversing row. SUM(amount_delta) per creator is that '
    'creator''s payable balance.';

COMMENT ON COLUMN public.payout_ledger.amount_delta IS
    'Signed effect on the creator''s payable balance. See the migration header '
    'for the weighting rule.';

COMMENT ON COLUMN public.payout_ledger.reverses_entry_id IS
    'Set when this row corrects an earlier one. The earlier row is never '
    'modified -- that is the point of the table.';

CREATE INDEX IF NOT EXISTS idx_payout_ledger_entity
    ON public.payout_ledger (entity_type, entity_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_payout_ledger_creator
    ON public.payout_ledger (creator_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_payout_ledger_occurred
    ON public.payout_ledger (occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_payout_ledger_reverses
    ON public.payout_ledger (reverses_entry_id)
    WHERE reverses_entry_id IS NOT NULL;


-- ============================================================================
-- SECTION 2 — append-only enforcement
-- ============================================================================

CREATE OR REPLACE FUNCTION public.payout_ledger_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'payout_ledger is append-only: % is not permitted. To correct entry %, call reverse_ledger_entry(id, reason) -- it appends a reversing row and leaves the original intact.',
        TG_OP,
        coalesce(OLD.id::text, '(unknown)')
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_payout_ledger_immutable ON public.payout_ledger;

CREATE TRIGGER trg_payout_ledger_immutable
    BEFORE UPDATE OR DELETE ON public.payout_ledger
    FOR EACH ROW
    EXECUTE FUNCTION public.payout_ledger_immutable();

REVOKE UPDATE, DELETE, TRUNCATE ON public.payout_ledger FROM PUBLIC;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON public.payout_ledger FROM authenticated';
        EXECUTE 'REVOKE INSERT ON public.payout_ledger FROM authenticated';
        EXECUTE 'GRANT  SELECT ON public.payout_ledger TO authenticated';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON public.payout_ledger FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON public.payout_ledger FROM service_role';
        EXECUTE 'GRANT  SELECT, INSERT ON public.payout_ledger TO service_role';
    END IF;
END;
$$;


-- ============================================================================
-- SECTION 3 — the weighting rule
-- ============================================================================
--
-- IMMUTABLE and tiny so it can be used inside the trigger without cost.
-- Unknown statuses weigh 0 rather than raising: a new status added later must
-- not break the write path of the table it journals. It will simply not move
-- the balance until it is added here.

CREATE OR REPLACE FUNCTION public.payout_status_weight(p_entity_type TEXT, p_status TEXT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_status IS NULL THEN 0
        WHEN p_entity_type = 'earning' AND lower(p_status) IN
             ('approved', 'withdrawal_requested', 'batched') THEN 1
        WHEN p_entity_type = 'withdrawal' AND lower(p_status) IN
             ('pending', 'approved', 'batched') THEN 1
        WHEN p_entity_type = 'payment' AND lower(p_status) IN
             ('pending', 'processing') THEN 1
        ELSE 0
    END;
$$;

COMMENT ON FUNCTION public.payout_status_weight(TEXT, TEXT) IS
    'Weight of a status for balance purposes: 1 = owed to the creator and not '
    'yet paid out, 0 = otherwise. Used to sign payout_ledger.amount_delta.';


-- ============================================================================
-- SECTION 4 — the recording trigger
-- ============================================================================
--
-- SECURITY DEFINER so it can insert into a table the calling role has no
-- INSERT on. That is deliberate: the ONLY way a row reaches payout_ledger is
-- through this trigger or through service_role, so the journal cannot be
-- forged by a signed-in user.

CREATE OR REPLACE FUNCTION public.record_payout_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_entity    TEXT := TG_ARGV[0];
    v_amount    NUMERIC(12,2);
    v_currency  TEXT;
    v_creator   UUID;
    v_actor     UUID;
    v_role      TEXT;
    v_delta     NUMERIC(12,2);
BEGIN
    -- Nothing to journal if the status did not move.
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
    END IF;

    -- Pull the amount out of whichever column this table calls it. to_jsonb
    -- keeps the function generic across four tables with four different
    -- shapes, without one branch per table.
    v_amount := coalesce(
        (to_jsonb(NEW) ->> 'amount')::NUMERIC,
        (to_jsonb(NEW) ->> 'total_amount')::NUMERIC,
        (to_jsonb(NEW) ->> 'amount_owed')::NUMERIC,
        0
    );
    v_currency := coalesce(to_jsonb(NEW) ->> 'currency', 'USD');
    v_creator  := (to_jsonb(NEW) ->> 'creator_id')::UUID;   -- NULL for batches

    BEGIN
        v_actor := auth.uid();
    EXCEPTION WHEN OTHERS THEN
        v_actor := NULL;    -- applied by a migration or a service job
    END;

    IF v_actor IS NOT NULL THEN
        SELECT role INTO v_role FROM public.user_profiles WHERE id = v_actor;
    END IF;

    v_delta := v_amount * (
        public.payout_status_weight(v_entity, NEW.status)
      - public.payout_status_weight(v_entity, OLD.status)
    );

    INSERT INTO public.payout_ledger (
        entity_type, entity_id, creator_id,
        from_status, to_status,
        amount, amount_delta, currency,
        actor_user_id, actor_role,
        metadata
    ) VALUES (
        v_entity, NEW.id, v_creator,
        OLD.status, NEW.status,
        v_amount, v_delta, v_currency,
        v_actor, v_role,
        jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP)
    );

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.record_payout_transition() IS
    'AFTER UPDATE trigger: appends a payout_ledger row whenever status changes. '
    'Takes the entity_type as its first trigger argument.';


-- ============================================================================
-- SECTION 5 — attach to the four money tables
-- ============================================================================

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            ('creator_earnings',    'earning'),
            ('withdrawal_requests', 'withdrawal'),
            ('payments',            'payment'),
            ('payout_batches',      'batch')
        ) AS t(tbl, entity)
    LOOP
        IF to_regclass('public.' || r.tbl) IS NULL THEN
            RAISE NOTICE 'F-7: %.status not journalled -- table does not exist here', r.tbl;
            CONTINUE;
        END IF;

        EXECUTE format('DROP TRIGGER IF EXISTS trg_ledger_%s ON public.%I', r.entity, r.tbl);
        EXECUTE format(
            'CREATE TRIGGER trg_ledger_%s AFTER UPDATE OF status ON public.%I '
            'FOR EACH ROW EXECUTE FUNCTION public.record_payout_transition(%L)',
            r.entity, r.tbl, r.entity
        );
        RAISE NOTICE 'F-7: journalling %.status as entity_type=%', r.tbl, r.entity;
    END LOOP;
END;
$$;


-- ============================================================================
-- SECTION 6 — corrections
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reverse_ledger_entry(p_entry_id UUID, p_reason TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_orig public.payout_ledger%ROWTYPE;
    v_new  UUID;
    v_prior UUID;
BEGIN
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'reverse_ledger_entry: a reason is required. An unexplained reversal is worse than no ledger.';
    END IF;

    SELECT * INTO v_orig FROM public.payout_ledger WHERE id = p_entry_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'reverse_ledger_entry: no ledger entry %', p_entry_id;
    END IF;

    IF v_orig.reverses_entry_id IS NOT NULL THEN
        RAISE EXCEPTION 'reverse_ledger_entry: entry % is itself a reversal. Reverse the original instead.', p_entry_id;
    END IF;

    SELECT id INTO v_prior FROM public.payout_ledger WHERE reverses_entry_id = p_entry_id LIMIT 1;
    IF v_prior IS NOT NULL THEN
        RAISE EXCEPTION 'reverse_ledger_entry: entry % has already been reversed by %', p_entry_id, v_prior;
    END IF;

    INSERT INTO public.payout_ledger (
        entity_type, entity_id, creator_id,
        from_status, to_status,
        amount, amount_delta, currency,
        actor_user_id, actor_role, reason,
        reverses_entry_id, metadata
    ) VALUES (
        v_orig.entity_type, v_orig.entity_id, v_orig.creator_id,
        v_orig.to_status, v_orig.from_status,       -- the transition, undone
        v_orig.amount, -v_orig.amount_delta, v_orig.currency,
        auth.uid(),
        (SELECT role FROM public.user_profiles WHERE id = auth.uid()),
        p_reason,
        v_orig.id,
        jsonb_build_object('reversal_of', v_orig.id)
    )
    RETURNING id INTO v_new;

    RETURN v_new;
END;
$$;

REVOKE ALL  ON FUNCTION public.reverse_ledger_entry(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverse_ledger_entry(UUID, TEXT) TO service_role;

COMMENT ON FUNCTION public.reverse_ledger_entry(UUID, TEXT) IS
    'Appends a reversing entry for a ledger row. The original is never '
    'modified. Refuses to reverse a reversal, or to reverse twice.';


-- ============================================================================
-- SECTION 7 — the balance
-- ============================================================================

CREATE OR REPLACE FUNCTION public.payout_ledger_balance(p_creator_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT coalesce(sum(amount_delta), 0)::NUMERIC
    FROM public.payout_ledger
    WHERE creator_id = p_creator_id
      AND entity_type = 'earning';
$$;

COMMENT ON FUNCTION public.payout_ledger_balance(UUID) IS
    'The creator''s payable balance derived purely from the journal. Should '
    'equal SUM(amount) over creator_earnings in approved / withdrawal_requested '
    '/ batched -- see payout_ledger_reconcile().';

-- Reconciliation: the journal against the table it journals. A non-zero drift
-- means something wrote a status without going through the trigger, which is
-- the one failure this design has to be able to detect.
CREATE OR REPLACE FUNCTION public.payout_ledger_reconcile(p_creator_id UUID DEFAULT NULL)
RETURNS TABLE (creator_id UUID, ledger_balance NUMERIC, table_balance NUMERIC, drift NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    WITH ledger AS (
        SELECT l.creator_id, coalesce(sum(l.amount_delta), 0) AS bal
        FROM public.payout_ledger l
        WHERE l.entity_type = 'earning'
          AND (p_creator_id IS NULL OR l.creator_id = p_creator_id)
        GROUP BY l.creator_id
    ),
    tbl AS (
        SELECT e.creator_id, coalesce(sum(e.amount), 0) AS bal
        FROM public.creator_earnings e
        WHERE e.status IN ('approved', 'withdrawal_requested', 'batched')
          AND (p_creator_id IS NULL OR e.creator_id = p_creator_id)
        GROUP BY e.creator_id
    )
    SELECT
        coalesce(ledger.creator_id, tbl.creator_id),
        coalesce(ledger.bal, 0),
        coalesce(tbl.bal, 0),
        coalesce(ledger.bal, 0) - coalesce(tbl.bal, 0)
    FROM ledger
    FULL OUTER JOIN tbl ON tbl.creator_id = ledger.creator_id;
$$;

COMMENT ON FUNCTION public.payout_ledger_reconcile(UUID) IS
    'Journal balance vs table balance per creator. drift <> 0 means a status '
    'was written without passing through the ledger trigger.';


-- ============================================================================
-- SECTION 8 — RLS
-- ============================================================================

ALTER TABLE public.payout_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payout_ledger_creator_select   ON public.payout_ledger;
DROP POLICY IF EXISTS payout_ledger_owner_pm_select  ON public.payout_ledger;

-- A creator sees their own history and nothing else.
CREATE POLICY payout_ledger_creator_select ON public.payout_ledger
    FOR SELECT
    USING (
        creator_id IN (
            SELECT c.id FROM public.creators c WHERE c.user_id = auth.uid()
        )
    );

-- Owner and payment managers see everything.
CREATE POLICY payout_ledger_owner_pm_select ON public.payout_ledger
    FOR SELECT
    USING (
        public.get_my_payout_role() = 'owner'
        OR public.is_payment_manager('can_view_payouts')
    );

-- Note the absence of INSERT / UPDATE / DELETE policies. That is not an
-- oversight: with RLS on and no permissive policy for those commands, they are
-- refused for every non-owner role. Writes arrive only through the SECURITY
-- DEFINER trigger.


-- ============================================================================
-- SECTION 9 — verification
-- ============================================================================

DO $$
DECLARE
    v_triggers INT;
BEGIN
    SELECT count(*) INTO v_triggers
    FROM pg_trigger
    WHERE tgname LIKE 'trg_ledger_%' AND NOT tgisinternal;

    IF v_triggers = 0 THEN
        RAISE EXCEPTION 'F-7: no ledger triggers were installed. Refusing to report success.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_payout_ledger_immutable' AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION 'F-7: the immutability trigger is missing. The ledger would be editable.';
    END IF;

    RAISE NOTICE 'F-7: payout_ledger installed, % transition trigger(s), immutability enforced.', v_triggers;
END;
$$;

COMMIT;
