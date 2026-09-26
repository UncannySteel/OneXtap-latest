import React from 'react';
import { ArrowLeft, ArrowRight, Zap, Lock, FileText, Sparkles, Crosshair, Users } from 'lucide-react';
import { usePrefersReducedMotion } from './useScrollScene';
import { useDragCarousel } from './useDragCarousel';

/**
 * Features, as a rail you drag.
 *
 * This replaces the pinned three-panel walkthrough that used to stand in for
 * Features *and* How-it-works. Two things changed in kind:
 *
 *  - The section no longer hijacks the page scroll. It is an ordinary block
 *    with a horizontal scroller inside it, dragged by hand — so it costs one
 *    screen instead of three and a half, and a reader who is not interested
 *    scrolls straight past it.
 *  - The mock browser windows are gone. Each feature now argues for itself in
 *    words, and says which of the three how-it-works steps it happens in;
 *    `STEPS` below is the same three steps, kept verbatim, and is what the
 *    chips on every card point at.
 *
 * Feature copy is unchanged from the live site — six features, same order of
 * ideas, same sentences.
 */

/** The three how-it-works steps. Card chips reference these by `id`. */
const STEPS = [
  {
    id: 'profile',
    n: '01',
    title: 'Build your profile',
    desc: 'Enter your details once or upload a resume. Onextap parses and structures everything automatically.',
  },
  {
    id: 'detect',
    n: '02',
    title: 'Open any job form',
    desc: 'Navigate to any job application on any platform. The Onextap extension activates automatically.',
  },
  {
    id: 'apply',
    n: '03',
    title: 'Tap to apply',
    desc: 'Hit autofill. Review your AI-personalized answers in seconds. Submit. Move to the next one.',
  },
];

const STEP_BY_ID = new Map(STEPS.map((s) => [s.id, s]));

/**
 * The six features, ordered the way the product is actually used — everything
 * you set up first, then everything that happens on the page, then the AI
 * pass at the end. `steps` is where each one lives in that story; `tone`
 * cycles the three card surfaces so the rail has a rhythm when you drag it.
 */
const FEATURES = [
  {
    id: 'profiles',
    Icon: Users,
    title: 'Multiple Profiles',
    desc: 'Different profile for design, engineering, or management roles. Switch between them effortlessly.',
    steps: ['profile'],
    tone: 'surface',
  },
  {
    id: 'storage',
    Icon: Lock,
    title: 'Secure Storage',
    desc: 'Data stored locally on your device with optional encrypted cloud backup and seamless sync.',
    steps: ['profile'],
    tone: 'deep',
  },
  {
    id: 'cover',
    Icon: FileText,
    title: 'Cover Letter Studio',
    desc: 'Upload and store cover letters, personalize with AI for each application, and fill them in one click from the extension.',
    steps: ['profile', 'apply'],
    tone: 'sunk',
  },
  {
    id: 'autofill',
    Icon: Zap,
    title: 'One-Click Autofill',
    desc: 'Scans form fields using DOM analysis and pattern matching. Fills every field in one click, every time.',
    steps: ['detect', 'apply'],
    tone: 'surface',
  },
  {
    id: 'mapping',
    Icon: Crosshair,
    title: 'Smart Field Mapping',
    desc: 'Encounter an unusual field? Map it once — Onextap remembers for every future application automatically.',
    steps: ['detect'],
    tone: 'deep',
  },
  {
    id: 'ai',
    Icon: Sparkles,
    title: 'AI Personalization',
    desc: 'Our AI reads the job description and suggests improvements to your answers before you submit.',
    steps: ['apply'],
    tone: 'sunk',
  },
];

/** First card that belongs to a step — where the step legend jumps to. */
const FIRST_CARD_OF = new Map(
  STEPS.map((s) => [s.id, FEATURES.findIndex((f) => f.steps.includes(s.id))]),
);

const pad2 = (n) => String(n).padStart(2, '0');

