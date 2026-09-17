# Repo Structure

How Onextap is laid out, what each area owns, and which directions imports
are allowed to run. This describes the repository as it actually is, not an
aspirational layout.

## What this repository is

One product shipped as three artifacts built from one source tree:

- a **Chrome MV3 extension** (`dist/`, built by `vite.config.js`)
- a **web dashboard** (`dist-dashboard/`, built by `vite.dashboard.config.js`, deployed by Vercel)
- an **Express backend** (`server/`, run standalone in dev, wrapped as a Vercel serverless function in production)

The dashboard and the extension popup are *the same React app*. It detects
at runtime whether `chrome.*` is available and adapts. There is no separate
popup codebase.

## Layout

```text
.
├── AGENTS.md                  # Front door for agents
├── CLAUDE.md                  # Hot memory (Tier 1) — always loaded
├── README.md                  # Human setup + API reference
├── docs/
│   ├── repo-structure.md      # This file
│   └── plans/{active,completed}/
├── memory/                    # Agent memory tiers 2–4
│   ├── episodic/              # Task logs
│   ├── semantic/              # Project knowledge
│   └── procedural/            # Step-by-step procedures
├── extension/                 # Chrome-extension-only source
│   ├── manifest.json          # MV3 manifest: permissions, host permissions,
│   │                          #   externally_connectable, service worker
│   ├── background.js          # Service worker: profile sync, resume +
│   │                          #   answer proxying, active-tab scraping
│   ├── logger.js              # Service-worker logger (no window, no DOM)
│   └── constants.js           # COUNTRIES / GENDERS option lists
├── public/                    # Copied verbatim into the build
│   ├── content.js             # Content script: autofill + page scraping,
│   │                          #   injected on demand
│   └── icon.png
├── src/                       # React app (dashboard + popup, one app)
│   ├── popup.jsx              # Entry point; mounts App from OnextapDashboard.jsx
│   ├── components/
│   │   ├── OnextapDashboard.jsx  # App root only: picks the surface, shows the splash
│   │   ├── ErrorBoundary.jsx     # Catches render errors; "copy diagnostics"
│   │   ├── shared/            # Rendered by BOTH surfaces
│   │   │   ├── Toast.jsx
│   │   │   ├── ProfileSwitcher.jsx
│   │   │   ├── ResumeSwitcher.jsx     # Sibling of ProfileSwitcher, not a
│   │   │   │                          #   generalisation — see rule 11
│   │   │   ├── FabricationNotice.jsx  # Advisory "this claim isn't in your
│   │   │   │                          #   resume" panel; never blocks
│   │   │   └── CoverLetterPanel.jsx
│   │   ├── popup/             # Extension popup only
│   │   │   ├── PopupView.jsx
│   │   │   └── WhatToFillSection.jsx
│   │   └── dashboard/         # Web dashboard only
│   │       ├── DashboardView.jsx      # Owns auth + tab state for the dashboard
│   │       ├── ProfilesPage.jsx
│   │       ├── VaultPage.jsx
│   │       ├── CoverLetterPage.jsx
│   │       ├── JobMatchesPage.jsx     # Resume → ranked jobs, filters, run footer
│   │       ├── OverviewPage.jsx
│   │       ├── PublicLandingPage.jsx
│   │       ├── AccountSettingsModal.jsx
│   │       ├── PremiumModal.jsx
│   │       └── TourOverlay.jsx        # also named-exports TOUR_STEPS
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
│   ├── resumeStore.js         # Local resume library (`onextap_resumes`)
│   ├── resumeParse.js         # Upload transport: base64 → PARSE_RESUME → parse
│   ├── jobsApi.js             # Job ranking / explain / pool API client
│   ├── config.js              # API_URL, DASHBOARD_URL, extension id, model name
│   ├── extensionClient.js     # getExtensionId / getIconUrl / openChromeWebStore
│   ├── profileDefaults.js     # DEFAULT_PROFILE, RACES, VETERAN_STATUS
│   ├── answerStudio.js        # AI style presets, timeout budgets, withTimeout
│   ├── autofillSections.js    # Autofill section list + default toggles
│   ├── auth.js                # Supabase auth helpers (+ chrome.identity OAuth)
│   ├── supabaseClient.js      # Supabase client; chrome.storage session adapter
│   ├── creditManager.js       # Credit/premium API client (server-verified)
│   ├── logger.js              # Client logger + global error handlers
│   ├── storage.js             # chrome.storage.local ⟷ localStorage ⟷ memory
│   ├── profileStore.js        # Multi-profile store + legacy-shape migration
│   ├── applicationTypes.js    # job / college / scholarship / internship config
│   ├── applicationTypeStorage.js
│   └── index.css
├── server/                    # Express backend (own package.json + node_modules)
│   ├── index.js               # Every API route (~1.8k lines)
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
│   │   │   ├── remotive.js    #   keyless; full descriptions + tags
│   │   │   ├── wellfound.js   #   registered but disabled — no public API
│   │   │   ├── cache.js       #   offline fixtures; OFF in production
│   │   │   └── httpJson.js    #   shared timeout + status→reason mapping
│   │   ├── ingest.js          # Daily cron run: budget, cursor, upsert
│   │   ├── normalizeListing.js# Raw listing → DB row (+ keyword extraction)
│   │   ├── query.js           # Pool reads; never selects `description`
│   │   ├── rank.js            # Batched LLM scoring (BATCH_SIZE 5)
│   │   ├── graph.js           # prefilter → rank → gate → reformulate (≤2)
│   │   ├── rankCache.js       # Result cache + rate limit; memory or Supabase
│   │   └── prompts/           # Versioned prompt library (index.js owns versions)
│   ├── data/cached_jobs.json  # Synthetic fixtures — never served in production
│   └── .env                   # Server secrets — gitignored
├── test/                      # `npm test` (node --test). NOT under src/, so
│   │                          #   Vite can never bundle it.
│   ├── matching/ corpus/ resume/ jobs/ observability/ server/
│   └── evals/                 # `npm run evals` — accuracy + fabrication gates
├── api/index.js               # Vercel serverless entry: re-exports the Express app
├── supabase/
│   ├── schema.sql             # Tables, RLS policies, sign-up trigger
│   └── migrations/            # New statements only, for pasting by hand —
│                              #   schema.sql must never be re-run on prod
├── index.html                 # HTML entry for both builds
├── vite.config.js             # Extension build     → dist/
├── vite.dashboard.config.js   # Dashboard build     → dist-dashboard/
├── vercel.json                # Runs the dashboard build; rewrites /api/* → api/index.js
├── tailwind.config.js
└── postcss.config.js
```

