# Onextap

A Chrome extension that autofills job applications from saved profiles, with a
website — a landing page and a dashboard — for managing those profiles,
writing answers and cover letters with AI, and matching a resume against a
pool of job listings. An Express API guards credits, the Premium subscription
(Dodo Payments) and the AI providers.

One origin serves all of it: the landing page at `/`, the dashboard at
`/dashboard/`, the API at `/api/`.

## Features

- **Accounts** — email (with an optional name) or Google, from the landing
  page's sign-in window. "Forgot password?" emails a link to
  `/reset-password/`, where the new password is set.
- **Profiles** — several application profiles, each with its own autofill
  data, saved answers and cover-letter templates. Edited on the dashboard;
  switched in the popup.
- **Autofill** (popup) — fills application forms on any site by matching each
  field against the active profile.
- **Resume parsing** — upload a PDF or image resume; Google Gemini extracts
  structured profile data, merged over the profile and kept in a local resume
  library.
- **Answer Studio** — tailored answers with Groq (Llama). On the dashboard you
  paste the job description; the popup reads it from the page you have open.
  One credit buys an answer plus three improvements of it.
- **Cover letters** — up to 10 templates per profile, personalised with AI per
  application, with saved versions. One credit buys a personalisation plus one
  free re-run of it (same template, same job description).
- **Job Matches** (dashboard) — ranks a shared pool of job listings, ingested
  daily from Adzuna, company ATS boards and keyless job boards, against one of
  your resumes. "Explain my fit" costs one credit.
- **Premium** — unlimited credits, via Dodo Payments. Cancelling keeps Premium
  until the end of the paid period; the billing portal is Dodo's.
- **Application types** — the code knows job, college, scholarship and
  internship modes; **only Job is live** (see `src/applicationTypes.js`).

### How data is stored

Profile data (personal details, saved answers, cover letters) and resumes are
**local only** — `chrome.storage.local` in the extension, `localStorage` on
the website. None of it is written to Supabase. The dashboard pushes the
profile to the extension over `chrome.runtime` messaging (`ONEXTAP_SYNC_DATA`),
and the extension files it into its own profile store as the active profile.
The two copies are separate stores kept in step by that message.

Local is not the same as private: resume files go to Gemini, and answer
requests (with profile context) to Groq, per request. The privacy page
(`/privacy/`) says what goes where.

Supabase holds accounts and billing state — auth users, plus a `profiles` row
carrying credits and premium status — and the shared job-listing pool.
Credits are server-managed and never adjusted client-side.

## Project structure

```
.
├── extension/          # Chrome extension: manifest, service worker, profile sync
├── public/             # Content script (autofill, page scraping) + icon
├── index.html, src/    # The popup (React), and the modules the website shares
├── web/                # The website (plain JS): landing page, dashboard, e2e tests
├── server/             # Express API (own package.json)
├── api/index.js        # Vercel serverless entry — re-exports the Express app
├── supabase/           # schema.sql + hand-applied migrations
├── test/               # npm test (node --test)
├── vite.config.js           # Extension build → dist/
└── vite.dashboard.config.js # Website build → dist-dashboard/
```

`docs/repo-structure.md` has the full layout and the import rules.

## Prerequisites

- Node.js 18+ for the app; `npm test` needs Node 21+ (it passes a glob to
  `node --test`). Developed on Node 25.
