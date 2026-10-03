# Repo Structure

How Onextap is laid out, what each area owns, and which directions imports
are allowed to run. This describes the repository as it actually is, not an
aspirational layout.

## What this repository is

One product, shipped as three artifacts from one repository:

- a **Chrome MV3 extension** (`dist/`, built by `vite.config.js`): a React
  popup, a service worker and a content script;
- a **website** (`dist-dashboard/`, built by `vite.dashboard.config.js`,
  deployed by Vercel): the landing page at `/` and the dashboard at
  `/dashboard/`, both plain JS (no React) under `web/`;
- an **Express backend** (`server/`, run standalone in dev, served by Vercel as
  a function under `/api/`).

The website and the API share one origin, and so do the landing page and the
dashboard: that is what carries a sign-in on the landing page straight into
the dashboard (the Supabase session lives in `localStorage`, which is per
origin).

The popup and the web dashboard are **two separate front ends** over the same
data modules. Until the website was rebuilt, the dashboard and the popup were
one React app that picked its surface at runtime; now the popup is the only
React code, and the web dashboard imports the modules in `src/` it needs
(profile and resume stores, auth, credits, matching) through the `@app` alias.
The build script and output folder of the website (`build:dashboard`,
`dist-dashboard/`) keep their names from when it built only the dashboard, so
the Vercel project needs no change.

## Layout

