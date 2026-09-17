# Onextap Extension

A Chrome extension that autofills job applications using saved profiles and AI-powered answer generation. Includes a web dashboard for managing profiles, an answer vault for reusable responses, and a premium subscription tier via Dodo Payments.

## Features

- **Profile Management** — Store and manage multiple application profiles, each with its own autofill data, saved answers, and cover letters
- **Form Autofill** — Fill job application forms on any site by keyword-matching each field against the active profile
- **Resume Parsing** — Upload a PDF or image resume; Google Gemini extracts structured profile data
- **Answer Vault** — Save reusable answers for common application questions
- **Answer Studio (AI)** — Generate tailored answers with Groq (Llama), informed by the job description scraped from the page you have open
- **Application Types** — Job, college, scholarship, and internship modes, which relabel the UI (e.g. "Cover Letter" → "Personal Statement")
- **Premium Subscription** — Upgrade via Dodo Payments for unlimited AI credits

### How data is stored

Profile data (personal details, saved answers, cover letters) is **local only** — `chrome.storage.local` in the extension, `localStorage` on the web dashboard. It is never written to Supabase. The dashboard pushes it to the extension over `chrome.runtime` messaging (`ONEXTAP_SYNC_DATA`); the two copies are separate stores kept in step by that message.

Supabase holds only accounts and billing state: auth users, plus a `profiles` row carrying credits and premium status. Credits are server-managed and never adjusted client-side.

## Project Structure

```
.
├── extension/              # Chrome extension source
│   ├── manifest.json       # MV3 manifest (permissions, service worker)
│   ├── background.js       # Service worker (profile sync, resume + AI proxying, tab scraping)
│   └── constants.js        # Country / gender option lists
├── public/                 # Copied verbatim into the build
│   ├── content.js          # Content script (autofill, page scraping) — injected on demand
│   └── icon.png
├── src/                    # React frontend (dashboard + popup, one app)
│   ├── components/
│   │   ├── OnextapDashboard.jsx   # App root: picks popup vs dashboard, splash screen
│   │   ├── ExtensionBridge.jsx    # postMessage RPC endpoint (?mode=extension-bridge)
│   │   ├── shared/                # Components rendered by BOTH surfaces
│   │   ├── popup/                 # Extension popup screens
│   │   └── dashboard/             # Web dashboard screens
│   ├── popup.jsx           # React entry point
│   ├── config.js           # API/dashboard URLs, extension ID, model name
│   ├── extensionClient.js  # Extension ID / icon URL / web store helpers
│   ├── profileDefaults.js  # Blank profile shape + option lists
│   ├── answerStudio.js     # AI style presets and timeout budgets
│   ├── autofillSections.js # Autofill section list + default toggles
│   ├── auth.js             # Supabase auth helpers
│   ├── supabaseClient.js   # Supabase client (chrome.storage session adapter)
│   ├── creditManager.js    # Credit + premium API client
│   ├── storage.js          # chrome.storage / localStorage abstraction
│   ├── profileStore.js     # Multi-profile store, legacy-shape migration
│   ├── applicationTypes.js        # Job / college / scholarship / internship config
│   ├── applicationTypeStorage.js  # Persists the selected application type
│   └── index.css
├── server/                 # Express backend
│   ├── index.js            # All API routes
│   ├── supabase.js         # Admin client + JWT auth middleware
│   └── load-env.js         # Loads server/.env regardless of cwd
├── api/index.js            # Vercel serverless entry — re-exports the Express app
├── supabase/schema.sql     # Database schema, RLS policies, sign-up trigger
├── dist/                   # Built extension (load this in Chrome)
├── dist-dashboard/         # Built web dashboard (deployed by Vercel)
├── index.html              # React entry HTML
├── vite.config.js          # Extension build
├── vite.dashboard.config.js # Web dashboard build
├── tailwind.config.js
└── postcss.config.js
```

## Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project
- A [Dodo Payments](https://app.dodopayments.com) account (for premium features)
- A [Groq](https://console.groq.com) API key — Answer Studio generation
- A [Google AI Studio](https://aistudio.google.com/apikey) API key — resume parsing

Both AI keys are needed for the full feature set: Groq powers answer generation, Gemini powers resume parsing. Neither substitutes for the other.

## Setup

### 1. Install dependencies

```bash
npm install && npm run server:install
```

### 2. Set up the database

Run `supabase/schema.sql` in your Supabase project's SQL Editor. It creates the `profiles` and `credit_transactions` tables, the RLS policies, and the sign-up trigger that grants 3 free credits to each new account.

### 3. Configure environment variables

**Frontend** — copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `VITE_API_URL` | Backend URL (`http://localhost:3001` for dev; empty on Vercel to use same-origin) |
| `VITE_DASHBOARD_URL` | Dashboard URL for extension → dashboard links and payment redirects |
| `VITE_ANSWER_STUDIO_MODEL` | Groq model requested by the client (default: `llama-3.3-70b-versatile`) |

**Backend** — copy `server/.env.example` to `server/.env`:

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service role key — bypasses RLS, server-only |
| `GROQ_API_KEY` | yes | Groq key for Answer Studio generation |
| `GEMINI_API_KEY` | yes | Google Gemini key for resume parsing |
| `DODO_PAYMENTS_API_KEY` | premium | Dodo Payments API key |
| `DODO_PAYMENTS_WEBHOOK_KEY` | premium | Dodo Payments webhook secret |
| `DODO_PRODUCT_ID` | premium | Dodo product ID for the premium subscription |
| `DODO_PAYMENTS_ENVIRONMENT` | no | `test_mode` (default) or `live_mode` |
| `GROQ_MODEL` | no | Primary Groq model (default: `llama-3.3-70b-versatile`) |
| `GROQ_FALLBACK_MODEL` | no | Fallback Groq model (default: `llama-3.1-8b-instant`) |
| `GROQ_MAX_TOKENS` | no | Max output tokens (default `4096`; under 256 ignored, capped at 8192) |
| `GEMINI_MODEL` | no | Primary Gemini model (default: `gemini-2.5-flash`) |
| `GEMINI_FALLBACK_MODEL` | no | Fallback Gemini model (default: `gemini-2.5-pro`) |
| `CLIENT_URL` | no | Dashboard URL for post-checkout redirects (default: `https://www.onextap.com`) |
| `PORT` | no | Server port (default: `3001`) |

Each AI provider falls back to its secondary model on 404/429/5xx and on empty or safety-blocked responses.

### 4. Build the extension

```bash
npm run build
```

### 5. Load in Chrome

1. Go to `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `dist/` folder
4. Copy the **Extension ID** shown on the extensions page

### 6. Update the extension ID

The dashboard messages the extension by ID. When it is opened from the popup the real ID arrives as `?extensionId=`, so this only matters for opening the dashboard directly — but it is worth setting.

In `src/config.js`, set `EXTENSION_ID_FALLBACK` to the ID you copied, then rebuild and reload the extension in `chrome://extensions/`.

### 7. Start the backend

```bash
npm run server:dev
```

## Development

```bash
npm run dev              # Vite dev server at localhost:5173
npm run server:dev       # Backend with auto-reload
npm run build            # Extension build → dist/
npm run build:dashboard  # Web dashboard build → dist-dashboard/
```

After any code change, rebuild and reload the extension in Chrome.

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
- **Dashboard and popup** — `VITE_LOG_LEVEL` (default `warn` in a production
  build). Recent warnings and errors are kept in memory; `__onextapIssues()`
  in the console dumps them, and the error screen has a "Copy diagnostics"
  button.
- **Content script** — errors and warnings always print; set
  `window.__onextapDebug = true` in the page console for the rest.

When a user reports a failure, ask for the `X-Request-Id` or the copied
diagnostics — that is what ties their report to a server log line.

There are two separate builds from the same React source. `vite.config.js` produces the extension (crx plugin, relative base). `vite.dashboard.config.js` produces the standalone web dashboard — that is the build command in `vercel.json`, alongside `api/index.js`, which serves the Express app as a serverless function.

## Server API

Every route except the webhook and the health check requires a Supabase JWT in `Authorization: Bearer <token>`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/me` | Authenticated user profile (also used to pre-flight a token) |
| GET | `/api/credits` | Current credit balance and premium flag |
| POST | `/api/credits/deduct` | Deduct 1 credit; no-op for premium |
| POST | `/api/credits/refund` | Refund 1 credit after a failed generation |
| GET | `/api/verify-premium` | Premium status, re-checked against Dodo |
| POST | `/api/answer-vault/generate` | Answer Studio generation (Groq) |
| POST | `/api/parse-resume` | Resume → structured profile JSON (Gemini) |
| POST | `/api/create-checkout-session` | Create a Dodo Payments checkout |
| POST | `/api/cancel-subscription` | Cancel premium subscription |
| POST | `/api/webhook` | Dodo Payments webhook (signature-verified, raw body) |
| GET | `/api/health` | Health check |

## Dodo Payments (Premium)

1. Create a subscription product in the Dodo Payments dashboard
2. Point a webhook at `https://your-server/api/webhook` for subscription events
3. Add the credentials to `server/.env`
4. Flow: user clicks Upgrade → server creates a checkout session → user pays on Dodo's hosted page → webhook marks the account premium in Supabase → the dashboard polls `verify-premium` until it flips

The webhook resolves the account by `metadata.supabaseUserId`, then `dodo_customer_id`, then email.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Extension won't load | Make sure you selected the `dist/` folder, not the project root |
| MIME type / module errors | Use `npm run build` (not dev mode) when loading the extension |
| Dashboard won't open | Verify `VITE_DASHBOARD_URL` is correct and you rebuilt |
| Data not syncing to the extension | Confirm `EXTENSION_ID_FALLBACK` matches your actual extension ID, or open the dashboard from the popup so it is passed automatically |
| Answer generation fails | Check `GROQ_API_KEY` in `server/.env` and that the server is running |
| Resume parsing fails | Check `GEMINI_API_KEY`; only PDF and image uploads are supported |
| Credits stuck at 0 | Confirm `supabase/schema.sql` ran and `SUPABASE_SERVICE_ROLE_KEY` is the real service role key |
| Webhook not received | Verify the webhook URL and secret in the Dodo Payments dashboard |
