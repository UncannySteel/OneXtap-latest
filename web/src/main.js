/* ===========================================================================
   ONEXTAP — entry point
   Mounts every feature's markup into index.html, then — motion permitting —
   hands the page to the stage, which plays it as one scroll timeline.
   =========================================================================== */

// Shared styles first, in cascade order.
import './shared/styles/tokens.css';
import './shared/styles/base.css';
import './shared/styles/layout.css';
import './shared/styles/buttons.css';
import './shared/styles/stage.css';

import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { mountFeatures } from './app/mount.js';
import { createStage } from './app/stage.js';
import { pageChapters } from './app/chapters.js';
import { initArrival } from './app/arrival.js';
import { signInAttempt } from './app/backend.js';
import { wireHeader, wireOffers, openOnArrival } from './app/wire.js';
import { prefersReducedMotion, registerMotion, initSmoothScroll, scrollToTarget } from './shared/lib/motion.js';
import { installGlobalErrorHandlers } from '@app/logger.js';

import * as cursor from './features/cursor/cursor.js';
import * as nav from './features/nav/nav.js';
import * as hud from './features/hud/hud.js';
import * as hero from './features/hero/hero.js';
import * as formFields from './features/form-fields/form-fields.js';
import * as featureShowcase from './features/feature-showcase/feature-showcase.js';
import * as jobBoards from './features/job-boards/job-boards.js';
import * as pricing from './features/pricing/pricing.js';
import * as closing from './features/closing/closing.js';
import * as footer from './features/footer/footer.js';
import * as faq from './features/faq/faq.js';
import * as login from './features/login/login.js';

// Uncaught errors go through the app's logger (redacted, and kept for
// __onextapIssues() in the console), as on the dashboard and in the popup.
installGlobalErrorHandlers();

// Keys match the data-mount attributes in index.html.
mountFeatures({
  'cursor': cursor,
  'nav': nav,
  'hud': hud,
  'hero': hero,
  'form-fields': formFields,
  'feature-showcase': featureShowcase,
  'job-boards': jobBoards,
  'pricing': pricing,
  'closing': closing,
  'footer': footer,
  'faq': faq,
  'login': login
});

// Content that must work with or without motion.
var hudApi = hud.initHud();
var navApi = nav.initNav();
navApi.onToggle(hudApi.refresh);   // the header is re-inked over the open menu, and after it
var tabs = featureShowcase.initFeatureTabs();
// Sign-in is the account's (Supabase, through src/app/backend.js); the
// buttons that lead to it, to the Web Store and to the dashboard are wired
// in src/app/wire.js.
var loginApi = login.initLogin({ signIn: signInAttempt });
var windows = [faq.initFaq(), loginApi];
wireHeader();
wireOffers(loginApi);

// No motion wanted: the chapters stay in normal flow, one full screen each,
// with every state already shown (the .no-motion rules), and we stop.
if (prefersReducedMotion) {
  document.documentElement.classList.add('no-motion');
} else {
  registerMotion();

  var stage = null;
  var lenis = initSmoothScroll(function (target) { return stage && stage.scrollFor(target); });

  stage = createStage({
    track: document.getElementById('stageTrack'),
    stage: document.getElementById('stage'),
    chapters: pageChapters({
      hero: hero.initHero(),
      form: formFields.initFormFields(),
      features: featureShowcase.initFeatureChapter(),
      demo: featureShowcase.initDemoForm(),
      boards: jobBoards.initJobBoards(),
      pricing: pricing.initPricing(),
      closing: closing.initClosing(),
      footer: footer.initFooter()
    }),
    // An immediate scroll is the stage keeping the reader in place across a
    // rebuild, so it goes through even while the menu holds the page still.
    scrollTo: function (y, immediate) { lenis.scrollTo(y, { immediate: !!immediate, force: !!immediate }); }
  });

  var cur = cursor.initCursor();
  featureShowcase.initRail({
    paintFeature: tabs.paintFeature,
    setSwapHandler: tabs.setSwapHandler,
    cursor: cur
  });

  // The open menu holds the page still. Its links land on the moment their
  // chapter has arrived, with none of the story between played on the way —
  // and so does a company page's menu, linking back here to a chapter.
  // Lenis clamps every scroll to the page height it last measured, which
  // lags (debounced) behind a stage that has just laid out its track; on
  // arriving from another page that cut the jump short, so it measures first.
  var jumpTo = function (target) {
    lenis.resize();
    scrollToTarget(lenis, stage.scrollFor, target, true);
  };
  // So does an open window (the FAQ, sign-in).
  var hold = function (open) { if (open) lenis.stop(); else lenis.start(); };
  navApi.onToggle(hold);
  windows.forEach(function (w) { w.onToggle(hold); });
  navApi.setJump(jumpTo);
  hudApi.setOverlay(stage.groundAt);
  ScrollTrigger.refresh();

  // In from another page: at a chapter (a company page's menu), or back to
  // where the reader left the story.
  initArrival({
    stage: stage,
    jump: jumpTo,
    scrollTo: function (y) { lenis.resize(); lenis.scrollTo(y, { immediate: true, force: true }); }
  });

  // The e2e tests read the stage's layout and drive the scroll from here
  // (dev server only; stripped from production builds).
  if (import.meta.env.DEV) { window.__stage = stage; window.__lenis = lenis; }
}

// Sent here to sign in (the dashboard, for a visitor with no session): the
// window opens once the page — and whatever holds it still — is set up.
openOnArrival(loginApi);
