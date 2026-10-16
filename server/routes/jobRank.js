/**
 * Ranking: POST /api/jobs/rank, and the Gemini-then-Groq model caller it
 * hands the ranking graph.
 */
import express from 'express';
import { supabaseAdmin, requireAuth } from '../supabase.js';
import { shouldTryFallbackModel } from '../groqClient.js';
import { fetchJobPool } from '../jobs/query.js';
import {
  runRankGraph,
  keywordOnlyResult,
  resumeTerms,
  PREFILTER_LIMIT,
  MIN_MATCH_SCORE,
  applyScoreFloor,
  summarizeSources,
} from '../jobs/graph.js';
import { createGroqModelCaller } from '../jobs/rank.js';
import {
  cacheKey,
  createRankStore,
  rankWithCache,
  RANK_LIMIT_PER_HOUR,
} from '../jobs/rankCache.js';
import { buildResumeProfile, MATCHER_VERSION } from '../../src/matching/index.js';
import { startTrace, flushTracing } from '../observability/opik.js';
import { clientErrorMessage } from '../lib/errors.js';
import { callGemini } from '../lib/gemini.js';
import { rankLog, readJobFilters } from '../lib/jobRoutes.js';

const router = express.Router();

// ------------------------------------------------------------------
// POST /api/jobs/rank — the ranking graph
// ------------------------------------------------------------------
// NO CREDIT COST, deliberately. Looking for work is the thing this product is
// for; charging per search would make users ration the feature that makes the
// rest of it worth having. The spend is bounded by RANK_LIMIT_PER_HOUR and by
// the cache instead — see server/jobs/rankCache.js.
//
// ═══ minMatch IS NOT A SERVER FILTER, AND MUST NOT BECOME ONE ═══
//
// The client holds a "minimum match" control and applies it locally, to a list
// this route already scored. The server never receives a score threshold and
// never sees where the user set the slider.
//
// That is not an oversight and it is not a round trip waiting to be
// "optimised". Two reasons, both load-bearing:
//
//   1. THE CACHE. Every distinct threshold would be a distinct cache key, so
//      dragging a slider from 40 to 75 would be thirty-five cache misses and
//      thirty-five full re-ranks of the same jobs. Keeping the threshold on
//      the client makes re-filtering free and instant, which is the only way
//      a slider feels like a slider.
//   2. IT IS A DIFFERENT QUESTION. "Rank these jobs for me" and "show me the
//      ones above 70" are separate operations; fusing them means the server
//      cannot return a job it scored 68 even though the user is one drag away
//      from wanting to see it.
//
// If you are here to add `minMatch` to the request body, the change you
// actually want is on the client.
/**
 * How long one ranking completion may take, and which provider answers it.
 *
 * ═══ WHY RANKING DOES NOT USE THE 90s GEMINI BOUND ═══
 *
 * callGemini defaults to 90s because parse-resume sends a whole PDF and one
 * slow parse is better than a failed upload. Ranking is the opposite trade: it
 * makes several calls inside a budget the browser is already counting down
 * (RANK_BUDGET_MS in server/jobs/graph.js), so a single call allowed to run
 * 90s would spend the entire request on one batch of fifteen jobs.
 */
const GEMINI_RANK_TIMEOUT_MS = 25_000;

