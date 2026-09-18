-- 20260908000000_campaign_shares_and_progress.sql
-- Add campaign share token and flight start date to campaigns
--
-- One transaction, idempotent: every ADD COLUMN is guarded, every UPDATE only
-- touches NULLs, and the index is IF NOT EXISTS. A failure changes nothing and
-- a second run is a no-op.
--
-- Without it, "Share" on a campaign fails with "Failed to update share
-- settings" (api/campaigns/manage-share.js writes share_enabled / share_token)
-- and no client report link can be created. See APPLY_20260908.md.

BEGIN;

DO $$ 
BEGIN
    -- 1. Add share_token if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'campaigns' AND column_name = 'share_token'
    ) THEN
        ALTER TABLE campaigns ADD COLUMN share_token TEXT UNIQUE DEFAULT gen_random_uuid()::text;
    END IF;

    -- 2. Add share_enabled if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'campaigns' AND column_name = 'share_enabled'
    ) THEN
        ALTER TABLE campaigns ADD COLUMN share_enabled BOOLEAN DEFAULT false;
    END IF;

    -- 3. Add share_created_at if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'campaigns' AND column_name = 'share_created_at'
    ) THEN
        ALTER TABLE campaigns ADD COLUMN share_created_at TIMESTAMPTZ DEFAULT now();
    END IF;

    -- 4. Add start_date if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'campaigns' AND column_name = 'start_date'
    ) THEN
        -- No default at ADD time: with one, Postgres fills every existing row
        -- with today's date and the backfill finds nothing NULL. Backfill from
        -- created_at first, then set the default for rows inserted later.
        ALTER TABLE campaigns ADD COLUMN start_date DATE;
        UPDATE campaigns SET start_date = COALESCE(created_at::date, CURRENT_DATE);
        ALTER TABLE campaigns ALTER COLUMN start_date SET DEFAULT CURRENT_DATE;
    END IF;
END $$;

-- Populate existing rows where share_token or start_date may be null
UPDATE campaigns SET share_token = gen_random_uuid()::text WHERE share_token IS NULL;
UPDATE campaigns SET start_date = COALESCE(created_at::date, CURRENT_DATE) WHERE start_date IS NULL;
UPDATE campaigns SET share_enabled = false WHERE share_enabled IS NULL;

-- Index for speedy lookups by share_token
CREATE INDEX IF NOT EXISTS idx_campaigns_share_token ON campaigns(share_token) WHERE share_token IS NOT NULL;

COMMIT;
