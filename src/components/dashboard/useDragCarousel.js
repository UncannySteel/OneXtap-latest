import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Drag-to-scroll carousel plumbing for the Features rail.
 *
 * THE ONE RULE, same as `useScrollScene`: one source of truth. Here it is the
 * viewport's own `scrollLeft`. Dragging writes to it, the arrows write to it,
 * a trackpad swipe writes to it, and a `Tab` into a card writes to it — and
 * everything read back (which card is active, the progress rail, the per-card
 * warp) is computed *from* it. Nothing keeps a separate slide index that the
 * scrollbar could disagree with.
 *
 * Using the native scroller rather than a translated track is what makes the
 * section work for every input without a branch: touch gets real momentum
 * scrolling from the platform, trackpads get two-finger swipes, keyboards get
 * scroll-into-view on focus, and a vertical wheel still scrolls the *page*
 * instead of being swallowed. Only the mouse needs code, because a mouse has
 * no horizontal gesture — that is what the drag handler is for.
 *
 * Per-frame values (warp, progress) are written to the DOM directly. React
 * state holds only the integer active index, which changes a handful of times
 * per pass instead of once per frame.
 */

/** Velocity decay per frame after a mouse drag is released. */
const FRICTION = 0.9;
/** Below this many px/frame the throw is over. */
const MIN_VELOCITY = 0.4;
/** Ceiling on throw speed, px/frame. Above this a flick stops being readable. */
const THROW_MAX = 70;
/** Pointer travel that turns a click into a drag, in px. */
const DRAG_SLOP = 6;
/** How much of the drag's speed survives into the skew, and its ceiling. */
const SKEW_PER_PX = 0.16;
const SKEW_MAX = 7;
/** Depth of the curve: rotation and push-back at one viewport from centre. */
const ROTATE_MAX = 9;
const DEPTH_MAX = 70;

const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);

/** The cards, read from the DOM every time — there is no cached list to stale. */
const cardsOf = (vp) => Array.from(vp.querySelectorAll('[data-otf-card]'));

/**
 * The `scrollLeft` that puts `card` in the middle of the viewport, clamped to
 * what the scroller can actually reach. The first and last card cannot be
 * centred, so their target is the corresponding end — which is exactly where
 * they should be considered active.
 */
const targetOf = (card, clientWidth, travel) =>
  clamp(card.offsetLeft - (clientWidth - card.offsetWidth) / 2, 0, Math.max(travel, 0));

/**
 * @param {object} [opts]
 * @param {boolean} [opts.reduced=false] True drops the warp and the smooth
 *   scrolling; the rail stays a perfectly ordinary horizontal scroller.
 * @returns {{
 *   root: object, viewport: object, active: number, dragging: boolean,
 *   goTo: (i: number) => void,
 * }}
 */
