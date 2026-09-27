import { createInkBlot } from '../fx/ink-blot.js';
import { cssColorToRgb } from '../fx/gl.js';

/* ===========================================================================
   Ink blot: the next chapter's colour soaks outward from one point on this
   page — `from` names it, as a selector inside the outgoing chapter — until
   the sheet is covered, and the chapter underneath (the same colour) is
   simply there. Without WebGL the next chapter opens as a plain circle from
   the same point instead.
   =========================================================================== */
export function blot(opts) {
  opts = opts || {};
  var dur = opts.duration || 1.1;
  return {
    duration: dur,
    reveal: opts.reveal || 0.82,
    build: function (tl, from, to, at, ctx) {
      tl.set(from.el, { zIndex: 2 }, at);
      tl.set(to.el, { opacity: 1, pointerEvents: 'auto', zIndex: 3 }, at);

      var ink = cssColorToRgb(getComputedStyle(to.el).backgroundColor);
      var drawable = ctx.fx ? ctx.fx.add(createInkBlot(ctx.fx, {
        ink: ink,
        rim: ink.map(function (v) { return v * 0.78; })   // wet edge, a shade deeper
      })) : null;
      var proxy = { p: 0 };
      var origin = null;

      // Where the ink lands, as 0..1 of the stage. Measured on the first
      // frame of each run — by then the outgoing page is where it will be.
      function landing() {
        var stage = ctx.stage.getBoundingClientRect();
        var mark = opts.from && from.el.querySelector(opts.from);
        if (!mark) return [0.5, 0.6];
        var r = mark.getBoundingClientRect();
        return [
          (r.left + r.width / 2 - stage.left) / stage.width,
          (r.top + r.height / 2 - stage.top) / stage.height
        ];
      }

      function apply() {
        var p = proxy.p;
        if (p <= 0) origin = null;
        else if (!origin) origin = landing();
        var o = origin || [0.5, 0.6];
        var gl = !!(drawable && ctx.fx.ok);
        if (drawable) {
          drawable.set(p, o);
          drawable.visible = gl && p > 0 && p < 1;
          ctx.fx.invalidate();
        }
        // The incoming chapter stays shut until the ink has covered the
        // page (GL), or opens as a circle behind the same point (no GL).
        to.el.style.clipPath = p >= 1 ? '' : gl
          ? 'inset(0 0 100% 0)'
          : 'circle(' + (p * 150).toFixed(2) + '% at ' + (o[0] * 100).toFixed(2) + '% ' + (o[1] * 100).toFixed(2) + '%)';
      }

      tl.fromTo(proxy, { p: 0 }, {
        p: 1, duration: dur, ease: 'power1.inOut', immediateRender: false, onUpdate: apply
      }, at);
      tl.set(from.el, { opacity: 0, pointerEvents: 'none' }, at + dur);

      var unsubscribe = drawable ? ctx.fx.onLost(apply) : null;
      if (drawable) {
        // The incoming chapter is clipped shut while the ink spreads, so tell
        // the header where the ink already is.
        var ground = to.el.getAttribute('data-ground');
        ctx.cover(function (x, y, w, h) {
          return drawable.visible && drawable.covers(x, y, w, h) ? ground : null;
        });
      }
      ctx.own(function () {
        if (unsubscribe) unsubscribe();
        if (drawable) ctx.fx.remove(drawable);
        to.el.style.clipPath = '';
      });
      return dur;
    }
  };
}
