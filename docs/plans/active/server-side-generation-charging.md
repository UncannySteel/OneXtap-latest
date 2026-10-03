# Charging for generations on the server

**Status:** proposal, for the owner's approval. Nothing is built.
**Closes:** `HANDOVER.md` §7 item 25. **Written:** 2026-10-03 (checkpoint 4).

## The problem

Answer Studio and cover letters are paid for by the client, after the fact:

1. `POST /api/answer-vault/generate` writes the text (Groq). It needs a
   signed-in account, but checks no balance and has no rate limit.
2. `POST /api/credits/deduct` takes one credit. The page calls it after (1)
   succeeds, and the page alone decides whether a call was a free improvement
   or re-run: the counters (`aiImprovementsLeft` on a saved answer,
   `aiRerunsLeft` on a cover-letter template) live in the browser.

So any signed-in account, a free one at zero credits included, can call (1)
directly as often as it likes, and editing the stored counters buys more free
follow-ups. Each call spends Onextap's Groq quota, which on Groq's free tier
(8,000 tokens a minute, per `server/.env.example`) is shared by every user:
one script can make generation fail for everyone. That is the stronger reason
to fix it; the revenue at stake is small.

Not affected: the balance itself (credits change only through server routes,
CLAUDE.md rule 6), and "Explain my fit", which `/api/jobs/explain` already
charges on the server (balance check before the model, charge after success,
refund on a later failure).

## Goals

1. A generation costs what the product says, whatever the client sends. A free
   follow-up exists only if the server granted it.
2. The prices stay as they are: one credit buys an answer plus 3
   improvements, or a cover letter plus 1 re-run for the same job description.
   Premium is unlimited.
3. No double charge and no outage while old clients are still around (the
   published extension's popup, cached pages).
4. No double spend under concurrency (today's deduct is a read-modify-write:
   two presses with one credit can both succeed).

Not in scope: prices, "Explain my fit", the job ranking.

## Design

### One table

`supabase/migrations/006_generation_allowances.sql` (and the same block in
`supabase/schema.sql`, and a row in the migration ledger):

```sql
create table if not exists public.generation_allowances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('answer', 'cover_letter')),
  -- Cover letters: which application the re-run is for (a hash of the job
  -- description). Null for answers, whose improvements are not tied to text.
  subject_key text,
  remaining integer not null check (remaining >= 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);
create index if not exists idx_generation_allowances_user
  on public.generation_allowances (user_id);
alter table public.generation_allowances enable row level security;
-- No policies: only the service role reads or writes it, as with credits.
```

It holds no profile data (CLAUDE.md rule 8): a hash of a job description is
not the user's data. It is keyed to the user, and deleting the account
deletes it (cascade).

### Two database functions, so each step is one atomic statement

`spend_generation(p_user uuid, p_kind text, p_allowance uuid, p_subject text, p_free int) returns jsonb`:

1. With `p_allowance`: `update generation_allowances set remaining =
   remaining - 1 where id = p_allowance and user_id = p_user and kind =
   p_kind and remaining > 0 and expires_at > now() and (subject_key is null or
   subject_key = p_subject) returning remaining`. A row back means a free
   follow-up: return it.
2. Otherwise, a Premium profile: return "free, Premium".
3. Otherwise: `update profiles set credits = credits - 1 where id = p_user and
   credits > 0 returning credits`. No row back raises `no_credits`. Then insert
   the `credit_transactions` row (`-1`, `usage`), and a new allowance with
   `remaining = p_free` and `subject_key = p_subject`; return it.

`undo_generation(p_user uuid, p_spend jsonb)`, for a generation that failed
after the spend: a charge gets its credit back (a `refund` transaction) and
loses its allowance; a free follow-up gets its `remaining` back.

Both run as the service role through `supabaseAdmin.rpc(...)`. A single
`update … where credits > 0` is what removes the double spend; the same
statement should replace the read-modify-write in `chargeOneCredit()` and the
deduct route (see "Also").

### The route

`POST /api/answer-vault/generate` takes two new fields:

- `kind`: `'answer'` or `'cover_letter'`;
- `allowanceId`: optional, from the previous response.

For cover letters the server computes the subject key itself, from the
`jobContext` it is given (the same hash as `src/coverLetterCredits.js`'s
`applicationKey()`), so a client cannot claim one description and send
another.

The order differs from explain on purpose: spend first, then call Groq,
undoing the spend if the call fails. Spending first is what stops two
concurrent requests from both passing a balance check; explain's "check, run,
charge" leaves that window open, which is cheap there and not here.

The response gains `charge: { charged, allowanceId, followUpsLeft, credits }`.
`no_credits` answers 403 `No credits remaining`, as explain and deduct do
today.

### The clients

- `web/dashboard/js/ws/answer-studio.js` and `ws/cover-letter.js`, and the
  popup's `src/components/shared/CoverLetterPanel.jsx`: send `kind` and the
  stored `allowanceId`; stop calling `/api/credits/deduct`; take the balance
  and `followUpsLeft` from the response. The vault item and the template keep
  `allowanceId` in place of the counters (`aiImprovementsLeft`,
  `aiRerunsLeft`, `aiRerunKey`), which become a display mirror of
  `followUpsLeft`.
- `src/coverLetterCredits.js` stays for the cost hint beside the button; the
  server has the final word.
- `extension/background.js`'s `GENERATE_IMPROVED_ANSWER` proxy has no sender,
  in the live code or here: delete it.

### Rolling it out with old clients around

Old clients send no `kind`. The server treats that as `'answer'` with no
allowance, so every such call is charged, and `POST /api/credits/deduct`
becomes a no-op that returns the balance (nothing calls it except old
clients, which call it after a generation that is now already charged):

- an old Answer Studio page (generate, then deduct): charged once, correct;
- the published popup's cover letters (generate, no deduct): charged once a
  call, with no free re-run, until the new extension ships. Worse for those
  users for a while, never free.

Order: the migration on the dev project, then production (CLAUDE.md: ask
first) → the server and the website in one deploy → the extension release.

The alternative is a flag (`CHARGE_IN_GENERATE`) that ships the server
accepting the new fields without enforcing, then flips. It avoids the
popup's interim charge, at the cost of a second deploy and a window where the
gap stays open. Not recommended.

### Tests

- The spend logic behind a store interface, memory and Supabase, as
  `server/jobs/rankCache.js` does, so `npm test` covers spend, follow-up,
  expiry, Premium, `no_credits` and undo without a database.
- A parity test: the server's subject key equals `applicationKey()` for the
  same text.
- `web/tests/stubs.js`' API stub charges inside generate, and the dashboard
  spec asserts no deduct is called.
- By hand, on the dev project: two quick presses with one credit give one
  generation and one refusal.

## Size

About one checkpoint of work, most of it testing against the dev project:
the migration and functions, the route and its store, three client files, the
stubs and specs, the extension release.

## Also, separately (recommended either way)

- A per-account hourly cap on the generate route. It protects the shared
  Groq quota even from Premium accounts, which no credit rule limits.
- Make `chargeOneCredit()` and the deduct route a single `update … where
  credits > 0`. Today two concurrent requests with one credit can both pass.

## Decisions for the owner

1. Approve the design: the table, the two functions, the route change.
2. The rollout: charge every call and make deduct a no-op (recommended), or
   the flag.
3. How long a granted follow-up lasts: 30 days?
4. The subject key on the server: import `src/coverLetterCredits.js` (a second
   import across the `src/` ⟷ `server/` line, after `src/matching/`; it is
   pure, so rule 10's reasoning applies), or a server copy held to it by the
   parity test.
