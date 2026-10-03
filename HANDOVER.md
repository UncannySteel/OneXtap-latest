# Handover: Onextap backend plugged into the new landing page and dashboard

**State on 2026-10-03:** built, and exercised against stubs and a local mock
of the API and of Supabase auth. **Not yet run against real keys**: there are
none on this machine, and the owner will add them on another one (§9 lists
everything that machine needs). **Committed locally**, on the branch
`merge/web-dashboard`, off `main` (`bae4abc`) of `github.com/Aiko002/Onextap`:
the first session's work is `81e1c01`, and each checkpoint since (§0) is its
own commit.

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
| Testing | Against dev/staging keys the owner supplies (not yet supplied) |
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
server/                 Express API (four routes added, see §4)
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
| `DELETE /api/account` | **New.** Cancels any billable subscription at Dodo first (aborts if Dodo can't confirm), then deletes the Supabase auth user. `profiles`, `credit_transactions`, `rank_cache` and `rank_rate_limit` go with it by cascade |
| checkout | `return_url` now goes to `/dashboard/?payment=success` (`dashboardUrl()`) |

No schema changes and no new migrations. The webhook handler is unchanged.

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
- **Returning from checkout**: re-checks every 8 seconds for up to 2 minutes, as before.
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

**Not verified**

- **Anything against real services**:
  - Supabase sign-in, sign-up and Google;
  - Gemini resume parsing and Groq generation;
  - ranking and explain on the real pool;
  - Dodo checkout, webhook, portal, end-of-period cancellation and resume;
  - real account deletion.
- **Extension messaging with the extension actually loaded** (profile sync from the dashboard, with checkpoint 2's fix).
- **The popup's cover-letter credits** (checkpoint 3).
- Safari and Firefox.

**Unit tests (`npm test`) on this machine** (Node 25, Windows):

- At the first handover: 505 pass, 39 fail, 2 skipped out of the box; the 4
  that survived `--no-experimental-webstorage` fail the same way on the
  untouched original clone (§7, item 11).
- Checkpoint 1: 541 pass, 3 fail (the missing fixture file).
- **Checkpoint 3: 562 pass, 0 fail, 2 skipped**, with
  `server/data/cached_jobs.json` in place (untracked; without it, 3 fail).

**E2E (`npm run test:e2e`)**, at checkpoint 3: 158 pass, 10 skipped
(keyboard and wheel tests on the phone profile), 0 fail, across desktop
Chromium, phone Chromium and WebKit. It covers the landing page, its company
pages, and one dashboard flow (cover-letter credits, signed in through the
stubs). WebKit on Windows is slow enough to catch a page mid-transition; two
such flakes were fixed at checkpoint 1.

---

## 6. Before going live

1. **Run everything against dev keys** (checklist in §7, item 2).
2. **Supabase → Authentication → URL Configuration**: add `https://www.onextap.com/dashboard/` (and `http://localhost:5173/dashboard/` for development) to the Redirect URLs.
   - The Site URL can stay the root: the landing forwards tokens that land there.
   - Keep the extension's `https://<extension-id>.chromiumapp.org/` entry.
3. **Dodo**:
   - confirm the customer portal is enabled for the account;
   - in test mode, confirm that cancelling at period end keeps Premium until the date and that `subscription.cancelled` then arrives.
4. **Vercel**: same env var names; `VITE_DASHBOARD_URL` and `CLIENT_URL` stay the site origin.
5. **Chrome Web Store**:
   - **a new extension release is now needed**, for checkpoint 2's profile-sync fix and checkpoint 3's cover-letter credits in the popup. Until it ships, the published popup (v1.0.3) still personalises cover letters for free while the website charges, and still misses dashboard edits;
   - it also links straight to `/dashboard/` (the landing forwards the old link meanwhile);
   - point the listing's privacy URL at `/privacy/` (the old URL redirects).
6. **Rewrite `docs/app-flow.md`** (§7, item 4), once the flows are confirmed.
7. **Merge and push.** Everything is committed on the branch `merge/web-dashboard`.

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
- **Fixed in code at checkpoint 2** (§0), with the owner's go-ahead: the handler files the payload into `onextap_profiles` and makes it active (`extension/profileSync.js`, unit-tested against `src/profileStore.js`). **Still to do:** try it with the extension loaded (needs keys), and ship a new extension release (the owner's call).

**2. Never run against real services.** Every server-backed flow was exercised only against a mock. With dev keys, run each of these once:
- email sign-up with confirmation;
- email sign-in and Google sign-in (after adding the redirect URL, §6);
- resume upload (Gemini);
- Answer Studio generate (Groq), including a credit deduction;
- cover letter personalise;
- Job Matches rank and "Explain my fit" (with its credit);
- Dodo test checkout → webhook → Premium in the dashboard;
- billing portal;
- switch to Standard → the panel shows the end date → "Keep Pro";
- delete account (check the Supabase user, `profiles` row and Dodo subscription are gone);
- profile sync with the extension loaded (keep item 1 in mind).

**3. ~~The landing's Playwright suite is broken by the wiring.~~ Fixed at checkpoint 1** (§0). The four tests that expected the old `onextap:login` / `onextap:feedback` stubs now stub the network (`web/tests/stubs.js`) and assert the request bodies. Playwright 1.63 and its browsers are installed on this machine.

**4. Docs.** Updated at checkpoint 2 (§0), except **`docs/app-flow.md`**, which still describes the React app's entry points, sign-in, upgrade and cancellation, account settings and stored state. It carries an "out of date" note and is to be rewritten once the real-service run has confirmed the flows.

### Medium

**5. The pending cancellation is not stored locally.** The dashboard learns about it from Dodo, via `verify-premium`. If Dodo can't be reached, the panel shows plain "Pro" with no dates, and "Switch to Standard" can be pressed again. Ending Premium depends on Dodo sending `subscription.cancelled` at the period's end (unverified, see item 2).

**6. Account deletion can fail halfway.** If Dodo cancels the subscription and then Supabase `deleteUser` fails, the user has no subscription but still has an account. The user is told to try again, and a retry completes it (the subscription is no longer billable, so the Dodo step is skipped).

**7. Supabase redirect allowlist.** Google sign-in and email confirmation depend on the configuration in §6. Without `/dashboard/` on the allowlist, Supabase falls back to the site root and the landing forwards the tokens. This path was tested only against the mock.

**8. ~~Cover-letter personalisation never spends a credit.~~ Done at checkpoint 3**, by the owner's decision: 1 credit buys a personalisation plus 1 free re-run, on the dashboard and in the popup (§0). The popup's half reaches users only with a new extension release (§6).

**9. Logging out deletes this browser's profiles** (`user_profile` and `onextap_profiles`). Resumes and the avatar stay. **Decided at checkpoint 2: keep it** (the backend's behaviour).

