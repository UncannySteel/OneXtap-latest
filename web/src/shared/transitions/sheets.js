/* ===========================================================================
   Sheet-on-sheet transitions — plain transforms, no WebGL.
   Each transition is a factory: it takes its options and returns
   { duration, reveal, build(tl, from, to, at, ctx) }. `build` adds its tweens
   to the page timeline starting at `at`; `reveal` (0..1 of the duration) is
   when the incoming chapter's own entrance should begin.
   =========================================================================== */

/* The next sheet is dealt on top of this one. The sheet underneath sinks and
   dims a little as it is covered, which is what gives the stack its depth.
   `torn` gives the incoming sheet a ripped top edge (see transitions.css);
   `tilt` lets it arrive slightly askew and square up as it lands. */
export function cover(opts) {
  opts = opts || {};
  var dur = opts.duration || 1;
  return {
    duration: dur,
    reveal: 0.5,
    build: function (tl, from, to, at) {
      if (opts.torn) to.el.classList.add('layer--torn');
      tl.set(from.el, { zIndex: 2 }, at);
      tl.set(to.el, { opacity: 1, pointerEvents: 'auto', zIndex: 3 }, at);
      tl.fromTo(to.el,
        { yPercent: 100, rotation: opts.tilt || 0 },
        { yPercent: 0, rotation: 0, duration: dur, ease: 'power2.out' }, at);
      tl.fromTo(from.el,
        { scale: 1, rotation: 0, yPercent: 0 },
        { scale: 0.9, rotation: opts.sink == null ? -2 : opts.sink, yPercent: -5,
          duration: dur, ease: 'power1.in', immediateRender: false }, at);
      tl.fromTo(from.veil, { opacity: 0 },
        { opacity: 0.62, duration: dur, ease: 'none', immediateRender: false }, at);
      tl.set(from.el, { opacity: 0, pointerEvents: 'none' }, at + dur);
      return dur;
    }
  };
}

/* Borrowed from grail-app.com: the sheet on top falls behind the scroll —
   sinking and drifting down — while a soft circular vignette closes in on
   it, and the next chapter, already in place underneath, comes up out of
   the dark to meet you. The vignette is a mask driven by `--iris` (see
   stage.css). */
export function iris(opts) {
  opts = opts || {};
  var dur = opts.duration || 1.2;
  return {
    duration: dur,
    reveal: 0.45,
    build: function (tl, from, to, at) {
      from.el.classList.add('layer--iris');
      tl.set(from.el, { zIndex: 3 }, at);
      tl.set(to.el, { opacity: 1, pointerEvents: 'auto', zIndex: 2 }, at);
      tl.fromTo(from.el, { yPercent: 0, scale: 1 },
        { yPercent: 45, scale: 0.9, duration: dur, ease: 'power1.in', immediateRender: false }, at);
      // Its own ease: already closing mid-way, and shut just before the end,
      // so no smudge of the old sheet is left over the new one.
      tl.fromTo(from.el, { '--iris': 0 },
        { '--iris': 1, duration: dur * 0.9, ease: 'sine.inOut', immediateRender: false }, at);
      tl.fromTo(to.el, { scale: 1.06 },
        { scale: 1, duration: dur, ease: 'power2.out', immediateRender: false }, at);
      tl.fromTo(to.veil, { opacity: 0.55 }, { opacity: 0, duration: dur, ease: 'power1.out' }, at);
      tl.set(from.el, { opacity: 0, pointerEvents: 'none' }, at + dur);
      return dur;
    }
  };
}

/* The sheet on top is lifted away, uncovering the next one, which rises a
   touch into place from underneath as the light reaches it. */
export function curtain(opts) {
  opts = opts || {};
  var dur = opts.duration || 1;
  return {
    duration: dur,
    reveal: 0.35,
    build: function (tl, from, to, at) {
      tl.set(from.el, { zIndex: 3 }, at);
      tl.set(to.el, { opacity: 1, pointerEvents: 'auto', zIndex: 2 }, at);
      tl.fromTo(from.el, { yPercent: 0 },
        { yPercent: -100, duration: dur, ease: 'power2.inOut', immediateRender: false }, at);
      if (to.inner) tl.fromTo(to.inner, { yPercent: 16 }, { yPercent: 0, duration: dur, ease: 'power2.out' }, at);
      tl.fromTo(to.veil, { opacity: 0.6 }, { opacity: 0, duration: dur, ease: 'power1.out' }, at);
      tl.set(from.el, { opacity: 0, pointerEvents: 'none' }, at + dur);
      return dur;
    }
  };
}
