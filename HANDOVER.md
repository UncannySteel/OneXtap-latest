# Handover: Onextap backend plugged into the new landing page and dashboard

**State on 2026-10-10:** built, exercised against stubs (the extension
included, checkpoint 7), and **run against real services on a dev Supabase
project with Dodo in test mode** (checkpoint 9): every flow in §7 item 2
passes, except Google sign-in, not tried. Production has not been touched,
and nothing is deployed. The site has to work with the extension already on
the Chrome Web Store (1.0.2, not 1.0.3 as this file said until 2026-10-16;
a 1.0.4 is being built and tested, and submitting it is the owner's later
call, see `docs/plans/active/completion-plan.md`): it does, except profile sync from the website (§7
item 1), which the website cannot fix alone; since checkpoint 11 it says so
after a save instead of claiming the sync. (Resume upload with the store
build installed, item 31, is fixed since checkpoint 11.) The keys on this machine are the dev
project's now; production's are backed up outside the repo. **Committed and pushed**: the
branch `merge/web-dashboard`, off `main` (`bae4abc`) of
`github.com/Aiko002/Onextap`, is on `github.com/UncannySteel/OneXtap-latest`
(its default branch). The first session's work is `81e1c01`, and each
checkpoint since (§0) is its own commit.

Section 7 lists every problem found that is still open. Read it before
deploying. Section 0 is the log of the sessions since, newest last: start
there if you are picking this up.

---

## 0. Progress log

Work since this handover was first written, one entry per checkpoint. Each
checkpoint ends with questions for the owner; their answers are recorded in
the next entry.

### Checkpoint 1 (2026-09-27, session 2): test safety net

Done:

- **`npm test` out of the box: 541 pass, 3 fail, 2 skipped** (was 505 / 39).
  - `src/storage.js`: web storage is detected by `localStorage.getItem` being
    a function, not just by the global existing. Node 25 defines an empty
    `localStorage` object, which sent every store test to it. Checked in a
    browser that the dashboard still writes to real `localStorage`.
  - `test/server/logger.test.js`: splits on `/\r?\n/`, so a CRLF checkout no
    longer flags the comment that documents the convention.
  - The 3 left all need `server/data/cached_jobs.json` (§7, item 11): a
    question for the owner.
- **Landing e2e suite fixed** (§7, item 3): see §5 for the numbers.
  - `web/tests/stubs.js` (new) answers for Supabase auth and
    `/api/feedback`. The patterns match any host.
  - `web/playwright.config.js`: `cwd` is the repo root, and the dev server
    gets `VITE_SUPABASE_URL=https://e2e.invalid` (never resolves) and an
    empty `VITE_API_URL`, which win over `.env`.
  - The four broken tests now assert the real requests. New: wrong
    password, "Check your email" sign-up, Continue → dashboard plus the
    header reading "Dashboard", a failed feedback send.
  - Two WebKit flakes, both pre-existing (the original DEMO_WEB has the same
    code): the focus-trap tests read focus once, before `dialog.js`'s Safari
    fallback puts it back (now polled), and a colour check could land
    mid-transition (now `toHaveCSS`, which retries).
  - `.gitignore`: `test-results/`, `playwright-report/`.
- `web/src/features/feedback/feedback.js`: header comment no longer says no
  endpoint is wired.
- `dist/` rebuilt (`npm run build`), **but with no `.env`**, so that build has
  no Supabase address and will not work. Rebuild once keys are in place.

Open questions put to the owner at this checkpoint: the extension sync fix
(§7, item 1), dev keys (item 2), the fixture file (item 11), and whether to
commit.

### Checkpoint 2 (2026-09-27, session 2): extension sync fix, real services

The owner's answers at checkpoint 1:

- **Sync fix:** yes; the dashboard's profile becomes the active one in the
  extension.
- **Dev keys:** the owner is adding `.env` and `server/.env` for a dev
  project (Dodo in test mode).
- **Fixture:** the owner asked how to fix it. The three routes: get the
  original file from the backend's author and track it; write a synthetic
  one and track it; or skip the 3 tests when it is missing. Tracking it needs
  `.gitignore`'s `server/data/` to become `server/data/*` +
  `!server/data/cached_jobs.json`. Not decided yet.
- **Commits:** on a branch. Done: `merge/web-dashboard`, `81e1c01` (first
  session) and `64ccc75` (checkpoint 1). Nothing pushed.

Done:

