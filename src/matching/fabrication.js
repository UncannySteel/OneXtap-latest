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
 * ═══ WHAT GETS CHECKED, AND WHY NOT EVERYTHING ═══
 *
 * Whole-sentence similarity against a single corpus item is the wrong unit for
 * a cover letter. Letter prose is a blend of three things — CV facts, facts
 * taken from the job posting, and connective English — so no single CV bullet
 * scores highly against it. Scoring every sentence that way produced a 0.75
 * fabrication rate on a letter in which every sentence was true, with a HIGH
 * flag on "I am writing to apply for the <role> at <company>": the company came
 * from the POSTING, which a CV corpus can never contain, and the cover-letter
 * prompt requires naming it. The feature manufactured the flags it then raised.
 *
 * So there are two passes, in this order:
 *
 *   1. IS THIS SENTENCE A CLAIM ABOUT THE CANDIDATE?  A sentence that asserts
 *      candidate history, or that quantifies something, is checked. A pure
 *      addressing sentence ("I am writing to apply...", "Your posting
 *      mentions...", "I would welcome the chance...") asserts nothing a corpus
 *      could ground and is skipped — it never reaches a threshold and never
 *      enters `totalClaims`.
 *
 *   2. WHAT DOES IT ASSERT?  Numerals, named entities and known skills are the
 *      things an interviewer probes. A checked claim is flagged when it asserts
 *      one the corpus does not support. Similarity is the fallback for a
 *      checked claim carrying no hard entity at all, which is where a reworded
 *      but unsupported sentence still gets caught.
 *
 * The cost of pass 1 is stated plainly: an invented employer inside an
 * addressing-shaped sentence is not caught. Closing that needs the job posting
 * in the corpus, which is a change to the callers, not to this file.
 *
 * ZERO-IMPORT RULE: only sibling modules under `src/matching/`. See
 * `src/matching/index.js`.
 */

import { SKILL_LEXICON } from './lexicon.js';
import { asObject, jaccard, positiveIntOr, roundTo, tokenize, trigramSet } from './normalize.js';

/**
 * Tuning surface. Exported so the server can override from env without a code
 * change (and so the numbers appear once, not scattered through the logic).
 *
 * MIN_SIM is the ordinary bar. STRICT_SIM is much higher because the strict
 * class is where fabrication actually costs someone an interview. Claims below
 * MIN_CLAIM_TOKENS are dropped as fragments — "React." is not a claim, it is a
 * bullet header, and grading it produces noise.
 *
 * RELATED_SIM_RATIO governs the numeral gate: a corpus item counts as "what
 * this claim is about" when it scores within this fraction of the best-matching
 * item. See the gate itself for why that is not simply the best item.
 */
export const FAB_THRESHOLDS = {
  MIN_SIM: 0.62,
  STRICT_SIM: 0.85,
  MIN_CLAIM_TOKENS: 4,
  RELATED_SIM_RATIO: 0.6,
};

/**
 * Sentence end, or a bullet/newline.
 *
 * The lookbehind is load-bearing: without it a full stop inside `Acme Co.`,
 * `Ph.D.` or `e.g.` split one sentence into two orphaned fragments, and neither
 * half could be grounded against anything. It has to swallow the abbreviation's
 * OWN full stop — both lookbehinds sit at the same position, immediately after
 * that stop, so an alternation ending at `Inc` never matches the `Inc.` in
 * front of it and the guard silently does nothing.
 */
const CLAIM_SPLIT =
  /(?<!\b(?:Co|Inc|Ltd|LLC|Corp|Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr|vs|etc|Ph\.D|e\.g|i\.e|U\.S|U\.K)\.)(?<=[.!?])\s+|[\n\r•·▪●]+/;

const HAS_NUMBER = /\d/;
const HAS_YEAR = /\b(?:19|20)\d{2}\b/;
const HAS_PERCENT = /\d\s*%|\bpercent\b/i;
const HAS_CURRENCY = /[$€£¥]\s*\d|\b\d+(?:\.\d+)?\s*(?:k|m|bn|million|billion)\b/i;

/** Two or more adjacent capitalized words — a company, product or person. */
const PROPER_NOUN_RUN = /\b[A-Z][a-zA-Z]+\b(?:\s+[A-Z][a-zA-Z]+\b)+/g;

/** A capitalized run this long is a name even when it opens the sentence. */
const MIN_PROPER_NOUN_WORDS = 3;

/**
 * Capitalized words that begin a sentence rather than a name.
 *
 * `PROPER_NOUN_RUN` cannot tell a sentence-opening `At Bellcastle Media` apart
 * from the bare company name, so without this trim the claim asserts an entity
 * the corpus spells one word shorter, and a real employer reads as invented.
 */
const NAME_LEAD_STOPWORDS = new Set([
  'a', 'an', 'the', 'at', 'in', 'on', 'for', 'to', 'of', 'by', 'with', 'from',
  'and', 'but', 'so', 'as', 'my', 'our', 'their', 'his', 'her', 'its', 'this',
  'that', 'these', 'those', 'i', 'we', 'they', 'he', 'she', 'it', 'before',
  'after', 'during', 'since', 'while', 'when', 'where', 'both', 'later',
  'today', 'currently', 'previously', 'recently',
]);

const NUMERAL = /\d+(?:\.\d+)?/g;

/** A comma between a digit and a group of exactly three digits is a separator. */
const THOUSANDS_SEPARATOR = /(\d),(?=\d{3}\b)/g;

/**
 * A magnitude written as a suffix rather than as zeroes.
 *
 * `\b` after the suffix is what keeps "40 minutes" from reading as 40 million:
 * there is no word boundary between the `m` and the `inutes` that follows it.
 */
const SCALE_SUFFIX = /(\d+(?:\.\d+)?)\s*(k|m|bn|b|thousand|million|billion)\b/gi;

const SCALE_FACTORS = {
  k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9,
};

/**
 * Does this sentence assert candidate history?
 *
 * A first-person subject plus an achievement verb, within one clause of each
 * other. Deliberately not "any sentence containing 'I'" — "I am writing to
 * apply" and "I would welcome the chance" both contain it and assert nothing.
 */
const FIRST_PERSON_HISTORY =
  /\b(?:I|my|we|our)\b[^.!?]{0,80}?\b(?:led|lead|leads|leading|built|build|builds|shipped|ship|ships|grew|grow|grows|managed|manage|manages|owned|own|owns|designed|design|designs|delivered|deliver|delivers|raised|raise|raises|spent|spend|spends|worked|work|works|scaled|scale|scales|launched|launch|launches|reduced|reduce|reduces|increased|increase|increases|drove|drive|drives|ran|run|runs|architected|founded|found|founds|mentored|mentor|mentors|cut|cuts|onboarded|onboard|onboards|rebuilt|rebuild|rebuilds|maintained|maintain|maintains|reconciled|reconcile|reconciles|have|has|had)\b/i;

/**
 * Is this sentence addressing the employer rather than describing the candidate?
 *
 * These are the sentences the cover-letter prompt explicitly asks for — name the
 * company, name the role, reference the posting — and the ones a CV corpus can
 * never ground.
 */
const ADDRESSING =
  /\b(?:writing to apply|applying for|apply for|interested in|excited (?:about|to)|your posting|your team|your company|the [^.!?]{0,40}?role at|this (?:role|position|opportunity)|look forward|would welcome|thank you|dear\b)/i;

/**
 * A sentence in the resume-bullet voice: an achievement verb with no subject.
 *
 * "Migrated the deployment pipeline to Docker." is a claim about the candidate
 * even though it never says "I" — that is how bullets and Answer Studio output
 * are written, and a first-person test alone would exempt the entire shape.
 * `-ed`/`-ing` covers the regular verbs; the alternation is the irregulars that
 * actually open bullets.
 */
const BULLET_VERB_START =
  /^\s*(?:[A-Z][a-z]+(?:ed|ing)\b|(?:Led|Built|Grew|Ran|Drove|Won|Cut|Set|Kept|Sold|Wrote|Rebuilt|Oversaw|Took|Made|Broke|Spent|Held|Brought|Began)\b)/;

/** Any digit or currency mark — a sentence that quantifies is always checkable. */
const QUANTIFIES = /[\d$€£¥]/;

/** Decimals kept on a reported similarity or rate. */
const SIMILARITY_DECIMALS = 4;

/**
 * Expand magnitude suffixes so "$1.2M" and "$1,200,000" compare equal.
 *
 * Without this the thousands-separator strip below makes the mismatch WORSE,
 * not better: the claim yields "1.2" and the CV yields "1200000", so a
 * perfectly grounded achievement is reported as a high-severity fabrication.
 * Bare cardinal words ("twelve million") are deliberately NOT folded — "one of
 * the", "first" and "second" are far more common in this text than spelled-out
 * magnitudes, and folding them invents numerals nobody wrote.
 *
 * @param {string} text Already a string.
 * @returns {string} Same text with `1.2M` rewritten as `1200000`.
 */
function expandScales(text) {
  return text.replace(SCALE_SUFFIX, (whole, digits, suffix) => {
    const factor = SCALE_FACTORS[suffix.toLowerCase()];
    const value = Number(digits) * factor;
    return Number.isFinite(value) ? String(Math.round(value)) : whole;
  });
}

/**
 * Numeric literals asserted by a piece of text, normalized so that the same
 * quantity written two ways compares equal.
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
  return expandScales(text).replace(THOUSANDS_SEPARATOR, '$1').match(NUMERAL) ?? [];
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
 * The fragment floor counts numerals alongside tokens. It has to: `tokenize`
 * discards numeric-only tokens, so "Raised $9M in 2021." counted three and was
 * dropped unchecked — the terser and more quantified a claim was, the likelier
 * it was exempted, which inverted the whole point of the floor.
 *
 * @param {unknown} text Generated prose or bullets; non-strings yield `[]`.
 * @param {{minClaimTokens?: number}} [options] Override the fragment floor.
 * @returns {string[]} Claims with original casing and punctuation preserved —
 *   `isStrictClaim` and `isCheckableClaim` both need the capitalization, so
 *   this must not normalize.
 */
export function segmentClaims(text, options = {}) {
  if (typeof text !== 'string' || !text.trim()) return [];
  const floor = positiveIntOr(asObject(options).minClaimTokens, FAB_THRESHOLDS.MIN_CLAIM_TOKENS);

  return text
    .split(CLAIM_SPLIT)
    .map((claim) => (typeof claim === 'string' ? claim.trim() : ''))
    .filter((claim) => claim.length > 0
      && tokenize(claim).length + numeralsOf(claim).length >= floor);
}

/**
 * Is this sentence a claim about the candidate at all?
 *
 * Pass 1 of the two-pass design described in the file header. A sentence
 * qualifies when it asserts candidate history — in either the first-person
 * voice a letter uses or the subjectless voice a bullet uses — or when it
 * quantifies something. A sentence that only addresses the employer does not.
 *
 * The `quantifies` half is load-bearing rather than belt-and-braces: without it
 * "Raised $9M in 2021." has no first-person subject and would be skipped, and
 * that is precisely the shape of the highest-risk fabrication.
 *
 * @param {unknown} claim Claim text WITH original casing.
 * @returns {boolean}
 */
export function isCheckableClaim(claim) {
  if (typeof claim !== 'string' || !claim) return false;
  const quantifies = QUANTIFIES.test(claim);
  const asserts = FIRST_PERSON_HISTORY.test(claim) || BULLET_VERB_START.test(claim);
  if (!quantifies && !asserts) return false;
  // Addressing wins over a history verb ("...which is where I have spent the
  // last four years" is still an answer to the posting), but never over a
  // number: a figure quoted at an employer is still a figure being asserted.
  if (!quantifies && ADDRESSING.test(claim)) return false;
  return true;
}

/**
 * The checkable things a piece of text asserts: numerals, named entities and
 * known skills.
 *
 * Prefixed by kind so a company called "Python" cannot be grounded by the
 * skill, and so the sets stay debuggable when a flag is inspected.
 *
 * @param {unknown} text Any input; non-strings yield an empty set.
 * @returns {Set<string>} Prefixed entity keys: `#`numeral, `@`name, `$`skill.
 */
export function entitiesOf(text) {
  const out = new Set();
  if (typeof text !== 'string' || !text) return out;

  for (const numeral of numeralsOf(text)) out.add(`#${numeral}`);

  for (const match of text.matchAll(PROPER_NOUN_RUN)) {
    // Trailing punctuation would make "Kestrel Analytics." and "Kestrel
    // Analytics" two different entities, and the claim side almost always
    // carries the full stop.
    const words = match[0].trim().replace(/[.,;:!?]+$/, '').toLowerCase().split(/\s+/);
    while (words.length > 0 && NAME_LEAD_STOPWORDS.has(words[0])) words.shift();
    // Two words minimum, as before the trim. A single surviving word is not
    // reliably a name — "In Python" would otherwise assert an entity that the
    // corpus, which holds Python as a SKILL, could never ground.
    if (words.length >= 2) out.add(`@${words.join(' ')}`);
  }

  for (const token of tokenize(text)) if (SKILL_LEXICON.has(token)) out.add(`$${token}`);

  return out;
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
 *   similarity: number, threshold: number, severity: 'high'|'medium',
 *   ungrounded: string[]}>,
 *   rate: number, totalClaims: number}} `totalClaims` counts CHECKABLE claims
 *   only, so `rate` describes the claims that were actually graded. It is 0
 *   when there are none — never NaN, because this number goes straight into a
 *   UI badge.
 */
