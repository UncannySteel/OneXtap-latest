/**
 * Cheap keyword-overlap prefilter: shrink a few hundred candidate jobs down to
 * the handful worth spending an LLM call on.
 *
 * ZERO-IMPORT RULE: only sibling modules under `src/matching/`. See
 * `src/matching/index.js`.
 */

import {
  asObject,
  clamp01,
  compareStrings,
  normalizeText,
  positiveIntOr,
  roundTo,
  tokenize,
} from './normalize.js';
import { detectSeniority, SKILL_LEXICON } from './lexicon.js';
import { foldToLexicon } from './extractKeywords.js';

/**
 * The comparison-ready view of a resume. `level` and `yearsExperience` are
 * `null` when unknown, which is not the same as zero.
 * @typedef {{keywordSet: Map<string, number>, titles: string[], level: number|null,
 *   yearsExperience: number|null}} ResumeProfile
 */

/** A required term is worth half again as much as a nice-to-have in the cheap pass. */
const REQUIRED_MULTIPLIER = 1.5;

/** Education terms are weak evidence of a current skill, so they are discounted. */
const EDUCATION_DISCOUNT = 0.7;

/** Jobs returned when the caller does not ask for a specific number. */
const DEFAULT_LIMIT = 30;

/**
 * Candidates kept regardless of overlap, when a floor is applied.
 *
 * A floor that can empty the list is worse than no floor. Some resumes fold
 * into the lexicon poorly, and some pools genuinely hold nothing adjacent —
 * in both cases every job scores 0, and "we found nothing" is a far worse
 * answer than a short list the ranker can still sort. So the floor drops the
 * zero-overlap tail only while at least this many candidates survive it.
 */
const MIN_KEPT_CANDIDATES = 8;

/** Decimals kept on a stored weight or score. */
const SCORE_DECIMALS = 4;

/** Weight a job keyword carries when the stored row does not say. */
const DEFAULT_KEYWORD_WEIGHT = 1;

/** Category recorded for a term the lexicon does not know. */
const UNKNOWN_CATEGORY = 'other';

/**
 * Coerce a value to a string for ordering, mapping null/undefined to `''` so a
 * missing field sorts consistently instead of comparing as "null".
 * @param {unknown} value
 * @returns {string}
 */
function orderKey(value) {
  return value === undefined || value === null ? '' : String(value);
}

/**
 * Merge a folded term into a resume keyword map, keeping the strongest weight.
 * @param {Map<string, number>} map Mutated in place.
 * @param {string} term Canonical term.
 * @param {number} weight Weight of this occurrence.
 * @returns {void}
 */
function addTerm(map, term, weight) {
  if (!term) return;
  const prev = map.get(term);
  if (prev === undefined || weight > prev) map.set(term, roundTo(weight, SCORE_DECIMALS));
}

/**
 * Accept anything as a resume profile.
 *
 * A profile that carries a real `keywordSet` is passed through untouched;
 * anything else becomes an empty profile. Every scorer starts with this, so a
 * bad parse degrades the match instead of breaking the page.
 *
 * @param {unknown} value Candidate profile, typically from {@link buildResumeProfile}.
 * @returns {ResumeProfile}
 */
export function asResumeProfile(value) {
  if (value && value.keywordSet instanceof Map) return value;
  return { keywordSet: new Map(), titles: [], level: null, yearsExperience: null };
}

/**
 * Build the comparison-ready view of a parsed resume.
 *
 * Every skill is pushed through the same normalize → alias → lexicon path the
 * job side uses, so "K8s" on a resume and "Kubernetes" in a posting land on the
 * identical canonical term. Without that shared vocabulary the overlap score is
 * a spelling contest.
 *
 * @param {{skills?: unknown[], titles?: unknown[], yearsExperience?: unknown,
 *   keywords?: unknown[], seniority?: unknown, education?: unknown[]}} parsed
 *   Structured resume. Any field may be missing or the wrong type.
 * @returns {ResumeProfile} Always a valid profile — malformed input yields an
 *   empty one rather than throwing.
 */
