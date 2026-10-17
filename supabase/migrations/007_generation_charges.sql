-- ============================================================
-- 007 — Generation charges
-- ============================================================
-- Charging for AI generations moves to the server (HANDOVER.md §7 item 25,
-- docs/plans/active/server-side-generation-charging.md). One table and two
-- functions:
--
--   generation_allowances  the follow-ups a paid generation granted (Answer
--                          Studio's 3 improvements, a cover letter's 1 re-run),
--                          one row per charge. The row is also the charge's
--                          receipt: undo_generation() gives a credit back
--                          only by deleting it, so at most once.
--   spend_generation()     a granted follow-up, else Premium, else one
--                          credit. Each step is one conditional statement, so
--                          two requests holding the last credit cannot both
--                          spend it.
--   undo_generation()      gives back what a spend took, for a generation
--                          that failed after it.
--
-- server/lib/generationSpend.js calls both through the service role's
-- rpc(); its memory store mirrors them for npm test. Change one, change the
-- other.
--
-- Additive and re-runnable: create … if not exists, create or replace, and
-- grants that can be repeated. It touches no existing row or table. Until it
-- is applied, POST /api/answer-vault/generate and POST /api/jobs/explain FAIL
-- CLOSED: a 503 and an error log naming this file. They never generate for
-- free.
--
-- Run it after supabase/schema.sql (it needs public.profiles and
-- public.credit_transactions). The same statements end schema.sql, for a
-- fresh project. Record the apply in supabase/migrations/README.md.

-- ------------------------------------------------------------
-- 1. The table — one row per charge
-- ------------------------------------------------------------
create table if not exists public.generation_allowances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- 'explain' is "Explain my fit": it grants nothing, so its row (remaining
  -- 0) is only the receipt a refund needs.
  kind text not null check (kind in ('answer', 'cover_letter', 'explain')),
  -- Cover letters: which application the re-run is for, applicationKey() of
  -- the job context the server was sent (src/coverLetterCredits.js). Null for
  -- answers, whose improvements are not tied to text. A hash of a job
  -- description is not the user's profile data (CLAUDE.md rule 8).
  subject_key text,
  remaining integer not null check (remaining >= 0),
  created_at timestamptz not null default now(),
  -- How long a granted follow-up lasts (FOLLOW_UP_DAYS in
  -- server/lib/generationSpend.js).
  expires_at timestamptz not null default now() + interval '30 days'
);

create index if not exists idx_generation_allowances_user
  on public.generation_allowances (user_id);

alter table public.generation_allowances enable row level security;

-- Zero policies, on purpose: only the service role (which bypasses RLS) reads
-- or writes it, as with credit_transactions. A user who could write it would
-- grant themselves follow-ups.

