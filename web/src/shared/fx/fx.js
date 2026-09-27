import { gsap } from 'gsap';
import { createContext } from './gl.js';

/* ===========================================================================
   One WebGL canvas for the whole page. Every paper effect (a crumpling or
   curling sheet, an ink blot) is a "drawable" registered here; the canvas is
   only shown while one of them is actually on screen.

   Drawing happens on GSAP's ticker, after Lenis and ScrollTrigger have run
   for the frame. That ordering is load-bearing: when a sheet takes over from
   the live DOM, the DOM is hidden during the scroll update and the canvas is
   painted in the same tick — never a frame with neither.
   =========================================================================== */
export function createFx(host) {
  var canvas = document.createElement('canvas');
  canvas.className = 'fx';
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);

  var ctx = createContext(canvas);
  if (!ctx) { canvas.remove(); return null; }
  var gl = ctx.gl;

  var coarse = window.matchMedia('(pointer: coarse)').matches;
  var drawables = [];
  var lostHandlers = [];
  var dirty = true, sized = false, shown = false;
  var size = { w: 1, h: 1, dpr: 1 };

  var api = {
    ok: true,
    ctx: ctx,
    gl: gl,
    canvas: canvas,
    size: size,
    add: function (d) { drawables.push(d); return d; },
    remove: function (d) {
      var i = drawables.indexOf(d);
      if (i >= 0) drawables.splice(i, 1);
      dirty = true;
    },
    invalidate: function () { dirty = true; },
    onLost: function (fn) {
      lostHandlers.push(fn);
      return function () {
        var i = lostHandlers.indexOf(fn);
        if (i >= 0) lostHandlers.splice(i, 1);
      };
    },
    // Cached per-context resources (programs, meshes) keyed by name.
    cache: {}
  };

  // Retina without the cost: a phone's 3x is capped at 1.5 — the sheet is
  // in motion whenever it is on screen, and motion hides the difference.
  function applySize() {
    var dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);
    var w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    size.w = w; size.h = h; size.dpr = dpr;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    sized = true;
  }
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(function () { sized = false; dirty = true; }).observe(host);
  } else {
    window.addEventListener('resize', function () { sized = false; dirty = true; });
  }

  function frame() {
    if (!dirty || !api.ok) return;
    dirty = false;
    if (!sized) applySize();

    var any = false, again = false;
    for (var i = 0; i < drawables.length; i++) {
      if (drawables[i].visible) { any = true; break; }
    }
    // Nothing to show and nothing left on the canvas: skip the GL work.
    if (!any && !shown) return;

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    for (var j = 0; j < drawables.length; j++) {
      var d = drawables[j];
      if (!d.visible) continue;
      d.draw(size);
      if (d.animating) again = true;
    }
    if (any !== shown) {
      canvas.style.visibility = any ? 'visible' : 'hidden';
      shown = any;
    }
    if (again) dirty = true;
  }
  gsap.ticker.add(frame);

  // A lost context (GPU reset, too many tabs) drops every effect to its CSS
  // fallback. Each drawable's owner re-applies its current state so a sheet
  // that was mid-crumple does not stay hidden with nothing drawn in its place.
  canvas.addEventListener('webglcontextlost', function (e) {
    e.preventDefault();
    api.ok = false;
    canvas.style.visibility = 'hidden';
    shown = false;
    lostHandlers.slice().forEach(function (fn) { fn(); });
  });

  return api;
}
