-- ============================================================
-- Migration 003 — allow 'ats' as a job_listings source
-- ============================================================
-- PASTE THIS FILE INTO THE SUPABASE SQL EDITOR, AFTER 001 AND 002.
-- Do NOT paste supabase/schema.sql: it drops and recreates the
-- `on_auth_user_created` trigger on auth.users, so re-running it against a live
-- project briefly leaves sign-ups without a profile row.
--
-- It is SAFE TO RE-RUN. The drop is `if exists` and the add immediately
-- recreates the constraint, so running this twice leaves exactly the state it
-- leaves once.
--
-- WHY: 001 created job_listings with
--
--   source text not null check (source in ('adzuna','remotive','wellfound','cache'))
--
-- and server/jobs/adapters/ats.js adds a fifth source, 'ats' — the Greenhouse,
-- Lever and Ashby board APIs behind one adapter id. Until this runs, every ATS
-- row is rejected by that check at insert time and ingest reports a db: error
-- for the source while every other source keeps working.
--
-- 001 IS NOT EDITED. It has already been applied by hand and there is no
-- migration history to re-run it against, so widening the constraint is its own
-- forward step rather than a rewrite of a file that has already shipped.
--
-- The unqualified check in 001 is auto-named by Postgres as
-- `job_listings_source_check` (table_column_check). If the constraint was ever
-- created under a different name, the drop below silently does nothing and the
-- add then fails with "constraint already exists" — check
-- `select conname from pg_constraint where conrelid = 'public.job_listings'::regclass`
-- and drop the real name.
-- ============================================================

-- The add revalidates every existing row. That cannot fail here: the new list
-- is a strict superset of the old one, so anything already stored still passes.
alter table public.job_listings
  drop constraint if exists job_listings_source_check;

alter table public.job_listings
  add constraint job_listings_source_check
  check (source in ('adzuna', 'remotive', 'ats', 'wellfound', 'cache'));
