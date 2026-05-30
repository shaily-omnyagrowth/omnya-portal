-- =============================================================================
-- Stripe Connect support for creator payouts
-- Migration: 20260530000002_stripe_connect.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- creators: Stripe Connect fields
-- ---------------------------------------------------------------------------
ALTER TABLE public.creators
  ADD COLUMN IF NOT EXISTS stripe_account_id       TEXT,
  ADD COLUMN IF NOT EXISTS stripe_account_status   TEXT DEFAULT 'not_connected',
  ADD COLUMN IF NOT EXISTS stripe_onboarding_url   TEXT,
  ADD COLUMN IF NOT EXISTS stripe_connected_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stripe_charges_enabled  BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_payouts_enabled  BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_details_submitted BOOLEAN DEFAULT false;

-- Allowed stripe_account_status values:
--   not_connected  — creator has not started Stripe onboarding
--   onboarding     — onboarding link generated, awaiting completion
--   pending        — submitted but Stripe still reviewing
--   active         — charges_enabled AND payouts_enabled (ready for payouts)
--   disabled       — Stripe disabled the account (e.g. compliance issue)

-- Index for webhook lookups by stripe_account_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_creators_stripe_account_id
  ON public.creators(stripe_account_id)
  WHERE stripe_account_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- payments: Stripe transfer tracking fields
-- ---------------------------------------------------------------------------
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS stripe_transfer_id      TEXT,
  ADD COLUMN IF NOT EXISTS stripe_transfer_status  TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS stripe_transfer_error   TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS stripe_initiated_at     TIMESTAMPTZ;

-- Index for webhook lookups by transfer ID
CREATE INDEX IF NOT EXISTS idx_payments_stripe_transfer_id
  ON public.payments(stripe_transfer_id)
  WHERE stripe_transfer_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- withdrawal_requests: Stripe payout method flag
-- ---------------------------------------------------------------------------
ALTER TABLE public.withdrawal_requests
  ADD COLUMN IF NOT EXISTS is_stripe_payout BOOLEAN DEFAULT false;
