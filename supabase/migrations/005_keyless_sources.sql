-- ============================================================
-- Migration 005 — allow the four keyless aggregators as sources
-- ============================================================
-- PASTE THIS FILE INTO THE SUPABASE SQL EDITOR, AFTER 001-004.
-- Do NOT paste supabase/schema.sql: it drops and recreates the
-- `on_auth_user_created` trigger on auth.users, so re-running it against a
-- live project briefly leaves sign-ups without a profile row.
--
-- IT IS SAFE TO RE-RUN. The drop is `if exists` and the add immediately
-- recreates the constraint, so running this twice leaves exactly the state it
-- leaves once. This is the same shape as 003.
--
-- WHY: server/jobs/adapters/index.js now registers four more sources —
-- 'arbeitnow', 'remoteok', 'jobicy' and 'himalayas'. Until this runs, every
-- row from those four is rejected by the CHECK at insert time; ingest reports
-- a `db:` error for each of them and keeps working for everything else, so the
-- symptom is four sources that fetch fine and store nothing.
--
-- 'wellfound' STAYS in the list even though there is no adapter for it. It is
-- in the constraint 003 shipped, dropping a value is not additive, and
-- job_ingest_state still holds its row. Removing it buys nothing and could
-- reject a pre-existing row.
--
-- The unqualified check in 001 is auto-named by Postgres as
-- `job_listings_source_check`. If the constraint was ever created under a
-- different name, the drop below silently does nothing and the add then fails
-- with "constraint already exists" — check
-- `select conname from pg_constraint where conrelid = 'public.job_listings'::regclass`
-- and drop the real name.
--
-- THREE PLACES HOLD THIS LIST and they drift silently: this constraint, the
-- adapter registry in server/jobs/adapters/index.js, and KNOWN_SOURCES in
-- server/jobs/query.js. Only the last is on the read path, so a source missing
-- from THERE is not an error — it is silently dropped and the caller gets the
-- UNFILTERED pool back, which looks like a working filter that matches
-- everything. A test in test/jobs/query.test.js asserts that set against
-- ADAPTERS; this comment is the third corner.
-- ============================================================

-- The add revalidates every existing row. That cannot fail here: the new list
-- is a strict superset of the old one, so anything already stored still passes.
alter table public.job_listings
  drop constraint if exists job_listings_source_check;

alter table public.job_listings
  add constraint job_listings_source_check
  check (source in (
    'adzuna', 'remotive', 'ats', 'wellfound', 'cache',
    'arbeitnow', 'remoteok', 'jobicy', 'himalayas'
  ));
