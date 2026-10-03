# Onextap — Backend & Data Schema

> **Since this was written:** the server gained `POST /api/resume-subscription`,
> `POST /api/create-portal-session` and `DELETE /api/account`, and
> `verify-premium` now reports the renewal date and a scheduled cancellation
> (README.md has the current route table); the React dashboard named below
> was replaced by the plain-JS website under `web/`. No schema changes. What
> changed: [`HANDOVER.md`](../HANDOVER.md).

The database, the row shapes, the local stores, and every API contract that
touches them. Describes the system at commit `9b01adb` (2026-09-09).

Source of truth for the SQL: [`../supabase/schema.sql`](../supabase/schema.sql).
It is applied **by hand** in the Supabase SQL Editor — there is no migration
tool and no migration history.

**Related:** [`trd.md`](trd.md) · [`app-flow.md`](app-flow.md) · [`prd.md`](prd.md)

---

## 1. Storage map

Two stores, split by a hard rule: **account and billing in Postgres, personal
data on the device.**

| Data | Where | Why |
|---|---|---|
| Auth user, email | Supabase `auth.users` | Managed by GoTrue |
| Credits, premium, Dodo ids | Supabase `public.profiles` | Must be server-owned to be tamper-proof |
| Credit audit log | Supabase `public.credit_transactions` | Service-role writable only |
| Personal details, education, experience | `chrome.storage.local` / `localStorage` | Local-only by design |
| Saved answers (vault) | same | same |
| Cover-letter templates and variants | same | same |
| Application type, tour flag, theme | same | UI preference |
| Supabase session (JWT) | `chrome.storage.local` (ext) / `localStorage` (web) | Service workers have no `localStorage` |

Nothing writes profile content to Supabase. `src/storage.js` has no network
path at all, which makes the guarantee structural rather than procedural.

---

## 2. Database

### 2.1 Entity relationships

```text
auth.users (Supabase-managed)
     │ id (uuid)
     │
     │ 1───1   on_auth_user_created trigger
     ▼
public.profiles
     │ id  uuid PK, FK → auth.users(id) ON DELETE CASCADE
     │ email, display_name
     │ credits, is_premium
     │ dodo_customer_id (unique), dodo_subscription_id, subscription_status
     │ premium_since, cancelled_at, payment_failed, last_failed_payment
     │ created_at, updated_at
     │
     │ 1───N
     ▼
public.credit_transactions
       id uuid PK
       user_id uuid FK → profiles(id) ON DELETE CASCADE
       amount int          (+ add, − deduct)
       type   text         initial | usage | refund | purchase | bonus
       description text
       created_at
```

### 2.2 `public.profiles`

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | `uuid` | — | PK; FK to `auth.users`, cascade delete |
| `email` | `text` | — | Copied from the auth user; also a webhook fallback key |
| `display_name` | `text` | — | `full_name` → `name` → email local-part |
| `credits` | `integer` | `3` | NOT NULL. Server-managed only |
| `is_premium` | `boolean` | `false` | NOT NULL. Set by the webhook, cleared on cancel/verify |
| `dodo_customer_id` | `text` | — | **UNIQUE**, indexed. Webhook resolution key |
| `dodo_subscription_id` | `text` | — | Used for live status checks and cancellation |
| `subscription_status` | `text` | `'none'` | `none` \| `active` \| `on_hold` \| `cancelled` \| `failed`, or whatever Dodo reports |
| `premium_since` | `timestamptz` | — | Set on `subscription.active` |
| `cancelled_at` | `timestamptz` | — | Set on cancel |
| `payment_failed` | `boolean` | `false` | Set on `payment.failed` / `subscription.on_hold` |
| `last_failed_payment` | `timestamptz` | — | |
| `created_at` | `timestamptz` | `now()` | |
| `updated_at` | `timestamptz` | `now()` | Maintained by the `profiles_updated_at` trigger |

Indexes: PK on `id`, unique on `dodo_customer_id`,
`idx_profiles_dodo_customer_id`.

**Note.** `subscription_status` is a free-text column with no CHECK
constraint, and the verify path writes whatever status string Dodo returns.

### 2.3 `public.credit_transactions`

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | `uuid` | `gen_random_uuid()` | PK |
| `user_id` | `uuid` | — | NOT NULL, FK → `profiles(id)`, cascade delete |
| `amount` | `integer` | — | NOT NULL. Positive adds, negative deducts |
| `type` | `text` | — | NOT NULL, CHECK ∈ `initial`, `usage`, `refund`, `purchase`, `bonus` |
| `description` | `text` | — | Human-readable reason |
| `created_at` | `timestamptz` | `now()` | |

