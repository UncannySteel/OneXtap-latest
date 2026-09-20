/**
 * Hand-labelled generated-text samples for the FabricationRate eval.
 *
 * Each sample carries `cv` — the fixture whose corpus it is checked against —
 * and `fabricated`, the human label: does this text assert something the resume
 * does not support?
 *
 * ═══ TWO SHAPES, AND WHY THE SECOND ONE EXISTS ═══
 *
 * The original samples are single first-person sentences, one claim each, the
 * way Answer Studio writes. That shape alone left the gate blind to the shape
 * the COVER LETTER flow actually produces, and the validator scored 0.75
 * fabrication rate on a letter in which every sentence was true — a HIGH flag
 * on the opening line, because `CoverLetterPanel.jsx` instructs the model to
 * name the company and role and the corpus is built from the CV alone, where a
 * name taken from the POSTING can never appear.
 *
 * So the second shape is cover-letter prose: salutations, an intent sentence,
 * a reference to the posting, a multi-skill summary, an employment date. These
 * are the sentences a real letter is mostly made of, and none of them is a
 * claim about the candidate's history that a corpus could ground. They must not
 * be flagged. A checker that flags honest text gets ignored within a week, and
 * then the real flags go unread too — which is the failure this whole file
 * exists to prevent.
 *
 * The fabricated cases are the ones that actually cost someone an interview: an
 * inflated headcount, an inflated metric, an employer that was never there, a
 * budget nobody managed. Two of them are deliberately adversarial:
 * `de-fab-headcount-collision` inflates a headcount to a digit that appears
 * ELSEWHERE in the same CV, and `ops-fab-short-metric` is short enough to fall
 * under the claim-token floor. Both used to pass clean.
 *
 * Fabricated samples stay single-sentence on purpose. A multi-sentence
 * fabricated letter would dilute `MIN_FABRICATED_POOL_RATE` with its own
 * truthful sentences and make the pooled gate measure letter composition rather
 * than detection.
 *
 * Unit canonicalization ($1.2M against $1,200,000) is NOT exercised here — none
 * of the three CV fixtures states a currency amount, and editing one to add a
 * money figure would perturb ProfileFieldAccuracy's recorded parses. That case
 * lives in test/matching/fabrication.test.js instead.
 *
 * Invented employers only; see the header of ./cvs.js.
 */

