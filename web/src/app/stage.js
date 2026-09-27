import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { createFx } from '../shared/fx/fx.js';
import { capture, render } from '../shared/fx/snapshot.js';

/* ===========================================================================
   The stage: the page played as one timeline.

   Every chapter is a full-screen layer stacked inside one sticky,
   viewport-sized stage. A single scroll track below it drives one GSAP
   timeline, scrubbed 1:1 with the scroll — one timeline unit is one screen of
   scrolling. Chapters are laid end to end on that timeline, each joined to
   the last by a transition (src/shared/transitions/), so the choreography
   lives in one place (src/app/chapters.js) and scrubbing backwards simply
   plays everything in reverse.

   A chapter taller than the screen (a phone, a short laptop) is not cut off:
   the part that does not fit scrolls up inside its layer, on the timeline,
   before the chapter leaves.
   =========================================================================== */

var HOLD = 0.3;   // a beat of stillness after each chapter's own animation

function idle(fn) {
  if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: 700 });
  else setTimeout(fn, 60);
}

export function createStage(opts) {
  var track = opts.track;
  var stageEl = opts.stage;
  var chapters = opts.chapters;

  stageEl.classList.add('stage--live');
  var fx = null;
  try { fx = createFx(stageEl); } catch (e) { fx = null; }

  chapters.forEach(function (ch) {
    ch.inner = ch.el.querySelector(':scope > .ch__body');
    ch.veil = document.createElement('div');
    ch.veil.className = 'layer__veil';
    ch.el.appendChild(ch.veil);
  });

  var tl = null, st = null;
  var unit = 1;                 // px of scroll per timeline unit
  var owned = [];               // disposers from the current build
  var coverers = [];            // effects that paint over the DOM (see groundAt)
  var generation = 0;
  var jobs = [], busy = false;  // snapshot queue
  var built = { w: 0, h: 0 };

  var ctx = {
    fx: fx,
    stage: stageEl,
    own: function (fn) { owned.push(fn); },
    // An effect drawn in WebGL covers the page without being in it; it
    // registers here to say which ground it is showing at a point.
    cover: function (fn) { coverers.push(fn); },
    snapshot: function (el, at, priority, done) {
      jobs.push({ el: el, at: at, priority: priority, done: done, gen: generation });
      jobs.sort(function (a, b) { return a.priority - b.priority; });
      pump();
    }
  };

  /* --- snapshots ----------------------------------------------------------
     A snapshot has to show a section exactly as it will look on the frame
     its exit begins — words risen, fields filled, the strike drawn. Rather
     than faking that state, the timeline itself is seeked to that moment,
     the section is cloned, and the timeline is put back, all in one
     synchronous turn so nothing is ever painted in between. */
  function pump() {
    if (busy || !jobs.length) return;
    busy = true;
    idle(function () {
      var job = jobs.shift();
      if (!job || job.gen !== generation) { busy = false; pump(); return; }
      var shot;
      try {
        var now = tl.time();
        tl.time(job.at);
        shot = capture(job.el, stageEl);
        tl.time(now);
      } catch (e) {
        busy = false; pump(); return;
      }
      render(shot, {
        scale: fx ? fx.size.dpr : 1,
        maxSize: fx ? Math.min(4096, fx.gl.getParameter(fx.gl.MAX_TEXTURE_SIZE)) : 2048
      }).then(function (res) {
        if (job.gen === generation) job.done(res);
      }, function (err) {
        // The section keeps its CSS stand-in; say why, once, for whoever
        // is debugging, and carry on with the rest of the queue.
        console.warn('[stage] snapshot failed, using the CSS fallback:', err && err.message);
      }).then(function () { busy = false; pump(); });
    });
  }

  /* --- measuring ---------------------------------------------------------- */
  var probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:100vh;height:100svh;visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);

  // Content that does not fit the small viewport has to be scrolled through.
  // Measured against the layer, not the stage: a torn sheet's layer (and its
  // body) reach up past the stage by the depth of the tear.
  function overflowOf(ch) {
    if (!ch.inner) return 0;
    var toolbar = stageEl.clientHeight - probe.offsetHeight;   // lvh − svh
    return Math.max(0, Math.ceil(ch.inner.offsetHeight - ch.el.clientHeight + toolbar));
  }

  /* --- building the timeline --------------------------------------------- */
  function build() {
    generation++;
    unit = stageEl.clientHeight;
    built.w = window.innerWidth;
    built.h = window.innerHeight;

    chapters.forEach(function (ch, i) {
      gsap.set(ch.el, { opacity: i === 0 ? 1 : 0, pointerEvents: i === 0 ? 'auto' : 'none', zIndex: 1 });
      if (ch.inner) gsap.set(ch.inner, { y: 0 });
    });

    tl = gsap.timeline({ paused: true, defaults: { ease: 'none' } });
    var t = 0;
    chapters.forEach(function (ch, i) {
      ch.start = t;
      if (i > 0) {
        var tr = ch.transition;
        var d = tr.build(tl, chapters[i - 1], ch, t, ctx);
        chapters[i - 1].end = t + d;
        if (ch.enter) ch.enter(tl, t + d * tr.reveal, ctx);
        t = Math.max(t + d, tl.duration());
      } else if (ch.enter) {
        ch.enter(tl, 0, ctx);
        t = tl.duration();
      }
      ch.arrive = t;   // where an anchor link to this chapter lands

      var len = ch.body ? ch.body(tl, t, ctx) || 0 : 0;
      var over = ch.over = overflowOf(ch);
      if (over > 0) {
        var scrollLen = Math.max(len, over / unit);
        tl.fromTo(ch.inner, { y: 0 }, { y: -over, duration: scrollLen, ease: 'none', immediateRender: false }, t);
        len = scrollLen;
      }
      t += len + (ch.hold == null ? HOLD : ch.hold);
    });
    chapters[chapters.length - 1].end = t;
    if (tl.duration() < t) tl.to({}, { duration: t - tl.duration() });

    track.style.height = Math.ceil(tl.duration() * unit + stageEl.clientHeight) + 'px';
    st = ScrollTrigger.create({
      trigger: track,
      start: 'top top',
      end: function () { return '+=' + tl.duration() * unit; },
      animation: tl,
      scrub: true,
      onUpdate: markLive,
      onRefresh: markLive
    });
    markLive();
  }

  function teardown() {
    var time = tl ? tl.time() : 0;
    if (st) st.kill();
    if (tl) { tl.progress(0); tl.kill(); }
    owned.forEach(function (fn) { fn(); });
    owned = [];
    coverers = [];
    jobs = [];
    return time;
  }

  // The ground an effect is painting at viewport point (x, y), if any.
  function groundAt(x, y) {
    if (!coverers.length) return null;
    var r = stageEl.getBoundingClientRect();
    for (var i = 0; i < coverers.length; i++) {
      var g = coverers[i](x - r.left, y - r.top, r.width, r.height);
      if (g) return g;
    }
    return null;
  }

  /* --- which chapters are on screen --------------------------------------
     `.is-playing` lets a chapter's own loops (the marquee) run only while it
     can be seen. */
  function markLive() {
    var time = tl.time();
    chapters.forEach(function (ch) {
      var live = time >= ch.start && time <= ch.end;
      if (live !== ch.live) {
        ch.live = live;
        ch.el.classList.toggle('is-playing', live);
      }
    });
  }

  /* --- anchors and focus -------------------------------------------------- */
  function chapterOf(node) {
    for (var i = 0; i < chapters.length; i++) if (chapters[i].el.contains(node)) return chapters[i];
    return null;
  }
  function trackTop() { return track.getBoundingClientRect().top + window.scrollY; }

  // The scroll position that shows the chapter holding `target`, fully
  // arrived. An element that wraps every chapter (#top) means the start.
  function scrollFor(target) {
    if (!target) return null;
    if (target.contains(chapters[0].el)) return 0;
    var ch = chapterOf(target);
    return ch ? trackTop() + ch.arrive * unit : null;
  }

  // Tabbing into a chapter that is not on screen brings it on screen.
  stageEl.addEventListener('focusin', function (e) {
    var ch = chapterOf(e.target);
    if (ch && !ch.live && opts.scrollTo) opts.scrollTo(trackTop() + ch.arrive * unit);
  });

  /* --- rebuilding --------------------------------------------------------
     Anything that reflows the chapters changes how long each one takes to
     scroll through, so the timeline is rebuilt from scratch — keeping the
     reader at the same point in the story. That is a width change (rotation,
     a desktop resize) or the web fonts landing; a phone's toolbar sliding
     in and out only nudges the height, and is ignored. */
  function rebuild() {
    var total = tl.duration();
    var frac = total ? teardown() / total : 0;
    build();
    ScrollTrigger.refresh();
    if (opts.scrollTo) opts.scrollTo(trackTop() + frac * tl.duration() * unit, true);
  }

  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      var dw = Math.abs(window.innerWidth - built.w);
      var dh = Math.abs(window.innerHeight - built.h);
      if (dw >= 2 || dh >= built.h * 0.15) rebuild();
    }, 220);
  });

  build();

  // The first build can run on provisional measurements: before the web
  // fonts land, and — in WebKit — before any page CSS is applied at all,
  // since it holds style back while the font stylesheet is still loading.
  // Measure again once each has settled and rebuild if anything moved.
  function settle() {
    var moved = stageEl.clientHeight !== unit ||
      chapters.some(function (ch) { return overflowOf(ch) !== ch.over; });
    if (moved) rebuild();
  }
  if (document.readyState !== 'complete') window.addEventListener('load', settle, { once: true });
  if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(settle);

  return {
    fx: fx,
    scrollFor: scrollFor,
    groundAt: groundAt,
    isLive: function (el) {
      var ch = chapterOf(el);
      return !!(ch && ch.live);
    },
    // Where everything sits on the timeline, in screens and px — for tests.
    info: function () {
      return {
        unit: unit,
        top: trackTop(),
        duration: tl.duration(),
        snapshotsPending: jobs.length + (busy ? 1 : 0),
        webgl: !!(fx && fx.ok),
        chapters: chapters.map(function (ch) {
          return { id: ch.el.id || ch.el.className.split(' ')[0], start: ch.start, arrive: ch.arrive, end: ch.end, over: ch.over };
        })
      };
    }
  };
}
