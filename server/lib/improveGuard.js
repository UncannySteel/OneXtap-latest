/**
 * The Improve guard for POST /api/answer-vault/generate
 * (server/routes/generate.js).
 *
 * ═══ WHY ═══
 *
 * Improve rewrites a draft the user already has, and it is where invented
 * figures came from: one real run (HANDOVER §7 item 32) took a draft with one
 * claim the resume does not back to four, every one of them flagged. The
 * prompt now forbids adding facts (IMPROVE_FACTS_RULE in
 * server/prompts/answerVault.js). This is the check behind the prompt.
 *
 * ═══ WHAT IT DOES ═══
 *
 * After the model answers, the new draft's unbacked claims are counted
 * against the old draft's, with the same deterministic check the route
 * returns to the user (validateAgainstCorpus, src/matching/fabrication.js).
 * More than before means the model added something, and it is asked ONCE
 * more, in the same request, with the offending claims listed. The answer
 * with fewer unbacked claims is kept; a tie keeps the first.
 *
 * "Offending" is narrower than "flagged": a flagged sentence that the old
 * draft itself backs is the user's own fact restated, which the rule allows.
 * So the claims quoted back are the ones grounded by neither the resume nor
 * the draft, and when there are none the extra flags are a reworded draft and
 * nothing is retried.
 *
 * The organisation and role the application is FOR are grounded too: the
 * rule lets the answer name them, so naming them must not count as a new
 * claim. Only the labelled header lines of the job context are read
 * ({@link applicationTargets}), never the description: a posting's
 * requirements would otherwise "back" skills the user never claimed.
 *
 * ═══ WHO IT RUNS FOR ═══
 *
 * Answer Studio's Improve only: the route calls it for an explicit
 * `kind: 'answer'` with a draft. Not cover letters, whose draft is a template
 * and whose task names the company, the role and the posting's requirements;
 * not clients that send no kind, which get exactly the request they always
 * had.
 *
 * ═══ THE TIME BUDGET ═══
 *
 * The request is charged before the model runs, and the client stops waiting
 * after AI_TIMEOUT_SEC (90s, src/answerStudio.js): an answer that lands after
 * that is paid for and never shown. So the retry only starts within
 * IMPROVE_RETRY_LATEST_START_MS of the request starting, and runs under its
 * own IMPROVE_RETRY_TIMEOUT_MS: the latest a retry can finish is 45s in, half
 * the client's wait. A first draft that already took longer than that (the
 * Groq chain is two models at 20s each, GROQ_TIMEOUT_MS) is returned as it is.
 *
 * ═══ WHAT IT NEVER DOES ═══
 *
 *   - Retry twice. One retry, whatever it returns. The note on
 *     validateAgainstCorpus still holds for everything else: a
 *     regenerate-until-clean loop hides the failure and converges on bland
 *     text. Here the trigger is narrow (the model added claims the draft did
 *     not have) and the cost is bounded (one call).
 *   - Fail the request. A retry that throws, comes back blank, or does not
 *     help leaves the first answer, exactly as the request would have
 *     returned it without this guard.
 *   - Charge or count again. The retry is inside the request that was
 *     already charged and already counted once for the hourly cap.
 *   - Hide anything. The route still returns the fabrication flags of
 *     whichever answer is kept.
 *   - Log text. Counts only: the claims are the user's profile material
 *     (CLAUDE.md rules 8 and 11).
 *
 * The model call is injected (`regenerate`), so all of this is testable
 * without Groq: test/server/improveGuard.test.js.
 */
import { validateAgainstCorpus, segmentClaims } from '../../src/matching/index.js';
import { groqAssistantMessageText, GROQ_MAX_TOKENS } from '../groqClient.js';
import { buildImproveRetryMessage } from '../prompts/answerVault.js';
import { log } from '../logger.js';

const guardLog = log.child('improve');

/**
 * The route's sampling temperature for Answer Studio (server/routes/generate.js),
 * repeated here so the retry samples like the answer it replaces.
 */
const ANSWER_TEMPERATURE = 0.35;

/** Below this many non-space characters a reply is not an answer (the route's own floor). */
const MIN_ANSWER_CHARS = 8;

