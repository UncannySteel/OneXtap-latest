# Onextap Extension

A Chrome extension that autofills job applications using saved profiles and AI-powered answer generation. Includes a web dashboard for managing profiles, an answer vault for reusable responses, and a premium subscription tier via Dodo Payments.

## Features

- **Profile Management** — Store and manage multiple job application profiles
- **Form Autofill** — Automatically fill job application forms on any site
- **Resume Parsing** — Upload a resume to extract and populate profile data
- **Answer Vault** — Save reusable answers for common application questions
- **Answer Studio (AI)** — Generate tailored answers using Google Gemini, informed by the job description
- **Premium Subscription** — Upgrade via Dodo Payments for unlimited AI credits
- **Cloud Sync** — Profile data syncs between the dashboard and extension via Supabase

## Project Structure

```
OnexTap_Extension/
├── extension/              # Chrome extension source
│   ├── manifest.json       # Extension manifest (permissions, service worker)
│   ├── background.js       # Service worker (AI generation, resume parsing)
│   └── constants.js        # Shared constants
├── src/                    # React frontend
│   ├── components/
│   │   ├── OnextapDashboard.jsx   # Main dashboard UI
│   │   └── ExtensionBridge.jsx    # Popup ↔ dashboard communication bridge
│   ├── popup.jsx           # React entry point for the extension popup
│   ├── auth.js             # Authentication helpers
│   ├── content.js          # Content script (fills forms on web pages)
│   ├── creditManager.js    # AI credit tracking
│   ├── storage.js          # Storage abstraction layer
│   └── supabaseClient.js   # Supabase client init
├── server/                 # Express backend
│   ├── index.js            # API routes (checkout, webhooks, premium verification)
│   └── supabase.js         # Server-side Supabase client
├── dist/                   # Built extension (load this in Chrome)
├── index.html              # React entry HTML
├── vite.config.js          # Vite build config (extension)
├── vite.dashboard.config.js # Vite build config (dashboard)
├── tailwind.config.js
└── postcss.config.js
```

## Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project
- A [Dodo Payments](https://app.dodopayments.com) account (for premium features)
- A [Google AI Studio](https://aistudio.google.com/apikey) API key (for AI answer generation)

## Setup

### 1. Install dependencies

```bash
npm install
npm run server:install
```

### 2. Configure environment variables

**Frontend** — copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `VITE_API_URL` | Backend server URL (`http://localhost:3001` for dev) |
| `VITE_DASHBOARD_URL` | Dashboard URL for payment redirects |
| `VITE_ANSWER_STUDIO_MODEL` | AI model name (default: `gemini-2.5-flash`) |

**Backend** — copy `server/.env.example` to `server/.env`:

```bash
cp server/.env.example server/.env
```

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `DODO_PAYMENTS_API_KEY` | Dodo Payments API key |
| `DODO_PAYMENTS_WEBHOOK_KEY` | Dodo Payments webhook secret |
| `DODO_PRODUCT_ID` | Dodo product ID for the premium subscription |
| `DODO_PAYMENTS_ENVIRONMENT` | `test_mode` or `live_mode` |
| `GEMINI_API_KEY` | Google Gemini API key for Answer Studio |
| `GEMINI_MODEL` | Primary Gemini model (default: `gemini-2.5-flash`) |
| `GEMINI_FALLBACK_MODEL` | Fallback Gemini model (default: `gemini-2.5-pro`) |
| `CLIENT_URL` | Dashboard URL for post-checkout redirects |
| `PORT` | Server port (default: `3001`) |

### 3. Build the extension

```bash
npm run build
```

### 4. Load in Chrome

1. Go to `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `dist/` folder
4. Copy the **Extension ID** shown on the extensions page

### 5. Update the Extension ID

In `src/components/OnextapDashboard.jsx`, set `EXTENSION_ID` to the ID you copied, then rebuild:

```bash
npm run build
```

Reload the extension in `chrome://extensions/` (click the reload icon).

### 6. Start the backend server

```bash
npm run server:dev
```

## Development

```bash
npm run dev          # Vite dev server at localhost:5173
npm run server:dev   # Backend with auto-reload
npm run build        # Production build → dist/
```

After any code change, rebuild and reload the extension in Chrome.

## Dodo Payments (Premium)

1. Create a subscription product in the Dodo Payments dashboard
2. Set up a webhook endpoint pointing to `https://your-server/api/webhook` for subscription events
3. Add credentials to `server/.env`
4. The payment flow: user clicks Upgrade → server creates a Dodo checkout session → user pays on Dodo's hosted page → webhook confirms → user is marked premium in Supabase

### Server API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/create-checkout-session` | Create a Dodo Payments checkout |
| POST | `/api/webhook` | Dodo Payments webhook handler |
| GET | `/api/verify-premium` | Check premium status |
| POST | `/api/cancel-subscription` | Cancel premium subscription |
| GET | `/api/health` | Health check |

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Extension won't load | Make sure you selected the `dist/` folder, not the project root |
| MIME type / module errors | Use `npm run build` (not dev mode) when loading the extension |
| Dashboard won't open | Verify `DASHBOARD_URL` / `VITE_DASHBOARD_URL` is correct and rebuilt |
| Data not syncing | Confirm `EXTENSION_ID` matches your actual extension ID |
| AI generation fails | Check `GEMINI_API_KEY` in `server/.env` and that the server is running |
| Webhook not received | Verify the webhook URL and secret in Dodo Payments dashboard |