/**
 * The Gemini models ranking may rotate through, in order.
 *
 * ═══ WHY A CHAIN AND NOT ONE MODEL ═══
 *
 * The free-tier quota that actually binds is 20 generateContent requests PER
 * DAY, PER MODEL — the metric is literally named
 * GenerateRequestsPerDayPerProjectPerModel-FreeTier. Per model is the load
 * bearing half: each id carries its own daily bucket, so a chain of five is
 * five buckets, not one shared one.
 *
 * Pinning a single model meant that the moment its 20 were spent, the whole
 * Gemini leg was done for the day and every pass fell to Groq — whose own
 * 8k-tokens-per-minute budget a full pass cannot fit either. That combination,
 * not a misconfiguration, is what produced runs scored entirely by keyword.
 *
 * The rotation itself is free: callGemini already walks a model list and
 * advances on anything shouldTryFallbackModel accepts, which includes the 429
 * that quota exhaustion raises. This constant just stops handing it a list of
 * one.
 *
 * ═══ ORDER IS BEST-CALIBRATED FIRST, AND IT IS MEASURED ═══
 *
 * It used to be "cheapest-and-fastest first", which was an assumption about
 * these ids rather than an observation of them. Running
 * test/evals/rankCalibration.test.js across all five on 2026-09-20 (per model:
 * agreement at the 50 cut / landed-in-band / rank correlation / seconds per
 * batch):
 *
 *   gemini-2.5-flash        91.7  91.7  0.969  2.8   ← best fit, and quick
 *   gemini-3.5-flash-lite   83.3  83.3  0.975  1.7   ← best ordering, fastest
 *   gemini-3.5-flash        91.7  91.7  0.950  6.4   ← as accurate, 4x slower
 *   gemini-3.1-flash-lite   83.3  83.3  0.938  5.1
 *   gemini-3.6-flash        83.3  75.0  0.942  3.6   ← weakest fit
 *
 * The old first entry, gemini-3.1-flash-lite, was the worst pairing on the
 * board: the slowest of the two "lite" ids AND the lowest rank correlation. It
 * answered most requests because it was first, so most users got the least
 * well-calibrated scores and waited longest for them. A 30-job rank is six
 * batches, so leading with 2.5-flash is ~17s where the old order was ~31s.
 *
 * Re-ordering costs nothing: every id has its OWN daily bucket, so the order
 * decides which is spent first, never how much there is in total.
 *
 * The first cut a user actually feels is MIN_MATCH_SCORE at 50, so "agreement
 * @50" leads the ordering and latency breaks ties.
 *
 * Ids are verified present on the account; a retired id (gemini-2.5-pro,
 * gemini-2.5-flash-lite) 404s, which the chain also treats as "try the next
 * one", so a stale entry costs a round trip rather than a failed pass.
 */
const GEMINI_RANK_MODELS = String(
  process.env.GEMINI_RANK_MODELS ||
    'gemini-2.5-flash,gemini-3.5-flash-lite,gemini-3.5-flash,gemini-3.1-flash-lite,gemini-3.6-flash'
)
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

/**
 * The provider chain for ranking: Gemini first, Groq second.
 *
 * ═══ WHY TWO PROVIDERS AND NOT A BIGGER PLAN ═══
 *
 * Both accounts are on free tiers, and — this is the useful part — they are
 * rationed along different axes and metered SEPARATELY. Groq caps tokens per
 * minute (8k), which a 30-job pass exhausts before it finishes. Gemini caps
 * requests per minute, which the same pass barely touches now that a batch is
 * fifteen jobs and a pass is two calls. So Gemini leads because this workload
 * is shaped to its limit rather than against it, and Groq is not a worse
 * duplicate of it but a second, independent budget to reach for when Gemini's
 * is spent.
 *
 * The reach is gated by shouldTryFallbackModel — the same predicate Gemini's
 * own model chain and the Groq chain use, so "is this transient" has one
 * answer across all three. A non-transient failure (a bad key, a malformed
 * request) propagates instead, because retrying it on another provider would
 * turn one clear error into two vague ones.
 *
 * Failing THAT, the error reaches rankBatch, which keyword-scores the batch and
 * marks it degraded. No provider outage produces an error page.
 *
 * RANK_PROVIDER=groq forces the old single-provider behaviour.
 *
 * @returns {(req: {system: string, user: string, maxTokens?: number,
 *   temperature?: number}) => Promise<string>}
 */
function createRankModelCaller() {
  const groqCaller = createGroqModelCaller();
  if (String(process.env.RANK_PROVIDER || 'gemini').toLowerCase() === 'groq') {
    return groqCaller;
  }

  return async function callModel({ system, user, maxTokens, temperature }) {
    try {
      // Flash and flash-lite only, deliberately: gemini-2.5-pro is slower per
      // call AND more tightly rationed on the free tier — the two things a
      // bounded, batched scoring pass can least afford. The chain is walked in
      // order and each id has its own daily bucket; see GEMINI_RANK_MODELS.
      const { text } = await callGemini({
        prompt: user,
        systemInstruction: system,
        maxTokens,
        temperature,
        models: GEMINI_RANK_MODELS,
        timeoutMs: GEMINI_RANK_TIMEOUT_MS,
      });
      return text;
    } catch (error) {
      const status = error?.statusCode ?? error?.status;
      if (!shouldTryFallbackModel(status, error?.message)) throw error;
      rankLog.warn('gemini unavailable for rank batch, trying groq', {
        errName: error?.name,
        status: status ?? null,
        // Reached only after EVERY model in the chain failed, so this message
        // is the last one's. Without it the logs cannot distinguish an
        // exhausted daily quota from a retired model id.
        reason: String(error?.message || error).slice(0, 300),
        chain: GEMINI_RANK_MODELS.length,
      });
      return groqCaller({ system, user, maxTokens, temperature });
    }
  };
}

