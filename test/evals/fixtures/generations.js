/**
 * Hand-labelled generated-text samples for the FabricationRate eval.
 *
 * Each sample is one sentence written the way the Answer Studio and cover
 * letter flows write: first person, one claim. `cv` names the fixture whose
 * corpus it is checked against, and `fabricated` is the human label — does
 * this sentence assert something the resume does not support?
 *
 * The fabricated cases are the ones that actually cost someone an interview:
 * an inflated headcount, an inflated metric, an employer that was never there,
 * a budget nobody managed. The faithful cases are close paraphrases of real
 * bullets, which is what the generator produces when it behaves — they exist
 * to hold the false-positive rate down, because a checker that flags honest
 * text gets ignored within a week.
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
];

export const FAITHFUL = GENERATIONS.filter((g) => !g.fabricated);
export const FABRICATED = GENERATIONS.filter((g) => g.fabricated);
