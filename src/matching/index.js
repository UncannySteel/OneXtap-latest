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
 */
export const MATCHER_VERSION = 1;
