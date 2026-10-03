# Onextap — Product Requirements Document

> **Since this was written:** the React landing page and dashboard it names
> were replaced by the plain-JS website under `web/` (the website merge,
> September 2026); the extension popup is unchanged. What changed and what is
> still open: [`HANDOVER.md`](../HANDOVER.md). Layout:
> [`repo-structure.md`](repo-structure.md).

**Status:** Descriptive, not aspirational. This PRD documents the product as
built at commit `9b01adb` (2026-09-09), extension version `1.0.3`. Where the
shipped UI promises something the code does not do, it is listed in
[§11 Known divergences](#11-known-divergences) rather than written up as if
it worked.

**Related:** [`trd.md`](trd.md) · [`app-flow.md`](app-flow.md) ·
[`ui-ux-design.md`](ui-ux-design.md) · [`backend-schema.md`](backend-schema.md) ·
[`repo-structure.md`](repo-structure.md)

---

## 1. Problem

Applying for jobs is a copy-paste job. The same name, address, education and
work history get retyped into a different form on every ATS, and every
application asks the same three or four open-ended questions in slightly
different words. Candidates either apply slowly and carefully, or fast and
generically.

Existing autofill (browser password managers, ATS account imports) handles
the identity fields and stops there. Nothing handles the part that actually
takes the time: the written answers and the cover letter, tailored to the
posting on screen.

## 2. Product

Onextap is a Chrome extension plus a web dashboard. The user enters their
details once — or uploads a resume and has it parsed — and from then on:

- **one click fills the form** on any application page, matching each field
  by keyword against the saved profile;
- **saved answers** are kept in an Answer Studio and can be rewritten by AI
  against the job description scraped from the page currently open;
- **cover letters** are stored as templates and personalised per application,
  then dropped into the page's cover-letter field.

Account and billing live in Supabase. Everything personal — profile,
answers, cover letters — stays on the device.

## 3. Goals and non-goals

### Goals

| # | Goal | How it is met today |
|---|---|---|
| G1 | Cut the time to fill an application form to one click | `AUTOFILL_TRIGGERED` keyword-matching pass in `public/content.js` |
| G2 | Remove retyping of long-form answers | Answer vault per profile, plus AI rewrite |
| G3 | Make AI answers specific to the posting on screen | Page scrape (`SCRAPE_ACTIVE_TAB`) feeds the generation prompt |
| G4 | Keep personal data off the vendor's servers | Local-only storage; Supabase holds account + billing only |
| G5 | Make paid AI usage tamper-proof | All credit reads/writes are server-side; RLS blocks client writes |
| G6 | Serve adjacent application types, not just jobs | Four application types relabel the UI |

### Non-goals

- **Not an ATS.** Onextap never submits an application, tracks a pipeline, or
  represents an employer. It fills a form the user is already looking at.
- **Not a job board.** No search, no listings, no recommendations.
- **Not a resume builder.** Resumes are parsed for input, never generated.
- **No cross-device profile sync.** Profile data is deliberately device-local
  (see §11 — the marketing copy disagrees).
- **No Firefox/Safari today.** MV3, `chrome.*` APIs, Chromium only.

## 4. Users

| Persona | Situation | What they need |
|---|---|---|
| **High-volume applicant** | 20–100 applications over a few weeks, mostly the same role | Speed. Autofill and a reusable answer vault. |
| **Targeted applicant** | 5–10 carefully chosen roles | Tailoring. AI rewrites against each job description; cover-letter variants. |
| **Student / early career** | College, scholarship and internship forms as well as jobs | The same tool with the right vocabulary — "Personal Statement", not "Cover Letter". |
| **Multi-track applicant** | Applying as, say, both a designer and a PM | Separate profiles with their own details and answers, switchable in one control. |

## 5. Features

### 5.1 Profiles (`ProfilesPage`, `src/profileStore.js`)

Multiple named profiles, each with its own autofill data, saved answers and
cover letters. One is active at a time; the active profile is what fills
forms and what the AI reads for context.

Per profile: personal details, address, phone with country dial code, up to
three URLs (LinkedIn / GitHub / Portfolio), education, experience,
certificates, skills, current job, salary and notice period, and optional
demographic fields (race, ethnicity, veteran status, disability, gender).

Rules the store enforces:

- Names are trimmed to 32 characters and must be unique, case-insensitively.
- The `Default` profile cannot be deleted, and neither can the last one.
- Deleting the active profile falls back to `Default`, else to whatever
  remains.
- A pre-multi-profile `user_profile` blob is migrated into a `Default`
  profile on first load, and `user_profile` is kept written as the flat
  shape the content script reads.

### 5.2 Resume parsing

Upload a PDF or image; Google Gemini returns structured JSON, which is
**merged over** the existing profile — a field the model did not find never
erases one the user typed. Country names are matched against the country
list so the dial code follows. Requires a signed-in session; the client
pre-flights `GET /api/me` before spending the upload.

Accepted: `application/pdf`, `image/png`, `image/jpeg`, `image/jpg`,
`image/webp`, `image/heic`, `image/heif`. Anything else is rejected with a
400 naming the type.

### 5.3 Autofill

Injected on demand — no content script runs until the user clicks. The pass:

1. Build an ordered intent list from the active profile. Order is
   load-bearing: `first name` before `full name`, `phone number` before
   `phone`, `postal code` before `country`, `current company` before
   `company`.
2. For every `input` / `textarea` / `select`: skip disabled, read-only,
   invisible, already-filled, and non-fillable input types (an allowlist —
   password, hidden, file, checkbox and radio are all excluded).
3. Build a signature from `name`, `id`, `placeholder`, `aria-label`,
   `autocomplete` and the associated `<label>`, then take the **first**
   matching intent.
4. Set the value through the native setter and dispatch `input` + `change`,
   so React and Vue forms register it.

`<select>` elements match by exact value, then exact text, then substring.
The popup reports the count: "Filled 12 fields".

**Section detection.** Before the user clicks, the popup asks the page which
sections it contains (personal info, education, work experience, open-ended,
cover letter) and shows toggles for only those. This is a keyword heuristic
over all field signatures, not proof a matching field exists.

### 5.4 Answer Studio

A vault of question/answer pairs per profile, plus AI rewriting.

- Job context comes from the active tab automatically, or is pasted by hand.
  With neither, the answer is generated untailored and the user is told so.
- Four tone presets: balanced, impact-driven, technical depth, leadership.
- The prompt carries the question, the user's draft, the job context, a brief
  profile summary (current role, top 8 skills, two most recent roles), and the
  three most word-overlapping saved answers — not the whole vault.
- The model is instructed to write 160–240 words, first person, plain text,
  no headings or bullets, and never to invent employer facts or numbers.

**Credit rule:** one credit buys the first generation for an answer *and*
three follow-up improvements on it. Credits are deducted **after** a
successful generation, so a failed call is free. Premium accounts are never
charged and get no improvement counter.

### 5.5 Cover letters

Up to 10 templates per profile. Personalising one sends the template plus the
job context to the same generation endpoint with a rewrite instruction that
preserves the candidate's voice and keeps length within ±10%. The result can
be copied, saved as a named variant against that template, or pushed into the
page's cover-letter field.

Filling looks for a visible textarea or text input whose signature matches a
cover-letter keyword, and — unlike autofill — will overwrite a field that
already has content. Failing that, it takes the largest empty textarea.

### 5.6 Application types

`job` · `college` · `scholarship` · `internship`. Selecting one relabels the
UI: "Cover Letter" becomes "Personal Statement" or "Scholarship Essay",
"Answer Studio" becomes "Application Essays". It also changes the AI rewrite
instruction for cover letters. Every type currently enables every feature, so
the type is presentation plus prompt wording, not gating.

### 5.7 Accounts and billing

Email/password or Google sign-in via Supabase. In the extension, Google goes
through `chrome.identity.launchWebAuthFlow` so the popup does not close.

Free accounts get 3 credits on sign-up, granted by a database trigger.
Premium is **$5/month** via Dodo Payments: the server creates a hosted
checkout session, the user pays on Dodo's page, a signed webhook flips
`is_premium`, and the dashboard polls `verify-premium` every 8 seconds for up
to 2 minutes until it sees the change.

Premium status is re-verified against Dodo on every check, and a locally
stale `is_premium` is cleared when the subscription is no longer active. If
Dodo is unreachable the local flag is trusted — degrade in the user's favour.

## 6. Pricing

| | Free | Premium |
|---|---|---|
| Price | $0 | $5.00 / month |
| Autofill | Unlimited | Unlimited |
| Profiles | Unlimited | Unlimited |
| Cover-letter templates | 10 per profile | 10 per profile |
| AI generations | 3 credits, each buying 1 generation + 3 improvements | Unlimited |

Cancellation is immediate: the server cancels at Dodo and clears
`is_premium` in the same request. There is no proration and no grace period.

## 7. Requirements

### Functional

| ID | Requirement |
|---|---|
| FR-1 | Autofill runs only on user action, on the active tab, and never on a `chrome:`, `chrome-extension:`, `edge:`, `about:` or Web Store URL |
| FR-2 | Autofill never overwrites a field that already has a value |
| FR-3 | Profile data is written only to `chrome.storage.local` / `localStorage`, never to Supabase |
| FR-4 | Every AI and credit endpoint requires a valid Supabase JWT |
| FR-5 | Credits change only through authenticated server routes; the client never computes a balance |
| FR-6 | A credit is deducted only after a generation succeeds |
| FR-7 | A credit deduction that cannot be written to the audit log rolls the balance back and reports failure |
| FR-8 | Premium accounts are never deducted and report an unlimited balance |
| FR-9 | Resume parsing accepts PDF and the listed image types only |
| FR-10 | The dashboard and the extension popup are the same React app and must both work |

### Non-functional

| ID | Requirement |
|---|---|
| NFR-1 | AI generation times out client-side at 90s; page scrape at 10s; credit calls at 10s |
| NFR-2 | Each AI provider falls back to a second model on 404/429/5xx and on empty or safety-blocked responses |
| NFR-3 | Every server response carries `X-Request-Id`, repeated on every log line for that request |
| NFR-4 | No runtime calls `console.*` directly; all four loggers redact secrets and PII before printing |
| NFR-5 | Scraped job description is capped at 8000 chars; 6000 are sent to the model |
| NFR-6 | A render error shows a recovery screen with copyable diagnostics, not a blank page |
| NFR-7 | The extension requests no `host_permissions` for arbitrary sites; page access is `activeTab` + on-demand injection |

## 8. Success measures

None are instrumented today — there is no analytics in the codebase. If they
were, the ones that matter:

- Fields filled per autofill click (the core value claim).
- Share of AI generations that had real job context versus none.
- Free → Premium conversion, and where in the flow it happens.
- Autofill failures by cause: restricted page, no profile, zero matches.

## 9. Compliance and trust

- **Local-first.** Personal data never reaches Supabase. This is enforced in
  code, not just policy: `src/storage.js` has no network path.
- **AI processing.** Job description, question, draft and a short profile
  summary go to Groq; resume file bytes go to Google Gemini. Both are
  request-scoped; neither is stored server-side.
- **Payments.** Card details never touch Onextap — Dodo hosts the checkout.
- **Logging.** Secrets and PII are redacted by key name in all four loggers
  before anything is printed.
- **Deletion.** "Delete account" today clears local storage and signs the
  user out; it does not remove the Supabase row (see §11).

## 10. Release surfaces

| Surface | Build | Deployed by |
|---|---|---|
| Chrome extension | `npm run build` → `dist/` | Chrome Web Store, uploaded by hand |
| Web dashboard | `npm run build:dashboard` → `dist-dashboard/` | Vercel |
| API | same repo, `api/index.js` re-export | Vercel serverless function |
| Database | `supabase/schema.sql` | Applied by hand in the Supabase SQL editor |

## 11. Known divergences

Shipped copy or code that does not match behaviour. Each is a product
decision waiting to be made — build it, or stop claiming it.

| # | Claim / expectation | Reality |
|---|---|---|
| D1 | Landing page and FAQ advertise **"Smart Field Mapping — map it once, Onextap remembers"** | Not implemented. There is no per-field mapping store; matching is keyword-only and stateless. |
| D2 | Premium list and FAQ advertise **"Encrypted cloud backup & sync"** | Not implemented, and contradicts the architecture: profile data is local-only by design. |
| D3 | Privacy policy names **Anthropic/Google** as the AI partners | Actual providers are **Groq** (Llama, answer generation) and **Google Gemini** (resume parsing). |
| D4 | Privacy policy describes an optional **Cloud Sync** toggle | No such toggle exists. |
| D5 | "What to fill" section toggles imply partial fills | The popup sends `sections`, but `autofill()` in `public/content.js` ignores it — every matching field is filled regardless. Only the button label changes. |
| D6 | **Delete account** | Clears local storage and signs out. The Supabase `auth.users` and `profiles` rows survive; no server route exists to remove them. |
| D7 | `POST /api/credits/refund` and `creditManager.refundCredit()` | Implemented on both sides, called from nowhere. |
| D8 | `ExtensionBridge` (`?mode=extension-bridge`) | A complete postMessage RPC endpoint with no caller in this repo. |
| D9 | Premium: "two-pass AI rewrites", "priority processing", "deeper personalization" | The generation path is identical for free and premium accounts; only the credit check differs. |
| D10 | `dodopayments` SDK | Root pins `^0.18.0`, `server/` pins `^2.36.0`. Vercel installs from the root, so production may run the older major. |

## 12. Open questions

1. Are D1/D2/D9 roadmap items or copy to be removed? They are the difference
   between an aspirational and a truthful pricing page.
2. Should the section toggles actually gate the fill (D5)? The UI already
   implies it and the payload is already sent.
3. Does account deletion need to be real (D6)? It is a GDPR/CCPA exposure as
   it stands.
4. Is the 1-credit-buys-4-generations rule discoverable enough? It is
   explained nowhere in the UI outside the improvement counter.
5. Should credits refund automatically on a failed generation, given the
   endpoint exists (D7)?
