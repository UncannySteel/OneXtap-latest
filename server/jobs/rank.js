/**
 * LLM ranking of a candidate against a batch of jobs.
 *
 * ═══ THE ONE RULE ═══
 *
 * **Every job that goes in comes out, exactly once.** A model that returns
 * eleven objects for ten jobs, or renumbers the ids, or emits a score of
 * "high", or truncates mid-array, or 404s because an account lost access to a
 * model — none of that may remove a job from the user's list. A job the model
 * failed to score falls back to the local keyword scorer and is marked
 * `scoredBy: 'keyword'`, so the list stays complete and the degradation is
 * visible rather than silent.
 *
 * This is not defensive padding. It is the difference between "the ranking is
 * worse today" and "half your search results vanished and nobody can say
 * which half".
 *
 * ═══ callModel IS INJECTED ═══
 *
 * `rankBatch` never constructs a client. It is handed an async function with
 * the signature `({system, user, maxTokens, temperature}) => string`, which
 * means the whole of this file — batching, concurrency, parsing, clamping,
 * fallback, span bookkeeping — is testable with a stub that returns a string,
 * and stays testable when the provider is down or an account's models are
 * retired. `createGroqModelCaller()` is the production implementation and is
 * the only thing in here that knows Groq exists.
 */
import { fallbackScoreJob } from '../../src/matching/index.js';
import { getPrompt } from './prompts/index.js';
import { parseJsonArrayLenient } from '../llmJson.js';
import {
  getGroq,
  groqAssistantMessageText,
  shouldTryFallbackModel,
  GROQ_ANSWER_MODEL,
  GROQ_FALLBACK_MODEL,
} from '../groqClient.js';
import { SpanType } from '../observability/opik.js';
import { toMatcherJob } from './query.js';
import { log } from '../logger.js';

const rankLog = log.child('rank');

/**
 * Read a bounded integer from the environment.
 *
 * Same shape as the guards in server/groqClient.js: a value that is missing,
 * unparseable, or outside the band falls back to the default rather than
 * propagating a NaN into a provider call or a chunk size.
 */
function envInt(name, fallback, floor, ceiling) {
  const raw = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(raw) && raw >= floor && raw <= ceiling ? raw : fallback;
}

/**
 * Jobs per model call.
 *
 * ═══ WHY THIS WENT FIVE → FIFTEEN → THIRTY ═══
 *
 * Five was chosen so one bad response cost five jobs rather than thirty, and so
 * each job got the model's attention on its own merits rather than being ranked
 * against its batch-mates. Both of those are still true and still good reasons.
 * They were outweighed by the prompt overhead: the instructions are ~1,440
 * tokens (measured), so at five jobs a batch they are re-sent six times to
 * score thirty — the rules costing more than the data.
 *
 * Fifteen amortised that. Thirty finishes the job for the PRIMARY provider, and
 * that qualifier is the whole point of this number now.
 *
 * ═══ THE TWO TIERS ARE RATIONED ALONG DIFFERENT AXES ═══
 *
 * Measured on the live accounts, not estimated:
 *
 *   Gemini  20 generateContent REQUESTS PER DAY, per model. Wants few, large
 *           calls. A 30-job pass in one call costs 1 of 20 instead of 2.
 *   Groq    8,000 TOKENS PER MINUTE, output included. Wants small calls. A
 *           30-job batch cannot fit: ~1,440 fixed + 30 jobs + ~3,600 output
 *           clears 8k on its own.
 *
 * So there is no single number that is right for both, and this one is sized
 * for Gemini because Gemini leads the chain (see createRankModelCaller in
 * server/index.js) and, with model rotation, answers nearly every pass.
 *
 * A deployment that sets RANK_PROVIDER=groq should set RANK_BATCH_SIZE=10 with
 * it. At 30 the Groq leg rejects the request outright rather than degrading
 * gracefully, which is the one failure mode this file otherwise never has.
 */
const BATCH_SIZE_DEFAULT = 30;
export const BATCH_SIZE = envInt('RANK_BATCH_SIZE', BATCH_SIZE_DEFAULT, 1, 60);

