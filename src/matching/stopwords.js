/**
 * Stopword vocabularies for the matching pipeline.
 *
 * ZERO-IMPORT RULE: no imports at all in this file. See `src/matching/index.js`.
 *
 * The three lists are deliberately separate because they are consulted at
 * different points and conflating them breaks real behaviour:
 *   - STOPWORDS      filters free-text keyword OUTPUT (pass B).
 *   - PHRASE_BREAKERS forbids a multi-word phrase from SPANNING a word.
 *   - NEVER_EMIT     blocks terms that pass every other filter but are useless
 *                    as a match signal.
 */

/**
 * English function words plus job-description boilerplate that is never a
 * skill. A JD is ~40% this vocabulary; without it the free-text pass returns
 * "the", "we" and "responsibilities" as a candidate's top matches.
 *
 * Note: "experience" is deliberately ABSENT. The required-detection regexes in
 * `extractKeywords` key off phrases like "strong experience" and "5+ years of
 * experience", so the word has to survive normalization. It is kept out of the
 * keyword OUTPUT by {@link NEVER_EMIT} instead.
 *
 * @type {Set<string>}
 */
export const STOPWORDS = new Set([
  // Function words.
  'a', 'about', 'above', 'across', 'after', 'again', 'against', 'all', 'almost',
  'along', 'already', 'also', 'although', 'always', 'am', 'among', 'an', 'and',
  'another', 'any', 'anything', 'are', 'around', 'as', 'at', 'back', 'be',
  'because', 'been', 'before', 'behind', 'being', 'below', 'best', 'better',
  'between', 'beyond', 'both', 'but', 'by', 'can', 'cannot', 'come', 'could',
  'did', 'do', 'does', 'doing', 'done', 'down', 'during', 'each', 'either',
  'else', 'enough', 'even', 'ever', 'every', 'few', 'first', 'for', 'from',
  // "go" is deliberately absent: it is a lexicon language name, and
  // `extractKeywords` skips single-token lexicon lookups for stopwords, so
  // listing it here would make the Go language undetectable.
  'further', 'get', 'give', 'had', 'has', 'have', 'having', 'he', 'her',
  'here', 'hers', 'him', 'his', 'how', 'however', 'i', 'if', 'in', 'instead',
  'into', 'is', 'it', 'its', 'itself', 'keep', 'last', 'least', 'less', 'let',
  'like', 'made', 'make', 'making', 'many', 'may', 'me', 'might', 'more',
  'most', 'much', 'my', 'never', 'new', 'next', 'no', 'nor', 'not', 'now',
  'of', 'off', 'often', 'on', 'once', 'one', 'only', 'onto', 'or', 'other',
  'others', 'our', 'ours', 'out', 'over', 'own', 'per', 'put', 'rather', 're',
  'same', 'see', 'she', 'should', 'since', 'so', 'some', 'still', 'such',
  'take', 'than', 'that', 'the', 'their', 'theirs', 'them', 'then', 'there',
  'these', 'they', 'thing', 'things', 'this', 'those', 'through', 'throughout',
  'to', 'together', 'too', 'toward', 'towards', 'under', 'until', 'up', 'upon',
  'us', 'use', 'used', 'using', 'usually', 'various', 'very', 'via', 'was',
  'way', 'we', 'well', 'were', 'what', 'when', 'where', 'whether', 'which',
  'while', 'who', 'whom', 'whose', 'why', 'will', 'with', 'within', 'without',
  'would', 'yet', 'you', 'your', 'yours',
  // Job-posting boilerplate: high frequency, zero discriminative value.
  'ability', 'able', 'apply', 'applying', 'application', 'applicant',
  'benefit', 'benefits', 'bonus', 'candidate', 'candidates', 'companies',
  'company', 'compensation', 'culture', 'day', 'days', 'description', 'detail',
  'duties', 'dynamic', 'e.g', 'employer', 'ensure', 'ensuring', 'environment',
  'etc', 'exciting', 'excellent', 'fast', 'full', 'good', 'great', 'growth',
  'help', 'helping', 'hire', 'hiring', 'hybrid', 'i.e', 'ideal', 'include',
  'includes', 'including', 'job', 'jobs', 'join', 'joining', 'looking', 'month',
  'months', 'motivated', 'must', 'need', 'needs', 'offer', 'offering', 'office',
  'onsite', 'opportunities', 'opportunity', 'oriented', 'paced', 'part',
  'passionate', 'plus', 'position', 'positions', 'qualification',
  'qualifications', 'remote', 'requirement', 'requirements',
  'responsibilities', 'responsibility', 'role', 'roles', 'salary', 'self',
  'starter', 'strong', 'successful', 'summary', 'team', 'teams', 'time',
  'want', 'wants', 'week', 'weeks', 'work', 'working', 'year', 'years',
  'overview',
]);

/**
 * Words and marks that a multi-word skill phrase may not span.
 *
 * This is the whole reason "machine learning" survives n-gram extraction while
 * "and learning" and "of python" die. Without it the bigram pass produces a
 * long tail of conjunction-anchored garbage that then outranks real skills on
 * raw frequency.
 *
 * The punctuation entries can never match a token — `tokenize` discards
 * punctuation before anything consults this set. They are kept as the written
 * record of which marks end a phrase, which `extractKeywords` enforces earlier
 * by chunking a segment on `, ; ( ) | &` so no n-gram can cross one. `/` is
 * intentionally NOT a chunk boundary there, so "ci/cd" can still form the
 * bigram `ci cd` that ALIASES folds to `cicd`.
 *
 * @type {Set<string>}
 */
export const PHRASE_BREAKERS = new Set([
  'and', 'or', 'but', 'with', 'without', 'plus', 'including', 'such', 'as',
  'well', 'also', 'to', 'of', 'in', 'on', 'at', 'for', 'from', 'by', 'a', 'an',
  'the',
  ',', ';', '(', ')', '/', '|', '&',
]);

/**
 * Terms that must never reach keyword output.
 *
 * Every one of these sits next to a real skill in a JD ("experience with
 * Kubernetes", "knowledge of SQL") and therefore survives frequency ranking,
 * but matching a candidate on the word "experience" is meaningless — it tells
 * you nothing about fit and it inflates the score of any resume.
 *
 * @type {Set<string>}
 */
export const NEVER_EMIT = new Set([
  'experience', 'knowledge', 'skills', 'skill', 'understanding', 'familiarity',
  'background', 'expertise', 'proficiency',
]);
