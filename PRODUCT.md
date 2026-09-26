# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Four co-equal personas (no priority order between them):

| Persona | Situation | What they need |
|---|---|---|
| High-volume applicant | 20–100 applications over a few weeks, mostly the same role | Speed: autofill and a reusable answer vault |
| Targeted applicant | 5–10 carefully chosen roles | Tailoring: AI rewrites against each job description, cover-letter variants |
| Student / early career | College, scholarship, and internship forms as well as jobs | The same tool with the right vocabulary ("Personal Statement" instead of "Cover Letter") |
| Multi-track applicant | Applying as, say, both a designer and a PM | Separate profiles with their own details and answers, switchable in one control |

## Product Purpose

Applying for jobs is a copy-paste job: the same identity fields get retyped into every ATS, and every application asks the same three or four open-ended questions in slightly different words. Browser password managers and ATS account imports handle identity fields; nothing handles the part that takes real time — written answers and cover letters tailored to the posting on screen.

Onextap is a Chrome MV3 extension plus a web dashboard (one React source tree, two builds). The user enters their details once, or uploads a resume for AI parsing, and from then on: one click fills any application form by keyword-matching fields against the active profile; saved answers live in an Answer Studio and can be rewritten by AI against the scraped job description; cover letters are stored as templates and personalized per application.

Success means cutting the time to fill a form to one click, removing retyping of long-form answers, and making AI answers specific to the posting actually open — without personal data ever leaving the user's device.

## Positioning

Onextap does not submit applications, track a pipeline, or represent an employer — it fills a form the user is already looking at. It does not build resumes; resumes are parsed for input, never generated. It never syncs profile data across devices or to a server — device-local storage is enforced in code (`src/storage.js` has no network path), not just policy, and that is the trust claim a competitor storing profiles server-side could not make.

**Job matching is an active, in-progress product direction, not the stale "not a job board" non-goal recorded in `docs/prd.md`.** A real pipeline exists today: cron-driven ingest from seven job-board adapters (Adzuna, Arbeitnow, ATS boards, Himalayas, Jobicy, RemoteOK, Remotive) into a shared Supabase pool (`job_listings`), a deterministic keyword prefilter, and an LLM ranking graph (Gemini primary, Groq fallback) that scores fit, explains gaps, and reformulates a search when too few good matches are found. `docs/prd.md` §2–3 has not been updated to reflect this and should not be treated as current truth on this point; treat the ranking/matching system as real, load-bearing product surface when doing design or product work that touches it.

**Open / undecided (do not resolve without asking):** `docs/prd.md` §11 lists shipped marketing claims with no matching implementation — "Smart Field Mapping" (per-field memory), "Encrypted cloud backup & sync" (contradicts the local-only architecture), and premium "two-pass AI rewrites / priority processing / deeper personalization" (the generation path is identical for free and premium). Whether these become real roadmap items or get corrected out of the copy has not been decided. Do not design toward them as if they exist, and do not silently write them off as dead either — flag it if a task depends on the answer.

## Operating Context

- The user is mid-application, on the job posting or application page, usually wanting speed. Autofill and Answer Studio generation both read the currently open tab.
- Application types relabel the same UI for different contexts: `job`, `college`, `scholarship`, `internship` (e.g. "Cover Letter" → "Personal Statement" / "Scholarship Essay"). Every type currently enables every feature — the type changes presentation and prompt wording, not gating.
- The same React app runs as the extension popup (small, chrome-embedded) and the standalone web dashboard (full browser tab) — both must work from one source tree.
- Job matching runs asynchronously against a shared, pre-ingested pool, not a live per-request search — the user experiences it as a ranked list refreshing over time, not an instant query.

## Capabilities and Constraints

- **Local-first storage is a hard constraint, not a preference.** Profile data (personal details, saved answers, cover letters) lives only in `chrome.storage.local` (extension) / `localStorage` (web), synced device-to-device only via `ONEXTAP_SYNC_DATA` messaging between the dashboard and the extension it's opened from. It is never written to Supabase.
- Supabase holds only accounts and billing: auth users, a `profiles` row (credits, premium flag), `credit_transactions`, and the job-matching pool (`job_listings`, `job_ingest_state` — the only tables holding shared content rather than per-account rows).
- Credits and premium status are server-managed only; the client never computes or writes a balance (RLS blocks client writes to `credit_transactions`).
- Premium is $5/month via Dodo Payments. Free accounts get 3 credits (1 credit = 1 generation + 3 follow-up improvements on it).
- AI providers are request-scoped and never store data server-side on Onextap's end: Groq (Llama) generates answers/cover letters; Google Gemini parses resumes and ranks job matches. Each falls back to a secondary model on 404/429/5xx or an empty/safety-blocked response. (Opik, the observability layer, does retain traces when configured — that's a separate, real disclosure surface from the AI providers themselves.)
- No Firefox/Safari support today — MV3, `chrome.*` APIs, Chromium only.
- Terminology: "profile" is a saved applicant identity (a user can hold several); "Answer Studio" is the saved-answer vault plus AI rewrite; "corpus" (in job-matching) is the candidate's grounding text used to check AI output isn't fabricating experience.

## Brand Commitments

- Name: **Onextap**.
- Tone in existing UI/docs is plain and literal, not hype-y — feature names describe what they do (Answer Studio, Answer Vault, Autofill) rather than using marketing abstractions.

## Evidence on Hand

- `docs/prd.md` — descriptive PRD as of commit `9b01adb` (2026-09-09), including the divergences and open questions noted above under Positioning.
- `docs/trd.md`, `docs/app-flow.md`, `docs/ui-ux-design.md`, `docs/backend-schema.md`, `docs/repo-structure.md` — technical/architecture detail.
- `docs/job-match-vs-observable-job-agent.md` — design-level diff against the reference implementation the job-matching graph was built against; useful for understanding why the ranking pipeline is shaped the way it is (band-scored rubric, degrade-never-throw ranking, cron-ingest-then-rank rather than live fetch).
- No analytics or usage instrumentation exists in the codebase today — no real usage data to cite; don't fabricate metrics.
- No testimonials, customer names, or case studies exist — don't invent any.

## Product Principles

1. **Personal data never leaves the device.** This is enforced in code, not policy, and it is Onextap's central trust claim against competitors. Any new feature touching profile data must preserve it or be treated as an escalation requiring a privacy-policy update.
2. **The product fills what's already open, it doesn't manage the search.** Historically true for autofill/Answer Studio; job-matching is extending this into surfacing what to apply to, but the tool still doesn't submit applications or represent an employer.
3. **Tailoring beats speed when they trade off.** Targeted and multi-track applicants need AI output grounded in the specific job and profile in front of them, not generic filler — this is why fabrication-checking against the user's own corpus exists.
4. **Paid usage is server-tamper-proof by design.** Every credit and premium check is authenticated server-side; nothing about billing state is ever trusted from the client.
5. **Failures degrade, they don't break the flow.** The ranking pipeline never throws on a bad model response — every job that goes in comes out, falling back to keyword scoring rather than dropping results. This reflects an app the user is mid-task in, not a batch system where a retry is free.

## Accessibility & Inclusion

No product-specific accessibility requirement has been established beyond baseline web/extension conventions. Profile fields include optional demographic fields (race, ethnicity, veteran status, disability, gender) — these are applicant-facing data for filling forms that ask for them, not an accessibility feature of the product itself.