**10. "Delete account" clears only this browser.** The extension's `chrome.storage` copy and other devices keep their local data. The dialog now says so.

**11. `npm test` failed on this machine for three environmental reasons.** All pre-existing, and all reproduce on the untouched original:
- ~~**Node 25 exposes a global `localStorage`**~~ — fixed at checkpoint 1 (`src/storage.js` checks for `getItem`).
- **`server/data/cached_jobs.json` is not in git.** `.gitignore` has `server/data/`, and git history has no such file, though `server/jobs/adapters/cache.js` and 3 tests expect ~40 synthetic listings there. At checkpoint 3 the owner put the file in place on this machine and chose to keep it untracked, so the 3 tests pass here and fail on a clone without it: copy it by hand (§9). To track it instead, `.gitignore`'s `server/data/` has to become `server/data/*` + `!server/data/cached_jobs.json` (a negation cannot re-include a file inside an ignored directory). Mind the hazard in `cache.js`'s header: with the file present, a local ingest against a real project seeds fake listings unless `ALLOW_CACHE_SOURCE=false` (which `server/.env.example` already sets).
- ~~**Windows line endings** break `test/server/logger.test.js`~~ — fixed at checkpoint 1 (splits on `/\r?\n/`).

**12. The published extension (v1.0.3) still opens `onextap.com/?extensionId=…`.** The landing forwards it to the dashboard (tested). A new release links straight to `/dashboard/`. Publishing is the owner's call.

**13. `dist/` has only ever been built here without a `.env`** (checkpoints 1 to 3). That build has no Supabase address, so its Supabase client cannot start (the dev dashboard without a `.env` stops on `supabaseUrl is required`; the popup uses the same `src/supabaseClient.js`). Run `npm run build` again once `.env` is in place, before loading the unpacked extension.

### Low

**14. Landing copy that is still aspirational.** Not changed, because it wasn't clearly contradicted and it's a product-narrative decision:
- **The feature showcase's "Mapping" tab** describes flagging an unmapped field and binding it in one click. No such flow exists; custom profile fields are the closest thing.
- **The FAQ** says a new field is "flagged, never guessed".
- **"Priority support and early access"** is not something code can verify.

**15. No "forgot password" flow.** The backend never had one.

**16. The landing's sign-up form has no name field.** The dashboard's name falls back from the account's display name, to the profile's first and last name, to the email's local part.

**17. The web dashboard can't read the open job page or fill a form.** It has no tab access, so job descriptions are pasted. The popup keeps both abilities.
- This also fixes a bug: the old dashboard's "scrape the active tab" scraped the dashboard itself, and for cover letters that overrode what the user pasted.
- The service worker's `SCRAPE_ACTIVE_TAB` is unchanged; it only makes sense from the popup.

**18. Preview deployments call the production API.** `src/config.js` falls back to `https://www.onextap.com` when `VITE_API_URL` is empty in a production build. Pre-existing.

**19. Leftover code.**
- `src/index.css` still holds the old dashboard's CSS: dead but harmless.
- `src/consent.js` is unused, and kept on purpose as the future analytics consent gate.

