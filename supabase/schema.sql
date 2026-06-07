-- ============================================================
-- Onextap Database Schema
-- Run this in your Supabase SQL Editor (supabase.com → project → SQL Editor)
-- ============================================================

-- 1. Profiles table (extends Supabase auth.users)
-- Auto-created on sign-up via trigger below
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text,
  display_name text,
  credits integer not null default 3,
  is_premium boolean not null default false,
  dodo_customer_id text unique,
  dodo_subscription_id text,
  subscription_status text default 'none',
  premium_since timestamptz,
  cancelled_at timestamptz,
  payment_failed boolean default false,
  last_failed_payment timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. Credit transactions (audit log)
create table if not exists public.credit_transactions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  amount integer not null, -- positive = add, negative = deduct
  type text not null check (type in ('initial', 'usage', 'refund', 'purchase', 'bonus')),
  description text,
  created_at timestamptz default now()
);

-- Index for fast lookups by user
create index if not exists idx_credit_transactions_user_id on public.credit_transactions(user_id);
create index if not exists idx_profiles_dodo_customer_id on public.profiles(dodo_customer_id);

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================

alter table public.profiles enable row level security;
alter table public.credit_transactions enable row level security;

-- Profiles: users can read their own profile
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- Profiles: users can update their own profile (limited fields)
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Credit transactions: users can view their own transactions
create policy "Users can view own transactions"
  on public.credit_transactions for select
  using (auth.uid() = user_id);

-- Note: INSERT/UPDATE on credit_transactions is done via service_role (server-side only)
-- No insert/update policy for regular users = tamper-proof credits

-- ============================================================
-- Auto-create profile on sign-up (trigger)
-- ============================================================

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, display_name, credits)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    3
  );
  -- Log the initial credits grant
  insert into public.credit_transactions (user_id, amount, type, description)
  values (new.id, 3, 'initial', 'Welcome bonus: 3 free AI credits');
  return new;
end;
$$ language plpgsql security definer;

-- Drop existing trigger if it exists, then create
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- Auto-update updated_at timestamp
-- ============================================================

create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();

-- ============================================================
-- Job Intelligence (Phase 2/3)
-- ============================================================

-- Canonical aggregated job openings.
create table if not exists public.job_openings (
  id text primary key,
  source text,
  title text not null,
  company text not null,
  location text,
  remote_type text,
  salary_min numeric,
  salary_max numeric,
  currency text,
  visa_sponsorship boolean default false,
  seniority text,
  experience_min_years numeric,
  domain_tags text[] default '{}',
  required_skills text[] default '{}',
  preferred_skills text[] default '{}',
  url text,
  posted_at_source timestamptz not null,
  first_seen_at timestamptz not null default now(),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_job_openings_posted_at_source on public.job_openings(posted_at_source desc);
create index if not exists idx_job_openings_company on public.job_openings(company);

drop trigger if exists job_openings_updated_at on public.job_openings;
create trigger job_openings_updated_at
  before update on public.job_openings
  for each row execute function public.handle_updated_at();

-- Profile-specific match snapshots.
create table if not exists public.job_match_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  profile_name text not null,
  job_id text references public.job_openings(id) on delete cascade not null,
  final_score integer not null check (final_score >= 0 and final_score <= 100),
  match_category text not null check (match_category in ('Strong Match', 'Good Match', 'Stretch Match', 'Low Match')),
  score_breakdown jsonb not null default '{}'::jsonb,
  reasons text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, profile_name, job_id)
);

create index if not exists idx_job_match_scores_user_profile on public.job_match_scores(user_id, profile_name, updated_at desc);
create index if not exists idx_job_match_scores_job_id on public.job_match_scores(job_id);

drop trigger if exists job_match_scores_updated_at on public.job_match_scores;
create trigger job_match_scores_updated_at
  before update on public.job_match_scores
  for each row execute function public.handle_updated_at();

-- User application tracker.
create table if not exists public.job_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  job_id text not null,
  profile_name text,
  status text not null check (status in ('saved', 'in_progress', 'applied', 'interview', 'offer', 'rejected')),
  company text,
  title text,
  url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, job_id)
);

create index if not exists idx_job_applications_user_updated_at on public.job_applications(user_id, updated_at desc);

drop trigger if exists job_applications_updated_at on public.job_applications;
create trigger job_applications_updated_at
  before update on public.job_applications
  for each row execute function public.handle_updated_at();

-- ============================================================
-- RLS for job intelligence tables
-- ============================================================

alter table public.job_openings enable row level security;
alter table public.job_match_scores enable row level security;
alter table public.job_applications enable row level security;

drop policy if exists "Authenticated users can view job openings" on public.job_openings;
create policy "Authenticated users can view job openings"
  on public.job_openings for select
  to authenticated
  using (true);

drop policy if exists "Users can view own match scores" on public.job_match_scores;
create policy "Users can view own match scores"
  on public.job_match_scores for select
  using (auth.uid() = user_id);

drop policy if exists "Users can view own applications" on public.job_applications;
create policy "Users can view own applications"
  on public.job_applications for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own applications" on public.job_applications;
create policy "Users can insert own applications"
  on public.job_applications for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own applications" on public.job_applications;
create policy "Users can update own applications"
  on public.job_applications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
