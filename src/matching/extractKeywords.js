/**
 * Job-description keyword extraction.
 *
 * ZERO-IMPORT RULE: only sibling modules under `src/matching/`. See
 * `src/matching/index.js`.
 */

import {
  asObject,
  compareStrings,
  normalizeText,
  ngrams,
  roundTo,
  stripHtml,
  tokenize,
} from './normalize.js';
import { STOPWORDS, PHRASE_BREAKERS, NEVER_EMIT } from './stopwords.js';
import { SKILL_LEXICON, ALIASES, TITLE_TOKENS, SENIORITY } from './lexicon.js';

/**
 * One accumulated term. `count` is how many times it was observed, `weight` the
 * strongest weight any observation gave it.
 * @typedef {{term: string, weight: number, required: boolean, count: number,
 *   category: string}} TermEntry
 */

/** Bullets and newlines are the real structure of a JD; ". " catches prose. */
const SEGMENT_SPLIT = /[\n\r•·]+|(?:\.\s)/;

/**
 * Within a segment, these marks end a phrase. An n-gram must never cross one,
 * or "Kubernetes, Python" yields the phantom bigram "kubernetes python".
 * `/` is intentionally NOT here — "ci/cd" has to survive as the bigram
 * `ci cd` so ALIASES can fold it to `cicd`.
 */
const CHUNK_SPLIT = /[,;()|]+|&/;

/** Spaces and tabs but NOT newlines, which carry the JD's heading structure. */
const HORIZONTAL_WHITESPACE = /[^\S\r\n]+/g;

/** A heading is short. Anything longer is a sentence that happens to start with the word. */
const HEADING_MAX_CHARS = 60;

/** Label punctuation left on a heading segment once the heading itself is sliced off. */
const HEADING_LABEL_TAIL = /^[\s:–-]+/;

const REQUIRED_HEADING =
  /^\s*(requirements?|what you['’]?ll need|must have|qualifications?|who you are|we['’]?re looking for|essential|minimum qualifications)\b/i;
const NICE_HEADING =
  /^\s*(nice to have|preferred|bonus|desirable|plus(es)?|good to have|preferred qualifications)\b/i;
const NEUTRAL_HEADING =
  /^\s*(responsibilities|about (us|the role|the team)|benefits|perks|what we offer|compensation)\b/i;

const REQUIRED_CUES =
  /\b(required|must have|must be|minimum|at least|essential|mandatory|proficien(t|cy)|expertise in|strong (background|experience|knowledge))\b/i;
const NICE_CUES =
  /\b(nice to have|preferred|a plus|bonus|desirable|ideally|familiarity with|exposure to)\b/i;

/** Widest phrase the lexicon scan considers; every lexicon entry is 1-3 tokens. */
const MAX_PHRASE_TOKENS = 3;

/** Keywords returned per posting. Enough to score on, few enough to render. */
const MAX_KEYWORDS = 25;

/** Requirement lines kept, and the character cap on each, so a row stays small. */
const MAX_REQUIREMENTS = 8;
const REQUIREMENT_MAX_CHARS = 160;

/** Below this many tokens a "requirement" is a header or a fragment, not a line. */
const MIN_REQUIREMENT_TOKENS = 3;

/** How many pass-B guesses may join the lexicon hits, and at what weight. */
const FREE_TEXT_LIMIT = 15;
const FREE_TEXT_WEIGHT = 0.5;

/** A curated tag outranks a lexicon hit: a human chose it for this posting. */
const TAG_WEIGHT = 1.2;

/** In snippet mode the title is the only trustworthy field, so it outweighs the body. */
const SNIPPET_TITLE_BOOST = 1.6;

/** Decimals kept on an emitted weight. */
const WEIGHT_DECIMALS = 4;

/**
 * Resolve a candidate n-gram to a lexicon entry, trying the literal phrase, the
 * whole-phrase alias, and finally a per-token alias fold.
 *
 * Aliasing is done on whole tokens/phrases and never as a string replacement —
 * `'jsx'.replace('js', 'javascript')` is exactly the bug this avoids.
 *
 * @param {string} phrase Space-joined n-gram, already normalized.
 * @param {boolean} isUnigram True for single tokens, which get the stopword guard.
 * @returns {{canonical: string, category: string, weight: number}|null}
 */
