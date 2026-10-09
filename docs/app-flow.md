# Onextap — Application Flows

Every user-facing path through the product, traced to the code that runs it.
Rewritten on 2026-10-03 for the website (landing page and dashboard under
`web/`) that replaced the React landing page and dashboard. The popup's
flows (§1, §4) were traced at commit `9b01adb` and are unchanged by that
work. Traced from code and exercised against stubs, **not yet against real
services** (`HANDOVER.md` §7 item 2).

**Related:** [`repo-structure.md`](repo-structure.md) ·
[`../HANDOVER.md`](../HANDOVER.md) · [`../README.md`](../README.md) ·
[`backend-schema.md`](backend-schema.md)

---

## 0. Entry points

One origin serves the site and the API (`vercel.json`):

| Path | What | Code |
|---|---|---|
| `/` | Landing page | `web/index.html`, `web/src/main.js` |
| `/about/` `/contact/` `/privacy/` | Its company pages | `web/src/pages/` |
| `/reset-password/` | Where the password-reset email's link opens | `web/reset-password/`, `web/src/pages/reset-password/` |
| `/dashboard/` | Dashboard | `web/dashboard/index.html`, `web/dashboard/js/main.js` |
| `/dashboard/contact/` `/dashboard/privacy/` | The dashboard's company pages | `web/dashboard/site/` |
| `/api/*` | Express app | `api/index.js` → `server/index.js` |
| `/privacy-policy`, `/privacy-policy.html` | 308 → `/privacy/` | `vercel.json` |

The extension has three: the popup (`index.html` → `src/popup.jsx` → `App` in
`OnextapDashboard.jsx` → `PopupView`), the service worker
(`extension/background.js`), and the content script (`public/content.js`,
injected on demand). Opened outside the extension, or with the old
`?mode=dashboard`, the popup's page redirects to the web dashboard.

**Arriving at the landing page** (`web/index.html`, a script in `<head>`,
before anything paints): `?extensionId=`, `?view=`, `?payment=`, `?code=` or
`#access_token=` is forwarded to `/dashboard/` with the rest of the address.
That covers the published extension (it opens the site root), a checkout
started before the dashboard moved, and a Supabase redirect to the site root.
A password-reset link (`#…type=recovery`) that lands on the root goes to
`/reset-password/` instead, and the dashboard sends one on there too, before
its Supabase client can take it as a plain sign-in. `?login=1` or `?signup`,
with `?next=/dashboard/…`, opens the sign-in window, and `?reset=1` opens it
on the reset request (`openOnArrival` in `web/src/app/wire.js`); `next` may
only point inside `/dashboard/`.

**Arriving at the dashboard** (`web/dashboard/js/main.js`):

| Parameter | Effect |
|---|---|
| `?extensionId=<id>` | Which extension to sync profiles to (`src/extensionClient.js`) |
| `?view=vault\|cover\|jobs\|profiles` | Opens that workspace (`legacyViews` in `js/config.js`) |
| `?upgrade=1` | Opens the plan panel |
| `?payment=success\|cancelled` | Back from checkout (§8) |
| `#/` · `#/<workspace>` | Home · `job-matches`, `my-profiles`, `answer-studio`, `cover-letter` |

The one-shot parameters are removed from the address once read.

---

## 1. First run (popup)

```text
Install from Chrome Web Store
        │
        ▼
Click the toolbar icon ──► PopupView, checking = true
        │
        ├─ loadProfileStore()          (migrates legacy user_profile if present)
        ├─ getActiveLegacyProfile()
        └─ hasProfile = firstName || email || vault.length
                │
        ┌───────┴────────┐
        │                │
     false            true
        │                │
        ▼                ▼
 "Open Dashboard"   Full popup (tabs, autofill)
   empty state
        │
        ▼
 chrome.tabs.create(<site>/dashboard/?extensionId=<runtime.id>)
```

The popup deliberately refuses to be a profile editor. With no profile it
shows one route out: the web dashboard, told which extension it belongs to.
"Open Answer Studio" and Job Matches add `?view=vault` / `?view=jobs`.

---

## 2. Sign-up and sign-in