export function buildResumeProfile(parsed) {
  const input = asObject(parsed);
  const keywordSet = new Map();

  const skills = Array.isArray(input.skills) ? input.skills : [];
  for (const skill of skills) {
    const source = typeof skill === 'string' ? skill : skill?.name ?? skill?.term ?? '';
    for (const folded of foldToLexicon(source)) addTerm(keywordSet, folded.term, folded.weight);
  }

  const extraKeywords = Array.isArray(input.keywords) ? input.keywords : [];
  for (const keyword of extraKeywords) {
    const source = typeof keyword === 'string' ? keyword : keyword?.term ?? '';
    // An explicit weight on the resume side overrides the folded one, so a
    // caller that has already ranked a keyword keeps its ranking.
    const explicit = typeof keyword === 'object' && keyword !== null && Number.isFinite(keyword.weight)
      ? keyword.weight
      : null;
    for (const folded of foldToLexicon(source)) {
      addTerm(keywordSet, folded.term, explicit ?? folded.weight);
    }
  }

  const education = Array.isArray(input.education) ? input.education : [];
  for (const entry of education) {
    const source = typeof entry === 'string'
      ? entry
      : [entry?.degree, entry?.field, entry?.school].filter(Boolean).join(' ');
    for (const folded of foldToLexicon(source)) {
      addTerm(keywordSet, folded.term, folded.weight * EDUCATION_DISCOUNT);
    }
  }

  const titles = [];
  const rawTitles = Array.isArray(input.titles) ? input.titles : [];
  for (const title of rawTitles) {
    const normalized = normalizeText(typeof title === 'string' ? title : title?.title ?? '');
    if (normalized && !titles.includes(normalized)) titles.push(normalized);
  }

  // An explicitly stated level wins; otherwise read it off the most recent
  // title, which is why `titles` is built before this runs.
  let level = Number.isFinite(input.seniority) ? Math.trunc(input.seniority) : null;
  if (level === null) {
    for (const title of titles) {
      const detected = detectSeniority(title);
      if (detected !== null) {
        level = detected;
        break;
      }
    }
  }

  const yearsExperience = Number.isFinite(input.yearsExperience) && input.yearsExperience >= 0
    ? input.yearsExperience
    : null;

  return { keywordSet, titles, level, yearsExperience };
}

/**
 * Normalize a stored job's keyword payload into one internal shape.
 *
 * Two forms exist in the wild: the compact jsonb `{t, w, r}` we persist to keep
 * rows small, and the expanded `{term, weight, required}` the extractor emits.
 * Both must produce identical downstream behaviour, so every consumer goes
 * through here rather than reaching into `job.keywords` directly.
 *
 * Repeated terms are MERGED, not discarded. Dropping a repeat throws away the
 * stronger signal whenever the later row is the stronger one — a second
 * `{t:'python', w:2, r:true}` after a first `{t:'python', r:false}` would have
 * left the term un-required at weight 1. Our own extractor pre-dedupes, but a
 * hand-built or externally-ingested payload does not.
 *
 * @param {{keywords?: unknown, keyword_terms?: unknown}} job A job row or extractor output.
 * @returns {Array<{term: string, weight: number, required: boolean, count: number, category: string}>}
 *   One entry per term, at its first occurrence's position. On a repeat,
 *   `required` is the OR, `weight` the max, and `count` the MAX — a duplicate
 *   entry is a data artifact, not evidence the term was mentioned twice, so
 *   summing would let a malformed row inflate its own ranking.
 */
export function normalizeJobKeywords(job) {
  const row = asObject(job);
  const keywords = [];
  /** @type {Map<string, {term: string, weight: number, required: boolean, count: number, category: string}>} */
  const byTerm = new Map();

  const push = (rawTerm, rawWeight, rawRequired, rawCount) => {
    const term = normalizeText(rawTerm);
    if (!term) return;
    const weight = Number.isFinite(rawWeight) ? rawWeight : DEFAULT_KEYWORD_WEIGHT;
    const required = Boolean(rawRequired);
    const count = Number.isFinite(rawCount) && rawCount > 0 ? rawCount : 1;

    const prev = byTerm.get(term);
    if (prev) {
      if (weight > prev.weight) prev.weight = weight;
      if (required) prev.required = true;
      if (count > prev.count) prev.count = count;
      return;
    }

    const entry = {
      term,
      weight,
      required,
      count,
      category: SKILL_LEXICON.get(term)?.category ?? UNKNOWN_CATEGORY,
    };
    byTerm.set(term, entry);
    keywords.push(entry);
  };

  if (Array.isArray(row.keywords)) {
    for (const keyword of row.keywords) {
      if (typeof keyword === 'string') {
        push(keyword, DEFAULT_KEYWORD_WEIGHT, false, 1);
      } else if (keyword && typeof keyword === 'object') {
        push(
          keyword.term ?? keyword.t,
          keyword.weight ?? keyword.w,
          keyword.required ?? keyword.r,
          keyword.count ?? keyword.c,
        );
      }
    }
  }

  // A row may also carry a flat list of terms with no weights at all.
  if (Array.isArray(row.keyword_terms)) {
    for (const term of row.keyword_terms) push(term, DEFAULT_KEYWORD_WEIGHT, false, 1);
  }

  return keywords;
}