function resolveTerm(phrase, isUnigram) {
  // Single tokens that are stopwords are never skills even when they collide
  // with a lexicon entry ("less experience" must not emit the Less
  // preprocessor). Multi-word phrases are safe because they are specific.
  if (isUnigram && (STOPWORDS.has(phrase) || NEVER_EMIT.has(phrase))) return null;

  const direct = SKILL_LEXICON.get(phrase);
  if (direct) return direct;

  const aliased = ALIASES.get(phrase);
  if (aliased) {
    const entry = SKILL_LEXICON.get(aliased);
    if (entry) return entry;
  }

  const folded = phrase
    .split(' ')
    .map((token) => ALIASES.get(token) ?? token)
    .join(' ');
  if (folded !== phrase) {
    const entry = SKILL_LEXICON.get(folded);
    if (entry) return entry;
    const foldedAlias = ALIASES.get(folded);
    if (foldedAlias) {
      const aliasedEntry = SKILL_LEXICON.get(foldedAlias);
      if (aliasedEntry) return aliasedEntry;
    }
  }
  return null;
}

/**
 * Is this token worthless as keyword output on its own?
 *
 * The same three-way test gates every place a bare token can escape into the
 * result: the free-text fallback, its bigram partner, and `foldToLexicon`.
 *
 * @param {string} token Normalized token.
 * @returns {boolean}
 */
function isNoiseToken(token) {
  return STOPWORDS.has(token) || NEVER_EMIT.has(token) || PHRASE_BREAKERS.has(token);
}

/**
 * May an UNRECOGNISED curated tag be emitted at {@link TAG_WEIGHT}?
 *
 * A tag the lexicon knows is a human vouching for a real skill and keeps its
 * trust boost. A tag it does not know gets kept verbatim at the highest weight
 * in the system, so it has to clear the same noise bar free text does — or
 * Remotive's standard `['Remote','Full Time','Senior']` sorts straight to the
 * top of the capped-25 output and inflates the prefilter denominator with terms
 * no resume can usefully match.
 *
 * Seniority words are rejected separately: they are not stopwords (the ladder
 * needs them) but they are consumed by {@link detectSeniority}, not by keyword
 * overlap, so emitting one double-counts a signal that is already handled.
 *
 * @param {string} term Normalized tag text, possibly multi-word.
 * @returns {boolean}
 */
function isEmittableTag(term) {
  if (STOPWORDS.has(term) || NEVER_EMIT.has(term)) return false;
  if (Object.prototype.hasOwnProperty.call(SENIORITY, term)) return false;
  const tokens = term.split(' ');
  return !tokens.every((token) => STOPWORDS.has(token) || NEVER_EMIT.has(token));
}

/**
 * Normalize text and cut it into the token runs the lexicon scan operates on:
 * one run per punctuation-delimited chunk, empty chunks dropped.
 *
 * @param {unknown} text Any input; non-strings yield `[]`.
 * @returns {string[][]} Token lists in document order.
 */
function chunkTokens(text) {
  const chunks = [];
  for (const chunk of normalizeText(text).split(CHUNK_SPLIT)) {
    const tokens = tokenize(chunk);
    if (tokens.length) chunks.push(tokens);
  }
  return chunks;
}

/**
 * Merge one observation into the accumulator.
 *
 * `weight` takes the max (a tag-sourced 1.2 should not be dragged down by a
 * later 1.0 lexicon hit) while `required` is a logical OR — one required
 * mention makes the term required for the whole posting.
 *
 * @param {Map<string, TermEntry>} acc Mutated in place.
 * @param {string} term Canonical term.
 * @param {number} weight Weight of this observation.
 * @param {boolean} required Whether this observation was in a required context.
 * @param {string} category Lexicon category, or a pseudo-category like `tag`.
 * @returns {void}
 */
function accumulate(acc, term, weight, required, category) {
  const prev = acc.get(term);
  if (prev) {
    prev.count += 1;
    if (weight > prev.weight) prev.weight = weight;
    if (required) prev.required = true;
    return;
  }
  acc.set(term, { term, weight, required: Boolean(required), count: 1, category });
}

/**
 * Longest-match-wins lexicon scan over one punctuation-free chunk.
 *
 * Matched spans are marked consumed so that "machine learning engineer" cannot
 * also emit a bare "learning" from inside itself. Without consumption every
 * multi-word skill double-counts its own parts and inflates the score.
 *
 * @param {string[]} tokens Tokens of a single chunk.
 * @param {boolean} required Effective required flag for the containing segment.
 * @param {Map<string, TermEntry>} acc Accumulator, mutated in place.
 * @returns {boolean[]} Consumption mask, parallel to `tokens`.
 */
function scanChunk(tokens, required, acc) {
  const consumed = new Array(tokens.length).fill(false);
  for (let width = MAX_PHRASE_TOKENS; width >= 1; width -= 1) {
    for (const gram of ngrams(tokens, width)) {
      let free = true;
      for (let i = gram.start; i <= gram.end; i += 1) {
        if (consumed[i]) {
          free = false;
          break;
        }
      }
      if (!free) continue;
      if (width > 1) {
        let spansBreaker = false;
        for (let i = gram.start; i <= gram.end; i += 1) {
          if (PHRASE_BREAKERS.has(tokens[i])) {
            spansBreaker = true;
            break;
          }
        }
        if (spansBreaker) continue;
      }
      const entry = resolveTerm(gram.text, width === 1);
      if (!entry) continue;
      accumulate(acc, entry.canonical, entry.weight, required, entry.category);
      for (let i = gram.start; i <= gram.end; i += 1) consumed[i] = true;
    }
  }
  return consumed;
}

