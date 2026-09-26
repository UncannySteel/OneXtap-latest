# Session — Left rail navigation, theme switch, auth dialog

**Date:** 2026-09-21 · **Branch:** `main` · **Scope:** landing page, UI only

Replaced the sticky top header with a fixed left rail and a full-screen
hamburger menu modelled on [evensix.com](https://evensix.com), then two
follow-up rounds: thinner rail + hero reflow + a real toggle switch for dark
mode, and finally moving sign-in out of the page and into a dialog.

---

## The ask

Three rounds, each ending in a feedback + code-cleaner loop against a checklist.

**Round 1** — take evensix.com's navigation bar, hamburger design *and*
animation. Rail on the left. Menu holds About, Contact, Pricing, Features,
How it works, FAQ, Feedback. Login and Get Extension on top of the screen.
Responsive. Keep the colour scheme. No backend, no other features.

**Round 2** — hero single-column until `lg`. Thinner rail. Dark/light becomes a
toggle switch, interactive on hover.

**Round 3** — login as a separate pop-up, removed from the bottom of the page.

---

## What the reference actually does

Inspected live, not guessed at. The rail is `.Header_headerWrapper`:

```css
@media (min-width: 50rem) {           /* 800px */
  .Header_headerWrapper { position: fixed; height: 100%; width: 5rem;
                          border-right: .0625rem solid var(--border-colour);
                          background: hsla(var(--background-colour-hsla), .9); }
}
@media (min-width: 64rem) { .Header_headerWrapper { width: 6.25rem; } }
```

The hamburger is **three vertical bars**, not horizontal — a 30×30 viewBox with
paths at x = 7, 15, 23 running y 3→27, `stroke-width: 2.5`, round caps. The
morph is four keyframe sets at 200ms:

```css
@keyframes menu-line-1-open { 100% { opacity: 0; } }                    /* middle */
@keyframes menu-line-2-open { 50% { transform: translateX(-8px); }      /* right   */
                             100% { transform: rotate(-45deg) translateX(-8px); } }
@keyframes menu-line-3-open { 50% { transform: translateX(8px); }       /* left    */
                             100% { transform: rotate(45deg) translateX(8px); } }
```

Read right-to-left, that is: converge on the viewBox centre at the halfway
mark, *then* swing out. The two outer bars land on the centre (x = 15) before
they rotate, which is why they meet as an X instead of crossing off-axis. The
closed set is the exact reverse.

The open menu is a fixed overlay at `z-index: 12` — **below** the rail's 20, so
the rail and the X stay live over it — offset by `padding-left: 5rem`, with
numbered sections (01/02/03) in a 3-column grid of large underlined display
links and a footer row.

Two deliberate departures:

- Below `50rem` the reference rotates the whole icon 45°, leaving three
  diagonal bars rather than an X. The X morph is the better animation and the
  thing the brief asked for, so it runs at every width here.
- Their top nav is `position: absolute` and scrolls away. Get Extension is this
  product's conversion action, so the top bar is fixed and frosts on scroll —
  the behaviour their *mobile* header has, applied to the desktop strip.

---

## Files

| | |
|---|---|
| **Added** | `src/components/dashboard/LandingNav.jsx` (284 lines) — rail, top bar, overlay menu, theme switch |
| **Added** | `src/components/dashboard/AuthModal.jsx` (200 lines) — the sign-in form, lifted out of the page |
| **Edited** | `src/components/dashboard/PublicLandingPage.jsx` — header removed, three sections added, `#auth` section deleted, 16 auth props shed |
| **Edited** | `src/components/dashboard/DashboardView.jsx` — owns the dialog next to `PremiumModal` |
| **Edited** | `src/components/dashboard/useAuthForm.js` — `clearAuthError` added |
| **Edited** | `src/index.css` — `.ot-burger` keyframes, `.ot-switch-knob` transition, both added to the reduced-motion block |

---

## Anatomy — what is actually in it

```
DashboardView                       owns useAuthForm + isAuthModalOpen
└─ if (!user)
   ├─ PublicLandingPage             onOpenAuth, onOpenPremiumModal, user
   │  └─ LandingNav                 darkMode, onToggleDarkMode, onNavigate,
   │     │                          onSignIn, onGetExtension
   │     ├─ <header>                rail (md+) / top bar (<md)   z-[45]
   │     │  ├─ logo button          scroll-to-top, wordmark sm→md only
   │     │  ├─ <AuthActions compact> md:hidden
   │     │  ├─ burger button        aria-expanded + aria-controls="site-menu"
   │     │  └─ <ThemeSwitch>        hidden md:inline-flex
   │     ├─ <div> top bar           hidden md:block, pointer-events-none  z-[45]
   │     │  └─ <AuthActions>        pointer-events-auto on each button
   │     └─ <nav id="site-menu">    full-screen overlay             z-40
   │        ├─ 3 × numbered section 01 Product / 02 Company / 03 Support
   │        └─ footer row           Privacy Policy · ThemeSwitch (md:hidden) · ©
   ├─ AuthModal                     {...authForm} isOpen onClose      z-50
   ├─ Toast                                                          z-[100]
   └─ PremiumModal                                                    z-50
```

### Every measurement in one place

| Thing | Value | Where |
|---|---|---|
| Bar / rail height | `68px` | `h-[68px]`, and `pt-[68px]` on the page root and overlay |
| Rail width | `64px` @ `md`, `72px` @ `lg` | `md:w-16 lg:w-[72px]` |
| Rail offset — page | `md:pl-16 lg:pl-[72px]` | `PublicLandingPage` root div |
| Rail offset — top bar | `md:left-16 lg:left-[72px]` | top bar, with `right-0` |
| Rail offset — overlay | `md:pl-16 lg:pl-[72px]` | `#site-menu` |
| Section scroll offset | `scroll-mt-20` (80px) | every `<section id>` — clears the 68px bar |
| Burger icon | `30×30` viewBox, bars at x = 7/15/23, y 3→27, stroke 2.5, round caps | `LandingNav` |
| Burger animation | `200ms ease both`, converge ±8px at 50%, rotate ±45° at 100% | `index.css` |
| Menu item stagger | `100ms + index × 45ms`, 500ms transition | inline `transitionDelay` |
| Overlay fade | `transition-[opacity,visibility] duration-300` | `#site-menu` |
| Switch track | `44 × 24`, 1px border → 42px inner | `ThemeSwitch` |
| Switch knob | `18px`, travel `2px ↔ 22px`, hover `5px` / `19px` | `ThemeSwitch` |
| Knob easing | `transform .35s cubic-bezier(.16,1,.3,1)` | `.ot-switch-knob` |
| Top-bar frost trigger | `window.scrollY > 8` | `scrolled` state |

### z-index ladder

`40` overlay menu → `45` rail **and** top bar → `50` AuthModal / PremiumModal →
`100` Toast. The overlay sits *below* the rail on purpose: that is what keeps
the X and the Log in / Get Extension pair clickable while the menu is open.

### Component APIs

**`LandingNav`** — default export. Also named-exports `MENU_SECTIONS`.

| Prop | Type | Notes |
|---|---|---|
| `darkMode` | `boolean` | state lives in `PublicLandingPage` |
| `onToggleDarkMode` | `() => void` | |
| `onNavigate` | `(id: string) => void` | receives a section id, does the scroll |
| `onSignIn` | `() => void` | opens the dialog in signin mode |
| `onGetExtension` | `() => void` | `openChromeWebStore` |

Internal state is only `menuOpen`, `everOpened`, `scrolled`. No auth, no theme.

**`ThemeSwitch`** — `{ darkMode, onToggle, className, tabIndex }`. Rendered
twice: rail (`hidden md:inline-flex`) and overlay footer (`md:hidden`, with a
"Dark mode" label and `tabIndex={menuOpen ? 0 : -1}`).

**`AuthActions`** — `{ compact, onSignIn, onGetExtension }`. Rendered twice:
inside the rail for the mobile bar (`compact`) and in the desktop top bar.
`compact` only changes padding and type size.

**`AuthModal`** — `{ isOpen, onClose, ...useAuthForm() }`. Returns `null` when
closed, so nothing is in the DOM. Owns no auth state.

### The menu data

Order the columns read, not the order of the page. Every `id` must match a live
`<section id>` — a link with no target is a broken link.

```js
export const MENU_SECTIONS = [
  { n: '01', title: 'Product', items: [
    { id: 'features', label: 'Features' },
    { id: 'how-it-works', label: 'How it works' },
    { id: 'pricing', label: 'Pricing' } ] },
  { n: '02', title: 'Company', items: [
    { id: 'about', label: 'About' },
    { id: 'contact', label: 'Contact' } ] },
  { n: '03', title: 'Support', items: [
    { id: 'faq', label: 'FAQ' },
    { id: 'feedback', label: 'Feedback' } ] },
];

// one running sequence across all three columns, so the stagger reads as one
const STAGGER_INDEX = new Map(
  MENU_SECTIONS.flatMap((s) => s.items).map((item, i) => [item.id, i]));
```

### The three chassis class strings

Rail — one element, two layouts:

```
fixed inset-x-0 top-0 z-[45] flex h-[68px] items-center gap-2
border-b border-[rgba(42,60,28,0.12)] bg-onextap-cream/90 px-5 backdrop-blur-xl
transition-colors duration-300
dark:border-[rgba(200,216,168,0.15)] dark:bg-onextap-night/90
md:inset-x-auto md:left-0 md:h-full md:w-16 md:flex-col md:gap-0
md:border-b-0 md:border-r md:px-0 md:py-6 lg:w-[72px]
```

Top bar — `right-0` plus a left offset, never `inset-x-0` (see bug 2):

```
pointer-events-none fixed right-0 top-0 z-[45] hidden
transition-colors duration-300 md:left-16 md:block lg:left-[72px]
  + scrolled ? 'border-b border-[rgba(42,60,28,0.12)] bg-onextap-cream/85
               backdrop-blur-xl dark:bg-onextap-night/85'
             : 'border-b border-transparent'
```

Overlay:

```
fixed inset-0 z-40 overflow-y-auto overscroll-contain bg-onextap-cream
pt-[68px] transition-[opacity,visibility] duration-300
dark:bg-onextap-night md:pl-16 md:pt-0 lg:pl-[72px]
  + menuOpen ? 'visible opacity-100' : 'invisible opacity-0'
```

---

## How to rebuild it

From a tree that still has the old sticky `<header>` and the `#auth` section.

**1. The CSS first** — `src/index.css`, above the reduced-motion block:

```css
.ot-burger path { transform-box: view-box; transform-origin: center; }

.ot-burger.is-open   .ot-burger-mid   { animation: otBurgerMidOpen    200ms ease both; }
.ot-burger.is-open   .ot-burger-right { animation: otBurgerRightOpen  200ms ease both; }
.ot-burger.is-open   .ot-burger-left  { animation: otBurgerLeftOpen   200ms ease both; }
.ot-burger.is-closed .ot-burger-mid   { animation: otBurgerMidClose   200ms ease both; }
.ot-burger.is-closed .ot-burger-right { animation: otBurgerRightClose 200ms ease both; }
.ot-burger.is-closed .ot-burger-left  { animation: otBurgerLeftClose  200ms ease both; }

@keyframes otBurgerMidOpen    { to { opacity: 0; } }
@keyframes otBurgerRightOpen  { 50% { transform: translateX(-8px); }
                               100% { transform: rotate(-45deg) translateX(-8px); } }
@keyframes otBurgerLeftOpen   { 50% { transform: translateX(8px); }
                               100% { transform: rotate(45deg) translateX(8px); } }
@keyframes otBurgerMidClose   { 0% { opacity: 0; } 100% { opacity: 1; } }
@keyframes otBurgerRightClose { 0% { transform: rotate(-45deg) translateX(-8px); }
                               50% { transform: translateX(-8px); }
                              100% { transform: none; } }
@keyframes otBurgerLeftClose  { 0% { transform: rotate(45deg) translateX(8px); }
                               50% { transform: translateX(8px); }
                              100% { transform: none; } }

.ot-switch-knob {
  transition: transform .35s cubic-bezier(.16, 1, .3, 1),
              background-color .3s ease, color .3s ease;
}
```

And inside the existing `@media (prefers-reduced-motion: reduce)` block:

```css
.ot-burger path  { animation-duration: 1ms !important; }   /* end state, no travel */
.ot-menu-item    { transition: none !important; transition-delay: 0ms !important; }
.ot-switch-knob  { transition: none !important; }
```

`1ms` rather than `none` is deliberate — the burger must still *reach* its end
state, only instantly. `animation: none` would strand it mid-morph.

**2. The burger markup** — three paths, classed so the CSS can address them
individually, and `aria-hidden` because the button carries the label:

```jsx
<svg className={`ot-burger ${burgerState}`} width="30" height="30"
     viewBox="0 0 30 30" fill="none" aria-hidden="true">
  <path className="ot-burger-mid"   d="M15 3v24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  <path className="ot-burger-right" d="M23 3v24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  <path className="ot-burger-left"  d="M7 3v24"  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
</svg>
```

with

```js
const burgerState = menuOpen ? 'is-open' : everOpened ? 'is-closed' : '';
```

The empty third case is what stops the close animation running on mount.

**3. `LandingNav.jsx`** — the three chassis strings above, plus:

```js
useEffect(() => {                       // top bar frosts once the page moves
  const onScroll = () => setScrolled(window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
  return () => window.removeEventListener('scroll', onScroll);
}, []);

useEffect(() => {                       // escape closes
  if (!menuOpen) return undefined;
  const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [menuOpen]);

const go = (id) => { setMenuOpen(false); onNavigate(id); };
```

Do **not** add a body scroll lock here. `go` calls `onNavigate` synchronously
while React's effect cleanup — which would release the lock — does not run until
after paint, so the scroll would fire against a locked body.

Menu items get `tabIndex={menuOpen ? 0 : -1}` and an inline delay:

```jsx
style={{ transitionDelay: menuOpen ? `${100 + STAGGER_INDEX.get(item.id) * 45}ms` : '0ms' }}
className={`ot-menu-item ... ${menuOpen ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'}`}
```

**4. `ThemeSwitch`** — `role="switch"` + `aria-checked`, knob carries the mode
that is *on*, and hover leans it toward its travel:

```jsx
darkMode
  ? 'translate-x-[22px] bg-onextap-olive-pale text-onextap-primary group-hover:translate-x-[19px]'
  : 'translate-x-[2px]  bg-onextap-primary    text-white            group-hover:translate-x-[5px]'
```

Track hover adds a 3px ring: `hover:shadow-[0_0_0_3px_rgba(45,74,45,0.10)]`
in light, `rgba(200,216,168,0.14)` in dark.

**5. Wire the page** — in `PublicLandingPage`:

- delete the old `<header>` and the fixed top-right dark-mode button;
- render `<LandingNav>` with the five props;
- put `pt-[68px] md:pl-16 lg:pl-[72px]` on the root div;
- give the three-step band `id="how-it-works"`, and add `about`, `contact`,
  `feedback` sections — every menu id needs a target;
- every section keeps `scroll-mt-20`.

**6. The dialog** — `AuthModal.jsx` takes the old `#auth` form body verbatim.
Add, in this order:

```js
const onCloseRef = useRef(onClose);      // so an inline onClose cannot re-run
onCloseRef.current = onClose;            // the effect and steal focus back

useEffect(() => {
  if (!isOpen) return undefined;
  const previouslyFocused = document.activeElement;
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  const onKey = (e) => { if (e.key === 'Escape') onCloseRef.current(); };
  window.addEventListener('keydown', onKey);
  const focusTimer = setTimeout(() => cardRef.current?.querySelector('input')?.focus(), 0);
  return () => {
    clearTimeout(focusTimer);
    window.removeEventListener('keydown', onKey);
    document.body.style.overflow = previousOverflow;
    if (previouslyFocused instanceof HTMLElement && document.contains(previouslyFocused)) {
      previouslyFocused.focus();
    }
  };
}, [isOpen]);                            // isOpen only — see the ref above
```

Backdrop gets `onClick={onClose}`; the card gets
`onClick={(e) => e.stopPropagation()}` and `relative`, and the close button is
`absolute right-4 top-4` — **not** floated (bug 3).

**7. Hoist the dialog to `DashboardView`**, delete the `#auth` section, and
repoint its four entry points at `onOpenAuth(mode)`:

```jsx
const openAuthModal = (mode) => {
  authForm.setAuthMode(mode); authForm.clearAuthError(); setIsAuthModalOpen(true);
};
const closeAuthModal = () => { setIsAuthModalOpen(false); authForm.clearAuthError(); };

<PublicLandingPage onOpenAuth={openAuthModal} onOpenPremiumModal={...} user={user} />
<AuthModal {...authForm} isOpen={isAuthModalOpen} onClose={closeAuthModal} />
```

`clearAuthError` is new on `useAuthForm`; add it to the returned object.

**8. Rebuild both bundles** — `npm run build` and `npm run build:dashboard`.
`CLAUDE.md` rule 1: a loaded extension does not pick up dev-server changes.

### Checks that actually catch things

Run these rather than eyeballing — each one found a real bug here.

```js
// overflow: the page root clips with overflow-x:hidden, so scrollWidth lies.
// measure the children instead.
[...document.querySelector('header').children]
  .filter(c => c.getBoundingClientRect().width > 0)
  .map(c => Math.round(c.getBoundingClientRect().right));   // all <= clientWidth?

// the four rail offsets must agree
getComputedStyle(root.firstElementChild).paddingLeft;        // page
topBar.getBoundingClientRect().x;                            // top bar
getComputedStyle(document.getElementById('site-menu')).paddingLeft;
document.querySelector('header').getBoundingClientRect().width;

// burger really reaches the X (not just "looks moved")
getComputedStyle(document.querySelector('.ot-burger-right')).transform;
// open:  matrix(0.707107, -0.707107, 0.707107, 0.707107, -5.65685, 5.65685)
// 100ms into close: matrix(1, ~0, ~0, 1, -8, ~0)   ← the converge halfway mark
// closed: matrix(1, 0, 0, 1, 0, 0)

// every menu link lands where it should
Math.abs(document.getElementById(id).getBoundingClientRect().top - 80) <= 2;
```

Widths worth testing: **320** (the one that broke), 375, 767, 768, 900, 1024,
1280, 1440.

---


## Design decisions

**One `<header>`, two layouts.** Below `md` it is a 68px top bar holding logo,
Log in, Get Extension and the burger; from `md` up the same element becomes a
full-height rail with `md:flex-col`. The reference does the same rather than
rendering two headers, and it keeps a single source of truth for the chrome.

**Four places encode the rail width** — the rail, the top bar's left offset,
the overlay's padding and the page's padding. They are asserted together in
verification (all read 64px at 768) because a mismatch is invisible until
something overlaps.

**The menu does not lock body scroll; the dialog does.** The overlay is
`overflow-y-auto overscroll-contain`, so it owns its own scroll and chains
nothing — the reference is the same. A lock would also have been a trap:
`go(id)` calls `setMenuOpen(false)` then `scrollIntoView` synchronously, and
React runs the effect *cleanup* that would release the lock after paint, so the
scroll would fire against a locked body. The auth dialog locks freely because
nothing needs to scroll underneath it.

**`everOpened`.** Without it the closed keyframes run on mount and the icon
unfolds from an X nobody opened. The reference has this artefact; it is skipped
here by leaving the state class off until the first open.

**`tabIndex` on overlay controls looks redundant and isn't.** `visibility:
hidden` removes a closed menu from the tab order — but visibility is
*transitioned*, so it reads `visible` for 300ms on the way out. The explicit
`tabIndex` covers that window.

**`transform-box: view-box` is pinned explicitly.** The paths rotate about the
viewBox centre. Left to the per-element bounding box, each line would rotate
around itself and the bars would never meet.

**Three new sections, because the menu named targets that did not exist.**
About, Contact and Feedback had no home on the page; a link that scrolls
nowhere is a broken link. Contact and Feedback are `mailto:` only — a form
needs an endpoint, and backend was out of scope. The About privacy paragraph is
worded against `privacy-policy.html`, which says in as many words that *stored
locally is not the same as never transmitted*: "stored on your device rather
than in our database… only the text that request needs is sent to our AI
providers."

**The switch shows the mode that is on, and leans toward its travel.** Knob
right + moon when dark, left + sun when light — `role="switch"` with
`aria-checked`, so it is announced as a switch rather than a button. Hover does
three things at once: the track border goes solid, a 3px ring blooms, and the
knob shifts 3px toward where it is about to go.

**The dialog lives in `DashboardView`, not the landing page.** It sits beside
`PremiumModal` and takes `{...authForm}`, which let `PublicLandingPage` trade
sixteen auth props for one `onOpenAuth(mode)`. Four entry points feed it: Log in
→ signin, Get started free → signup, Upgrade to Premium while signed out →
signup, footer Sign In → signin.

**`clearAuthError` fires on open *and* close, which is not redundant.**
Dismissing the dialog mid-request lands the failure in state *after* the close
ran, so only the reopen can clear that one. Commented in place so it does not
get tidied away.

---

## Verification

Run in Playwright. The in-app browser pane cannot do this job — see the false
alarm below.

| Check | Result |
|---|---|
| Burger open state | pass — mid `opacity: 0`, outer bars `rotate(±45deg)` with translate |
| Burger mid-close at 100ms | pass — pure `translateX(∓8px)`, rotation gone: the converge-then-swing halfway mark |
| No animation class on first paint | pass — `class="ot-burger"` |
| All 7 menu links | pass — every one lands at exactly 80px, menu closes |
| Escape closes the menu | pass |
| Stagger | pass — 100ms → 370ms in 45ms steps, one sequence across three columns |
| Switch state | pass — `aria-checked`, `dark` class, `localStorage` and knob 2px ↔ 22px round-trip |
| Switch hover | pass — border `#2D4A2D`, 3px ring, knob 2 → 5px |
| Dialog opens / closes via Escape, X, backdrop | pass — card click does *not* close |
| Dialog focus | pass — moves to the first input, returns to the trigger |
| Body scroll released on every close path | pass |
| Stale auth error cleared on reopen | pass |
| All four dialog entry points | pass — correct mode each time |
| `#auth` section and dead links | pass — zero of each |
| 320 / 375 / 767 / 768 / 900 / 1024 / 1280 / 1440 | pass — no horizontal overflow at any size |
| Rail width | pass — 64px @ `md`, 72px @ `lg`, all four offsets agree |
| Hero columns | pass — single at 768/900, two at 1280/1440 |
| Dialog on 375×640 in signup mode | pass — whole form on screen |
| Dark mode | pass — rail, top bar, overlay, dialog, new sections |
| `prefers-reduced-motion: reduce` | pass — burger jumps to its end state, knob `transition: 0s`, nothing stranded invisible |
| FAQ accordion, footer, theme switch | pass |
| Console | 0 errors, 0 warnings |
| `npm test` | 544 pass, 2 skipped, 0 fail |
| `npm run build` + `npm run build:dashboard` | both clean |

**Not verified:** a real successful sign-in. That needs live credentials, so the
success path — `onAuthenticated` firing, landing page and dialog unmounting
together — is unchanged code reasoned through rather than run. Everything up to
the network call is exercised.

---

## Bugs found in the cleaner passes, fixed and re-verified

**1. The burger fell off the screen at 320px.**
Right edge 329 against a 314px viewport. It reported no overflow, because the
page root carries `overflow-x: hidden` — the clip *hid* the bug rather than
preventing it. Measuring child rects against `clientWidth` is what caught it;
`scrollWidth > clientWidth` never would. Fixed by dropping the wordmark below
`sm` (`hidden sm:inline md:hidden`), which is also where the desktop rail drops
it. Max right went to 294.

**2. The frosted top bar painted over the rail's logo.**
It spanned `inset-x-0` with `md:pl-20`, so its *content* cleared the rail but
its background did not — and at equal z-index it came later in the DOM, so it
won. Fixed to `right-0 md:left-16 lg:left-[72px]`, which is what the reference
does (`left: 5rem; right: 0`).

**3. The floated close button pushed the dialog title off-centre.**
`float-right` puts the button in the heading's line box, so "Welcome back"
centred inside the remaining width — 13px left of the card's true centre.
Fixed with `absolute right-4 top-4`. Card centre and title centre now both 640.

**4. A trailing-space grep dropped a live import.**
`grep -o "<Plus "` reports 0 for `<Plus\n` — the icon is written multi-line. The
import was removed on that evidence and would have broken the FAQ accordion.
Caught before the build. The audit was rewritten to count `\bName\b` across the
file and discount the import line, which is what found the genuinely dead
`Activity` later.

---

## A false alarm worth remembering

Early verification through the in-app browser pane showed, in order: smooth
scroll frozen at a fixed `scrollY`, `window.scrollTo` doing nothing, the menu
never closing, screenshots a frame or two stale, then one fully blank. Each
looked like a real defect and none was.

`document.visibilityState === 'hidden'` — the pane was open but not displayed,
which pauses rAF, CSS transitions and smooth scrolling. `aria-expanded` was
flipping correctly the whole time; the *transitioned* `visibility` simply never
advanced, so the menu read `visible` forever. Fronting the tab did not help.

Switched to Playwright and every symptom vanished on the first run. Rule of
thumb: check `document.visibilityState` before believing a motion bug.

---

## What later sessions changed

Written after the fact, so the map stays honest. The nav contract survived
intact — all seven menu targets still resolve — but five of them have since
moved out of `PublicLandingPage.jsx` into components of their own:

| Menu target | Lives in now |
|---|---|
| `#features`, `#how-it-works` | `FeatureCarousel.jsx` |
| `#about` | `AboutSection.jsx` |
| `#contact`, `#feedback` | `SiteFooter.jsx` |
| `#pricing`, `#faq` | still `PublicLandingPage.jsx` |

The About, Contact and Feedback sections this session added are the ancestors
of those components. `LandingNav.jsx` and `AuthModal.jsx` are unchanged and
still wired.

---

## Environment notes

- Reference CSS was read out of `document.styleSheets` on the live site rather
  than inferred from screenshots — the vertical-bar geometry and the exact
  keyframe percentages are not guessable from a picture.
- `npm run dev` uses `vite.config.js`, the **extension** config. For the
  landing page: `npx vite preview --config vite.dashboard.config.js --port 4173`
  against a fresh `npm run build:dashboard`.
- Playwright can only write inside the repo, so screenshots went to
  `.playwright-mcp/` and were deleted afterwards.
- Per `CLAUDE.md` rule 1, both bundles were rebuilt after the last edit.
