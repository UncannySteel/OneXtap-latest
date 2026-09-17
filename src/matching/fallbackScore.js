/**
 * Deterministic fallback match scorer — the degraded path used when the LLM is
 * unavailable, rate-limited, or the user has no credits.
 *
 * Pure and deterministic by contract: no `Date.now()`, no randomness, no I/O.
 * The same resume and the same job must produce the same number forever, or a
 * user watching their dashboard sees scores drift for no reason.
 *
 * ZERO-IMPORT RULE: only sibling modules under `src/matching/`. See
 * `src/matching/index.js`.
 */

import { asObject, clamp01, compareStrings, positiveIntOr, roundTo } from './normalize.js';
import { detectSeniority } from './lexicon.js';
import { asResumeProfile, normalizeJobKeywords, titleOverlap } from './prefilter.js';

/**
 * Tuning surface for the fallback score. Exported so changing the balance is a
 * one-line edit in one place rather than a hunt through the arithmetic.
 *
 * REQUIRED/NICE split the coverage term; COVERAGE/TITLE/SENIORITY split the
 * final score. Coverage dominates because a skills match is the only thing here
 * that actually predicts an interview; title is a sanity check; seniority is a
 * tiebreak, hence its tiny share.
 */
export const SCORE_WEIGHTS = Object.freeze({
  REQUIRED: 0.65,
  NICE: 0.35,
  COVERAGE: 0.75,
  TITLE: 0.2,
  SENIORITY: 0.05,
});

/**
 * Confidence multiplier applied to any result derived from a truncated
 * (~200 character) description. A score built from 200 characters is a real
 * score, just a less trustworthy one.
 *
 * Re-exported by `./index.js` as the pipeline-wide constant.
 */
export const SNIPPET_CONFIDENCE = 0.9;

/** `description_quality` value that marks a truncated description. */
const SNIPPET_QUALITY = 'snippet';

/** Seniority levels are ordinal 0..7; three rungs apart is "completely wrong". */
const SENIORITY_TOLERANCE = 3;

/** Number of distinct job terms at which we consider the signal fully formed. */
const FULL_SIGNAL_TERMS = 12;

/** Confidence when the job carried no keywords and only the title was scored. */
const LOW_SIGNAL_CONFIDENCE = 0.3;

/**
 * Confidence for a keyword-bearing job: the floor applies at one term, and the
 * span is added in proportion to how close the posting gets to
 * {@link FULL_SIGNAL_TERMS}. Floor + span is 1.0 by construction.
 */
const CONFIDENCE_FLOOR = 0.45;
const CONFIDENCE_SPAN = 0.55;

/** Scores are reported as an integer percentage; confidence to two decimals. */
const MAX_SCORE = 100;
const CONFIDENCE_DECIMALS = 2;

/** Missing-keyword suggestions returned when the caller does not ask for a number. */
const DEFAULT_MISSING_LIMIT = 6;

/** A required term outranks an optional one of the same weight. */
const REQUIRED_RANK_MULTIPLIER = 2;

/**
 * Safe division for coverage ratios.
 *
 * Returns `null` rather than 0 when the denominator is zero, and the
 * distinction is the whole point: "the job listed no required skills" is not
 * the same as "the candidate matched none of them", and scoring them the same
 * punishes a candidate for the poster's formatting.
 *
 * @param {number} hits Numerator.
 * @param {number} total Denominator.
 * @returns {number|null} `hits / total`, or `null` when `total` is zero or
 *   either side is not a finite number.
 */
export function ratio(hits, total) {
  if (!Number.isFinite(hits) || !Number.isFinite(total) || total === 0) return null;
  return hits / total;
}

/**
 * Distance-based seniority fit.
 *
 * @param {number|null} jobLevel Level detected from the job title.
 * @param {number|null} resumeLevel Level from the resume profile.
 * @returns {number} 1 for an exact match, decaying to 0 three rungs apart, and
 *   exactly 0.5 when either side is unknown. Unknown must be neutral — most
 *   resumes never state a level, and defaulting to 0 would silently dock every
 *   one of them 5 points for data we never asked for.
 */
export function seniorityFit(jobLevel, resumeLevel) {
  if (!Number.isFinite(jobLevel) || !Number.isFinite(resumeLevel)) return 0.5;
  const distance = Math.abs(jobLevel - resumeLevel);
  return 1 - Math.min(1, distance / SENIORITY_TOLERANCE);
}

/**
 * Score one job against a resume profile without calling a model.
 *
 * @param {import('./prefilter.js').ResumeProfile} resumeProfile From
 *   `buildResumeProfile`. Malformed input is treated as an empty profile.
 * @param {{title?: string, keywords?: unknown, keyword_terms?: unknown, description_quality?: string}} job
 * @returns {{score: number, matched: string[], missing: string[], lowSignal: boolean, confidence: number}}
 *   `score` is always an integer in [0,100]. `lowSignal` is true when the job
 *   carried no keywords at all and the number rests on the title alone —
 *   surface it, do not hide it behind a plausible-looking number.
 */
