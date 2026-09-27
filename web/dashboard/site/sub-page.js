/* ===========================================================================
   The dashboard's company pages (Contact, Privacy) — what they share
   Each is an ordinary scrolling page rather than a stage, in the landing
   page's world: the same cursor and header row, over an ink band holding
   the way back and the headline, then the page's substance on oat. Unlike
   the landing page's own, they have no nav spine or chapter menu, and no
   Log in or Add to Chrome in the header: they are reached from the
   dashboard, and lead back to it.

   Everything here but the header (./hud), the foot (./page-foot.html), the
   page frame (./sub-page.css) and the spine override (./spine.css) is the
   landing page's own source, imported from web/src rather than copied.
   =========================================================================== */

// The landing page's shared styles first, in its cascade order, then the
// pieces that differ here.
import '../../src/shared/styles/tokens.css';
import './spine.css';
import '../../src/shared/styles/base.css';
import '../../src/shared/styles/layout.css';
import '../../src/shared/styles/buttons.css';
import './sub-page.css';

import { gsap } from 'gsap';
import { mountFeatures } from '../../src/app/mount.js';
import { prefersReducedMotion, registerMotion, initSmoothScroll } from '../../src/shared/lib/motion.js';
import { splitWords } from '../../src/shared/lib/split-words.js';

import * as cursor from '../../src/features/cursor/cursor.js';
import * as hud from './hud/hud.js';
import pageFoot from './page-foot.html?raw';

// Where "home" is from here: the dashboard, not the landing page.
var HOME = '/dashboard/';

/* `features` are the page's own, keyed by their data-mount names. Returns
   `hold(on)`, for anything else that has to hold the page still while it is
   open (the feedback window). */
export function bootSubPage(features) {
  mountFeatures(Object.assign({
    'cursor': cursor,
    'hud': hud,
    'page-foot': { markup: pageFoot }
  }, features));

  var hudApi = hud.initHud();
  // The header reads the ground from the page as laid out, which in WebKit
  // waits on the fonts' stylesheet: read again once it is in.
  window.addEventListener('load', hudApi.refresh);
  if (document.fonts) document.fonts.ready.then(hudApi.refresh);
  initBack();
  document.querySelectorAll('[data-year]').forEach(function (n) { n.textContent = new Date().getFullYear(); });

  var lenis = null;
  if (prefersReducedMotion) {
    document.documentElement.classList.add('no-motion');
  } else {
    registerMotion();
    lenis = initSmoothScroll();
    cursor.initCursor();
    riseIn();
  }

  function hold(on) {
    if (!lenis) return;
    if (on) lenis.stop(); else lenis.start();
  }
  return { hold: hold };
}

/* --- the way back ---------------------------------------------------------
   Goes back to wherever the reader came from on this site — the dashboard,
   most often. Arriving from anywhere else (a search, a shared link), there
   is nothing of ours to go back to, so it is an ordinary link to the
   dashboard. (The page copy is the landing page's, whose Back links home to
   the landing page; here home is the dashboard.) */
function initBack() {
  document.querySelectorAll('[data-back]').forEach(function (a) {
    a.setAttribute('href', HOME);
    a.addEventListener('click', function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;   // a new tab or window
      var from = null;
      try { from = document.referrer && new URL(document.referrer); } catch (err) { from = null; }
      if (!from || from.origin !== location.origin || history.length < 2) return;
      e.preventDefault();
      history.back();
    });
  });
}

/* --- the entrance ---------------------------------------------------------
   The landing page's headlines rise through a mask as their chapter
   arrives; here the headline rises as the page opens, and each section's
   as it scrolls into view. Once, not scrubbed: there is no story to play
   backwards. */
function riseIn() {
  var hero = document.querySelector('.sub-hero');
  gsap.timeline({ defaults: { ease: 'power3.out' } })
    .fromTo(splitWords(hero.querySelector('[data-split]')), { yPercent: 105 },
      { yPercent: 0, duration: 0.9, stagger: 0.06 }, 0.1)
    .fromTo(hero.querySelectorAll('[data-rise]'), { y: 18, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.8, stagger: 0.08 }, 0.3);

  document.querySelectorAll('.sub-sec').forEach(function (sec) {
    var title = sec.querySelector('[data-split]');
    var tl = gsap.timeline({
      defaults: { ease: 'power3.out' },
      scrollTrigger: { trigger: sec, start: 'top 88%', once: true }
    });
    tl.fromTo(sec, { '--rule-in': 0 }, { '--rule-in': 1, duration: 0.9 }, 0);
    if (title) tl.fromTo(splitWords(title), { yPercent: 105 }, { yPercent: 0, duration: 0.8, stagger: 0.04 }, 0);
    tl.fromTo(sec.querySelectorAll('[data-rise]'), { y: 22, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.7, stagger: 0.07 }, 0.12);
  });
}