- **§7 item 1 fixed in code** (not yet tried with the extension loaded):
  - `extension/profileSync.js` (new, pure): `fileSyncedProfile(stored,
    payload)` files an `ONEXTAP_SYNC_DATA` payload into `onextap_profiles`,
    matched by id, then by name, else added under the dashboard's id; makes
    it active; rebuilds the `user_profile` mirror as `profileStore.js` would.
    The extension's other profiles are untouched. A rename carries over
    unless the name is taken by another profile.
  - `extension/background.js`: the handler writes both keys, and refuses a
    payload that is not a plain object.
  - Also fixes a second, quieter loss: with no store yet, the popup's
    first-run migration filed synced cover letters inside `autofillData`.
  - `test/extension/profileSync.test.js` (new, 9 tests) reads the result
    back through `src/profileStore.js`, the popup's reader. The first test
    fails against the old worker. `src/profileStore.js` now imports
    `./storage.js` (the extension was missing, so Node could not load it).
  - `npm test`: 550 pass, 3 fail (the fixture), 2 skipped.
  - Reaching users needs a new extension release (the owner's call).
- **Docs brought up to date (§7 item 4)**, except `docs/app-flow.md`:
  - rewritten: `docs/repo-structure.md` (layout, the import graph for
    `web/`, rules 2, 3, 9, 11; a new rule 12 on keeping the landing page as
    designed), `README.md`, `web/README.md`, `web/dashboard/README.md`;
  - updated: `CLAUDE.md` (project, rules 2 and 8, commands, key facts, the
    escalation now names `extension/profileSync.js`; the stale dodopayments
    note removed; `EXTENSION_ID_FALLBACK` resolved: it is the published
    extension's ID, the same one as in `CHROME_WEB_STORE_URL`), `AGENTS.md`;
  - `docs/{prd,trd,ui-ux-design,backend-schema}.md`: a dated note at the top
    saying what changed since they were written, rather than a rewrite;
  - `docs/app-flow.md`: marked out of date. It is to be rewritten after the
    real-service run, which will confirm the flows it describes.
  - Also found: `README.md`'s Node requirement was wrong for tests (`npm test`
    passes a glob to `node --test`, which needs Node 21+), and the website
    never calls `installGlobalErrorHandlers()` (new §7 item 24).
- **Blocked on the owner:** `.env` and `server/.env` are not in place yet.
  When they are, note that Claude may not type credentials into sign-in that
  goes to a hosted service (Supabase auth is not local): the owner signs up
  or in, and clicks confirmation emails and "Delete account"; Claude drives
  the rest, and asks before submitting a Dodo test-mode checkout.

Committed as `c5fe41f`.

### Checkpoint 3 (2026-10-03, session 2): cover-letter credits, ready to move

The owner's answers at checkpoint 2:

- **Fixture:** the owner put `server/data/cached_jobs.json` in place (40
  synthetic listings, all example.com) and chose to **keep it untracked**. So
  `npm test` is green here and fails 3 fixture tests on a clone without it
  (§9).
- **Cover letters (§7 item 8):** charge like Answer Studio, but **1 credit
  buys a personalisation plus 1 free re-run** (not 3). Done, below.
- **Log out (§7 item 9):** keep deleting this browser's profiles. No change.
- **Keys:** none on this machine. The owner will add them on another machine
  after pulling from GitHub, and asked for the list of what it needs: §9.

Done:

- **Cover-letter credits**, on the dashboard and in the popup:
  - `src/coverLetterCredits.js` (new, pure): a re-run is the same template
    for the same job description (its first 6000 characters, case and
    whitespace aside, hashed); the allowance is kept on the template
    (`aiRerunsLeft`, `aiRerunKey`) and travels to the extension with it.
    Premium never pays. A charge the server does not confirm buys no re-run.
  - `web/dashboard/js/ws/cover-letter.js` and
    `src/components/shared/CoverLetterPanel.jsx`: check the balance before the
    call, deduct through `POST /api/credits/deduct` after a successful one, and
    say what the next press costs next to the button.
  - Copy: the landing's pricing and FAQ and the dashboard's plan list now say
    credits cover cover letters, and Premium makes them unlimited.
  - `test/credits/coverLetterCredits.test.js` (9 tests), and
    `web/tests/dashboard.spec.js`: the first e2e test of the dashboard,
    signed in through the stubs, driving the Cover Letter workspace through
    paid, free re-run, new job, free re-run at zero credits, and refused.
  - **Not checked:** the popup's half. It is the same rule through the same
    module, but nothing automated drives the popup, and it needs keys and the
    extension loaded (§9).
- **§7 item 24 fixed:** every website entry (landing, company pages,
  dashboard and its company pages) calls `installGlobalErrorHandlers()`.
- `npm test`: 562 pass, 0 fail, 2 skipped (with the fixture file). Both builds
  pass without keys (the extension's will not work until rebuilt with `.env`).
- Docs updated for both (README, repo-structure, CLAUDE.md, AGENTS.md, the
  web READMEs), and §9 written.

Committed as `f62aae7`.

### Checkpoint 4 (2026-10-03, session 2): deploy-ready fixes

The owner's answers at checkpoint 3:

- **Push** to `github.com/UncannySteel/OneXtap-latest` (public): done, as
  remote `latest`. GitHub made `merge/web-dashboard` the default branch, so a
  plain clone checks it out. The history it carries was already public (the
  original `Aiko002/Onextap` is public), and the commit email already appears
  in the owner's other public repos.
- **Item 25:** design the full fix for approval; build nothing yet.
- **Next:** keep going here (no keys needed), then a checkpoint.
- **How this repo ships:** it will be cloned and deployed as it is, with only
  the required files added (§9). So whatever the code needs before a deploy
  has to be done here.

Done:

- **Removed `POST /api/credits/refund`** (new §7 item 26, high). Since the
  first commit it gave any signed-in account one credit per call, with no
  check that anything had been charged: unlimited credits for a loop, which
  is Premium for free, and it defeated even the server-charged "Explain my
  fit". Nothing called it (not the live code at `bae4abc`, not this branch).
  The server's internal `refundOneCredit()` stays, used by the route that
  charged. `creditManager.refundCredit()` (no callers) is gone too.
  `test/server/routes.test.js` pins it: no route whose path says refund, and
  no `.credits + …` outside `refundOneCredit()`. Both tests fail against the
  old server. **Production keeps the hole until this branch is deployed.**
- **§7 item 18 fixed:** a production website build now calls the API on its
  own origin when `VITE_API_URL` is empty, so a preview or a new domain
  talks to its own API rather than the live one; the extension keeps
  `https://www.onextap.com`. `src/creditManager.js` takes `API_URL` from
  `src/config.js` instead of working it out again. Checked on a production
  build under `vite preview`: the Contact page's feedback posted to
  `localhost:5174/api/feedback`, with every request to onextap.com blocked
  and none attempted.
- **§7 item 25 designed** (not built): `docs/plans/active/server-side-generation-charging.md`.
  One table of server-granted follow-ups, two atomic database functions,
  charging inside the generate route before the model call, and a rollout
  where `/api/credits/deduct` becomes a no-op so no old client is double
  charged. Four decisions for the owner at its end.
- **`docs/app-flow.md` rewritten** from the code for the website (§7 item 4
  done): entry points and arrival parameters, sign-in, My Profiles and the
  sync, Answer Studio, cover letters, Job Matches, the plan panel, settings,
  errors, stored state. The popup's flows were kept, with the autofill
  section-toggle gap re-checked (still ignored).
- **§7 item 20 fixed:** `web/404.html`, on the company pages' frame, built to
  `dist-dashboard/404.html`, which Vercel serves for unknown addresses. Seen
  on a production build at desktop and phone width; an e2e test added.
- `HANDOVER.md` §9 gained the deploy section (Vercel variables, the
  extension's allowed domains, Supabase and Dodo URLs, the order).
- `npm test`: 564 pass, 0 fail, 2 skipped.

Committed as `ab55683`, and pushed.

### Checkpoint 5 (2026-10-06, session 2): password reset, sign-up name, draft ceiling — handed over

The owner's answers at checkpoint 4:

- **Item 25** (server-side charging): **not now**. The design stays in
  `docs/plans/active/`, and the item stays open.
- **Build before deploying:** forgot password (item 15), a generation rate
  limit, a name on sign-up (item 16).
- **Then hand over.** This is the last checkpoint of this session; the next
  starts on the other machine (§9).

Done:

- **Forgot password (§7 item 15 fixed):**
  - The sign-in window has "Forgot password?" under the password, which turns
    it into a request for a reset link (the email alone). `src/auth.js`'s new
    `requestPasswordReset()` calls Supabase's `resetPasswordForEmail` with
    `redirectTo = <site>/reset-password/`. The window says the same whether
    or not the address has an account, and puts Supabase's "only request
    this after N seconds" as "Wait a minute before asking for another link."
  - `/reset-password/` (new; `web/reset-password/`,
    `web/src/pages/reset-password/`, on the company pages' frame with the
    sign-in window's card) reads the recovery hash before Supabase's client
    takes it, asks for the new password held to the sign-up rule (now shared:
    `web/src/features/login/password-rule.js`), and sets it with the new
    `updatePassword()`. No link, a refused link or a dead session: it says so
    and offers `/?reset=1`, which opens the window on the reset request.
  - A reset link that lands on the site root or the dashboard is sent to the
    reset page (the forwarding script in `web/index.html`; the dashboard's
    boot), so it never becomes a plain sign-in that skips the new password.
  - Supabase needs `<site>/reset-password/` on its Redirect URLs (§9).
- **A name on sign-up (§7 item 16 fixed):** optional, in sign-up mode only;
  it becomes the account's `full_name`, which the dashboard greets by.
- **The hourly ceiling on AI drafts** (new; it softens the quota side of §7
  item 25, not the charging): `server/generateLimit.js`, counted in the
  generate route after validation and before the model;
  `GENERATE_LIMIT_PER_HOUR` (default 30, Premium included); a 429 with
  `Retry-After` and "That's the limit of N AI drafts an hour. Try again in M
  minutes." It needs `supabase/migrations/006_generation_rate_limit.sql`
  (written, applied nowhere; ledger updated). **It fails open**: without the
  table it lets drafts through and logs one warning per instance, so the code
  can ship before the migration.
- **Verified:** 8 unit tests for the limiter; the real Express route run in
  a throwaway harness against local stubs of Supabase and Groq (with the limit
  at 2: 200, 200, then 429 with Retry-After and no model call; then, with the
  table missing, 200 and one warning); 9 e2e tests for the account flows
  (`web/tests/account.spec.js`; one of them first passed on words already in
  the markup and raced on the phone profile, fixed to wait for the card to
  show, then 108 of 108 over four repeats); screenshots of every new state at
  desktop and phone width.
- `npm test`: 572 pass, 0 fail. `npm run test:e2e`: 188 pass, 10 skipped,
  0 fail. Both builds pass.
- `CLAUDE.md`'s branching note no longer says "not pushed".

Still not verified anywhere: everything against real services (§7 item 2,
and §9's "check by hand"), now including the reset email itself.

### Checkpoint 6 (2026-10-09, session 3): the keys arrive, and they are production's

The owner added `.env` and `server/.env` on **this** machine (not another
one, as §9 expected); `server/data/cached_jobs.json` was already here.

- **They are the production values**, which the owner confirmed: the client
  `.env` sets `VITE_API_URL` and `VITE_DASHBOARD_URL` to
  `https://www.onextap.com`, and `DODO_PAYMENTS_ENVIRONMENT` is `live_mode`.
  No tracked file names the Supabase project, so that came from the owner,
  not the repo.
- **The owner's choice:** test against a **dev Supabase project with Dodo in
  test mode**, as §9 planned. Nothing ran against production or any real
  service this session: no sign-in, query, migration, model call or server.

Done, offline:

- `npm test`: 572 pass, 0 fail, 2 skipped (the opt-in LLM evals). Checked
  first that it cannot reach a real service: nothing under `test/` loads
  `server/.env` (only `server/index.js` imports `load-env.js`), and the evals
  need `RUN_LLM_EVALS=1`.
- Both builds pass with the keys in place, and neither carries a server
  secret: each of the nine secret values in `server/.env` was searched for
  across all 54 files of `dist/` and `dist-dashboard/`, and none was found
  (CLAUDE.md rule 7).
- **`dist/` is now a production-configured extension** (its API is
  `https://www.onextap.com`). Rebuild it with the dev values before loading
  it unpacked for testing.
- **e2e flake fixed**: `pages.spec.js` › "holds the page still while it is
  open" failed about once in 80 runs. Probed: the page had already scrolled
  (653 or 227 px) when the click returned, and the wheel then moved it 0 px;
  a DOM click never scrolled it (40 of 40). Playwright retries a click on the
  button while it is still rising in, and the retry scrolls it into view
  (top-aligned: 653; centred: 227). The window held the page all along. The
  test now waits for the window to open and compares with where the page
  stood then: 160 of 160 over 20 repeats, and it fails (moved 800–900 px)
  with the hold disabled.
- `npm run test:e2e`: 188 pass, 10 skipped, 0 fail.

Found in the key files, for the swap to dev values:

- `server/.env` has no `CLIENT_URL`. CORS is unaffected
  (`http://localhost:5173` is always allowed), but a checkout returns to
  `https://www.onextap.com/dashboard/`.
- `ADZUNA_COUNTRIES` and `INGEST_SWEEP_PAGES` are each set twice; dotenv
  keeps the last (so `INGEST_SWEEP_PAGES=2`).
- `npm run dev` and the `web` preview configuration read `.env`, so with
  these values the local dashboard calls the **live** API, which runs
  `main`'s code, not this branch's.
- Do not park the production files in the repo as `.env.production` or
  `.env.production.local`: `vite build` runs in production mode and would
  load them over `.env`. Keep them outside the repo.

Waiting on the owner: the dev project and Dodo's test mode (§9's
"Accounts and settings"). Then, in `.env`: the dev project's URL and anon
key, `VITE_API_URL=http://localhost:3001`,
`VITE_DASHBOARD_URL=http://localhost:5173`. In `server/.env`: the dev
project's URL and service-role key; the Dodo test key, webhook secret and
product id; `DODO_PAYMENTS_ENVIRONMENT=test_mode`;
`CLIENT_URL=http://localhost:5173`. The Groq, Gemini, Resend and Adzuna
keys belong to no project and can stay, but every call spends their real
quota, and while `OPIK_API_KEY` is set Opik keeps a trace of each
generation, test resumes included (CLAUDE.md rule 8). After that: bootstrap
the dev project (`schema.sql`, `002`, `006`, recorded in the ledger), then
§9's "check by hand".

### Checkpoint 7 (2026-10-09, session 4): the extension, loaded, against stubs

Picked up from checkpoint 6. `.env` and `server/.env` are unchanged (still
production's, dated 27 Sept) and nothing new is on `latest`, so the
real-service run is still waiting on the dev project. Nothing ran against a
real service this session either.

Done, offline:

- **`npm run test:e2e:extension`** (new): the extension built with addresses
  that cannot resolve (`web/tests/extension-build.js`, into a temp folder,
  never `dist/`), loaded unpacked in Chromium, beside the website on
  `localhost:5173` (`web/playwright.extension.config.js`, which refuses to
  reuse a server already there, since that one is probably `npm run dev` on
  the real `.env`). The account and the API are the existing stubs, set on
  the whole browser context. Two tests (`web/tests/extension.spec.js`):
  - **Profile sync and autofill (§7 item 1):** save on the dashboard opened
    with `?extensionId=`; "Saved and synced to the extension"; the worker's
    store holds it; the popup opens and makes its own store; a second edit
    on the dashboard; the popup's "Autofill Application" fills a form with
    the edit. **Against the old worker** (writing `user_profile` only), the
    same steps fill the stale first name ("Ada", not "Augusta"): the
    original bug, through the product. It passes with the fix.
  - **The popup's cover-letter credits (§7 item 8):** paid, free re-run at
    zero credits, then refused before any AI call, and the allowance kept
    on the template in `chrome.storage.local`. It needs a session put in
    place by hand, because of the next point.
  - 10 of 10 over five repeats.
- **Found: the popup has no way to sign in (new §7 item 27).** After a
  sign-in on the website, the extension's storage holds no Supabase session,
  and the popup's "Personalize" button is greyed out with no word of why
  (probed, with a screenshot). Nothing in the popup calls `signIn` or
  `signInWithOAuth`; the website's session is in the website's
  `localStorage`. Pre-existing: at `bae4abc` the only caller was the old
  dashboard rendered inside the extension at `?mode=dashboard`, which no
  button opened. So checkpoint 3's popup credit rule works but no user can
  reach it. And if the published version (1.0.2; this entry said v1.0.3) matches `bae4abc`, its popup cannot
  personalise at all, rather than for free as §6 said (corrected there and
  in `docs/app-flow.md`).
- Playwright's full Chromium (extensions do not load in the headless shell
  the other suites use) would not start from its install folder on this
  machine: Windows' "side-by-side configuration is incorrect", though the
  folder is complete. A copy of the folder elsewhere ran, so the spec takes
  `E2E_CHROMIUM_PATH` (§9).
- `npm test`: 572 pass, 0 fail, 2 skipped. `npm run test:e2e`: 188 pass,
  10 skipped, 0 fail (it skips the new spec, which needs the extension).
- Stale lines fixed: §8 said nothing was pushed; §6 and §9 described the
  popup's credits as live.

Waiting on the owner: item 27 (what the popup should do), and still the dev
project for the real-service run.

### Checkpoint 8 (2026-10-09, session 4): the popup sends cover letters to the dashboard

The owner's answers at checkpoint 7:

- **Item 27:** option a), done below.
- **Keys:** asked where they go. The answer, as given: back up the
  production `.env` and `server/.env` outside the repo, then in `.env` the
  dev project's URL and anon key, `VITE_API_URL=http://localhost:3001`,
  `VITE_DASHBOARD_URL=http://localhost:5173`; in `server/.env` the dev
  project's URL and service-role key, Dodo's test-mode key, webhook secret
  and product id, `DODO_PAYMENTS_ENVIRONMENT=test_mode`, and a new
  `CLIENT_URL=http://localhost:5173` (checkpoint 6 has the reasons). Not in
  place yet when this checkpoint closed.

Done:

- **The popup's Cover Letter tab, signed out** (which is everyone, item 27):
  in place of the target fields and "Personalize", it says personalising is
  on the dashboard, with "Personalize on the dashboard", which opens
  `/dashboard/?extensionId=<id>&view=cover`. Versions saved there sync back
  and show under "Saved versions" with "Fill". Shown with or without
  templates. The signed-in path is unchanged and kept for a later sign-in.
  `src/components/shared/CoverLetterPanel.jsx` (whose header no longer
  claims the dashboard uses it), `PopupView.jsx` (the user is `undefined`
  while the session is checked, so a signed-in popup does not flash the
  notice), `OnextapDashboard.jsx`.
- **A new test** in `web/tests/extension.spec.js`: website sign-in, a
  profile, the popup's notice and no "Personalize", its button opening the
  dashboard's Cover Letter workspace with the extension's ID, a paid
  personalisation and "Save version" there, then the popup's saved version
  filling a form's cover-letter field.
- **Found (new §7 item 28):** a template made in the popup is replaced at
  the next dashboard save, since the sync files the dashboard's list over
  the extension's. A side effect of checkpoint 2's fix, unreleased. Options
  for the owner there; the sync was not touched (CLAUDE.md asks first).
- **A flake fixed in the checkpoint 7 test:** it filed a profile while the
  freshly opened popup was still in its first-run setup, which writes an
  empty store from an earlier read and could undo it (2 of 36 runs). It now
  waits for the popup to settle: 24 of 24 runs of that test after.
- `dist/` rebuilt (still with the production `.env`); the new button is in
  the popup bundle, and none of the 9 server secrets are.
- `npm test`: 572 pass, 0 fail, 2 skipped. `npm run test:e2e:extension`:
  15 of 15 over five repeats. One Chromium launch in about a hundred this
  session hung until the test timed out, before any test code ran: the copy
  of Chromium on this machine, not the tests.
- Docs: `docs/app-flow.md` §2 and §6 (a flow chart of the round trip),
  CLAUDE.md, AGENTS.md, README.md.

Waiting on the owner: item 28, and the dev keys.

### Checkpoint 9 (2026-10-10, session 5): real services, on a dev project

The owner's answers at checkpoint 8:

- **The dev keys:** in place. A separate dev Supabase project and Dodo in
  test mode, as checkpoint 8 laid out; the production files are backed up
  outside the repo. `OPIK_API_KEY` blank, so no generation is traced.
- **Item 28:** not answered. It concerns the unreleased extension only, and
  the owner since said no new release is planned (below), so it waits on
  that.
- **New instruction:** the website has to plug into the extension already on
  the Chrome Web Store (1.0.2; this entry said 1.0.3). No new extension release is planned (whether
  a minimal 1.0.4 is ever published is left open, below). The popup
  cover-letter check (§9) was dropped for that reason.

Done:

- **Keys checked without printing them** (parsed with `server/node_modules/dotenv`,
  pass/fail only): both files point at the same project, which is not the one
  built into the production bundle; anon key in `.env`, service-role key in
  `server/.env`; `test_mode`; `CLIENT_URL` set. Groq's `openai/gpt-oss-120b`
  and fallback, and Gemini's `gemini-2.5-flash`, all answer to these keys.
- **Dev project bootstrapped by the owner** (`schema.sql`, `002`, `006`) and
  probed: all seven tables answer, `job_listings` has `004`'s columns.
  Recorded in `supabase/migrations/README.md`, "Dev project".
- **Job pool:** one ingest (`X-Cron-Secret`), 1,751 real listings from seven
  sources, no errors; `ALLOW_CACHE_SOURCE=false`, so no fixtures.
- **Dodo's webhooks reach the local API through a Cloudflare quick tunnel**
  (`cloudflared tunnel --url http://localhost:3001`; §9 has the setup). The
  server log caught two setup slips: an endpoint URL ending `/api/webhookx`
  (every event a 404) and a webhook secret with a stray character (every
  event "Base64Coder: incorrect characters for decoding", which is the secret
  failing to decode, not a bad signature).
- **§7 item 2 run for real, against the dev project.** All pass: email
  sign-up with confirmation (the profile row, the name, 3 credits), the
  greeting by name, resume upload (Gemini, a fictional test resume), Answer
  Studio generate (1 credit) and a free improvement, the hourly ceiling
  (`GENERATE_LIMIT_PER_HOUR=2`: the third draft refused, no credit, the
  Supabase-backed limiter, no "unavailable" warning), Job Matches rank (19
  scored by the model), cover-letter credits (charge, free re-run, a changed
  description charges again), `__onextapIssues()`, Dodo test checkout →
  webhook → Premium, the billing portal, Switch to Standard → the end date →
  Keep Pro, profile sync with the **local** build loaded (the owner), forgot
  password with a real inbox (the owner), delete account (the auth user, the
  profile and credit rows gone; the linked Dodo subscription cancelled
  first). Not tried: Google sign-in.
- **Fixed: "Explain my fit" failed every so often** with a 502 and the raw
  "Unterminated string in JSON". Its 2,048-token cap is shared with
  `gpt-oss-120b`'s hidden reasoning (measured: 1,061 reasoning tokens, 1,947
  of 2,048 used), so a longer reasoning cut the JSON short. The caps are now
  4,096 (analysis) and 3,072 (tailoring); an unparseable reply says "came
  back incomplete … no credit was used"; a Groq reply that hits its cap is
  logged (`server/jobs/rank.js`). Checked in the dashboard on a Pro account:
  200 in 7.6s, no cap warning, no charge. Its one-credit charge on a free
  account was not re-checked after the fix (the failure before it charged
  nothing, as designed).
- **Fixed: one account, one subscription** (new §7 item 30, the owner's
  go-ahead). The two test checkouts made two Dodo subscriptions, because
  checkout refuses an account only once it is Pro, and it turns Pro when the
  first webhook lands. The second outlived the account's deletion. Now:
  webhooks ignore events for a subscription that is not the account's own; a
  second subscription is cancelled as it activates (its payment refunded by
  hand, the log names both); `DELETE /api/account` cancels every billable
  subscription of the account, not only the linked one; and the dashboard,
  back from a paid checkout, shows "Payment received … no need to pay again"
  in place of "Upgrade" for 15 minutes. `server/subscriptionGuard.js` with
  `test/server/subscriptionGuard.test.js`. **Not yet tested with a real
  double checkout** (steps in §9).
- **Fixed: a misleading ERROR on every Pro account's deletion.** Dodo's
  `subscription.cancelled` lands after the profile is gone, and was logged as
  "Failed to cancel subscription"; now an info line. Checked with a real
  webhook. `updateProfile()` keeps PostgREST's error code for this.
- **Both test subscriptions cancelled** (one by the deletion, the stray one
  through Dodo's API). The test account is deleted.
- **Audited: does this branch plug into the store extension?** Read-only,
  against `main` as the stand-in for the store build, then taken to be 1.0.3
  (`main`'s manifest version, unchanged since `9b01adb`; the store build
  itself was not unpacked, and is in fact 1.0.2). Compatible:
  every API call the extension makes, the popup's dashboard links, resume
  upload through the worker, CORS, the extension ID. **Not compatible: item
  1**, the profile sync, and the website cannot work around it (the store
  worker has no message that writes the store the popup reads; confirmed
  for 1.0.2 while planning). Also found:
  item 29 (`?extensionId=` trusted) and item 31 (resume upload goes through
  the extension).
- `dist/` rebuilt with the **dev** values: it points at `localhost` and the
  dev project now, not production. None of the server secrets are in it.
- `npm test`: 577 pass, 0 fail, 2 skipped. The e2e suites were not run.
- Smaller things seen, not fixed (item 32): Answer Studio's "Improve" left a
  draft with more unbacked claims than before (1 → 4, all flagged); Job
  Matches lists "HTML" as missing beside a matched "HTML5"; a rank took 27s
  where the page says 5-20.

Waiting on the owner:

- **Item 1 with the store extension:** the website-side options a) stop
  claiming "synced to the extension", b) item 29, c) item 31; and whether a
  minimal 1.0.4 (the sync fix only) is ever published.
