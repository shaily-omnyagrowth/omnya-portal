-- 20260908000000_campaign_shares_and_progress.sql
-- Add campaign share token and flight start date to campaigns

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
        ALTER TABLE campaigns ADD COLUMN start_date DATE DEFAULT CURRENT_DATE;
    END IF;
END $$;

-- Populate existing rows where share_token or start_date may be null
UPDATE campaigns SET share_token = gen_random_uuid()::text WHERE share_token IS NULL;
UPDATE campaigns SET start_date = COALESCE(created_at::date, CURRENT_DATE) WHERE start_date IS NULL;
UPDATE campaigns SET share_enabled = false WHERE share_enabled IS NULL;

-- Index for speedy lookups by share_token
CREATE INDEX IF NOT EXISTS idx_campaigns_share_token ON campaigns(share_token) WHERE share_token IS NOT NULL;