/**
 * Classify a segment against the heading regexes.
 * @param {string} segment Raw (un-normalized) segment text.
 * @returns {{mode: 'required'|'nice'|'neutral', match: RegExpMatchArray}|null}
 */
function headingOf(segment) {
  const trimmed = segment.trim();
  if (!trimmed || trimmed.length >= HEADING_MAX_CHARS) return null;
  let match = trimmed.match(REQUIRED_HEADING);
  if (match) return { mode: 'required', match };
  match = trimmed.match(NICE_HEADING);
  if (match) return { mode: 'nice', match };
  match = trimmed.match(NEUTRAL_HEADING);
  if (match) return { mode: 'neutral', match };
  return null;
}

/**
 * Run the lexicon pass over an arbitrary piece of text (used for the title and
 * for tag folding, where segmentation is irrelevant).
 * @param {unknown} text Any input.
 * @returns {Map<string, TermEntry>} Accumulator of canonical terms.
 */
function lexiconTermsOf(text) {
  const acc = new Map();
  for (const tokens of chunkTokens(text)) scanChunk(tokens, false, acc);
  return acc;
}

/**
 * Fold a short free-text phrase (a resume skill, a tag) into lexicon
 * vocabulary, so resume-side and job-side terms end up in the same namespace.
 *
 * Lexicon hits keep their category weight; anything the lexicon does not know
 * is still returned as a literal term at free-text weight, because an unknown
 * skill is unknown to us, not absent from the candidate.
 *
 * @param {unknown} text A skill, tag or short phrase.
 * @returns {Array<{term: string, weight: number, category: string}>} Possibly empty, never null.
 */
export function foldToLexicon(text) {
  const folded = [];
  const seen = new Set();
  for (const tokens of chunkTokens(text)) {
    const acc = new Map();
    const consumed = scanChunk(tokens, false, acc);
    for (const entry of acc.values()) {
      if (seen.has(entry.term)) continue;
      seen.add(entry.term);
      folded.push({ term: entry.term, weight: entry.weight, category: entry.category });
    }
    for (let i = 0; i < tokens.length; i += 1) {
      if (consumed[i]) continue;
      const token = tokens[i];
      if (isNoiseToken(token) || seen.has(token)) continue;
      seen.add(token);
      folded.push({ term: token, weight: FREE_TEXT_WEIGHT, category: 'freetext' });
    }
  }
  return folded;
}

/**
 * Extract weighted keywords, required-vs-nice classification, requirement
 * lines and title hints from a job posting.
 *
 * The single highest-yield heuristic here is the heading state machine: real
 * postings signal what is mandatory with a "Requirements:"/"Nice to have:"
 * header and then list bare bullets underneath, so the mode set by a header
 * PERSISTS across the following segments until the next header. Per-segment
 * cue phrases ("must have", "a plus") override just their own segment.
 *
 * @param {unknown} text Job description; HTML is fine, non-strings yield an empty result.
 * @param {{source?: string, title?: string, category?: string, tags?: string[], quality?: string}} [opts]
 *   `source` and `category` are accepted for provenance and are not used in the
 *   scoring today. `quality: 'snippet'` switches on truncated-description mode.
 * @returns {{keywords: Array<{term: string, weight: number, required: boolean, count: number}>,
 *   requirements: string[], titles: string[]}} Keywords are capped at 25 and
 *   sorted by `weight * log2(1 + count)` descending, ties broken alphabetically
 *   so the output is byte-stable for a given input.
 */
