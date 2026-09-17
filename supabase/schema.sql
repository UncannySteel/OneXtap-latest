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
-- Job ingest (Batch 2)
-- ============================================================
-- These same statements also live standalone in
-- supabase/migrations/001_job_listings.sql. Run THAT file against an existing
-- project: this one drops and recreates on_auth_user_created above, which a
-- live project must not have happen.

-- ------------------------------------------------------------
-- 1. Job listings — the shared pool
-- ------------------------------------------------------------
-- Deliberately NO user_id. A listing scraped from Adzuna is the same listing
-- for every user, so a per-user copy would multiply the row count by the user
-- count and buy nothing. Personalisation (scoring, ranking, hiding) happens
-- per request against this one shared pool.
create table if not exists public.job_listings (
  id uuid default gen_random_uuid() primary key,
  -- Source-prefixed, e.g. 'adzuna:12345'. Two providers can and do hand out
  -- the same bare numeric id, so the prefix is what keeps them apart.
  job_id text not null unique,
  source text not null check (source in ('adzuna', 'remotive', 'wellfound', 'cache')),
  source_id text not null,
  title text not null,
  url text not null,
  company text,
  location text,
  category text,
  job_type text,
  remote boolean not null default false,
  description text,
  tags text[] not null default '{}',
  -- Compact [{t, w, r}] rows from extractKeywords(), capped at 25 per listing.
  keywords jsonb not null default '[]'::jsonb,
  -- Flat mirror of keywords[].t. Exists purely so the GIN index below can be
  -- a plain text[] index instead of a jsonb path expression.
  keyword_terms text[] not null default '{}',
  requirements text[] not null default '{}',
  salary_min numeric,
  salary_max numeric,
  salary_currency text,
  -- 'snippet' means the provider truncated the description (Adzuna cuts at
  -- ~200 chars). The matcher down-weights confidence for those.
  description_quality text not null default 'full'
    check (description_quality in ('full', 'snippet')),
  -- DELIBERATELY NOT UNIQUE.
  -- This is sha256(company|title|city) — a near-duplicate *hint* for grouping
  -- the same opening syndicated across several boards. A unique constraint
  -- here would silently drop genuinely distinct openings: a company hiring
  -- three backend engineers in one city produces three legitimate rows with
  -- one identical hash. Dedupe at read time, where a human can see what got
  -- collapsed; never at write time, where the loss is invisible.
  dedupe_hash text,
  posted_at timestamptz,
  ingested_at timestamptz default now(),
  last_seen_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  -- The upsert conflict target. job_id is derived from these two, but
  -- PostgREST needs the pair itself to be constrained to use onConflict.
  unique (source, source_id)
);

create index if not exists idx_job_listings_posted_at on public.job_listings(posted_at desc);
create index if not exists idx_job_listings_source on public.job_listings(source);
create index if not exists idx_job_listings_remote on public.job_listings(remote);
create index if not exists idx_job_listings_dedupe_hash on public.job_listings(dedupe_hash);
-- GIN so `keyword_terms && array['react','typescript']` is an index scan.
create index if not exists idx_job_listings_keyword_terms on public.job_listings using gin(keyword_terms);

alter table public.job_listings enable row level security;

-- Read is public: job listings are public postings, and the dashboard needs
-- them with or without a session.
--
-- WHY THIS POLICY EARNS ITS KEEP even though every read today goes through
-- Express with supabaseAdmin (service_role, which bypasses RLS entirely):
-- src/supabaseClient.js hands the React app a live anon-key client. The day
-- someone writes `supabase.from('job_listings')` in the browser — for a quick
-- prototype, or to skip a round trip — this policy is the only thing that
-- decides what happens. With it, they get reads and nothing else. Without it,
-- they would get a confusing empty result and probably "fix" it by loosening
-- RLS. Defense in depth, and a pre-answered question.
drop policy if exists "Anyone can view job listings" on public.job_listings;
create policy "Anyone can view job listings"
  on public.job_listings for select
  using (true);

-- No insert/update/delete policy, on purpose. Writes happen only in
-- server/jobs/ingest.js via the service role. Same anti-tamper shape as
-- credit_transactions: the browser can read the pool but can never poison it.

-- ------------------------------------------------------------
-- 2. Ingest cursor / run state
-- ------------------------------------------------------------
-- One row per adapter. It exists because paging has to be resumable across
-- daily cron runs: vercel.json crons are static JSON — they fire a bare GET
-- with no parameters and cannot carry "start at page 4". Without a cursor
-- stored server-side, every run would re-read page 1 forever and the pool
-- would never grow past the first 50 results per source.
--
-- Also the only place a provider failure is durable: last_status/last_error
-- are what distinguish "a dead Adzuna key" from "a quiet job market".
create table if not exists public.job_ingest_state (
  source text primary key,
  next_page integer not null default 1,
  last_run_at timestamptz,
  last_status text,
  last_error text,
  inserted_count integer default 0,
  updated_at timestamptz default now()
);

alter table public.job_ingest_state enable row level security;

-- Zero policies, on purpose. RLS on with no policy = deny-all for the anon and
-- authenticated roles; only the service role (which bypasses RLS) can touch
-- it. This is operational metadata — cursors, provider error strings — and has
-- no business reaching a browser.

-- ------------------------------------------------------------
-- 3. updated_at triggers
-- ------------------------------------------------------------
-- public.handle_updated_at() is defined in supabase/schema.sql. If this
-- migration is being run against a project that predates it, run schema.sql's
-- function definition first.

drop trigger if exists job_listings_updated_at on public.job_listings;
create trigger job_listings_updated_at
  before update on public.job_listings
  for each row execute function public.handle_updated_at();

drop trigger if exists job_ingest_state_updated_at on public.job_ingest_state;
create trigger job_ingest_state_updated_at
  before update on public.job_ingest_state
  for each row execute function public.handle_updated_at();