export function validateAgainstCorpus(generatedText, corpus, options = {}) {
  const opts = asObject(options);
  const minSim = Number.isFinite(opts.minSim) ? opts.minSim : FAB_THRESHOLDS.MIN_SIM;
  const strictSim = Number.isFinite(opts.strictSim) ? opts.strictSim : FAB_THRESHOLDS.STRICT_SIM;

  const claims = segmentClaims(generatedText, opts).filter(isCheckableClaim);
  if (claims.length === 0) return { flags: [], rate: 0, totalClaims: 0 };

  const items = Array.isArray(corpus) ? corpus : [];
  const checkNumerals = opts.requireGroundedNumerals !== false;

  // Every entity the corpus supports, pooled. Names and skills are safe to pool
  // — a company or a tool named anywhere on the CV is one the candidate may
  // write about anywhere in a letter.
  //
  // NUMERALS ARE NOT POOLED. "I mentored 12 junior engineers" against a CV
  // saying 3 is a near-verbatim copy, so similarity cannot catch it — that is
  // the whole reason this gate exists — and pooling grounds the 12 from an
  // unrelated bullet about 12 partner data feeds. A numerate CV (dates,
  // percentages, headcounts, versions) saturates a pooled set and disarms the
  // gate completely. So a numeral is checked against the items this claim is
  // actually about; see `relatedItems` below.
  const groundedNames = new Set();
  for (const item of items) {
    for (const entity of entitiesOf(itemText(item))) {
      if (!entity.startsWith('#')) groundedNames.add(entity);
    }
  }

  const flags = [];

  for (const claim of claims) {
    const scored = [];
    let best = 0;
    let bestItem = null;
    for (const item of items) {
      const score = similarity(claim, item);
      scored.push({ item, score });
      if (score > best) {
        best = score;
        bestItem = item;
      }
    }

    // The items this claim is about: the best match, plus anything scoring
    // close to it. Not the single best item alone — one sentence legitimately
    // draws on a title and its bullet, and a strict best-only rule would call
    // the second one's numerals invented.
    const floor = best * FAB_THRESHOLDS.RELATED_SIM_RATIO;
    const relatedNumerals = new Set();
    if (checkNumerals) {
      for (const { item, score } of scored) {
        if (item === bestItem || (best > 0 && score >= floor)) {
          for (const numeral of numeralsOf(itemText(item))) relatedNumerals.add(numeral);
        }
      }
    }

    const claimEntities = entitiesOf(claim);
    const ungrounded = [];
    for (const entity of claimEntities) {
      if (entity.startsWith('#')) {
        if (checkNumerals && !relatedNumerals.has(entity.slice(1))) ungrounded.push(entity);
      } else if (!groundedNames.has(entity)) {
        ungrounded.push(entity);
      }
    }

    const strict = isStrictClaim(claim);
    const threshold = strict ? strictSim : minSim;

    // Entity grounding is authoritative when the claim asserts entities at all.
    // Similarity is the fallback for a checked claim that asserts none, which is
    // where a reworded but unsupported sentence is still caught. Running both
    // unconditionally is what flagged "I work in React, TypeScript and
    // Storybook every day": three one-word corpus items, so whole-sentence
    // similarity against any single one of them is structurally near zero.
    const passes = claimEntities.size > 0 ? ungrounded.length === 0 : best >= threshold;
    if (passes) continue;

    flags.push({
      claim,
      nearestRef: bestItem && typeof bestItem === 'object' ? bestItem.ref ?? null : null,
      nearestText: itemText(bestItem),
      similarity: roundTo(best, SIMILARITY_DECIMALS),
      threshold,
      severity: strict ? 'high' : 'medium',
      ungrounded,
    });
  }

  return {
    flags,
    rate: roundTo(flags.length / claims.length, SIMILARITY_DECIMALS),
    totalClaims: claims.length,
  };
}
