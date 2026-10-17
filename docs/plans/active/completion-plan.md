# Completion plan: the website, the dashboard and extension 1.0.4

Written 2026-10-16 (session 6) from an interview with the owner. Picks up
from checkpoint 9 (`5ddb7db`). Ends **deploy-ready**: everything built and
tested against the dev project, a production deploy checklist, and a 1.0.4
release zip. It does not deploy, touch production, merge into `main`, or
submit to the Chrome Web Store (§1, D13).

**One batch per session.** Open a new session in this repo and paste:

```
Run batch B<N> of docs/plans/active/completion-plan.md.
```

## Status

| Batch | What | Owner needed | Size | Status | Commit |
| --- | --- | --- | --- | --- | --- |
| B0 | Baseline and guardrails | no | M | done 2026-10-16 (checkpoint 10) | see `git log --grep "checkpoint 10"` |
| B1 | Server split ∥ website fixes ∥ extension protocol | no | L | done 2026-10-17 (checkpoint 11) | see `git log --grep "checkpoint 11"` |
| B2 | Server: charging, billing, AI quality | no | L | done 2026-10-17 (checkpoint 12) | see `git log --grep "checkpoint 12"` |
| B3 | Extension 1.0.4: job-page button, popup, wipe, release tooling; Explain spends first (B3-D) | no | L | not started | |
| B4 | Owner session A: real services on the dev project | yes, ~90 min | M | not started | |
| B5 | Docs, deploy checklist, final review | no | M | not started | |
| B6 | Owner session B: release-candidate build | yes, ~20 min | S | not started | |

Order: `B0 → B1 → B2 and B3 (either order, or both at once, see B3's note) → B4 → B5 → B6`.

Notes from batches (deviations, new work found, anything a later batch must
know) go here, newest last:

- **B0: builder worktrees start from `main`, not the lead's `HEAD`.** The
  Agent tool cut both B0 worktrees from `bae4abc`; one builder noticed, the
  other wrote half its work against old code before the lead caught it. §0.4
  now has the builder check its base first. Lead: give the exact SHA, and
  check `git log --oneline -1` on each builder branch before merging.
- **B0: the e2e caches are in `%USERPROFILE%\onextap-e2e`**, not
  `%LOCALAPPDATA%` (§0.6). `E2E_CHROMIUM_PATH` and
  `E2E_LEGACY_EXTENSION_PATH` point there.
- **B0: baseline for B1.** `npm run lint` 0 errors, 1 warning
  (`CoverLetterPanel.jsx:127`, deliberate); `npm test` 660/0/2; `test:e2e`
  188 pass / 10 skipped; `test:e2e:extension` 3 pass.
- **B0, for B1's server split:** `test/rules/routes.test.js` reads the
  router stack, nested routers included (it reconstructs mount paths), and
  `routes.snapshot.json` has the 21 routes. A split must keep it green with no
  snapshot change. `test/server/harness.js` is how to import the app in a
  test; its env list must cover every var `server/` reads, which
  `test/rules/harness.test.js` enforces (aliases like `env = process.env`
  included).
- **B0, for B3:** both scrapers open with one `SELECTORS` literal;
  `*Academic` keys are `content.js`-only. A selector change goes into both,
  or `test/rules/rule5-*` fails. `scrapeJobPage()` sits inside an
  `eslint-disable no-undef` pair (it runs in the page); rule 9's test lints it
  standalone instead.
- **B0, owner's answers at checkpoint 10:** the scraper change is kept
  (`content.js` gains the LinkedIn selectors); no lint warning is promoted
  (`exhaustive-deps` stays a warning); there is no 1.0.3 draft in the
  developer dashboard.
- **B1: baseline for B2 and B3.** `npm run lint` 0 errors, 1 warning (the
  same); `npm test` 741/0/2; `test:e2e` 197 pass / 10 skipped;
  `test:e2e:extension` 6 (3 `extension` + 3 `legacy`, with
  `E2E_LEGACY_EXTENSION_PATH` set).
- **B1, for B2: where the server code is now.** The webhook handler is
  `server/routes/webhook.js` (registered on the app in `server/app.js`, not
  in a Router: the rule 4 test reads the top-level stack). Credit helpers,
  `chargeOneCredit` and `refundOneCredit` included, are in
  `server/lib/credits.js`; the generate route and `FABRICATION_CORPUS_MAX_*`
  in `server/routes/generate.js`; the answer-vault and Improve prompt text in
  `server/prompts/answerVault.js`; billing in `server/routes/billing.js`;
  `DELETE /api/account` in `server/routes/account.js`; "Explain my fit" in
  `server/routes/jobExplain.js`. `test/server/routes.test.js` reads every
  server module.
- **B1, for B3: the registry.** A new message is a module in
  `extension/messages/` and a line in `MESSAGES` (`registry.js`). Each names
  `from` (`site`, `popup`, `content`, from `senders.js`) and optionally a
  `capability`, which `ONEXTAP_HELLO` reports automatically. Today:
  `ONEXTAP_HELLO` site + popup; `ONEXTAP_SYNC_DATA` and `PARSE_RESUME` site;
  `SCRAPE_ACTIVE_TAB` site + popup; `GENERATE_IMPROVED_ANSWER` popup.
  `scrapeJobPage()` reaches its handler through the context `background.js`
  builds, and stays in `background.js` (rules 5 and 9). The site's
  allowlist is the manifest's `externally_connectable`, read at run time, so
  the release manifest narrows it with no code change.
- **B1, for B3's wipe:** the landing works out the Supabase session key in
  `web/src/app/session.js` (supabase-js's default; `test/web/session.test.js`
  fails if they drift). The wipe needs the same key: consider an explicit
  `storageKey` in `src/supabaseClient.js` from one small shared module.
- **B1: the unit tests that load `src/`** (`test/extension/extensionClient`,
  `resumeParse`) go through `test/extension/viteModules.js`, which needs Node
  22.15+ (`module.registerHooks`); older Node skips them.
- **B1: `web/playwright.config.js` ignores `extension-legacy.spec.js`** as
  well as `extension.spec.js`. A new extension spec needs the same, or the
  website suite runs it without the extension.
- **B1, owner's answers at checkpoint 11:** the new website copy is kept,
  but the site must not say Premium uses the same AI as Free (that bullet
  and the FAQ sentence are removed). The four remaining overstatements
  (HANDOVER §7 item 14) stay as they are: don't rewrite them in later
  batches. The narrowed message senders stay.
- **B2: baseline for B3.** `npm run lint` 0 errors, 1 warning (the same);
  `npm test` 864/0/2; `test:e2e` 200 pass / 10 skipped;
  `test:e2e:extension` 6. The usage limit stopped all three builders again;
  resuming them by `SendMessage` worked as in B1.
