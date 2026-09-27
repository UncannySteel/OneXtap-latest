# Onextap landing page

Vanilla JS + [Vite](https://vite.dev). GSAP (ScrollTrigger) and Lenis come from npm.
The paper effects are hand-written WebGL — no 3D library.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # outputs to dist/
npm run test:e2e   # Playwright: Chromium desktop + phone, WebKit desktop
```

## How the page moves

The page is played like one timeline. Every chapter is a full-screen **sheet**
stacked inside one sticky, viewport-sized stage; scrolling the track beneath
it scrubs a single GSAP timeline, one screen of scroll per timeline unit
(`src/app/stage.js`). Chapters are joined by paper-themed transitions:

| Transition | What happens | Where |
| --- | --- | --- |
| `cover` | the next sheet is dealt on top; the one below sinks and dims (`torn: true` rips its top edge) | `shared/transitions/sheets.js` |
| `curtain` | the top sheet lifts away like a lid | `shared/transitions/sheets.js` |
| `crumple` | the sheet is screwed up into a ball and thrown out of frame | `shared/transitions/paper.js` |
| `curl` | the sheet peels back from the corner like a page | `shared/transitions/paper.js` |
| `blot` | the next chapter's colour soaks out from a point, like ink | `shared/transitions/blot.js` |

`crumple` and `curl` hand the live section to a WebGL sheet for the length of
the exit: the section is snapshotted at the exact frame the exit starts (DOM →
SVG `foreignObject` → canvas → texture) and bent in a vertex shader. Until the
snapshot is ready, or without WebGL, the same progress drives a CSS stand-in on
the live element, so the story always gets told. Reduced motion (or no
JavaScript) skips all of it: the chapters sit in normal flow, one screen each,
with every state already shown.

A chapter taller than the screen (phones, short laptops) is not cut off: its
overflow scrolls up inside its sheet, on the timeline, before it leaves.

The nav is the exception to all that scrolling. The menu's links (and the
mark and wordmark) carry `data-jump`: they land on the moment their chapter
has arrived in a single step, behind the still-open menu, so none of the story
between is played on the way. Other in-page links still scroll through it.

## The company pages

The footer's About, Contact and Privacy links go to pages of their own
(`/about/`, `/contact/`, `/privacy/`). They are ordinary scrolling pages, not
stages, but they keep the landing page's cursor, nav spine, menu and header
row. The menu's links there go back to the landing page and land on their
chapter the way a jump does (`/#price`; `src/app/arrival.js`). Each page has a
Back button at the top: it goes back to wherever on the site the reader came
from (the landing page puts them back where they left the story), or home if
they arrived from outside. Contact has a feedback window (`features/feedback`).

## The windows

The site's pop-ups share one behaviour (`shared/lib/dialog.js`) and one
shell (`shared/styles/dialog.css`): open, everything else is inert and the
page is held still; Escape, the ×, or a click outside closes it and focus goes
back to the button that opened it. There are three:

| Window | Opened by | Where |
| --- | --- | --- |
| Sign-in | the header's **Log in** (`[data-login]`), on every page | `features/login` |
| FAQ | the **FAQ** button in CH 05, "Get hired" (`[data-faq]`) | `features/faq` |
| Feedback | any `[data-feedback]` button on Contact | `features/feedback` |

A window's trigger carries `aria-haspopup="dialog"`; the menu closes itself
when one is pressed, so a window never opens over the open menu.

## Structure

```
index.html                  page skeleton: <head>, fonts, the stage, one [data-mount] slot per feature
about/ contact/ privacy/    the company pages' skeletons (index.html each)
vite.config.js              the four HTML entries
src/
  main.js                   imports shared CSS, mounts features, builds the stage
  app/
    mount.js                replaces each [data-mount] slot with that feature's markup
    stage.js                the sticky stage + scroll timeline, snapshots, anchors, rebuild on resize
    chapters.js             ← the page's running order and the transition into each chapter
    arrival.js              landing on a chapter from another page (/#price), and back where you left
  pages/                    the company pages
    sub-page.js             what they share: nav, header row, Back, the entrance, smooth scroll
    sub-page.css            the ink band, the chapter heads on oat, the foot
    page-foot.html          the foot: the company pages, the way home, the mark
    about/ contact/ privacy/  ← each page's copy (<name>.html) and entry script (<name>.js)
  shared/
    styles/
      tokens.css            colours, fonts, spacing (:root variables) — start here for theming
      base.css              reset, body, type roles (.display .label .lede .mono), word mask
      layout.css            chapter scaffolding (.ch, .ch__body, .wrap, .ch__head)
      buttons.css           .btn variants
      stage.css             the stage, layers, torn edge, the WebGL canvas
      dialog.css            the pop-up windows' shell: scrim, window, bar, ×
    lib/
      motion.js             reduced-motion check, GSAP registration, Lenis smooth scroll
      reveal-headlines.js   masked headline words that rise on the timeline
      split-words.js        splits text into masked words
      dom.js                el() helper
      dialog.js             pop-up window behaviour (inert page, focus, Escape)
    transitions/            cover / curtain, crumple / curl, blot (see table above)
    fx/
      fx.js                 the one WebGL canvas every effect draws into
      paper-sheet.js        a bendable sheet: crumple and curl shaders
      ink-blot.js           the spreading ink fill
      snapshot.js           DOM → canvas, via an SVG foreignObject image
      font-embed.js         inlines the page's web fonts so snapshots can use them
      gl.js                 context, shader programs, matrices
  features/
    cursor/                 custom cursor (ring, drag hand)
    nav/                    the spine (a rail down the left; a bar on phones) and the chapter menu
    hud/                    fixed header, chapter label, scroll progress
    hero/                   CH 00 — "We're hiring", struck through, crumpled → "well… we are not."
    form-fields/            CH 01 — the eleven fields + tally
    feature-showcase/       CH 02 — tabs + infinite card rail, then the typing demo form
      features.data.js        ← tab descriptions and card copy
      icons.js                SVG icon paths
      cards.js                builds cards + mini mock windows from data
      feature-tabs.js         tab bar, sliding thumb, feature swap
      rail.js                 drag/physics deck carousel
      demo-form.js            scroll-driven "typing" form
    job-boards/             CH 03 — two marquees of job boards
    pricing/                CH 04 — Free / Premium plans
    closing/                CH 05 — citrine "Get hired." band, with the FAQ button
    footer/
    faq/                    the FAQ window (CH 05)
    login/                  the sign-in window (the header's Log in)
    feedback/               the feedback window on Contact
tests/
  stage.spec.js             the e2e checks (npm run test:e2e)
  pages.spec.js             the company pages, their nav, Back, and the feedback window
  windows.spec.js           the FAQ and sign-in windows
  tour.mjs                  steps every transition at several sizes and saves frames to look at
```

Each feature folder has `<name>.html` (markup), `<name>.css` (styles, including
its reduced-motion rules) and `<name>.js` (imports both, exports `markup` and
its `init*` function). A feature that animates returns scene hooks from `init*`:
`enter(tl, at)` places its entrance on the page timeline, and `body(tl, at)`
adds its own animation once it has arrived and returns how long that takes.

## Common edits

- **Copy / text**: the feature's `.html` file. Feature-tab cards other than
  "Autofill" live in `feature-showcase/features.data.js`.
- **Colours / fonts**: `src/shared/styles/tokens.css`.
- **Menu groups and links**: `src/features/nav/nav.html`. Each link's `href` is
  a chapter's id; keep `data-jump` on it so it jumps rather than scrolls. The
  company pages rewrite them to `/#id` themselves.
- **Company page copy**: `src/pages/<name>/<name>.html`.
- **Where feedback goes**: nowhere yet. `initFeedback` in
  `src/features/feedback/feedback.js` takes a `send(note)` that returns a
  promise; until one is given, each note is only announced on the document
  as an `onextap:feedback` event.
- **FAQ questions**: `src/features/faq/faq.html`, one `<details>` each.
- **Where sign-in goes**: nowhere yet. `initLogin` in
  `src/features/login/login.js` takes a `signIn({ method, mode, email,
  password })` that returns a promise; until one is given, each attempt is
  announced on the document as an `onextap:login` event (never with the
  password) and counts as signed in.
- **Pacing, order, or which transition joins two chapters**: `src/app/chapters.js`.
  Durations are in screens of scrolling.
- **Add a section**: create `src/features/<name>/` with the three files (give
  the section `class="layer"` and wrap its content in `<div class="ch__body">`),
  add `<div data-mount="<name>"></div>` inside `<main>` in `index.html`, register
  it in `mountFeatures({...})` in `src/main.js`, and add it to `pageChapters()`
  with the transition that brings it on. Give it an id and a link in the menu.