- **A real double checkout** (§9) to test item 30.
- **Item 28**, if an extension release happens.

### Planning (2026-10-16, session 6): the rest, in batches

No code changed. The owner was interviewed on everything still open, and the
answers became `docs/plans/active/completion-plan.md`: seven batches (B0 to
B6), one session each, ending deploy-ready. Its §1 is now the decision
record. It supersedes the "Waiting on the owner" list above: a 1.0.4 is built
and tested, and submitting it is decided later; items 1a, 28a, 29b and 31c
are in; item 25 is in, as designed; production, `main` and the store are not
touched.

- **Found: the live store version is 1.0.2, not 1.0.3.** Google's update
  service and the copy installed in the owner's Chrome agree. Its worker
  behaves as item 1 describes, and answers unknown messages with "Unknown
  action". Everything this file says about "store 1.0.3" means 1.0.2; batch
  B0 corrects those lines (plan §2).
- **Next:** batch B0. Open a new session and paste: `Run batch B0 of
  docs/plans/active/completion-plan.md.`

### Checkpoint 10 (2026-10-16, session 7): B0, baseline and guardrails

Batch B0 of the completion plan: a known-green start, and checks that make
the parallel batches safe. Two builders (B0-A ESLint, B0-B rule tests),
merged, reviewed (`code-review` at high) and audited (every acceptance
criterion passed).

- **ESLint, `npm run lint`** (`eslint.config.js`, flat, ESLint 9):
  correctness only. Globals per runtime (page + `chrome` for `src/`, `web/`,
  `public/`; service worker for `extension/`; node for the rest).
  `no-console` is an error outside the four loggers, `scripts/` and the e2e
  probe tools, which enforces rule 11. Every error fixed without changing
  behaviour: unused imports and variables, three dead duplicate constants in
  `server/index.js`, needless regex escapes, duplicate keys in a test, and
  the two raw `console.warn` calls in `web/src/app/mount.js` and `stage.js`,
  now through the logger. One warning stays:
  `src/components/shared/CoverLetterPanel.jsx:127` (`exhaustive-deps`), a
  mount-only effect that is deliberate.
- **Rule tests, `test/rules/`** (83 new tests): rule 4 (the webhook is
  before `express.json()` and raw-parsed, read from the real router stack),
  rule 5, rule 7 (no secret-looking `VITE_*` name in code, HTML or
  `.env.example`, untracked files included), rule 9 (`scrapeJobPage()` linted
  standalone and run in a bare `vm`), rule 10, and a **route inventory**
  (`routes.snapshot.json`, 21 routes, each answering non-404) through
  **`test/server/harness.js`**. That harness imports the real app with
  `VERCEL=1`, dummy or deleted values for every env var `server/` reads,
  `ONEXTAP_SKIP_DOTENV=1` (new in `server/load-env.js`) plus a tripwire on
  dotenv, and guards on `fetch` and on every socket connect, so it never
  reads `server/.env` and never reaches a service. Each test was shown to fail
  on a deliberate break, then reverted.
- **Scraper drift found and resolved (rule 5).** The two scrapers differed:
  `content.js`'s extra school / university / essay selectors were
  deliberate, but five LinkedIn selectors had only reached `background.js`.
  Both now open with one identical `SELECTORS` literal. The `*Academic` keys
  are read only by `scrapePageContext()`, so the job-page scraper can't take a
  "school" class for the employer. `scrapeJobPage()` behaves exactly as
  before (the Auditor ran both versions on 20,000 random pages: no
  difference). `scrapePageContext()` gains the five LinkedIn selectors, and on
  an exact tie in description length `#job-details` now beats
  `[class*=description]` (a test pins it).
- **The store is 1.0.2: HANDOVER corrected** throughout (the top, §5, §6
  item 5, §7 items 1, 12 and 31, §9, and the older log entries, which now say
  what they had said). Checked on the store copy itself: 1.0.2 opens
  `https://www.onextap.com?extensionId=<id>`, and its `externally_connectable`
  includes `localhost:5173`.
- **e2e caches** in `%USERPROFILE%\onextap-e2e` (Chromium, and the store
  1.0.2 with `_metadata` removed). Not `%LOCALAPPDATA%`, as the plan first
  said: Chromium fails with the side-by-side error in any folder directly
  under it, and starts from `%USERPROFILE%` or `%TEMP%`.
- **Dependencies:** six dev dependencies (eslint 9.39.5 and friends). The
  lockfile adds 170 packages and moves five shared transitive ones up by a
  patch (`hasown`, `side-channel`, `side-channel-list`, `es-object-atoms`,
  `is-core-module`).

**Verified:** baseline before any change: `npm test` 577/0/2,
`npm run test:e2e` 188 pass / 10 skipped, `npm run test:e2e:extension` 3
pass (the first e2e runs since checkpoints 5 and 8). After: `npm run lint` 0
errors / 1 warning; `npm test` 660 pass, 0 fail, 2 skipped; both builds;
`test:e2e` 188 / 10 skipped; `test:e2e:extension` 3 of 3; `npm run
server:dev` answers `/api/health` 200 with an `X-Request-Id`. The built
`scrapeJobPage()` in `dist/` was also run standalone in a `vm`, by hand.

**Not verified:** nothing against a real service (none was needed).
Accepted from the review, not fixed: `ONEXTAP_SKIP_DOTENV=1` skips
`server/.env` without a log line; rule 9 is tested on the source, not the
minified bundle (checked by hand this once); the harness blocks connections
but not DNS lookups.

**Owner's answers at the checkpoint** (asked as open questions):
- The scraper change above (`content.js` gains the five LinkedIn selectors,
  and the tie-break moves): **kept**.
- Lint warnings to promote to errors: **none**; `exhaustive-deps` stays a
  warning.
- A pending 1.0.3 draft in the Chrome Web Store developer dashboard:
  **there is none**.

**Next:** batch B1. Open a new session and paste: `Run batch B1 of
docs/plans/active/completion-plan.md.`

### Checkpoint 11 (2026-10-17, session 8): B1, server split, extension protocol v2, website fixes

Batch B1 of the completion plan. Three builders in worktrees (B1-A the server
split, B1-B extension protocol v2, B1-C website polish), merged A → B → C
with no conflicts, reviewed (`code-review` at high) and audited (every
acceptance criterion passed; item 21 partial, then fixed). The account's
usage limit stopped all three builders midway; they were resumed from their
transcripts.

- **`server/index.js` split, a pure move.** `index.js` is the 25-line
  entry (`load-env.js` first, the app from `./app.js`, listens unless
  `VERCEL`). `server/app.js` holds the middleware in the old order: CORS,
  request ids, `POST /api/webhook` with `express.raw` (registered on the app
  itself, because the rule 4 test reads the top-level stack), the 3 MB
  parse-resume parser, `express.json`, the routers, the error logger. Twelve
  routers in `server/routes/` (the largest, `jobRank.js`, is 376 lines),
  helpers in `server/lib/` (credits, dodo, gemini, errors, jobRoutes), prompt
  text in `server/prompts/` (`answerVault.js` with the Improve block,
  `resumeParse.js`). A line-by-line comparison with the old file, by the
  builder and again by the Auditor, found only wiring: imports and exports,
  `app.` → `router.`, file headers, three prompt wrappers. The route snapshot
  is unchanged; `test/server/routes.test.js` and `parses.test.js` read every
  server module; the logger test scans the new files (the same 15 call
  sites). There was no 404 handler, and none was added.
  `installProcessHandlers()` now runs after the route modules load (ESM
  order); they only build constants and the Dodo client.