/**
 * No retry starts later than this after the request began. With
 * {@link IMPROVE_RETRY_TIMEOUT_MS} the worst case is 45s, half of the
 * client's 90s (AI_TIMEOUT_SEC in src/answerStudio.js); the rest is margin for
 * the network, the spend and its undo. test/server/improveGuard.test.js
 * checks the sum against AI_TIMEOUT_SEC.
 */
export const IMPROVE_RETRY_LATEST_START_MS = 30_000;

/**
 * The retry call's own timeout, passed per request to groq-sdk (0.15's
 * `create(body, { timeout })`), with no SDK retries. A healthy Answer Studio
 * completion takes a few seconds; one that has not answered in 15 is better
 * dropped in favour of the first answer the user already paid for.
 */
export const IMPROVE_RETRY_TIMEOUT_MS = 15_000;

/** The header labels that name the application's organisation or role. */
const TARGET_LINE = /^\s*(?:company|organi[sz]ation|employer|role|position|job title|title)\s*:\s*(.+?)\s*$/i;

/** What the clients write when the field was left empty. */
const TARGET_PLACEHOLDER = /^(?:not specified|not provided|n\/a|none|-)$/i;

/** Characters kept of one target name. */
const TARGET_MAX_CHARS = 120;

/**
 * The organisation and role an application is for, from the labelled lines
 * the clients put at the head of `jobContext`: Answer Studio's
 * "Company: …", the cover letter's "Organization: …" and "Role: …".
 *
 * Reads leading lines only and stops at the first line that is blank or not a
 * label, so the description below the header is never read, even where it
 * happens to contain "Role:".
 *
 * @param {unknown} jobContext The request's job context.
 * @returns {string[]} Names, in order; empty when there is no header.
 */
export function applicationTargets(jobContext) {
  if (typeof jobContext !== 'string' || !jobContext) return [];
  const targets = [];
  for (const line of jobContext.split(/\r?\n/)) {
    const match = TARGET_LINE.exec(line);
    if (!match) break;
    const name = match[1].slice(0, TARGET_MAX_CHARS).trim();
    if (name && !TARGET_PLACEHOLDER.test(name)) targets.push(name);
  }
  return targets;
}

/**
 * The old draft as corpus items, one per sentence, for the "offending" test:
 * a claim either source grounds is not one the model added.
 *
 * Sentences rather than the whole draft as one item, because numerals are
 * grounded against the items a claim is ABOUT (see the numeral gate in
 * fabrication.js), and one long item would lend every number in the draft to
 * every claim.
 *
 * @param {string} draft
 * @returns {Array<{ref: string, text: string}>}
 */
function draftItems(draft) {
  return segmentClaims(draft, { minClaimTokens: 1 }).map((text) => ({ ref: 'draft', text }));
}

/**
 * Run the Improve guard over one generated answer.
 *
 * Total: a missing or malformed argument returns the answer it was given.
 *
 * @param {object} [params]
 * @param {string} params.draft The draft the user asked to improve. Empty means
 *   this was a first draft, and nothing is checked.
 * @param {string} params.text The model's improved answer.
 * @param {Array<{ref?: string|null, text: string}>} params.corpus The resume
 *   corpus, already sanitized by the route. Empty means nothing to check.
 * @param {(correction: string) => Promise<string>} params.regenerate One more
 *   model call; see {@link createGroqRetry}.
 * @param {string} [params.jobContext] The request's job context; only its
 *   organisation and role header lines are read ({@link applicationTargets}).
 * @param {number} [params.startedAt] When the request began (ms since the
 *   epoch). No retry starts after IMPROVE_RETRY_LATEST_START_MS of it.
 * @param {() => number} [params.now] Injected for tests.
 * @param {typeof validateAgainstCorpus} [params.validate] Injected for tests.
 * @returns {Promise<{text: string, retried: boolean, kept: 'first'|'retry',
 *   reason: string}>} `reason` is a stable slug for the log line.
 */