export function extractKeywords(text, opts = {}) {
  const options = asObject(opts);
  // Tags come off first but newlines are kept, because the heading state
  // machine below runs on line structure and most boards send HTML — a
  // "Requirements" header wrapped in <h2> has to be visible to the regexes.
  // Horizontal whitespace is collapsed so requirement lines read cleanly.
  const plainText = stripHtml(text).replace(HORIZONTAL_WHITESPACE, ' ');
  // Adzuna truncates descriptions to ~200 characters. There are no headers in
  // 200 characters, so anything we marked "required" would be a guess, and a
  // required-weighted score built on a guess is worse than no signal at all.
  const isSnippet = options.quality === 'snippet';

  /** @type {Map<string, TermEntry>} */
  const acc = new Map();
  const chunkRecords = [];
  const requirements = [];
  const titleHints = new Set();

  let mode = 'neutral';

  for (const segment of plainText.split(SEGMENT_SPLIT)) {
    if (!segment.trim()) continue;

    const heading = headingOf(segment);
    if (heading) mode = heading.mode;

    let effectiveMode = mode;
    if (REQUIRED_CUES.test(segment)) effectiveMode = 'required';
    else if (NICE_CUES.test(segment)) effectiveMode = 'nice';
    if (isSnippet) effectiveMode = 'neutral';

    const required = effectiveMode === 'required';

    if (required && requirements.length < MAX_REQUIREMENTS) {
      // A bare "Requirements:" line is a label, not a requirement.
      const body = heading
        ? segment.trim().slice(heading.match[0].length).replace(HEADING_LABEL_TAIL, '')
        : segment.trim();
      if (tokenize(body).length >= MIN_REQUIREMENT_TOKENS) {
        requirements.push(segment.trim().slice(0, REQUIREMENT_MAX_CHARS));
      }
    }

    for (const tokens of chunkTokens(segment)) {
      for (const token of tokens) if (TITLE_TOKENS.has(token)) titleHints.add(token);
      chunkRecords.push({ tokens, consumed: scanChunk(tokens, required, acc) });
    }
  }

  // --- Pass B: free-text fallback over whatever the lexicon did not claim. ---
  // These are guesses, so they get half weight and are NEVER marked required —
  // telling a user a term is mandatory on the strength of word frequency is the
  // kind of wrong that costs them an application.
  const freeCounts = new Map();
  for (const { tokens, consumed } of chunkRecords) {
    for (let i = 0; i < tokens.length; i += 1) {
      if (consumed[i]) continue;
      const token = tokens[i];
      if (isNoiseToken(token)) continue;
      freeCounts.set(token, (freeCounts.get(token) ?? 0) + 1);
      const next = tokens[i + 1];
      if (next === undefined || consumed[i + 1]) continue;
      if (isNoiseToken(next)) continue;
      const bigram = `${token} ${next}`;
      freeCounts.set(bigram, (freeCounts.get(bigram) ?? 0) + 1);
    }
  }
  const freeRanked = [...freeCounts.entries()]
    .filter(([term]) => !acc.has(term))
    .sort(([termA, countA], [termB, countB]) => (countB - countA) || compareStrings(termA, termB))
    .slice(0, FREE_TEXT_LIMIT);
  for (const [term, count] of freeRanked) {
    acc.set(term, { term, weight: FREE_TEXT_WEIGHT, required: false, count, category: 'freetext' });
  }

  // --- Curated tags (Remotive supplies these) trust-boost above the lexicon. ---
  const tags = Array.isArray(options.tags) ? options.tags : [];
  for (const tag of tags) {
    const normalized = normalizeText(tag);
    if (!normalized) continue;
    const hits = lexiconTermsOf(normalized);
    // A tag the lexicon does not recognise is still a human-curated signal, so
    // it is kept verbatim rather than dropped — but only if it clears the same
    // noise filter free text does. See {@link isEmittableTag}.
    let terms;
    if (hits.size) terms = [...hits.keys()];
    else terms = isEmittableTag(normalized) ? [normalized] : [];
    for (const term of terms) {
      if (NEVER_EMIT.has(term)) continue;
      const prev = acc.get(term);
      if (prev) {
        if (TAG_WEIGHT > prev.weight) prev.weight = TAG_WEIGHT;
      } else {
        acc.set(term, { term, weight: TAG_WEIGHT, required: false, count: 1, category: 'tag' });
      }
    }
  }

  // --- Snippet mode: the title is the one field Adzuna does not truncate. ---
  const titleText = typeof options.title === 'string' ? options.title : '';
  if (isSnippet && titleText) {
    for (const [term, entry] of lexiconTermsOf(titleText)) {
      const prev = acc.get(term);
      if (prev) {
        prev.weight *= SNIPPET_TITLE_BOOST;
      } else {
        acc.set(term, {
          term,
          weight: entry.weight * SNIPPET_TITLE_BOOST,
          required: false,
          count: 1,
          category: entry.category,
        });
      }
    }
  }

  const keywords = [...acc.values()]
    .map((entry) => ({
      term: entry.term,
      weight: roundTo(entry.weight, WEIGHT_DECIMALS),
      required: entry.required,
      count: entry.count,
    }))
    .sort((a, b) => {
      const scoreA = a.weight * Math.log2(1 + a.count);
      const scoreB = b.weight * Math.log2(1 + b.count);
      if (scoreB !== scoreA) return scoreB - scoreA;
      return compareStrings(a.term, b.term);
    })
    .slice(0, MAX_KEYWORDS);

  const titles = [...titleHints].sort();
  const normalizedTitle = normalizeText(titleText);
  if (normalizedTitle && !titles.includes(normalizedTitle)) titles.unshift(normalizedTitle);

  return { keywords, requirements, titles };
}