export function fallbackScoreJob(resumeProfile, job) {
  const profile = asResumeProfile(resumeProfile);
  const row = asObject(job);
  const keywords = normalizeJobKeywords(row);

  let requiredTotal = 0;
  let requiredHit = 0;
  let niceTotal = 0;
  let niceHit = 0;
  const matched = [];
  const missing = [];

  for (const keyword of keywords) {
    const has = profile.keywordSet.has(keyword.term);
    if (keyword.required) {
      requiredTotal += 1;
      if (has) requiredHit += 1;
    } else {
      niceTotal += 1;
      if (has) niceHit += 1;
    }
    (has ? matched : missing).push(keyword.term);
  }

  const requiredRatio = ratio(requiredHit, requiredTotal);
  const niceRatio = ratio(niceHit, niceTotal);
  const title = titleOverlap(row.title, profile.titles);
  const fit = seniorityFit(detectSeniority(row.title), profile.level);

  let coverage;
  let lowSignal = false;
  if (requiredRatio !== null && niceRatio !== null) {
    coverage = SCORE_WEIGHTS.REQUIRED * requiredRatio + SCORE_WEIGHTS.NICE * niceRatio;
  } else if (requiredRatio !== null) {
    // Re-normalize to full weight rather than multiplying by 0.65 — a posting
    // with only required terms is not 35% less of a match by construction.
    coverage = requiredRatio;
  } else if (niceRatio !== null) {
    coverage = niceRatio;
  } else {
    coverage = null;
    lowSignal = true;
  }

  const raw = coverage === null
    ? title
    : SCORE_WEIGHTS.COVERAGE * coverage + SCORE_WEIGHTS.TITLE * title + SCORE_WEIGHTS.SENIORITY * fit;

  const signalTerms = requiredTotal + niceTotal;
  // The outer clamp guards the tuning constants above, not the arithmetic.
  let confidence = lowSignal
    ? LOW_SIGNAL_CONFIDENCE
    : clamp01(CONFIDENCE_FLOOR + CONFIDENCE_SPAN * clamp01(signalTerms / FULL_SIGNAL_TERMS));
  if (row.description_quality === SNIPPET_QUALITY) confidence *= SNIPPET_CONFIDENCE;

  return {
    score: Math.round(MAX_SCORE * clamp01(raw)),
    matched: matched.sort(),
    missing: missing.sort(),
    lowSignal,
    confidence: roundTo(confidence, CONFIDENCE_DECIMALS),
  };
}

/**
 * The job's most important terms that the resume does not have — the "add this
 * to your CV" list.
 *
 * Ranking is `(required ? 2 : 1) * weight * log2(1 + count)`: required beats
 * optional, a strong lexicon term beats a free-text guess, and repetition
 * inside the posting breaks ties sub-linearly so one term repeated eight times
 * cannot bury seven distinct ones.
 *
 * @param {import('./prefilter.js').ResumeProfile} resumeProfile Resume to diff against.
 * @param {{keywords?: unknown, keyword_terms?: unknown, description_quality?: string}} job
 * @param {{limit?: number}} [options] `limit` defaults to 6.
 * @returns {Array<{term: string, weight: number, required: boolean, category: string}>}
 *   Empty for `description_quality: 'snippet'` — we read 200 characters of that
 *   posting, so any "you are missing X" would be an artefact of truncation, and
 *   telling a user to add a skill the job never mentioned is worse than silence.
 */
export function missingKeywords(resumeProfile, job, options = {}) {
  const row = asObject(job);
  if (row.description_quality === SNIPPET_QUALITY) return [];

  const profile = asResumeProfile(resumeProfile);
  const limit = positiveIntOr(asObject(options).limit, DEFAULT_MISSING_LIMIT);

  return normalizeJobKeywords(row)
    .filter((keyword) => !profile.keywordSet.has(keyword.term))
    .map((keyword) => ({
      keyword,
      rank: (keyword.required ? REQUIRED_RANK_MULTIPLIER : 1)
        * keyword.weight
        * Math.log2(1 + keyword.count),
    }))
    .sort((a, b) => {
      if (b.rank !== a.rank) return b.rank - a.rank;
      return compareStrings(a.keyword.term, b.keyword.term);
    })
    .slice(0, limit)
    .map(({ keyword }) => ({
      term: keyword.term,
      weight: keyword.weight,
      required: keyword.required,
      // `normalizeJobKeywords` has already resolved the lexicon category, or
      // recorded `other` when the term is unknown to it.
      category: keyword.category,
    }));
}