`dist/` and `dist-dashboard/` are build outputs and are gitignored. Never
edit them; never import from them.

## Dependency rules

Arrows point from importer to imported. Anything not listed is not allowed
without a deliberate decision.

```text
api/index.js ──► server/index.js ──► server/supabase.js
                        │        └──► server/{cronAuth,llmJson,groqClient}.js
                        │        └──► server/jobs/*  ──► server/observability/opik.js
                        │
                        └──► server/load-env.js   (must be the FIRST import)

src/popup.jsx ──► src/components/OnextapDashboard.jsx        (App root)
                        │
                        ├──► src/components/popup/PopupView.jsx
                        └──► src/components/dashboard/DashboardView.jsx

DashboardView ──► the nine other dashboard/ components
              └──► shared/Toast.jsx
PopupView     ──► popup/WhatToFillSection.jsx
              └──► shared/{Toast,ProfileSwitcher,CoverLetterPanel}.jsx

Leaf modules, imported by the components above:

  src/auth.js ──► src/supabaseClient.js
  src/creditManager.js ──► src/auth.js
  src/profileStore.js ──► src/storage.js
  src/resumeStore.js  ──► src/storage.js
                     └──► src/corpus.js ──► src/matching/normalize.js
                     └──► src/matching/index.js
  src/resumeParse.js  ──► src/extensionClient.js
  src/jobsApi.js      ──► src/{auth,config,answerStudio}.js
  src/applicationTypeStorage.js ──► src/storage.js
                               └──► src/applicationTypes.js
  src/extensionClient.js ──► src/config.js
  src/{config,profileDefaults,answerStudio,autofillSections}.js   (no deps)

  src/matching/**        — imports NOTHING outside itself. See rule 10.

THE ONE CROSS-BOUNDARY IMPORT:

  server/index.js            ──┐
  server/jobs/graph.js       ──┼──► src/matching/index.js
  server/jobs/rank.js        ──┤
  server/jobs/normalizeListing.js ─┘

  extension/constants.js ◄── dashboard/ProfilesPage.jsx   (the one src → extension import)

extension/background.js   — standalone. Imports nothing from src/.
public/content.js         — standalone. Imports nothing at all.
```

### The rules behind that graph

1. **`src/` and `server/` communicate over HTTP, with one deliberate
   exception.** The contract is a Supabase JWT in `Authorization: Bearer
   <token>`; the client half lives in `src/creditManager.js`, `src/jobsApi.js`
   and the inline `fetch` calls in `dashboard/ProfilesPage.jsx`,
   `dashboard/VaultPage.jsx` and `shared/CoverLetterPanel.jsx`.

   The exception: **`server/` imports `src/matching/index.js`** — from
   `server/index.js` and three files under `server/jobs/`. Keyword extraction
   has to produce byte-identical results on both sides or a job's stored
   keywords would not match the ones the client scores against, and two copies
   of a 570-entry lexicon would drift the way the two page scrapers do. So it
   is imported rather than duplicated, which is only safe because of rule 10.

   **The arrow runs one way only.** Nothing in `src/` may import from
   `server/` — `server/` is a separate package with its own `node_modules`,
   and its modules read `process.env` at load.

