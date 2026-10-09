# Hot Memory — Onextap

Tier 1. Always loaded, so keep it under 2,000 tokens. Everything else lives
in `memory/` and `docs/` and is read on demand.

## Project

Onextap: a Chrome MV3 extension that autofills job applications, plus a
website and an Express backend on one origin (landing `/`, dashboard
`/dashboard/`, API `/api/`). The popup is React (`src/`); the website is plain
JS (`web/`) importing `src/` modules via `@app`. Supabase holds accounts and
billing only. Layout and import rules: `docs/repo-structure.md`; merge
status: `HANDOVER.md`.

## Always

1. Always rebuild and reload after touching `src/`, `extension/`, or
   `public/`: `npm run build`, then reload at `chrome://extensions/`. A
   loaded extension does not pick up dev-server changes.
2. Always verify a change to a `src/` module the website imports on both
   front ends: `chrome.*` present (popup) and absent (website). Guards look
   like `typeof chrome !== 'undefined' && chrome?.runtime`.
3. Always guard credit values with `Number.isFinite()` before comparing or
   rendering. Premium accounts report `Infinity`, not a number.
4. Always keep the Dodo webhook registered *before* `express.json()` in
   `server/index.js`. It needs the raw body for signature verification;
   moving it silently breaks payment webhooks in production only.
5. Always mirror scraper selector fixes across both copies:
   `scrapeJobPage()` in `extension/background.js` and `scrapePageContext()`
   in `public/content.js`. They cannot call each other and drift silently.

## Never

6. Never adjust credits or premium status client-side. Every change goes
   through the authenticated server routes; RLS makes `credit_transactions`
   writable only by the service role. That is the anti-tamper design.
7. Never put a server secret behind a `VITE_*` name. Everything `VITE_*` is
   inlined into the shipped bundle. `SUPABASE_SERVICE_ROLE_KEY`,
   `GROQ_API_KEY`, `GEMINI_API_KEY` and the Dodo keys are `server/.env` only.
8. Never *persist* profile data (personal details, saved answers, cover
   letters) anywhere but the device: `chrome.storage.local` in the extension,
   `localStorage` on the web, synced over `ONEXTAP_SYNC_DATA`. Never to
   Supabase. Local storage is not non-disclosure, and do not write comments
   claiming it is: resume text goes to Gemini and Groq transiently per
   request, and Opik **retains** the traces it records. A new destination for
   profile data is an escalation, and the privacy page
   (`web/src/pages/privacy/privacy.html`, served at `/privacy/`) has to say so
   before it ships.
9. Never reference anything outside its own body inside `scrapeJobPage()`
   (`extension/background.js`). It is serialized into the target page by
   `chrome.scripting.executeScript({ func })`; a closure variable or import
   throws in the page, not at build time.
10. Never commit `.env` or `server/.env`, and never echo their contents into
    output. Both are gitignored and hold live keys.
11. Never call `console.*` directly. Use the logger for the surface you are in
    (see Key facts). They redact secrets and profile data before printing;
    a raw `console.log` of a profile or a token defeats rules 7 and 8.

## Commands

- Install: `npm install && npm run server:install`
- Build extension → `dist/`: `npm run build` (needs `.env` first)
- Build website → `dist-dashboard/`: `npm run build:dashboard`
- Website dev server: `npm run dev` (keep :5173, the only local origin
  `externally_connectable` allows); extension's: `npm run dev:extension`
- Backend with reload: `npm run server:dev`
- Health check: `curl localhost:3001/api/health`
- Verbose server logs: `LOG_LEVEL=debug npm run server:dev`
  (levels: error/warn/info/debug; client side uses `VITE_LOG_LEVEL`)
- **Test: `npm test`** (`node --test`) — matching, corpus, the stores,
  credit rules, server modules, the worker's profile sync.
- **E2E: `npm run test:e2e`** — landing + company pages, and the dashboard's
  cover-letter credits, against stubs.
- **E2E, extension loaded: `npm run test:e2e:extension`** — dashboard →
  extension profile sync, popup autofill, popup cover-letter credits, against
  stubs. Needs port 5173 free.
- **Lint: none.** There is no ESLint or Prettier config.

Nothing else automated drives the dashboard or the popup, nor real
services. There, "verified" means you built it and exercised the path in the
browser. Say so plainly when you have not.

## Key facts

- Two builds. `vite.config.js` → extension (popup from `index.html`);
  `vite.dashboard.config.js` → the whole website from `web/`, and that second
  one is what `vercel.json` runs on deploy (the script keeps its old name,
  `build:dashboard`).
- `api/index.js` re-exports the Express app so Vercel serves it as a
  function. Keep it a bare re-export.
- `server/load-env.js` must stay the first import in `server/index.js`;
  `server/supabase.js` reads `process.env` at module load.
- `job_listings` is the only table in Supabase holding shared *content* rather
  than per-account rows — ingested postings, no `user_id`. (`job_ingest_state`
  is also user-less, but it is an ingest cursor, not data.) Everything else is
  keyed to a user, and no table holds profile data — see rule 8.
- `supabase/schema.sql` is applied by hand in the Supabase SQL Editor. There
  is no migration tool and no migration history. The file is idempotent, but
  it drops and recreates the `on_auth_user_created` trigger, so use the
  numbered files in `supabase/migrations/` against an existing project and
  keep `schema.sql` for bootstrapping a fresh one.
- `supabase/migrations/README.md` is the only record of which migrations have
  actually been applied to which project. Read it before assuming a table
  exists; update it in the same commit as the apply. A missing `job_listings`
  traced back to exactly this gap.
- `server/` has its own `package.json` and `node_modules`; root deps are
  duplicated there for the Vercel build.
- Four loggers, one per runtime, because the runtimes cannot share code:
  `server/logger.js` (adds request ids), `src/logger.js` (popup and website),
  `extension/logger.js` (service worker), and an inline one at the top of
  `public/content.js` (that file cannot import). Their redaction key lists
  mirror each other — a change to one usually belongs in the others.
- Every server response carries `X-Request-Id`. It is the correlation key
  between a user's report and a log line; the service worker logs it on
  failed calls.

## Escalate

Stop and ask before:

- Running anything against the production Supabase project, including
  re-running `supabase/schema.sql`.
- Changing credit amounts, pricing, webhook handling, or premium gating.
- Adding or widening `permissions` / `host_permissions` /
  `externally_connectable` in `extension/manifest.json`.
- Deleting user profile data or changing the `user_profile` ⟷
  `onextap_profiles` handling: the migration in `src/profileStore.js`, or the
  worker's sync in `extension/profileSync.js`.
- Publishing to the Chrome Web Store or deploying to Vercel.

## Unverified — confirm before relying on these

- **Branching.** History is on `main`; the website merge is on
  `merge/web-dashboard`, pushed to `github.com/UncannySteel/OneXtap-latest`
  (remote `latest`, where it is the default branch); `origin` is the backend's
  repo. No "never commit to main" rule is written here. Add one if that is the
  intent.
- **Node version.** README says Node 18+ (21+ for `npm test`'s glob); there
  is no `engines` field.

(`EXTENSION_ID_FALLBACK` in `src/config.js` was listed here; it is the
published extension's ID, the one in `CHROME_WEB_STORE_URL`. An unpacked
build gets a different ID, so open the dashboard from its popup.)

---

Review monthly. Rules that never prevent a mistake should be cut.