export function useDragCarousel({ reduced = false } = {}) {
  const root = useRef(null);
  const viewport = useRef(null);
  const [active, setActive] = useState(0);
  const [dragging, setDragging] = useState(false);

  // Everything the animation loop touches lives in one ref so the effect below
  // can stay mounted for the life of the section — re-running it on every
  // render would tear the listeners off mid-drag.
  const run = useRef({
    frame: 0,
    lastLeft: 0,
    velocity: 0,
    smooth: 0,
    activeIndex: 0,
    // drag
    down: false,
    pointerId: null,
    startX: 0,
    startLeft: 0,
    moved: 0,
    samples: [],
    throwFrame: 0,
    suppressClick: false,
  });

  /**
   * Scrolls card `i` to the middle of the viewport. Clamped by the scroller
   * itself at both ends, so the first and last card simply rest against their
   * edge instead of leaving a gap.
   */
  const goTo = useCallback(
    (i) => {
      const vp = viewport.current;
      if (!vp) return;
      const cards = cardsOf(vp);
      const card = cards[clamp(i, 0, cards.length - 1)];
      if (!card) return;
      vp.scrollTo({
        left: targetOf(card, vp.clientWidth, vp.scrollWidth - vp.clientWidth),
        behavior: reduced ? 'auto' : 'smooth',
      });
    },
    [reduced],
  );

  useEffect(() => {
    const vp = viewport.current;
    const el = root.current;
    if (!vp || !el || typeof window === 'undefined') return undefined;

    const state = run.current;
    state.lastLeft = vp.scrollLeft;
    // The effect can re-run mid-drag (the reader flips "reduce motion" while
    // holding the rail), and the listeners it tears down include the
    // `pointerup` that would have ended that drag. Starting clean means a
    // half-remembered drag cannot resume on the next bare mouse move.
    state.down = false;
    state.pointerId = null;
    state.suppressClick = false;

    /** One read of the scroller → active index, progress rail, per-card warp. */
    const read = () => {
      state.frame = 0;
      const { scrollLeft, clientWidth, scrollWidth } = vp;
      const travel = scrollWidth - clientWidth;

      // Velocity is measured in px per frame and smoothed, so a single jittery
      // sample cannot snap the whole rail sideways.
      state.velocity = scrollLeft - state.lastLeft;
      state.lastLeft = scrollLeft;
      state.smooth = state.smooth * 0.78 + state.velocity * 0.22;

      el.style.setProperty('--otf-prog', travel > 0 ? (scrollLeft / travel).toFixed(4) : '0');

      const centre = scrollLeft + clientWidth / 2;
      const cards = cardsOf(vp);
      let nearest = 0;
      let nearestGap = Infinity;

      const skew = reduced ? 0 : clamp(state.smooth * SKEW_PER_PX, -SKEW_MAX, SKEW_MAX);

      cards.forEach((card, i) => {
        // "Active" is the card `goTo` would be resting on, measured by the
        // scroll offset it would produce — not by which card happens to be
        // nearest the middle. The two differ at both ends, where the scroller
        // cannot centre a card: with the middle as the test, a rail parked at
        // 0 reports card 2 as active while the reader is plainly looking at
        // card 1. Comparing target offsets also makes the arrows exact, since
        // `goTo(i)` lands on card i's target by construction.
        const gap = Math.abs(scrollLeft - targetOf(card, clientWidth, travel));
        if (gap < nearestGap) {
          nearestGap = gap;
          nearest = i;
        }
        if (reduced) return;
        // Distance from the middle of the viewport, in viewports. Past one
        // viewport the card is off screen and the curve stops deepening.
        const d = clamp((card.offsetLeft + card.offsetWidth / 2 - centre) / clientWidth, -1, 1);
        const away = Math.abs(d);
        card.style.transform =
          `perspective(1500px) translateZ(${(-away * DEPTH_MAX).toFixed(1)}px) ` +
          `rotateY(${(-d * ROTATE_MAX).toFixed(2)}deg) ` +
          // The skew is what makes a fast drag read as the rail bending: the
          // trailing edge lags behind the leading one. It eases off towards
          // the edges so the cards do not shear apart out there.
          `skewY(${(skew * (1 - away * 0.45)).toFixed(2)}deg)`;
      });

      if (nearest !== state.activeIndex) {
        state.activeIndex = nearest;
        setActive(nearest);
      }

      // Scroll events stop the instant the rail does, but the smoothed
      // velocity that drives the skew has not reached zero yet — so without
      // this the cards keep whatever bend they were wearing on the last frame
      // and sit permanently skewed. Keep the loop alive on our own until the
      // bend has decayed out.
      if (!reduced && Math.abs(state.smooth) > 0.04) schedule();
    };

    const schedule = () => {
      if (!state.frame) state.frame = window.requestAnimationFrame(read);
    };

    /** Momentum after a mouse drag. Touch gets this from the platform. */
    const glide = () => {
      state.throwFrame = 0;
      if (Math.abs(state.velocity) < MIN_VELOCITY) return;
      const before = vp.scrollLeft;
      vp.scrollLeft = before + state.velocity;
      // Hitting either end ends the throw rather than spinning against a wall.
      if (vp.scrollLeft === before) return;
      state.velocity *= FRICTION;
      state.throwFrame = window.requestAnimationFrame(glide);
    };

    const stopGlide = () => {
      if (state.throwFrame) window.cancelAnimationFrame(state.throwFrame);
      state.throwFrame = 0;
    };

    const onPointerDown = (e) => {
      // Touch already has momentum scrolling and a pen behaves like it, so
      // only the mouse is driven by hand. Anything else falls through to the
      // platform untouched — which also keeps vertical drags scrolling the page.
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      stopGlide();
      state.down = true;
      state.pointerId = e.pointerId;
      state.startX = e.clientX;
      state.startLeft = vp.scrollLeft;
      state.moved = 0;
      state.suppressClick = false;
      state.samples = [{ x: e.clientX, t: e.timeStamp }];
      setDragging(true);
    };

    const onPointerMove = (e) => {
      if (!state.down || e.pointerId !== state.pointerId) return;
      const dx = e.clientX - state.startX;
      state.moved = Math.max(state.moved, Math.abs(dx));
      // Capture only once the gesture has committed, so a plain click on a
      // chip inside a card still reaches it. Capture is a nicety — it keeps
      // the drag alive past the edge of the rail — so a browser that refuses
      // the id must not take the drag down with it.
      if (state.moved > DRAG_SLOP && !vp.hasPointerCapture(e.pointerId)) {
        try { vp.setPointerCapture(e.pointerId); } catch { /* keep dragging */ }
      }
      vp.scrollLeft = state.startLeft - dx;
      state.samples.push({ x: e.clientX, t: e.timeStamp });
      if (state.samples.length > 6) state.samples.shift();
    };

    const onPointerUp = (e) => {
      if (!state.down || e.pointerId !== state.pointerId) return;
      state.down = false;
      state.pointerId = null;
      try {
        if (vp.hasPointerCapture(e.pointerId)) vp.releasePointerCapture(e.pointerId);
      } catch { /* nothing to release */ }
      setDragging(false);

      // Arm the click guard, and disarm it again on the next task. The click
      // that a real drag-release generates is dispatched in *this* task, so it
      // always sees the flag; a release that happens outside the rail
      // generates no click at all, and without the timeout the flag would
      // stay armed and eat the next unrelated activation — including an Enter
      // on a step chip reached by keyboard.
      state.suppressClick = state.moved > DRAG_SLOP;
      window.setTimeout(() => { state.suppressClick = false; }, 0);

      if (reduced || state.moved <= DRAG_SLOP) return;
      // Throw speed comes from the last ~100ms of travel, not the whole drag:
      // a slow drag that ends in a flick should still fly.
      const last = state.samples[state.samples.length - 1];
      const first = state.samples.find((s) => last.t - s.t < 110) || state.samples[0];
      const dt = last.t - first.t;
      if (dt <= 0) return;
      // px/ms → px/frame at 60Hz, then capped so a violent flick stays readable.
      state.velocity = clamp(((first.x - last.x) / dt) * 16.7, -THROW_MAX, THROW_MAX);
      glide();
    };

    // A drag that happens to end on top of a button must not also press it.
    const onClickCapture = (e) => {
      if (!state.suppressClick) return;
      state.suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    };

    read();
    vp.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    vp.addEventListener('pointerdown', onPointerDown);
    vp.addEventListener('pointermove', onPointerMove);
    vp.addEventListener('pointerup', onPointerUp);
    vp.addEventListener('pointercancel', onPointerUp);
    vp.addEventListener('click', onClickCapture, true);

    return () => {
      if (state.frame) window.cancelAnimationFrame(state.frame);
      stopGlide();
      vp.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      vp.removeEventListener('pointerdown', onPointerDown);
      vp.removeEventListener('pointermove', onPointerMove);
      vp.removeEventListener('pointerup', onPointerUp);
      vp.removeEventListener('pointercancel', onPointerUp);
      vp.removeEventListener('click', onClickCapture, true);
    };
  }, [reduced]);

  // Leaving reduced motion on mid-session would otherwise strand whatever warp
  // the cards were wearing when the setting flipped.
  useEffect(() => {
    if (!reduced || !viewport.current) return;
    cardsOf(viewport.current).forEach((card) => { card.style.transform = ''; });
  }, [reduced]);

  return { root, viewport, active, dragging, goTo };
}

export default useDragCarousel;