```text
.
├── AGENTS.md                  # Front door for agents
├── CLAUDE.md                  # Hot memory (Tier 1) — always loaded
├── README.md                  # Human setup + API reference
├── HANDOVER.md                # State of the website merge and its open items
├── docs/
│   ├── repo-structure.md      # This file
│   ├── app-flow.md            # What happens, screen by screen
│   └── plans/{active,completed}/
├── memory/                    # Agent memory tiers 2–4
├── extension/                 # Chrome-extension-only source
│   ├── manifest.json          # MV3 manifest: permissions, host permissions,
│   │                          #   externally_connectable, service worker
│   ├── background.js          # Service worker: profile sync, resume +
│   │                          #   answer proxying, active-tab scraping
│   ├── profileSync.js         # Files a dashboard profile into the extension's
│   │                          #   profile store (pure; the worker writes it)
│   ├── logger.js              # Service-worker logger (no window, no DOM)
│   └── constants.js           # COUNTRIES / GENDERS option lists
├── public/                    # Copied verbatim into the extension build
│   ├── content.js             # Content script: autofill + page scraping,
│   │                          #   injected on demand
│   └── icon.png
├── index.html                 # The popup's HTML entry (extension build only)
├── src/                       # The popup (React) + the modules the website shares
│   ├── popup.jsx              # Popup entry; mounts App from OnextapDashboard.jsx.
│   │                          #   Opened outside the extension (or with the old
│   │                          #   ?mode=dashboard), it goes to the web dashboard
│   ├── components/            # React — rendered in the popup only
│   │   ├── OnextapDashboard.jsx  # App root: the popup and its splash screen
│   │   ├── ErrorBoundary.jsx     # Catches render errors; "copy diagnostics"
│   │   ├── shared/            # Name kept from the React dashboard; popup-only now
│   │   │   ├── Toast.jsx
│   │   │   ├── ProfileSwitcher.jsx
│   │   │   ├── FabricationNotice.jsx  # Advisory "this claim isn't in your
│   │   │   │                          #   resume" panel; never blocks
│   │   │   └── CoverLetterPanel.jsx
│   │   └── popup/
│   │       ├── PopupView.jsx
│   │       └── WhatToFillSection.jsx
│   ├── matching/              # PURE SANDBOX — imports nothing outside itself
│   │   ├── index.js           #   barrel; MATCHER_VERSION lives here
│   │   ├── normalize.js       #   HTML strip, tokenize, n-grams, trigrams
│   │   ├── stopwords.js       #   STOPWORDS / PHRASE_BREAKERS / NEVER_EMIT
│   │   ├── lexicon.js         #   ~570 curated skills, aliases, seniority
│   │   ├── extractKeywords.js #   required-vs-nice header state machine
│   │   ├── prefilter.js       #   cheap candidate selection before the LLM
│   │   ├── fallbackScore.js   #   keyword scorer — the degraded path
│   │   └── fabrication.js     #   deterministic hallucination check, 0 LLM
│   ├── corpus.js              # Addressable CV items (`exp.0.bullet.1`) — the
│   │                          #   grounding the validator diffs against
│   ├── fabricationCorpus.js   # Loads that grounding for the fabrication notice
│   │                          #   (popup and web dashboard)
│   ├── resumeStore.js         # Local resume library (`onextap_resumes`)
│   ├── resumeParse.js         # Upload transport: base64 → PARSE_RESUME → parse
│   ├── resumeToProfile.js     # Parsed resume → profile fields
│   ├── jobsApi.js             # Job ranking / explain / pool API client
│   ├── config.js              # API_URL, DASHBOARD_URL/PATH, SITE_URL, extension id, model
│   ├── extensionClient.js     # getExtensionId / getIconUrl / openChromeWebStore
│   ├── profileDefaults.js     # DEFAULT_PROFILE, RACES, VETERAN_STATUS
│   ├── answerStudio.js        # AI style presets, timeout budgets, withTimeout
│   ├── autofillSections.js    # Autofill section list + default toggles
│   ├── auth.js                # Supabase auth helpers (+ chrome.identity OAuth)
│   ├── supabaseClient.js      # Supabase client; chrome.storage session adapter
│   ├── creditManager.js       # Credit/premium/account API client (server-verified)
│   ├── logger.js              # Client logger + global error handlers
│   ├── storage.js             # chrome.storage.local ⟷ localStorage ⟷ memory
│   ├── profileStore.js        # Multi-profile store + legacy-shape migration
│   ├── applicationTypes.js    # job / college / scholarship / internship config
│   ├── applicationTypeStorage.js
│   ├── consent.js             # Analytics consent gate — unused, kept on purpose
│   └── index.css              # The popup's Tailwind entry
├── web/                       # The website (Vite root of vite.dashboard.config.js)
│   ├── index.html             # Landing page; its <head> forwards old dashboard links
│   ├── about/ contact/ privacy/   # Company pages (index.html each)
│   ├── src/                   # The landing page (from DEMO_WEB)
│   │   ├── main.js            #   entry: mounts every feature, then the stage
│   │   ├── app/               #   stage, chapters, mount; backend.js + wire.js
│   │   │                      #   are the landing's line to the account and API
│   │   ├── features/          #   one folder per section or window (html + css + js)
│   │   ├── pages/             #   the company pages' content and script
│   │   └── shared/            #   styles, motion, dialog, fx
│   ├── dashboard/             # The dashboard (from DEMO_DASH)
│   │   ├── index.html
│   │   ├── css/               #   tokens, the shell, the workspaces
│   │   ├── js/
│   │   │   ├── main.js        #   entry: session check, shell, routing
│   │   │   ├── services.js    #   the backend boundary: session, account, plan,
│   │   │   │                  #   avatar, extension sync
│   │   │   ├── workspaces.js  #   mounts the four workspaces
│   │   │   ├── ws/            #   job-matches, my-profiles, answer-studio, cover-letter
│   │   │   ├── ui/            #   dom builder, controls, switchers, file drop,
│   │   │   │                  #   fabrication notice
│   │   │   └── settings.js subscription.js tour.js dock.js …
│   │   ├── site/              #   the dashboard's variants of the company pages
│   │   └── contact/ privacy/  #   /dashboard/contact/, /dashboard/privacy/
│   ├── public/                # Copied verbatim into the website build
│   ├── tests/                 # Landing e2e (Playwright); stubs.js stands in
│   │                          #   for Supabase and the API
│   └── playwright.config.js
├── server/                    # Express backend (own package.json + node_modules)
│   ├── index.js               # Every API route (~2.6k lines)
│   ├── logger.js              # Structured logs, request ids, error middleware
│   ├── supabase.js            # Service-role admin client + requireAuth middleware
│   ├── load-env.js            # Loads server/.env regardless of cwd
│   ├── cronAuth.js            # requireCronSecret — fail-closed, timing-safe
│   ├── llmJson.js             # Lenient JSON extraction from model output
│   ├── groqClient.js          # Groq client + model fallback chain
│   ├── observability/opik.js  # Tracing wrapper; no-ops with no OPIK_API_KEY
│   ├── jobs/
│   │   ├── adapters/          # One per source; fetch() NEVER throws
│   │   │   ├── index.js       #   the cascade, in order
│   │   │   ├── adzuna.js      #   keyed; snippet descriptions only
│   │   │   ├── ats.js         #   Greenhouse / Lever / Ashby boards; full postings
│   │   │   ├── remotive.js arbeitnow.js remoteok.js jobicy.js himalayas.js
│   │   │   │                  #   keyless boards
│   │   │   ├── wellfound.js   #   not in the cascade
│   │   │   ├── cache.js       #   offline fixtures; OFF in production
│   │   │   └── httpJson.js    #   shared timeout + status→reason mapping
│   │   ├── ingest.js          # Daily cron run: budget, cursor, upsert
│   │   ├── normalizeListing.js# Raw listing → DB row (+ keyword extraction)
│   │   ├── searchTerms.js     # The occupation taxonomy the ingest cursor walks
│   │   ├── query.js           # Pool reads; never selects `description`
│   │   ├── rank.js            # Batched LLM scoring (RANK_BATCH_SIZE)
│   │   ├── graph.js           # prefilter → rank → gate → reformulate (≤2)
│   │   ├── rankCache.js       # Result cache + rate limit; memory or Supabase
│   │   └── prompts/           # Versioned prompt library (index.js owns versions)
│   ├── data/                  # Gitignored. cache.js expects cached_jobs.json
│   │                          #   here (synthetic fixtures); it was never committed
│   └── .env                   # Server secrets — gitignored
├── test/                      # `npm test` (node --test). NOT under src/, so
│   │                          #   Vite can never bundle it.
│   ├── matching/ corpus/ resume/ jobs/ observability/ server/ extension/
│   └── evals/                 # `npm run evals` — accuracy + fabrication gates
├── scripts/                   # One-off data repairs (backfills)
├── api/index.js               # Vercel serverless entry: re-exports the Express app
├── supabase/
│   ├── schema.sql             # Tables, RLS policies, sign-up trigger
│   └── migrations/            # New statements only, for pasting by hand —
│                              #   schema.sql must never be re-run on prod
├── vite.config.js             # Extension build → dist/
├── vite.dashboard.config.js   # Website build  → dist-dashboard/ (dev server on 5173)
├── vercel.json                # Runs the website build; rewrites /api/* → api/index.js
├── tailwind.config.js         # The popup only
└── postcss.config.js          # The popup only (the website build opts out)
```