/**
 * Batches in flight at once.
 *
 * One, not two. Two was sized for wall-clock when a pass was several batches,
 * and on a token-per-minute tier it is precisely what trips the limiter: the
 * whole burst is weighed against the window at once, so two 4k batches issued
 * together are a single 8k request as far as the limiter is concerned. That is
 * the measured cause of the Groq leg failing on its first pair rather than
 * degrading over a run.
 *
 * At the default BATCH_SIZE a 30-job pass is one batch and this changes
 * nothing. It matters when PREFILTER_LIMIT grows or RANK_BATCH_SIZE is lowered
 * for Groq — exactly the cases where bursting would hurt.
 */
export const RANK_CONCURRENCY = envInt('RANK_CONCURRENCY', 1, 1, 8);

/**
 * Output budget per batch.
 *
 * Scaled with BATCH_SIZE: a scored job costs ~120 output tokens, so thirty need
 * ~3,600 and this leaves genuine headroom above that. Undersizing it is not a
 * smaller answer but a TRUNCATED one — the JSON array stops mid-object, the
 * parse recovers what it can, and the rest of the batch silently falls to the
 * keyword scorer. This must be raised alongside BATCH_SIZE, never after.
 */
export const RANK_MAX_TOKENS = envInt('RANK_MAX_TOKENS', 5000, 512, 16000);

/** Low, because this is a judgement task and we want it repeatable. */
export const RANK_TEMPERATURE = 0.2;

/**
 * Matched/missing signals kept per job.
 *
 * Six is a UI bound, not a model bound: a gap list longer than about six items
 * is read as a rejection rather than as advice, and the model will happily
 * return twenty. Trimming here rather than in a renderer means every consumer
 * of a ranked result gets the same bounded list.
 */
const MAX_SIGNALS = 6;

/** Signals quoted back inside the keyword fallback's one-sentence summary. */
const SUMMARY_SIGNALS = 3;

/**
 * Per-field caps on what goes into the prompt.
 *
 * These bound the token cost of one batch, which is the only reason they
 * exist. The ratios matter more than the numbers: a job's extracted keywords
 * are its densest signal so they get the largest budget, requirements are
 * prose and cost more per unit of signal, and a profile past forty skills is
 * describing a career rather than a candidate.
 */
const PROMPT_JOB_KEYWORDS = 25;
const PROMPT_JOB_REQUIREMENTS = 12;
const PROMPT_PROFILE_SKILLS = 40;
const PROMPT_PROFILE_TITLES = 10;

/** Provider error text attached to a span. Enough to diagnose, not a stack. */
const SPAN_ERROR_CHARS = 300;

/**
 * Bucket a provider failure into something a UI can say out loud.
 *
 * Deliberately coarse. The exact message belongs in the log line and the trace,
 * where a developer reads it; what a user needs is whether waiting will help.
 * 'rate_limited' means it will, the others mean it will not.
 *
 * @param {unknown} err
 * @returns {'rate_limited'|'model_unavailable'|'timeout'|'error'}
 */
function classifyDegradeReason(err) {
  const status = err?.status ?? err?.statusCode;
  if (status === 429) return 'rate_limited';
  if (status === 404) return 'model_unavailable';
  if (status === 413) return 'request_too_large';
  const name = String(err?.name || '');
  if (name === 'AbortError' || name === 'TimeoutError') return 'timeout';
  if (Number.isFinite(status) && status >= 500) return 'provider_down';
  return 'error';
}

/** Fallback system framing if a prompt file ever loses its `## Input` heading. */
const SYSTEM_FALLBACK = 'You are a technical recruiter. Follow the instructions below exactly.';

