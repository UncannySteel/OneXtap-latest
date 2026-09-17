/**
 * Deterministic fabrication check for generated CV / cover-letter text.
 *
 * Every claim in the generated text is diffed against the user's own corpus
 * (see `src/corpus.js`). Nothing here calls a model: an LLM asked to grade its
 * own output is exactly the wrong tool, and this has to run on the server
 * budget-free and identically every time.
 *
 * Node has no `difflib`, so the string-similarity equivalent is implemented
 * here out of the primitives in `./normalize.js`.
 *
 * ZERO-IMPORT RULE: only sibling modules under `src/matching/`. See
 * `src/matching/index.js`.
 */

import { asObject, jaccard, positiveIntOr, roundTo, tokenize, trigramSet } from './normalize.js';

/**
 * Tuning surface. Exported so the server can override from env without a code
 * change (and so the numbers appear once, not scattered through the logic).
 *
 * MIN_SIM is the ordinary bar. STRICT_SIM is much higher because the strict
 * class is where fabrication actually costs someone an interview. Claims below
 * MIN_CLAIM_TOKENS are dropped as fragments — "React." is not a claim, it is a
 * bullet header, and grading it produces noise.
 */
export const FAB_THRESHOLDS = {
  MIN_SIM: 0.62,
  STRICT_SIM: 0.85,
  MIN_CLAIM_TOKENS: 4,
};

/** Sentence end, or a bullet/newline. */
const CLAIM_SPLIT = /(?<=[.!?])\s+|[\n\r•·▪●]+/;

const HAS_NUMBER = /\d/;
const HAS_YEAR = /\b(?:19|20)\d{2}\b/;
const HAS_PERCENT = /\d\s*%|\bpercent\b/i;
const HAS_CURRENCY = /[$€£¥]\s*\d|\b\d+(?:\.\d+)?\s*(?:k|m|bn|million|billion)\b/i;

/** Two or more adjacent capitalized words — a company, product or person. */
const PROPER_NOUN_RUN = /\b[A-Z][a-zA-Z]+\b(?:\s+[A-Z][a-zA-Z]+\b)+/g;

/** A capitalized run this long is a name even when it opens the sentence. */
const MIN_PROPER_NOUN_WORDS = 3;

const NUMERAL = /\d+(?:\.\d+)?/g;

/** A comma between a digit and a group of exactly three digits is a separator. */
const THOUSANDS_SEPARATOR = /(\d),(?=\d{3}\b)/g;

/** Decimals kept on a reported similarity or rate. */
const SIMILARITY_DECIMALS = 4;

/**
 * Numeric literals asserted by a piece of text, thousands separators removed
 * so "12,000" and "12000" compare equal.
 *
 * `tokenize` deliberately drops pure numbers as noise, which is right for skill
 * matching and catastrophic here — it makes "a team of 40" and "a team of 4"
 * look identical. Numerals are therefore tracked separately.
 *
 * @param {unknown} text Any input; non-strings yield `[]`.
 * @returns {string[]} Numerals in document order, with duplicates.
 */
function numeralsOf(text) {
  if (typeof text !== 'string' || !text) return [];
  return text.replace(THOUSANDS_SEPARATOR, '$1').match(NUMERAL) ?? [];
}

/**
 * Read the text out of a corpus item, accepting a bare string as well.
 * @param {unknown} item A CorpusItem, a plain string, or junk.
 * @returns {string} `''` when there is no usable text.
 */
function itemText(item) {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object' && typeof item.text === 'string') return item.text;
  return '';
}

/**
 * Split generated text into independently checkable claim units.
 *
 * @param {unknown} text Generated prose or bullets; non-strings yield `[]`.
 * @param {{minClaimTokens?: number}} [options] Override the fragment floor.
 * @returns {string[]} Claims with original casing and punctuation preserved —
 *   `isStrictClaim` needs the capitalization, so this must not normalize.
 */
export function segmentClaims(text, options = {}) {
  if (typeof text !== 'string' || !text.trim()) return [];
  const floor = positiveIntOr(asObject(options).minClaimTokens, FAB_THRESHOLDS.MIN_CLAIM_TOKENS);

  return text
    .split(CLAIM_SPLIT)
    .map((claim) => claim.trim())
    .filter((claim) => claim.length > 0 && tokenize(claim).length >= floor);
}

/**
 * How well one corpus item supports one claim.
 *
 * `max(containment, trigramJaccard)`, not the average, and deliberately so: a
 * faithful one-line paraphrase of a long CV bullet has near-total token
 * CONTAINMENT but poor trigram overlap (the bullet is much longer, so the
 * union swamps the intersection), while a reworded claim that reuses the
 * bullet's phrasing scores the reverse. Averaging would fail both. Taking the
 * max means either kind of evidence is enough to call the claim grounded.
 *
 * @param {unknown} claim Claim text.
 * @param {unknown} corpusItem A CorpusItem or a plain string.
 * @returns {number} In [0,1]; 0 when either side is empty.
 */
