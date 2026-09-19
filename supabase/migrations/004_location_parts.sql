-- ============================================================
-- Migration 004 — structured location columns on job_listings
-- ============================================================
-- PASTE THIS FILE INTO THE SUPABASE SQL EDITOR, AFTER 001, 002 AND 003.
-- Do NOT paste supabase/schema.sql: it drops and recreates the
-- `on_auth_user_created` trigger on auth.users, so re-running it against a
-- live project briefly leaves sign-ups without a profile row.
--
-- IT IS SAFE TO RE-RUN and it is NON-DESTRUCTIVE. Every statement is
-- `if not exists`; nothing is dropped, nothing is rewritten, and no existing
-- column or row is touched. It should not trip the SQL editor's
-- "destructive operation" warning.
--
-- WHY: the location filter was `ilike '%<typed text>%'` against the single
-- free-text `location` column, and that column holds whatever the provider
-- prints. Adzuna prints "Tampa Palms, Hillsborough County" — a city and a
-- COUNTY, never the state and never the country — so a user searching
-- "Florida" or "United States" matched nothing across ~83% of the pool while
-- the UI showed a filter as applied. Adzuna does send the structured form
-- (`area` = ['US','Florida','Hillsborough County','Tampa Palms']); the adapter
-- was discarding it.
--
-- `location` STAYS. It is what the job card displays, it is part of
-- `dedupe_hash`, and these three columns are derived from it (or from the
-- provider's structured field) rather than replacing it.
--
-- BACKFILL: none here, deliberately. These columns are populated by
-- normalizeListing() at ingest, so existing rows have them null until they are
-- re-ingested — which the daily cron does on its own rolling sweep. A SQL
-- backfill would have to re-implement splitLocation() in PL/pgSQL and the two
-- would drift. Until a row is re-seen, it simply does not appear under a
-- structured location filter; the free-text column still works for it.

alter table public.job_listings
  add column if not exists location_city text,
  add column if not exists location_region text,
  add column if not exists location_country text;

-- Case-insensitive equality is how the typeahead queries these: the user picks
-- a value the API offered, so it is an exact match, not a prefix scan. lower()
-- expression indexes keep that an index scan regardless of how the provider
-- capitalised it.
create index if not exists idx_job_listings_location_country
  on public.job_listings (lower(location_country));
create index if not exists idx_job_listings_location_region
  on public.job_listings (lower(location_region));
create index if not exists idx_job_listings_location_city
  on public.job_listings (lower(location_city));

comment on column public.job_listings.location_city is
  'Derived by splitLocation() in server/jobs/normalizeListing.js. Null when the provider gave no city.';
comment on column public.job_listings.location_region is
  'State, province or broad region ("Florida", "CA", "Europe"). Null when unknown.';
comment on column public.job_listings.location_country is
  'Full country name, never a code ("United States", not "US"). Null when unknown.';