- **B2, for B3: charging is on the server now.** The generate route charges
  inside the call (`kind`, `allowanceId`, the response's `charge`), and
  `/api/credits/deduct` is a no-op. The popup's signed-in Personalize path
  is an old client to the server: charged a credit per call, no free re-run.
  `web/tests/extension.spec.js`'s "popup cover letters (an old client)" test
  asserts exactly that; when B3 removes that path, drop or adapt the test.
  `web/dashboard/js/ws/cover-letter.js` changed in `personalize()`, the cost
  hint and the re-run key (`jobContextFor()`, keyed by the description
  alone): B3-A's handoff prefill must leave those as they are.
  `web/tests/stubs.js` charges inside generate and imports
  `jobDescriptionOf()` from `server/lib/generationSpend.js`.
- **B2, for B4: apply migration 007 to the dev project first.** Until it is
  applied, generation and "Explain my fit" answer 503 there (fail closed).
  Run the file itself, not `schema.sql` (the ledger says why). Then by hand:
  two quick presses with one credit (one generation, one refusal); an answer
  and a free improvement; a cover letter and its free re-run; "Explain my
  fit"'s charge; a real double checkout, and a new subscription replacing an
  on-hold one; the dev env's `GEMINI_RANK_MODELS` order (pass/fail only) and
  `meta.timings` from a real rank; Improve against Groq; `npm run evals`
  with `RUN_LLM_EVALS=1` if the owner wants the LLM evals.
- **B2, for B5's deploy checklist:** migration 007 goes onto production
  **before** the server that needs it, or every generation answers 503. The
  design document (`server-side-generation-charging.md`) is implemented; its
  deviations are in HANDOVER §0, checkpoint 12.
- **B2, owner's answers at checkpoint 12:** the deviations from the design
  document are accepted, except that "Explain my fit" must spend before its
  analysis, like Answer Studio: added to B3 as B3-D. B2-B's additions (the
  wider replacement, the 500 that makes Dodo redeliver) are kept. Cover
  letters sent as answers (1 credit, up to 4 generations) are accepted as a
  known gap. Linking when Dodo can't be asked on the first read is kept.

---

## 0. How to run a batch (every session reads this)

### 0.1 Roles

- **Lead**: the session. Prepares the batch, spawns the agents, merges their
  work, runs the gates, talks to the owner, writes HANDOVER. Writes glue and
  conflict fixes only; the work packages belong to builders.
- **Builders**: one Opus agent per work package (WP): `model: "opus"`,
  `isolation: "worktree"`, run in the background, all spawned in one message
  so they run in parallel. Each owns a disjoint set of paths.
- **Readers**: Haiku Explore agents (`model: "haiku"`) for long documents and
  repo sweeps (the owner's standing preference). Ask for line numbers;
  spot-check the passages that matter.
- **Auditor**: one Opus Explore agent after integration. Checks every
  acceptance criterion of the batch against the code and the test output,
  pass/fail with evidence.
- **Review**: the `code-review` skill at `high` on the batch diff before the
  commit. B5 runs `xhigh` on the whole plan's range, plus `security-review`.

### 0.2 Session protocol

1. **Orient.** Read this §0, §1 to §3, and the batch's section in §4. Have a
   Reader summarise HANDOVER.md §0's last entry. Don't re-derive decisions:
   §1 is the record.
2. **Preflight** (lead, main checkout):
   - On `merge/web-dashboard`, `git status` clean; `git fetch latest` and
     `git merge --ff-only latest/merge/web-dashboard` if behind.
   - The previous batch's row in Status says done.
   - Baseline: `npm test`, and `npm run lint` from B1 on. Record
     pass/fail/skip counts. If anything is red, stop: fix it or ask first.
   - `git switch -c batch/<N>`.
   - Do the batch's "Lead prep" and commit it on `batch/<N>` **before**
     spawning: builder worktrees start from the lead's current `HEAD`.
3. **Spawn the builders** with the template in §0.4. Mark a chapter.
4. **While they run**: set up e2e (§0.6), run anything the batch lists as
   "while builders run", and read the files where conflicts are expected.
5. **Integrate** in the batch's merge order: `git merge --no-ff
   <builder-branch>` for each. Resolve conflicts; run `npm test` after any
   merge that conflicted.
6. **Full gate** (§0.5) on `batch/<N>`. Fix and re-run until green.
7. **Squash and review**: `git switch merge/web-dashboard`, `git merge
   --squash batch/<N>` (staged, not committed). Run the `code-review` skill
   on that uncommitted diff, and the Auditor at the same time. Fix confirmed
   findings, then re-run lint, `npm test`, both builds and the e2e suites the
   fixes touch.
8. **Close out** (§0.7).
9. **Checkpoint stop**: tell the owner what was done and verified, ask the
   batch's open questions, and give the next batch's kickoff line.

### 0.3 Rules for everyone, on top of CLAUDE.md

- Nothing against production, ever. Real services (the dev Supabase project,
  Dodo test mode, Groq, Gemini) only in B4, with the owner present.
- Never open, print or copy `.env` or `server/.env`. Key checks parse with
  `dotenv` and print pass/fail only.
- **Dependency changes are lead-only**, done in "Lead prep". Builders never
  run `npm install`/`uninstall`: their `node_modules` is a junction into the
  main checkout's.
- **e2e suites and dev servers are lead-only.** There is one port 5173.
- Every behaviour change ships with a test. Pure logic goes test-first.
- Builders edit only the paths they own. Needing anything else means stop
  and report, not edit.
- Match the surrounding code: comment density, naming, plain JS on the
  website, React in the popup.
- A `src/` module the website imports works with and without `chrome.*`
  (CLAUDE.md rule 2).
- 1.0.4 keeps answering every message 1.0.2 answers, the same way: today's
  production website still sends them, and the store build may ship before
  the website deploys (§3).
- CLAUDE.md stays true after every checkpoint. A batch that moves a file
  CLAUDE.md names, or adds a command, fixes that line in the same commit.

### 0.4 Builder prompt template

Fill in the `<…>` parts from the WP. Keep the rest word for word.

```
You are builder <WP-ID> for batch B<N> of docs/plans/active/completion-plan.md,
working in an isolated git worktree.

Read first: CLAUDE.md; the plan's §0.3 (rules) and §2 (facts); §3 (the
extension protocol) if your WP touches the extension or its messaging; your
WP in §4. Read code as you need it. For long documents, use a Haiku Explore
agent.

First check your base: `git log --oneline -1` must show <lead HEAD SHA>.
If it doesn't (worktrees have been cut from `main`), run
`git merge --ff-only <lead HEAD SHA>` before anything else, and say so in
your report.

Set up the worktree (PowerShell):
  $main = 'C:\Users\anira\Desktop\ONEXTAP-full'
  New-Item -ItemType Junction -Path node_modules -Target "$main\node_modules" | Out-Null
  New-Item -ItemType Junction -Path server\node_modules -Target "$main\server\node_modules" | Out-Null
  New-Item -ItemType Directory -Force server\data | Out-Null
  Copy-Item "$main\server\data\cached_jobs.json" server\data\
If a tool cannot resolve modules through the junctions, remove them and run
`npm ci` and `npm ci --prefix server` instead. Never run npm install or
uninstall while junctioned: that would change the main checkout.

You own only these paths: <paths>. Read anything; edit nothing else. If the
WP needs a change outside them, or a new dependency, stop and say so in your
report.

Baseline from the lead: npm test = <pass>/<fail>/<skip>; npm run lint = <state>.

Rules: test-first for pure logic, and a test for every behaviour change.
CLAUDE.md's rules hold (never console.*, use the logger; never open .env or
server/.env; Number.isFinite on credit values; src/ modules work with and
without chrome.*). Don't run e2e suites, dev servers, builds that need .env,
or anything against a real service. Write or update the e2e specs your WP
lists; the lead runs them.

Done when: <acceptance criteria>, and `npm test` and `npm run lint` pass in
your worktree.

