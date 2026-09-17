# Onextap — Technical Requirements Document

**Scope:** the system as built at commit `9b01adb` (2026-09-09). Layout and
import rules live in [`repo-structure.md`](repo-structure.md) and are not
repeated here; this document covers runtimes, contracts, data flow, security
and operations.

**Related:** [`prd.md`](prd.md) · [`app-flow.md`](app-flow.md) ·
[`backend-schema.md`](backend-schema.md) · [`ui-ux-design.md`](ui-ux-design.md)

---

## 1. System overview

One source tree, three deployed artifacts, four runtimes.

```text
┌──────────────────────── Chrome ────────────────────────┐
│                                                        │
│  ┌─ Extension popup (React) ─┐   ┌─ Web dashboard ─┐   │
│  │  index.html               │   │  same React app │   │
│  │  chrome.* present         │   │  chrome.* absent│   │
│  └──────────┬────────────────┘   └────────┬────────┘   │
│             │ chrome.runtime              │            │
│             │ .sendMessage                │            │
│  ┌──────────▼───────────────┐             │            │
│  │ Service worker (MV3)     │◄────────────┘            │
│  │ extension/background.js  │  onMessageExternal        │
│  └──────────┬───────────────┘                          │
│             │ chrome.scripting.executeScript            │
│  ┌──────────▼───────────────┐                          │
│  │ Content script           │  injected on demand       │
│  │ public/content.js        │  into the active tab      │
│  └──────────────────────────┘                          │
└────────────────────────┬───────────────────────────────┘
                         │ HTTPS + Supabase JWT
              ┌──────────▼──────────┐
              │  Express API        │  server/index.js
              │  (Vercel function)  │  api/index.js re-export
              └──┬───────┬───────┬──┘
                 │       │       │
        ┌────────▼─┐ ┌───▼───┐ ┌─▼──────────────┐
        │ Supabase │ │ Groq  │ │ Google Gemini  │
        │ Postgres │ │ Llama │ │ (multimodal)   │
        │  + Auth  │ └───────┘ └────────────────┘
        └──────────┘
                 ▲
        ┌────────┴───────┐
        │ Dodo Payments  │  webhook → /api/webhook (signed, raw body)
        └────────────────┘
```

### The four runtimes

| Runtime | File(s) | Constraints |
|---|---|---|
| React app | `src/**` | Ships to **both** the popup and the dashboard. Must work with `chrome.*` present and absent. |
| Service worker | `extension/background.js` | No DOM, no `window`, ephemeral. Holds no session — callers pass their JWT. |
| Content script | `public/content.js` | Classic script, copied verbatim, **cannot import**. Runs in a third-party page's isolated world. |
| Node server | `server/**` | Runs standalone in dev, as a Vercel serverless function in prod. |

None of the four can import from another (the one exception:
`src/` → `extension/constants.js`). Duplication between them is deliberate.

## 2. Technology

| Layer | Choice | Version / note |
|---|---|---|
| UI | React 18 + Tailwind 3, `lucide-react` icons | 15 component files under `src/components/{shared,popup,dashboard}/` |
| Bundler | Vite 5 | Two configs: `vite.config.js` (crx → `dist/`), `vite.dashboard.config.js` (→ `dist-dashboard/`) |
| Extension | Manifest V3 | `1.0.3`; service worker, no persistent background page |
| Server | Express 4 (ESM) | Node 18+ (no `engines` field declared) |
| Auth + DB | Supabase (Postgres, GoTrue, RLS) | `@supabase/supabase-js` ^2.95.3 |
| Answer AI | Groq — `llama-3.3-70b-versatile`, falls back to `llama-3.1-8b-instant` | `groq-sdk` ^0.15.0 |
| Resume AI | Google Gemini — `gemini-2.5-flash`, falls back to `gemini-2.5-pro` | Raw `fetch` against `v1beta` |
| Payments | Dodo Payments + `standardwebhooks` | **Version drift:** root `^0.18.0`, server `^2.36.0` |
| Hosting | Vercel (dashboard + API), Chrome Web Store (extension) | |

**Testing and linting: none.** No test framework, no ESLint, no Prettier
config. "Verified" means built and exercised in a browser.

## 3. Interface contracts

Three boundaries carry every cross-runtime interaction. Shapes must be
validated, never assumed.

### 3.1 `chrome.runtime` messaging → service worker

Accepted on `onMessage` (popup) **and** `onMessageExternal` (dashboard, from
an `externally_connectable` origin). The kind may arrive as `type` or
`action`. Every reply is `{ success: true, ... }` or
`{ success: false, error }`.