/**
 * Fill `{{PLACEHOLDER}}`s and split a prompt file into a system and a user turn.
 *
 * The prompt files are written as one document: instructions, then an
 * `## Input` section holding the placeholders. Instructions belong in the
 * system turn and data belongs in the user turn — models follow instructions
 * more reliably that way, and it keeps a job description from reading as a
 * continuation of the rules.
 *
 * The split is on the `## Input` heading, and there is a fallback for the day
 * a prompt is rewritten without one: the whole rendered document goes in the
 * user turn under a generic system line. Worse prompting, still correct.
 *
 * Total: a null prompt renders to an empty user turn, and a null `vars` leaves
 * every placeholder in place rather than throwing — an unsubstituted
 * `{{JOBS}}` produces a bad ranking, which rankBatch already degrades from,
 * whereas a throw here would take the batch out on a caller's typo.
 *
 * @param {string} text Prompt file text from getPrompt().
 * @param {Record<string, string>} vars Placeholder name → replacement.
 * @returns {{system: string, user: string}}
 */
export function renderPromptParts(text, vars = {}) {
  const values = vars && typeof vars === 'object' ? vars : {};
  const rendered = String(text || '').replace(/\{\{(\w+)\}\}/g, (match, key) =>
    Object.hasOwn(values, key) ? String(values[key]) : match
  );

  const idx = rendered.search(/^## Input\s*$/m);
  if (idx < 0) return { system: SYSTEM_FALLBACK, user: rendered.trim() };

  const system = rendered.slice(0, idx).trim();
  const user = rendered.slice(idx).trim();
  if (!system || !user) return { system: SYSTEM_FALLBACK, user: rendered.trim() };
  return { system, user };
}

/**
 * Split an array into fixed-size chunks.
 * @param {unknown[]} items
 * @param {number} size
 * @returns {unknown[][]} The last chunk may be shorter; an empty input is [].
 */
function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Coerce whatever the model put in `score` into an integer in [0,100].
 * @param {unknown} value
 * @returns {number|null} null when it is not a number at all, which is the
 *   signal to fall back rather than to invent a zero. A fabricated 0 would
 *   sort the job to the bottom and look deliberate.
 */
function clampScore(value) {
  const n = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/**
 * At most `max` trimmed non-empty strings.
 * @param {unknown} value A non-array yields [].
 * @param {number} [max]
 * @returns {string[]}
 */
function toStringList(value, max = MAX_SIGNALS) {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === 'string' ? v.trim() : String(v ?? '').trim()))
    .filter(Boolean)
    .slice(0, max);
}

/**
 * Coerce whatever the model put in `gapSummary` into a string.
 * @param {unknown} value
 * @returns {string} '' when there was nothing to coerce.
 */