Index: `idx_credit_transactions_user_id`.

An append-only audit log. `credits` on `profiles` is the live balance; this
table explains how it got there. `purchase` and `bonus` are defined in the
CHECK but never written by current code.

### 2.4 Row Level Security

Both tables have RLS enabled.

| Table | Policy | Operation | Rule |
|---|---|---|---|
| `profiles` | Users can view own profile | `SELECT` | `auth.uid() = id` |
| `profiles` | Users can update own profile | `UPDATE` | `USING auth.uid() = id`, `WITH CHECK auth.uid() = id` |
| `credit_transactions` | Users can view own transactions | `SELECT` | `auth.uid() = user_id` |
| `credit_transactions` | *(none)* | `INSERT` / `UPDATE` / `DELETE` | No policy ⇒ denied to every non-service role |

**This is the anti-tamper design.** A user's anon-key client can read the
audit log but never write it, so a forged balance has no matching history.
The server uses the service role, which bypasses RLS entirely.

⚠ The `profiles` UPDATE policy has no column restriction: a user's own JWT
can update **any** column on their own row, `credits` and `is_premium`
included. RLS is not what protects the balance — the fact that the client
never has a reason to call the table directly is. Column-level grants, or a
policy that pins the billing columns, would close it.

### 2.5 Triggers and functions

**`handle_new_user()` / `on_auth_user_created`** — `AFTER INSERT ON auth.users`,
`SECURITY DEFINER`. Inserts the `profiles` row with 3 credits and an
`initial` credit transaction. `display_name` resolves
`raw_user_meta_data->>'full_name'` → `->>'name'` → email local-part.

**`handle_updated_at()` / `profiles_updated_at`** — `BEFORE UPDATE ON profiles`,
sets `updated_at = now()`.

The schema file drops and recreates `on_auth_user_created` every run. It is
otherwise idempotent (`create table if not exists`, `create index if not
exists`), but running it against production is an escalation.

### 2.6 Server-side backfill

`getProfile(userId, userEmail)` in `server/supabase.js` does not assume the
trigger ran. If no row exists it inserts one (3 credits, `is_premium: false`)
plus a backfill `initial` transaction, and races on the unique PK by
re-reading on error `23505`. This is what keeps the API working against a
project where `schema.sql` was applied after users already existed.

---

## 3. Local data shapes

Not in the database, but they *are* the product's primary data model and the
contract between the dashboard, the popup and the content script.

### 3.1 `onextap_profiles` — the profile store

```jsonc
{
  "profiles": {
    "default": {
      "name": "Default",
      "isDefault": true,
      "autofillData": { /* the profile fields, §3.3 */ },
      "coverLetters": [ /* §3.4 */ ],
      "savedAnswers": [ /* §3.5 */ ]
    },
    "profile-1737052800000": { "name": "Design roles", "isDefault": false, "...": "..." }
  },
  "activeProfileId": "default"
}
```

Ids are `default` for the first profile and `profile-<Date.now()>` afterwards.

### 3.2 `user_profile` — the legacy flat mirror

Written on **every** store save by `syncLegacyUserProfile()`. It is the shape
the content script and older UI code read:

```jsonc
{
  "...autofillData",                 // spread flat
  "vault": [ /* savedAnswers */ ],
  "coverLetters": [ /* templates */ ],
  "_activeProfileId": "default",
  "_activeProfileName": "Default"
}
```

**Migration.** On first load with no `onextap_profiles`, the old
`user_profile` blob is split — `vault` becomes `savedAnswers`, everything
else becomes `autofillData` — into a single `Default` profile, which is then
written back. `loadProfileStore()` is therefore not a pure read.

### 3.3 Autofill data

```jsonc
{
  "firstName": "", "lastName": "", "email": "", "phone": "",
  "country": "United States", "countryCode": "+1",
  "birthDate": "", "gender": "",
  "urls": [ { "type": "LinkedIn|GitHub|Portfolio", "value": "" } ],
  "address": {
    "country": "", "city": "", "state": "", "postalCode": "",
    "addressLine1": "", "addressLine2": "", "addressLine3": ""
  },
  "education":   [ { "school": "", "degree": "", "field": "", "start": "", "end": "",
                     "cgpa": "", "specialization": "", "minor": "",
                     "graduationYear": "", "enrollmentYear": "",
                     "graduationDate": "", "expectedGraduation": "" } ],
  "experience":  [ { "company": "", "title": "", "start": "", "end": "",
                     "startDate": "", "endDate": "", "description": "",
                     "duration": "", "type": "", "isCurrent": false } ],
  "certificates":[ { "name": "", "issuer": "", "date": "", "expiry": "" } ],
  "skills": [],
  "currentJob": { "company": "", "title": "", "isCurrent": true },
  "currentSalary": "", "payExpectation": "", "noticePeriod": "",
  "race": [], "ethnicity": "", "veteran": "", "disability": ""
}
```

