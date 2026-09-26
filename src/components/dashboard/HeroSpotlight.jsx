import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * How long one full run occupies, in ms. Must stay >= the longest
 * (animation-delay + animation-duration) in the `ot-hero-*` keyframes — the
 * swing and the wordmark both land at ~2.2s. The full timeline is written out
 * in `src/index.css`, "LANDING HERO — SPOTLIGHT SCENE".
 */
const RUN_MS = 2300;

/** The flicker alone, when a hover re-lights the lamp. Matches its keyframe. */
const FLICK_MS = 1100;

/**
 * Chair geometry, drawn once into <defs> and placed by <use>. Local box is
 * 108 x 240 with the feet on the bottom edge; each placement scales and
 * positions itself. Nothing here sets `fill`, so a placement inherits its
 * colour from whatever encloses its <use> — which is how the middle chair gets
 * a second, brighter copy of itself stacked on the first.
 *
 * The back legs carry their shading as a presentation attribute rather than a
 * class: stylesheet rules reach into a use-element shadow tree inconsistently
 * across browsers, but attributes clone with the node.
 */
const Chair = () => (
  <g>
    <path d="M32 146 L39 146 L30 232 L23 232 Z" opacity="0.8" />
    <path d="M69 146 L76 146 L85 232 L78 232 Z" opacity="0.8" />
    <path d="M17 146 L26 146 L11 240 L3 240 Z" />
    <path d="M82 146 L91 146 L105 240 L97 240 Z" />
    {/* Backrest: a tall dome, a shade wider at the top than where it meets the seat. */}
    <path d="M14 120 L10 46 Q10 7 54 7 Q98 7 98 46 L94 120 Z" />
    {/* Cushion and the frame rail below it, split by a hairline of bare page. */}
    <rect x="1" y="118" width="106" height="15" rx="5" />
    <rect x="5" y="136" width="98" height="11" rx="3" />
  </g>
);

/** Left, middle, right — the middle one is the chair the lamp picks out. */
const CHAIR_X = [130, 250, 370];
const SPOTLIT = 1;

/** Drawn twice: once as the warm fill that blinks, once as the outline on top. */
const GLASS =
  'M242 135 C242 143 231 147 229 158 C227 171 237 179 250 179 C263 179 273 171 271 158 C269 147 258 143 258 135 Z';

const CONE = 'M237 170 L263 170 L340 444 L160 444 Z';

/**
 * Two arrangements of the same drawing. The lamp and chairs never move —
 * their geometry is pinned around x=250 with the feet at y=434, and the swing
 * pivots on a hard-coded ceiling anchor in the CSS — so a layout only chooses
 * how much room sits to the right of them and where the wordmark goes.
 *
 * `wide` reproduces the reference: chairs at the left, wordmark beside them.
 * Narrow enough and that shrinks the chairs to thumbnails, so `tall` stacks the
 * wordmark underneath instead.
 */
const LAYOUT = {
  // wordX is set so the wordmark's right edge leaves the same margin the
  // chairs leave on the left (measured: chairs 78..422, wordmark 454 wide),
  // which is what makes the pair read as centred inside the section.
  wide: { viewBox: '0 0 1020 500', wordX: 715, wordY: 388, wordSize: 54 },
  tall: { viewBox: '0 0 500 620', wordX: 250, wordY: 556, wordSize: 44 },
};

/**
 * Container width, in CSS px, at which the wide arrangement still has room for
 * chairs worth looking at. Measured on the element rather than the viewport
 * on purpose: the left rail and the section padding both appear at `md`, so a
 * 768px viewport actually hands this component *less* room than a 700px one.
 */
const WIDE_MIN_PX = 600;

const matches = (q) => typeof window !== 'undefined' && window.matchMedia(q).matches;

/**
 * True while the app's splash screen would still hide the scene. It is dropped
 * as soon as the splash starts its half-second fade rather than when it is
 * finally removed: the cord draw and the bulb's descent then play *through*
 * that fade, and the light catches with the page fully visible.
 */
const splashCovering = () => {
  if (typeof document === 'undefined') return false;
  const el = document.querySelector('.splash-screen');
  return !!el && !el.classList.contains('splash-exit');
};

/**
 * The landing hero: three chairs under a pendant lamp that drops in on its
 * cord, swings, stutters alight, spotlights the middle one and brings up the
 * wordmark. About 2.3s end to end.
 *
 * TWO INDEPENDENT TRIGGERS, and the split is the whole design:
 *
 *   - The **full run** replays on load and whenever the hero scrolls back into
 *     view. `runId` keys the <svg>, so a bump hands React a fresh DOM node and
 *     every animation inside restarts from zero.
 *   - **Hovering the chairs or the lamp** re-lights the bulb and nothing else.
 *     That works because every lit layer — glow, glass, cone, floor pool and
 *     the middle chair's brighter copy — is wrapped in a `.ot-hero-flick`
 *     group driven by one shared keyframe, so `flickId` can remount just those
 *     four wrappers while the chairs, cord and wordmark stay put. A solo
 *     flicker also drops the 0.7s cue delay, or a hover would appear to do
 *     nothing for most of a second.
 *
 * Purely decorative: `role="img"` with a label, and never focusable.
 */