`dist/`, `dist-dashboard/`, `test-results/` and `playwright-report/` are build
or test output and are gitignored. Never edit them; never import from them.

## Dependency rules

Arrows point from importer to imported. Anything not listed is not allowed
without a deliberate decision.

```text
api/index.js ──► server/index.js ──► server/supabase.js
                        │        └──► server/{cronAuth,llmJson,groqClient}.js
                        │        └──► server/jobs/*  ──► server/observability/opik.js
                        │
                        └──► server/load-env.js   (must be the FIRST import)

The popup (extension build):

  src/popup.jsx ──► src/components/OnextapDashboard.jsx     (App root)
                          └──► src/components/popup/PopupView.jsx
  PopupView ──► popup/WhatToFillSection.jsx
            └──► shared/{Toast,ProfileSwitcher,CoverLetterPanel,FabricationNotice}.jsx

The website (website build), through the @app alias (→ src/):

  web/dashboard/js/** ──► @app/{profileStore,resumeStore,resumeParse,resumeToProfile,
                                auth,supabaseClient,creditManager,jobsApi,storage,
                                config,extensionClient,answerStudio,applicationTypes,
                                profileDefaults,fabricationCorpus,logger}.js
                     └──► @app/matching/index.js
                     └──► extension/constants.js   (my-profiles.js: COUNTRIES, GENDERS)
  web/dashboard/site/** ──► web/src/{features,shared,app,pages}/…   (the landing's own
                                                                     pieces, reused)
  web/src/app/backend.js ──► @app/config.js, @app/auth.js (loaded on first sign-in)

Leaf modules in src/:

  src/auth.js ──► src/supabaseClient.js
  src/creditManager.js ──► src/auth.js
  src/profileStore.js ──► src/storage.js
  src/resumeStore.js  ──► src/storage.js
                     └──► src/corpus.js ──► src/matching/normalize.js
                     └──► src/matching/index.js
  src/resumeParse.js  ──► src/extensionClient.js
  src/resumeToProfile.js ──► extension/constants.js
  src/jobsApi.js      ──► src/{auth,config,answerStudio}.js
  src/applicationTypeStorage.js ──► src/storage.js
                               └──► src/applicationTypes.js
  src/extensionClient.js ──► src/config.js
  src/{config,profileDefaults,answerStudio,autofillSections}.js   (no deps)

  src/matching/**        — imports NOTHING outside itself. See rule 10.

THE ONE CROSS-BOUNDARY IMPORT INTO THE SERVER:

  server/index.js            ──┐
  server/jobs/graph.js       ──┼──► src/matching/index.js
  server/jobs/rank.js        ──┤
  server/jobs/normalizeListing.js ─┘

extension/background.js   — imports only extension/{logger,profileSync}.js.
public/content.js         — standalone. Imports nothing at all.
```