/** @type {Array<{id: string, cv: string, fabricated: boolean, text: string, why: string}>} */
export const GENERATIONS = [
  // --- Faithful: close paraphrases of real bullets -------------------------
  {
    id: 'de-faithful-pipeline',
    cv: 'data-engineer',
    fabricated: false,
    text: 'I rebuilt the nightly inventory pipeline, cutting its runtime from 6 hours to 40 minutes.',
    why: 'Verbatim claim from the resume; both numerals are grounded.',
  },
  {
    id: 'de-faithful-mentoring',
    cv: 'data-engineer',
    fabricated: false,
    text: 'I mentored 3 junior engineers through their first on-call rotation.',
    why: 'Grounded headcount, grounded bullet.',
  },
  {
    id: 'de-faithful-airflow',
    cv: 'data-engineer',
    fabricated: false,
    text: 'I owned the Airflow deployment running 180 scheduled DAGs.',
    why: 'Named tool and figure both appear in the resume.',
  },
  {
    id: 'fe-faithful-library',
    cv: 'frontend',
    fabricated: false,
    text: 'I shipped a component library now used by 9 product teams.',
    why: 'Grounded count, grounded bullet.',
  },
  {
    id: 'fe-faithful-vite',
    cv: 'frontend',
    fabricated: false,
    text: 'I led the migration from Webpack to Vite.',
    why: 'No numbers; every token is in the resume.',
  },
  {
    id: 'ops-faithful-disputes',
    cv: 'operations',
    fabricated: false,
    text: 'I cut average dispute resolution time from 9 days to 4 days.',
    why: 'Both figures grounded.',
  },
  {
    id: 'ops-faithful-carriers',
    cv: 'operations',
    fabricated: false,
    text: 'I reconciled shipment exceptions across 5 regional carriers.',
    why: 'Grounded count, grounded bullet.',
  },

  // --- Faithful: the cover-letter shape ------------------------------------
  // Every sentence below is true. None may be flagged.
  {
    id: 'de-faithful-letter-opener',
    cv: 'data-engineer',
    fabricated: false,
    text: 'I am writing to apply for the Staff Data Engineer role at Halcyon Grocery.',
    why: 'Addresses the employer; asserts nothing about the candidate. The company '
      + 'and role come from the POSTING, so no CV corpus can ever ground them — and '
      + 'the cover-letter prompt requires naming both.',
  },
  {
    id: 'de-faithful-letter-jdref',
    cv: 'data-engineer',
    fabricated: false,
    text: 'Your posting mentions Kafka and dbt, and I have worked with both in production.',
    why: 'References the job description. Kafka and dbt are both on the resume; the '
      + 'sentence asserts no specific, checkable fact beyond them.',
  },
  {
    id: 'fe-faithful-skills-summary',
    cv: 'frontend',
    fabricated: false,
    text: 'I work in React, TypeScript and CSS every day.',
    why: 'Three skills, each its own one-word corpus item, so whole-sentence '
      + 'similarity against any SINGLE item is structurally low. Nothing is claimed '
      + 'that the resume does not list. Storybook would have been the fourth, and is '
      + 'deliberately NOT used here: this CV\'s recorded parse drops it (see ./cvs.js), '
      + 'so the corpus genuinely lacks it and a flag would be correct. The validator '
      + 'grounds against the PARSE, not the resume text — a skill the parser misses '
      + 'reads as invented, which is a parser-layer problem and not this gate\'s to fix.',
  },
  {
    id: 'ops-faithful-dates',
    cv: 'operations',
    fabricated: false,
    text: 'I have led operations at Pellorin Marketplace since 2022.',
    why: 'Employer and start year are both on the resume — but buildCorpus put the '
      + 'dates in `meta` and never in the item text, so the year was ungrounded by '
      + 'construction.',
  },
  {
    id: 'fe-faithful-letter-full',
    cv: 'frontend',
    fabricated: false,
    text: 'I am writing to apply for the Senior Frontend Engineer role at Halcyon Grocery. '
      + 'Your posting mentions design systems and accessibility, which is where I have '
      + 'spent the last four years. At Bellcastle Media I shipped a component library now '
      + 'used by 9 product teams and led the migration from Webpack to Vite. '
      + 'I would welcome the chance to discuss the role with your team.',
    why: 'A whole letter, every sentence true, its only numeral copied from the resume. '
      + 'This is the headline regression: it scored rate 0.75 with a HIGH flag on the '
      + 'opening line.',
  },

  // --- Fabricated: the failures that matter --------------------------------
  {
    id: 'de-fab-headcount',
    cv: 'data-engineer',
    fabricated: true,
    text: 'I led a team of 30 engineers rebuilding the nightly inventory pipeline.',
    why: 'Inflated headcount: the resume says 3 juniors mentored, never a team of 30.',
  },
  {
    id: 'de-fab-scale',
    cv: 'data-engineer',
    fabricated: true,
    text: 'I owned the Airflow deployment running 1,800 scheduled DAGs.',
    why: 'Order-of-magnitude inflation of a real figure (180).',
  },
  {
    id: 'fe-fab-metric',
    cv: 'frontend',
    fabricated: true,
    text: 'I raised Lighthouse accessibility scores from 71 to 99 across the marketing site.',
    why: 'Real bullet, inflated endpoint: the resume says 96.',
  },
  {
    id: 'fe-fab-employer',
    cv: 'frontend',
    fabricated: true,
    text: 'I spent my early career at Kirren Robotics building their internal design system.',
    why: 'Employer that appears nowhere in the resume.',
  },
  {
    id: 'ops-fab-budget',
    cv: 'operations',
    fabricated: true,
    text: 'I managed a $4m logistics budget across the Pellorin Marketplace supplier network.',
    why: 'Real employer, invented budget — nothing in the resume mentions money.',
  },
  {
    id: 'ops-fab-suppliers',
    cv: 'operations',
    fabricated: true,
    text: 'I onboarded 480 suppliers in the first year without adding headcount.',
    why: 'One digit away from the truth (48), which is exactly what a similarity score alone misses.',
  },

  // --- Fabricated: the two that used to pass clean --------------------------
  {
    id: 'de-fab-headcount-collision',
    cv: 'data-engineer',
    fabricated: true,
    text: 'I mentored 12 junior engineers through their first on-call rotation.',
    why: 'ADVERSARIAL, and the sharpest case in the file. Near-verbatim copy of a real '
      + 'bullet with ONLY the headcount swapped: the resume says 3. Similarity cannot '
      + 'catch it — the sentences are almost identical, which is the whole reason the '
      + 'numeral gate exists. And the gate misses it too, because "12" does appear on '
      + 'the resume, in an unrelated bullet about 12 partner data feeds. A gate pooled '
      + 'across the whole corpus grounds the wrong number; it has to be per-item.',
  },
  {
    id: 'ops-fab-short-metric',
    cv: 'operations',
    fabricated: true,
    text: 'Raised $9M in 2021.',
    why: 'ADVERSARIAL. Pure invention — no money and no 2021 anywhere on the resume. '
      + 'It was never even checked: the claim-token floor counts tokens AFTER numerals '
      + 'are discarded, so the terser and more quantified a claim is, the likelier it '
      + 'is exempted. The highest-risk sentences were the ones being skipped.',
  },
  {
    id: 'fe-fab-skill-claim',
    cv: 'frontend',
    fabricated: true,
    text: 'I have run production Kubernetes and Terraform clusters at Bellcastle Media.',
    why: 'Real employer, two tools the resume never lists — the shape a letter takes '
      + 'when it stretches to match a job description.',
  },
];

export const FAITHFUL = GENERATIONS.filter((g) => !g.fabricated);
export const FABRICATED = GENERATIONS.filter((g) => g.fabricated);
