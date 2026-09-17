/**
 * Text primitives for the matching pipeline, plus the handful of argument and
 * number guards every sibling module needs.
 *
 * The guards live here rather than in a module of their own because of the
 * zero-import rule below: `normalize.js` is the one file every other module
 * already depends on, so it is the only place a shared helper can sit without
 * adding an import edge.
 *
 * ZERO-IMPORT RULE: this file (and everything else under `src/matching/`) must
 * not import anything outside `src/matching/`. See `src/matching/index.js` for
 * the full rationale.
 */

/* --- Shared guards, used by every module in the pipeline --- */

/**
 * Round to a fixed number of decimals.
 *
 * Weights, ratios and confidences are compared and asserted on, so they are
 * rounded to keep binary-float noise (0.30000000000000004) out of both the
 * stored rows and the test expectations.
 *
 * @param {unknown} value Number to round; non-finite input yields 0 rather than
 *   propagating NaN into a score.
 * @param {number} decimals Decimal places to keep.
 * @returns {number}
 */
export function roundTo(value, decimals) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Clamp to the unit interval.
 * @param {unknown} value Any input.
 * @returns {number} `value` clamped to [0,1]; non-finite input gives 0.
 */
export function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Deterministic string ordering for sort tiebreaks.
 *
 * Deliberately NOT `localeCompare`: that is locale-dependent, and these
 * orderings have to be byte-stable across a user's machine, the server and CI.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} -1, 0 or 1.
 */
export function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Coerce an options/record argument to something safe to read properties off.
 *
 * Arrays and other exotic objects are passed through unchanged — the callers
 * only ever read named properties, so a wrong-typed object behaves exactly like
 * an empty one without needing a second check.
 *
 * @param {unknown} value Any input.
 * @returns {object} `value` itself when it is a non-null object, else `{}`.
 */
export function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

/**
 * Read a caller-supplied positive count (a limit, a floor), falling back when it
 * is missing or nonsense.
 *
 * @param {unknown} value Candidate count.
 * @param {number} fallback Used when `value` is not a finite number above zero.
 * @returns {number} A truncated integer, or `fallback`.
 */