`education` and `experience` carry both `start`/`end` and
`startDate`/`endDate`: the resume parser returns the latter, the manual
editor writes the former. Both are kept.

### 3.4 Cover-letter template

```jsonc
{
  "id": "cl-1737052800000",
  "name": "Product design — general",
  "body": "Dear hiring team, …",
  "createdAt": "2026-02-01T10:00:00.000Z",
  "lastUsed": "2026-02-14T09:12:00.000Z",
  "applicationType": "job",
  "variants": [
    {
      "id": "clv-1737139200000",
      "company": "Acme",
      "role": "Senior Product Designer",
      "jdSnippet": "first 500 chars of the job description",
      "body": "the personalised text",
      "createdAt": "2026-02-14T09:12:00.000Z"
    }
  ]
}
```

Capped at `MAX_COVER_LETTERS_PER_PROFILE` = 10 templates per profile.
Variants are uncapped.

### 3.5 Saved answer (vault entry)

```jsonc
{
  "id": 1737052800000,
  "question": "Why do you want to work here?",
  "answer": "…",
  "aiImprovementsLeft": 3
}
```

`aiImprovementsLeft` is the free follow-up budget bought by the credit that
generated the answer. It is normalised to a non-negative number on load;
premium accounts always store 0 because they never consume it.

### 3.6 Resume-parser output contract

Gemini is instructed to return exactly this, and only this:

```jsonc
{
  "firstName": "", "lastName": "", "email": "", "phone": "",
  "address": { "street": "", "city": "", "state": "", "zip": "", "country": "" },
  "education":  [ { "school": "", "degree": "", "field": "",
                    "startDate": "", "endDate": "", "gpa": "" } ],
  "experience": [ { "company": "", "title": "",
                    "startDate": "", "endDate": "", "description": "" } ],
  "skills": [ "" ],
  "urls": [ { "type": "linkedin|github|portfolio|other", "value": "" } ],
  "certificates": [ { "name": "", "issuer": "", "date": "" } ],
  "currentJob": { "company": "", "title": "" }
}
```

Note the mismatch with §3.3: the parser emits `address.street` / `zip`, the
profile stores `addressLine1` / `postalCode`. The merge in `ProfilesPage`
spreads the parsed address over the stored one, so `street` and `zip` land as
extra keys that autofill never reads. Worth reconciling.

---

## 4. API reference

Base URL: `VITE_API_URL`, or same-origin on Vercel. All routes are under
`/api`. Every route except `/api/webhook` and `/api/health` requires
`Authorization: Bearer <supabase-jwt>`.

Every response carries `X-Request-Id`.

### `GET /api/me`

Authenticated profile; also the cheapest way to pre-flight a token.

```jsonc
{ "id": "uuid", "email": "…", "displayName": "…", "credits": 3,
  "isPremium": false, "subscriptionStatus": "none",
  "premiumSince": null, "createdAt": "…" }
```

### `GET /api/credits`

`{ "credits": 3, "isPremium": false }` — sent with `no-store` /
`no-cache` / `Expires: 0`, because a cached balance is a wrong balance.

### `POST /api/credits/deduct`

| Case | Status | Body |
|---|---|---|
| Premium | 200 | `{ success: true, remaining: Infinity, isPremium: true }` |
| `credits <= 0` | 403 | `{ success: false, remaining: 0, error: "No credits remaining" }` |
| Success | 200 | `{ success: true, remaining: <n-1> }` |
| Audit insert failed | 500 | `{ success: false, error: "Could not record credit usage. Your balance was restored; please try again." }` |

Sequence: read → premium check → balance check → write `credits - 1` →
insert `usage` transaction → **on audit failure, restore the previous balance
and fail the request.** Balance and audit log never diverge.

### `POST /api/credits/refund`

Mirror image: `+1`, a `refund` transaction, the same rollback-on-audit-failure
guard. **Implemented but called from nowhere in the client.**

### `GET /api/verify-premium`

Not a cached read. If `is_premium` is set and a `dodo_subscription_id`
exists, the server asks Dodo for the live status; anything outside
`active` / `trialing` clears the local flag and returns
`{ isPremium: false, reason: "subscription_inactive" }`. If Dodo is
unreachable the local value is trusted.