router.post('/api/jobs/rank', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const filters = readJobFilters(body.filters);

    // The resume arrives as the PARSED shape ({skills, titles, seniority,
    // yearsExperience}) and the ResumeProfile is built here, not sent. Its
    // keywordSet is a Map, which JSON cannot carry — a profile serialised over
    // the wire arrives with an empty Map and silently scores everything zero.
    const resumeProfile = buildResumeProfile(body.resumeProfile || {});

    const key = cacheKey({
      userId: req.userId,
      resumeHash: body.resumeHash,
      matcherVersion: body.matcherVersion ?? MATCHER_VERSION,
      filters,
    });

    const store = createRankStore({ client: supabaseAdmin });

    // Built once and shared by the graph and the rate-limited fallback, so a
    // limited request reads the pool exactly once instead of not at all.
    const fetchJobs = (f) => fetchJobPool(supabaseAdmin, f);

    const trace = startTrace({
      name: 'rank_request',
      input: { filters },
      metadata: { matcherVersion: MATCHER_VERSION, requestId: req.id || null },
      tags: ['rank'],
    });

    const outcome = await rankWithCache({
      store,
      userId: req.userId,
      key,
      runGraph: () =>
        runRankGraph({
          resumeProfile,
          filters,
          deps: { fetchJobs, callModel: createRankModelCaller(), trace },
        }),
      // Over the hourly limit: still a list, still ordered, just scored by the
      // local matcher. Never an error — see rankWithCache.
      keywordFallback: async () => {
        try {
          // Same relevance terms the graph would have used. A rate-limited run
          // is the one most likely to be a user's FIRST impression, so handing
          // it the recency-only pool would show its worst list at its worst
          // moment.
          const { jobs } = await fetchJobs({ ...filters, terms: resumeTerms(resumeProfile) });
          return keywordOnlyResult(resumeProfile, jobs, 'rate_limited');
        } catch (err) {
          rankLog.warn('keyword fallback could not read the pool', { errName: err?.name });
          return keywordOnlyResult(resumeProfile, [], 'rate_limited');
        }
      },
    });

    await flushTracing();

    // The BODY is the same shape whatever happened — the client never branches
    // on status to know how to read it. The STATUS distinguishes "ranked, with
    // caveats" from "could not read the pool at all": a total failure that
    // answers 200 with an empty list is indistinguishable from a quiet market
    // to every dashboard, alert and log filter that will ever look at it, and
    // that is precisely the outage you most want to see.
    //
    // ═══ `error` IS TOP-LEVEL, AND NULL WHEN THERE IS NONE ═══
    //
    // It duplicates meta.error on purpose. Every generic HTTP client in this
    // codebase and outside it reads a failure from `body.error` — authFetch in
    // src/jobsApi.js does exactly `body.error || body.message` — so a 502
    // whose only explanation lived under `meta` degraded to the string
    // "HTTP 502" at the one moment the cause mattered. The other two 502s in
    // this file already answer with a top-level `error`; this one now matches
    // them, and the three job routes have one error contract between them.
    //
    // Always present rather than only on failure, so the sentence above about
    // the body being one shape stays true: the shape is constant, the value
    // varies. A 200 carries `error: null`.
    // ═══ THE FLOOR, APPLIED TO THE CACHE TOO ═══
    //
    // runRankGraph and keywordOnlyResult have both already done this, so on a
    // fresh result `cutHere` is 0 and this is a single pass over a short list.
    // It is here for the one case they cannot cover: a CACHED entry, which may
    // have been stored before the floor existed or under an older
    // matcherVersion, and which rankWithCache returns without re-running the
    // graph. Without this, a warm cache is a six-hour hole in a rule that is
    // supposed to have none.
    const { kept: jobs, cut: cutHere } = applyScoreFloor(outcome.jobs || []);
    const belowFloorCount = (outcome.belowFloorCount ?? 0) + cutHere;
    const totalFailure = Boolean(outcome.error) && jobs.length === 0 && outcome.limited !== true;

    res.status(totalFailure ? 502 : 200).json({
      error: outcome.error ? clientErrorMessage(outcome.error) : null,
      jobs,
      loops: outcome.loops ?? 0,
      reformulations: outcome.reformulations || [],
      // Which of the user's filters stopped applying, and how many of the jobs
      // below still honour all of them. The list cannot be read honestly
      // without these two, so they travel with it rather than only inside the
      // diagnostics footer.
      relaxedFilters: outcome.relaxedFilters || [],
      // Recounted from `jobs`, not taken from the outcome: when the floor
      // above cut a cached list, the stored count describes the list BEFORE
      // the cut and would claim more in-filter jobs than the page can show.
      // On a fresh result the two are equal, because nothing was cut.
      inFilterCount: cutHere > 0
        ? jobs.filter((entry) => !entry?.relaxedFilters).length
        : outcome.inFilterCount ?? jobs.length,
      // The floor, and what it cost. `jobs` above has already had it applied,
      // so these two are the only way the client can tell "the pool held
      // nothing for these filters" apart from "we scored 30 and none of them
      // reached 50%" — two empty lists that need two different sentences.
      belowFloorCount,
      minScore: MIN_MATCH_SCORE,
      degraded: outcome.degraded === true,
      scoredBy: outcome.scoredBy || 'keyword',
      limited: outcome.limited === true,
      cached: outcome.cached === true,
      meta: {
        requestId: req.id || null,
        total: jobs.length,
        poolSize: outcome.poolSize ?? 0,
        // The real count, with the ceiling alongside it. `prefilterLimit`
        // used to be sent as PREFILTER_LIMIT — a constant — so the footer
        // claimed 30 jobs were scored even on a run that only had 15.
        sentToScorer: outcome.sentToScorer ?? 0,
        prefilterLimit: PREFILTER_LIMIT,
        matcherVersion: outcome.matcherVersion ?? MATCHER_VERSION,
        // Same recount, same reason: a cached summary counts jobs the floor
        // has since removed, and the footer's per-source totals would not add
        // up to the list underneath it.
        sources: cutHere > 0 ? summarizeSources(jobs) : outcome.sources || [],
        timings: outcome.timings || null,
        // True when the graph stopped looping because it ran out of wall clock
        // rather than because it was satisfied. Without this the run footer
        // cannot tell "we looked twice and this is what there is" apart from
        // "we ran out of time", and those deserve different sentences.
        budgetExhausted: outcome.budgetExhausted === true,
        // Why the model leg gave up, bucketed — 'rate_limited',
        // 'model_unavailable', 'timeout', 'provider_down', 'request_too_large'
        // or 'error'; null when nothing threw. The banner uses it to say
        // whether waiting will help, which is the only part of a provider
        // failure a user can act on. The exact message stays in the log line
        // and the trace, where it belongs.
        degradeReason: outcome.degradeReason || null,
        rateLimitPerHour: RANK_LIMIT_PER_HOUR,
        rateRemaining: outcome.rateRemaining ?? null,
        limitResetAt: outcome.limitResetAt ?? null,
        error: outcome.error || null,
      },
    });
  } catch (error) {
    // runRankGraph does not throw, so reaching here means something before it
    // did — a malformed body, or Supabase refusing the cache read AND the
    // fallback. Still JSON, still shaped like a result.
    rankLog.error('POST /api/jobs/rank failed', { errName: error?.name });
    res.status(502).json({
      error: clientErrorMessage(error),
      jobs: [],
      loops: 0,
      reformulations: [],
      relaxedFilters: [],
      inFilterCount: 0,
      belowFloorCount: 0,
      minScore: MIN_MATCH_SCORE,
      degraded: true,
      scoredBy: 'keyword',
      limited: false,
      cached: false,
      meta: { requestId: req.id || null, total: 0 },
    });
  }
});

export default router;
