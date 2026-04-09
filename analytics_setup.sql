-- Table to store unified post-level analytics for all platforms
create table if not exists video_analytics (
  id uuid primary key default gen_random_uuid(),
  platform text not null, -- 'tiktok', 'meta', 'youtube'
  creator_id uuid references creators(id),
  campaign_id uuid references campaigns(id),
  submission_id uuid references submissions(id),
  video_id text not null, -- Platform specific ID (e.g. IG Media ID, TikTok Video ID)
  views bigint default 0,
  likes bigint default 0,
  comments bigint default 0,
  shares bigint default 0,
  reach bigint default 0,
  saves bigint default 0,
  watch_time numeric, -- in seconds
  pulled_at timestamptz default now(),
  unique(submission_id)
);

-- Enable RLS
alter table video_analytics enable row level security;

-- Policy to allow creators to see their own analytics
create policy "Allow owners to see their own analytics" 
on video_analytics for select 
using (
  exists (
    select 1 from creators 
    where creators.id = video_analytics.creator_id 
    and creators.user_id = auth.uid()
  )
);