- **Extension protocol v2** (`docs/extension-protocol.md`). The worker sends
  both channels through `extension/messages/registry.js`: one module per
  message, each naming who may send it. `site` is external, its origin
  checked against the manifest's own `externally_connectable` list, read at
  run time (so B3's release manifest narrows it). `popup` and `content` are
  internal, `sender.id` ours. `ONEXTAP_HELLO` answers `{version, protocol:
  2, capabilities: ['profile-sync']}` to the site and the popup. 1.0.2's four
  messages answer exactly as before (pinned by tests written before the
  refactor), but who may send them narrowed from anyone on either channel to:
  `ONEXTAP_SYNC_DATA` and `PARSE_RESUME` the site only, `SCRAPE_ACTIVE_TAB`
  the site and the popup, `GENERATE_IMPROVED_ANSWER` the popup only
  (`main`'s website never sent it). An unknown message gets 1.0.2's words,
  "Unknown action: <kind>" (this branch's worker said "Unknown request").
- **The website's side**, `src/extensionClient.js`: `getExtensionInfo()`
  (current / legacy / absent, 1.5 s), `syncProfileToExtension()`, and
  `resolveExtensionId()` (item 29). My Profiles' status after a save:
  current, "Saved and synced to the extension"; legacy, "Saved — the
  extension is out of date: update it", linking to the store, and the sync
  still sent; absent, "Saved on this device" (item 1, option a). Resume
  parsing always goes to the API (item 31).
- **Website copy (item 14), the scoring label (21), the session key (23),
  `src/index.css` (19):** §7. The copy, before → after:
  - Showcase, Mapping tab: "A field Onextap has not seen before gets mapped
    once, then fills itself everywhere after that." → "Fields are matched to
    your profile by their labels. One it does not know waits for you, until
    you name it once."
  - Its steps: "unmapped: notice_period" → "no match: visa_status"; "A form
    asks for something Onextap has not met before. It is flagged rather than
    quietly skipped." → "A form asks for something your profile does not
    cover. Onextap leaves it empty rather than make something up."; notes
    "Flagged, never guessed" / "Shown before anything fills" → "Left for you
    to fill" / "What you typed stays put"; "Map it once" (notice_period → 4
    weeks) → "Name it once" (custom field: Visa status); "Point the field at
    the answer it belongs to. One click, and only the first time you see it."
    → "Add it to your profile as a custom field, named the way the form prints
    it, with your answer."; notes "One click to bind it" / "First time only" →
    "Set up on the dashboard" / "Named as forms label it"; "It sticks"
    (remembered · every board) → "It fills from then on" (matched by label ·
    any board); "Every future application carrying that field fills itself,
    whichever board is asking." → "Any later form whose field carries that
    label gets your answer, whichever board is asking."; "Applies on boards you
    have not seen" → "Works on boards you have not seen"; "learned once" →
    "set once"; "The mapping list only ever grows, so the second application
    is always faster than the first." → "Each custom field you add is one less
    box to type, so the next application asks less of you."; notes "The list
    only ever grows" / "No second setup" → "One entry per question" / "Edit or
    remove it any time"; the small window "notice_period / unmapped, ↳ fills
    with / 4 weeks" → "visa_status / left empty, ↳ custom field / Citizen".
  - Showcase card: "Handles fields it has not seen" → "Leaves unknown fields
    to you".
  - FAQ: "A field it hasn't met before is flagged, never guessed." → "A field
    it doesn't recognise is left empty for you; add it to your profile once
    and it fills from then on."; "Priority support and early access come with
    it." → "Everything else, autofill included, is free either way."
  - Pricing, Premium: "Priority support and early access" → "The same AI
    models as Free".
  - About: "Learn the form once. Fill it everywhere." → "Write it once. Fill
    it everywhere."; "A field it has not met before is flagged, never guessed
    — map it once and it fills itself on every board after that." → "A field
    it does not recognise is left empty for you — add it to your profile once,
    named the way forms print it, and it fills on every board after that."
  - Form fields: "Onextap learns the mapping once and reuses it everywhere."
    → "Onextap reads the labels and fills them from one profile."
  - Job Matches: "Scoring 30 of 30 jobs" → "Scoring the closest of N jobs in
    the pool" (no filter applied) or "Scoring the closest jobs in the pool";
    its note loses "The count is an estimate;".
- **From the review, fixed:** a handshake that only timed out (a service
  worker still waking) no longer skips the sync; the sync waits at most 10 s,
  so Save can't hang; the scoring label stops quoting the pool's size while a
  filter narrows it, and moved to a pure module with a test. **From
  integration:** the website e2e config ignored only `extension.spec.js`, so
  with `E2E_LEGACY_EXTENSION_PATH` set it also ran the legacy spec under its
  own projects (6 failures); it now ignores both. **Accepted, not fixed:** the
  session key is still derived rather than shared (a B3 candidate); the new
  unit tests that load `src/` need Node 22.15+ (`module.registerHooks`) and
  skip on older Node, while the README says 21+ for `npm test`.
- **Docs:** CLAUDE.md (rule 4 now names `server/app.js`; the extension e2e
  line), `docs/repo-structure.md`, `backend-schema.md`, `trd.md`,
  `app-flow.md`, `web/dashboard/README.md`, and the comments that named
  moved code.

**Verified:** baseline before any change: lint 0 errors / 1 warning;
`npm test` 660/0/2; `test:e2e` 188 / 10 skipped; `test:e2e:extension` 3.
After: lint 0 errors / 1 warning (the same); `npm test` 741 pass, 0 fail, 2
skipped; both builds; `test:e2e` 197 pass, 10 skipped, 0 fail (B1-C's three
new tests on three projects); `test:e2e:extension` 6 of 6: the 3 as before,
plus 3 `legacy` tests against the real store 1.0.2 (unpacked, stubbed API,
the site on localhost). `npm run server:dev` answers `/api/health` 200 with
an `X-Request-Id` (checked before the review fixes, which touched only a
comment on the server; the harness tests import the app after them). One
phone-Chromium failure in `dashboard.spec.js:27` in the first run after the
merge (the tap hit a link while the sign-in button was still moving, with the
stray legacy runs loading the machine) passed 5 of 5 on repeat and in both
later full runs.

**Not verified:** nothing against a real service (none was needed). The Job
Matches label in a browser: no e2e covers Job Matches. The content script
sends nothing yet, so its sender kind is tested only in unit tests.

**Owner's answers at the checkpoint** (asked as open questions):
- The website copy above: **kept, except that the site no longer says
  Premium uses the same AI as Free.** Premium's pricing card drops "The same
  AI models as Free" (it now has five bullets, like Free's), and the FAQ's
  Premium answer drops "It's the same AI as Free, without the credit count."
  The stage e2e checks neither comes back.
- The four claims left as they were (§7 item 14): **stay as they are**, the
  owner's product call.
- The narrowed senders: **kept.**

**Next:** batches B2 and B3, in either order or both at once (the plan's B3
note). Open a new session and paste: `Run batch B2 of
docs/plans/active/completion-plan.md.`

### Checkpoint 12 (2026-10-17, session 9): B2, server-side charging, billing hardening, AI quality

Batch B2 of the completion plan. Three builders in worktrees (B2-A charging,
B2-B billing, B2-C AI quality). The account's usage limit stopped all three
early again; they were resumed from their transcripts (A and C had saved
nothing yet and started over). Merged A → B → C: C's call site in
`server/routes/generate.js` merged without a conflict on top of A's rewrite,
and was checked by hand. Reviewed (`code-review` at high, 8 findings) and
audited (every money-path criterion passed; three partial). The confirmed
findings went back to the builders, and the gate was re-run on the result.

- **Server-side charging (§7 item 25, D7).** `supabase/migrations/007_generation_charges.sql`:
  `generation_allowances` (one row per charge: the follow-ups it granted, and
  the receipt a refund needs), `spend_generation()` (a granted follow-up, else
  Premium, else `update profiles set credits = credits - 1 where … credits >
  0`, the audit row and the allowance in the same transaction) and
  `undo_generation()` (deletes the receipt and gives the credit back, at most
  once; or gives a follow-up its use back). Service role only, re-runnable;
  `schema.sql` ends with the same statements (a test holds them equal). The
  spend rules sit behind a store (`server/lib/generationSpend.js`: Supabase
  over RPC, and a memory copy for tests). `POST /api/answer-vault/generate`:
  a well-formed request, then the hourly cap, then the spend, then the model,
  and the spend undone if the generation fails (an upstream error, an
  incomplete answer, an answer cut off at the limit). Out of credits is 403
  and the model is never called; 007 missing is 503 with an error log naming
  the file. The body takes `kind` (`answer` or `cover_letter`; an unknown one
  is 400) and `allowanceId`; the response gains `charge: {charged, premium,
  allowanceId, followUpsLeft, credits}`. A client that sends no `kind` (the
  published popup, a cached page) is charged as an answer with no follow-ups,
  and its later `POST /api/credits/deduct` is a no-op that answers with the
  balance: charged once, never free. "Explain my fit" spends through the same
  function (kind `explain`, a receipt with no follow-ups), still after its
  analysis, and its refund takes the charge it gives back. Nothing in
  `server/` reads a balance and writes it back (a routes test pins it).
- **The dashboard** (`answer-studio.js`, `cover-letter.js`) sends `kind` and
  the allowance id, keeps the server's id on the saved answer or template
  (`aiAllowanceId`, with the old counters as a display mirror), and takes the
  balance from `charge`, `Number.isFinite`-guarded. Answers and templates
  saved before this show no free follow-ups: the server never granted them. A
  cover letter's re-run is keyed, on the server and the page alike, to
  `applicationKey()` of the job description without its "Organization:" and
  "Role:" lines, so editing the company or role is still the same application
  (`src/coverLetterCredits.js`'s rule; the server now imports that module,
  `docs/repo-structure.md`).
- **Billing hardening (§7 item 30, D8):** race-proof linking and the on-hold
  replacement, as §7 item 30 now says. Beyond the spec: replacement also
  covers paused, past due and pending; an activation the webhook could not
  finish (a duplicate Dodo won't cancel, a database error, the link moving
  three times, Dodo unreachable on a re-read) answers 500 so Dodo redelivers,
  where it used to log and answer 200; an activation naming no subscription is
  ignored. No migration was needed (no 008).
- **AI quality (§7 item 32):** the Improve guard, versioned skill names and
  rank timings, as §7 item 32 now says.
- **From the review and the audit, fixed:** the Improve rule and guard ran on
  cover letters too (the draft there is the template) and forbade naming the
  company the letter is for: now Answer Studio's Improve only, and the target
  organisation and role may be named; the retry had no time bound (charging
  now comes first, so a client that gives up is charged): no retry after 30 s,
  a 15 s timeout on it; on a re-read after a lost link write, a Dodo lookup
  failure linked over the winner: it now answers 500; the re-run key had
  started including the company and role; route tests added for the refund
  after an incomplete or cut-off answer and for the retry being charged once.
  **Lead glue:** `server/.env.example`'s rank-model line in the code's order;
  the e2e stub keys a re-run as the server does.
- **Accepted, not fixed:** see the open questions, and §7 item 25's "Left
  open". The guard repeats the route's temperature and length floor (a
  maintenance cost only). `undo_generation()`'s follow-up branch has no
  ceiling; only the server calls it, once per failed request. The re-run key
  is a 32-bit hash (a crafted collision buys one re-run).
  `GET /api/verify-premium` reads and then writes `is_premium` (pre-existing,
  outside B2): in an unlucky interleaving with the on-hold replacement it
  could switch Pro off until the next event.
- **Deviations from the design document**
  (`docs/plans/active/server-side-generation-charging.md`): the migration is
  007 (006 was taken); a third kind, `explain`; both functions take a
  description for the audit row and raise `no_profile` and `bad_kind`; the
  stored field is `aiAllowanceId`; `charge` has a `premium` field and drops
  `allowanceId` once no follow-ups are left; deduct no longer answers 403 at
  zero (it charges nothing, so it answers with the balance); "Explain my fit"
  keeps check, run, charge, so with 007 missing it runs the analysis and then
  answers 503; the popup and the worker's `GENERATE_IMPROVED_ANSWER` were not
  touched (B3 owns the popup; §3 keeps the message).

**Verified:** baseline: lint 0 errors / 1 warning; `npm test` 741/0/2; keyless
evals 8 pass, 2 skipped. After: lint 0 errors / 1 warning (the same); `npm
test` 864 pass, 0 fail, 2 skipped; the keyless evals unchanged; both builds;
`test:e2e` 200 pass, 10 skipped, 0 fail; `test:e2e:extension` 6 of 6 (3
`extension`, 3 `legacy` against store 1.0.2), the popup test now asserting
that an old client's personalisations are each charged once by the server;
`npm run server:dev` answers `/api/health` 200 with an `X-Request-Id`. All of
it run twice: after the merge, and again after the review fixes.

**Not verified:** nothing against a real service, by design (B4). Migration
007 is applied nowhere: until it is, generation and "Explain my fit" refuse
with a 503 on any project running this server, the dev project included
(`supabase/migrations/README.md`). The concurrency guarantees rest on the SQL
(one conditional statement each) and on the memory store's tests, not on a
real database. The 27 s rank's cause is inferred from the code, not measured.

**Open questions at the checkpoint:**
1. The deviations from the design document above: accept them?
2. B2-B's additions beyond the spec: replacing paused, past-due and pending
   subscriptions as well as on-hold ones, and answering 500 so Dodo
   redelivers an activation the webhook could not finish (a change to webhook
   handling).
3. `kind` comes from the client, so a modified client can buy up to four
   generations with one credit by sending cover letters as answers. Accept
   (bounded, and under the hourly cap), or tie an answer's improvements to
   its question?
4. When Dodo can't be asked about the linked subscription on the first read,
   the new one still links (checkpoint 9's rule, kept). Keep?

**Next:** batch B3. Open a new session and paste: `Run batch B3 of
docs/plans/active/completion-plan.md.` B4 applies migration 007 to the dev
project before anything else.

---

## 1. What was asked, and what was decided

Take the backend repo (`Aiko002/Onextap`) and put it behind the new frontends:
the landing page (`UncannySteel/DEMO_WEB`, kept as it is) and the dashboard
(`UncannySteel/DEMO_DASH`, whose four workspaces were empty placeholders and
are now built out with the backend's features, in the dashboard's design).

Decisions made with the owner before starting:

| Question | Decision |
| --- | --- |
| Layout | One repo, one site: landing at `/`, dashboard at `/dashboard/`, API at `/api/`. Base is the backend repo, keeping its env var names, routes, storage keys, message types and `vercel.json` build settings, so it can replace the live folder |
| Dashboard tooling | Vite added; still plain JS (no React) |
| Extension popup | Left as it is (React/Tailwind), only its dashboard links repointed |
| Testing | Against dev/staging keys the owner supplies (supplied 2026-10-10: a dev Supabase project and Dodo test mode; checkpoint 9) |
| Server additions | Real account deletion, a billing portal, the renewal date |
| Cancelling Premium | At the end of the paid period, not immediately |
| Avatar | Kept on the device (browser storage); Google photo, else initials |
| Copy | Fix wording that contradicts the backend: landing privacy page, landing pricing, dashboard plan list (words only, no design changes) |

---

## 2. Layout

```
/                               landing page            web/index.html, web/src/
/about/  /contact/  /privacy/   its company pages       web/{about,contact,privacy}/
/dashboard/                     dashboard               web/dashboard/
/dashboard/contact/ …/privacy/  dashboard's pages       web/dashboard/{contact,privacy}/ (+ web/dashboard/site/)
/api/*                          Express app             api/index.js → server/index.js
/privacy-policy(.html)          308 → /privacy/         vercel.json (the Web Store listing likely links it)
```

```
web/                    the website (Vite root; vite.dashboard.config.js builds it to dist-dashboard/)
  index.html, src/        landing page (from DEMO_WEB), plus src/app/backend.js + src/app/wire.js
  dashboard/              dashboard (from DEMO_DASH)
    js/services.js          the backend boundary (auth, account, plan, avatar, extension sync)
    js/ws/*.js              the four workspaces: job-matches, my-profiles, answer-studio, cover-letter
    js/ui/*.js              shared UI: dom builder, controls, switchers, file drop, fabrication notice
    css/workspaces.css      the workspaces' styles (dashboard tokens only)
    site/                   the dashboard's variants of the landing's company pages
  tests/, playwright.config.js   landing e2e tests (tests/stubs.js stands in for Supabase and the API)
src/                    shared client modules (auth, credits, profile/resume stores, matching…) + the popup
server/                 Express API (routes added and changed, see §4)
extension/, public/     Chrome extension (unchanged)
```

The website imports the shared modules through the `@app` alias (→ `src/`),
so the dashboard, the popup and the server use one copy of the matching code,
the profile store and the resume store.

---

## 3. Running it

```bash
npm install && npm run server:install
# put .env and server/.env in place — same variable names as before
npm run server:dev          # API on :3001
npm run dev                 # whole site on :5173 (landing /, dashboard /dashboard/)
```

- Keep the site on **port 5173** in development: it is the only local origin
  `extension/manifest.json` lets talk to the extension (`externally_connectable`).
- `npm run build` builds the extension into `dist/`. It needs `.env` in place
  first: a build without one has no Supabase address (§7, item 13).
- `npm run build:dashboard` builds the whole website into `dist-dashboard/`,
  which is what Vercel runs. The script name is kept so the Vercel project
  needs no change.
- `npm run dev:extension` is the old `npm run dev` (the crx dev server).
- `npm test`: see §5 and §7 for its state on this machine.

Env values keep their meaning:

- `VITE_DASHBOARD_URL` is still the site's origin (e.g. `https://www.onextap.com`).
  `src/config.js` appends `/dashboard/`, and accepts a value that already ends
  in `/dashboard`.
- `CLIENT_URL` is likewise still the origin. The server builds the checkout
  return URL as `<CLIENT_URL>/dashboard/?payment=success`.

---

## 4. What changed

### Server: `server/index.js`

| Route | Change |
| --- | --- |
| `GET /api/verify-premium` | Adds `nextBillingDate` and `cancelAtPeriodEnd` (read from Dodo; omitted if Dodo is unreachable) |
| `POST /api/cancel-subscription` | An **active** subscription is cancelled at the end of the period (`cancel_at_next_billing_date: true`); Premium stays on until Dodo's `subscription.cancelled` webhook turns it off. On hold, pending or past due: cancelled immediately, as before |
| `POST /api/resume-subscription` | **New.** Withdraws a scheduled cancellation ("Keep Pro") |
| `POST /api/create-portal-session` | **New.** Returns a link to Dodo's hosted billing portal |
| `DELETE /api/account` | **New.** Cancels every billable subscription of the account at Dodo first, not only the linked one (checkpoint 9; aborts if Dodo can't confirm), then deletes the Supabase auth user. `profiles`, `credit_transactions`, `rank_cache` and `rank_rate_limit` go with it by cascade |
| checkout | `return_url` now goes to `/dashboard/?payment=success` (`dashboardUrl()`) |

Schema: one new migration, `006_generation_rate_limit.sql`, for the hourly
draft ceiling (`server/generateLimit.js`, checkpoint 5; the generate route
answers 429 past it). Webhook handler: unchanged until checkpoint 9; since
then it acts only on the account's own subscription and cancels a second one
as it activates (`server/subscriptionGuard.js`, §7 item 30).

### Shared client: `src/`

- `config.js`: adds `DASHBOARD_PATH` and `SITE_URL`; `DASHBOARD_URL` now points at `/dashboard/`.
- `auth.js`: `signInWithOAuth(provider, { redirectTo })`.
- `creditManager.js`: adds `getAccount`, `getSubscription` (returns `error` rather than passing a failure off as "not premium"), `resumeSubscription`, `createPortalSession` and `deleteAccount`.
- `fabricationCorpus.js`: `loadFabricationCorpus` moved out of the React component so the dashboard can share it; `FabricationNotice.jsx` re-exports it.
- Popup: `components/OnextapDashboard.jsx` is popup-only now; `popup.jsx` sends anything outside the extension (including the old `?mode=dashboard`) to the web dashboard.
- **Deleted**, all replaced by `web/` and all still in git history:
  - the old React landing and dashboard: all of `src/components/dashboard/`;
  - `src/components/shared/ResumeSwitcher.jsx` and `useFileDrop.js` (only those pages used them);
  - `privacy-policy.html` (its content is now the landing's privacy page).

### Landing: `web/`, from DEMO_WEB

Behaviour only; the design is untouched.

- **Sign-in window**: real Supabase (email and Google) through `src/app/backend.js`.
  - Errors are shown in plain words.
  - A project that requires email confirmation gets "Check your email."
  - Sign-up uses the backend's password rule: 8+ characters with upper and lower case letters and a number.
  - "Continue" goes to the dashboard.
  - Supabase's SDK is loaded only when someone actually signs in.
- **Buttons**:
  - "Add to Chrome" (header and closing) opens the Chrome Web Store.
  - "Get started free" opens sign-up, or goes to the dashboard if already signed in.
  - "Upgrade to Premium" does the same, landing on the dashboard's plan panel.
  - Signed in, the header's "Log in" reads "Dashboard" and goes there.
- **Arriving to sign in**: the dashboard sends signed-out visitors to `/?login=1&next=…`. `next` may only point inside `/dashboard/`.
- **Forwarding script** (in the `<head>` of `web/index.html`): `?extensionId=`, `?view=`, `?payment=`, `?code=` and `#access_token=` are passed on to `/dashboard/`. That covers the published extension, checkouts started before the move, and Supabase redirects to the site root.
- **Feedback form** (Contact, on both the landing and the dashboard): posts to `POST /api/feedback`.
- **Copy changes.** Approved: pricing lists and privacy page. Added for consistency, needs review: FAQ and feature showcase.
  - Pricing lists: "5 autofills a day", "cloud backup", "high-quality / two-pass" removed. Premium is described as what it is, unlimited credits.
  - Privacy page: rewritten from the backend's privacy policy, in the landing's layout. Account deletion from the dashboard is added.
  - FAQ: three answers (what Premium adds, where data goes, whether you need an account).
  - Feature showcase: the storage tab, the "two-pass" note, and the mock window's "cloud backup" row.

### Dashboard: `web/dashboard/`, from DEMO_DASH

- **Real account.** The session is checked first, and anyone signed out is sent to sign in. The name comes from the account, then the profile, then the email. Credits show "Unlimited" on Premium.
- **Workspaces**, ported from the backend's React pages rule for rule:
  - **My Profiles**: the full profile editor; resume upload by picker or drop, merged over the form and filed in the resume library; save and sync to the extension; profile switcher (create, rename, delete, with Default protected).
  - **Answer Studio**: generate or improve with AI; tones; the credit rule (1 credit buys an answer plus 3 free improvements); the fabrication notice; saved answers.
  - **Cover Letter**: templates (10 per profile, from a file or pasted); personalise; saved versions per application; copy.
  - **Job Matches**: resume library; draft/applied filters; sort; ranked cards with evidence counts and matched/missing skills; every degraded-state notice; "Explain my fit" (1 credit, reopening is free); "how this run worked"; the last result survives leaving the page.
- **Settings**: change avatar (on this device); a subscription panel with four states (Standard, Pro renewing, Pro ending with "Keep Pro", Pro without dates); billing portal; log out; delete account (the dialog copy now says what is actually deleted).
- **Returning from checkout**: re-checks every 8 seconds for up to 2 minutes, as before. Since checkpoint 9, the plan panel shows "Payment received … no need to pay again" in place of "Upgrade" until Pro arrives, for up to 15 minutes, in every tab of that browser.
- **Other**:
  - The popup's old `?view=vault|cover|jobs|profiles` links open the right workspace.
  - `?upgrade=1` opens the plan panel.
  - The first-run tour is shown only to accounts made in the last 2 minutes.
  - The dashboard's Contact and Privacy pages are rebuilt from the landing's source instead of a hand-made copy.

### Config

- `package.json`:
  - scripts: `dev` (the website), `dev:extension`, `preview`, `test:e2e`;
  - added `gsap` and `lenis` (the landing's versions, pinned) and `@playwright/test`.
- `vite.dashboard.config.js`: rewritten. The Vite root is `web/`, env files load from the repo root, `@app` → `src/`, Tailwind's PostCSS is kept out, and the port is fixed at 5173.
- `vercel.json`: redirects for `/privacy-policy`, `/privacy-policy.html` and `/dashboard`; the single-page-app catch-all removed; build settings and cron unchanged.
- `.env.example` and `server/.env.example`: comments only.

---

## 5. What is verified, and what is not

**Verified**

- The website builds (`npm run build:dashboard`).
- The extension builds (done into a scratch folder, not `dist/`). The popup bundle points at `/dashboard/` and contains no old dashboard code.
- In a browser, against a local mock of the API and of Supabase's auth endpoints (the mock lived in a temp folder and is not in the repo):
  - **Landing**:
    - signed-out visit to the dashboard → sign-in window;
    - wrong password message;
    - sign-in → "You're in." → dashboard;
    - weak sign-up password;
    - "Check your email" sign-up;
    - "Upgrade to Premium" → sign-up → dashboard with the plan panel open;
    - Google (simulated) → dashboard;
    - log out;
    - forwarding of `?extensionId=…&view=vault` to Answer Studio;
    - header reading "Dashboard" when signed in;
    - feedback form.
  - **Dashboard**:
    - tour; settings menu;
    - My Profiles: resume drop → fields filled → save (same storage keys and shape as before); create, switch and delete profiles;
    - Answer Studio: generate (credits 3 → 2, 3 free improvements), free improve, fabrication notice, save, edit, delete;
    - Cover Letter: template, personalise (no credit spent, as it was before checkpoint 3's credit rule), save version;
    - Job Matches: ranking, notices, cards, explain (1 credit, reopening free), filters draft/apply, thin-pool empty state, restored result on return, refresh failure keeping results;
    - plan panel: upgrade → checkout return → Pro; renewal date; switch → pending → "Keep Pro"; billing portal in a new tab;
    - avatar; delete account; phone-width layouts.

- With the extension loaded unpacked in Chromium, against the same stubs
  (`npm run test:e2e:extension`, checkpoint 7):
  - dashboard save → the extension's profile store → the popup → autofill
    of a form with the dashboard's latest edit (§7 item 1);
  - the popup's cover-letter credits, with a session put in place by hand
    (§7 items 8 and 27);
  - signed out, the popup's Cover Letter tab → the dashboard's workspace →
    a saved version → back in the popup, filled into a form (checkpoint 8).

**Against real services, 2026-10-10** (a dev Supabase project, Dodo in test
mode, real Groq and Gemini; checkpoint 9 has the detail):

- email sign-up with confirmation, the profile row, the name, 3 credits;
- resume upload (Gemini), Answer Studio generate and its credit, a free
  improvement, the hourly ceiling;
- cover-letter credits: charge, free re-run, a new description charges;
- Job Matches on a real pool (1,751 listings) and "Explain my fit" (after
  the checkpoint 9 fix, on a Pro account);
- Dodo test checkout → webhook → Premium, the billing portal, Switch to
  Standard → Keep Pro;
- delete account: the user, the rows, the linked subscription;
- profile sync with this branch's extension loaded and a real sign-in, and
  forgot password with a real inbox (both by the owner, who reported them
  working).

**Not verified**

- **Still open against real services**: Google sign-in; Dodo's
  `subscription.cancelled` at the end of a real period; "Explain my fit"'s
  one-credit charge on a free account after the checkpoint 9 fix; a real
  double checkout (§7 item 30); anything in production. From checkpoint 12:
  migration 007 on the dev project and server-side charging against it (a
  charge, a free improvement, a re-run, two quick presses with one credit,
  the 503 before it is applied), the on-hold replacement with real Dodo
  subscriptions, the Improve guard and a rank's `meta.timings` with real
  models.
- **The store extension (1.0.2) itself**: never against real services. Since
  checkpoint 11 it runs in the legacy e2e (an unpacked copy, the site on
  localhost, the API stubbed): its "Unknown action" handshake, the sync, the
  out-of-date copy, a resume parsed without it. Its installed files were
  read while planning (`docs/plans/active/completion-plan.md` §2: the four
  messages its worker answers, its manifest, its links); before that, this
  document's claims came from reading `main` (§7 item 1). Checkpoint 10 keeps
  an unpacked copy for the legacy e2e tests B1 adds.
- **The popup's cover-letter credits for a real user**: no user can reach
  them (§7 item 27), and the check was dropped at checkpoint 9.
- Safari and Firefox.

**Unit tests (`npm test`) on this machine** (Node 25, Windows):

- At the first handover: 505 pass, 39 fail, 2 skipped out of the box; the 4
  that survived `--no-experimental-webstorage` fail the same way on the
  untouched original clone (§7, item 11).
- Checkpoint 1: 541 pass, 3 fail (the missing fixture file).
- Checkpoint 3: 562 pass; checkpoint 4: 564 pass.
- Checkpoint 5: 572 pass, 0 fail, 2 skipped, with
  `server/data/cached_jobs.json` in place (untracked; without it, 3 fail).
- **Checkpoint 9: 577 pass, 0 fail, 2 skipped** (the 5 new ones are
  `test/server/subscriptionGuard.test.js`). The e2e suites were not re-run.
- **Checkpoint 10: 660 pass, 0 fail, 2 skipped.** The 83 new ones are
  `test/rules/`: CLAUDE.md rules 4, 5, 7, 9 and 10, and every route answering
  through `test/server/harness.js`, which imports the real app with dummy env,
  no `server/.env` and no network. **Lint** (`npm run lint`, new): 0 errors,
  1 warning.
- **Checkpoint 11: 741 pass, 0 fail, 2 skipped.** The 81 new ones: the
  extension protocol (the worker's routing and sender checks, 1.0.2's four
  messages, the website's client, resume parsing), the landing's session key
  and the Job Matches label. The ones that load `src/` need Node 22.15+.
- **Checkpoint 12: 864 pass, 0 fail, 2 skipped.** The 123 new ones: the spend
  rules and their SQL (`generationSpend.test.js`), the charging routes through
  the harness with a fake Supabase and Groq on loopback
  (`generationCharging.test.js`), subscription linking and the webhook, the
  Improve guard (unit and route), versioned skill names, and rank timings.
  Keyless evals (`npm run evals`) unchanged: 8 pass, 2 skipped (the LLM
  evals, opt-in), fabrication recall 100%, false positives 0%, profile
  fields 94.6%.

**E2E (`npm run test:e2e`)**, at checkpoint 5, and again at checkpoint 10: 188 pass, 10 skipped
(197 at checkpoint 11, with the new copy tests; 200 at checkpoint 12, with Answer Studio's server-side charging)
(keyboard and wheel tests on the phone profile), 0 fail, across desktop
Chromium, phone Chromium and WebKit. It covers the landing page, its company
pages, the 404 page, the account flows (sign-up's name, forgot password, the
reset page) and one dashboard flow (cover-letter credits, signed in through
the stubs). WebKit on Windows is slow enough to catch a page mid-transition;
two such flakes were fixed at checkpoint 1. A lesson from checkpoint 5: assert
that a card is *visible* before trusting its words, since words already in
the markup pass `toHaveText` while the card is hidden.

**E2E with the extension (`npm run test:e2e:extension`)**, from checkpoint 7:
3 tests since checkpoint 8, 15 of 15 over five repeats (3 of 3 again at checkpoint 10; since
checkpoint 11 a `legacy` project adds 3 against the real store 1.0.2, skipped unless
`E2E_LEGACY_EXTENSION_PATH` is set: 6 of 6), in Chromium with the
extension loaded unpacked. It builds its own copy of the extension with unresolvable
addresses, runs the website on 5173 (it stops if something is already
there), and uses the same stubs. A sign-in to the popup is put in place by
hand, since the popup has none (§7 item 27).

---

## 6. Before going live

1. **Finish the real-service run** (done on a dev project at checkpoint 9; §5 lists what is left): Google sign-in, the end-of-period cancellation, a real double checkout (§7 item 30), and the owner's decisions on items 1, 29 and 31.
2. **Supabase → Authentication → URL Configuration**: add `https://www.onextap.com/dashboard/` and `https://www.onextap.com/reset-password/` (and their `http://localhost:5173/...` twins for development) to the Redirect URLs. Apply migration 006 (§9).
   - The Site URL can stay the root: the landing forwards tokens that land there.
   - Keep the extension's `https://<extension-id>.chromiumapp.org/` entry.
3. **Dodo**:
   - confirm the customer portal is enabled for the live account (done in test mode);
   - in test mode, confirm that cancelling at period end keeps Premium until the date and that `subscription.cancelled` then arrives;
   - the live webhook endpoint is `https://www.onextap.com/api/webhook`, and `DODO_PAYMENTS_WEBHOOK_KEY` in Vercel is the live endpoint's secret, copied with Dodo's button (§9 lists the two ways this broke on dev).
4. **Vercel**: same env var names; `VITE_DASHBOARD_URL` and `CLIENT_URL` stay the site origin.
5. **Chrome Web Store**:
   - **the published version is 1.0.2** (not 1.0.3: `docs/plans/active/completion-plan.md` §2), and the site must keep working with it. The owner decided at planning (session 6) that 1.0.4 is built and fully tested, and that submitting it is their later call; the plan stops at a release zip. What follows describes what that release carries: checkpoint 2's profile-sync fix and checkpoint 8's dashboard link in the popup's Cover Letter tab (§7 item 27). Until it ships, the published popup (1.0.2) still misses dashboard edits made after it first opened. §7 item 28 (popup-made templates lost at the next dashboard save) is decided: option a, popup templates become read-only;
   - it also links straight to `/dashboard/` (the landing forwards the old link meanwhile);
   - point the listing's privacy URL at `/privacy/` (the old URL redirects).
6. **Check `docs/app-flow.md` against the real run** (§7, item 4; the run happened at checkpoint 9), and fix it where they disagree.
7. **Production Supabase**: apply migration 006 (ask first, CLAUDE.md) and record it in `supabase/migrations/README.md`. Confirm the store build's Supabase project is the one the production server verifies tokens against (unpack the CRX; compare hosts, never keys).
8. **Merge and push.** Each checkpoint is committed on the branch `merge/web-dashboard`.

---

## 7. Problem areas: found and still open

Ordered by priority. "Pre-existing" means the backend repo already had it
before this work.

### High

**1. The extension never receives profile edits made on the web dashboard after its popup has opened once.** Pre-existing.
- **Cause:**
  - The dashboard sends `ONEXTAP_SYNC_DATA`, and the service worker writes only `user_profile` (`extension/background.js`).
  - The popup reads the profile store, `onextap_profiles`, through `loadProfileStore()`.
  - `onextap_profiles` is created the first time the popup opens, and `user_profile` is ignored from then on.
- **Result:** autofill keeps using the popup's own copy, and the dashboard's "Saved and synced" does not reach it.
- **Fixed in code at checkpoint 2** (§0), with the owner's go-ahead: the handler files the payload into `onextap_profiles` and makes it active (`extension/profileSync.js`, unit-tested against `src/profileStore.js`). **Checked at checkpoint 7 with the extension loaded**, against stubs (`npm run test:e2e:extension`): the dashboard's second edit is what the popup's autofill fills, and with the old worker it is not. **Checked at checkpoint 9 with a real sign-in**, the local build loaded: passes.
- **But the owner said at checkpoint 9 that the site has to plug into the store extension**, then thought to be 1.0.3 and in fact 1.0.2, with no release planned (since session 6: 1.0.4 is built and tested, submission is the owner's later call). That build has the old worker, so for its users this item stays open, and the website cannot work around it: 1.0.2's worker accepts `ONEXTAP_SYNC_DATA`, `PARSE_RESUME`, `SCRAPE_ACTIVE_TAB` and `GENERATE_IMPROVED_ANSWER`, and none of them writes `onextap_profiles`. In practice: install, click the icon (the store is created, empty), set up the profile on the website, and the popup still says "Welcome to Onextap". The website meanwhile says "Saved and synced to the extension", because the old worker answers `success: true` regardless. Production, if it runs `main`'s website, has the same today. **Options:** a minimal 1.0.4 with only this fix (`extension/background.js` + `extension/profileSync.js`, a version bump); and in any case, the website's copy should stop claiming the sync (§0 checkpoint 9, option a).
- **Checkpoint 11 (B1): the website stopped claiming it.** It asks the extension `ONEXTAP_HELLO` first (`docs/extension-protocol.md`): 1.0.2 answers "Unknown action", and after a save the status says the extension is out of date, with a link to the store; the sync is still sent, which helps a fresh install. A current build answers with its version and `profile-sync`, and only then does the status say "Saved and synced". Store users still need 1.0.4 for the sync itself (batch B3). The legacy e2e checks this against the real 1.0.2.

**2. ~~Never run against real services.~~ Run at checkpoint 9**, against a dev Supabase project and Dodo in test mode: every line below passes (§0 has the detail), except Google sign-in, not tried, and the extension one, which passes with this branch's build only (item 1). Production itself has not been touched. The list, for the next real-service run:
- email sign-up with confirmation;
- email sign-in and Google sign-in (after adding the redirect URL, §6);
- resume upload (Gemini);
- Answer Studio generate (Groq), including a credit deduction;
- cover letter personalise;
- Job Matches rank and "Explain my fit" (with its credit; at checkpoint 9 checked on a Pro account only);
- Dodo test checkout → webhook → Premium in the dashboard;
- billing portal;
- switch to Standard → the panel shows the end date → "Keep Pro";
- delete account (check the Supabase user, `profiles` row and Dodo subscription are gone);
- profile sync with the extension loaded (keep item 1 in mind).

**3. ~~The landing's Playwright suite is broken by the wiring.~~ Fixed at checkpoint 1** (§0). The four tests that expected the old `onextap:login` / `onextap:feedback` stubs now stub the network (`web/tests/stubs.js`) and assert the request bodies. Playwright 1.63 and its browsers are installed on this machine.

**4. ~~Docs.~~ Done:** updated at checkpoint 2, and `docs/app-flow.md` rewritten from the code at checkpoint 4. It is traced and stub-tested; the real run (checkpoint 9) has happened but the doc has not been checked against it yet (§6 item 6).

**29. The dashboard trusts `?extensionId=` from the link.** Pre-existing (`src/extensionClient.js`, the same on `main`). Whatever ID the link names gets the active profile, and through `PARSE_RESUME` the resume file and the Supabase access token (`web/dashboard/js/services.js`, `src/resumeParse.js`). Chrome delivers only if that extension lists the site's origin in its own `externally_connectable`, so an attack needs an installed extension that does, plus a crafted link. Found at checkpoint 9. **Fixed at checkpoint 11 (B1), option b:** `resolveExtensionId()` in `src/extensionClient.js`. Outside `localhost` and `127.0.0.1` the site only messages `EXTENSION_ID_FALLBACK`, whatever the link says; on localhost `?extensionId=` wins if it has an extension ID's shape (32 letters a–p), for unpacked builds. Inside the extension it addresses itself, never the store ID. The resume no longer goes to the extension at all (item 31). Unit-tested; not deployed.

**30. One account could end up with two Dodo subscriptions. Fixed in code at checkpoint 9, not yet tested with a real double checkout.** Checkout refuses an account that is already Pro, but an account becomes Pro only when the first `subscription.active` lands, so two checkouts in that window (two tabs, a slow or failing webhook) made two subscriptions, and the app tracks one. It was worse than double billing: every webhook acted on the account whatever subscription it named, so cancelling the stray one switched Pro off, and deleting the account cancelled only the linked one. The fix (`server/subscriptionGuard.js`, the webhook and `DELETE /api/account`, now in `server/routes/webhook.js` and `server/routes/account.js`, `web/dashboard/js/subscription.js`) is in §0, checkpoint 9. **Left open:**
- the cancelled duplicate's payment is refunded by hand in Dodo (the log names both subscriptions); automating it needs the payment id from `payment.succeeded`;
- two activations processed in the same instant can both link; account deletion cleans that up. **Fixed in code at checkpoint 12 (B2):** linking is one conditional write (`supabaseLinkStore()` in `server/subscriptionGuard.js`, lands only if the link is still what was read), so one activation links and the other re-reads and cancels itself as a duplicate; if Dodo can't be asked on that re-read, the webhook answers 500 and Dodo redelivers;
- a linked subscription on hold is not cancelled when a new one replaces it. **Fixed in code at checkpoint 12 (B2):** the new one links first, then the stalled one (on hold, paused, past due or pending) is cancelled through Dodo, so the cancel's own `subscription.cancelled` is foreign to the account and can't switch Pro off. A failed cancel is logged with both ids for a manual cancel.

Both are unit-tested with Dodo and Supabase faked; neither has met a real double checkout (B4).

**26. Any account could mint credits through `POST /api/credits/refund`. Fixed at checkpoint 4 on this branch; production keeps the hole until this branch is deployed.** Pre-existing since the first commit (Feb 2026): the route added a credit for any signed-in, non-Premium account, with no check that a charge had happened, no limit, and no caller anywhere in the product. Removed, with `test/server/routes.test.js` to keep it out (§0).

### Medium

**5. The pending cancellation is not stored locally.** The dashboard learns about it from Dodo, via `verify-premium`. If Dodo can't be reached, the panel shows plain "Pro" with no dates, and "Switch to Standard" can be pressed again. Ending Premium depends on Dodo sending `subscription.cancelled` at the period's end (unverified, see item 2).

**6. Account deletion can fail halfway.** If Dodo cancels the subscription and then Supabase `deleteUser` fails, the user has no subscription but still has an account. The user is told to try again, and a retry completes it (the subscription is no longer billable, so the Dodo step is skipped).

**7. Supabase redirect allowlist.** Google sign-in and email confirmation depend on the configuration in §6. Without `/dashboard/` on the allowlist, Supabase falls back to the site root and the landing forwards the tokens. At checkpoint 9, email confirmation and the reset link worked on the dev project with the `localhost` entries; Google and the production allowlist are untested. This path was tested only against the mock.

**8. ~~Cover-letter personalisation never spends a credit.~~ Done at checkpoint 3**, by the owner's decision: 1 credit buys a personalisation plus 1 free re-run, on the dashboard and in the popup (§0). The dashboard's half passed against real services at checkpoint 9; the popup's half reaches no store user (item 27). The popup's half is checked with the extension loaded (checkpoint 7), but no user reaches it until item 27 is settled, and then only with a new extension release (§6).

**27. The popup cannot sign in, so its cover-letter AI is unreachable.** Pre-existing. Found at checkpoint 7. (Since checkpoint 9, with no release planned, the fix below reaches no store user; the same goes for item 28.) **The owner chose a) at checkpoint 8, and it is done:** signed out, the popup's Cover Letter tab says personalising is on the dashboard and opens its Cover Letter workspace (with `?extensionId=`, so versions saved there sync back to the popup's "Saved versions", ready to fill). The signed-in path is kept, dormant, for a sign-in later (option b). Reaches users with the next extension release.
- **Cause:** the popup keeps its own Supabase session in `chrome.storage.local` (`src/supabaseClient.js`), and nothing in it signs in: `signIn` and the extension's Google flow in `src/auth.js` (`chrome.identity.launchWebAuthFlow`) have no caller. Signing in on the website stores the session in the website's `localStorage`, which the extension cannot read. At `bae4abc` the only caller was the old dashboard rendered inside the extension at `?mode=dashboard`, which no button opened; this branch sends that address to the website.
- **Result:** in the popup's Cover Letter tab, "Personalize" stays greyed out, with no word of why. Templates, saved versions and "Fill page" still work. Autofill needs no session and is unaffected.
- **Options (the owner's call):**
  - **a)** Say so in the popup and send the user to the dashboard's Cover Letter workspace (`?view=cover`) to personalise. Smallest; honest; the popup's AI path stays dormant.
  - **b)** A sign-in in the popup: email and password, plus Google through the existing `launchWebAuthFlow` path (needs `https://<extension-id>.chromiumapp.org/` on Supabase's Redirect URLs, §9). The user signs in twice, once per surface; logging out of one leaves the other signed in.
  - **c)** Hand the website's session to the extension over `externally_connectable`. One sign-in, but both clients would then hold one refresh token, and Supabase rotates refresh tokens and can revoke the whole session when a used one comes back, signing out both. It also puts tokens on the extension's message channel. Not recommended without a design of its own.

**28. A cover-letter template made in the popup is lost at the next dashboard save.** Found at checkpoint 8. A side effect of checkpoint 2's sync fix (item 1); not released yet.
- **Cause:** `fileSyncedProfile()` (`extension/profileSync.js`) replaces the extension profile's `coverLetters` with the dashboard's list, and the dashboard's list never holds the popup's templates: nothing syncs from the extension to the website.
- **Result:** a template added or uploaded in the popup, or an edit made to one there, disappears the next time the user saves on the dashboard (profile, answers or cover letters) with the extension connected. Templates and versions made on the dashboard are fine, and that is now where item 27 sends people.
- **Options (the owner's call; CLAUDE.md asks first for changes to the sync):**
  - **a)** Make the popup's templates read-only: no Upload, Add or editing there, and a pointer to the dashboard to manage them. Fits the popup's stance of not being a profile editor (`docs/app-flow.md` §1). Small; no change to the sync.
  - **b)** Merge by id in `fileSyncedProfile()`, keeping templates the dashboard does not have. But then a template deleted on the dashboard would live on in the extension, unless deletions are recorded (tombstones): more design than it looks.
  - **c)** Leave it, and say in the popup that templates made there are not kept.

**9. Logging out deletes this browser's profiles** (`user_profile` and `onextap_profiles`). Resumes and the avatar stay. **Decided at checkpoint 2: keep it** (the backend's behaviour).

**10. "Delete account" clears only this browser.** The extension's `chrome.storage` copy and other devices keep their local data. The dialog now says so.

**11. `npm test` failed on this machine for three environmental reasons.** All pre-existing, and all reproduce on the untouched original:
- ~~**Node 25 exposes a global `localStorage`**~~ — fixed at checkpoint 1 (`src/storage.js` checks for `getItem`).
- **`server/data/cached_jobs.json` is not in git.** `.gitignore` has `server/data/`, and git history has no such file, though `server/jobs/adapters/cache.js` and 3 tests expect ~40 synthetic listings there. At checkpoint 3 the owner put the file in place on this machine and chose to keep it untracked, so the 3 tests pass here and fail on a clone without it: copy it by hand (§9). To track it instead, `.gitignore`'s `server/data/` has to become `server/data/*` + `!server/data/cached_jobs.json` (a negation cannot re-include a file inside an ignored directory). Mind the hazard in `cache.js`'s header: with the file present, a local ingest against a real project seeds fake listings unless `ALLOW_CACHE_SOURCE=false` (which `server/.env.example` already sets).
- ~~**Windows line endings** break `test/server/logger.test.js`~~ — fixed at checkpoint 1 (splits on `/\r?\n/`).

**12. The published extension (1.0.2) still opens `onextap.com/?extensionId=…`.** (Checked in its installed files at checkpoint 10: it opens `https://www.onextap.com?extensionId=<id>`.) The landing forwards it to the dashboard (tested). A new release links straight to `/dashboard/`. Publishing is the owner's call.

**13. `dist/` was built here without a `.env`** at checkpoints 1 to 3; since checkpoint 6 with a `.env`, the production one until checkpoint 8 and the dev one since checkpoint 9. The rule below stands: build after the `.env` you mean. That build has no Supabase address, so its Supabase client cannot start (the dev dashboard without a `.env` stops on `supabaseUrl is required`; the popup uses the same `src/supabaseClient.js`). Run `npm run build` again once `.env` is in place, before loading the unpacked extension.

### Low

**14. ~~Landing copy that is still aspirational.~~ Rewritten at checkpoint 11 (B1)**, words only, after checking each claim against the code: an unknown field is left empty (nothing is flagged or bound), a profile custom field named the way forms print it fills it from then on, and Premium only skips the credit charge (same models, no support tier). The before → after list is in §0, checkpoint 11. The site does not say Premium uses the same AI as Free (the owner's call at checkpoint 11). **Still not quite true, kept by the owner's call at checkpoint 11:** "every field, on every board" (hero, About, FAQ 1); "activates automatically" (it is injected on demand); the demo's "Mapped" `work_authorization` and `years_of_experience` (no built-in match); "No limits on the AI" and "Unlimited AI answers" (every plan has an hourly ceiling of 30 drafts). What it said before:
- **The feature showcase's "Mapping" tab** describes flagging an unmapped field and binding it in one click. No such flow exists; custom profile fields are the closest thing.
- **The FAQ** says a new field is "flagged, never guessed".
- **"Priority support and early access"** is not something code can verify.

**15. ~~No "forgot password" flow.~~ Fixed at checkpoint 5:** "Forgot password?" in the sign-in window, and the `/reset-password/` page (§0). Needs `<site>/reset-password/` on Supabase's Redirect URLs. Tried with a real inbox on the dev project at checkpoint 9 (the owner reported it working).

**16. ~~The landing's sign-up form has no name field.~~ Fixed at checkpoint 5:** an optional name, stored as the account's `full_name`. Without one, the dashboard's name still falls back to the profile's, then the email's local part.

**17. The web dashboard can't read the open job page or fill a form.** It has no tab access, so job descriptions are pasted. The popup keeps both abilities.
- This also fixes a bug: the old dashboard's "scrape the active tab" scraped the dashboard itself, and for cover letters that overrode what the user pasted.
- The service worker's `SCRAPE_ACTIVE_TAB` is unchanged; it only makes sense from the popup.

**18. ~~Preview deployments call the production API.~~ Fixed at checkpoint 4:** with `VITE_API_URL` empty, a production website build calls its own origin, and the extension `https://www.onextap.com` (`src/config.js`).

**19. Leftover code.**
- ~~`src/index.css` still holds the old dashboard's CSS: dead but harmless.~~ Not dead (checked at checkpoint 11): `src/popup.jsx` imports it as the popup's Tailwind entry. Kept.
- `src/consent.js` is unused, and kept on purpose as the future analytics consent gate.

**20. ~~Unknown URLs get Vercel's default 404.~~ Fixed at checkpoint 4:** `web/404.html` (a Vite entry, so it shares the site's styles), built to `dist-dashboard/404.html`.

**21. ~~Job Matches shows "Scoring 30 of 30 jobs" immediately.~~ Fixed at checkpoint 11:** the label claims no running count. It reads "Scoring the closest of N jobs in the pool", with N from `/api/jobs/meta` and only while no filter is applied, else "Scoring the closest jobs in the pool" (`web/dashboard/js/ws/job-matches-label.js`, unit-tested). Not seen in a browser: no e2e covers Job Matches, and a real rank needs real services (B4).

**22. No application-type picker on the web dashboard.** Job is the only live type, as in the backend. Bringing the others back needs a picker there as well as in the popup.

**23. The landing's "signed in?" check reads Supabase's default storage key** (`sb-<ref>-auth-token`), in `web/src/app/backend.js`. A custom `storageKey` would break it. **Checkpoint 11:** worked out in one pure place, `web/src/app/session.js`, and `test/web/session.test.js` builds real supabase-js clients with `src/supabaseClient.js`'s options and fails if the keys ever differ, a custom `storageKey` included. Loading the SDK on the landing just to ask would cost its first paint. Still a derivation: an explicit key both sides import would remove it, a candidate for B3, whose wipe needs the same key.

**24. ~~The website never installs the client logger's global handlers.~~ Fixed at checkpoint 3:** every website entry calls `installGlobalErrorHandlers()`, so uncaught errors go through the logger and `__onextapIssues()` works in the console there too.

**31. Resume upload goes through the extension when it is installed.** `src/resumeParse.js` sends `PARSE_RESUME` to the service worker, which posts to the API address built into the extension. With the store build on a local site, that is production's API with a dev token: a 401. In production it works, but it ties the website to the old worker (the store's 1.0.2 replies with `data` but no `text`, so it drops the resume text, and the page falls back to a rougher parse). `parseResumeViaApi()` already does the same without the extension. Found at checkpoint 9. **Proposed:** always call the API directly. Decided at planning (session 6): option c. **Fixed at checkpoint 11 (B1):** `src/resumeParse.js` always calls `POST /api/parse-resume` itself, on every surface; the website never sends `PARSE_RESUME`, and the worker still answers it for the website already deployed. The legacy e2e parses a resume with store 1.0.2 installed, transcription included.

**32. Seen during the real-service run, not fixed.** From one run each, so impressions, not measurements:
- Answer Studio's "Improve" left a draft with more claims the resume does not back (1 → 4). The claim check flagged all four; the improvement prompt invents figures.
- Job Matches lists "HTML · required" as not in the resume beside a matched "HTML5".
- A rank took 27s; the page says "usually 5-20 seconds".

**Addressed in code at checkpoint 12 (B2), none of it measured against a real service yet:**
- Improve (Answer Studio's, an explicit `kind: 'answer'` with a draft): the prompt carries `IMPROVE_FACTS_RULE` (`server/prompts/answerVault.js`): no number, employer, title or tool that is in neither the profile nor the draft, though the target organisation and role may be named. After the model answers, `server/lib/improveGuard.js` counts unbacked claims in the old draft and the new one; more in the new one means one retry, with the offending sentences listed, and the answer with fewer flags is kept. No retry starts after 30 s into the request, and the retry has a 15 s timeout. It's not charged again, and the flags returned are those of the answer kept. Cover letters and old clients get exactly the old prompt.
- HTML vs HTML5: an explicit list of versioned names (`VERSIONED_NAMES` in `src/matching/lexicon.js`: html, css, php, vue, angular, bootstrap, webpack, java, swift, oauth) folds `html5`, `html-5`, `css3`, `vue3` and the like in extraction, in stored job terms and in the claim check. S3, EC2, Web3, ES6, D3, K8s, C++ and Python 2/3 are unchanged (tests). Plain "HTML5" already matched through an alias, so the chip seen in the real run may have been the model's.
- The 27 s: a default rank is one model call writing ~3,600 tokens, so there is nothing independent to parallelise (splitting the batch would cost more of the 20-a-day Gemini quota and move scores). The likely cause is the model order: `server/.env.example`'s commented `GEMINI_RANK_MODELS` listed the slowest model first, and a model that can't finish 30 jobs inside `GEMINI_RANK_TIMEOUT_MS` (25 s) times out before the next one answers. The example line now matches the code's default order. Every stage is timed (debug logs and `meta.timings`); a broadening loop no longer re-scores jobs an earlier loop scored. The page now says "usually takes 10–30 seconds, and longer when the AI service is busy". To check in B4: the dev env's `GEMINI_RANK_MODELS` order (pass/fail only) and `meta.timings` from a real rank.

**25. Answer Studio and cover letters are charged by the client, after the fact.** Pre-existing for Answer Studio, and cover letters now follow the same pattern: the page calls `POST /api/answer-vault/generate`, which charges nothing, and then `POST /api/credits/deduct`. A modified client can skip the second call and generate for free. The balance itself cannot be tampered with (rule 6), and "Explain my fit" is charged inside its own route, so this is the one gap. Closing it means charging in the generate route and keeping the free improvements and re-runs on the server: a pricing-adjacent change, so the owner's call. Found at checkpoint 3. **Design written at checkpoint 4:** `docs/plans/active/server-side-generation-charging.md`. **The owner chose "not now" at checkpoint 5**; the hourly ceiling added then (`server/generateLimit.js`) bounds the quota damage, not the free drafts. **Decided at planning (D7), fixed in code at checkpoint 12 (B2), not applied anywhere:** the generate route spends before the model through `spend_generation()` (migration 007), gives the spend back through `undo_generation()` if the generation fails, and keeps the free improvements and re-runs on the server as allowances; `POST /api/credits/deduct` is a no-op that answers with the balance. "Explain my fit" spends through the same function. Until 007 is applied, both routes refuse with a 503 (fail closed). Details in §0, checkpoint 12. **Left open:** `kind` is the client's word, so a modified client can send cover letters as `answer` and get 3 untied follow-ups instead of 1 re-run (1 credit buys at most 4 generations, under the hourly cap); a request the client gives up on after the server spent is charged with nothing shown (the 90 s client timeout; the Improve retry is bounded to stay well inside it); a refused generation still uses an hourly slot.

### Found and fixed along the way (for the record)

- The old dashboard sent the dashboard's own page text to the AI as "the job description" (item 17).
- The popup's Dashboard button passed its click event as the `?view=` value.
- A redirect loop between the landing and the dashboard when a stored session is dead is prevented: the dashboard drops the session before redirecting, and the landing always opens the sign-in window.
- Cover-letter edits no longer get lost when leaving the workspace or switching profile mid-save.
- "Explain my fit" cut off mid-JSON by a token cap that `gpt-oss-120b`'s reasoning shares (checkpoint 9).
- An ERROR logged on every Pro account's deletion, for a webhook that arrives after the profile is gone (checkpoint 9).

---

## 8. Housekeeping

- The mock servers and scratch builds lived outside the repo, and their `.claude/launch.json` entries were removed. `.claude/launch.json` now has `web` (the site on 5173), `api` (the server on 3001) and `web-preview`.
- Committed on the branch `merge/web-dashboard`, one commit per checkpoint, and pushed to `latest` (`github.com/UncannySteel/OneXtap-latest`) from checkpoint 4 on. Nothing has been deployed.

---

## 9. Setting up on another machine

The code travels through GitHub. These things do not, and the next machine
needs them before anything can be tested against real services.

### Getting the code

- It is on GitHub: `https://github.com/UncannySteel/OneXtap-latest` (public),
  branch `merge/web-dashboard`, which is the repo's default branch. So
  `git clone https://github.com/UncannySteel/OneXtap-latest.git` is all it
  takes.
- On this machine the remote is `latest` (`origin` is still the backend's
  repo, `Aiko002/Onextap`, and was never pushed to). New commits here go up
  with `git push latest merge/web-dashboard`.

### Software

- Git, and Node.js **21 or later** with npm (22 LTS is fine; this machine ran
  25.8). Node 18 runs the app but not `npm test`, which passes a glob to
  `node --test`.
- Google Chrome, to load the unpacked extension.
- For `npm run test:e2e`, Playwright's browsers, once:
  `npx playwright install chromium webkit`. That also installs the full
  Chromium that `npm run test:e2e:extension` needs (extensions do not load in
  the headless shell). If it fails to start with "side-by-side configuration
  is incorrect", as on the first machine, copy its `chrome-win64` folder
  to `%USERPROFILE%\onextap-e2e\chrome-win` and set `E2E_CHROMIUM_PATH` to
  the copy's `chrome.exe`. Not to a folder directly under `%LOCALAPPDATA%`:
  on the first machine a copy there fails the same way.

### Files that are not in git

| File | Holds | From |
| --- | --- | --- |
| `.env` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL=http://localhost:3001`, `VITE_DASHBOARD_URL=http://localhost:5173` | `.env.example`, with the dev project's values |
| `server/.env` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, the Dodo test-mode key, webhook secret and product id, `CLIENT_URL=http://localhost:5173`, `RESEND_API_KEY`, `CRON_SECRET`, `ALLOW_CACHE_SOURCE` | `server/.env.example`, which documents the optional rest |
| `server/data/cached_jobs.json` | The 40 synthetic job listings, kept untracked by the owner's choice | Copy it from this machine. Without it, 3 unit tests fail and the offline job source is empty |

Never commit either `.env` (both are gitignored; CLAUDE.md rule 10).

### Accounts and settings, on a dev project

- **Supabase**, a dev project, not production (CLAUDE.md asks first for
  anything against production):
  - SQL Editor: `supabase/schema.sql`, then
    `supabase/migrations/002_rank_cache.sql` and
    `supabase/migrations/006_generation_rate_limit.sql` (`schema.sql` already
    includes 001, 003, 004 and 005). Record it in
    `supabase/migrations/README.md`.
  - Authentication: the email provider (decide whether addresses must be
    confirmed), and Google if Google sign-in is to be tested.
  - URL Configuration → Redirect URLs: `http://localhost:5173/dashboard/`,
    `http://localhost:5173/reset-password/` (the reset email's link), and
    `https://<extension-id>.chromiumapp.org/` with the unpacked extension's ID
    (shown at `chrome://extensions`), for Google sign-in from the popup if
    §7 item 27 gives it one (nothing in the popup signs in today).
- **Dodo Payments**, test mode: a subscription product, an API key, a webhook
  secret, and the customer portal enabled. For webhooks to reach a local
  server, point the webhook at a tunnel to `http://localhost:3001/api/webhook`.
  What worked at checkpoint 9, on Windows:
  - `winget install --id Cloudflare.cloudflared`, then, in a **new** terminal
    (the old one keeps its PATH; the binary is in
    `C:\Program Files (x86)\cloudflared\`),
    `cloudflared tunnel --url http://localhost:3001`. No account needed. It
    prints a `https://<words>.trycloudflare.com` address; the first request
    can time out, so run it again.
  - Dodo's endpoint is that address **plus `/api/webhook`**. The address
    changes every time the tunnel restarts, so update the endpoint then.
  - Copy the signing secret with Dodo's copy button into
    `DODO_PAYMENTS_WEBHOOK_KEY`: `whsec_` and then base64. Restart the API
    after changing `server/.env` (`node --watch` does not watch it).
  - If Premium does not arrive, read the API log: a 404 on the webhook path
    is the endpoint URL; "Base64Coder: incorrect characters for decoding" is
    the secret itself, not the signature. Then resend from Dodo's delivery
    log.
- **Groq** and **Gemini** keys. Check which Groq model ids the key can reach
  (`server/.env.example` says how).
- **Resend**, to test the feedback form (mind its sandbox limit, in
  `server/.env.example`).
- **A job pool** for Job Matches: run the ingest once
  (`curl -H "X-Cron-Secret: <CRON_SECRET>" http://localhost:3001/api/jobs/ingest`),
  or, on a dev project only, set `ALLOW_CACHE_SOURCE=true` to ingest the
  fixtures. `GET /api/jobs/meta` shows what the pool holds.

### First run

```bash
npm install && npm run server:install
# put .env, server/.env and server/data/cached_jobs.json in place
npm run lint          # expect 0 errors (1 warning)
npm test              # expect 660 pass, 0 fail
npm run test:e2e      # expect every test to pass
npm run test:e2e:extension   # 3 tests; needs port 5173 free
npm run build         # after .env: then Load unpacked → dist/ at chrome://extensions
npm run server:dev    # API on :3001
npm run dev           # the site on :5173
```

Open the dashboard from the extension's popup: it passes the unpacked
extension's ID, which the sync needs.

### Then check by hand

Nothing automated covers these. The list in §7 item 2, plus what later
sessions added. At checkpoint 9 all of it passed except where marked
(profile sync and forgot password on the owner's word; the sub-checks
inside forgot password were not reported one by one).

Keep test data fictional: a made-up resume and job description go to Gemini
and Groq like real ones would (CLAUDE.md rule 8).

- **Profile sync, with the extension loaded** (§7 item 1): save a profile on
  the dashboard, open the popup: the dashboard's profile is the active one,
  and autofill uses it. Automated against stubs since checkpoint 7; by hand,
  it adds a real sign-in.
- **Cover-letter credits** (§7 item 8), on the dashboard: the first
  personalisation spends a credit, its re-run is free, and a new job
  description spends again. In the popup (item 27): "Personalize on the
  dashboard" opens that workspace; save a version there, and the popup's
  "Saved versions" offers it to fill on a real job page. (The popup half
  was dropped at checkpoint 9: it exists only in this branch's extension.)
- **Forgot password, with a real inbox** (§7 item 15): ask for a link, open
  it, set a new password, sign in with it. Also an expired link (use one
  twice) and the "wait a minute" answer (ask twice quickly).
- **A name on sign-up** (§7 item 16): the dashboard greets the new account by
  it.
- **The draft ceiling**: with `GENERATE_LIMIT_PER_HOUR=2` on the dev server,
  the third draft in Answer Studio says to try again later, and no credit is
  spent on it. Then check the server log has no "generation limit
  unavailable" warning (the migration is in). Remove the setting and restart
  the API afterwards.
- `__onextapIssues()` answers in the dashboard's console.
- **One account, one subscription** (§7 item 30). **Not yet run.** Open the
  dashboard in two tabs, Manage subscription in both. Tab 1: Upgrade, pay
  with the test card, come back. Tab 2, not refreshed: Upgrade and pay
  again. Expect: Pro on the account; a warning in the API log that the
  second subscription was cancelled, naming both; Dodo showing one active
  and one cancelled. Refund the second payment in Dodo's test dashboard.
  Back in tab 1, Manage subscription should say "Payment received" until
  Pro arrives, not "Upgrade".
- **With the store extension (1.0.2)**, if you want to see §7 item 1 for
  yourself. **Not yet run.** Install it from the store, open its popup once,
  save a profile on `localhost:5173/dashboard/` (the store build's
  `externally_connectable` allows that origin, checked at checkpoint 10), and reopen the
  popup. Expected, from the code: still "Welcome to Onextap".

### Deploying (Vercel)

This repo deploys as it is: `vercel.json` builds the website
(`vite build --config vite.dashboard.config.js` → `dist-dashboard/`), serves
`api/index.js` as one function under `/api/` (60 s limit), and runs the
ingest cron daily at 06:00 UTC. What the Vercel project needs:

- **Build-time variables** (inlined into the website): `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`, `VITE_DASHBOARD_URL` (the site's origin). Leave
  `VITE_API_URL` empty: the site then calls its own `/api/`.
- **Server variables**: everything in `server/.env` above, with
  `CLIENT_URL` set to the site's origin (checkout returns there, and it is the
  API's allowed CORS origin), `CRON_SECRET` set (Vercel sends it to the cron
  route; unset, the route answers 503), `ALLOW_CACHE_SOURCE=false`, and
  `DODO_PAYMENTS_ENVIRONMENT=live_mode` only when taking real payments.
- **The domain matters for the extension.** `extension/manifest.json` lets
  only `https://www.onextap.com`, `https://onextap.com` and
  `http://localhost:5173` message the extension. On any other domain the
  dashboard still works, but cannot sync profiles to the extension. Serving
  it elsewhere means widening `externally_connectable` and a new extension
  release (CLAUDE.md: ask first).
- **Supabase** (the production project, this time; CLAUDE.md: ask first):
  Redirect URLs for `https://<domain>/dashboard/` and
  `https://<domain>/reset-password/` (the Site URL can stay the root), and
  migration **006** (`generation_rate_limit`): production has 001–005
  (`supabase/migrations/README.md`). Apply 006 before or with the deploy; if
  it lags, drafts are simply not limited until it lands (the ceiling fails
  open). Record the apply in the ledger.
- **Optional server variable**: `GENERATE_LIMIT_PER_HOUR` (default 30).
- **Dodo**: the webhook pointed at `https://<domain>/api/webhook`, and the
  customer portal enabled.
- **The extension**: build it with `.env` holding the production values
  (`VITE_API_URL=https://www.onextap.com`, `VITE_DASHBOARD_URL` the site's
  origin) for the Web Store release (§6).
- **Order**: deploying fixes the credit-minting route (§7 item 26) on the
  website's API at once. The extension's changes (profile sync, cover-letter
  credits in the popup) reach users only with a new extension release, and
  none is planned (§0 checkpoint 9).

### For Claude on that machine

- Claude's memory from this machine does not travel: this file is the record.
  Start with "read HANDOVER.md and proceed"; §0's last entry is where things
  stand.
- Claude may not type credentials into Supabase's sign-in (a hosted service).
  The owner signs up or in, and clicks confirmation emails and "Delete
  account"; Claude drives the rest, and asks before a Dodo test-mode checkout.
- `.claude/launch.json` (in the repo) has the preview configurations: `web`,
  `api` and `web-preview`.
