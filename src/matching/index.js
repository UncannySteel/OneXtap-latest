/**
 * Barrel for the matching engine.
 *
 * ═══ THE ZERO-IMPORT RULE ═══
 *
 * Nothing under `src/matching/` — and nothing in `src/corpus.js` — may import
 * from outside those two locations. No `../logger.js`, no `../config.js`, no
 * `../storage.js`, no npm packages, no `node:` builtins.
 *
 * WHY, concretely:
 *   - `src/config.js` reads `import.meta.env.VITE_API_URL` at module scope.
 *     In bare Node `import.meta.env` is `undefined`, so the property access
 *     throws a TypeError the instant the module is imported — before a single
 *     test runs.
 *   - `src/storage.js` and `src/logger.js` touch `chrome` / `localStorage` at
 *     module load. Neither exists in Node or in the Express server process.
 *
 * These modules have to be importable by ALL THREE runtimes: the Vite bundle
 * (extension popup and dashboard), bare Node (`npm test`), and the Express
 * server, which lives behind its own `package.json`. The only way to guarantee
 * that is to depend on nothing. Pure ES modules, pure functions, zero I/O, zero
 * side effects at module load.
 *
 * `test/matching/no-side-imports.test.js` enforces this mechanically. If you
 * are here because that test failed: the answer is not to relax the test.
 *
 * The one sanctioned exception is that `src/corpus.js` may import
 * `./matching/normalize.js`.
 */

export {
  normalizeText,
  stripHtml,
  tokenize,
  ngrams,
  trigramSet,
  jaccard,
  SHORT_TOKEN_WHITELIST,
} from './normalize.js';

export { STOPWORDS, PHRASE_BREAKERS, NEVER_EMIT } from './stopwords.js';

export {
  SKILL_LEXICON,
  ALIASES,
  SENIORITY,
  TITLE_TOKENS,
  detectSeniority,
} from './lexicon.js';

export { extractKeywords, foldToLexicon } from './extractKeywords.js';

export {
  buildResumeProfile,
  prefilterJobs,
  normalizeJobKeywords,
  titleOverlap,
} from './prefilter.js';

export {
  fallbackScoreJob,
  missingKeywords,
  keywordCoverage,
  seniorityFit,
  ratio,
  SCORE_WEIGHTS,
  /**
   * Confidence multiplier for a result derived from a truncated (~200
   * character) description. Defined next to the scorer that applies it.
   */
  SNIPPET_CONFIDENCE,
} from './fallbackScore.js';

export {
  validateAgainstCorpus,
  segmentClaims,
  similarity,
  isStrictClaim,
  FAB_THRESHOLDS,
} from './fabrication.js';

/**
 * Bump whenever extraction or scoring changes in a way that invalidates stored
 * results. Persisted alongside a scored job so a stale row can be recognised
 * and re-scored instead of silently mixing two algorithms in one list.
 *
 * 2 — the grounding validator became two-pass (checkability, then entity
 * grounding) and `buildCorpus` moved employment and graduation dates into item
 * TEXT rather than `meta`. The corpus change is why this had to move: a stored
 * resume keeps its built corpus, and `rederiveIfStale` in `src/resumeStore.js`
 * rebuilds it from `cvText` only when this number is ahead of the record's.
 * Without the bump, every existing user keeps a dateless corpus and goes on
 * seeing their own start date reported as a fabrication.
 *
 * 3 — ranking gained a hard minimum match score (MIN_MATCH_SCORE in
 * server/jobs/graph.js): jobs below it are no longer returned at all. The
 * ranking cache is keyed on this number (`cacheKey` in server/jobs/rankCache.js),
 * so without the bump every user with a warm cache would keep being served the
 * sub-50% list for up to six hours — the exact results the floor exists to
 * remove, and indistinguishable from the floor not working.
 */
export const MATCHER_VERSION = 3;