export async function guardImprovedDraft(params = {}) {
  const {
    draft,
    text,
    corpus,
    regenerate,
    jobContext,
    startedAt,
    now = Date.now,
    validate = validateAgainstCorpus,
  } = params && typeof params === 'object' ? params : {};

  const first = typeof text === 'string' ? text : '';
  const keepFirst = (reason, retried = false) => ({ text: first, retried, kept: 'first', reason });

  const oldDraft = typeof draft === 'string' ? draft.trim() : '';
  if (!oldDraft || !first || !Array.isArray(corpus) || corpus.length === 0) return keepFirst('not_improve');
  if (typeof regenerate !== 'function') return keepFirst('no_model');

  // The resume, plus the names the answer is allowed to use because the
  // application is addressed to them. Counted the same way on both drafts.
  const targets = applicationTargets(jobContext).map((name) => ({ ref: 'target', text: name }));
  const grounded = [...corpus, ...targets];

  const before = validate(oldDraft, grounded).flags.length;
  const after = validate(first, grounded).flags.length;
  if (after <= before) return keepFirst('no_new_claims');

  const offending = validate(first, [...grounded, ...draftItems(oldDraft)]).flags.map((flag) => flag.claim);
  if (offending.length === 0) {
    guardLog.debug('improve added flags, all backed by the draft; not retried', { before, after });
    return keepFirst('draft_backed');
  }

  const elapsedMs = Number.isFinite(startedAt) ? now() - startedAt : 0;
  if (elapsedMs > IMPROVE_RETRY_LATEST_START_MS) {
    guardLog.info('improve retry skipped, the request has already run long', { before, after, elapsedMs });
    return keepFirst('out_of_time');
  }

  let second = '';
  try {
    second = String((await regenerate(buildImproveRetryMessage(offending))) ?? '').trim();
  } catch (err) {
    guardLog.warn('improve retry failed, keeping the first answer', {
      before,
      after,
      errName: err?.name,
      status: err?.status ?? err?.statusCode ?? null,
    });
    return keepFirst('retry_failed', true);
  }
  if (!second) {
    guardLog.warn('improve retry came back empty, keeping the first answer', { before, after });
    return keepFirst('retry_failed', true);
  }

  const retryFlags = validate(second, grounded).flags.length;
  const helped = retryFlags < after;
  guardLog.info('improve retried once for unbacked claims', {
    before,
    after,
    offending: offending.length,
    retry: retryFlags,
    kept: helped ? 'retry' : 'first',
  });
  return helped
    ? { text: second, retried: true, kept: 'retry', reason: 'retry_helped' }
    : keepFirst('retry_did_not_help', true);
}

/**
 * The production `regenerate`: one Groq completion that continues the
 * conversation the first answer came from.
 *
 * The first answer goes back as the assistant turn and the correction follows
 * it, so the model edits its own text rather than starting over. One model and
 * no fallback chain: this is a second attempt, not a second request, and
 * whatever goes wrong here costs only the retry (the guard keeps the first
 * answer).
 *
 * Its errors propagate; the guard decides that a failed retry is the first
 * answer. A reply the route itself would refuse (a refusal, an empty or
 * near-empty text, an answer cut off at the token limit) is an error too.
 *
 * @param {object} params
 * @param {{chat: {completions: {create: Function}}}} params.groq The client from getGroq().
 * @param {string} params.model The model that wrote the first answer.
 * @param {string} params.system The system instruction the first answer was written under.
 * @param {string} params.user The user message the first answer was written for.
 * @param {string} params.previous The first answer.
 * @returns {(correction: string) => Promise<string>}
 */
export function createGroqRetry({ groq, model, system, user, previous }) {
  return async function regenerate(correction) {
    const completion = await groq.chat.completions.create(
      {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
          { role: 'assistant', content: previous },
          { role: 'user', content: correction },
        ],
        temperature: ANSWER_TEMPERATURE,
        max_tokens: GROQ_MAX_TOKENS,
      },
      // Its own bound, not the client's default: see IMPROVE_RETRY_TIMEOUT_MS.
      { timeout: IMPROVE_RETRY_TIMEOUT_MS, maxRetries: 0 },
    );

    const choice = completion?.choices?.[0];
    if (choice?.message?.refusal && String(choice.message.refusal).trim()) {
      throw new Error('The model declined the retry');
    }
    if (choice?.finish_reason === 'length') throw new Error('The retry hit the model output limit');

    const text = String(groqAssistantMessageText(choice?.message) || '').trim();
    if (text.replace(/\s/g, '').length < MIN_ANSWER_CHARS) throw new Error('The retry returned no usable text');
    return text;
  };
}
