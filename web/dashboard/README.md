# Onextap dashboard (frontend)

Plain HTML/CSS/ES modules — no build step and nothing to install. The fonts come from Google
Fonts; the company pages' two libraries (GSAP, Lenis) are checked in under `vendor/`.

It shares the landing page's design language (`../demo`): the same palette, faces and
motion curves, copied value for value into `css/tokens.css` — change them in both places.
Forest-black for the chrome, an oat sheet for the workspace, citrine as the one loud note;
Archivo condensed for display type, Instrument Serif for the voice, Instrument Sans for UI,
DM Mono for figures.

```
python -m http.server 5173   # then open http://localhost:5173
```
(ES modules need to be served; opening `index.html` from disk won't load the JS.)

## Structure

| File | What it's for |
| --- | --- |
| `index.html` | Page shell: top bar, settings menu, profile/dock, workspace, footer, delete dialog |
| `css/tokens.css` | The landing page's colours, fonts and easing curves, plus radii and sizes — retheme here |
| `css/dashboard.css` | Type roles, layout for the home view, the docked/floating workspace view, mobile, and the cursor |
| `js/config.js` | Nav items / workspaces. Add one here and it gets a button, a dock entry and a `#/<id>` route. Also the plans (Standard, Pro) |
| `js/services.js` | **Backend boundary.** Mock user + stubbed actions — replace with real API calls |
| `js/workspaces.js` | Placeholder workspace content; swap in real views per workspace id |
| `js/dock.js` | Dock left / right / floating, drag, edge-snap, resize — persisted in `localStorage` |
| `js/settings.js` | Settings dropdown (keyboard + outside-click handling) |
| `js/subscription.js` | The Manage subscription panel: current plan, both plans, upgrade / switch, billing |
| `js/motion.js` | The landing's masked-word headline rise, and the reduced-motion check |
| `js/cursor.js` | The landing's cursor: a trailing citrine ring; a "Drag" grip over the dock bar |
| `js/main.js` | Boot, routing, user binding, settings actions, the entrance, the dock's sliding thumb |
| `contact/`, `privacy/` | The company pages, one `index.html` each (see below) |
| `site/` | The landing page's source for those pages, copied from `../demo/src` at the same paths |
| `vendor/` | GSAP 3.12.5 and Lenis 1.1.18, the versions the landing page builds with |

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

Contact and Privacy are the landing page's own (`../demo/contact/`, `../demo/privacy/`), cut down.
They look the same as the landing page's, except that they have no nav spine or chapter menu, no
Log in or Add to Chrome in the header (which is just the wordmark, linking back to the dashboard),
no chapter label or scroll progress along the bottom, and no Company or The story links in the foot.

`site/` is a copy of the parts of `../demo/src` they use (not `features/nav` or `features/login`),
with those pieces taken out of `features/hud`, `pages/page-foot.html` and `pages/sub-page.js`,
`--spine` set to 0 in `shared/styles/tokens.css`, and these changes where Vite did the work:

- `import markup from './x.html?raw'` became `var markup = await loadText('./x.html', import.meta.url)` (`site/shared/lib/load.js`).
- The CSS imports were dropped; each page links the styles in its `<head>`, in the build's cascade order.
- `gsap`, `gsap/ScrollTrigger` and `lenis` resolve through an import map in each page to `vendor/`.

To pick up a change to the landing page, copy the changed file from `../demo/src` to the same path
under `site/` and repeat whichever of those edits it needs.

The links in their copy are the landing page's, unchanged: `/contact/` and `/privacy/` work here,
but Contact's "See pricing" (`/#price`) expects the landing page at the site root, and here the root
is the dashboard.