function toGapSummary(value) {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * Identity used to line a model response up with the job it belongs to.
 *
 * Three spellings because a job reaches here from three places: the wire shape
 * (`jobId`), a raw row (`job_id`) and our own surrogate key (`id`). Falling
 * through them costs nothing and means a caller that skipped toClientJob does
 * not silently key every job as ''.
 *
 * @param {object} job
 * @returns {string} '' when the job carries no identity at all.
 */
function jobKey(job) {
  return String(job?.jobId ?? job?.job_id ?? job?.id ?? '');
}

/**
 * Compact, description-free view of a job for the prompt.
 *
 * Deliberately not the full row: the rank pass scores on title, company,
 * location, tags and extracted keywords. Descriptions are reserved for the
 * explain route, where one job justifies the tokens.
 *
 * @param {object} job A client-shaped job (see query.js toClientJob).
 * @returns {object} The description-free view the prompt receives.
 */
function promptJob(job) {
  return {
    jobId: jobKey(job),
    title: job?.title ?? '',
    company: job?.company ?? '',
    location: job?.location ?? '',
    isRemote: job?.isRemote === true,
    jobType: job?.jobType ?? null,
    postedAt: job?.postedAt ?? null,
    descriptionQuality: job?.descriptionQuality || 'full',
    keywords: toStringList(job?.keywordTerms, PROMPT_JOB_KEYWORDS),
    requirements: toStringList(job?.requirements, PROMPT_JOB_REQUIREMENTS),
  };
}

/**
 * Serialise a ResumeProfile (which holds a Map) for the prompt.
 *
 * Heaviest-weighted skills first, because the cap bites on a long career and
 * the terms that survive it should be the ones the resume actually leans on.
 * A caller that passed the parsed shape rather than a built profile still
 * works — `skills` is read as a plain list — which keeps this usable from a
 * route that has not built a profile yet.
 *
 * @param {{keywordSet?: Map<string, number>, titles?: string[], level?: number|null,
 *   yearsExperience?: number|null, skills?: string[]}} resumeProfile
 * @returns {{skills: string[], titles: string[], seniority: number|null,
 *   yearsExperience: number|null}}
 */
function promptProfile(resumeProfile) {
  const p = resumeProfile || {};
  const skills =
    p.keywordSet instanceof Map
      ? [...p.keywordSet.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, PROMPT_PROFILE_SKILLS)
          .map(([term]) => term)
      : toStringList(p.skills, PROMPT_PROFILE_SKILLS);
  return {
    skills,
    titles: toStringList(p.titles, PROMPT_PROFILE_TITLES),
    seniority: Number.isFinite(p.level) ? p.level : null,
    yearsExperience: Number.isFinite(p.yearsExperience) ? p.yearsExperience : null,
  };
}

/**
 * Score one job with the local keyword matcher.
 *
 * The result is shaped identically to an LLM result so that a caller — and a
 * renderer — never has to branch on which produced it, only on the
 * `scoredBy` label it carries for honesty.
 *
 * @param {object} resumeProfile From buildResumeProfile(); junk is tolerated.
 * @param {object} job A client-shaped job (see query.js toClientJob).
 * @param {string} [reason] Recorded so a degraded row can explain itself.
 * @returns {object} The ranked-job envelope — see rankBatch's @returns.
 */
export function keywordResult(resumeProfile, job, reason = 'model_unavailable') {
  let scored = { score: 0, matched: [], missing: [], lowSignal: true, confidence: 0 };
  try {
    scored = fallbackScoreJob(resumeProfile, toMatcherJob(job));
  } catch (err) {
    // fallbackScoreJob is total by construction, so this is belt to braces. A
    // throw here must not be the thing that loses the job.
    rankLog.warn('keyword scorer threw', { jobId: jobKey(job), errName: err?.name });
  }

  const missing = toStringList(scored.missing, MAX_SIGNALS);
  const matched = toStringList(scored.matched, MAX_SIGNALS);
  const gapSummary = missing.length
    ? `Scored without the model: the posting asks for ${missing.slice(0, SUMMARY_SIGNALS).join(', ')}, which this profile does not evidence.`
    : 'Scored without the model from keyword overlap alone, so treat this score as approximate.';

  return {
    job,
    jobId: jobKey(job),
    score: clampScore(scored.score) ?? 0,
    gapSummary,
    matchedSignals: matched,
    missingSignals: missing,
    scoredBy: 'keyword',
    confidence: Number.isFinite(scored.confidence) ? scored.confidence : 0,
    fallbackReason: reason,
  };
}

/**
 * 'llm' | 'keyword' | 'mixed' over a set of results.
 * @param {object[]} results
 * @returns {'llm'|'keyword'|'mixed'} An empty set reads as 'keyword', which is
 *   the honest answer: no model scored anything.
 */
function summarizeScoredBy(results) {
  let llm = 0;
  let keyword = 0;
  for (const r of results) {
    if (r.scoredBy === 'llm') llm += 1;
    else keyword += 1;
  }
  if (llm && keyword) return 'mixed';
  if (llm) return 'llm';
  return 'keyword';
}

/**
 * Rank a list of jobs.
 *
 * Never throws. A provider outage, a retired model, a malformed response, a
 * missing `callModel` and a null argument object all produce the same thing: a
 * complete list, keyword scored where the model could not help, with
 * `degraded: true`.
 *
 * @param {object} [params]
 * @param {object[]} params.jobs Client-shaped jobs (see query.js toClientJob).
 * @param {object} params.resumeProfile From buildResumeProfile().
 * @param {(req: {system: string, user: string, maxTokens: number,
 *   temperature: number}) => Promise<string>} params.callModel Injected.
 * @param {string} [params.promptName] Prompt to use; defaults to 'rank'.
 * @param {object} [params.trace] Opik trace/span handle to hang `rank_batch`
 *   spans from. Optional; the inert handle from startTrace() works too.
 * @returns {Promise<{results: object[], degraded: boolean,
 *   scoredBy: 'llm'|'keyword'|'mixed', batches: number, llmCalls: number,
 *   prompt: {name: string, version: number}|null}>}
 */
export async function rankBatch(params = {}) {
  // Read off an object rather than destructured in the signature: a default
  // only fires on `undefined`, so `rankBatch(null)` from a caller that built
  // its arguments dynamically would throw on destructuring — inside a function
  // whose entire contract is that it does not.
  const {
    jobs,
    resumeProfile,
    callModel,
    promptName = 'rank',
    trace,
  } = params && typeof params === 'object' ? params : {};

  const list = Array.isArray(jobs) ? jobs.filter(Boolean) : [];
  if (list.length === 0) {
    return { results: [], degraded: false, scoredBy: 'keyword', batches: 0, llmCalls: 0, prompt: null };
  }

  let prompt = null;
  try {
    prompt = getPrompt(promptName);
  } catch (err) {
    // A missing prompt is a programmer error, but it is not worth an empty
    // results list at runtime — keyword-score everything and say so.
    rankLog.error('prompt unavailable, keyword scoring the whole request', {
      prompt: promptName,
      errName: err?.name,
    });
  }

  const profileBlock = JSON.stringify(promptProfile(resumeProfile), null, 2);
  const batches = chunk(list, BATCH_SIZE);
  const perBatch = new Array(batches.length);
  const degradeReasons = [];
  let llmCalls = 0;

  /** Score one batch, returning results aligned to that batch's input order. */
  const runOne = async (batch, index) => {
    if (!prompt || typeof callModel !== 'function') {
      return batch.map((job) =>
        keywordResult(resumeProfile, job, prompt ? 'no_model_caller' : 'no_prompt')
      );
    }

    const span = trace?.span?.({
      name: 'rank_batch',
      type: SpanType.Llm,
      input: { batch: index, jobs: batch.length },
      metadata: { promptName: prompt.name, promptVersion: prompt.version, batchSize: batch.length },
    });

    try {
      const { system, user } = renderPromptParts(prompt.text, {
        PROFILE: profileBlock,
        JOBS: JSON.stringify(batch.map(promptJob), null, 2),
      });

      llmCalls += 1;
      const raw = await callModel({
        system,
        user,
        maxTokens: RANK_MAX_TOKENS,
        temperature: RANK_TEMPERATURE,
      });

      const parsed = parseJsonArrayLenient(raw);

      // Index by jobId, not by position. Position looks tidier and is wrong:
      // a model that drops one entry shifts every job after it onto another
      // job's score, which is invisible and worse than a missing score.
      const byId = new Map();
      for (const entry of parsed) {
        if (!entry || typeof entry !== 'object') continue;
        const id = String(entry.jobId ?? '');
        if (id && !byId.has(id)) byId.set(id, entry);
      }

      let recovered = 0;
      const out = batch.map((job) => {
        const entry = byId.get(jobKey(job));
        const score = entry ? clampScore(entry.score) : null;
        if (score === null) {
          recovered += 1;
          return keywordResult(resumeProfile, job, entry ? 'unparseable_score' : 'missing_entry');
        }
        return {
          job,
          jobId: jobKey(job),
          score,
          gapSummary: toGapSummary(entry.gapSummary),
          matchedSignals: toStringList(entry.matchedSignals, 6),
          missingSignals: toStringList(entry.missingSignals, 6),
          scoredBy: 'llm',
          confidence: 1,
        };
      });

      span?.update?.({
        output: { scored: out.length - recovered, recovered },
        metadata: { returned: parsed.length },
      })?.end?.();

      if (recovered) {
        rankLog.warn('model response incomplete, keyword scored the remainder', {
          batch: index,
          recovered,
          of: batch.length,
        });
      }

      return out;
    } catch (err) {
      // The whole batch is lost, not the jobs in it. This is the degradation
      // path the Groq 404s exercise today.
      rankLog.warn('rank batch failed, degrading to keyword scoring', {
        batch: index,
        errName: err?.name,
        status: err?.status ?? err?.statusCode,
        // The message, not just the name — the same reasoning as the pool path
        // in graph.js: a provider failure's name is almost always 'Error', and
        // the diagnosis ("model not found", "rate limit ... Limit 8000") is
        // entirely in the message. Without this the logs cannot tell a dead
        // model id from an exhausted quota, and both look like this line.
        reason: String(err?.message || err).slice(0, SPAN_ERROR_CHARS),
      });
      span?.update?.({
        output: { error: String(err?.message || err).slice(0, SPAN_ERROR_CHARS) },
        metadata: { degraded: true },
      })?.end?.();
      degradeReasons.push(classifyDegradeReason(err));
      return batch.map((job) => keywordResult(resumeProfile, job, 'batch_error'));
    }
  };

  // Fixed-size worker pool. `next` is read and incremented synchronously
  // inside one tick per worker, so no two workers can claim the same batch.
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= batches.length) return;
      perBatch[index] = await runOne(batches[index], index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(RANK_CONCURRENCY, batches.length) }, () => worker())
  );

  const results = perBatch.flat();
  const degraded = results.some((r) => r.scoredBy !== 'llm');

  return {
    results,
    degraded,
    // First failure, not a tally: every batch in a pass hits the same provider
    // in the same few seconds, so they fail the same way, and a count would
    // imply a precision this does not have. Null when nothing threw — a run
    // degraded only by per-job recovery has no provider reason to give.
    degradeReason: degradeReasons[0] || null,
    scoredBy: summarizeScoredBy(results),
    batches: batches.length,
    llmCalls,
    prompt: prompt ? { name: prompt.name, version: prompt.version } : null,
  };
}