### `POST /api/answer-vault/generate`

```jsonc
// request
{ "question": "Why this role?",
  "draft": "optional existing text",
  "jobContext": "Company: Acme\n\n<job description, ≤6000 chars>",
  "profileContext": "Current role: …\nCore skills: …\nRecent experience: …",
  "vaultAnswers": [ { "question": "…", "answer": "…" } ],
  "taskHint": "…", "styleHint": "…",
  "model": "llama-3.3-70b-versatile" }

// response
{ "text": "…", "answer": "…", "model": "llama-3.3-70b-versatile",
  "provider": "groq", "finishReason": "stop" }
```

- Requires `question` **or** the legacy `userPrompt` / `prompt`; neither → 400.
- `model` is validated against an allowlist; anything else silently falls back
  to the configured primary.
- Only the 3 vault answers with the highest word overlap are sent.
- Rejected: empty output, fewer than 8 non-space characters,
  `finish_reason === 'length'`.
- A model refusal returns 502 with the refusal text; provider errors return
  502; a missing key returns 500.

### `POST /api/parse-resume`

`{ fileData: "<base64>", fileName, fileType }` → `{ data: <§3.6> }`.
Unsupported MIME type → 400. Unparseable model output → one repair pass, then
502 `"AI returned invalid JSON. Please try again."`.

### `POST /api/create-checkout-session`

Creates a Dodo checkout with `metadata.supabaseUserId` and
`return_url = CLIENT_URL?payment=success`. Returns `{ url, sessionId }`.
An already-active subscription → 400.

Compatibility shim: uses `dodo.checkoutSessions.create` when the SDK exposes
it (v2+), otherwise POSTs to `https://{test|live}.dodopayments.com/checkouts`
directly. That branch exists because of the root/server SDK version drift.

### `POST /api/cancel-subscription`

Cancels at Dodo, then sets `is_premium = false`,
`subscription_status = 'cancelled'`, `cancelled_at = now()`.
No subscription on file → 400.

### `POST /api/webhook`

Unauthenticated, verified by signature over the **raw** body — which is why
it is registered with `express.raw()` *before* `express.json()`. Moving it
breaks payments in production only.

Headers: `webhook-id`, `webhook-signature`, `webhook-timestamp`. Bad
signature → 400, no state change.

User resolution, in order: `metadata.supabaseUserId` →
`profiles.dodo_customer_id` → `profiles.email`. Unresolved is logged and
skipped; the response is still `{ received: true }` so Dodo stops retrying.

Event → state table: see [`app-flow.md` §7](app-flow.md#7-upgrade-to-premium).

### `GET /api/health`

`{ status: 'ok', timestamp }`. Unauthenticated.

---

## 5. Server module contracts

| Module | Exports | Rule |
|---|---|---|
| `server/load-env.js` | — | **First import** in `server/index.js`; loads `server/.env` regardless of cwd |
| `server/supabase.js` | `supabaseAdmin`, `getProfile`, `updateProfile`, `requireAuth`, `formatSupabaseError` | Reads `process.env` at module load |
| `server/logger.js` | `log`, `requestLogger`, `errorLogger`, `installProcessHandlers` | Imported after `load-env.js`; reads `LOG_LEVEL` at module load |
| `server/index.js` | `default` — the Express app | Every route |
| `api/index.js` | re-export | Bare. No routes, no middleware |

`requireAuth` verifies the bearer token with
`supabaseAdmin.auth.getUser(token)` and attaches `req.userId`,
`req.userEmail`, `req.accessToken`. It responds 401 and never calls `next()`
on failure.

---

## 6. Schema risks

| # | Risk | Note |
|---|---|---|
| S1 | Credit deduct is read-modify-write with no transaction or optimistic lock | Concurrent generations could double-spend. A `credits = credits - 1 WHERE credits > 0` function would fix it atomically |
| S2 | `profiles` UPDATE policy covers every column | A user's own JWT could set `credits` / `is_premium` directly against Supabase. Nothing in the app does, but nothing stops it either |
| S3 | No migration history | No way to know which schema version an environment is on |
| S4 | `subscription_status` is unconstrained text | Dodo status strings are written through verbatim |
| S5 | Deleting an account does not delete these rows | The client-side "delete account" only clears local storage and signs out |
| S6 | `credit_transactions` grows without bound | No retention policy or archival |
| S7 | Address key mismatch between the parser and the profile shape | `street`/`zip` never reach autofill (§3.6) |