const HeroSpotlight = () => {
  const [runId, setRunId] = useState(0);
  const [flickId, setFlickId] = useState(0);
  // First paint has no measurement yet, so it guesses from the viewport. 648px
  // is the width at which the hero section's own padding first leaves
  // WIDE_MIN_PX behind, so the guess and the observer agree and the layout
  // never has to correct itself on the next frame.
  const [wide, setWide] = useState(() => matches('(min-width: 648px)'));
  const [armed, setArmed] = useState(() => !splashCovering());
  const stage = useRef(null);
  // Re-entry must not restart a run already in flight, and a hover must not
  // cut across either one. Refs, so the timers can be cancelled on unmount.
  const running = useRef(false);
  const flicking = useRef(false);
  const runTimer = useRef(null);
  const flickTimer = useRef(null);

  const playAll = useCallback(() => {
    if (running.current) return;
    running.current = true;
    setRunId((n) => n + 1);
    // Back to the scripted delay: the fresh <svg> plays the whole sequence.
    setFlickId(0);
    window.clearTimeout(runTimer.current);
    runTimer.current = window.setTimeout(() => {
      running.current = false;
    }, RUN_MS);
  }, []);

  const playFlicker = useCallback(() => {
    if (!armed || running.current || flicking.current) return;
    flicking.current = true;
    setFlickId((n) => n + 1);
    window.clearTimeout(flickTimer.current);
    flickTimer.current = window.setTimeout(() => {
      flicking.current = false;
    }, FLICK_MS);
  }, [armed]);

  useEffect(() => {
    const el = stage.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => {
      setWide(entry.contentRect.width >= WIDE_MIN_PX);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (armed) return undefined;
    const check = () => {
      if (!splashCovering()) setArmed(true);
    };
    const obs = new MutationObserver(check);
    // The splash announces its exit by gaining a class, and its removal is a
    // childList change, so both have to be watched.
    obs.observe(document.body, { childList: true, subtree: true, attributeFilter: ['class'] });
    check();
    return () => obs.disconnect();
  }, [armed]);

  // The run on load.
  useEffect(() => {
    if (armed) playAll();
  }, [armed, playAll]);

  // Scrolling back up to the hero plays it again. Only a real *return* counts,
  // so the observer has to see the hero leave before a re-entry triggers —
  // otherwise its initial callback would fire a second run over the first.
  useEffect(() => {
    const el = stage.current;
    if (!el || !armed || typeof IntersectionObserver === 'undefined') return undefined;
    let left = false;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) {
          left = true;
        } else if (left) {
          left = false;
          playAll();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [armed, playAll]);

  useEffect(
    () => () => {
      window.clearTimeout(runTimer.current);
      window.clearTimeout(flickTimer.current);
    },
    [],
  );

  const L = wide ? LAYOUT.wide : LAYOUT.tall;
  // A solo flicker has no scripted lead-in to wait through.
  const flick = {
    className: 'ot-hero-flick',
    style: flickId > 0 ? { animationDelay: '0s' } : undefined,
  };

  return (
    <div
      ref={stage}
      className="ot-hero-stage relative w-full select-none"
      role="img"
      aria-label="We're hiring. Three chairs in a row; a pendant bulb drops from the ceiling, flickers on, and spotlights the middle chair."
    >
      <svg
        key={runId}
        viewBox={L.viewBox}
        className={`ot-hero-svg block h-auto w-full ${armed ? '' : 'ot-hero-hold'}`}
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <g id="otHeroChair">
            <Chair />
          </g>

          {/* Dotted paper grain, as in the reference. */}
          <pattern id="otHeroDots" width="16" height="16" patternUnits="userSpaceOnUse">
            <circle className="ot-hero-dot" cx="2" cy="2" r="1.1" />
          </pattern>

          {/* Light cone: bright at the bulb, almost gone by the floor. Stop
              colours come from CSS so they can follow the theme — a
              presentation attribute would not resolve var(). */}
          <linearGradient id="otHeroConeFill" x1="0" y1="0" x2="0" y2="1">
            <stop className="ot-hero-lit-stop" offset="0%" stopOpacity="0.95" />
            <stop className="ot-hero-lit-stop" offset="50%" stopOpacity="0.7" />
            <stop className="ot-hero-lit-stop" offset="100%" stopOpacity="0.12" />
          </linearGradient>

          <radialGradient id="otHeroGlow">
            <stop className="ot-hero-lit-stop" offset="0%" stopOpacity="0.95" />
            <stop className="ot-hero-lit-stop" offset="42%" stopOpacity="0.45" />
            <stop className="ot-hero-lit-stop" offset="100%" stopOpacity="0" />
          </radialGradient>

          {/* The filament's own glow runs hotter than the light it throws. */}
          <radialGradient id="otHeroBulbGlow">
            <stop className="ot-hero-bulb-stop" offset="0%" stopOpacity="0.95" />
            <stop className="ot-hero-bulb-stop" offset="55%" stopOpacity="0.5" />
            <stop className="ot-hero-bulb-stop" offset="100%" stopOpacity="0" />
          </radialGradient>

          <radialGradient id="otHeroPoolFill">
            <stop className="ot-hero-lit-stop" offset="0%" stopOpacity="0.95" />
            <stop className="ot-hero-lit-stop" offset="100%" stopOpacity="0" />
          </radialGradient>

          {/* The scene sits straight on the page with no card behind it, so the
              grain has to be gone before its own edge or it reads as a
              pasted-in rectangle. It stays boxed around the chairs rather than
              filling the viewBox, so the wide layout's empty right half is
              clean page. */}
          <radialGradient id="otHeroFadeFill">
            <stop offset="0%" stopColor="#fff" stopOpacity="1" />
            <stop offset="58%" stopColor="#fff" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <mask id="otHeroEdgeFade">
            <rect x="0" y="0" width="500" height="470" fill="url(#otHeroFadeFill)" />
          </mask>

          <filter id="otHeroSoft" x="-40%" y="-20%" width="180%" height="140%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
          <filter id="otHeroBloom" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>

        <rect
          className="ot-hero-dots"
          x="0"
          y="0"
          width="500"
          height="470"
          fill="url(#otHeroDots)"
          mask="url(#otHeroEdgeFade)"
        />

        {/* Behind the chairs: the cone in the air and the pool it throws. */}
        <g className="ot-hero-lamp">
          <g className="ot-hero-sway">
            <g key={flickId} {...flick}>
              <ellipse className="ot-hero-pool" cx="250" cy="434" rx="112" ry="24" fill="url(#otHeroPoolFill)" />
              <path className="ot-hero-cone" d={CONE} fill="url(#otHeroConeFill)" filter="url(#otHeroSoft)" />
            </g>
          </g>
        </g>

        <g>
          {CHAIR_X.map((cx, i) => {
            const place = `translate(${cx - 48.6} 218) scale(0.9)`;
            return (
              <g
                key={cx}
                className={`ot-hero-chair ot-hero-chair--${['left', 'center', 'right'][i]}`}
              >
                <ellipse className="ot-hero-shadow" cx={cx} cy={435} rx="52" ry="7" />
                <use href="#otHeroChair" transform={place} />
                {/* The spotlit chair is red throughout; a brighter copy of it
                    blinks on top so the lamp warms it in step with the cone
                    instead of needing a colour keyframe of its own. */}
                {i === SPOTLIT && (
                  <g key={flickId} {...flick}>
                    <use className="ot-hero-seat-lit" href="#otHeroChair" transform={place} />
                  </g>
                )}
              </g>
            );
          })}
        </g>

        {/* In front: the haze the cone throws across the chairs, then the lamp. */}
        <g className="ot-hero-lamp">
          <g className="ot-hero-sway">
            <g key={flickId} {...flick}>
              <path
                className="ot-hero-cone ot-hero-cone--haze"
                d={CONE}
                fill="url(#otHeroConeFill)"
                filter="url(#otHeroSoft)"
              />
            </g>
            <path className="ot-hero-cord" d="M250 -70 L250 126" />
            <g className="ot-hero-bulb">
              <g key={flickId} {...flick}>
                <circle className="ot-hero-glow" cx="250" cy="158" r="68" fill="url(#otHeroGlow)" />
                <path className="ot-hero-glass-lit" d={GLASS} />
                <circle
                  className="ot-hero-glow ot-hero-glow--core"
                  cx="250"
                  cy="158"
                  r="24"
                  fill="url(#otHeroBulbGlow)"
                  filter="url(#otHeroBloom)"
                />
              </g>
              {/* Outline and filament sit above the glow so they stay crisp
                  through the brightest frames. */}
              <rect className="ot-hero-socket" x="241" y="119" width="18" height="17" rx="2.5" />
              <path className="ot-hero-glass" d={GLASS} />
              <path className="ot-hero-filament" d="M244 144 L244 156 Q247 164 250 156 Q253 164 256 156 L256 144" />
            </g>
          </g>
        </g>

        <text className="ot-hero-word" x={L.wordX} y={L.wordY} fontSize={L.wordSize}>
          WE&rsquo;RE HIRING
        </text>

        {/* Hover target for the re-flicker: the lamp and the chairs, not the
            wordmark. A transparent rect rather than the shapes themselves, so
            the gaps between chair legs do not drop the hover. Last in the
            document, therefore on top; nothing below it is interactive. */}
        <rect
          className="ot-hero-hit"
          x="60"
          y="0"
          width="380"
          height="455"
          fill="transparent"
          onMouseEnter={playFlicker}
          onClick={playFlicker}
        />
      </svg>
    </div>
  );
};

export default HeroSpotlight;