**20. Unknown URLs now get Vercel's default 404.** The single-page-app catch-all is gone. A custom `404.html` in `web/public/` would fix it.

**21. Job Matches shows "Scoring 30 of 30 jobs" immediately.** This is the backend's own constants (batch = prefilter = 30); the label is only an estimate.

**22. No application-type picker on the web dashboard.** Job is the only live type, as in the backend. Bringing the others back needs a picker there as well as in the popup.

**23. The landing's "signed in?" check reads Supabase's default storage key** (`sb-<ref>-auth-token`), in `web/src/app/backend.js`. A custom `storageKey` would break it.

**24. ~~The website never installs the client logger's global handlers.~~ Fixed at checkpoint 3:** every website entry calls `installGlobalErrorHandlers()`, so uncaught errors go through the logger and `__onextapIssues()` works in the console there too.

**25. Answer Studio and cover letters are charged by the client, after the fact.** Pre-existing for Answer Studio, and cover letters now follow the same pattern: the page calls `POST /api/answer-vault/generate`, which charges nothing, and then `POST /api/credits/deduct`. A modified client can skip the second call and generate for free. The balance itself cannot be tampered with (rule 6), and "Explain my fit" is charged inside its own route, so this is the one gap. Closing it means charging in the generate route and keeping the free improvements and re-runs on the server: a pricing-adjacent change, so the owner's call. Found at checkpoint 3.

### Found and fixed along the way (for the record)

- The old dashboard sent the dashboard's own page text to the AI as "the job description" (item 17).
- The popup's Dashboard button passed its click event as the `?view=` value.
- A redirect loop between the landing and the dashboard when a stored session is dead is prevented: the dashboard drops the session before redirecting, and the landing always opens the sign-in window.
- Cover-letter edits no longer get lost when leaving the workspace or switching profile mid-save.

---

## 8. Housekeeping

- The mock servers and scratch builds lived outside the repo, and their `.claude/launch.json` entries were removed. `.claude/launch.json` now has `web` (the site on 5173), `api` (the server on 3001) and `web-preview`.
- Committed on the local branch `merge/web-dashboard` (from checkpoint 1 on). Nothing has been pushed, and nothing has been deployed.

---

## 9. Setting up on another machine

The code travels through GitHub. These things do not, and the next machine
needs them before anything can be tested against real services.

### Getting the code

- Push the branch from this machine first. The only remote is `origin`,
  `github.com/Aiko002/Onextap` (the backend's repo): `git push -u origin
  merge/web-dashboard`, or add your own repo as a remote and push there.
- On the new machine: `git clone <repo>`, then `git checkout merge/web-dashboard`.

### Software

- Git, and Node.js **21 or later** with npm (22 LTS is fine; this machine ran
  25.8). Node 18 runs the app but not `npm test`, which passes a glob to
  `node --test`.
- Google Chrome, to load the unpacked extension.
- For `npm run test:e2e`, Playwright's browsers, once:
  `npx playwright install chromium webkit`.

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
    `supabase/migrations/002_rank_cache.sql` (`schema.sql` already includes
    001, 003, 004 and 005). Record it in `supabase/migrations/README.md`.
  - Authentication: the email provider (decide whether addresses must be
    confirmed), and Google if Google sign-in is to be tested.
  - URL Configuration → Redirect URLs: `http://localhost:5173/dashboard/`, and
    `https://<extension-id>.chromiumapp.org/` with the unpacked extension's ID
    (shown at `chrome://extensions`) for Google sign-in from the popup.
- **Dodo Payments**, test mode: a subscription product, an API key, a webhook
  secret, and the customer portal enabled. For webhooks to reach a local
  server, point the webhook at a tunnel to `http://localhost:3001/api/webhook`.
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
npm test              # expect 562 pass, 0 fail
npm run test:e2e      # expect every test to pass
npm run build         # after .env: then Load unpacked → dist/ at chrome://extensions
npm run server:dev    # API on :3001
npm run dev           # the site on :5173
```

Open the dashboard from the extension's popup: it passes the unpacked
extension's ID, which the sync needs.

### Then check by hand

Nothing automated covers these. The list in §7 item 2, plus what this
session added:

- **Profile sync, with the extension loaded** (§7 item 1): save a profile on
  the dashboard, open the popup: the dashboard's profile is the active one,
  and autofill uses it.
- **Cover-letter credits** (§7 item 8), in the popup and on the dashboard:
  the first personalisation spends a credit, its re-run is free, and a new
  job description spends again.
- `__onextapIssues()` answers in the dashboard's console.

### For Claude on that machine

- Claude's memory from this machine does not travel: this file is the record.
  Start with "read HANDOVER.md and proceed"; §0's last entry is where things
  stand.
- Claude may not type credentials into Supabase's sign-in (a hosted service).
  The owner signs up or in, and clicks confirmation emails and "Delete
  account"; Claude drives the rest, and asks before a Dodo test-mode checkout.
- `.claude/launch.json` (in the repo) has the preview configurations: `web`,
  `api` and `web-preview`.