- A [Supabase](https://supabase.com) project
- A [Dodo Payments](https://app.dodopayments.com) account (for Premium)
- A [Groq](https://console.groq.com) API key — Answer Studio, cover letters,
  and the ranking fallback
- A [Google AI Studio](https://aistudio.google.com/apikey) API key — resume
  parsing and job ranking

Both AI keys are needed for the full feature set; neither substitutes for the
other.

## Setup

### 1. Install dependencies

```bash
npm install && npm run server:install
```

### 2. Set up the database

**A fresh project:** run `supabase/schema.sql` in the SQL Editor, then
`supabase/migrations/002_rank_cache.sql` and
`supabase/migrations/006_generation_rate_limit.sql`. `schema.sql` creates the `profiles`
and `credit_transactions` tables, the RLS policies, the sign-up trigger that
grants 3 free credits to each new account, and the job-listing pool (it
already includes migrations 001, 003, 004 and 005).

**An existing project:** never re-run `schema.sql` — it drops and recreates
the sign-up trigger. Apply the numbered files in `supabase/migrations/`
instead, and read `supabase/migrations/README.md` first: it is the only
record of what has been applied where.

### 3. Configure environment variables

**Frontend** — copy `.env.example` to `.env`:

| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `VITE_API_URL` | API origin: `http://localhost:3001` in development; empty on Vercel (same origin) |
| `VITE_DASHBOARD_URL` | The **site's origin** (`http://localhost:5173`, `https://www.onextap.com`). `/dashboard/` is appended in `src/config.js` |
| `VITE_ANSWER_STUDIO_MODEL` | Groq model requested by the client (default: `llama-3.3-70b-versatile`) |

Everything `VITE_*` is inlined into the shipped bundles. Server secrets never
go here.

**Backend** — copy `server/.env.example` to `server/.env`. The essentials:

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service role key — bypasses RLS, server-only |
| `GROQ_API_KEY` | yes | Groq key |
| `GEMINI_API_KEY` | yes | Google Gemini key |
| `DODO_PAYMENTS_API_KEY` | premium | Dodo Payments API key |
| `DODO_PAYMENTS_WEBHOOK_KEY` | premium | Dodo Payments webhook secret |
| `DODO_PRODUCT_ID` | premium | Dodo product ID for the Premium subscription |
| `DODO_PAYMENTS_ENVIRONMENT` | no | `test_mode` (default) or `live_mode` |
| `CLIENT_URL` | no | The **site's origin**. Checkout returns to `<CLIENT_URL>/dashboard/?payment=success`; also an allowed CORS origin (default: `https://www.onextap.com`) |
| `RESEND_API_KEY` | feedback | Sends the Contact page's feedback form by email |
| `CRON_SECRET` | ingest | Guards `/api/jobs/ingest`; unset, the route answers 503 |
| `ALLOW_CACHE_SOURCE` | no | Keep `false` in any env that points at a real project |
| `GENERATE_LIMIT_PER_HOUR` | no | AI drafts per account per hour, Premium included (default `30`; needs migration 006) |
| `PORT` | no | Server port (default: `3001`) |

`server/.env.example` documents the rest: model choices and fallbacks, the
job sources (Adzuna, ATS boards), ranking budgets, Opik tracing, and the
feedback sender.

### 4. Supabase auth URLs

In Supabase → Authentication → URL Configuration, add to the Redirect URLs:

- `https://www.onextap.com/dashboard/` and `http://localhost:5173/dashboard/`
  (Google sign-in and email confirmation land on the dashboard);
- `https://www.onextap.com/reset-password/` and
  `http://localhost:5173/reset-password/` (the password-reset email's link);
- `https://<extension-id>.chromiumapp.org/` (Google sign-in from the popup).

The Site URL can stay the site's root: the landing page forwards a session
that arrives there to the dashboard.

### 5. Build the extension

```bash
npm run build
```

Put `.env` in place first: its values are built into the extension.

### 6. Load in Chrome

1. Go to `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `dist/` folder
4. Copy the **Extension ID** shown on the extensions page

### 7. The extension ID

The dashboard messages the extension by ID. Opened from the popup's Dashboard
button, it gets the real ID as `?extensionId=`; opened directly, it falls back
to `EXTENSION_ID_FALLBACK` in `src/config.js` (the published extension's ID).
For an unpacked build, open the dashboard from the popup, or set the fallback
to your ID and rebuild.

### 8. Run it

```bash
npm run server:dev   # API on :3001
npm run dev          # the website on :5173 — landing /, dashboard /dashboard/
```

Keep the website on port 5173: it is the only local origin
`extension/manifest.json` lets talk to the extension.

## Development

```bash
npm run dev              # Website dev server (landing + dashboard) on :5173
npm run dev:extension    # Extension dev server (crx plugin)
npm run server:dev       # API with auto-reload
npm run build            # Extension → dist/
npm run build:dashboard  # Website → dist-dashboard/ (what Vercel builds)
npm test                 # Unit tests (node --test)
npm run test:e2e         # Landing page e2e (Playwright), against stubs
npm run evals            # Model-quality evals (opt-in; some spend real requests)
```

After changing `src/`, `extension/` or `public/`, rebuild and reload the
extension in Chrome: a loaded extension does not pick up dev-server changes.

There are two builds. `vite.config.js` builds the extension: the React popup
(`index.html` → `src/popup.jsx`), the service worker and the content script.
`vite.dashboard.config.js` builds the website from `web/`, which imports the
data modules it shares with the popup from `src/` through the `@app` alias.
The second build is what `vercel.json` runs, alongside `api/index.js`, which
serves the Express app as a serverless function.

### Testing

- `npm test` — matching and corpus functions, the profile and resume stores,
  server modules (jobs pipeline, logger, cron auth) and the extension's
  profile sync.
- `npm run test:e2e` — the landing page and its company pages, and the
  dashboard's cover-letter credits, in Chromium (desktop and phone) and
  WebKit. Sign-in, the feedback form and the API are answered by
  `web/tests/stubs.js`, and the test server's Supabase address cannot
  resolve, so a run never reaches a real project.
- Nothing automated covers the rest of the dashboard, the popup, the content
  script or the real services: check those by hand.

### Logging

Nothing calls `console.*` directly; each runtime has a logger that redacts
secrets and profile data before printing. Levels are `error`, `warn`, `info`,
`debug`.

```bash
LOG_LEVEL=debug npm run server:dev
```

- **Server** — `LOG_LEVEL` (default `info` in production, `debug` otherwise).
  Set `LOG_FORMAT=json` for one JSON object per line; this is automatic on
  Vercel so log drains can parse it. Every response carries `X-Request-Id`,
  and every log line inside that request repeats it as `rid`.
- **Website and popup** — `VITE_LOG_LEVEL` (default `warn` in a production
  build). Recent warnings and errors, uncaught ones included, are kept in
  memory, and `__onextapIssues()` in the console dumps them.
- **Content script** — errors and warnings always print; set
  `window.__onextapDebug = true` in the page console for the rest.

When a user reports a failure, ask for the `X-Request-Id` — that is what ties
their report to a server log line.

## Server API

Every route requires a Supabase JWT in `Authorization: Bearer <token>`, except
the webhook, the feedback form, the health check, and the ingest route (which
takes the cron secret).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/me` | Authenticated user profile (also used to pre-flight a token) |
| GET | `/api/credits` | Current credit balance and premium flag |
| POST | `/api/credits/deduct` | Deduct 1 credit; no-op for premium |
| GET | `/api/verify-premium` | Premium status, re-checked against Dodo, with the renewal date and any scheduled cancellation |
| POST | `/api/answer-vault/generate` | Answer and cover-letter generation (Groq); 429 past the hourly ceiling (`GENERATE_LIMIT_PER_HOUR`) |
| POST | `/api/parse-resume` | Resume → structured profile JSON (Gemini) |
| GET | `/api/jobs` | Browse the job pool, unranked |
| GET | `/api/jobs/locations` | Location facets for the pool |
| GET | `/api/jobs/meta` | What is in the pool, and which sources are failing |
| POST | `/api/jobs/rank` | Rank the pool against a resume |
| POST | `/api/jobs/explain` | One job against a resume, in depth (1 credit) |
| GET, POST | `/api/jobs/ingest` | Daily ingest run (Vercel cron; `CRON_SECRET`) |
| POST | `/api/create-checkout-session` | Create a Dodo Payments checkout |
| POST | `/api/cancel-subscription` | Cancel Premium: at the end of the period if active, at once otherwise |
| POST | `/api/resume-subscription` | Withdraw a scheduled cancellation |
| POST | `/api/create-portal-session` | Link to Dodo's billing portal |
| DELETE | `/api/account` | Delete the account: cancels a billable subscription at Dodo, then the Supabase user and its rows |
| POST | `/api/webhook` | Dodo Payments webhook (signature-verified, raw body) |
| POST | `/api/feedback` | The Contact page's feedback form, emailed via Resend; stores nothing |
| GET | `/api/health` | Health check |

## Dodo Payments (Premium)

1. Create a subscription product in the Dodo Payments dashboard, and enable
   its customer portal.
2. Point a webhook at `https://your-site/api/webhook` for subscription events.
3. Add the credentials to `server/.env`.

The flow: the user clicks Upgrade → the server creates a checkout session →
the user pays on Dodo's hosted page and returns to
`/dashboard/?payment=success` → the webhook marks the account premium in
Supabase → the dashboard polls `verify-premium` (every 8 s, up to 2 minutes)
until it flips.

Switching back to Standard cancels at the end of the paid period: Premium
stays on until Dodo's `subscription.cancelled` webhook turns it off, and
"Keep Pro" withdraws the cancellation until then.

The webhook resolves the account by `metadata.supabaseUserId`, then
`dodo_customer_id`, then email.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Extension won't load | Select the `dist/` folder, not the project root |
| MIME type / module errors | Use `npm run build` (not dev mode) when loading the extension |
| `supabaseUrl is required` | `.env` is missing or incomplete; for the extension, rebuild after adding it |
| Dashboard sends you to sign in every time | Check the Supabase redirect URLs (setup step 4) and that `VITE_SUPABASE_URL` is the same project the API uses |
| Data not syncing to the extension | Open the dashboard from the popup (it passes the extension ID), or set `EXTENSION_ID_FALLBACK`; the site must be on `localhost:5173` or the production origin |
| Answer generation fails | Check `GROQ_API_KEY` and its model ids (see `server/.env.example`), and that the server is running |
| "That's the limit of N AI drafts an hour" | The per-account ceiling (`GENERATE_LIMIT_PER_HOUR`, default 30); it lifts within the hour |
| The reset email's link opens the dashboard or the landing page | Add `<site>/reset-password/` to Supabase's Redirect URLs (setup step 4); the site forwards a stray reset link to the reset page meanwhile |
| Resume parsing fails | Check `GEMINI_API_KEY`; only PDF and image uploads are supported |
| Job Matches is empty | The pool is filled by the daily ingest (`/api/jobs/ingest`); check `/api/jobs/meta` |
| Feedback form fails | Check `RESEND_API_KEY` (and the sandbox limit noted in `server/.env.example`) |
| Credits stuck at 0 | Confirm `supabase/schema.sql` ran and `SUPABASE_SERVICE_ROLE_KEY` is the real service role key |
| Webhook not received | Verify the webhook URL and secret in the Dodo Payments dashboard |