| Message | Payload | Reply |
|---|---|---|
| `ONEXTAP_SYNC_DATA` | `{ payload }` | `{}` — writes `payload` to `storage.local.user_profile` |
| `PARSE_RESUME` | `{ data: { fileData, fileName, fileType, token } }` | `{ data }` — proxies `POST /api/parse-resume` |
| `SCRAPE_ACTIVE_TAB` | — | `{ context: { company, description } }` |
| `GENERATE_IMPROVED_ANSWER` | `{ data: { token, ...body } }` | `{ text }` — proxies `POST /api/answer-vault/generate` |

The worker holds no Supabase session; `token` is the caller's JWT. Listeners
`return true` to keep the response port open across the async handler.

### 3.2 `chrome.tabs` messaging → content script

Every handler replies synchronously (listener returns `false`). Messages
without an `action` are ignored.

| Message | Payload | Reply |
|---|---|---|
| `AUTOFILL_TRIGGERED` | `{ profile, sections }` | `{ success, filled: <count> }` — **`sections` is currently ignored** |
| `SCRAPE_CONTEXT` | — | `{ success, context: { company, description } }` |
| `DETECT_SECTIONS` | — | `{ success, sections: { personalInfo, education, workExperience, openEnded, coverLetter } }` |
| `FILL_COVER_LETTER` | `{ text }` | `{ success }` — `false` when nothing matched |

A `window.__onextapAutofillLoaded` guard makes repeat injection idempotent.

### 3.3 HTTP API

Base URL: `VITE_API_URL`, or same-origin on Vercel. Every route except
`/api/webhook` and `/api/health` requires `Authorization: Bearer <supabase-jwt>`,
verified by `requireAuth` calling `supabaseAdmin.auth.getUser(token)`.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/me` | — | `{ id, email, displayName, credits, isPremium, subscriptionStatus, premiumSince, createdAt }` |
| GET | `/api/credits` | — | `{ credits, isPremium }` (sent `no-store`) |
| POST | `/api/credits/deduct` | — | `{ success, remaining }`; premium → `{ success, remaining: Infinity, isPremium: true }`; empty → `403` |
| POST | `/api/credits/refund` | — | `{ success, remaining }` |
| GET | `/api/verify-premium` | — | `{ isPremium, premiumSince?, subscriptionStatus? }` or `{ isPremium: false, reason }` |
| POST | `/api/answer-vault/generate` | `{ question, draft, jobContext, vaultAnswers[], profileContext?, taskHint, styleHint, model }` | `{ text, answer, model, provider: 'groq', finishReason? }` |
| POST | `/api/parse-resume` | `{ fileData (base64), fileName, fileType }` | `{ data: <structured profile> }` |
| POST | `/api/create-checkout-session` | — | `{ url, sessionId }` |
| POST | `/api/cancel-subscription` | — | `{ success }` |
| POST | `/api/webhook` | raw Dodo event | `{ received: true }` |
| GET | `/api/health` | — | `{ status: 'ok', timestamp }` |

`/api/answer-vault/generate` also accepts a legacy `userPrompt` / `prompt`
string instead of the structured body.

**Error shape:** `{ error: "<message>" }` with a status of 400 (bad input),
401 (auth), 403 (no credits), 500 (server/config) or 502 (upstream provider).

## 4. Data flow

### 4.1 Profile data — local only

```text
Dashboard edits ──► profileStore ──► storage.js ──► localStorage
                        │                            (web)
                        │  ONEXTAP_SYNC_DATA
                        ▼
                 service worker ──► chrome.storage.local.user_profile
                                            │
                                            ▼
                                     content script reads it to fill
```

Two stores, kept in step by one message. `storage.js` picks its backend at
module load (`typeof chrome !== 'undefined' && chrome.storage`). It has no
network path — that is what makes the local-only guarantee structural rather
than a policy.

`profileStore.js` keeps the modern `onextap_profiles` store *and* mirrors the
active profile into the flat legacy `user_profile` key on every write,
because the content script and older UI code read that shape.

### 4.2 Credits — server only

Nothing client-side computes a balance. `POST /api/credits/deduct`:

1. Read profile → premium short-circuits to `{ remaining: Infinity }`.
2. `credits <= 0` → `403`.
3. Write `credits - 1`.
4. Insert the `credit_transactions` audit row.
5. **If the audit insert fails, restore the old balance and return 500.**
   Balance and audit log never diverge.

Refund is the same shape in reverse. This is a read-modify-write without a
transaction (see §9, R1).

### 4.3 AI generation

```text
Answer Studio ──► SCRAPE_ACTIVE_TAB ──► worker ──► executeScript(scrapeJobPage)
      │                                                   │
      │◄──────────── { company, description } ◄───────────┘
      │
      ├─ build prompt: question + draft + jobContext(6000 chars)
      │  + profileContext + 3 best-matching vault answers
      │
      └──► POST /api/answer-vault/generate ──► Groq (model chain)
                     │
                     ├─ success ──► deduct 1 credit (first generation only)
                     └─ failure ──► no charge