export function positiveIntOr(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

/* --- Text --- */

/**
 * Tokens shorter than two characters are normally dropped as noise, but these
 * are real skills. `r` (the language), `c` (the language), and the two-letter
 * discipline abbreviations that a JD will genuinely write as-is.
 * @type {Set<string>}
 */
export const SHORT_TOKEN_WHITELIST = new Set(['r', 'c', 'go', 'ai', 'ml', 'ux', 'ui', 'qa']);

/**
 * Fixed HTML entity table. We cannot use the DOM to decode entities because
 * these modules run in bare Node (`node --test`) and inside the Express server,
 * neither of which has `document`. The list covers what job boards actually
 * emit in `description` HTML; anything else is left as literal text.
 */
const ENTITIES = new Map([
  ['&amp;', '&'],
  ['&lt;', '<'],
  ['&gt;', '>'],
  ['&quot;', '"'],
  ['&#39;', "'"],
  ['&apos;', "'"],
  ['&nbsp;', ' '],
  ['&ndash;', '-'],
  ['&mdash;', '-'],
  ['&rsquo;', "'"],
  ['&lsquo;', "'"],
  ['&ldquo;', '"'],
  ['&rdquo;', '"'],
]);

/** Matches a named entity, a decimal numeric entity, or a hex numeric entity. */
const ENTITY_RE = /&(?:#[xX]([0-9a-fA-F]+)|#(\d+)|([a-zA-Z][a-zA-Z0-9]*));/g;

/** Any HTML tag, including an unterminated attribute-only one. */
const TAG_RE = /<[^>]*>/g;

/**
 * A token is a run of alphanumerics that may contain internal `.` or `-` and
 * may end in `+`/`#`. That is exactly what keeps `node.js`, `ci-cd`, `c++` and
 * `c#` intact while treating `/`, whitespace and every other mark as a break.
 */
const TOKEN_RE = /[a-z0-9]+(?:[.\-][a-z0-9]+)*[+#]*/g;

/** A token with no letters at all ("2024", "5+", "10-15") carries no skill signal. */
const NUMERIC_ONLY_RE = /^[\d.+#-]+$/;

/**
 * The Unicode combining-mark block, written as escapes on purpose: spelling the
 * range literally puts bare combining characters in this source file, where any
 * editor that re-normalizes on save can silently corrupt the range.
 */
const COMBINING_MARKS_RE = /[\u0300-\u036f]/g;

/** Largest code point `String.fromCodePoint` accepts. */
const MAX_CODE_POINT = 0x10ffff;

/** Character width of the trigrams {@link trigramSet} emits. */
const TRIGRAM_SIZE = 3;

/**
 * Convert a code point to a character, falling back to the original entity text
 * when the code point is out of range rather than throwing.
 * @param {number} codePoint Unicode code point.
 * @param {string} original The entity source text, used as the fallback.
 * @returns {string}
 */
function safeFromCodePoint(codePoint, original) {
  if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > MAX_CODE_POINT) return original;
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return original;
  }
}

/**
 * Remove HTML tags and decode entities from a job description.
 *
 * Tags become a single space rather than the empty string, so `<li>a</li><li>b</li>`
 * yields two tokens instead of the fused `ab`.
 *
 * @param {unknown} html Raw text, possibly HTML, possibly not a string at all.
 * @returns {string} Plain text. Always a string — `null`/`undefined`/numbers give `''`.
 */
export function stripHtml(html) {
  if (typeof html !== 'string' || html.length === 0) return '';
  return html.replace(TAG_RE, ' ').replace(ENTITY_RE, (match, hex, decimal, name) => {
    if (hex !== undefined) return safeFromCodePoint(parseInt(hex, 16), match);
    if (decimal !== undefined) return safeFromCodePoint(parseInt(decimal, 10), match);
    const key = `&${String(name).toLowerCase()};`;
    return ENTITIES.has(key) ? ENTITIES.get(key) : match;
  });
}

/**
 * Fold text into the single canonical form the rest of the pipeline compares
 * against: de-HTML'd, lowercased, accent-stripped, whitespace-collapsed.
 *
 * NFKD decomposition then stripping the combining-mark block is what turns
 * "Café" into "cafe" without a lookup table, and also flattens the fullwidth
 * and ligature forms that PDF-extracted resumes are full of.
 *
 * @param {unknown} text Any input; non-strings are treated as empty.
 * @returns {string} Normalized text, or `''`. Never throws.
 */
export function normalizeText(text) {
  const plain = stripHtml(text);
  if (!plain) return '';
  return plain
    .toLowerCase()
    .normalize('NFKD')
    .replace(COMBINING_MARKS_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Split normalized text into comparison tokens.
 *
 * Filtering rules, in order: strip a trailing `+`/`#` only when at least two
 * characters remain (so "Python+" becomes `python` but `c++` and `c#` survive
 * whole), drop letterless tokens, then drop single characters unless they are
 * in {@link SHORT_TOKEN_WHITELIST}.
 *
 * `/` is deliberately a separator, so "ci/cd" produces two tokens — the bigram
 * `ci cd` is then folded to `cicd` by ALIASES.
 *
 * @param {unknown} text Text to tokenize; it is normalized first, so raw HTML is fine.
 * @returns {string[]} Tokens in document order. Empty array for empty input.
 */
export function tokenize(text) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const matches = normalized.match(TOKEN_RE);
  if (!matches) return [];

  const tokens = [];
  for (const match of matches) {
    // Defensive only: TOKEN_RE cannot produce a leading or trailing `.`/`-`, and
    // always matches at least one character, so neither the trim nor the empty
    // check below can currently fire. They are kept so that widening TOKEN_RE
    // cannot quietly start emitting `.foo` or empty strings as tokens.
    let token = match.replace(/^[.\-]+/, '').replace(/[.\-]+$/, '');
    const withoutSuffix = token.replace(/[+#]+$/, '');
    if (withoutSuffix.length >= 2) token = withoutSuffix;
    if (!token) continue;
    if (NUMERIC_ONLY_RE.test(token)) continue;
    if (token.length < 2 && !SHORT_TOKEN_WHITELIST.has(token)) continue;
    tokens.push(token);
  }
  return tokens;
}

/**
 * Build every contiguous n-gram over a token list, carrying the token indices
 * so a caller can mark the span consumed (see the longest-match-wins loop in
 * `extractKeywords`).
 *
 * @param {string[]} tokens Token list from {@link tokenize}.
 * @param {number} n N-gram width; values below 1 or wider than the list yield `[]`.
 * @returns {Array<{text: string, start: number, end: number}>} `end` is INCLUSIVE.
 */
export function ngrams(tokens, n) {
  if (!Array.isArray(tokens) || !Number.isFinite(n) || n < 1) return [];
  const width = Math.floor(n);
  if (tokens.length < width) return [];
  const grams = [];
  for (let start = 0; start + width <= tokens.length; start += 1) {
    grams.push({
      text: tokens.slice(start, start + width).join(' '),
      start,
      end: start + width - 1,
    });
  }
  return grams;
}

/**
 * Character trigrams of normalized text, used as the fuzzy half of the
 * fabrication similarity check. Character-level comparison catches reworded
 * paraphrases that share no whole tokens.
 *
 * @param {unknown} text Any input.
 * @returns {Set<string>} Trigrams. Text shorter than 3 characters yields an empty set.
 */
export function trigramSet(text) {
  const normalized = normalizeText(text);
  const trigrams = new Set();
  if (normalized.length < TRIGRAM_SIZE) return trigrams;
  for (let i = 0; i + TRIGRAM_SIZE <= normalized.length; i += 1) {
    trigrams.add(normalized.slice(i, i + TRIGRAM_SIZE));
  }
  return trigrams;
}

/**
 * Jaccard index of two sets.
 *
 * @param {Set<unknown>} setA First set; non-Sets are treated as empty.
 * @param {Set<unknown>} setB Second set.
 * @returns {number} `|A∩B| / |A∪B|` in [0,1]. Two empty sets give 0, not NaN —
 *   "nothing matches nothing" must never read as a perfect match.
 */
export function jaccard(setA, setB) {
  const a = setA instanceof Set ? setA : new Set();
  const b = setB instanceof Set ? setB : new Set();
  if (a.size === 0 && b.size === 0) return 0;
  // Iterate the smaller set and probe the larger one, so the cost is O(min).
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let intersection = 0;
  for (const item of small) if (large.has(item)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
