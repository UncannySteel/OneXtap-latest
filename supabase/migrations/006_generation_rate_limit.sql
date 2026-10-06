-- ============================================================
-- 006 — Generation rate limit
-- ============================================================
-- One table: an hourly ceiling on AI drafts per account, for
-- POST /api/answer-vault/generate (Answer Studio and cover letters). See
-- server/generateLimit.js for why, and GENERATE_LIMIT_PER_HOUR (default 30).
--
-- Additive and re-runnable: it creates one table and one trigger, and touches
-- nothing that exists. Until it is applied, the route still works: the limit
-- fails open and the server logs "generation limit unavailable" once.
--
-- Run it after supabase/schema.sql (it needs public.profiles and
-- public.handle_updated_at()). Record the apply in
-- supabase/migrations/README.md.

-- ------------------------------------------------------------
-- 1. The table — one row per account, one fixed window
-- ------------------------------------------------------------
-- The same shape as rank_rate_limit (002): a reset is a comparison, not a
-- scan. Over the limit, the route answers 429 with when to try again.
create table if not exists public.generation_rate_limit (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  window_start timestamptz not null default now(),
  request_count integer not null default 0,
  updated_at timestamptz default now()
);

alter table public.generation_rate_limit enable row level security;

-- Zero policies, on purpose: RLS on with no policy denies the anon and
-- authenticated roles; only the service role (which bypasses RLS) reads or
-- writes it. A user who could write it would have no limit at all.

-- ------------------------------------------------------------
-- 2. updated_at trigger
-- ------------------------------------------------------------
-- public.handle_updated_at() is defined in supabase/schema.sql.
drop trigger if exists generation_rate_limit_updated_at on public.generation_rate_limit;
create trigger generation_rate_limit_updated_at
  before update on public.generation_rate_limit
  for each row execute function public.handle_updated_at();