```

Server-side guards on the response: an empty result, fewer than 8 non-space
characters, or `finish_reason === 'length'` all become errors rather than a
truncated answer shown as success. Non-space counting is deliberate — a word
count mis-scores CJK text as one word.

**Context selection:** `pickRelevantAnswers()` ranks vault entries by word
overlap with the question (words longer than 4 chars) and sends the top 3.
The whole vault is never uploaded.

### 4.4 Page scraping — two copies

`scrapeJobPage()` in `extension/background.js` and `scrapePageContext()` in
`public/content.js` do the same job and cannot call each other: the first is
serialised into the page by `chrome.scripting.executeScript({ func })` and so
may not reference **anything** outside its own body; the second runs from an
injected file. The content-script copy additionally matches
school / university / essay markup. A selector fix in one usually belongs in
the other.

Both: company from `og:site_name` → job-board selectors → last segment of
`document.title`; description from whichever candidate selector yields the
most text, falling back to `document.body`; whitespace collapsed, capped at
8000 characters.

## 5. Security

| Control | Implementation |
|---|---|
| Authentication | Supabase JWT, verified server-side on every protected route |
| Session storage | `localStorage` on web; `chrome.storage.local` in the extension via a custom adapter (service workers have no `localStorage`) |
| Credit integrity | RLS grants users `select` on their own rows only. No insert/update policy on `credit_transactions` ⇒ writable by the service role alone |
| Service-role key | `server/.env` only; never a `VITE_*` name, which would inline it into the shipped bundle |
| Webhook integrity | `standardwebhooks` signature verification over the **raw** body — the route is registered before `express.json()` and must stay there |
| CORS | Allowlist: `CLIENT_URL`, the two onextap.com origins, two localhost ports, and any `chrome-extension://` origin |
| Page access | No blanket `host_permissions`. `activeTab` + explicit `executeScript` on user action |
| Restricted pages | `chrome:`, `chrome-extension:`, `edge:`, `about:` and the Web Store are refused before injection |
| Field allowlist | Autofill fills a listed set of input types only — never password, hidden, file, checkbox or radio |
| Log redaction | Four loggers, matching `SECRET_KEY` / `PII_KEY` regexes, replacing values with `[secret]` / `[redacted]` before printing |
| Content-script logging | Runs in a third-party page, so it logs error names, messages and counts only — never field values or scraped text |
| OAuth (extension) | `chrome.identity.launchWebAuthFlow` against `https://<extension-id>.chromiumapp.org/`, so the popup survives the flow |

### Manifest permissions and why each is needed

| Permission | Purpose |
|---|---|
| `storage` | Local profile + Supabase session |
| `activeTab` | Access to the tab the user invoked the action on |
| `scripting` | On-demand injection of `content.js` and `scrapeJobPage` |
| `identity` | Google OAuth from the popup |
| `host_permissions` | Supabase project, onextap.com, and the two localhost dev ports — API calls, not page access |
| `externally_connectable` | Lets the deployed dashboard message the extension directly |

Widening any of these is an escalation, not a routine change.

## 6. Error handling and resilience

| Failure | Behaviour |
|---|---|
| AI model unavailable / rate-limited / empty / safety-blocked | Fall back to the second model in the chain (`shouldTryFallbackModel`) |
| Gemini returns non-JSON | One repair pass: re-ask at `temperature: 0` for strict JSON, plus a lenient parser that strips fences and trailing commas |
| Generation exceeds 90s | Client-side `withTimeout` rejects with a user-facing message |
| Page scrape exceeds 10s | Generation proceeds untailored; the user is told |
| Credit call exceeds 10s | The answer is kept; the balance error is surfaced |
| Audit-log insert fails | Balance rolled back, 500 returned |
| Dodo unreachable during premium verification | Local `is_premium` is trusted — degrade in the user's favour |
| Webhook signature invalid | `400`, no state change |
| React render throws | `ErrorBoundary` shows a recovery screen with "Copy diagnostics" |
| Uncaught server error | `errorLogger` (registered last) logs and responds instead of Express's HTML stack page |
| Unhandled rejection in the worker | `installWorkerErrorHandlers()` |

## 7. Observability

- **Request ids.** `requestLogger` assigns one per request, sets
  `X-Request-Id`, and logs one line per completed request. Every log line
  inside that request repeats it as `rid`, carried by `AsyncLocalStorage`.
  The service worker logs the id from failed API responses. It is the
  correlation key between a user report and a server log line.
- **Levels.** `LOG_LEVEL` server-side (`info` in production, `debug`
  otherwise); `VITE_LOG_LEVEL` client-side (`warn` in production builds);
  `window.__onextapDebug = true` for the content script.
