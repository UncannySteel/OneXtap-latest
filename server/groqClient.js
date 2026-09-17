/**
 * The one Groq client, its model chain, and the fallback predicate.
 *
 * ═══ WHY THIS FILE EXISTS ═══
 *
 * Everything in this file lived in server/index.js. The ranking graph needs the
 * same client and, more importantly, the same fallback rule — but it cannot
 * import server/index.js, which builds the Express app and calls app.listen().
 * A second copy of `shouldTryFallbackModel` would drift, and the drift would be
 * invisible: both copies keep working, they just stop agreeing about when a
 * provider error is worth retrying on the smaller model.
 *
 * So the definitions moved here byte-for-byte and server/index.js imports them
 * back. Nothing about their behaviour changed in the move.
 *
 * ═══ THE MODEL NAMES ═══
 *
 * The model constants are read from the `GROQ_MODEL` and `GROQ_FALLBACK_MODEL`
 * environment variables with the same defaults they have always had. Do not
 * "fix" the defaults because a model 404s on one account — a 404 here is an
 * account-entitlement problem, and renaming the constant hides it on every
 * other account instead of fixing it on this one.
 *
 * GROQ_API_KEY is a server credential. It is read from process.env here and
 * must never be renamed to VITE_GROQ_API_KEY: anything VITE_* is inlined into
 * the shipped browser bundle.
 */
import Groq from 'groq-sdk';

/** Answer Studio and the ranking graph both use Groq (fast inference). */
export const GROQ_ANSWER_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
export const GROQ_FALLBACK_MODEL = process.env.GROQ_FALLBACK_MODEL || 'llama-3.1-8b-instant';

/**
 * Output budget for an Answer Studio completion, overridable per deployment.
 *
 * The floor of 256 and the ceiling of 8192 are guard rails on the environment
 * variable, not tuning: below 256 every answer is truncated mid-sentence and
 * the feature looks broken rather than misconfigured, and above 8192 a single
 * runaway completion can outspend a day of normal use. A value outside the
 * band, or one that is not a number at all, falls back to the default rather
 * than propagating a NaN into the provider call.
 */
const GROQ_MAX_TOKENS_FLOOR = 256;
const GROQ_MAX_TOKENS_CEILING = 8192;
const GROQ_MAX_TOKENS_DEFAULT = 4096;

const _groqMaxTok = Number.parseInt(process.env.GROQ_MAX_TOKENS || String(GROQ_MAX_TOKENS_DEFAULT), 10);
export const GROQ_MAX_TOKENS =
  Number.isFinite(_groqMaxTok) && _groqMaxTok >= GROQ_MAX_TOKENS_FLOOR
    ? Math.min(_groqMaxTok, GROQ_MAX_TOKENS_CEILING)
    : GROQ_MAX_TOKENS_DEFAULT;

let groqClient;

/**
 * Lazily construct the shared Groq client.
 *
 * Lazy on purpose: a deploy with no GROQ_API_KEY should fail on the first AI
 * request with a clear message, not at module load with an unrelated stack.
 *
 * @returns {Groq}
 * @throws {Error} When GROQ_API_KEY is unset.
 */
export function getGroq() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('Server missing GROQ_API_KEY');
  if (!groqClient) groqClient = new Groq({ apiKey });
  return groqClient;
}

/**
 * Is this provider failure worth retrying on the next model in the chain?
 *
 * Shared by Gemini (parse-resume), Groq (Answer Studio) and the ranking graph,
 * which is the point: one answer to "is this transient or is this us".
 *
 * @param {number|undefined} statusCode HTTP status, when there was one.
 * @param {unknown} message Provider error text.
 * @returns {boolean}
 */
export function shouldTryFallbackModel(statusCode, message) {
  if (statusCode === 404 || statusCode === 429) return true;
  if (statusCode >= 500) return true;

  const text = String(message || '').toLowerCase();
  return (
    text.includes('not found') ||
    text.includes('no longer available') ||
    text.includes('not supported') ||
    text.includes('overloaded') ||
    text.includes('temporarily unavailable') ||
    text.includes('quota') ||
    text.includes('no text') ||
    text.includes('blocked') ||
    text.includes('safety')
  );
}

/**
 * Groq/OpenAI-style messages may use string or array content parts.
 * @param {object|null|undefined} message
 * @returns {string}
 */
export function groqAssistantMessageText(message) {
  if (!message || typeof message !== 'object') return '';
  const c = message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part.text === 'string') return part.text;
        return '';
      })
      .join('');
  }
  return '';
}
