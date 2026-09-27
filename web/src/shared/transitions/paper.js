import { gsap } from 'gsap';
import { createPaperSheet } from '../fx/paper-sheet.js';
import { cssColorToRgb } from '../fx/gl.js';

/* ===========================================================================
   Paper exits: a section is crumpled into a ball and thrown away, or peeled
   off like a page, uncovering the chapter underneath.

   For the length of the exit the live element steps aside and a WebGL sheet
   carrying its snapshot takes its place (src/shared/fx/paper-sheet.js). The
   choice is made per frame, not once: until the snapshot is ready — or if
   WebGL is missing, or its context is lost — the same progress drives a CSS
   stand-in on the live element instead, so the story always gets told.
   =========================================================================== */

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function smooth(t) { return t * t * (3 - 2 * t); }

// A fixed pseudo-random sequence, so a sheet crumples the same way every time.
function rand(seed, i) {
  var x = Math.sin(seed * 91.7 + i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/* --- CSS stand-ins ------------------------------------------------------- */

// Points walked round the edge of the sheet, each pulled toward the middle
// by its own amount: at 0 the plain rectangle, by 1 a ragged wad.
function crumpledOutline(c, seed) {
  var pts = [], n = 28;
  for (var i = 0; i < n; i++) {
    var s = i / n * 4, side = Math.floor(s), f = s - side;
    var x = side === 0 ? f : side === 1 ? 1 : side === 2 ? 1 - f : 0;
    var y = side === 0 ? 0 : side === 1 ? f : side === 2 ? 1 : 1 - f;
    var pull = c * (0.55 + 0.4 * rand(seed, i));
    pts.push(((x + (0.5 - x) * pull) * 100).toFixed(2) + '% ' + ((y + (0.5 - y) * pull) * 100).toFixed(2) + '%');
  }
  return 'polygon(' + pts.join(',') + ')';
}

// The crease texture the CSS crumple multiplies over the page: a scatter of
// grey facets. Built once, the first time a stand-in actually runs.
var creaseReady = false;
function ensureCreaseTexture() {
  if (creaseReady) return;
  creaseReady = true;
  var shapes = '';
  for (var i = 0; i < 90; i++) {
    var x = rand(7, i) * 100, y = rand(13, i) * 100, s = 8 + rand(29, i) * 26;
    var pts = [0, 1, 2].map(function (k) {
      var a = rand(41, i * 3 + k) * Math.PI * 2;
      return (x + Math.cos(a) * s).toFixed(1) + ',' + (y + Math.sin(a) * s).toFixed(1);
    }).join(' ');
    var g = Math.round(150 + rand(53, i) * 105);
    shapes += '<polygon points="' + pts + '" fill="rgb(' + g + ',' + g + ',' + g + ')" fill-opacity=".55"/>';
  }
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none">' +
    '<rect width="100" height="100" fill="#fff"/>' + shapes + '</svg>';
  document.documentElement.style.setProperty('--crease-img',
    'url("data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) + '")');
}

var FALLBACK = {
  crumple: function (el, p, spec) {
    if (p <= 0) {
      gsap.set(el, { scale: 1, rotation: 0, x: 0, y: 0, clipPath: 'none' });
      el.style.setProperty('--crease', '0');
      return;
    }
    ensureCreaseTexture();
    var c = smooth(clamp01(p / 0.8));
    var t = clamp01((p - 0.62) / 0.38);
    gsap.set(el, {
      scale: 1 - 0.8 * c,
      rotation: -16 * c + t * 260 * spec.spin,
      x: t * t * window.innerWidth * 0.9 * spec.toss[0],
      y: -t * t * window.innerHeight * 0.9 * spec.toss[1],
      clipPath: crumpledOutline(c, spec.seed)
    });
    el.style.setProperty('--crease', String(Math.min(1, c * 1.8)));
  },
  curl: function (el, p) {
    if (p <= 0) {
      gsap.set(el, { rotationY: 0, transformPerspective: 0, transformOrigin: '50% 50%' });
      el.style.setProperty('--crease', '0');
      return;
    }
    ensureCreaseTexture();
    var e = smooth(p);
    gsap.set(el, { transformOrigin: '0% 50%', transformPerspective: 2200, rotationY: -118 * e });
    el.style.setProperty('--crease', String(e * 0.5));
  }
};

/* --- the hand-off -------------------------------------------------------- */

/* Adds one paper exit of `spec.el` to the timeline — between chapters
   (crumple / curl below) or inside one (the hero's sign). */
export function paperExit(tl, spec, ctx) {
  var el = spec.el;
  var toss = spec.toss || [1, 0.5];
  var opts = { seed: spec.seed || 1, toss: toss, spin: spec.spin || 1 };
  el.classList.add('paper');

  var sheet = ctx.fx ? ctx.fx.add(createPaperSheet(ctx.fx, {
    mode: spec.mode, seed: opts.seed, toss: toss, spin: opts.spin,
    back: cssColorToRgb(getComputedStyle(el).backgroundColor)
  })) : null;
  var proxy = { p: 0 };
  var usingGL = false;

  function apply() {
    var p = proxy.p;
    var gl = !!(sheet && sheet.ready && ctx.fx.ok);
    if (gl !== usingGL) {
      FALLBACK[spec.mode](el, 0, opts);   // switching mid-exit: drop the stand-in
      usingGL = gl;
    }
    if (gl) {
      sheet.set(p);
      sheet.visible = p > 0 && p < 1;
      ctx.fx.invalidate();
    } else {
      if (sheet && sheet.visible) { sheet.visible = false; ctx.fx.invalidate(); }
      FALLBACK[spec.mode](el, p, opts);
    }
    // Visibility, not opacity: the timeline owns opacity for switching whole
    // layers on and off, so the two never fight over one property.
    el.style.visibility = p >= 1 || (gl && p > 0) ? 'hidden' : '';
  }

  var unsubscribe = null;
  if (sheet) {
    ctx.snapshot(el, spec.at, spec.priority || 0, function (shot) {
      sheet.setTexture(shot.canvas, shot.rect);
      apply();
    });
    unsubscribe = ctx.fx.onLost(apply);
    // While the sheet is drawn in WebGL the live element is hidden, so the
    // header would read the chapter underneath; report this one instead
    // wherever the sheet still covers.
    var ground = (el.closest('[data-ground]') || el).getAttribute('data-ground');
    ctx.cover(function (x, y) { return usingGL && sheet.covers(x, y) ? ground : null; });
  }

  tl.fromTo(proxy, { p: 0 }, {
    p: 1, duration: spec.duration, ease: 'none', immediateRender: false, onUpdate: apply
  }, spec.at);

  ctx.own(function () {
    if (unsubscribe) unsubscribe();
    if (sheet) { sheet.dispose(); ctx.fx.remove(sheet); }
    FALLBACK[spec.mode](el, 0, opts);
    el.style.visibility = '';
  });
}

function paperTransition(mode, opts) {
  opts = opts || {};
  var dur = opts.duration || 1.3;
  return {
    duration: dur,
    reveal: opts.reveal || 0.6,
    build: function (tl, from, to, at, ctx) {
      tl.set(from.el, { zIndex: 3 }, at);
      tl.set(to.el, { opacity: 1, pointerEvents: 'auto', zIndex: 2 }, at);
      paperExit(tl, {
        el: from.el, at: at, duration: dur, mode: mode,
        seed: opts.seed, toss: opts.toss, spin: opts.spin, priority: opts.priority
      }, ctx);
      tl.set(from.el, { opacity: 0, pointerEvents: 'none' }, at + dur);
      return dur;
    }
  };
}

/* Screwed up into a ball and thrown out of frame. `toss` is the direction it
   is thrown (x right, y up); `spin` flips which way it tumbles. */
export function crumple(opts) { return paperTransition('crumple', opts); }

/* Peeled away from the bottom-right corner, like a page being turned. */
export function curl(opts) { return paperTransition('curl', opts); }