/**
 * The production `callModel`: Groq, with the same primary→fallback chain the
 * Answer Studio route uses, decided by the same `shouldTryFallbackModel`.
 *
 * Its errors PROPAGATE. That is the contract with rankBatch: this function
 * says what went wrong, rankBatch decides that the answer to a provider
 * failure is a keyword-scored list rather than an error page. Swallowing here
 * would leave rankBatch unable to tell a bad response from a dead account.
 *
 * @param {{model?: string}} [options] Null or junk selects the default chain.
 * @returns {(req: {system: string, user: string, maxTokens?: number,
 *   temperature?: number}) => Promise<string>}
 */
export function createGroqModelCaller(options = {}) {
  const o = options && typeof options === 'object' ? options : {};
  const chain = [...new Set([o.model || GROQ_ANSWER_MODEL, GROQ_FALLBACK_MODEL].filter(Boolean))];

  return async function callModel({ system, user, maxTokens, temperature }) {
    const groq = getGroq();
    let lastError = new Error('Groq request failed');

    for (let i = 0; i < chain.length; i += 1) {
      const model = chain[i];
      const isLastModel = i === chain.length - 1;
      try {
        const completion = await groq.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: Number.isFinite(temperature) ? temperature : RANK_TEMPERATURE,
          max_tokens: Number.isFinite(maxTokens) ? maxTokens : RANK_MAX_TOKENS,
        });

        const text = groqAssistantMessageText(completion.choices?.[0]?.message).trim();
        if (text) return text;

        const empty = new Error('Groq returned no text');
        empty.statusCode = 503;
        lastError = empty;
        if (!isLastModel) continue;
        throw empty;
      } catch (err) {
        lastError = err;
        const status = err?.status ?? err?.statusCode;
        if (!isLastModel && shouldTryFallbackModel(status, err?.message)) continue;
        throw err;
      }
    }

    throw lastError;
  };
}
