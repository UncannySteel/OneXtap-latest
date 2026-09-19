/**
 * Scoring helpers shared by the eval metrics.
 *
 * Pure functions, no I/O, no network, no logging — the metrics decide what to
 * report and how loudly. Everything here must run with no environment at all,
 * because the two deterministic evals are meant to be a CI gate and a gate
 * that needs an API key is a gate that gets deleted.
 */

/** Case- and whitespace-insensitive comparison. Nothing else is normalized. */
export function norm(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Digits only — the one honest way to compare two written phone numbers. */
export function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '');
}

/**
 * Read a dotted path out of a nested object. Numeric segments index arrays.
 * @param {unknown} root
 * @param {string} path e.g. `experience.0.company`
 * @returns {unknown} undefined when any segment is missing.
 */
export function at(root, path) {
  let node = root;
  for (const segment of path.split('.')) {
    if (node === null || node === undefined) return undefined;
    node = node[segment];
  }
  return node;
}

/**
 * F1 over two lists treated as sets, so a parse is punished both for missing a
 * skill the CV lists and for inventing one it does not. Recall alone would
 * score a parser that returns every skill in the lexicon at 1.0.
 *
 * @param {unknown[]} expected
 * @param {unknown[]} actual
 * @returns {number} In [0,1]. Two empty lists agree, so that is 1.
 */
export function setF1(expected, actual) {
  const want = new Set((Array.isArray(expected) ? expected : []).map(norm).filter(Boolean));
  const got = new Set((Array.isArray(actual) ? actual : []).map(norm).filter(Boolean));
  if (want.size === 0 && got.size === 0) return 1;
  if (want.size === 0 || got.size === 0) return 0;

  let hits = 0;
  for (const item of want) if (got.has(item)) hits += 1;
  if (hits === 0) return 0;

  const precision = hits / got.size;
  const recall = hits / want.size;
  return (2 * precision * recall) / (precision + recall);
}

/**
 * The fields ProfileFieldAccuracy grades, and how each one is compared.
 *
 * This list is the metric's definition, so it is written out rather than
 * derived: an accuracy number is meaningless unless you can see exactly which
 * fields went into it. These are the ones that end up typed into an
 * application form, which is why `summary` and bullet text are absent — they
 * are prose, and grading prose by string equality measures nothing.
 */
export const GRADED_FIELDS = [
  { path: 'firstName' },
  { path: 'lastName' },
  { path: 'email' },
  { path: 'phone', kind: 'phone' },
  { path: 'currentJob.title' },
  { path: 'experience.0.company' },
  { path: 'experience.0.title' },
  { path: 'experience.0.startDate' },
  { path: 'experience.0.endDate' },
  { path: 'education.0.school' },
  { path: 'education.0.degree' },
  { path: 'education.0.field' },
  { path: 'skills', kind: 'set' },
];

/**
 * Score one recorded parse against its hand-written labels.
 *
 * Every field carries equal weight — a wrong email and a wrong end date are
 * both one field. Weighting them would mean defending the weights, and the
 * per-field breakdown is right there for anyone who disagrees.
 *
 * @param {object} parsed Recorded parser output.
 * @param {object} labels Hand-labelled ground truth.
 * @returns {{score: number, earned: number, total: number,
 *   fields: Array<{path: string, score: number, expected: unknown, actual: unknown}>}}
 */
export function scoreProfileFields(parsed, labels) {
  const fields = GRADED_FIELDS.map(({ path, kind }) => {
    const expected = at(labels, path);
    const actual = at(parsed, path);
    let score;
    if (kind === 'set') score = setF1(expected, actual);
    else if (kind === 'phone') score = digitsOnly(expected) === digitsOnly(actual) ? 1 : 0;
    else score = norm(expected) === norm(actual) ? 1 : 0;
    return { path, score, expected, actual };
  });

  const earned = fields.reduce((sum, f) => sum + f.score, 0);
  const total = fields.length;
  return { score: total === 0 ? 0 : earned / total, earned, total, fields };
}

/** Fixed-decimal rendering so diagnostic lines line up and diff cleanly. */
export function pct(value) {
  return `${(Number(value) * 100).toFixed(1)}%`;
}

/**
 * Spearman rank correlation between two equal-length numeric lists.
 *
 * ═══ WHY RANK CORRELATION IS THE HEADLINE CALIBRATION METRIC ═══
 *
 * Job Matches renders an ORDERED list. A model that scores every job ten points
 * lower than the reference produces exactly the same page, and a mean-error
 * metric would call that a regression. Rank correlation calls it what it is:
 * identical. It moves only when the model disagrees about which job is the
 * better fit, which is the only disagreement a user can see in the ordering.
 *
 * Ties are handled by average ranking, so a model that returns one score for
 * everything correlates near zero rather than accidentally scoring well.
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} -1..1, or NaN when there are fewer than two usable pairs.
 */
export function spearman(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length < 2) return NaN;

  const rank = (xs) => {
    const order = xs.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
    const ranks = new Array(xs.length);
    let i = 0;
    while (i < order.length) {
      let j = i;
      while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j += 1;
      // Average rank across a tie group, 1-based.
      const shared = (i + j) / 2 + 1;
      for (let k = i; k <= j; k += 1) ranks[order[k][1]] = shared;
      i = j + 1;
    }
    return ranks;
  };

  const ra = rank(a);
  const rb = rank(b);
  const n = ra.length;
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ma = mean(ra);
  const mb = mean(rb);

  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    const x = ra[i] - ma;
    const y = rb[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  // Zero variance on either side means one list is constant: undefined, not 1.
  if (da === 0 || db === 0) return NaN;
  return num / Math.sqrt(da * db);
}

/**
 * Share of items two scorers place on the SAME side of a threshold.
 *
 * This is the metric that predicts what a user actually sees, because both
 * thresholds in the product are absolute cuts: the graph gates on GOOD_SCORE
 * and the user filters at 50/70/85. Two scorers can correlate perfectly and
 * still disagree about every one of those cuts if one is uniformly optimistic.
 *
 * @param {number[]} actual
 * @param {number[]} expected
 * @param {number} threshold
 * @returns {number} 0..1, or NaN when there is nothing to compare.
 */
export function thresholdAgreement(actual, expected, threshold) {
  if (!Array.isArray(actual) || !Array.isArray(expected) || actual.length !== expected.length) return NaN;
  if (actual.length === 0) return NaN;
  let agree = 0;
  for (let i = 0; i < actual.length; i += 1) {
    if ((actual[i] >= threshold) === (expected[i] >= threshold)) agree += 1;
  }
  return agree / actual.length;
}

/** Mean absolute difference between two equal-length numeric lists. */
export function meanAbsError(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return NaN;
  return a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;
}