Then commit on your worktree branch as "B<N>/<WP-ID>: <summary>". Don't push.

Report back in under 300 words: files changed; tests added; gate output with
counts; anything you were unsure about or did differently from the spec, and
why; what the lead must do (e2e to run or update, conflicts to expect).
```

### 0.5 Full gate (lead, main checkout)

1. `npm run lint` (exists from B0).
2. `npm test`.
3. `npm run build`, then `npm run build:dashboard`.
4. e2e (§0.6): `npm run test:e2e`, then `npm run test:e2e:extension`
   (includes the legacy 1.0.2 project from B1).
5. The server boots: `npm run server:dev` in the background, `curl -i
   localhost:3001/api/health` answers 200 with an `X-Request-Id`, then stop
   it.
6. From B3: `npm run build:release` with the dev `.env` must **refuse** at
   its environment check.

Record every count; they go into HANDOVER.

### 0.6 e2e on this machine

- Playwright's own Chromium won't start from its install folder here
  (Windows "side-by-side configuration" error). Nor does a copy in any
  folder directly under `%LOCALAPPDATA%`; one under `%USERPROFILE%` or
  `%TEMP%` does (found in B0). B0 copied
  `%LOCALAPPDATA%\ms-playwright\chromium-*\chrome-win64` once to
  `%USERPROFILE%\onextap-e2e\chrome-win`. Every session:
  `$env:E2E_CHROMIUM_PATH = "$env:USERPROFILE\onextap-e2e\chrome-win\chrome.exe"`.
  Re-copy if Playwright's version changes.
- The real store extension for the legacy tests: B0 copied
  `%LOCALAPPDATA%\Google\Chrome\User Data\Profile 1\Extensions\fpleipjggoiolomkcnchnlelbjcnoklj\1.0.2_0`
  to `%USERPROFILE%\onextap-e2e\store-1.0.2`, then deleted the copy's
  `_metadata` folder (Chrome refuses to load an unpacked folder that has
  one). Every session from B1:
  `$env:E2E_LEGACY_EXTENSION_PATH = "$env:USERPROFILE\onextap-e2e\store-1.0.2"`.
- Port 5173 must be free: stop `npm run dev` first.

### 0.7 Close-out

1. **HANDOVER.md**: a new §0 entry, "Checkpoint <n> (date, session <s>):
   <batch title>", covering what was done, what was verified and how, what
   was not, and the open questions. Update §7's item statuses, and §5 when
   verification changed.
2. **`supabase/migrations/README.md`** whenever a migration was written or
   applied.
3. **This plan**: the batch's Status row (done, date, commit), plus "Notes
   from batches" for anything a later batch needs to know.
4. **Commit** the squashed batch on `merge/web-dashboard` as "<title>
   (checkpoint <n>)", with the attribution trailer, then `git push latest
   merge/web-dashboard`. Builders commit on their worktree branches and the
   lead commits and pushes each checkpoint: approving this plan authorises
   that, as the owner's standing checkpoint routine. Nothing is pushed to
   `origin`, and nothing is merged into `main`.
5. **Clean up**: delete `batch/<N>` and the builder branches; remove the
   worktrees.
6. **Memory**: update `onextap-merge-progress` (last batch done, next batch).

---

## 1. Decisions

From the interview on 2026-10-16. IDs are referenced below.

| ID | Decision |
| --- | --- |
| D1 | **Build and fully test 1.0.4; store submission is decided later.** The website keeps working with the live 1.0.2, and with any version, and says honestly what an old extension can't do. |
| D2 | **A "Customize cover letter" button on the job page**, injected by `content.js` beside a detected cover-letter field. It opens the dashboard's Cover Letter workspace with the page's company, role and description filled in. |
| D3 | **The button appears after the user opens Onextap on that page** (popup or Autofill), through `activeTab`. No new permissions, no `content_scripts`. |
| D4 | **The letter goes back into the form through the popup** (Cover tab → saved versions → Fill), as today. No dashboard-to-page fill. |
| D5 | **No popup sign-in** (item 27 stays option a). |
| D6 | **Popup templates become read-only** (item 28 option a): no Upload, Add, Edit or Delete there; "Manage templates on the dashboard" instead. |
| D7 | **Item 25: charging moves to the server**, as designed in `docs/plans/active/server-side-generation-charging.md`, with its defaults: charge every call, `POST /api/credits/deduct` becomes a no-op, granted follow-ups last 30 days, the server imports `src/coverLetterCredits.js`. Prices and amounts don't change. Charging becomes atomic everywhere, "Explain my fit" included. |
| D8 | **Billing hardening: race-proof subscription linking, and cancelling a linked on-hold subscription when a new one replaces it.** Not in: automatic refund of duplicates (stays manual in Dodo), items 5 and 6. |
| D9 | **Landing copy rewritten to match the product** (item 14). |
| D10 | **Extras in:** AI quality (item 32); deleting the account also wipes the extension's local copy (item 10); the release build drops the localhost entries from the manifest. |
| D11 | **Guardrails: ESLint, rule-enforcing tests, splitting `server/index.js`.** Not in: type-checking. |
| D12 | **Agents: Opus builders in worktrees, Haiku readers, a review before every commit.** |
| D13 | **Stop at deploy-ready.** No production changes, no Vercel, no merge into `main`, no store submission. |
| D14 | **Two owner sessions**: B4 (real services, dev project) and B6 (release-candidate build). |
| D15 | **Read the installed store extension** to learn what the live version really is. Done while planning: §2. |

Defaults taken without asking. Veto any of them at review:

- The website fixes proposed at checkpoint 9 are in: honest sync status
  (item 1 option a), `?extensionId=` locked to the store ID outside localhost
  (item 29 option b), resume upload always through the API (item 31 option c).
- Small items are in: 19 (delete the dead `src/index.css`, keep
  `src/consent.js`), 21 (an honest scoring label), 23 (the landing reads the
  Supabase client's real storage key).
- With no popup sign-in (D5), the popup's dormant signed-in AI path (the
  Cover tab's Personalize flow) is removed. The sign-in functions stay: the
  website uses them. It all stays in git history if a popup sign-in ever
  comes.
- The release is **1.0.4**: the store has 1.0.2, and the repo's 1.0.3 was
  never published. Using 1.0.4 can't clash with a 1.0.3 draft in the
  developer dashboard (the owner confirmed at checkpoint 10 that there is
  none; 1.0.4 stays the number).
- Each batch is one checkpoint commit on `merge/web-dashboard`, pushed to
  `latest`.
- The e2e caches (the Chromium copy, the store 1.0.2 copy) live in
  `%USERPROFILE%\onextap-e2e`, outside the repo (moved from
  `%LOCALAPPDATA%` in B0: Chromium won't start there, §0.6).

---

## 2. Facts established while planning

- **The live store version is 1.0.2, not 1.0.3.** On 2026-10-16 Google's
  update service answered `version="1.0.2"` for
  `fpleipjggoiolomkcnchnlelbjcnoklj`, and Chrome Profile 1 has `1.0.2_0`
  installed. The repo's manifest says 1.0.3, never published. HANDOVER's
  "store 1.0.3" is wrong; B0 corrects it. The owner should check the
  developer dashboard for a pending 1.0.3 draft. (Checked at checkpoint 10:
  there is none.)
- **1.0.2's service worker** (`assets/background.js-*.js`, 2.6 KB) handles
  exactly four messages, internal and external alike:
  `GENERATE_IMPROVED_ANSWER`; `PARSE_RESUME`, whose reply carries `data` but
  no `text` (the "drops the resume text" case of item 31);
  `ONEXTAP_SYNC_DATA`, which writes `user_profile` only and always replies
  `success: true`; and `SCRAPE_ACTIVE_TAB`. Anything else gets
  `{success: false, error: "Unknown action: <kind>"}`, a clean signal for
  the handshake in §3.
- **1.0.2 calls `https://www.onextap.com`** and the Supabase project
  `itqaozltgsyvjhlcllic`. That's not the dev project; the owner confirms in
  B6 that it's production. Its permissions, host permissions and
  `externally_connectable` match the repo's manifest, localhost entries
  included.