-- ------------------------------------------------------------
-- 2. spend_generation — pay for one generation
-- ------------------------------------------------------------
-- Returns { charged, premium, allowanceId, followUpsLeft, credits }.
-- Raises 'no_credits' (nothing spent) and 'no_profile' (no profiles row: the
-- server creates it and tries again).
--
-- p_free is how many follow-ups a charge grants. The server decides it (3, 1
-- or 0); no client value reaches it.
create or replace function public.spend_generation(
  p_user uuid,
  p_kind text,
  p_allowance uuid,
  p_subject text,
  p_free integer,
  p_description text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_left integer;
  v_credits integer;
  v_id uuid;
begin
  if p_kind is null or p_kind not in ('answer', 'cover_letter', 'explain') then
    raise exception 'bad_kind' using errcode = '22023';
  end if;

  -- 1. A follow-up this account was granted: same kind, same application,
  --    not expired, not used up. One conditional update: two requests holding
  --    the last use cannot both get it.
  if p_allowance is not null then
    update public.generation_allowances set remaining = remaining - 1 where id = p_allowance and user_id = p_user and kind = p_kind and remaining > 0 and expires_at > now() and (subject_key is null or subject_key = p_subject) returning remaining into v_left;
    if found then
      select credits into v_credits from public.profiles where id = p_user;
      return jsonb_build_object('charged', false, 'premium', false,
        'allowanceId', p_allowance, 'followUpsLeft', v_left, 'credits', v_credits);
    end if;
  end if;

  -- 2. Premium pays nothing and is granted nothing.
  if exists (select 1 from public.profiles where id = p_user and is_premium) then
    return jsonb_build_object('charged', false, 'premium', true,
      'allowanceId', null, 'followUpsLeft', null, 'credits', null);
  end if;

  -- 3. One credit. A single conditional update, never a read and then a
  --    write: under the row lock a second request sees the balance the first
  --    left, and at zero it gets no row back.
  update public.profiles set credits = credits - 1 where id = p_user and credits > 0 returning credits into v_credits;
  if not found then
    if not exists (select 1 from public.profiles where id = p_user) then
      raise exception 'no_profile' using errcode = 'P0001';
    end if;
    raise exception 'no_credits' using errcode = 'P0001';
  end if;

  -- The audit row and the allowance, in the same transaction: if either
  -- fails, the credit was never taken.
  insert into public.credit_transactions (user_id, amount, type, description)
  values (p_user, -1, 'usage', coalesce(nullif(p_description, ''), 'AI generation credit used'));

  insert into public.generation_allowances (user_id, kind, subject_key, remaining)
  values (p_user, p_kind, p_subject, greatest(coalesce(p_free, 0), 0))
  returning id, remaining into v_id, v_left;

  return jsonb_build_object('charged', true, 'premium', false,
    'allowanceId', v_id, 'followUpsLeft', v_left, 'credits', v_credits);
end;
$$;

-- ------------------------------------------------------------
-- 3. undo_generation — a generation failed after its spend
-- ------------------------------------------------------------
-- p_spend is spend_generation()'s answer, as the server got it. A charge gets
-- its credit back (a 'refund' row) and loses its allowance; a free follow-up
-- gets its use back; a Premium spend took nothing. Returns { undone, … }.
create or replace function public.undo_generation(
  p_user uuid,
  p_spend jsonb,
  p_description text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_allowance uuid := nullif(p_spend ->> 'allowanceId', '')::uuid;
  v_charged boolean := coalesce((p_spend ->> 'charged')::boolean, false);
  v_credits integer;
  v_left integer;
begin
  if v_allowance is null then
    return jsonb_build_object('undone', false);
  end if;

  if v_charged then
    -- The receipt goes first. No row, no refund: a charge that never
    -- happened, or one already refunded, gives nothing back.
    delete from public.generation_allowances where id = v_allowance and user_id = p_user;
    if not found then
      return jsonb_build_object('undone', false);
    end if;
    update public.profiles set credits = credits + 1 where id = p_user returning credits into v_credits;
    insert into public.credit_transactions (user_id, amount, type, description) values (p_user, 1, 'refund', coalesce(nullif(p_description, ''), 'Credit refunded (failed generation)'));
    return jsonb_build_object('undone', true, 'credits', v_credits);
  end if;

  update public.generation_allowances set remaining = remaining + 1 where id = v_allowance and user_id = p_user returning remaining into v_left;
  if not found then
    return jsonb_build_object('undone', false);
  end if;
  return jsonb_build_object('undone', true, 'followUpsLeft', v_left);
end;
$$;

-- ------------------------------------------------------------
-- 4. The service role only
-- ------------------------------------------------------------
-- Supabase grants new functions to anon and authenticated by default. These
-- run with the caller's rights and RLS would stop a user anyway; the revoke
-- means a signed-in browser cannot even call them.
revoke all on function public.spend_generation(uuid, text, uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.spend_generation(uuid, text, uuid, text, integer, text) to service_role;
revoke all on function public.undo_generation(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.undo_generation(uuid, jsonb, text) to service_role;

-- PostgREST serves a new function once its schema cache reloads.
notify pgrst, 'reload schema';
