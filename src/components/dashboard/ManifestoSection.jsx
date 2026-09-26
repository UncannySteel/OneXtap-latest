import React, { useRef } from 'react';
import { useScrollScene, usePrefersReducedMotion } from './useScrollScene';

/**
 * The three statements, as one sentence the reader walks through.
 *
 * The joke only lands in order: the hero says WE'RE HIRING over three empty
 * chairs, and this is the correction. Reordering these, or showing more than
 * one at full strength at a time, throws the beat away.
 *
 * `em` marks the words that take the brand accent. Splitting at the word level
 * rather than writing spans into a string keeps the mask wrapper per word,
 * which is what the roll-up reveal needs.
 */
const STATEMENTS = [
  { id: 'well', words: [['Well…..', false]], tone: 'soft' },
  { id: 'not', words: [['we', false], ['are', false], ['not.', false]], tone: 'plain' },
  {
    id: 'hired',
    words: [
      ['But', false], ['we', false], ['CAN', true], ['get', false], ['YOU', true], ['hired.', false],
    ],
    tone: 'punch',
  },
];

/** Panels in the track. One per statement — the track height follows from it. */
const STEPS = STATEMENTS.length;

/**
 * One statement, split into individually-masked words.
 *
 * `state` decides where the words sit rather than whether they are painted:
 * past words have rolled up out of their mask, future words have not yet
 * risen into it. Reading top-down through the sequence therefore moves every
 * word in the same direction, which is what makes three separate statements
 * feel like one sentence being spoken rather than three slides.
 *
 * The `{' '}` between wrappers is load-bearing, not formatting. Spacing the
 * words with CSS margin alone leaves no space characters in the DOM, so the
 * accessible name, the clipboard and find-in-page all see "wearenot." — one
 * word. A real space between two inline-blocks spaces them the way the font
 * intends and keeps the text a sentence.
 */
const Statement = ({ statement, state, stacked = true }) => (
  <p
    className={`ot-mf-line ot-mf-line--${statement.tone} is-${state}`}
    // Stacked in one grid cell, so the tallest statement sets the height and
    // switching between them cannot move the page.
    style={stacked ? { gridArea: '1 / 1' } : undefined}
  >
    {statement.words.map(([word, em], i) => (
      <React.Fragment key={`${word}-${i}`}>
        {i > 0 ? ' ' : null}
        <span className="ot-mf-word" style={{ '--wi': i }}>
          <span className={em ? 'ot-mf-em' : undefined}>{word}</span>
        </span>
      </React.Fragment>
    ))}
  </p>
);

/**
 * The scroll-driven text section between the hero and the walkthrough.
 *
 * A tall track with a pinned stage: scrolling advances which statement holds
 * the stage, the words of the outgoing one roll up out of their masks and the
 * incoming one's roll in from below. Reference is the offset, mask-revealed
 * display type on Boon Global; the type, colour and grain are Onextap's own.
 *
 * Under `prefers-reduced-motion` the track is not built at all — the three
 * statements render as an ordinary short section, all three readable at once.
 * A pinned 300vh scene with its animation disabled is just blank page.
 */
const ManifestoSection = () => {
  const track = useRef(null);
  const reduced = usePrefersReducedMotion();
  const step = useScrollScene(track, { steps: STEPS, enabled: !reduced, lead: 0.08, tail: 0.16 });

  if (reduced) {
    return (
      <section
        id="manifesto"
        aria-label="Well. We are not. But we can get you hired."
        className="ot-mf ot-mf--static scroll-mt-20 px-6 py-20 md:px-12"
      >
        <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
          {STATEMENTS.map((s) => (
            <Statement key={s.id} statement={s} state="on" stacked={false} />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section
      id="manifesto"
      ref={track}
      aria-label="Well. We are not. But we can get you hired."
      className="ot-mf relative"
      // Height is the scroll budget: one viewport per statement plus the
      // lead-in and hold the hook reserves at either end.
      style={{ height: `${STEPS * 100 + 40}vh` }}
    >
      <div className="ot-mf-stage sticky top-0 flex h-screen items-center overflow-hidden px-6 md:px-12">
        <p className="ot-mf-eyebrow" aria-hidden="true">
          About the chairs
        </p>
        <p className="ot-mf-count" aria-hidden="true">
          {String(step + 1).padStart(2, '0')} <span>/ {String(STEPS).padStart(2, '0')}</span>
        </p>

        <div className="mx-auto grid w-full max-w-[1100px]">
          {STATEMENTS.map((s, i) => (
            <Statement
              key={s.id}
              statement={s}
              state={i === step ? 'on' : i < step ? 'past' : 'future'}
            />
          ))}
        </div>

        <div className="ot-mf-rail" aria-hidden="true">
          {STATEMENTS.map((s, i) => (
            <span key={s.id} className={i <= step ? 'is-done' : undefined} />
          ))}
        </div>
      </div>
    </section>
  );
};

export default ManifestoSection;
