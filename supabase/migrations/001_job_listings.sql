-- ============================================================
-- Migration 001 — job listings pool + ingest cursor
-- ============================================================
-- PASTE THIS FILE, NOT supabase/schema.sql, INTO THE SUPABASE SQL EDITOR.
--
-- supabase/schema.sql drops and recreates the `on_auth_user_created` trigger
-- on auth.users, so re-running it against a live project briefly leaves
-- sign-ups without a profile row. It must never be re-run against production.
-- This file contains only the new statements from that batch and is safe to
-- run on its own. It is idempotent: every statement is `if not exists` or
-- `drop ... if exists` first.
--
-- After running it, the same statements already live at the end of
-- supabase/schema.sql so a fresh project still gets them from one file.
-- ============================================================

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
