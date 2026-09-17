-- ============================================================
-- Migration 002 — rank cache + rank rate limit
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
-- Run 001_job_listings.sql first if it has not been run — nothing here depends
-- on it structurally, but the two together are one feature.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Rank cache — one row per (user, query shape)
-- ------------------------------------------------------------
-- WHY THIS IS A TABLE AND NOT A MODULE-LEVEL Map.
--
-- Production runs on Vercel functions, which are stateless between
-- invocations: a Map populated on one request is gone by the next, and a warm
-- container that happens to survive is an optimisation nobody can rely on or
-- reason about. An in-memory cache there is not a small win, it is a hit rate
-- of roughly zero dressed up as a cache.
--
-- That matters here more than it usually would, because the entire promise of
-- the ranking feature is that RE-RENDERING A RESULT LIST COSTS ZERO LLM CALLS.
-- The user changes a local slider, flips back to the tab, or reloads — none of
-- that is a new question, and none of it should be a new spend of tokens and
-- seconds. The cache key encodes the resume, the matcher version and the
-- filters, so anything that would genuinely change the answer misses; anything
-- that would not, hits.
--
-- `payload` is the whole graph result, stored verbatim, so a hit needs no
-- re-scoring, no re-shaping, and no knowledge of the graph that produced it.
create table if not exists public.rank_cache (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  -- sha256 over {resumeHash, matcherVersion, sorted filters}. See
  -- cacheKey() in server/jobs/rankCache.js — that function is the definition.
  cache_key text not null,
  payload jsonb not null,
  created_at timestamptz default now(),
  -- Absolute, not a TTL column: the reader compares against now() and does not
  -- need to know what the TTL was when the row was written.
  expires_at timestamptz not null,
  -- One live entry per query shape per user. The writer upserts on this.
  unique (user_id, cache_key)
);

create index if not exists idx_rank_cache_expires_at on public.rank_cache(expires_at);

alter table public.rank_cache enable row level security;

-- Read your own rows and nothing else. Today every read goes through Express
-- with the service role (which bypasses RLS), so this policy is defence in
-- depth for the day someone queries this table from the browser with the anon
-- key: they get their own cached results, never another user's.
drop policy if exists "Users can view own rank cache" on public.rank_cache;
create policy "Users can view own rank cache"
  on public.rank_cache for select
  using (auth.uid() = user_id);

-- No insert/update/delete policy, on purpose. Writes happen only in
-- server/jobs/rankCache.js via the service role. Same anti-tamper shape as
-- credit_transactions: a client that could write here could serve itself a
-- forged ranking.

-- ------------------------------------------------------------
-- 2. Rank rate limit — one row per user, one rolling window
-- ------------------------------------------------------------
-- A fixed window rather than a sliding log: one row per user, two columns, and
-- a reset that is a comparison rather than a scan. Ranking is not free (it is
-- several LLM calls per request) but it also costs the user no credits, so the
-- limit is what stands between a stuck render loop and a provider bill.
--
-- Going over this limit is NOT an error. The server answers with the cached
-- result when it has one and a keyword-scored result otherwise, flagged
-- `limited: true`. See RANK_LIMIT_PER_HOUR in server/jobs/rankCache.js.
create table if not exists public.rank_rate_limit (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  window_start timestamptz not null default now(),
  request_count integer not null default 0,
  updated_at timestamptz default now()
);

alter table public.rank_rate_limit enable row level security;

-- Zero policies, on purpose. RLS on with no policy = deny-all for the anon and
-- authenticated roles; only the service role (which bypasses RLS) can touch
-- it. A user who could read this could time their requests around it, and a
-- user who could write it would have no limit at all.

-- ------------------------------------------------------------
-- 3. updated_at trigger
-- ------------------------------------------------------------
-- public.handle_updated_at() is defined in supabase/schema.sql. If this
-- migration is being run against a project that predates it, run schema.sql's
-- function definition first.
--
-- rank_cache deliberately has no updated_at trigger: its rows are replaced
-- wholesale on every write, and `created_at` plus `expires_at` already say
-- everything there is to know about a row's age.

drop trigger if exists rank_rate_limit_updated_at on public.rank_rate_limit;
create trigger rank_rate_limit_updated_at
  before update on public.rank_rate_limit
  for each row execute function public.handle_updated_at();
