import React, { useCallback, useRef } from 'react';
import { useScrollScene, usePrefersReducedMotion } from './useScrollScene';

/**
 * About, on a sheet of paper that crumples as you scroll out of it.
 *
 * THE SHAPE OF THE SCENE. The track is pinned for two viewports. The first
 * ~45% of it holds the sheet pristine and still — that is the reading window,
 * and nothing moves during it. Only once the reader has scrolled past that
 * does the crumple begin, and it runs to completion by the time the FAQ
 * arrives. Scrolling back up reverses it exactly; there is no one-way state.
 *
 * HOW THE CRUMPLE IS BUILT. Three layers, cheapest first:
 *
 *   1. The sheet's own transform — scale, rotate, lift, fade. Compositor work,
 *      driven straight from `--ot-c` in CSS.
 *   2. A crease overlay: an SVG turbulence run through diffuse lighting, which
 *      is what actually looks like creased paper. It is rendered ONCE and only
 *      its opacity animates.
 *   3. A displacement warp on the live content, so the text deforms with the
 *      paper instead of sliding under a picture of creases. This is the
 *      expensive layer and the only one that needs JS.
 *
 * WHY THE WARP IS QUANTISED. `feDisplacementMap`'s `scale` is an attribute, not
 * a CSS property, so it has to be written from JS — and every write re-runs the
 * filter over the whole subtree. Rounding to the nearest 2 turns ~60 filter
 * passes a second into about 15 across the whole transition, which is
 * indistinguishable at this speed and the difference between smooth and not on
 * an ordinary laptop.
 *
 * Layer 3 is desktop-and-pointer only; reduced motion drops the scene entirely
 * and renders About as a plain section.
 */

/** Share of the track spent holding the sheet still and readable. */
const READ_HOLD = 0.45;

/** Peak displacement, in user units, at full crumple. */
const WARP_MAX = 26;

/**
 * Where the warp is worth its cost. It rasterises the whole sheet through an
 * SVG filter on every change, which a laptop absorbs and a phone does not, so
 * small screens and touch devices get the other two layers only — still a
 * creasing, tilting, fading sheet, just not a deforming one.
 *
 * Read once: this is a device property, not a window size to track.
 */
const warpWorthIt = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(min-width: 861px)').matches &&
  window.matchMedia('(pointer: fine)').matches;

const AboutSection = () => {
  const track = useRef(null);
  const warp = useRef(null);
  const warpHost = useRef(null);
  const lastWarp = useRef(-1);
  const useWarp = useRef(null);
  const reduced = usePrefersReducedMotion();

  const onProgress = useCallback((p, el) => {
    // Remap so crumple progress is 0 for the whole reading hold, then 0→1.
    const c = p <= READ_HOLD ? 0 : (p - READ_HOLD) / (1 - READ_HOLD);
    el.style.setProperty('--ot-c', c.toFixed(4));

    const node = warp.current;
    if (!node) return;
    if (useWarp.current === null) useWarp.current = warpWorthIt();
    if (!useWarp.current) return;

    const next = Math.round((c * WARP_MAX) / 2) * 2;
    if (next === lastWarp.current) return;

    // A filter with `scale="0"` is still a filter: the browser keeps
    // rasterising the subtree through it on every paint, for a warp of
    // nothing. Detaching it outside the crumple means the reading hold — where
    // the reader actually spends time — costs the same as plain text.
    if ((next === 0) !== (lastWarp.current === 0) && warpHost.current) {
      warpHost.current.style.filter = next === 0 ? 'none' : 'url(#otCrumpleWarp)';
    }
    lastWarp.current = next;
    node.setAttribute('scale', String(next));
  }, []);

  useScrollScene(track, { steps: 1, enabled: !reduced, lead: 0.04, tail: 0.04, onProgress });

  const body = (
    <div className="ot-ab-grid">
      <div>
        <p className="ot-ab-eyebrow">About</p>
        <h2 className="ot-ab-h2">
          Built for the part of
          <br />
          job hunting <em>nobody enjoys.</em>
        </h2>
      </div>
      <div className="ot-ab-copy">
        <p>
          Every application asks the same thirty questions. Onextap is a browser extension that answers
          them for you — one profile, filled into any job form, on any site, in a single tap.
        </p>
        <p>
          It is deliberately small. No job board to live in, no pipeline to maintain, no onboarding week.
          It does one job and then gets out of the way.
        </p>
        <p>
          Your profile is stored on your device rather than in our database. When an AI feature runs, only
          the text that request needs is sent to our AI providers — the{' '}
          <a href="/privacy-policy" target="_blank" rel="noopener noreferrer">
            privacy policy
          </a>{' '}
          sets out exactly what goes where.
        </p>
      </div>
    </div>
  );

  if (reduced) {
    return (
      <section id="about" className="ot-ab ot-ab--static scroll-mt-20">
        <div className="ot-ab-sheet">{body}</div>
      </section>
    );
  }

  return (
    <section id="about" ref={track} className="ot-ab scroll-mt-20" style={{ height: '220vh' }}>
      {/* Filter definitions. Zero-sized and hidden from the a11y tree — this
          svg paints nothing itself, it only supplies `url(#…)` targets. */}
      <svg className="ot-ab-defs" aria-hidden="true" focusable="false">
        <defs>
          {/* The warp. A generous filter region because displaced pixels are
              sampled from outside the source box and would otherwise be
              clipped at the sheet's edges mid-crumple. */}
          <filter id="otCrumpleWarp" x="-12%" y="-12%" width="124%" height="124%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.009 0.013" numOctaves="3" seed="11" result="warpNoise" />
            <feDisplacementMap
              ref={warp}
              in="SourceGraphic"
              in2="warpNoise"
              scale="0"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>

          {/* The creases. Turbulence lit from one side reads as folded paper;
              a gradient alone reads as a gradient. */}
          <filter id="otCrumplePaper" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.026" numOctaves="5" seed="7" result="grain" />
            <feDiffuseLighting in="grain" lightingColor="#ffffff" surfaceScale="2.6" diffuseConstant="1.05">
              <feDistantLight azimuth="58" elevation="56" />
            </feDiffuseLighting>
          </filter>
        </defs>
      </svg>

      <div className="ot-ab-stage">
        <div className="ot-ab-sheet">
          {/* Only this wrapper carries the warp filter, so the creases above it
              stay crisp and the filtered area is the sheet, not the viewport. */}
          <div className="ot-ab-warp" ref={warpHost}>{body}</div>

          <div className="ot-ab-creases" aria-hidden="true">
            <svg width="100%" height="100%" preserveAspectRatio="none">
              <rect width="100%" height="100%" filter="url(#otCrumplePaper)" />
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
};

export default AboutSection;