- **1.0.2's `content.js` is older than `main`'s** (`bae4abc`) and matched no
  committed version in a quick check.
- **`server/index.js`** is 2,745 lines. It listens unless `VERCEL` is set,
  and default-exports the app, which `api/index.js` re-exports.
  `test/server/routes.test.js` reads its **source text** (importing it would
  boot the server), so it can't guard a split. B0 adds a behavioural harness
  first.
- **`chargeOneCredit`** (`server/index.js:1679`) reads and then writes, so
  two concurrent requests holding one credit can both pass.
- **No ESLint.** Rule 11 is already broken at `web/src/app/mount.js:8` and
  `web/src/app/stage.js:96`.
- **`content.js` is injected on demand** (popup open, Autofill) through
  `activeTab` + `scripting`. The manifest has no `content_scripts`, and
  already has `identity`.
- **The Improve prompt** ("EXISTING DRAFT (improve this)") is built in
  `server/index.js`, around line 677, inside
  `POST /api/answer-vault/generate`.

---

## 3. Extension protocol v2

The contract B1 and B3 implement. B1 writes it to
`docs/extension-protocol.md`; B3 adds its messages there.

**Senders.** Internal means the popup or a content script of the same
extension (`sender.id === chrome.runtime.id`). External means a page on an
`externally_connectable` origin; the worker also checks `sender.origin`
against the build's own allowlist, as defence in depth.

| Message | From | Payload | Reply | Since |
| --- | --- | --- | --- | --- |
| `ONEXTAP_SYNC_DATA` | site | `{payload}` | `{success}`. 1.0.4 files the payload into `onextap_profiles` (`extension/profileSync.js`) and writes `user_profile`. | 1.0.2 |
| `PARSE_RESUME` | site (old sites only, after B1) | unchanged | unchanged. Kept: today's production website sends it. | 1.0.2 |
| `SCRAPE_ACTIVE_TAB` | site, popup | none | unchanged | 1.0.2 |
| `GENERATE_IMPROVED_ANSWER` | popup | unchanged | unchanged | 1.0.2 |
| `ONEXTAP_HELLO` | site | `{}` | `{success: true, version, protocol: 2, capabilities}` | 1.0.4 |
| `OPEN_COVER_CUSTOMIZER` | content script only | `{job: {company, role, description, url}}` | `{success}` | 1.0.4 |
| `GET_COVER_HANDOFF` | site only | `{id}` | `{success, job}`, once; the entry is deleted on read | 1.0.4 |
| `ONEXTAP_WIPE_LOCAL` | site only | `{}` | `{success, removed}` | 1.0.4 |
| `MOUNT_COVER_BUTTON` | popup → content script (`tabs.sendMessage`) | `{}` | `{mounted}` | 1.0.4 |

**Capabilities in 1.0.4:** `profile-sync` (dashboard edits reach the popup),
`cover-handoff`, `wipe-local`.

**The website's view**, from `getExtensionInfo()` in `src/extensionClient.js`:

- `current`: `ONEXTAP_HELLO` answered, giving `version` and `capabilities`.
- `legacy`: the reply is `success: false` with an error starting "Unknown
  action". That's 1.0.2: a sync reaches the popup only before its first
  open; no handoff, no wipe.
- `absent`: `chrome.runtime.lastError`, no reply within 1.5 s, or no
  `chrome.runtime` at all. Not installed, or not reachable.

Never infer "synced" from `ONEXTAP_SYNC_DATA`'s success alone: 1.0.2 always
says success. Keep sending the sync to `legacy`, which still helps fresh
installs.

**Extension ID (item 29).** Outside `localhost` and `127.0.0.1`, the site
only ever messages `EXTENSION_ID_FALLBACK`, whatever `?extensionId=` says.
On localhost the parameter wins, for unpacked builds.

**The cover-letter handoff.** The worker stores
`chrome.storage.session["coverHandoff:<uuid>"] = {job, createdAt}`, which
expires after 30 minutes, and opens
`${DASHBOARD_URL}?view=cover&handoff=<uuid>&extensionId=<runtime id>` next to
the job tab. The job text is stripped of markup and capped (company 120,
role 160, description 20,000 characters); `url` must be http(s). Nothing
leaves the device: job text isn't profile data, there's no new destination,
and the privacy page needs no change (rule 8).

**The wipe.** One exported list of every key Onextap writes to
`chrome.storage.local` (profiles, `user_profile`, resumes, avatar, settings,
the `sb-*-auth-token` session), built from the stores' own key constants.
Accepted only from the site; the dashboard sends it after `DELETE
/api/account` succeeds.

---

## 4. Batches

### B0 — Baseline and guardrails (checkpoint 10)

**Goal:** a known-green start, and the checks that make parallel work safe.
**Owner:** not needed.

**Lead prep** (commit on `batch/0` before spawning):

1. Set up the §0.6 caches: the Chromium copy and the store 1.0.2 copy.
2. Install dev dependencies: `eslint` (9.x), `@eslint/js`, `globals`,
   `eslint-plugin-react`, `eslint-plugin-react-hooks`, `espree`.
3. Correct the "store 1.0.3" claims to 1.0.2 per §2: HANDOVER's top
   paragraph, §6 item 5, §7 items 1, 12 and 31, §9; and anywhere else
   `grep -n "1\.0\.3"` finds a claim about the store.

**While builders run:** the baseline e2e, both suites. They haven't run since
checkpoints 5 and 8; record the counts.

