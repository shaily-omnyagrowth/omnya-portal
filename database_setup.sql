-- Run this in Supabase SQL Editor to set up your database

-- 1. User profiles (links auth users to roles)
create table if not exists user_profiles (
  id uuid references auth.users primary key,
  email text unique not null,
  full_name text,
  role text default 'pending' check (role in ('creator','am','account_manager','owner','pending','denied')),
  created_at timestamptz default now()
);

-- 2. Account Managers
create table if not exists account_managers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users,
  name text not null,
  email text unique not null,
  created_at timestamptz default now()
);

-- 3. Creators
create table if not exists creators (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users,
  name text not null,
  email text unique not null,
  tiktok_handle text,
  instagram_handle text,
  status text default 'Active',
  weekly_rate numeric default 150,
  videos_per_week integer default 15,
  payment_status text default 'Current',
  am_id uuid references account_managers,
  created_at timestamptz default now()
);

-- 4. Clients
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  deal_type text default 'Monthly Retainer',
  videos_per_month integer default 20,
  budget numeric default 0,
  status text default 'Active',
  contact_name text,
  contact_email text,
  contact_phone text,
  contract_terms text,
  drive_link text,
  am_id uuid references account_managers,
  created_at timestamptz default now()
);

-- 5. Campaigns
create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client_id uuid references clients,
  description text,
  format text default 'TikTok',
  videos_needed integer default 10,
  pay_per_video numeric default 10,
  deadline date,
  status text default 'Open',
  application_type text default 'Open Application',
  assigned_creators uuid[] default '{}',
  created_at timestamptz default now()
);

-- 6. Submissions
create table if not exists submissions (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid references creators,
  campaign_id uuid references campaigns,
  submission_type text default 'Concept',
  concept_link text,
  concept_status text default 'Pending',
  posted_link text,
  final_status text,
  platform text default 'TikTok',
  feedback text,
  approved_date date,
  views_24h bigint, views_72h bigint, views_1w bigint, views_2w bigint, views_1m bigint,
  likes bigint, comments bigint, shares bigint, saves bigint,
  payment_status text default 'Unpaid',
  ai_insights jsonb,
  created_at timestamptz default now()
);

-- 7. Payments
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid references creators,
  campaign_id uuid references campaigns,
  submission_id uuid references submissions,
  week_ending date,
  videos_approved integer default 0,
  amount_owed numeric default 0,
  status text default 'Pending',
  payment_method text,
  paid_date date,
  created_at timestamptz default now()
);

-- 8. Messages (Forum)
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references campaigns,
  user_id uuid,
  sender_name text,
  content text,
  reactions jsonb default '{}',
  is_pinned boolean default false,
  created_at timestamptz default now()
);

-- Enable Row Level Security (allow all for development)
alter table user_profiles enable row level security;
alter table creators enable row level security;
alter table clients enable row level security;
alter table campaigns enable row level security;
alter table submissions enable row level security;
alter table payments enable row level security;
alter table account_managers enable row level security;
alter table messages enable row level security;

-- Policies
create policy "Allow all" on user_profiles for all using (true) with check (true);
create policy "Allow all" on creators for all using (true) with check (true);
create policy "Allow all" on clients for all using (true) with check (true);
create policy "Allow all" on campaigns for all using (true) with check (true);
create policy "Allow all" on submissions for all using (true) with check (true);
create policy "Allow all" on payments for all using (true) with check (true);
create policy "Allow all" on account_managers for all using (true) with check (true);
create policy "Allow all" on messages for all using (true) with check (true);
