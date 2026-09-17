/**
 * Lenient JSON extraction for LLM output.
 *
 * ═══ WHY THIS FILE EXISTS ═══
 *
 * `extractFirstJsonObject` and `parseJsonLenient` lived inside server/index.js
 * and were battle-tested there against real Gemini and Groq responses: fenced
 * blocks, a sentence of preamble before the JSON, trailing commas. The ranking
 * graph needs exactly that behaviour and cannot import server/index.js — that
 * module builds the Express app and calls app.listen(), so importing it from a
 * unit test would boot a server.
 *
 * So the functions moved here unchanged and server/index.js imports them back.
 * There is one parser in this repo and this is it. If you are about to write a
 * `JSON.parse` with a regex in front of it, use these instead.
 *
 * ═══ THE ARRAY VARIANT ═══
 *
 * The rank prompt returns a top-level ARRAY, not an object, and the original
 * scanner would have silently returned only the first element: it searches for
 * `{`, so given `[{a},{b}]` it finds the `{` at index 1 and stops at that
 * object's closing brace. Half a batch would vanish with no error.
 *
 * Rather than add a second scanner, the balanced-bracket walk is parameterised
 * on the bracket pair and both public extractors are one-line wrappers over it.
 * `extractFirstJsonObject('...')` behaves exactly as it did before the move.
 */

/**
 * Walk a string and return the first balanced `open`…`close` slice, ignoring
 * brackets inside JSON string literals and honouring backslash escapes.
 *
 * @param {unknown} text Anything; a non-string yields null.
 * @param {string} open Opening bracket, `{` or `[`.
 * @param {string} close Matching closing bracket.
 * @returns {string|null} The slice, or null when there is no balanced pair.
 */
function extractFirstBalanced(text, open, close) {
  if (typeof text !== 'string') return null;

  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith(open) && trimmed.endsWith(close)) return trimmed;

  const start = trimmed.indexOf(open);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth += 1;
    if (ch === close) {
      depth -= 1;
      if (depth === 0) return trimmed.slice(start, i + 1);
    }
  }

  return null;
}

/**
 * First balanced `{...}` in the text.
 * @param {unknown} text
 * @returns {string|null}
 */
export function extractFirstJsonObject(text) {
  return extractFirstBalanced(text, '{', '}');
}

/**
 * First balanced `[...]` in the text.
 * @param {unknown} text
 * @returns {string|null}
 */
export function extractFirstJsonArray(text) {
  return extractFirstBalanced(text, '[', ']');
}

/** Remove a leading ```json fence and a trailing fence, then trim. */
function stripFences(raw) {
  return String(raw || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

/** Models emit `{"a": 1,}` often enough that this is cheaper than a retry. */
function dropTrailingCommas(candidate) {
  return candidate.replace(/,\s*([}\]])/g, '$1');
}

/**
 * Parse a model response expected to contain a JSON object.
 * @param {unknown} raw
 * @returns {any}
 * @throws {SyntaxError} When nothing in the text parses.
 */
export function parseJsonLenient(raw) {
  const stripped = stripFences(raw);
  const candidate = extractFirstJsonObject(stripped) || stripped;
  return JSON.parse(dropTrailingCommas(candidate));
}

/**
 * Parse a model response expected to contain a JSON array.
 *
 * Also accepts the common near-miss where the model wraps the array in an
 * object (`{"results": [...]}`): the first array-valued property is taken.
 * That is a recovery, not a second format — the prompt asks for a bare array.
 *
 * @param {unknown} raw
 * @returns {any[]}
 * @throws {SyntaxError} When nothing in the text parses as an array.
 */
export function parseJsonArrayLenient(raw) {
  const stripped = stripFences(raw);

  const arrayCandidate = extractFirstJsonArray(stripped);
  if (arrayCandidate) {
    try {
      const parsed = JSON.parse(dropTrailingCommas(arrayCandidate));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Fall through to the wrapped-object recovery below rather than failing
      // here: a balanced [...] that does not parse is often an array nested in
      // an object whose own braces the walk never reached.
    }
  }

  const wrapped = parseJsonLenient(stripped);
  if (Array.isArray(wrapped)) return wrapped;
  if (wrapped && typeof wrapped === 'object') {
    for (const value of Object.values(wrapped)) {
      if (Array.isArray(value)) return value;
    }
  }

  throw new SyntaxError('Model response contained no JSON array');
}
