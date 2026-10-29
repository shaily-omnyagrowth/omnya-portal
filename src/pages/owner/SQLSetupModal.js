import { useState } from "react";

export default function SQLSetupModal({ onClose }) {
  const sql = `-- Run this in Supabase SQL Editor to set up your database

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
do $$
begin
  drop policy if exists "Allow all" on user_profiles;
  drop policy if exists "Allow all" on creators;
  drop policy if exists "Allow all" on clients;
  drop policy if exists "Allow all" on campaigns;
  drop policy if exists "Allow all" on submissions;
  drop policy if exists "Allow all" on payments;
  drop policy if exists "Allow all" on account_managers;
  drop policy if exists "Allow all" on messages;
end $$;

create policy "Allow all" on messages for all using (true) with check (true);

-- Performance Indexes
create index if not exists idx_user_profiles_role on user_profiles(role);
create index if not exists idx_creators_user_id on creators(user_id);
create index if not exists idx_submissions_creator_id on submissions(creator_id);
create index if not exists idx_submissions_campaign_id on submissions(campaign_id);
create index if not exists idx_campaigns_status on campaigns(status);
create index if not exists idx_payments_status on payments(status);`;

  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(sql); setCopied(true); setTimeout(()=>setCopied(false),2000); };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{maxWidth:700,maxHeight:"80vh"}} onClick={e=>e.stopPropagation()}>
        <div className="flex-between mb-16">
          <div><div className="modal-title">Database Setup</div><div className="modal-sub">Run this SQL in your Supabase SQL Editor to create all tables</div></div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:16,marginBottom:16}}>
          <div style={{fontSize:12,fontWeight:600,color:"var(--ink3)",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.5px"}}>Instructions</div>
          <div style={{fontSize:13,color:"var(--ink2)",lineHeight:1.7}}>
            1. Go to <strong>supabase.com</strong> → your <strong>omnya-portal</strong> project<br/>
            2. Click <strong>SQL Editor</strong> in the left sidebar<br/>
            3. Click <strong>New Query</strong><br/>
            4. Paste the SQL below and click <strong>Run</strong><br/>
            5. Come back here and refresh — your database is ready!
          </div>
        </div>
        <div style={{background:"#1a1a2e",borderRadius:"var(--radius-sm)",padding:16,overflowY:"auto",maxHeight:300,marginBottom:16}}>
          <pre style={{fontFamily:"monospace",fontSize:11,color:"#a8d8a8",whiteSpace:"pre-wrap",lineHeight:1.6}}>{sql}</pre>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={copy}>{copied?"✓ Copied!":"Copy SQL"}</button>
        </div>
      </div>
    </div>
  );
}