export function similarity(claim, corpusItem) {
  const claimText = typeof claim === 'string' ? claim : '';
  const claimTokens = new Set([...tokenize(claimText), ...numeralsOf(claimText)]);
  const reference = itemText(corpusItem);
  if (claimTokens.size === 0 || !reference) return 0;

  const referenceTokens = new Set([...tokenize(reference), ...numeralsOf(reference)]);
  let hits = 0;
  for (const token of claimTokens) if (referenceTokens.has(token)) hits += 1;
  const containment = hits / claimTokens.size;

  return Math.max(containment, jaccard(trigramSet(claimText), trigramSet(reference)));
}

/**
 * Does this claim assert something checkable and specific?
 *
 * Numbers, years, percentages, money amounts and named entities are what an
 * interviewer will actually probe. "Led a team of 40" when the CV says 4 is a
 * career problem; "collaborated closely with colleagues" is not. Strict claims
 * therefore have to clear `STRICT_SIM` rather than `MIN_SIM`.
 *
 * @param {unknown} claim Claim text WITH original casing.
 * @returns {boolean}
 */
export function isStrictClaim(claim) {
  if (typeof claim !== 'string' || !claim) return false;
  if (HAS_NUMBER.test(claim) || HAS_YEAR.test(claim) || HAS_PERCENT.test(claim) || HAS_CURRENCY.test(claim)) {
    return true;
  }
  // `matchAll` is used rather than a manual `exec` loop because it iterates a
  // clone: PROPER_NOUN_RUN is a /g regex, and an early return out of an `exec`
  // loop leaves `lastIndex` mid-string, so the NEXT call silently starts from
  // the middle of a different claim.
  for (const match of claim.matchAll(PROPER_NOUN_RUN)) {
    // A capitalized pair at position 0 is usually just a sentence opening
    // ("Built dashboards..."), so require it to be mid-claim or three words long.
    const words = match[0].split(/\s+/).length;
    if (match.index > 0 || words >= MIN_PROPER_NOUN_WORDS) return true;
  }
  return false;
}

/**
 * Check generated text against the user's own corpus and report every claim it
 * cannot ground.
 *
 * Flags are RETURNED, never auto-retried. A silent regenerate-until-clean loop
 * hides the failure from the user, burns credits, and converges on bland text;
 * the caller decides whether to warn, redact, or regenerate, and the user sees
 * that it happened.
 *
 * @param {unknown} generatedText The model output to validate.
 * @param {Array<{ref?: string, text?: string}|string>} corpus Items from `buildCorpus`.
 * @param {{minSim?: number, strictSim?: number, minClaimTokens?: number,
 *   requireGroundedNumerals?: boolean}} [options] Set
 *   `requireGroundedNumerals: false` to disable the numeral gate described below.
 * @returns {{flags: Array<{claim: string, nearestRef: string|null, nearestText: string,
 *   similarity: number, threshold: number, severity: 'high'|'medium'}>,
 *   rate: number, totalClaims: number}} `rate` is 0 when there are no claims —
 *   never NaN, because this number goes straight into a UI badge.
 */
export function validateAgainstCorpus(generatedText, corpus, options = {}) {
  const opts = asObject(options);
  const minSim = Number.isFinite(opts.minSim) ? opts.minSim : FAB_THRESHOLDS.MIN_SIM;
  const strictSim = Number.isFinite(opts.strictSim) ? opts.strictSim : FAB_THRESHOLDS.STRICT_SIM;

  const claims = segmentClaims(generatedText, opts);
  if (claims.length === 0) return { flags: [], rate: 0, totalClaims: 0 };

  const items = Array.isArray(corpus) ? corpus : [];
  const checkNumerals = opts.requireGroundedNumerals !== false;

  // Every number anywhere in the corpus. A fuzzy similarity score can never
  // catch "a team of 40" against "a team of 4" — the two strings differ by one
  // character, so containment and trigram overlap both stay near 1.0 — yet that
  // single digit is the entire fabrication. So numerals get their own gate: a
  // number the CV never states is ungrounded no matter how well the sentence
  // around it matches.
  const corpusNumerals = new Set();
  if (checkNumerals) {
    for (const item of items) for (const numeral of numeralsOf(itemText(item))) corpusNumerals.add(numeral);
  }

  const flags = [];

  for (const claim of claims) {
    let best = 0;
    let bestItem = null;
    for (const item of items) {
      const score = similarity(claim, item);
      if (score > best) {
        best = score;
        bestItem = item;
      }
    }
    const strict = isStrictClaim(claim);
    const threshold = strict ? strictSim : minSim;
    const ungroundedNumeral = checkNumerals
      && numeralsOf(claim).some((numeral) => !corpusNumerals.has(numeral));
    if (best >= threshold && !ungroundedNumeral) continue;
    flags.push({
      claim,
      nearestRef: bestItem && typeof bestItem === 'object' ? bestItem.ref ?? null : null,
      nearestText: itemText(bestItem),
      similarity: roundTo(best, SIMILARITY_DECIMALS),
      threshold,
      severity: strict ? 'high' : 'medium',
    });
  }

  return {
    flags,
    rate: roundTo(flags.length / claims.length, SIMILARITY_DECIMALS),
    totalClaims: claims.length,
  };
}