### The rules behind that graph

1. **The front ends and `server/` communicate over HTTP, with one deliberate
   exception.** The contract is a Supabase JWT in `Authorization: Bearer
   <token>`; the client half lives in `src/creditManager.js`, `src/jobsApi.js`,
   `src/resumeParse.js` (through the service worker in the extension), the
   inline `fetch` calls in `shared/CoverLetterPanel.jsx` and in
   `web/dashboard/js/ws/{answer-studio,cover-letter}.js`, and the landing's
   unauthenticated feedback post in `web/src/app/backend.js`.

   The exception: **`server/` imports `src/matching/index.js`** — from
   `server/index.js` and three files under `server/jobs/`. Keyword extraction
   has to produce byte-identical results on both sides or a job's stored
   keywords would not match the ones the client scores against, and two copies
   of a 570-entry lexicon would drift the way the two page scrapers do. So it
   is imported rather than duplicated, which is only safe because of rule 10.

   **The arrow runs one way only.** Nothing in `src/` or `web/` may import
   from `server/` — `server/` is a separate package with its own
   `node_modules`, and its modules read `process.env` at load.

2. **`extension/background.js` and `public/content.js` import nothing from
   `src/`.** The service worker and the content script run in isolated
   worlds with their own lifecycles. They talk to the app over
   `chrome.runtime` messaging, not through shared modules. Duplication
   between them and `src/` is deliberate, not an oversight: the worker's
   `extension/profileSync.js` restates the profile store's shape from
   `src/profileStore.js`, and `test/extension/profileSync.test.js` holds the
   two together.

3. **`src/` and `web/` may import `extension/constants.js`, and only that.**
   `src/resumeToProfile.js` pulls `COUNTRIES`, and
   `web/dashboard/js/ws/my-profiles.js` pulls `COUNTRIES` and `GENDERS`.
   Adding a second file from `extension/` should be a conscious decision;
   anything with behavior belongs in `src/` instead.

4. **Profile and resume data go through `src/storage.js`.** No module in
   `src/` touches `chrome.storage` or `localStorage` directly — the wrapper is
   what lets the same stores run in the popup (`chrome.storage.local`), on the
   website (`localStorage`) and under `node --test` (memory).
   (`supabaseClient.js` is the deliberate exception: it needs its own
   `chrome.storage` session adapter, which is what `storage.js` would
   otherwise depend on.) On the website, three places use `localStorage`
   directly on purpose: the dashboard's own UI state
   (`web/dashboard/js/util.js`), the landing's "is anyone signed in?" check,
   which reads Supabase's session key without loading its SDK
   (`web/src/app/backend.js`), and sign-out and account deletion, which clear
   keys (`web/dashboard/js/services.js`).

5. **All credit and premium reads/writes go through `src/creditManager.js`**,
   which goes through the server. Nothing client-side computes a balance.

6. **`server/load-env.js` must stay the first import in `server/index.js`.**
   Module-level code in `server/supabase.js` reads `process.env` at import
   time; reordering silently produces a client with no credentials.

7. **`api/index.js` is the only file that imports the Express app.** It
   exists purely so Vercel can serve `server/index.js` as a function. Keep
   it a re-export — no routes, no middleware.

8. **Nothing calls `console.*` directly.** Each runtime logs through its own
   logger, and the four are deliberately separate because none of them can
   import the others:

   | Runtime | Logger | Why it cannot share |
   |---|---|---|
   | Express backend | `server/logger.js` | Node-only; uses `AsyncLocalStorage` for request ids |
   | Popup and website | `src/logger.js` (the website through `@app`) | Browser; must not import `server/` |
   | Service worker | `extension/logger.js` | No `window`; must not import `src/` |
   | Content script | inline, top of `public/content.js` | Copied verbatim — cannot import at all |

   The redaction key lists are the part that must stay in step, the same way
   the two page scrapers must. `server/logger.js` must be imported *after*
   `./load-env.js` — it reads `LOG_LEVEL` at module load.

9. **`src/components/` is the popup's, and only the popup's.** The web
   dashboard cannot use a React component, so anything both front ends need
   is a plain module in `src/` — which is why `loadFabricationCorpus` moved out
   of `FabricationNotice.jsx` into `src/fabricationCorpus.js`.
   `components/shared/` keeps its name from when a React dashboard rendered it
   too. `src/popup.jsx` sends anything opened outside the extension
   (including the old `?mode=dashboard`) to the web dashboard.

