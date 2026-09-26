import { useEffect, useRef, useState } from 'react';

/**
 * Scroll-driven scene plumbing, shared by every pinned section on the landing
 * page (the manifesto, the product walkthrough, the About crumple).
 *
 * THE ONE RULE: scroll position is the single source of truth. Nothing here
 * keeps a separate "current slide" that scrolling could disagree with — the
 * dots and arrow buttons in the walkthrough move the *window*, and the scene
 * follows from the new scroll offset like any other scroll. That is why a
 * half-finished swipe can never leave a section showing panel 2 while the page
 * is parked at panel 1, which is the usual way carousels of this shape get
 * stuck.
 */

const REDUCE_Q = '(prefers-reduced-motion: reduce)';

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Tracks the OS "reduce motion" setting, live.
 *
 * Every scene treats `true` as "drop the pinning entirely and render the
 * content as ordinary stacked sections" rather than "same layout, no
 * transitions" — a 300vh track whose animation never runs is 300vh of blank
 * page, which is worse than no effect at all.
 */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(REDUCE_Q).matches,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia(REDUCE_Q);
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  return reduced;
}

/** Document-space top of an element, independent of offsetParent. */
const docTop = (el) => window.scrollY + el.getBoundingClientRect().top;

/**
 * How far the sticky child travels while its parent is pinned. Zero or less
 * means the track is shorter than the viewport and there is nothing to scrub —
 * every caller has to treat that as "sit at progress 0" rather than dividing
 * by it.
 */
const travelOf = (el) => el.offsetHeight - window.innerHeight;

/**
 * Maps raw track progress onto the step range, keeping `lead` of the track as
 * a run-up before step 0 starts moving and `tail` as a hold after the last
 * step lands. Without them the first panel begins leaving on the very first
 * pixel of scroll and the last one is gone before the section is.
 */
const shape = (raw, lead, tail) => clamp01((raw - lead) / (1 - lead - tail));

/**
 * Drives one pinned section.
 *
 * Writes two custom properties on the element every frame — `--ot-p`, shaped
 * progress across the whole scene, and `--ot-sp`, progress within the current
 * step — so fine-grained motion stays in CSS on the compositor. React state
 * holds only the integer step, which changes `steps` times per scroll-through
 * instead of once per frame; that is what keeps a scrubbed section off the
 * render path.
 *
 * @param {object} ref React ref to the tall track element.
 * @param {object} opts
 * @param {number} opts.steps How many discrete panels the track is divided into.
 * @param {boolean} [opts.enabled=true] False unmounts the listeners and parks at step 0.
 * @param {number} [opts.lead=0.06] Share of the track spent before step 0 moves.
 * @param {number} [opts.tail=0.12] Share of the track spent holding the last step.
 * @param {(p: number, el: HTMLElement) => void} [opts.onProgress] Per-frame hook for
 *   effects CSS cannot express from a custom property — an SVG filter attribute,
 *   say. Called during scroll, so it must only touch the DOM: setting React
 *   state here puts a render on every frame and undoes the point of the split.
 * @returns {number} The active step index.
 */
export function useScrollScene(ref, { steps, enabled = true, lead = 0.06, tail = 0.12, onProgress }) {
  const [step, setStep] = useState(0);
  const stepRef = useRef(0);

  // Held in a ref so a caller's inline arrow does not tear down the listeners
  // on every render.
  const progressCb = useRef(onProgress);
  progressCb.current = onProgress;

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || typeof window === 'undefined') {
      stepRef.current = 0;
      setStep(0);
      return undefined;
    }

    let frame = 0;

    const read = () => {
      frame = 0;
      const travel = travelOf(el);
      const raw = travel > 0 ? clamp01(-el.getBoundingClientRect().top / travel) : 0;
      const p = shape(raw, lead, tail);

      el.style.setProperty('--ot-p', p.toFixed(4));

      // `p === 1` would otherwise floor to `steps`, one past the last panel.
      const scaled = p * steps;
      const next = Math.min(steps - 1, Math.floor(scaled));
      el.style.setProperty('--ot-sp', clamp01(scaled - next).toFixed(4));

      if (progressCb.current) progressCb.current(p, el);

      if (next !== stepRef.current) {
        stepRef.current = next;
        setStep(next);
      }
    };

    // Coalesce to one read per frame: scroll fires far more often than paint.
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(read);
    };

    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [ref, steps, enabled, lead, tail]);

  return step;
}

/**
 * Scrolls the window to where `useScrollScene` would report `index` as the
 * active step — the machinery behind every dot, arrow and swipe in the
 * walkthrough. Targets the middle of the step's band so a rounding error near
 * an edge cannot land on the neighbour.
 *
 * @param {HTMLElement|null} el The same track element the hook is watching.
 * @param {number} index Step to travel to.
 * @param {object} opts Must match the options the hook was given.
 */
export function scrollToStep(el, index, { steps, lead = 0.06, tail = 0.12 }) {
  if (!el || typeof window === 'undefined') return;
  const travel = travelOf(el);
  if (travel <= 0) return;

  const centre = (Math.min(steps - 1, Math.max(0, index)) + 0.5) / steps;
  const raw = lead + centre * (1 - lead - tail);
  window.scrollTo({ top: docTop(el) + raw * travel, behavior: 'smooth' });
}