**On the website**, the sign-in window (`web/src/features/login/login.js`) is
on every page of the landing site, behind the header's Log in. What it does
is `signInAttempt` in `web/src/app/backend.js`, which loads `@app/auth.js`
(and so Supabase's SDK) on the first attempt:

```text
Sign-in window
        │
        ├─ Email + password
        │   ├─ checked first: an email, and on sign-up 8+ characters with
        │   │  upper and lower case and a number (features/login/password-rule.js)
        │   ├─ sign in:  supabase.auth.signInWithPassword
        │   │      └─ "Signed in as <email>."  ── Continue ──► /dashboard/ (or ?next)
        │   └─ sign up (+ an optional name → user_metadata.full_name):
        │          supabase.auth.signUp
        │          ├─ session back   ──► "Account created for <email>." ── Continue ──► dashboard
        │          └─ no session     ──► "Check your email." (Continue just closes)
        │
        ├─ Forgot password? ──► the email alone ──► supabase.auth.resetPasswordForEmail,
        │                        redirectTo = <site>/reset-password/
        │      └─ "Check your email." — the same words whether or not the address
        │         has an account; too soon after the last → "Wait a minute…"
        │
        └─ Google ──► supabase.auth.signInWithOAuth, redirectTo = <site>/dashboard/
                      (off the redirect allowlist, Supabase falls back to the
                       site root, and the forwarding script passes it on)
```

**The reset page** (`/reset-password/`) reads its address before Supabase's
client loads: the email's link carries the recovery session in the hash
(`#access_token=…&type=recovery`, the implicit flow), which the client then
takes, signing the page in. The page asks for the new password, held to the
sign-up rule, and `supabase.auth.updateUser({ password })` sets it: "Password
set." and on to the dashboard. Opened without a link, with one Supabase
refused (`#error=…`, e.g. expired), or with one whose session did not take,
it says so and offers a new link (`/?reset=1`).

Refusals are put in plain words (`WORDS` in `backend.js`): a wrong password,
an unconfirmed email, an existing account, a rate limit, a weak password, no
network. The session lands in `localStorage` (`sb-<project ref>-auth-token`),
which the landing page and the dashboard share, being one origin. Signed in,
the header's Log in reads Dashboard (`wireHeader`), and Get started free /
Upgrade to Premium go straight to the dashboard (`wireOffers`).

**The dashboard** checks the session before anything else
(`services.getSession`). None: it drops whatever session is stored, locally,
and sends the reader to `/?login=1&next=<where they were>`, so the two pages
can never bounce a dead session between them. Then `GET /api/me` reads the
account; a 401 there is the same trip to sign in, and an unreachable server
leaves a session-only view with a toast saying credits and plan may be out of
date.

**In the popup**, the session would live in `chrome.storage.local` (the
adapter in `src/supabaseClient.js`), but **nothing in the popup signs in**
(HANDOVER.md §7 item 27): signing in on the website leaves the extension
signed out. So the popup's Cover Letter tab sends people to the dashboard to
personalise (§6).
`src/auth.js` keeps an extension Google flow
(`chrome.identity.launchWebAuthFlow`, needing
`https://<extension-id>.chromiumapp.org/` on Supabase's allowlist) that no
screen calls; its last caller was the old in-extension dashboard.

**On the database side**, `on_auth_user_created` inserts a `profiles` row
with 3 credits and an `initial` credit transaction. If that trigger is
missing, `getProfile()` backfills the row on the first API call.

**First run of the dashboard:** the guided tour shows only on the home view,
and only to accounts created in the last 2 minutes; everyone else gets
`onextap_tutorial_seen` set so it never appears.

---

## 3. Building a profile (My Profiles)

### 3.1 By hand

```text
Dashboard ──► My Profiles ──► edit fields ──► Save
                                                │
                                    saveLegacyUserProfile(profile)   (this browser)
                                                │
                                    ONEXTAP_SYNC_DATA ──► the extension, if this
                                                │         page can reach it
                     ┌──────────────────────────┼──────────────────────────┐
                 confirmed                 no reply                no extension here
                     │                          │                          │
     "Saved and synced to the      "Saved here — the extension    "Saved on this device"
      extension"                    didn't confirm the sync"
```

A failed sync is reported, never fatal: the local save already happened. The
page can reach the extension only from an origin in its `externally_connectable`
(`https://www.onextap.com`, `https://onextap.com`, `http://localhost:5173`),
with the extension's ID: from `?extensionId=` (opened from the popup), else
the published extension's.

**In the extension** (`extension/background.js`, `extension/profileSync.js`),
the payload is filed into the profile store the popup reads
(`onextap_profiles`): matched by id, then by name, else added under the
dashboard's id; it becomes the active profile, and the `user_profile` mirror
is rebuilt from it. The extension's other profiles are left alone.

### 3.2 From a resume

```text
Choose or drop a file (PDF or image, size-capped)
    │
    ├─ type and size checked; hashed (a re-upload of the same bytes is found in the library)
    ├─ getAccessToken()  ──► none → "Not authenticated. Please sign in first."
    ├─ GET /api/me       ──► rejected → "Session token rejected… sign out and sign in again."
    │
    ├─ extension reachable? ──► PARSE_RESUME via the service worker
    └─ otherwise            ──► POST /api/parse-resume directly
                                        │
                                 Gemini (primary → fallback model)
                                        │
                                 { data: <structured>, text }
    │
    ▼
mergeParsedResumeIntoProfile (src/resumeToProfile.js): over the form, never replacing
    │
    └─ saveParsedResume ──► the resume library (onextap_resumes), for Job Matches
                            and the popup; a full library never costs the merge
"Resume read — review the fields, then save."
```

The pre-flight to `/api/me` is there so an expired token fails in a second
rather than after a long upload.

### 3.3 Switching profiles

On the dashboard, the profile switcher (`web/dashboard/js/ui/switchers.js`)
creates, renames, deletes and switches; in the popup, `ProfileSwitcher`.
Every mutation writes the store *and* re-mirrors the active profile into
`user_profile`.

Guards: unique trimmed names (case-insensitive, ≤32 characters); `Default`
and the last remaining profile cannot be deleted; deleting the active profile
falls back to `Default`.

---

## 4. Autofill — the core flow (popup)

```text
User opens an application form, clicks the Onextap icon
        │
        ▼
PopupView mounts
        ├─ getApplicationType()
        ├─ loadProfileStore() + refreshProfileState()
        └─ detectSectionsOnPage()
                ├─ chrome.scripting.executeScript({ files: ['content.js'] })
                └─ DETECT_SECTIONS ──► { personalInfo, education,
                                          workExperience, openEnded, coverLetter }
                        │
                        ▼
        "What to fill" shows toggles for detected sections only
        (coverLetter also requires ≥1 saved template)
        │
        ▼
Click "Autofill Application"
        ├─ getActiveLegacyProfile()  ──► null → "No Profile - Open Dashboard"
        ├─ inject content.js         ──► throws → "Error: Cannot access this page"
        │
        ▼
AUTOFILL_TRIGGERED { profile, sections }
        │
        ▼  public/content.js → autofill()
   buildIntents(profile)         ordered, specific before generic
        │
   for each input / textarea / select:
        skip: wrong input type · invisible · disabled · readonly · already filled
        sig = name + id + placeholder + aria-label + autocomplete + label text
        first matching intent wins
        SELECT → fillSelect (exact value → exact text → substring)
        else   → setNativeValue + dispatch input & change
        │
        ▼
   { success: true, filled: N }  ──►  "Filled N fields"  (resets after 2s)
```

**Ordering rules that make matching work:** `first name` before `full name`;
`phone number` before `phone`; `address line 1` before generic address;
`postal code` before `country`; `current company` / `employer name` before
bare `company`. Bare `name` is deliberately never an intent keyword — it
would hit company-name and school-name fields.

**Known gap (still true on 2026-10-03):** `sections` is sent but `autofill()`
ignores it. Toggling a section off changes the button label only; every
matching field is still filled.

| Refusal | Message |
|---|---|
| `chrome:`, `chrome-extension:`, `edge:`, `about:`, Web Store | "Cannot read this page" (scrape) / "Cannot access this page" (fill) |
| No active tab | "Error: No active tab" |
| No profile | "No Profile - Open Dashboard" |
| Every section toggled off | Button disabled, "Select at least one section to fill." |

---

## 5. Answer Studio (dashboard)

```text
Answer Studio (or the popup's "Open Answer Studio" ──► ?view=vault)
        │
        ├─ the active profile's saved answers (each with aiImprovementsLeft)
        └─ GET /api/credits: balance + Premium flag
        │
        ▼
Question (+ optional draft), tone, optional company and pasted job description
        │
   ┌────┴─────────────────────────────────────────────────────┐
   │ consumesCredit = !premium && improvementsLeft ≤ 0        │
   │ consumesCredit && credits ≤ 0 → "No credits remaining.   │
   │   Premium makes answers unlimited."  (no AI call)        │
   └────┬─────────────────────────────────────────────────────┘
        ▼
POST /api/answer-vault/generate (question, draft, job context ≤6000 chars, profile
     context, saved answers, task and style hints, model, resume corpus if any)
        │   Groq primary → fallback; empty, too short or cut-off answers rejected
   ┌────┴────┐
 fail      success
   │          ├─ the answer replaces the editor; fabrication flags shown (advisory)
 no charge    ├─ Premium → done
              └─ else: consumesCredit → POST /api/credits/deduct
                         ok   → improvements = 3
                         fail → improvements = 0, a warning; the answer stays
                       not consuming → improvements − 1
                       → saved on the answer being edited
```

**Hourly ceiling:** the generate route refuses an account's drafts past
`GENERATE_LIMIT_PER_HOUR` (default 30, Premium included) with a 429 and when
to try again, before the model is called (`server/generateLimit.js`; it fails
open if its table is missing). Cover letters count against the same ceiling.

**Credit rule:** one credit buys an answer plus three improvements of it.
The page charges after the fact; see `HANDOVER.md` §7 item 25 and
`docs/plans/active/server-side-generation-charging.md`. The dashboard has no
access to the job page: the description is pasted (the popup can read it).

Saving de-duplicates against existing questions *and* answers
(case-insensitive) when adding; editing updates in place. Every save writes
the store and syncs to the extension.

---

## 6. Cover letters (dashboard and popup)

```text
Templates: up to 10 per profile, typed, pasted or uploaded (.txt/.md)
        │
        ▼
Select a template ──► company, role, job description
        │   (dashboard: pasted · popup: read from the open page, else pasted)
        │
        ├─ no template body / no description → says which
        ├─ credit check (src/coverLetterCredits.js):
        │     free if Premium, or a re-run: same template, same description
        │     (its first 6000 characters, case and spacing aside)
        │     otherwise 1 credit; at 0 → "No credits remaining. Premium makes
        │     cover letters unlimited." (no AI call)
        ▼
POST /api/answer-vault/generate
   question: "<label> for this application", draft: the template body,
   taskHint: rewrite for this opportunity, keep the voice, name the company
   and role, weave in 2–4 requirements, ±10% of the original length
        │
        ▼
Result beside the original
        ├─ paid → POST /api/credits/deduct → one free re-run stored on the template
        │         (aiRerunsLeft, aiRerunKey); a failed deduct stores none
        ├─ re-run → its allowance used up
        ├─ Copy · Save version (company, role, description excerpt, body)
        └─ popup only: Fill page → FILL_COVER_LETTER into the best text field
```

Beside the button, the next press's cost is spelled out: a free re-run,
"Uses 1 credit, which includes one free re-run", or no credits left.
Personalising stamps `lastUsed` on the template.

**In the popup**, all of this needs a session the popup cannot get yet (§2,
HANDOVER.md §7 item 27). Signed out, which today is everyone, the tab keeps
its templates and saved versions but, in place of the target fields and the
button, says personalising is on the dashboard:

```text
Popup ▸ Cover Letter (signed out)
        │
        ▼
"Personalize on the dashboard" ──► <site>/dashboard/?extensionId=<id>&view=cover
        │
        ▼
Dashboard: personalise ─► Save version ─► ONEXTAP_SYNC_DATA (coverLetters)
        │
        ▼
Popup ▸ Saved versions ─► Fill ─► FILL_COVER_LETTER into the open page
```

A template made in the popup is replaced at the next dashboard save
(HANDOVER.md §7 item 28). The signed-in path above is kept for when the
popup gets a sign-in; `npm run test:e2e:extension` drives both, the signed-in
one with a session put in place.

---

## 7. Job Matches (dashboard)

```text
Pick a resume from the library (or upload one, as in §3.2)
        │
        ▼
Filters: a DRAFT, applied with Apply / Enter (a rank costs LLM calls)
        │
        ▼
POST /api/jobs/rank  (the shared pool; prefilter → LLM batches → gate → up to 2 reformulations)
        │   hourly limit per account; results cached server-side
        ▼
Ranked cards: score band, evidence, matched and missing skills; "Low detail" for
snippet-only postings; every degraded state says so (keyword-only scoring, partly
AI-scored, filters broadened, the hourly limit, a thin pool)
        │
        ├─ Sort: re-orders what is in hand, no re-rank
        ├─ Refresh: the one way to ask the same question again
        └─ Explain my fit ──► POST /api/jobs/explain
                 the server refuses at 0 credits (403), charges after success,
                 refunds if a later step fails; reopening an explained job is free
```

The last result is kept in memory, keyed by the resume and the applied
filters, so leaving the page and coming back does not re-rank (a reload
does). Only the parsed fields the ranker needs, and for Explain the resume
corpus, leave the device, as request bodies.

---

## 8. Upgrade, cancellation and billing (the plan panel)

```text
Upgrade (landing pricing, the dashboard's plan panel, ?upgrade=1)
        │
        ▼
POST /api/create-checkout-session (metadata.supabaseUserId)
        ├─ already active at Dodo → 400 "You already have an active Premium subscription."
        ▼
Dodo hosted checkout ──► return to <CLIENT_URL>/dashboard/?payment=success
        │
        ├── in parallel ──► Dodo webhook ──► POST /api/webhook
        │                        signature verified over the raw body
        │                        account resolved: metadata → dodo_customer_id → email
        │                        subscription.active → is_premium = true
        ▼
Dashboard sees ?payment=success
        ├─ "Payment received! Activating your Premium subscription…"
        └─ GET /api/verify-premium every 8 s, up to 15 times (2 minutes)
                ├─ Pro → "Premium activated! You now have unlimited AI credits."
                └─ timeout → "Premium may take a moment to activate — refresh shortly."

?payment=cancelled → "Payment cancelled."
```

The panel (`web/dashboard/js/subscription.js`) has four states: Standard;
Pro renewing (with the date); Pro ending (with its end date and "Keep Pro");
Pro without dates (Dodo could not be reached).

| Action | Route | Effect |
|---|---|---|
| Switch to Standard, subscription active | `POST /api/cancel-subscription` | Cancelled **at the end of the period** (`cancel_at_next_billing_date`). Premium stays on until Dodo's `subscription.cancelled` arrives |
| Switch to Standard, on hold / pending / past due | same | Cancelled at once, as before |
| Keep Pro | `POST /api/resume-subscription` | Withdraws the scheduled cancellation |
| Billing & invoices | `POST /api/create-portal-session` | Dodo's portal, in a new tab (opened on the click, so no pop-up block) |

| Webhook event | Effect on `profiles` |
|---|---|
| `subscription.active` | `is_premium = true`, subscription and customer ids, `status = active`, `premium_since = now()` |
| `subscription.renewed` | `is_premium = true`, `status = active` |
| `subscription.on_hold` | `status = on_hold`, `payment_failed = true`, `last_failed_payment = now()` |
| `subscription.cancelled` | `is_premium = false`, `status = cancelled`, `cancelled_at = now()` |
| `subscription.failed` | `is_premium = false`, `status = failed` |
| `payment.failed` | `payment_failed = true`, `last_failed_payment = now()` |

Unresolvable users are logged and skipped; the webhook still answers
`{ received: true }` so Dodo does not retry forever. Once per visit, as the
dashboard boots, `verify-premium` re-checks Premium against Dodo, and a
Premium that has lapsed comes back to a real balance.

---

## 9. Account settings (dashboard)

The settings menu (`web/dashboard/js/settings.js`, actions in `main.js`):

- **Change avatar** — an image of up to 5 MB, kept on this device
  (`onextap_avatar_<user id>`). Without one: the Google photo, else initials.
- **Manage subscription** — the plan panel (§8).
- **Log out** — `signOut`, then removes `user_profile` and `onextap_profiles`
  from this browser (resumes and the avatar stay), and goes to `/`.
- **Delete account** — type `DELETE`, then `DELETE /api/account`: a billable
  subscription is cancelled at Dodo first (the deletion stops if Dodo cannot
  confirm), then the Supabase auth user is deleted, and `profiles`,
  `credit_transactions`, `rank_cache`, `rank_rate_limit` and
  `generation_rate_limit` go with it by cascade. Only then is this browser's storage cleared and the session
  dropped. The extension's copy and other browsers keep their local data, and
  the dialog says so.

---

## 10. Application types

`src/applicationTypes.js` knows job, college, scholarship and internship, but
**only Job is live**: the others are commented out, the popup's picker is
hidden, and the dashboard has none. A stored type that is no longer listed
reads as Job.

---

## 11. Error and recovery paths

| Where | Trigger | What the user sees |
|---|---|---|
| Dashboard boot | No Supabase settings in the build | "The dashboard couldn't start." with what to check |
| Dashboard boot | Dead session (or a 401 from `/api/me`) | Sent to sign in, the session dropped first |
| Dashboard boot | `/api/me` unreachable | Session-only view; "Couldn't load your account…" |
| Sign-in window | Supabase refuses | The reason in plain words; the form kept |
| Resume upload | Any pre-flight or parse failure | A specific message naming the cause |
| Answer Studio, cover letters | Generation fails | Inline error; no credit spent |
| Answer Studio, cover letters | Generation succeeds, deduct fails | The text kept, a warning, no free follow-ups |
| Answer Studio, cover letters | No credits | Refused before the AI call |
| Answer Studio, cover letters | Past the hourly ceiling | 429: "That's the limit of N AI drafts an hour. Try again in M minutes." |
| Reset page | No link, an expired or refused link | "Open the link from your email." / "This link can't be used." and a new link |
| Explain my fit | No credits / a failure after the charge | 403 refusal / the credit refunded by the server |
| Profile save | Extension did not confirm | "Saved here — the extension didn't confirm the sync" |
| Feedback form | `/api/feedback` fails | "That didn't go through. Try again in a moment." |
| Popup render | Thrown error | `ErrorBoundary` with "Copy diagnostics" |
| Popup autofill | Restricted page | "Error: Cannot access this page" |
| Server | Unhandled route error | `errorLogger` answers JSON; `X-Request-Id` ties a report to the log |
| Any website page | Uncaught error | Logged (redacted) and kept for `__onextapIssues()` |

---

## 12. State that persists

| Key | Where | Contents |
|---|---|---|
| `onextap_profiles` | extension: `chrome.storage.local`; web: `localStorage` | `{ profiles: { id: { name, isDefault, autofillData, coverLetters, savedAnswers } }, activeProfileId }` |
| `user_profile` | same | Flat mirror of the active profile |
| `onextap_resumes` | same | The resume library (parsed fields and text, never the file) |
| `onextap_application_type` | extension | `job` (the only live type) |
| `onextap_tutorial_seen` | web | The dashboard's tour, done |
| `onextap_avatar_<user id>` | web | The avatar chosen on this device |
| `dashboard.dock` | web | Where the dashboard's dock sits |
| `sb-<project ref>-auth-token` | web: `localStorage`; extension: `chrome.storage.local` | The Supabase session |
| `profiles` row | Postgres | Account, credits, premium and Dodo ids — **never profile content** |
| `credit_transactions` | Postgres | Every credit movement, written by the server only |
| `generation_rate_limit` | Postgres | Drafts counted in the account's current hour (migration 006) |