- **Format.** `LOG_FORMAT=json`, automatic on Vercel, emits one JSON object
  per line for log drains.
- **Client diagnostics.** Recent warnings and errors are held in an in-memory
  ring, dumped by `__onextapIssues()` and by the error screen's copy button.
  Deliberately not persisted.

No metrics, no tracing, no alerting, no analytics.

## 8. Build, configuration and deployment

```bash
npm install && npm run server:install   # root + server dependencies
npm run build                           # extension  → dist/
npm run build:dashboard                 # dashboard  → dist-dashboard/
npm run dev                             # Vite dev server (dashboard only)
npm run server:dev                      # Express with --watch
curl localhost:3001/api/health          # health check
```

A loaded extension does not pick up dev-server changes: rebuild, then reload
at `chrome://extensions/`.

**Client env** (`.env`, all inlined into the bundle — never a secret):
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`,
`VITE_DASHBOARD_URL`, `VITE_ANSWER_STUDIO_MODEL`, `VITE_LOG_LEVEL`.

**Server env** (`server/.env`, secrets): `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`,
`DODO_PAYMENTS_API_KEY`, `DODO_PAYMENTS_WEBHOOK_KEY`, `DODO_PRODUCT_ID`,
`DODO_PAYMENTS_ENVIRONMENT`, plus optional `GROQ_MODEL`,
`GROQ_FALLBACK_MODEL`, `GROQ_MAX_TOKENS` (default 4096, <256 ignored, capped
8192), `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `CLIENT_URL`, `PORT`,
`LOG_LEVEL`, `LOG_FORMAT`.

**Load order is load-bearing.** `server/load-env.js` must stay the first
import in `server/index.js` — `server/supabase.js` and `server/logger.js`
both read `process.env` at module load.

**Vercel.** `vercel.json` runs the dashboard build, serves
`dist-dashboard/`, and rewrites `/api/*` → `api/index.js`, which is a bare
re-export of the Express app. Keep it bare.

**Database.** `supabase/schema.sql` is applied by hand in the SQL editor.
No migration tool, no migration history. It is idempotent but drops and
recreates the `on_auth_user_created` trigger — running it against production
is an escalation.

## 9. Technical risks

| # | Risk | Impact | Note |
|---|---|---|---|
| R1 | Credit deduct is a read-modify-write with no transaction or optimistic lock | Two concurrent generations could both read the same balance and double-spend one credit | Worth a Postgres function with `credits = credits - 1 where credits > 0` |
| R2 | `dodopayments` major-version drift between root and `server/` | Production may run an SDK two majors behind local dev | `createDodoCheckoutSession()` already branches on SDK shape, which suggests this has bitten before |
| R3 | Two scrapers that must stay in step by convention alone | Selector fixes silently apply to one surface | Documented in both files; nothing enforces it |
| R4 | Four loggers whose redaction lists must stay in step | A new PII key redacted in one runtime, leaked in another | Same class of problem as R3 |
| R5 | No tests, no linter | Every regression is found by hand or by a user | The single largest gap in this repo |
| R6 | ~~`OnextapDashboard.jsx` is ~4.4k lines and holds every screen~~ **Resolved** | — | Split into 15 files under `src/components/{shared,popup,dashboard}/`; `OnextapDashboard.jsx` is now the ~67-line `App` root. Never exercised in a browser after the split |
| R7 | Schema applied by hand, no migration history | No way to tell what a given environment is actually running | |
| R8 | Autofill matching is first-keyword-wins over concatenated attributes | A field labelled "Company you're applying to" takes the user's employer | Ordering mitigates, does not solve |
| R9 | `EXTENSION_ID_FALLBACK` is a hardcoded id in `src/config.js` | Dashboard→extension messaging silently fails for a local build opened directly | Passing `?extensionId=` from the popup is the working path |
| R10 | Supabase JWT verified by a network call to `auth.getUser()` on every request | Latency and a hard dependency on Supabase availability for every route | Local JWT verification would remove the round trip |

## 10. Non-negotiables

Restated from `CLAUDE.md` and `AGENTS.md` because they are the rules a change
is most likely to break:

1. `src/` and `server/` never import each other — HTTP only.
2. `extension/background.js` and `public/content.js` import nothing from `src/`.
3. All storage in `src/` goes through `src/storage.js`.
4. All credit and premium access goes through `src/creditManager.js` → server.
5. `server/load-env.js` stays the first import in `server/index.js`.
6. The Dodo webhook stays registered before `express.json()`.
7. Nothing calls `console.*` directly.
8. `scrapeJobPage()` references nothing outside its own body.
9. Profile data is never written to Supabase.
10. No server secret gets a `VITE_*` name.