/** One feature. The chips at the foot are the "which step is this" pointer. */
const FeatureCard = ({ feature, index, total, active, onPickStep }) => {
  const { Icon } = feature;
  return (
    <article
      data-otf-card=""
      className={`otf-card otf-card--${feature.tone} ${active ? 'is-active' : ''}`}
      role="group"
      aria-roledescription="slide"
      aria-label={`Feature ${index + 1} of ${total}: ${feature.title}`}
    >
      {/* No card number up here on purpose. The chips at the foot are
          numbered 01-03 for the how-it-works steps, and a second, unrelated
          01-06 in the same type at the top of the same card read as the same
          series. Position is in the counter under the rail instead. */}
      <div className="otf-card-top">
        <span className="otf-card-icon" aria-hidden="true"><Icon size={17} /></span>
      </div>

      <h3 className="otf-card-title">{feature.title}</h3>
      <p className="otf-card-desc">{feature.desc}</p>

      <div className="otf-card-steps">
        <p className="otf-card-steps-label">Happens in</p>
        <ul>
          {feature.steps.map((sid) => {
            const step = STEP_BY_ID.get(sid);
            return (
              <li key={sid}>
                <button
                  type="button"
                  className="otf-step-chip"
                  onClick={() => onPickStep(sid)}
                  aria-label={`Step ${step.n}, ${step.title} — see how it works`}
                >
                  <span className="otf-step-chip-n" aria-hidden="true">{step.n}</span>
                  {step.title}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </article>
  );
};

/**
 * The Features rail.
 *
 * Both landing-page nav anchors still land somewhere real: `#features` is the
 * section, and `#how-it-works` is the three-step legend under the rail, which
 * is what every chip on every card refers to.
 */
const FeatureCarousel = () => {
  const reduced = usePrefersReducedMotion();
  const { root, viewport, active, dragging, goTo } = useDragCarousel({ reduced });

  const activeFeature = FEATURES[active] || FEATURES[0];
  const activeSteps = new Set(activeFeature.steps);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(active + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(active - 1); }
    else if (e.key === 'Home') { e.preventDefault(); goTo(0); }
    else if (e.key === 'End') { e.preventDefault(); goTo(FEATURES.length - 1); }
  };

  const pickStep = (sid) => {
    const i = FIRST_CARD_OF.get(sid);
    if (i >= 0) goTo(i);
  };

  return (
    <section id="features" ref={root} className="otf">
      <div className="otf-inner">
        <div className="otf-head">
          {/* The carousel's own title, in the same voice as the section titles
              above and below it. No eyebrow here: the neighbouring sections
              use one to name themselves, and this title already is the name. */}
          <h2 className="otf-h2">Features</h2>
          <div className="otf-head-copy">
            <p className="otf-lede-lead">Everything you need to apply <em>faster</em>.</p>
            <p className="otf-lede">
              A focused tool, not a bloated platform. We handle the friction so you can focus on
              finding the right role.
            </p>
          </div>
        </div>
      </div>

      {/* Full-bleed on purpose: the rail runs off both edges of the section so
          it reads as continuing past the screen rather than as a boxed widget.
          The track's own padding is what keeps the first and last card in line
          with the header above. */}
      <div
        ref={viewport}
        className={`otf-viewport ${dragging ? 'is-dragging' : ''}`}
        role="region"
        aria-roledescription="carousel"
        aria-label="Onextap features"
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        <div className="otf-track">
          {FEATURES.map((f, i) => (
            <FeatureCard
              key={f.id}
              feature={f}
              index={i}
              total={FEATURES.length}
              active={i === active}
              onPickStep={pickStep}
            />
          ))}
        </div>
      </div>

      <div className="otf-inner">
        <div className="otf-bar">
          <p className="otf-count">
            <span className="otf-count-now">{pad2(active + 1)}</span>
            <span aria-hidden="true"> / {pad2(FEATURES.length)}</span>
            <span className="otf-count-name">{activeFeature.title}</span>
          </p>

          {/* Progress is written straight to `--otf-prog` by the scroll
              handler, so the rail tracks a drag frame by frame without
              re-rendering anything. */}
          <span className="otf-rail" aria-hidden="true"><span className="otf-rail-thumb" /></span>

          <div className="otf-controls">
            <span className="otf-hint" aria-hidden="true">Drag</span>
            <button
              type="button"
              onClick={() => goTo(active - 1)}
              disabled={active === 0}
              aria-label="Previous feature"
            >
              <ArrowLeft size={16} />
            </button>
            <button
              type="button"
              onClick={() => goTo(active + 1)}
              disabled={active === FEATURES.length - 1}
              aria-label="Next feature"
            >
              <ArrowRight size={16} />
            </button>
          </div>
        </div>

        {/* The key to the chips on the cards, and where the nav's "How it
            works" lands. A step lights up while the card on screen is one of
            the features that happens in it. */}
        <div id="how-it-works" className="otf-steps">
          {/* A real heading, not `aria-label` on the div: a generic element's
              label is ignored by some screen readers, and this block wants to
              be in the document outline anyway. */}
          <h3 className="otf-steps-eyebrow">How it works</h3>
          <ol>
            {STEPS.map((s) => (
              <li key={s.id} className={activeSteps.has(s.id) ? 'is-lit' : undefined}>
                <button type="button" onClick={() => pickStep(s.id)}>
                  <span className="otf-steps-n" aria-hidden="true">{s.n}</span>
                  <span className="otf-steps-title">{s.title}</span>
                  <span className="otf-steps-desc">{s.desc}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
};

export default FeatureCarousel;
