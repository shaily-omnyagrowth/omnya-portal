-- OAuth Tokens Storage
CREATE TABLE IF NOT EXISTS creator_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL, -- 'meta', 'youtube', 'tiktok'
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  platform_account_id TEXT,
  platform_account_name TEXT,
  scopes TEXT[],
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, platform)
);

-- Payouts System
CREATE TABLE IF NOT EXISTS payout_batches (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  status TEXT DEFAULT 'draft', -- 'draft', 'paid'
  period_start DATE,
  period_end DATE,
  total_amount NUMERIC(10,2) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  paid_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS payout_line_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id UUID REFERENCES payout_batches(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  role TEXT, -- 'creator' or 'am'
  amount NUMERIC(10,2) NOT NULL,
  payment_method TEXT,
  payment_details JSONB,
  status TEXT DEFAULT 'pending'
);

-- Add payout reference to submissions if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='submissions' AND column_name='payout_batch_id') THEN
        ALTER TABLE submissions ADD COLUMN payout_batch_id UUID REFERENCES payout_batches(id);
    END IF;
END $$;