/**
 * Rank jobs by weighted keyword overlap with a resume profile.
 *
 * This is an ORDERING signal, not a match score — it exists to pick which jobs
 * are worth a real evaluation. It is cheap on purpose: one Map lookup per job
 * keyword, no text processing.
 *
 * @param {ResumeProfile} resumeProfile From {@link buildResumeProfile}.
 * @param {Array<object>} jobs Job rows; each may use either keyword shape.
 * @param {{limit?: number, minScore?: number}} [options] `limit` defaults to
 *   30. `minScore` opts into the floor described below: candidates at or
 *   under it are dropped, unless doing so would leave too few.
 * @returns {Array<{job: object, prefilterScore: number, matchedTerms: string[]}>}
 *   Sorted by score descending, then `posted_at` descending, then `id`
 *   ascending. The final `id` tiebreak matters: `Array.prototype.sort` is only
 *   stable with respect to the INPUT order, and the input order here comes from
 *   a database query whose ordering we do not control, so leaving ties to sort
 *   stability would make results flicker between identical requests.
 */
export function prefilterJobs(resumeProfile, jobs, options = {}) {
  const profile = asResumeProfile(resumeProfile);
  const list = Array.isArray(jobs) ? jobs : [];
  const limit = positiveIntOr(asObject(options).limit, DEFAULT_LIMIT);

  const scored = list
    .filter((job) => job && typeof job === 'object')
    .map((job) => {
      const keywords = normalizeJobKeywords(job);
      let matchedWeight = 0;
      let totalWeight = 0;
      const matchedTerms = [];
      for (const keyword of keywords) {
        const emphasis = keyword.weight * (keyword.required ? REQUIRED_MULTIPLIER : 1);
        totalWeight += emphasis;
        const resumeWeight = profile.keywordSet.get(keyword.term);
        if (resumeWeight === undefined) continue;
        matchedWeight += emphasis * resumeWeight;
        matchedTerms.push(keyword.term);
      }
      // A resume weight above 1 can push the ratio past 1, hence the clamp.
      const ratio = totalWeight > 0 ? matchedWeight / totalWeight : 0;
      return {
        job,
        prefilterScore: roundTo(clamp01(ratio), SCORE_DECIMALS),
        matchedTerms: matchedTerms.sort(),
      };
    });

  scored.sort((a, b) => {
    if (b.prefilterScore !== a.prefilterScore) return b.prefilterScore - a.prefilterScore;
    const byPosted = compareStrings(orderKey(b.job.posted_at), orderKey(a.job.posted_at));
    if (byPosted !== 0) return byPosted;
    return compareStrings(orderKey(a.job.id), orderKey(b.job.id));
  });

  // ═══ THE FLOOR ═══
  //
  // Opt-in, because this function is also the "give me the best N you have"
  // pass for callers that genuinely want N.
  //
  // Without it the slice below pads: a pool of 200 with 12 relevant jobs still
  // hands the scorer 30, and the last 18 have NOTHING in common with the
  // resume. That is not a harmless extra — those jobs occupy the ranked list,
  // cost model tokens to score, and are exactly what "a Python developer is
  // being shown freelance content writing" looks like from the inside.
  //
  // Guarded by MIN_KEPT_CANDIDATES so it can thin a list but never empty one.
  if (asObject(options).minScore !== undefined) {
    const floor = Number(asObject(options).minScore) || 0;
    const above = scored.filter((entry) => entry.prefilterScore > floor);
    if (above.length >= Math.min(MIN_KEPT_CANDIDATES, scored.length)) {
      return above.slice(0, limit);
    }
  }

  return scored.slice(0, limit);
}

/**
 * Token overlap between a job title and the titles on a resume.
 *
 * Shared by the prefilter and the fallback scorer so both read "Senior Backend
 * Engineer" vs "Backend Engineer" the same way.
 *
 * Scores against the BEST-matching resume title rather than averaging: a
 * candidate with five past titles should not be penalised for the four that are
 * irrelevant to this posting.
 *
 * @param {unknown} jobTitle Title from the job row.
 * @param {string[]} resumeTitles Normalized titles; non-arrays are treated as empty.
 * @returns {number} In [0,1]; 0 when either side is empty.
 */
export function titleOverlap(jobTitle, resumeTitles) {
  const jobTokens = new Set(tokenize(jobTitle));
  if (jobTokens.size === 0) return 0;
  const titles = Array.isArray(resumeTitles) ? resumeTitles : [];
  let best = 0;
  for (const title of titles) {
    const tokens = new Set(tokenize(title));
    if (tokens.size === 0) continue;
    let hits = 0;
    for (const token of jobTokens) if (tokens.has(token)) hits += 1;
    const score = hits / jobTokens.size;
    if (score > best) best = score;
  }
  return roundTo(clamp01(best), SCORE_DECIMALS);
}
