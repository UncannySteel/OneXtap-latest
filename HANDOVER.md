# Handover: Onextap backend plugged into the new landing page and dashboard

**State on 2026-09-27:** built, and exercised in a browser against a local mock
of the API and of Supabase auth. **Not yet run against real keys** (no `.env`
or `server/.env` was provided). **Committed locally, not pushed**, on the
branch `merge/web-dashboard`, off `main` (`bae4abc`) of
`github.com/Aiko002/Onextap`: the first session's work is `81e1c01`, and each
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
    - Cover Letter: template, personalise (no credit spent), save version;
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
- **Extension messaging with the extension actually loaded** (profile sync from the dashboard).
- Safari and Firefox.

**Unit tests (`npm test`) on this machine** (Node 25, Windows):

- At the first handover: 505 pass, 39 fail, 2 skipped out of the box; the 4
  that survived `--no-experimental-webstorage` fail the same way on the
  untouched original clone (§7, item 11).
- **Since checkpoint 1: 541 pass, 3 fail, 2 skipped, out of the box.** The 3
  need the missing fixture file (§7, item 11).

**Landing e2e (`npm run test:e2e`)**, since checkpoint 1: 155 pass, 10
skipped (keyboard and wheel tests on the phone profile), 0 fail, across
desktop Chromium, phone Chromium and WebKit. WebKit on Windows is slow
enough to catch the page mid-transition; two such flakes were fixed (§0).
Covers the landing and its company pages only: nothing drives the dashboard.

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
   - a new extension build with the `/dashboard/` link is optional (the landing forwards the old link);
   - point the listing's privacy URL at `/privacy/` (the old URL redirects).
6. **Update the docs** (§7, item 4).
7. **Merge and push.** Everything is committed on the local branch `merge/web-dashboard` only.

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
- **Proposed fix:** in the `ONEXTAP_SYNC_DATA` handler, also fold the payload into `onextap_profiles` under its `_activeProfileId` (see `saveLegacyUserProfile` in `src/profileStore.js` for the shape). The service worker cannot import `src/`, so this is inline code, and it needs a new extension release.
- **Why not done:** `CLAUDE.md` says to ask before changing the `user_profile` ⟷ `onextap_profiles` handling. Needs the owner's go-ahead.

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

**4. Docs describe the old architecture.**
- `CLAUDE.md` still says one React tree ships the popup and the dashboard, and its rule 8 points at `privacy-policy.html`, which no longer exists. The privacy policy is now `web/src/pages/privacy/privacy.html`.
- `README.md`, `docs/repo-structure.md` (layout, dependency rules, "two builds, one source") and `docs/app-flow.md` (entry points, sign-in, upgrade and cancellation, account settings, stored state) need the new layout and flows.
- `web/README.md` and `web/dashboard/README.md` are the original repos' READMEs:
  - the dashboard's still says "no build step, run `python -m http.server`";
  - the landing's says to run npm inside its own folder.
- The "Unverified: dodopayments version drift" note in `CLAUDE.md` is stale: both `package.json` files pin `^2.36.0`, and 2.50.0 is installed in both.

### Medium

**5. The pending cancellation is not stored locally.** The dashboard learns about it from Dodo, via `verify-premium`. If Dodo can't be reached, the panel shows plain "Pro" with no dates, and "Switch to Standard" can be pressed again. Ending Premium depends on Dodo sending `subscription.cancelled` at the period's end (unverified, see item 2).

**6. Account deletion can fail halfway.** If Dodo cancels the subscription and then Supabase `deleteUser` fails, the user has no subscription but still has an account. The user is told to try again, and a retry completes it (the subscription is no longer billable, so the Dodo step is skipped).

**7. Supabase redirect allowlist.** Google sign-in and email confirmation depend on the configuration in §6. Without `/dashboard/` on the allowlist, Supabase falls back to the site root and the landing forwards the tokens. This path was tested only against the mock.

**8. Cover-letter personalisation never spends a credit.** Pre-existing: the generate endpoint charges nothing itself; Answer Studio deducts separately, but cover letters don't. Free users therefore get unlimited cover-letter AI. Kept as it was, since changing it is a pricing decision.

**9. Logging out deletes this browser's profiles** (`user_profile` and `onextap_profiles`). This keeps the backend's behaviour. Resumes and the avatar stay. It may surprise users; worth a product decision.

**10. "Delete account" clears only this browser.** The extension's `chrome.storage` copy and other devices keep their local data. The dialog now says so.

**11. `npm test` failed on this machine for three environmental reasons.** All pre-existing, and all reproduce on the untouched original:
- ~~**Node 25 exposes a global `localStorage`**~~ — fixed at checkpoint 1 (`src/storage.js` checks for `getItem`).
- **`server/data/cached_jobs.json` does not exist.** It was never committed (`.gitignore` has `server/data/`, and git history has no such file), though `server/jobs/adapters/cache.js` and 3 tests expect ~40 synthetic listings there. Those 3 tests fail on any fresh clone. Writing one means changing `.gitignore` to `server/data/*` + `!server/data/cached_jobs.json` (a negation cannot re-include a file inside an ignored directory). Mind the hazard in `cache.js`'s header: once the file exists, a local ingest against a real project seeds fake listings unless `ALLOW_CACHE_SOURCE=false` (which `server/.env.example` already sets).
- ~~**Windows line endings** break `test/server/logger.test.js`~~ — fixed at checkpoint 1 (splits on `/\r?\n/`).

**12. The published extension (v1.0.3) still opens `onextap.com/?extensionId=…`.** The landing forwards it to the dashboard (tested). A new release links straight to `/dashboard/`. Publishing is the owner's call.

**13. `dist/` was rebuilt at checkpoint 1, but without a `.env`.** That build has no Supabase address, so its Supabase client cannot start (the dev dashboard without a `.env` stops on `supabaseUrl is required`; the popup uses the same `src/supabaseClient.js`). Run `npm run build` again once `.env` is in place, before loading the unpacked extension.

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

### Found and fixed along the way (for the record)

- The old dashboard sent the dashboard's own page text to the AI as "the job description" (item 17).
- The popup's Dashboard button passed its click event as the `?view=` value.
- A redirect loop between the landing and the dashboard when a stored session is dead is prevented: the dashboard drops the session before redirecting, and the landing always opens the sign-in window.
- Cover-letter edits no longer get lost when leaving the workspace or switching profile mid-save.

---

## 8. Housekeeping

- The mock servers and scratch builds lived outside the repo, and their `.claude/launch.json` entries were removed. `.claude/launch.json` now has `web` (the site on 5173), `api` (the server on 3001) and `web-preview`.
- Committed on the local branch `merge/web-dashboard` (from checkpoint 1 on). Nothing has been pushed, and nothing has been deployed.
