-- Ensure creator_tokens table exists and has all necessary fields for TikTok and Meta/Instagram
create table if not exists creator_tokens (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid references creators(id) on delete cascade,
  platform text not null, -- 'tiktok', 'meta', 'youtube', etc.
  access_token text not null,
  refresh_token text,
  scopes text,
  account_id text, -- Specific ID from the platform (e.g., IG Business Account ID)
  account_name text, -- Username or display name
  expires_at timestamptz,
  updated_at timestamptz default now(),
  unique(creator_id, platform)
);

-- Enable RLS
alter table creator_tokens enable row level security;

-- Policy to allow creators to see their own tokens (read-only for frontend)
create policy "Allow owners to see their own tokens" 
on creator_tokens for select 
using (
  exists (
    select 1 from creators 
    where creators.id = creator_tokens.creator_id 
    and creators.user_id = auth.uid()
  )
);
