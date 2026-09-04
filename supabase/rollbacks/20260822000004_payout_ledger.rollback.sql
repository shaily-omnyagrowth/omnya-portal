-- ============================================================================
-- ROLLBACK: 20260822000004_payout_ledger.sql   (F-7)
-- ============================================================================
--
-- Removes the journal and stops recording status transitions.
--
-- READ THIS FIRST. payout_ledger is the only record of who moved money and
-- when. Dropping the table destroys that history permanently and it cannot be
-- reconstructed from creator_earnings, because the whole reason the ledger
-- exists is that those tables overwrite status in place.
--
-- If the goal is only to stop the triggers firing -- for a bulk backfill, say
-- -- run SECTION 1 and stop. It leaves every recorded row intact.
--
-- SECTION 2 is the destructive part and is commented out on purpose. Uncomment
-- it only after exporting the table.
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1 — stop journalling (non-destructive)
-- ============================================================================

DROP TRIGGER IF EXISTS trg_ledger_earning    ON public.creator_earnings;
DROP TRIGGER IF EXISTS trg_ledger_withdrawal ON public.withdrawal_requests;
DROP TRIGGER IF EXISTS trg_ledger_payment    ON public.payments;
DROP TRIGGER IF EXISTS trg_ledger_batch      ON public.payout_batches;

DO $$
BEGIN
    RAISE WARNING
        'F-7 PARTIALLY ROLLED BACK: status transitions are no longer journalled. Existing payout_ledger rows are untouched.';
END;
$$;

COMMIT;


-- ============================================================================
-- SECTION 2 — destroy the journal  (COMMENTED OUT DELIBERATELY)
-- ============================================================================
--
-- Export first:
--   \copy (SELECT * FROM public.payout_ledger ORDER BY occurred_at) TO 'payout_ledger.csv' CSV HEADER
--
-- BEGIN;
--
-- DROP FUNCTION IF EXISTS public.payout_ledger_reconcile(UUID);
-- DROP FUNCTION IF EXISTS public.payout_ledger_balance(UUID);
-- DROP FUNCTION IF EXISTS public.reverse_ledger_entry(UUID, TEXT);
-- DROP FUNCTION IF EXISTS public.record_payout_transition();
-- DROP FUNCTION IF EXISTS public.payout_status_weight(TEXT, TEXT);
--
-- -- The immutability trigger blocks DELETE but not DROP TABLE; drop the
-- -- trigger first anyway so the intent is explicit rather than incidental.
-- DROP TRIGGER  IF EXISTS trg_payout_ledger_immutable ON public.payout_ledger;
-- DROP FUNCTION IF EXISTS public.payout_ledger_immutable();
--
-- DROP TABLE IF EXISTS public.payout_ledger;
--
-- COMMIT;
