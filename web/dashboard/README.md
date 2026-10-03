# Onextap dashboard

The dashboard at `/dashboard/`: the four workspaces (Job Matches, My Profiles,
Answer Studio, Cover Letter), the account and the plan. It came from the
DEMO_DASH repo, whose workspaces were placeholders; they are now built out
with the backend's features, in DEMO_DASH's design.

Plain HTML/CSS/ES modules — no framework. It is part of the website build:
run everything from the **repo root** (`npm run dev` serves the whole site on
http://localhost:5173, the dashboard at `/dashboard/`; `npm run
build:dashboard` builds it into `dist-dashboard/`). The API has to be running
too (`npm run server:dev`), and `.env` in place.

The modules it shares with the extension popup — the profile and resume
stores, auth, credits, resume parsing, matching — are imported from the repo's
`src/` through the `@app` alias (`vite.dashboard.config.js`), so the dashboard,
the popup and the server run one copy of them.

It shares the landing page's design language (`web/src/`): the same palette,
faces and motion curves, copied value for value into `css/tokens.css` — change
them in both places. Forest-black for the chrome, an oat sheet for the
workspace, citrine as the one loud note; Archivo condensed for display type,
Instrument Serif for the voice, Instrument Sans for UI, DM Mono for figures.

## Structure

| File | What it's for |
| --- | --- |
| `index.html` | Page shell: top bar, settings menu, profile/dock, workspace, footer, dialogs |
| `css/tokens.css` | The landing page's colours, fonts and easing curves, plus radii and sizes — retheme here |
| `css/dashboard.css` | Type roles, layout for the home view, the docked/floating workspace view, mobile, and the cursor |
| `css/workspaces.css` | The four workspaces' styles, on the dashboard's tokens only |
| `js/config.js` | The workspaces (add one here and it gets a button, a dock entry and a `#/<id>` route), the popup's old `?view=` names, and the plans |
| `js/services.js` | **The backend boundary**: session, sign-in redirect, account, credits, plan and billing portal, avatar, log out, account deletion, extension sync |
| `js/workspaces.js` | Mounts the workspace for a route from `js/ws/<id>.js` |
| `js/ws/` | The workspaces: `job-matches`, `my-profiles`, `answer-studio`, `cover-letter` |
| `js/ui/` | Shared UI: `dom` (the `h()` builder), `controls`, the profile and resume `switchers`, `file-drop`, the `fabrication` notice |
| `js/subscription.js` | The plan panel: Standard, Pro renewing, Pro ending (with "Keep Pro"), Pro without dates; upgrade, switch, billing |
| `js/settings.js` | Settings dropdown (keyboard + outside-click handling) |
| `js/tour.js` | The first-run tour |
| `js/dock.js` | Dock left / right / floating, drag, edge-snap, resize — persisted in `localStorage` |
| `js/motion.js` | The landing's masked-word headline rise, and the reduced-motion check |
| `js/cursor.js` | The landing's cursor: a trailing citrine ring; a "Drag" grip over the dock bar |
| `js/util.js` | Toasts, view transitions, and the dashboard's own UI state in `localStorage` |
| `js/main.js` | Boot: the session check, user binding, routing, settings actions, the return from checkout, the entrance |
| `contact/`, `privacy/` | The company pages, one `index.html` each (see below) |
| `site/` | Those pages' scripts and the pieces they swap in for the landing's own |

## The account

- **Signed out**, the dashboard sends you to the landing page's sign-in
  window (`/?login=1&next=/dashboard/…`); signed in, you come back. A stored
  session that no longer works is dropped first, so the two pages cannot send
  you back and forth.
- **The name** comes from the account, then the profile, then the email.
  Credits read "Unlimited" on Premium.
- **Credits.** One credit buys an answer plus three improvements (Answer
  Studio), a cover letter plus one re-run for the same job description (Cover
  Letter, `@app/coverLetterCredits.js`), or one fit explanation (Job Matches).
  Answer Studio and Cover Letter check the balance before the AI call and
  deduct through `POST /api/credits/deduct` after a successful one; "Explain my
  fit" is charged by the server inside `POST /api/jobs/explain`.
- **Settings**: change avatar (kept in this browser: the Google photo, else
  initials, unless you upload one), manage subscription, billing portal, log
  out, delete account. Logging out clears this browser's profiles
  (`user_profile`, `onextap_profiles`); resumes and the avatar stay. Deleting
  the account deletes it on the server, then clears this browser; the
  extension's copy and other browsers keep theirs, and the dialog says so.
- **Returning from checkout** (`?payment=success`): re-checks Premium every 8
  seconds for up to 2 minutes, while Dodo's webhook lands.
- **Links in**: `?view=vault|cover|jobs|profiles` (the popup's) opens that
  workspace; `?upgrade=1` opens the plan panel; `?extensionId=` says which
  extension to sync with.
- **Syncing to the extension**: saving a profile pushes it to the extension
  over `ONEXTAP_SYNC_DATA` when the page can reach one (opened from the popup,
  or the published extension's ID); a push that fails is reported, and the
  local save stands.

## Behaviour

- Home (`#/`): centred avatar, name, plan tag, one-liner, workspace cards, sized from the viewport's height so the whole view (top bar to footer) fits the window without scrolling, down to about 540px tall. On load the name rises word by word through masks and the rest follows on a stagger; a card lifts on hover, its citrine edge wipes in and its label rolls into italic.
- Clicking a workspace routes to `#/<id>`; the profile and buttons animate into the dock (View Transitions API, falls back to an instant switch). The oat workspace sheet is dealt in (`enter`), dealt over the last one (`swap`) or slid away (`leave`); the dock's citrine thumb slides to the open workspace.
- Dock: buttons to dock left / undock / dock right. Drag the dock's top bar to float it anywhere; drop near the left or right edge to re-dock; double-click the bar to toggle.
- Resize: drag the dock's inner edge (200–480px, capped at half the viewport), or focus it and use the arrow keys / Home / End. Double-click the edge to reset to the default `--dock-w`.
- Under 760px wide the dock collapses to an icon rail and floating is disabled.
- Reduced motion: every animation and transition is off, headlines aren't split, and the custom cursor isn't mounted. It's also skipped on touch.
- Manage subscription (settings menu) opens a panel with the plan you're on and both plans side by side; the other plan's button upgrades or switches (`services.changePlan`), and on Pro, "Billing & invoices" opens the billing portal (`services.openSubscriptionPortal`).
- Footer links go to the Contact (`contact/`) and Privacy (`privacy/`) pages.

## Company pages

Contact and Privacy are the landing page's own, built from its source
(`web/src/pages/`, `web/src/features/`) by the same Vite build — not copies.
`site/contact.js` and `site/privacy.js` boot them through `site/sub-page.js`,
which swaps in the dashboard's variants of a few pieces: the header row
(`site/hud/`, just the wordmark, linking back to the dashboard), the foot
(`site/page-foot.html`), the page frame (`site/sub-page.css`), and no nav
spine (`site/spine.css`). Contact's
feedback window posts to the same `POST /api/feedback` as the landing page's.

So a change to the landing page's Contact or Privacy copy reaches these pages
with no copying; a change to the header row or the foot needs its variant
here checked too.