2. **`extension/background.js` and `public/content.js` import nothing from
   `src/`.** The service worker and the content script run in isolated
   worlds with their own lifecycles. They talk to the app over
   `chrome.runtime` messaging, not through shared modules. Duplication
   between them and `src/` is deliberate, not an oversight.

3. **`src/` may import `extension/constants.js`, and only that.**
   `dashboard/ProfilesPage.jsx` pulls `COUNTRIES` and `GENDERS` from it. Adding a
   second `src → extension` import should be a conscious decision; anything
   with behavior belongs in `src/` instead.

4. **All storage goes through `src/storage.js`.** No module in `src/`
   should touch `chrome.storage` or `localStorage` directly — the wrapper
   is what makes one React app work in both the extension and the browser.
   (`supabaseClient.js` is the deliberate exception: it needs its own
   `chrome.storage` session adapter, which is what `storage.js` would
   otherwise depend on.)

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
   | React app | `src/logger.js` | Browser; must not import `server/` |
   | Service worker | `extension/logger.js` | No `window`; must not import `src/` |
   | Content script | inline, top of `public/content.js` | Copied verbatim — cannot import at all |

   The redaction key lists are the part that must stay in step, the same way
   the two page scrapers must. `server/logger.js` must be imported *after*
   `./load-env.js` — it reads `LOG_LEVEL` at module load.

9. **`components/shared/` may not import from `components/popup/` or
   `components/dashboard/`.** The dependency runs one way: a surface directory
   imports from `shared/`, never the reverse, and `popup/` and `dashboard/`
   never import from each other. That is what keeps "shared" meaning shared —
   a component in `shared/` has to render correctly on both surfaces, so it
   cannot reach for anything surface-specific. `OnextapDashboard.jsx` sits
   above all three and is the only file that decides which surface renders.

   The grouping is the rule from *Two builds, one source* made visible: if a
   change touches `shared/`, it ships to the extension **and** the dashboard,
   and both need checking.

10. **`src/matching/**` and `src/corpus.js` import nothing outside themselves.**
    Not `../logger.js`, not `../config.js`, not `../storage.js`, no npm
    package, no `node:` builtin. `src/corpus.js` may import
    `./matching/normalize.js` and nothing else.

    This is what lets three very different runtimes share one copy: the browser
    bundle, the Express server (rule 1), and bare Node under `node --test`.
    The constraint is specifically about *bare Node* — `src/config.js` reads
    `import.meta.env` at module scope, which is `undefined` outside Vite and
    throws a `TypeError` on import; `storage.js` and `logger.js` fail the same
    way on `chrome`/`localStorage`. One stray convenience import would take the
    whole test suite down with it, and the failure would look like a Node
    problem rather than an import problem.

    Enforced, not just documented: `test/matching/no-side-imports.test.js`
    reads every file in those paths off disk and fails on any specifier that
    escapes. Add a `log.debug` there and the suite goes red.

11. **`ResumeSwitcher` and `ProfileSwitcher` are siblings, not a shared
    abstraction.** "Type a name and get an empty thing" and "pick a file and
    wait for a network round trip that can fail" are different affordances with
    different failure modes. Merging them produces a props-driven mode switch
    wearing reuse as a disguise. The duplicated part is dropdown chrome, which
    is cheap; if you change one, read the other and decide deliberately.

## Where a change belongs

| Change | Goes in |
|---|---|
| New API route or server logic | `server/index.js` |
| Auth middleware, admin DB access | `server/supabase.js` |
| A screen in the web dashboard | `src/components/dashboard/` |
| A screen in the extension popup | `src/components/popup/` |
| A component used by BOTH surfaces | `src/components/shared/` |
| Which surface renders at all | `src/components/OnextapDashboard.jsx` (App) |
| Persisted local state | `src/storage.js` + a store module in `src/` |
| Credit / premium behavior | `server/index.js`, surfaced via `src/creditManager.js` |
| Autofill or field matching on a page | `public/content.js` |
| Service-worker proxying, tab scraping | `extension/background.js` |
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

## Two builds, one source

`npm run build` produces the extension into `dist/`. `npm run build:dashboard`
produces the web dashboard into `dist-dashboard/`, and that second command
is what `vercel.json` runs on deploy. Both consume `index.html` → `src/popup.jsx`.

A change to `src/` therefore ships to **both** surfaces. Confirm it works
with `chrome.*` present and absent before calling it done.