10. **`src/matching/**` and `src/corpus.js` import nothing outside themselves.**
    Not `../logger.js`, not `../config.js`, not `../storage.js`, no npm
    package, no `node:` builtin. `src/corpus.js` may import
    `./matching/normalize.js` and nothing else.

    This is what lets three very different runtimes share one copy: the browser
    bundles, the Express server (rule 1), and bare Node under `node --test`.
    The constraint is specifically about *bare Node* — `src/config.js` reads
    `import.meta.env` at module scope, which is `undefined` outside Vite and
    throws a `TypeError` on import. One stray convenience import would take the
    whole test suite down with it, and the failure would look like a Node
    problem rather than an import problem.

    Enforced, not just documented: `test/matching/no-side-imports.test.js`
    reads every file in those paths off disk and fails on any specifier that
    escapes. Add a `log.debug` there and the suite goes red.

11. **The profile and resume pickers are siblings, not a shared
    abstraction.** "Type a name and get an empty thing" and "pick a file and
    wait for a network round trip that can fail" are different affordances with
    different failure modes. Merging them produces a props-driven mode switch
    wearing reuse as a disguise. On the web dashboard they are
    `profileSwitcher()` and `resumeSwitcher()` in
    `web/dashboard/js/ui/switchers.js`, sharing only the dropdown chrome; the
    popup has `ProfileSwitcher.jsx` alone. If you change one, read the other
    and decide deliberately.

12. **The landing page stays as designed.** `web/src/` came from the DEMO_WEB
    repo and is kept as it was built: behavior is wired in from outside
    (`web/src/app/backend.js` hands `features/login` its `signIn` and
    `features/feedback` its `send`; `web/src/app/wire.js` gives the buttons
    somewhere to go) rather than by rewriting the features. The dashboard's
    company pages (`web/dashboard/site/`) are built from the landing's own
    pieces for the same reason.

## Where a change belongs

| Change | Goes in |
|---|---|
| New API route or server logic | `server/index.js` |
| Auth middleware, admin DB access | `server/supabase.js` |
| A workspace on the web dashboard | `web/dashboard/js/ws/` (styles in `web/dashboard/css/workspaces.css`) |
| The dashboard's shell: session, settings, plan panel, tour | `web/dashboard/js/{main,services,settings,subscription,tour}.js` |
| What the landing page's buttons and sign-in do | `web/src/app/{backend,wire}.js` |
| The landing page's look or content | `web/src/features/` — it keeps DEMO_WEB's design (rule 12) |
| A screen in the extension popup | `src/components/popup/` |
| Data or logic both front ends need | a plain module in `src/` (rule 9) |
| Persisted local state | `src/storage.js` + a store module in `src/` |
| Credit / premium behavior | `server/index.js`, surfaced via `src/creditManager.js` |
| Autofill or field matching on a page | `public/content.js` |
| Service-worker proxying, tab scraping, profile sync | `extension/background.js` (+ `extension/profileSync.js`) |
| Permissions, host permissions, worker registration | `extension/manifest.json` |
| Tables, RLS, triggers | `supabase/schema.sql`, plus a new file in `supabase/migrations/` — that file is what gets pasted; never re-run `schema.sql` against prod |
| Keyword extraction, scoring, the skill lexicon | `src/matching/` — shared by client *and* server, so rule 10 applies |
| Resume claim grounding (`corpusRef`) | `src/corpus.js` |
| A new job board | a file in `server/jobs/adapters/` + one line in its `index.js` |
| Ranking behaviour — batch size, the gate, reformulation | `server/jobs/graph.js` |
| Prompt wording | `server/jobs/prompts/*.md` — **and bump its version in `index.js`** |
| What gets traced | `server/observability/opik.js` |
| A new log line | the logger for that runtime — never `console.*` |
| A field that must never be logged | the `SECRET_KEY` / `PII_KEY` lists in all four loggers |
| Redirects, the cron, the build Vercel runs | `vercel.json` |

## Two builds, shared modules

`npm run build` produces the extension into `dist/`, from `index.html` →
`src/popup.jsx`. `npm run build:dashboard` produces the website into
`dist-dashboard/`, from the pages under `web/`, and that second command is
what `vercel.json` runs on deploy. `npm run dev` serves the website on port
5173, the one local origin `extension/manifest.json` lets talk to the
extension; `npm run dev:extension` is the extension's dev server.

A change to a module in `src/` that the website imports (the list under
"Dependency rules") ships to **both** front ends. Confirm it works with
`chrome.*` present (the popup) and absent (the website) before calling it
done. A change under `src/components/` ships to the popup alone, and one under
`web/` to the website alone.
