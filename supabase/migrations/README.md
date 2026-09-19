# Migration ledger

There is no migration tool and no migration history table. Files here are pasted
by hand into the Supabase SQL Editor, so **this file is the only record of what
has actually been applied where.** Update it in the same commit as the apply.

Risk S3 in `docs/backend-schema.md` is exactly this gap. It has already cost one
outage (see "Known incident") and one misdiagnosis (see "Ledger drift") — in
opposite directions, from the same missing habit.

## Status

Verified against the production project by a read-only PostgREST probe on
2026-09-19 (a table that answers `PGRST205` does not exist; a column that
answers `42703` does not exist; check constraints read with
`select pg_get_constraintdef(oid) from pg_constraint where conrelid =
'public.job_listings'::regclass and contype = 'c'`).

| Migration | Creates | Production | Notes |
|---|---|---|---|
| `supabase/schema.sql` (batch 1: `profiles`, `credit_transactions`, `handle_new_user`, `handle_updated_at`) | 2 tables, 2 functions, 3 triggers | **applied** — predates this ledger | Never re-run it. See "Never re-run schema.sql". |
| `supabase/schema.sql` (batch 2 block, lines 109+) | duplicates `001` | **not applied** | Only reached on a fresh project. |
| `001_job_listings.sql` | `job_listings`, `job_ingest_state` | **applied 2026-09-17** | |
| `002_rank_cache.sql` | `rank_cache`, `rank_rate_limit` | **applied 2026-09-17** | |
| `003_ats_source.sql` | nothing — widens `job_listings_source_check` | **applied 2026-09-17** | First attempt that day failed `42P01` because `001` had not run; applied after it. |
| `004_location_parts.sql` | 3 columns + 3 indexes on `job_listings` | **applied 2026-09-19** | Additive and re-runnable. Applied without being recorded; found by probe on 2026-09-19 — see "Ledger drift". The three columns are still null on every row, because the ingest that populates them has not run since the parsing code landed, so `/api/jobs/locations` is still empty in practice. |
| `005_keyless_sources.sql` | nothing — widens `job_listings_source_check` | **applied 2026-09-19** | Additive and re-runnable. Applied without being recorded; confirmed 2026-09-19 by `pg_get_constraintdef`, which returns all nine source values. Not the reason the four keyless sources hold 0 rows — ingest has not run since they were registered. |

## Ledger drift — 2026-09-19

`004` and `005` were both applied to production and neither was recorded here.
The ledger claimed **NOT APPLIED** for both while the columns and the widened
constraint were already live.

Found while diagnosing four job sources showing 0 rows. The stale `005` row was
an attractive and wrong explanation for that symptom — the constraint was fine,
and the real cause was that ingest had not run since the adapters were
registered (last run 12:57:48 UTC; the commit registering them landed 12:58:54
UTC). A ledger that is wrong in the *optimistic* direction costs an outage;
wrong in the *pessimistic* direction, as here, it costs a misdiagnosis and a
pointless re-apply. Both are failures of the same discipline.

This is the second time this file's premise has been violated — see "Known
incident" below for the first. The rule is unchanged and is the whole point of
the file: **update the row in the same commit as the apply.** When that has not
happened, probe rather than trust:

```sql
-- what the source constraint actually allows
select pg_get_constraintdef(oid) from pg_constraint
where conrelid = 'public.job_listings'::regclass and contype = 'c';
```

```bash
# does a column exist? a missing one answers 42703, not null
curl -s -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  "$SUPABASE_URL/rest/v1/job_listings?select=location_city&limit=1"
```


## Apply order

`001` → `002` → `003`. Order is not optional:

- `003` is pure `ALTER TABLE public.job_listings`. It creates nothing and fails
  with `42P01` if `001` has not run.
- `003` must come after ingest is possible, or every `'ats'` row is rejected by
  the check constraint at insert time.
- `001` and `002` both end in a trigger calling `public.handle_updated_at()`,
  which is defined **only** in `schema.sql`. On a project that never ran
  `schema.sql`, that last statement rolls the whole file back — including the
  `create table` that appeared to succeed.

## The "destructive operations" warning is a false positive here

The SQL Editor warns on the literal `drop` / `alter` keywords, not on what the
statements do. In `001` and `002`, every `drop ... if exists` targets a table
created earlier **in the same script**, and every `alter table` is
`enable row level security` on one of those new tables. Neither file touches
`profiles`, `credit_transactions`, `auth.users`, or any existing row.

## Never re-run schema.sql

Two independent reasons:

1. It drops and recreates `on_auth_user_created` on `auth.users`, so sign-ups
   during that window get no profile row.
2. Until 2026-09-17 its three profile/credit `create policy` statements were
   unguarded, so a re-run aborted at the first one with
   `42710 policy already exists` — and because the SQL Editor runs a pasted
   script as one transaction, **the entire batch rolled back**, including the
   `job_listings` block at the end of the file. Those three are now guarded with
   `drop policy if exists`, but reason 1 still stands.

Use the numbered migrations against an existing project. `schema.sql` is for
bootstrapping a fresh one.

## Known incident — 2026-09-17

The Ranked jobs page failed with
`Could not find the table 'public.job_listings' in the schema cache`
(PostgREST `PGRST205`), and `/api/jobs/meta` reported `degraded: true`.

Cause: `001` and `002` were never applied. `003` was run alone and failed with
`42P01`. The application code and environment were correct throughout — both
`.env` files point at the same project and the service-role key works.

What made it hard to see: `003`'s own header asserts *"001 IS NOT EDITED. It has
already been applied by hand"*, which was false for this project. There was no
ledger to check that claim against. That is why this file exists.
