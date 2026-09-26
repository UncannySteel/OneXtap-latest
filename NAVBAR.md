# Left-rail navigation — portable spec

A fixed rail down the left edge, a vertical-bar hamburger that morphs into an X,
a full-screen numbered menu, an auth pair pinned top-right, and a dark-mode
switch. Modelled on [evensix.com](https://evensix.com).

Shipped in Onextap as `src/components/dashboard/LandingNav.jsx`. This document
is the **portable** version: every design token resolved to a real value, and a
complete dependency-free implementation you can paste into any site. If your
target already runs React + Tailwind, skip to [React + Tailwind](#react--tailwind).

---

## What it looks like

```
≥768px                                  <768px
┌────┬──────────────────────────┐       ┌──────────────────────────────┐
│ ◯  │           Log in  [Get…] │       │ ◯ Name   Log in [Get…]   ||| │
│    │                          │       ├──────────────────────────────┤
│    │                          │       │                              │
│ ┃┃┃│        page content      │       │        page content          │
│    │                          │       │                              │
│    │                          │       │                              │
│ ▣  │                          │       │                              │
└────┴──────────────────────────┘       └──────────────────────────────┘
 rail                                    rail collapses to a top bar

menu open (the rail stays on top of it, burger is now an X)
┌────┬──────────────────────────────────────────────┐
│ ◯  │  01 PRODUCT     02 COMPANY     03 SUPPORT    │
│    │                                              │
│    │  Features       About          FAQ           │
│ ✕  │  How it works   Contact        Feedback      │
│    │  Pricing                                     │
│    │  ────────────────────────────────────────    │
│ ▣  │  Privacy Policy                  © 2026 Name │
└────┴──────────────────────────────────────────────┘
```

Three fixed layers, and the z-order is the whole trick:

| Layer | z-index | Why |
|---|---|---|
| Overlay menu | `40` | |
| Rail **and** top bar | `45` | **above** the overlay, so the X and the auth buttons stay clickable while the menu is open |
| Your modals | `50`+ | |

---

## Content

Exactly as shipped. The menu is three numbered groups; the numbers are decorative
and follow reading order, not page order.

| Group | Items |
|---|---|
| `01 Product` | Features · How it works · Pricing |
| `02 Company` | About · Contact |
| `03 Support` | FAQ · Feedback |

- **Top-right pair:** `Log in` (text button) and `Get Extension` (filled button)
- **Rail:** logo mark at top, hamburger centred, theme switch at the bottom
- **Mobile bar:** logo + wordmark, `Log in`, `Get Extension`, hamburger
- **Overlay footer:** `Privacy Policy` · `Dark mode` + switch (mobile only) · `© YEAR Name`

The wordmark shows only between `640px` and `767px` — below that it crowds the
buttons off the bar, above that the rail is too narrow for it.

> **Every menu item must have a target.** The seven ids (`features`,
> `how-it-works`, `pricing`, `about`, `contact`, `faq`, `feedback`) have to exist
> as elements on the page or the links scroll nowhere. See
> [Adapting it](#adapting-it-to-another-site).

---

## Design tokens

### Colour

Both themes. Swap the hex values to re-skin; the structure does not change.

| Role | Light | Dark |
|---|---|---|
| Page / rail / overlay background | `#F5F2EC` | `#1A2414` |
| Rail + top-bar surface (translucent) | `rgba(245,242,236,.90)` | `rgba(26,36,20,.90)` |
| Top bar once scrolled | `rgba(245,242,236,.85)` | `rgba(26,36,20,.85)` |
| Hairline border | `rgba(42,60,28,.12)` | `rgba(200,216,168,.15)` |
| Stronger border (switch track) | `rgba(42,60,28,.25)` | `rgba(200,216,168,.30)` |
| Primary (buttons, accents) | `#2D4A2D` | `#2D4A2D` |
| Primary hover | `#3D5C3D` | `#3D5C3D` |
| Accent / on-dark highlight | `#C8D8A8` | `#C8D8A8` |
| Heading + menu link text | `#1A1A14` | `#E8EFD8` |
| Secondary text (Log in, burger) | `#4A4A38` | `#9AB07A` |
| Muted text (group labels, ©) | `#7A7A64` | `#9AB07A` |
| Menu link underline | `rgba(26,26,20,.20)` | `rgba(200,216,168,.28)` |
| Switch focus ring | `rgba(45,74,45,.40)` | `rgba(45,74,45,.40)` |
| Switch hover ring | `rgba(45,74,45,.10)` | `rgba(200,216,168,.14)` |

### Type

| Element | Size | Weight | Other |
|---|---|---|---|
| Menu link | `34px` → `46px` @768 → `52px` @1024 | 400 | display serif, `line-height 1.1`, `letter-spacing -.02em`, underline `2px` at `7px` offset |
| Group label (`01 PRODUCT`) | `11px` | 600 | uppercase, `letter-spacing .14em` |
| Wordmark | `16px` | 600 | `letter-spacing -.01em` |
| `Log in` | `14px` (mobile `13px`) | 500 | |
| `Get Extension` | `14px` (mobile `12.5px`) | 500 | |
| Overlay footer | `13px` | 300 | |

Fonts as shipped: **Instrument Serif** for menu links, **DM Sans** for
everything else. Any serif/sans pair works — the menu link is the only place the
display face appears, and it is what gives the overlay its character.

### Measurements

| Thing | Value |
|---|---|
| Bar height (mobile rail, top bar) | `68px` |
| Rail width | `64px` @768 · `72px` @1024 |
| Page content offset | `padding-top: 68px`; `padding-left` = rail width @768+ |
| Logo mark | `32px`, `8px` radius |
| Burger icon | `30×30` viewBox, bars at x `7 / 15 / 23`, y `3 → 27`, stroke `2.5`, round caps |
| Burger morph | `200ms ease both` — converge `±8px` at 50%, rotate `±45°` at 100% |
| Overlay fade | `300ms` on `opacity` + `visibility` |
| Menu item entrance | `500ms`, delay `100ms + index × 45ms` across all three columns |
| Menu container | `max-width 1100px`, padding `24px/40px` → `40px/48px` @768 |
| Switch track | `44 × 24`, fully rounded, `1px` border |
| Switch knob | `18px`, travel `2px ↔ 22px`, hover `5px ↔ 19px` |
| Knob easing | `transform .35s cubic-bezier(.16,1,.3,1)` |
| Section scroll offset | `scroll-margin-top: 80px` on every target |
| Top-bar frost trigger | `scrollY > 8` |
| Breakpoints | `640` wordmark · `768` rail · `1024` wide rail + 3 columns |

---

## Behaviour

**Rail.** Fixed, full height from `768px`. Below that the same element becomes a
`68px` top bar — one element, two layouts, via `flex-direction`.

**Top bar.** Fixed, starts at the rail's right edge (`left: 64px` / `72px`,
`right: 0`) — never full-width, or its background paints over the rail's logo.
Transparent at the top of the page, picks up a frosted background past `8px` of
scroll. `pointer-events: none` on the strip, `auto` on the buttons, so it does
not block the hero underneath.

**Burger.** Three vertical bars. On open, the middle fades out while the outer
two slide to the icon's centre and *then* rotate ±45°, meeting as an X. On close,
exactly reversed. The state class is absent until the first open, so the close
animation cannot run on mount.

**Overlay.** Fades in over `300ms`, offset by the rail so the rail stays visible.
Items rise and fade in on one running stagger across all three columns. Closes on
Escape, on any item click, and on the burger. It scrolls internally on short
screens.

**Switch.** `role="switch"` + `aria-checked`. The knob carries the mode that is
**on** — sun left when light, moon right when dark. Hover does three things at
once: track border solidifies, a `3px` ring blooms, and the knob leans `3px`
toward where it is about to travel.

---

## Drop-in implementation

Dependency-free. Three files, or three blocks in one.

**This code was extracted from this document and run**, not written from memory.
Verified at 320/1280 in both themes: all four rail offsets agree at 72px, the bar
is exactly 68px, the burger reaches the documented X matrix, menu items land at
80px, Escape and item-click both close, and both switches stay in sync with
`localStorage`. The `box-sizing` reset and gotcha 8 exist because running it is
what surfaced them.

### HTML

```html
<header class="rail" id="rail">
  <a class="rail__logo" href="#top" aria-label="Back to top">
    <img src="/icon.png" alt="" width="32" height="32">
    <span class="rail__wordmark">Onextap</span>
  </a>

  <!-- mobile only: the desktop copy lives in .topbar -->
  <div class="rail__auth">
    <button class="btn btn--ghost btn--sm" data-action="login">Log in</button>
    <button class="btn btn--solid btn--sm" data-action="cta">Get Extension</button>
  </div>

  <button class="burger" id="burger" aria-expanded="false"
          aria-controls="site-menu" aria-label="Open menu">
    <svg class="burger__icon" width="30" height="30" viewBox="0 0 30 30"
         fill="none" aria-hidden="true">
      <path class="burger__mid"   d="M15 3v24" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
      <path class="burger__right" d="M23 3v24" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
      <path class="burger__left"  d="M7 3v24"  stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
    </svg>
  </button>

  <button class="switch" id="switch-desktop" role="switch" aria-checked="false"
          aria-label="Dark mode" title="Switch to dark mode">
    <span class="switch__knob"></span>
  </button>
</header>

<div class="topbar" id="topbar">
  <div class="topbar__inner">
    <button class="btn btn--ghost" data-action="login">Log in</button>
    <button class="btn btn--solid" data-action="cta">Get Extension</button>
  </div>
</div>

<nav class="menu" id="site-menu" aria-label="Site">
  <div class="menu__inner">
    <div class="menu__grid">
      <section class="menu__group">
        <p class="menu__label"><span class="menu__num">01</span>Product</p>
        <ul class="menu__list">
          <li><button class="menu__item" data-target="features">Features</button></li>
          <li><button class="menu__item" data-target="how-it-works">How it works</button></li>
          <li><button class="menu__item" data-target="pricing">Pricing</button></li>
        </ul>
      </section>
      <section class="menu__group">
        <p class="menu__label"><span class="menu__num">02</span>Company</p>
        <ul class="menu__list">
          <li><button class="menu__item" data-target="about">About</button></li>
          <li><button class="menu__item" data-target="contact">Contact</button></li>
        </ul>
      </section>
      <section class="menu__group">
        <p class="menu__label"><span class="menu__num">03</span>Support</p>
        <ul class="menu__list">
          <li><button class="menu__item" data-target="faq">FAQ</button></li>
          <li><button class="menu__item" data-target="feedback">Feedback</button></li>
        </ul>
      </section>
    </div>

    <div class="menu__foot">
      <div class="menu__foot-left">
        <a class="menu__legal" href="/privacy-policy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
        <span class="menu__theme">
          <span class="menu__theme-label">Dark mode</span>
          <button class="switch" id="switch-mobile" role="switch" aria-checked="false"
                  aria-label="Dark mode"><span class="switch__knob"></span></button>
        </span>
      </div>
      <p class="menu__copy">&copy; <span id="year"></span> Onextap</p>
    </div>
  </div>
</nav>
```

### CSS

```css
:root {
  --bg:            #F5F2EC;
  --surface:       rgba(245,242,236,.90);
  --surface-scrl:  rgba(245,242,236,.85);
  --line:          rgba(42,60,28,.12);
  --line-strong:   rgba(42,60,28,.25);
  --primary:       #2D4A2D;
  --primary-hover: #3D5C3D;
  --accent:        #C8D8A8;
  --text:          #1A1A14;
  --text-2:        #4A4A38;
  --text-muted:    #7A7A64;
  --rule:          rgba(26,26,20,.20);
  --ring-hover:    rgba(45,74,45,.10);
  --knob-fg:       #fff;
  --knob-bg:       var(--primary);
  --track-bg:      #fff;

  --bar: 68px;
  --rail: 64px;
  --font-sans: "DM Sans", ui-sans-serif, system-ui, sans-serif;
  --font-display: "Instrument Serif", Georgia, ui-serif, serif;
}

:root[data-theme="dark"] {
  --bg:            #1A2414;
  --surface:       rgba(26,36,20,.90);
  --surface-scrl:  rgba(26,36,20,.85);
  --line:          rgba(200,216,168,.15);
  --line-strong:   rgba(200,216,168,.30);
  --text:          #E8EFD8;
  --text-2:        #9AB07A;
  --text-muted:    #9AB07A;
  --rule:          rgba(200,216,168,.28);
  --ring-hover:    rgba(200,216,168,.14);
  --knob-fg:       var(--primary);
  --knob-bg:       var(--accent);
  --track-bg:      var(--primary);
}

@media (min-width: 1024px) { :root { --rail: 72px; } }

/* Load-bearing. The rail and the bar both carry a 1px border; without
   border-box they measure 1px WIDER than the offsets that dodge them, and
   content sits under the border. Tailwind's preflight does this for you. */
*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0; background: var(--bg); color: var(--text);
  font-family: var(--font-sans);
  padding-top: var(--bar);                    /* clear the mobile bar */
}
@media (min-width: 768px) { body { padding-left: var(--rail); } }

/* every scroll target clears the bar */
[id] { scroll-margin-top: 80px; }
html { scroll-behavior: smooth; }

/* ---------- rail ---------- */
.rail {
  position: fixed; inset: 0 0 auto 0; z-index: 45;
  display: flex; align-items: center; gap: 8px;
  height: var(--bar); padding: 0 20px;
  background: var(--surface); backdrop-filter: blur(24px);
  border-bottom: 1px solid var(--line);
  transition: background-color .3s, border-color .3s;
}
@media (min-width: 768px) {
  .rail {
    inset: 0 auto 0 0; width: var(--rail); height: 100%;
    flex-direction: column; gap: 0; padding: 24px 0;
    border-bottom: 0; border-right: 1px solid var(--line);
  }
}
.rail__logo { display: flex; align-items: center; gap: 10px; flex-shrink: 0;
              text-decoration: none; color: inherit; }
.rail__logo img { border-radius: 8px; box-shadow: 0 1px 2px rgba(0,0,0,.06); }
.rail__wordmark { display: none; font-size: 16px; font-weight: 600; letter-spacing: -.01em; }
@media (min-width: 640px) { .rail__wordmark { display: inline; } }
@media (min-width: 768px) { .rail__wordmark { display: none; } }

.rail__auth { margin-left: auto; display: flex; align-items: center; gap: 6px; }
@media (min-width: 768px) { .rail__auth { display: none; } }

/* ---------- top bar ---------- */
.topbar {
  position: fixed; top: 0; right: 0; left: var(--rail); z-index: 45;
  display: none; pointer-events: none;
  border-bottom: 1px solid transparent; transition: background-color .3s, border-color .3s;
}
@media (min-width: 768px) { .topbar { display: block; } }
.topbar.is-scrolled {
  background: var(--surface-scrl); backdrop-filter: blur(24px); border-bottom-color: var(--line);
}
.topbar__inner { display: flex; height: var(--bar); align-items: center;
                 justify-content: flex-end; gap: 8px; padding: 0 40px; }

/* ---------- buttons ---------- */
.btn { pointer-events: auto; border: 0; cursor: pointer; font-family: inherit;
       font-weight: 500; border-radius: 6px; transition: color .2s, background-color .2s; }
.btn--ghost { background: none; color: var(--text-2); padding: 8px 12px; font-size: 14px; }
.btn--ghost:hover { color: var(--primary); }
:root[data-theme="dark"] .btn--ghost:hover { color: var(--accent); }
.btn--solid { background: var(--primary); color: #fff; padding: 8px 20px;
              font-size: 14px; white-space: nowrap; }
.btn--solid:hover { background: var(--primary-hover); }
.btn--sm.btn--ghost { padding: 4px 6px; font-size: 13px; }
.btn--sm.btn--solid { padding: 6px 12px; font-size: 12.5px; }

/* ---------- burger ---------- */
.burger { flex-shrink: 0; display: flex; align-items: center; justify-content: center;
          padding: 6px; border: 0; background: none; cursor: pointer;
          color: var(--text-2); border-radius: 8px; transition: color .2s; }
.burger:hover { color: var(--primary); }
:root[data-theme="dark"] .burger:hover { color: var(--accent); }
@media (min-width: 768px) { .burger { flex: 1; width: 100%; padding: 0; border-radius: 0; } }

.burger__icon path { transform-box: view-box; transform-origin: center; }

.burger[data-state="open"]   .burger__mid   { animation: burgerMidOpen    200ms ease both; }
.burger[data-state="open"]   .burger__right { animation: burgerRightOpen  200ms ease both; }
.burger[data-state="open"]   .burger__left  { animation: burgerLeftOpen   200ms ease both; }
.burger[data-state="closed"] .burger__mid   { animation: burgerMidClose   200ms ease both; }
.burger[data-state="closed"] .burger__right { animation: burgerRightClose 200ms ease both; }
.burger[data-state="closed"] .burger__left  { animation: burgerLeftClose  200ms ease both; }

@keyframes burgerMidOpen    { to  { opacity: 0; } }
@keyframes burgerRightOpen  { 50% { transform: translateX(-8px); }
                             100% { transform: rotate(-45deg) translateX(-8px); } }
@keyframes burgerLeftOpen   { 50% { transform: translateX(8px); }
                             100% { transform: rotate(45deg) translateX(8px); } }
@keyframes burgerMidClose   { 0%  { opacity: 0; } 100% { opacity: 1; } }
@keyframes burgerRightClose { 0%  { transform: rotate(-45deg) translateX(-8px); }
                             50%  { transform: translateX(-8px); }
                            100%  { transform: none; } }
@keyframes burgerLeftClose  { 0%  { transform: rotate(45deg) translateX(8px); }
                             50%  { transform: translateX(8px); }
                            100%  { transform: none; } }

/* ---------- overlay menu ---------- */
.menu {
  position: fixed; inset: 0; z-index: 40;
  overflow-y: auto; overscroll-behavior: contain;
  background: var(--bg); padding-top: var(--bar);
  opacity: 0; visibility: hidden;
  transition: opacity .3s, visibility .3s;
}
@media (min-width: 768px) { .menu { padding: 0 0 0 var(--rail); } }
.menu.is-open { opacity: 1; visibility: visible; }

.menu__inner { display: flex; flex-direction: column; min-height: 100%;
               max-width: 1100px; margin: 0 auto; padding: 40px 24px; }
@media (min-width: 768px) { .menu__inner { padding: 48px 40px; } }

.menu__grid { margin: auto 0; display: grid; gap: 44px; }
@media (min-width: 640px)  { .menu__grid { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 1024px) { .menu__grid { grid-template-columns: repeat(3, 1fr); gap: 48px; } }

.menu__label { margin: 0; font-size: 11px; font-weight: 600; text-transform: uppercase;
               letter-spacing: .14em; color: var(--text-muted); }
.menu__num { margin-right: 8px; font-variant-numeric: tabular-nums; }

.menu__list { list-style: none; margin: 20px 0 0; padding: 0; }
.menu__list li + li { margin-top: 12px; }
@media (min-width: 768px) { .menu__list { margin-top: 28px; } .menu__list li + li { margin-top: 20px; } }

.menu__item {
  border: 0; background: none; cursor: pointer; padding: 0;
  font-family: var(--font-display); font-size: 34px; font-weight: 400;
  line-height: 1.1; letter-spacing: -.02em; color: var(--text);
  text-decoration: underline; text-decoration-thickness: 2px;
  text-underline-offset: 7px; text-decoration-color: var(--rule);
  opacity: 0; transform: translateY(12px);
  transition: opacity .5s, transform .5s, color .2s, text-decoration-color .2s;
}
@media (min-width: 768px)  { .menu__item { font-size: 46px; } }
@media (min-width: 1024px) { .menu__item { font-size: 52px; } }
.menu__item:hover { color: var(--primary); text-decoration-color: var(--primary); }
:root[data-theme="dark"] .menu__item:hover { color: var(--accent); text-decoration-color: var(--accent); }
.menu.is-open .menu__item { opacity: 1; transform: translateY(0); }

.menu__foot { margin-top: 56px; padding-top: 24px; border-top: 1px solid var(--line);
              display: flex; flex-wrap: wrap; align-items: center;
              justify-content: space-between; gap: 16px; }
.menu__foot-left { display: flex; align-items: center; gap: 16px; }
.menu__legal, .menu__copy, .menu__theme-label {
  font-size: 13px; font-weight: 300; color: var(--text-2); }
.menu__legal { text-decoration: underline; text-underline-offset: 4px; }
.menu__copy { margin: 0; color: var(--text-muted); }
.menu__theme { display: inline-flex; align-items: center; gap: 10px; }
@media (min-width: 768px) { .menu__theme { display: none; } }

/* ---------- theme switch ---------- */
.switch {
  position: relative; flex-shrink: 0; display: inline-flex; align-items: center;
  width: 44px; height: 24px; padding: 0; border-radius: 999px; cursor: pointer;
  background: var(--track-bg); border: 1px solid var(--line-strong);
  transition: background-color .3s, border-color .3s, box-shadow .3s;
}
.rail .switch { display: none; }
@media (min-width: 768px) { .rail .switch { display: inline-flex; } }
.switch:hover { border-color: var(--primary); box-shadow: 0 0 0 3px var(--ring-hover); }
:root[data-theme="dark"] .switch:hover { border-color: var(--accent); }
.switch:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px rgba(45,74,45,.4); }

.switch__knob {
  width: 18px; height: 18px; border-radius: 999px;
  background: var(--knob-bg); box-shadow: 0 1px 2px rgba(0,0,0,.08);
  transform: translateX(2px);
  transition: transform .35s cubic-bezier(.16,1,.3,1), background-color .3s;
}
.switch:hover .switch__knob { transform: translateX(5px); }
.switch[aria-checked="true"] .switch__knob { transform: translateX(22px); }
.switch[aria-checked="true"]:hover .switch__knob { transform: translateX(19px); }
.switch:active .switch__knob { transform: scale(.9) translateX(2px); }

/* ---------- reduced motion ---------- */
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  /* 1ms, not `none` — the burger must still REACH its end state */
  .burger__icon path { animation-duration: 1ms !important; }
  .menu__item, .switch__knob { transition: none !important; transition-delay: 0ms !important; }
}
```

### JS

```js
(() => {
  const rail    = document.getElementById('rail');
  const topbar  = document.getElementById('topbar');
  const burger  = document.getElementById('burger');
  const menu    = document.getElementById('site-menu');
  const items   = [...menu.querySelectorAll('.menu__item')];
  const focusables = [...menu.querySelectorAll('button, a')];
  let open = false, everOpened = false;

  // one running stagger across all three columns
  items.forEach((el, i) => { el.style.transitionDelay = `${100 + i * 45}ms`; });

  const setMenu = (next) => {
    open = next;
    if (open) everOpened = true;
    menu.classList.toggle('is-open', open);
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    // absent until the first open, so the close animation cannot run on mount
    if (open || everOpened) burger.dataset.state = open ? 'open' : 'closed';
    // `visibility` is transitioned, so it reads `visible` for 300ms while closing
    focusables.forEach((el) => { el.tabIndex = open ? 0 : -1; });
    items.forEach((el, i) => { el.style.transitionDelay = open ? `${100 + i * 45}ms` : '0ms'; });
  };
  setMenu(false);

  burger.addEventListener('click', () => setMenu(!open));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) setMenu(false); });

  menu.addEventListener('click', (e) => {
    const item = e.target.closest('.menu__item');
    if (!item) return;
    setMenu(false);                                  // close first, then scroll
    document.getElementById(item.dataset.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // top bar frosts once the page moves
  const onScroll = () => topbar.classList.toggle('is-scrolled', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  // theme — both switches stay in sync
  const switches = [...document.querySelectorAll('.switch')];
  const applyTheme = (dark) => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    switches.forEach((s) => {
      s.setAttribute('aria-checked', String(dark));
      s.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    });
    try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch {}
  };
  const stored = (() => { try { return localStorage.getItem('theme'); } catch { return null; } })();
  applyTheme(stored ? stored === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
  switches.forEach((s) => s.addEventListener('click',
    () => applyTheme(document.documentElement.dataset.theme !== 'dark')));

  document.querySelectorAll('[data-action="login"]').forEach((b) =>
    b.addEventListener('click', () => { /* open your auth dialog */ }));
  document.querySelectorAll('[data-action="cta"]').forEach((b) =>
    b.addEventListener('click', () => { /* your CTA */ }));

  document.getElementById('year').textContent = new Date().getFullYear();
})();
```

> The knob icons are omitted above — the shipped version puts an 11px sun/moon
> inside the knob (`stroke-width: 2.25`). Add one `<svg>` per state inside
> `.switch__knob` and toggle it in `applyTheme`, or leave the knob plain.

---

## React + Tailwind

If the target already runs both, copy `src/components/dashboard/LandingNav.jsx`
verbatim and change four things:

1. `getIconUrl()` → your logo path.
2. `MENU_SECTIONS` → your ids and labels.
3. The `onextap-*` colour classes → your palette (the table above maps each one).
4. The `.ot-burger` / `.ot-switch-knob` CSS blocks → your global stylesheet,
   including the three reduced-motion overrides.

Its props are `darkMode`, `onToggleDarkMode`, `onNavigate(id)`, `onSignIn`,
`onGetExtension`. It owns only `menuOpen`, `everOpened` and `scrolled`; theme
state and scrolling belong to the parent.

---

## Adapting it to another site

| Change | Where |
|---|---|
| **Menu items and their ids** | `MENU_SECTIONS` / the `data-target` attributes. Every id must exist as an element on the page. |
| **Group count** | The grid is `2 → 3` columns. Four groups wrap awkwardly at `1024px`; drop to two, or set `repeat(4, 1fr)` and re-check `1024–1280`. |
| **Button labels** | `Log in` / `Get Extension`. Keep `Get Extension` short — it is the widest thing on a `320px` bar. |
| **Palette** | The `:root` variables. Structure and contrast pairings hold. |
| **Fonts** | `--font-display` is the menu link; `--font-sans` everything else. |
| **Rail width** | `--rail`, and check nothing else hardcodes `64px`/`72px`. |
| **No dark mode?** | Delete both `.switch` blocks, the `[data-theme="dark"]` rules, and the theme JS. Nothing else depends on it. |

---

## Gotchas

Each of these was a real bug during the build.

**1. `overflow-x: hidden` hides overflow bugs, it doesn't prevent them.** At
`320px` the burger's right edge landed at `329px` against a `314px` viewport and
`scrollWidth > clientWidth` still reported clean, because the page root clips.
Measure the *children*:

```js
[...document.querySelector('.rail').children]
  .filter((c) => c.getBoundingClientRect().width > 0)
  .map((c) => Math.round(c.getBoundingClientRect().right));   // all ≤ clientWidth?
```

**2. The top bar must not be full-width.** With `left: 0` its *background*
paints over the rail even though its content clears it — same z-index, later in
the DOM, so it wins. Use `left: var(--rail); right: 0`.

**3. Four places encode the rail width** — the rail, the top bar's `left`, the
overlay's `padding-left`, the body's `padding-left`. A mismatch is invisible
until something overlaps. The `--rail` variable above is exactly why.

**4. Do not lock body scroll when the menu closes-and-scrolls.** The click
handler closes the menu and calls `scrollIntoView` in the same tick; a lock
released on a later tick means the scroll fires against a locked body. The
overlay owns its own `overflow-y` + `overscroll-behavior: contain`, so no lock is
needed. (A separate *dialog* can lock freely — nothing under it needs to scroll.)

**5. `transform-box: view-box` on the burger paths is load-bearing.** The bars
rotate about the **viewBox** centre. Left to each path's own bounding box they
rotate around themselves and never meet as an X.

**6. Reduced motion needs `animation-duration: 1ms`, not `animation: none`.**
`none` strands the burger mid-morph. `1ms` reaches the end state instantly.

**7. `visibility: hidden` is transitioned.** A closing menu reads `visible` for
the full `300ms`, so its links stay tabbable. The explicit `tabIndex` toggle
covers that window.

**8. The menu's groups are bare `<section>` elements and will inherit your
global element styles.** A site-wide `section { padding: … ; border-bottom: … }`
lands inside the overlay and draws rules under each column. Either scope your
global rules (`main > section`), or swap the three `<section class="menu__group">`
for `<div>`. Same applies to a global `ul`/`li` reset against `.menu__list`.

---

## Acceptance checks

Run these rather than eyeballing.

```js
// the burger genuinely reaches the X
getComputedStyle(document.querySelector('.burger__right')).transform
// open:              matrix(0.707107, -0.707107, 0.707107, 0.707107, -5.65685, 5.65685)
// 100ms into close:  matrix(1, ~0, ~0, 1, -8, ~0)      ← the converge halfway mark
// closed:            matrix(1, 0, 0, 1, 0, 0)

// every menu link lands where it should
Math.abs(document.getElementById(id).getBoundingClientRect().top - 80) <= 2

// the four rail offsets agree
document.querySelector('.rail').getBoundingClientRect().width
getComputedStyle(document.body).paddingLeft
document.getElementById('topbar').getBoundingClientRect().x
getComputedStyle(document.getElementById('site-menu')).paddingLeft
```

| Check | Expected |
|---|---|
| Widths `320 / 375 / 767 / 768 / 1024 / 1280 / 1440` | no horizontal overflow; nothing clipped |
| Burger on first paint | no animation — it must not unfold from an X |
| Menu closed | `visibility: hidden`, links not reachable by Tab |
| Escape, item click, burger | all close the menu |
| Stagger | `100ms → 370ms` in `45ms` steps, one sequence across three columns |
| Switch | `aria-checked`, theme class, `localStorage` and knob position all agree |
| Switch hover | border solid, `3px` ring, knob leans `3px` toward its travel |
| Short viewport (e.g. `375×640`) | menu scrolls internally, footer reachable |
| `prefers-reduced-motion: reduce` | burger at its end state, no travel, nothing stranded invisible |
| Both themes | rail, top bar, overlay, switch |

---

Derived from `session.md` in this repo, which records why each decision was made.