**B0-A: ESLint.**
- **Owns:** `eslint.config.js` (new), `package.json` (`scripts.lint` only),
  and any file whose change is a lint fix, except the bodies of
  `scrapeJobPage()` in `extension/background.js` and `scrapePageContext()`
  in `public/content.js` (B0-B's).
- **Spec:** a flat config. Globals per area: browser + `chrome` for `src/`,
  `web/` and `public/`; service worker + `chrome` for `extension/`; node for
  `server/`, `api/`, `test/`, `scripts/` and config files; node + browser for
  `web/tests/`. Rules: `@eslint/js` recommended; `no-console: error`, off in
  the four logger files, in `web/tests/probe-*.mjs` and in `scripts/`, with
  one commented disable block around `public/content.js`'s inline logger;
  `react-hooks/rules-of-hooks: error`, `react-hooks/exhaustive-deps: warn`;
  `react/jsx-uses-vars`. No style rules. Ignore `dist*`, `node_modules`,
  `server/node_modules`, `test-results`, `playwright-report`, `release`.
  Fix every error, including the two `console.warn` calls (route them through
  the logger). Fixes must not change behaviour; report anything that would.
- **Acceptance:** `npm run lint` exits 0 with no errors, and the report lists
  the warnings; `npm test` unchanged.

**B0-B: rule tests and a server harness.**
- **Owns:** `test/rules/**` (new), `test/server/harness.js` (new),
  `server/load-env.js` (only a switch to skip loading for tests, if needed),
  the body of `scrapeJobPage()` in `extension/background.js`, and the body of
  `scrapePageContext()` in `public/content.js`.
- **Spec:**
  1. **Harness:** imports the app with `VERCEL=1` and dummy values for every
     env var the server reads (`grep process.env server/`), never loads
     `server/.env`, never reaches a real service, and serves the app on an
     ephemeral port.
  2. **Route inventory:** `test/rules/routes.snapshot.json` lists every
     `[method, path]` the app serves today, read from the router stack. The
     test asserts each still answers something other than 404 through the
     harness, and an unknown `/api` path answers 404. Changing it means a
     deliberate snapshot update.
  3. **Rule 4:** in `app._router.stack`, the `POST /api/webhook` layer comes
     before the first global JSON parser and uses the raw parser.
  4. **Rule 5:** both scrapers start with an identical `const SELECTORS =
     {…}` literal and take every selector from it. The test parses both
     files with `espree` and deep-compares the two. If the copies differ
     today, don't pick one: report the differences, and the lead decides
     (the union, by default).
  5. **Rule 9:** extract `scrapeJobPage`'s source with `espree` and lint it
     standalone with `no-undef` and browser globals, so any outside name
     fails. Also run it in a `vm` context with a stub `document`, to catch
     runtime `ReferenceError`s.
  6. **Rule 7:** no `VITE_*` name in code or `.env.example` matches
     `SERVICE_ROLE|SECRET|GROQ|GEMINI|DODO|OPIK|CRON|RESEND`.
  7. **Rule 10:** `git check-ignore` covers `.env` and `server/.env`, and
     `git ls-files` lists neither.
- **Acceptance:** every new test passes on today's code. Prove each one
  bites: break a scratch copy once (move the webhook, add an outside
  reference, drift a selector), show the failure in the report, then revert.

**Merge order:** A, then B.
**Review focus:** the harness is truly isolated (no real env, no network);
the scraper refactor doesn't change behaviour.
**Close-out extra:** CLAUDE.md's Commands section gains `npm run lint`
("Lint: none" goes).
**Open questions at the checkpoint:** any scraper drift found; lint warnings
worth promoting to errors.

---

### B1 — Server split ∥ website fixes ∥ extension protocol (checkpoint 11)

**Needs:** B0. **Owner:** not needed.

**B1-A: split `server/index.js`.**
- **Owns:** `server/**` (not `node_modules` or `data`),
  `test/server/routes.test.js` (ported to the new files), `api/index.js`
  (must stay a bare re-export).
- **Target layout:**
  - `server/index.js`: the entry. `import './load-env.js'` first, then the
    app from `./app.js`; listens unless `VERCEL`; `export default app`.
  - `server/app.js`: middleware in today's order: request ids and logging,
    CORS, `POST /api/webhook` with `express.raw` **before any
    `express.json`**, the path-scoped JSON limits, `express.json`, the
    routers, the 404 and error handlers.
  - `server/routes/<area>.js`: one `express.Router` per area (health,
    credits, billing, webhook, account, generate, jobs and matching, resume,
    cron). Derive the areas from the route snapshot.
  - `server/lib/<concern>.js`: shared helpers (auth middleware, profile and
    credit helpers, error formatting, the Dodo client).
  - `server/prompts/<name>.js`: prompt text, including the answer-vault and
    Improve prompt (B2-C owns it later).
- **Rules:** move code, don't change it. Same paths, same middleware order,
  same status codes, messages and logs. Comments travel with their code. No
  new dependencies.
- **Acceptance:** the route snapshot test unchanged and green; the rule 4
  test green; every server test green, with `routes.test.js` ported and its
  assertions unchanged; `server/index.js` under about 60 lines and no route
  file over about 600. The lead checks boot and health (§0.5, step 5).

**B1-B: extension protocol v2, both sides.**
- **Owns:** `extension/background.js` (message routing, not
  `scrapeJobPage`), `extension/messages/**` (new: one module per message,
  plus a registry), `docs/extension-protocol.md` (new, from §3),
  `src/extensionClient.js`, `src/resumeParse.js`,
  `web/dashboard/js/services.js`, `web/dashboard/js/ws/my-profiles.js` (the
  sync status only), `test/extension/**`, `web/tests/extension-legacy.spec.js`
  (new), `web/playwright.extension.config.js` (a legacy project).
- **Spec:**
  1. **Worker:** routing through the registry; the sender checks from §3;
     `ONEXTAP_HELLO` with the version read from the manifest; all four 1.0.2
     messages still answered exactly as before, with tests.
  2. **`getExtensionInfo()`** returns `current`/`legacy`/`absent` (§3), times
     out after 1.5 s, and works without `chrome.*` (website) as well as
     inside the extension.
  3. **Sync status copy per state** (today `my-profiles.js:448`): `current`
     says "Saved and synced to the extension"; `legacy` says it's saved, the
     extension is out of date, and links to `CHROME_WEB_STORE_URL`; `absent`
     keeps today's not-installed behaviour.
  4. **Item 29:** `resolveExtensionId()` per §3.
  5. **Item 31:** resume parsing always uses `parseResumeViaApi()`; the
     website never sends `PARSE_RESUME`.
  6. **Legacy e2e**, skipped unless `E2E_LEGACY_EXTENSION_PATH` is set: with
     the real 1.0.2 loaded, the dashboard classifies it as `legacy`, shows
     the out-of-date copy after a save, and parses a resume through the
     stubbed API.
- **Acceptance:** unit tests for the classification, `resolveExtensionId`,
  the registry and its sender checks, and compatibility of the 1.0.2
  messages; the legacy spec and the extension e2e green (the lead runs
  them).

**B1-C: website polish.**
- **Owns:** `web/src/**`, the landing pages under `web/` outside
  `web/dashboard/`, `web/dashboard/js/ws/job-matches.js` (the label only),
  `src/index.css` (delete if unused), the copy expectations in
  `web/tests/pages.spec.js` and `web/tests/stage.spec.js`.
- **Spec:**
  1. **Item 14:** rewrite the showcase's "Mapping" tab, the FAQ's "flagged,
     never guessed" and the "Priority support and early access" perk to
     describe what exists. Check each claim against the code (what autofill
     does with an unknown field; what Premium gives). Keep the tone and
     length. List before → after in the report.
  2. **Item 21:** "Scoring 30 of 30 jobs" becomes an honest label.
  3. **Item 23:** the landing's signed-in check uses the Supabase client's
     configured storage key, not a hard-coded default.
  4. **Item 19:** delete `src/index.css` if nothing imports it. Keep
     `src/consent.js`.
- **Acceptance:** the pages e2e green with the new copy; none of the three
  old claims left (`grep`).

**Merge order:** A, B, C.
**Review focus:** the split is a pure move (review it area by area); the
protocol's sender checks; the accuracy of the new copy.
**Close-out extra:** CLAUDE.md lines that name moved server files (rule 4,
the `load-env.js` fact) point at the new files.
**Open questions at the checkpoint:** the landing copy (the owner reads the
before/after); anything odd found in the split.

---

### B2 — Server: charging, billing, AI quality (checkpoint 12)

**Needs:** B1 (the split). **Owner:** not needed; B4 applies the migrations.
Can run alongside B3 (see B3's note).

**Read first:** `docs/plans/active/server-side-generation-charging.md`
(B2-A reads all of it).

**B2-A: server-side charging (item 25, D7).**
- **Owns:** `supabase/migrations/007_generation_charges.sql` (new);
  `supabase/schema.sql` (append the same objects, idempotently);
  `supabase/migrations/README.md` (007 written, applied nowhere); the
  generate and credits route files and the credits helper from B1's layout;
  `web/dashboard/js/ws/answer-studio.js` (its charging calls);
  `web/dashboard/js/ws/cover-letter.js` (`personalize()` only);
  `web/tests/stubs.js`; `web/tests/dashboard.spec.js`; new tests under
  `test/server/` and `test/credits/`.
- **Spec:** the design document, with D7's defaults, plus:
  - `chargeOneCredit` ("Explain my fit") and the refund path use the same
    atomic database function. No read-then-write on credits is left.
  - If the migration isn't applied, generation **fails closed**: a clear 503
    and an error log naming migration 007. It never generates for free.
  - `POST /api/credits/deduct` answers with the balance and charges nothing,
    for old clients.
  - `Number.isFinite` guards on every credit value rendered (rule 3).
- **Acceptance:** route tests for a charge, the allowance (free follow-up
  and re-run), exhaustion (403, nothing generated), Premium (no charge),
  fail-closed, the deduct no-op, and the concurrent-charge contract; the
  dashboard e2e green with the new stubs.

**B2-B: billing hardening (D8).**
- **Owns:** `server/subscriptionGuard.js`; the webhook route file (and the
  billing route file only where linking happens);
  `supabase/migrations/008_*.sql` if a constraint is needed, appended to
  `schema.sql` in its own block after A's; `test/server/subscriptionGuard.test.js`
  and new tests.
- **Spec:**
  - Linking is one conditional write. A subscription links only if the
    account has none, already has this one, or has one that's no longer
    billable. Otherwise the newcomer is a duplicate: cancelled, and logged
    with both ids (the refund stays manual).
  - When a new subscription activates and the linked one is on hold, cancel
    the on-hold one through Dodo and link the new one.
  - The webhook stays registered before `express.json` (the rule 4 test).
- **Acceptance:** unit tests for simultaneous activations (only one links),
  the on-hold replacement and the duplicate path's log; the existing
  `subscriptionGuard` tests green.

**B2-C: AI quality (item 32).**
- **Owns:** the answer-vault prompt module(s) under `server/prompts/`;
  `server/lib/improveGuard.js` (new); `src/matching/**` (normalisation only);
  `test/matching/**`; `server/jobs/rank.js` and `server/jobs/graph.js`
  (latency only); `web/dashboard/js/ws/job-matches.js` (the timing copy
  only); and one call site in the generate route, marked with a comment.
- **Spec:**
  1. **Improve:** the prompt forbids adding numbers, employers, titles or
     tools that are in neither the resume nor the draft. After generation,
     compare the new draft's unbacked claims (`src/matching/fabrication.js`)
     with the old draft's. If there are more, retry once with the offending
     claims listed. Return the flags as today.
  2. **"HTML" vs "HTML5"**, and similar versioned names (CSS3 and the like):
     normalise them in the matcher so they match, with tests.
  3. **Rank latency:** time each stage (debug logs), find in the code what
     made a rank take 27 s, fix it safely (parallel independent calls with a
     cap, cache reuse), and make the page's estimate honest.
- **Acceptance:** unit tests with a stubbed model for the retry; matcher
  tests; `npm run evals` no worse (the lead runs it if it needs keys).

**Merge order:** A, B, C (C's call site lands on top of A's route).
**Review focus:** the money paths: atomic, fail-closed, no double charge, no
free path; the webhook order; the migrations are idempotent and `schema.sql`
matches them.
**Close-out extra:** none beyond §0.7.
**Open questions at the checkpoint:** any deviation from the design
document.

---

### B3 — Extension 1.0.4 (checkpoint 13)

**Needs:** B1 (the protocol). **Owner:** not needed.

**B3-A: the job-page button and the handoff (D2 to D4).**
- **Owns:** `public/content.js` (the button and its mount handler;
  `scrapePageContext()` only to mirror a selector change);
  `extension/messages/openCoverCustomizer.js` and `getCoverHandoff.js` (new)
  and their registry lines; `scrapeJobPage()` in `extension/background.js`
  (mirroring only); `web/dashboard/js/ws/cover-letter.js` (the handoff
  prefill only, not `personalize()`); `web/dashboard/js/main.js` (the
  `handoff` parameter, kept across sign-in); its messages in
  `docs/extension-protocol.md`; `web/tests/cover-handoff.spec.js` (new) and a
  fixture job page; `test/extension/coverHandoff.test.js`.
- **Spec:**
  - `content.js` mounts **one** button after `MOUNT_COVER_BUTTON` or
    `AUTOFILL_TRIGGERED`, when it detects a cover-letter field (reuse the
    detection `FILL_COVER_LETTER` uses). The host element is appended to
    `body` with a closed shadow root, never inside the form; it's anchored
    under the field (scroll, resize, `ResizeObserver`), hidden when the field
    is hidden or gone, and idempotent across re-injections. A real
    `<button type="button">` labelled "Customize cover letter", with an
    `aria-label` naming Onextap and a dismiss ×.
  - Click: `scrapePageContext()`, then `OPEN_COVER_CUSTOMIZER`. Failures show
    inline in the shadow UI.
  - The worker follows §3's handoff rules.
  - The dashboard reads `handoff` and asks `GET_COVER_HANDOFF` (only when
    `current` with `cover-handoff`). It fills company, role and description,
    says "Filled from the job page: check it before personalising", and
    strips the parameter (`history.replaceState`). Signed out, it keeps the
    id in `sessionStorage` and finishes after sign-in. Expired: a plain
    message.
  - Top frame only (`activeTab`'s reach); document the limitation.
- **Acceptance:** unit tests for sanitising, expiry, the one-time read and
  the sender checks. An e2e: a fixture page with a cover-letter textarea →
  open the popup → the button → the dashboard prefilled → personalise
  (stubbed) → save → the popup's Cover tab shows the version → Fill fills the
  textarea.

**B3-B: the popup and the account wipe (D5, D6, item 10).**
- **Owns:** `src/components/popup/**`, `src/components/shared/CoverLetterPanel.jsx`,
  `src/components/OnextapDashboard.jsx` (if needed), `src/localKeys.js`
  (new), `extension/messages/wipeLocal.js` (new) and its registry line, the
  dashboard's delete-account code and dialog (find it first:
  `web/dashboard/js/settings.js` or `subscription.js`), the popup tests in
  `web/tests/extension.spec.js`, `test/extension/wipeLocal.test.js`.
- **Spec:**
  - On open, the popup injects `content.js` and sends `MOUNT_COVER_BUTTON` on
    any http(s) tab. Failures stay silent (`chrome://` pages and the like).
  - The Cover tab: a read-only template list, saved versions with Fill
    (newest first), and "Manage templates on the dashboard" (`view=cover`).
    "Open" on a saved version shows its text read-only, with Copy and Fill.
    Remove Upload, Add, Edit and Delete, and the dormant signed-in AI path:
    the target-application inputs, the Personalize button and its cost line,
    `handlePersonalize()`, the balance fetch, the generation error with
    Retry, the fabrication notice, the Original/Suggestion editor with Save
    version, and `PopupView`'s `popupUser` watch, which only feeds them.
    Keep `src/auth.js` (the website signs in with it),
    `src/coverLetterCredits.js` (the dashboard and the server use it) and the
    worker's `GENERATE_IMPROVED_ANSWER` (a 1.0.2 message, §3). Before
    deleting any `src/` module that becomes unused, check `web/` doesn't
    import it.
  - The wipe: one exported key list built from the stores' own key constants
    (no duplicated strings), and a worker handler that removes them. The
    dashboard sends it after a successful `DELETE /api/account` when the
    extension is `current` with `wipe-local`; the dialog's copy follows the
    state.
  - Logging out behaves as today (item 9).
- **Acceptance:** unit tests that the key list covers every key the stores
  write, and for the handler; the popup e2e updated (the signed-in credits
  test is replaced by read-only assertions); a stubbed delete-account e2e
  that wipes the extension.

**B3-C: release tooling (D10's localhost item; item 13).**
- **Owns:** `vite.config.js`, `scripts/releaseManifest.js` (new),
  `scripts/build-release.mjs` (new), `package.json` (`scripts.build:release`
  only), `.gitignore` (`release/`, `dist-release/`), `extension/manifest.json`
  (the version, 1.0.4, only), `test/release/**` (new).
- **Spec:**
  - An `ONEXTAP_RELEASE=1` build writes `dist-release/` with a manifest that
    has no localhost entry in `host_permissions` or `externally_connectable`.
    Dev builds don't change.
  - `npm run build:release`:
    1. **Environment check:** parse `.env` with `dotenv`, print pass/fail
       only. `VITE_API_URL`'s origin is `https://www.onextap.com` (or it's
       unset, if that's the default), `VITE_DASHBOARD_URL` is
       `https://www.onextap.com`, and `VITE_SUPABASE_URL`'s host is
       `itqaozltgsyvjhlcllic.supabase.co` (1.0.2's project; B6 confirms it).
    2. Build.
    3. **Scan the output:** no `localhost`, no `service_role` JWT (decode the
       JWT-shaped strings), and no Groq, Gemini, Dodo or Resend key shapes or
       variable names.
    4. **Check the manifest:** the version; permissions exactly `storage`,
       `activeTab`, `scripting`, `identity`; host permissions equal to
       1.0.2's minus localhost.
    5. Zip with the platform's `tar` to `release/onextap-<version>.zip` and
       print its SHA-256.
  - No new dependencies.
- **Acceptance:** unit tests for `releaseManifest` and the scanner (fixtures
  with planted secrets or localhost fail them); with today's dev `.env`,
  `build:release` refuses at step 1.

**B3-D: "Explain my fit" spends first (the owner's answer at checkpoint 12).**
Server only; disjoint from A to C.
- **Owns:** `server/routes/jobExplain.js` (its charging only);
  `server/lib/credits.js` (`chargeOneCredit`/`refundOneCredit`, only if their
  shape must change); new route tests under `test/server/`;
  `test/server/fakeServices.js` (additive).
- **Spec:** the order Answer Studio has had since B2 (`server/routes/generate.js`):
  validate the request, then `spendGeneration()` (kind `explain`, no
  follow-ups), then the model, and `undoGeneration()` exactly once if
  anything after the spend fails (the model, the parse, building the
  response). Out of credits is 403 and migration 007 missing is 503, both
  **before** the model is called. Premium pays nothing. The route's
  read-the-balance pre-check goes: the spend decides. The response keeps its
  shape (`creditsRemaining`, null on Premium). Reopening a saved explanation
  stays free (the page doesn't call the route again).
- **Acceptance:** route tests through the harness: a charge; out of credits
  (403, the model never called); 007 missing (503, the model never called,
  the error log names migration 007); Premium (no charge); a failed analysis
  (the credit back, one refund row); two concurrent requests holding one
  credit (one runs the model, the other gets 403 without calling it).

**Merge order:** D, C, B, A (D is server-only and touches nothing else; A is
the biggest, and the registry-line conflicts get resolved last).
**Review focus:** the content script is safe on any host page; the sender
checks; the key list is complete; no permission widening (the manifest
differs from 1.0.2 only in its version, plus the localhost removal in the
release build).
**Close-out extra:** the CLAUDE.md commands list gains `npm run build:release`.
**Open questions at the checkpoint:** a screenshot of the button on a job
page, for the owner to approve its wording and placement.

**Running B2 and B3 at the same time** (optional, for speed). Start the
second session in its own worktree on its own batch branch (the desktop
app's worktree option, or `git worktree add ..\onextap-b3 -b batch/3
merge/web-dashboard`, then `npm ci` and `npm ci --prefix server` there). The
two share these files: `web/dashboard/js/ws/cover-letter.js` (B2 changes
`personalize()`, B3 the prefill), `web/tests/stubs.js`, `package.json`.
Whichever lands second merges `merge/web-dashboard` into its batch branch,
resolves, and re-runs the full gate. Don't run both sessions' e2e at once
(port 5173). Neither batch adds a dependency, so the builders' junctions into
the main checkout stay valid.

---

### B4 — Owner session A: real services on the dev project (checkpoint 14)

**Needs:** B2 and B3. **Owner:** at the keyboard, about 90 minutes. The owner
signs up and in, pays with test cards, and clicks on hosted pages; the lead
drives everything else and watches the logs and the database.

**Lead prep, at the start:**

1. Key check (`dotenv`, pass/fail): both env files on the dev project, Dodo
   in `test_mode`, `CLIENT_URL` on localhost.
2. **The owner applies 007 (and 008) to the dev project** in the SQL Editor.
   The lead verifies with a read-only query through the server's service
   client and updates the migrations README.
3. Start `npm run server:dev`, a Cloudflare quick tunnel for Dodo's webhooks
   (HANDOVER §9; the owner updates the webhook URL in Dodo's test
   dashboard), `npm run dev`, and `npm run build` (dev values).
4. The owner loads `dist/` unpacked in a **separate Chrome profile**. Profile
   1 keeps the store's 1.0.2 for the legacy checks.

**Checks:**

| # | Check | Expected |
| --- | --- | --- |
| 1 | Email sign-up and confirmation | Works; the greeting shows the name |
| 2 | Google sign-in, if the dev project has the provider configured | Lands on `/dashboard/` signed in. If not configured, record it as not tested. |
| 3 | Answer Studio on a free account | 1 credit per answer, its free improvements free, the next one charged; `credit_transactions` and the charges table agree |
| 4 | Cover letter on a free account | 1 credit, then 1 free re-run, then charged |
| 5 | Credits run out | 403, nothing generated, honest message |
| 6 | Premium | Never charged |
| 7 | Atomicity, with the owner's go-ahead | A lead script fires N+1 concurrent charges at the dev database for a test account holding N credits: exactly N succeed, and the balance never goes below 0 |
| 8 | "Explain my fit" on a free account | Charges 1 credit |
| 9 | Hourly ceiling (`GENERATE_LIMIT_PER_HOUR=2`) | The third draft in the hour is refused |
| 10 | Double checkout (item 30) | Two tabs, two test payments: one subscription linked, the other cancelled as a duplicate, both ids in the log, Pro stays on |
| 11 | Duplicate activation webhook, if Dodo can resend it | Still one link |
| 12 | Cancellation | Switch to Standard shows the pending end; an immediate cancel in Dodo's dashboard turns Premium off via `subscription.cancelled` |
| 13 | The job-page button, 1.0.4, on two or three real postings (Greenhouse, Lever, Ashby) | Open the popup → the button by the cover-letter field → the dashboard prefilled → personalise → save → popup Cover tab → Fill puts it in the field |
| 14 | The handoff while signed out | Sign in, and the prefill still happens |
| 15 | Profile sync, 1.0.4 | An edit made after the popup's first open shows in the popup; the site says "synced" |
| 16 | Legacy, store 1.0.2 in Profile 1 | After a save the site says the extension is out of date; resume upload works (through the API) |
| 17 | Popup templates | Read-only; "Manage templates" opens the Cover workspace |
| 18 | Delete account, 1.0.4 | The extension's data is wiped (the popup shows Welcome); with 1.0.2 the dialog says this browser only |
| 19 | AI quality | Improve adds no unbacked claims, or flags them after its retry; "HTML" matches "HTML5"; three rank timings recorded |
| 20 | The release guard | `npm run build:release` with the dev `.env` refuses |

The lead fixes small failures on the spot, uses builders for anything
bigger, re-runs the gate, and records every result in HANDOVER §5: what was
verified, how, and what wasn't.

**Open questions at the checkpoint:** whatever failed and needs a product
call.

---

### B5 — Docs, deploy checklist, final review (checkpoint 15)

**Needs:** B4. **Owner:** not needed.

**B5-A: docs.**
- **Owns:** `docs/app-flow.md`, `docs/extension-protocol.md` (final),
  `README.md`, `CLAUDE.md`, `web/src/pages/privacy/privacy.html` (accuracy
  only).
- **Spec:** reconcile `docs/app-flow.md` with B4's real run and the new
  flows. CLAUDE.md: the commands (`lint`, `build:release`, the legacy e2e
  variable), key facts (the server layout after the split, the protocol
  document, the rule tests), any rule path that moved; under 2,000 tokens;
  drop the "Unverified" items B0 to B4 settled. Privacy page: only accuracy
  edits about sync and the wipe on deletion. Nothing adds a destination; if
  anything more looks needed, stop and report (rule 8).

**B5-B: the deploy checklist and a smoke script.**
- **Owns:** `docs/deploy-checklist.md` (new), `scripts/smoke-prod.mjs` (new;
  GET requests only, refuses anything else), `test/release/smoke.test.js`
  (runs the script against a local server).
- **Checklist sections:** the order of operations. Production Supabase:
  migrations 006, then 007, then 008, ask first, with verification queries
  and the ledger; Redirect URLs for `/dashboard/` and `/reset-password/`,
  keeping the `chromiumapp.org` entry. Vercel's environment variable names.
  Dodo live: webhook, key, customer portal. How the deploy happens (merging
  into `main` may auto-deploy, so the owner first checks which repo and
  branch Vercel watches). The post-deploy smoke run, including `POST
  /api/credits/refund` answering 404 (item 26). Rollback (Vercel's instant
  rollback; the migrations are additive; the deduct no-op keeps old clients
  correct). The Chrome Web Store 1.0.4 submission: B6's zip, the privacy URL
  → `/privacy/`, "What's new", permissions unchanged, a staged rollout if
  offered. A compatibility matrix: old and new website × extension 1.0.2 and
  1.0.4.

**Lead:**

- Final review of the whole plan: the `code-review` skill at `xhigh` over
  `5ddb7db..HEAD`, and the `security-review` skill. The Auditor checks §5.
- HANDOVER refresh: the top state paragraph; §5; §6 points to the deploy
  checklist; §7 strikes what's fixed and marks items 5, 6, the automatic
  refund, the rest of 17, and 22 "out of scope by owner decision,
  2026-10-16"; §9.
- Move `docs/plans/active/server-side-generation-charging.md` to
  `docs/plans/completed/`.

---

### B6 — Owner session B: release candidate (checkpoint 16)

**Needs:** B5. **Owner:** about 20 minutes.

1. The owner puts production's `VITE_*` values into `.env` from their backup.
   Claude doesn't see them.
2. The lead runs `npm run build:release`. Every check must pass; record the
   zip's SHA-256.
3. The lead inspects the zip's manifest (version 1.0.4, the permissions, no
   localhost). The owner confirms that `itqaozltgsyvjhlcllic` is the
   production project.
4. Optional, the owner's call: load the zip unpacked in a throwaway Chrome
   profile and open the popup, without signing in or syncing, to see it
   start.
5. The owner restores the dev `.env`; the lead checks it points at the dev
   project again (pass/fail).
6. Close out: HANDOVER §0 says deploy-ready. Move this plan to
   `docs/plans/completed/`. Commit and push.

The owner then decides when to run `docs/deploy-checklist.md` and submit the
zip.

---

## 5. Definition of done

- Every in-scope §7 item closed, verified and recorded in HANDOVER.
- Lint, unit tests, both builds and every e2e suite (the legacy one included)
  green; the release zip built and its checks passed.
- The website works with 1.0.2 (honest status, resume through the API) and
  with 1.0.4 (sync, handoff, wipe). 1.0.4 works with today's production
  website (all four 1.0.2 messages).
- Charging is server-side and atomic; the webhook hardening is tested.
- No new permissions; the release manifest has no localhost.
- `docs/extension-protocol.md`, `docs/deploy-checklist.md`,
  `docs/app-flow.md`, CLAUDE.md and HANDOVER are current.
- Nothing in production changed.

## 6. Out of scope

By owner decision, 2026-10-16. They stay in HANDOVER §7.

- Automatic refund of duplicate subscriptions (item 30): stays manual in
  Dodo.
- Items 5 (storing the pending cancellation) and 6 (deletion failing
  halfway).
- Item 17 beyond the job-page button: the dashboard still can't fill forms.
- Item 22: application types.
- A popup sign-in (item 27 options b and c).
- Type-checking.
- Deploying, merging into `main`, submitting to the store.

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| The server split changes behaviour | B0's harness, route snapshot and rule 4 test before the split; a pure-move rule; review by area; B4's real run |
| 1.0.4 ships before the website deploys | 1.0.4 keeps all four 1.0.2 messages, with tests; the compatibility matrix in the deploy checklist |
| The website meets an old extension | The `current`/`legacy`/`absent` handshake, tested against the real 1.0.2 |
| The button breaks host pages | Shadow DOM, a host on `body` outside forms, no form mutation, a dismiss, idempotent mounting |
| Migrations lag the code | Generation fails closed with a named error; B4 applies them first; the deploy checklist orders them |
| Junctioned worktrees confuse a tool | Fall back to `npm ci` in the worktree; dependencies are lead-only |
| e2e collisions on port 5173 | e2e is lead-only and serialised |
| Chromium won't start (the SxS error) | The stable copy in `%USERPROFILE%\onextap-e2e` |
| Store review | No new permissions, localhost removed, privacy URL updated |
| Version confusion (1.0.2 live, 1.0.3 in the repo) | Release as 1.0.4; HANDOVER corrected in B0 |
