/**
 * EVAL — RankCalibration (LIVE MODEL CALLS, OPT-IN ONLY)
 *
 * Answers one question: does a score mean the same thing whoever produced it?
 *
 * It matters because ranking now rotates across several Gemini models rather
 * than pinning one (see GEMINI_RANK_MODELS in server/index.js). Rotation buys
 * daily capacity — each model id carries its own free-tier bucket — and the
 * price is that two runs an hour apart can be answered by two different models.
 * If those models do not agree about what 72 means, the user sees a list that
 * reshuffles for no reason they can observe, and the minimum-match filter stops
 * meaning anything.
 *
 * The band table in server/jobs/prompts/rank.md is the fix. This eval is how we
 * find out whether it worked, per model, before a model joins the chain.
 *
 *   RUN_LLM_EVALS=1 GEMINI_API_KEY=... npm run evals
 *   RUN_LLM_EVALS=1 GROQ_API_KEY=... RANK_EVAL_PROVIDER=groq npm run evals
 *
 * Without BOTH the opt-in and a key it skips cleanly. The two conditions are
 * separate deliberately, exactly as in fitExplanationQuality: a key is often
 * already in the shell of anyone working on the server, and a key alone must
 * never be enough to start spending quota inside a plain `npm test`.
 *
 * FabricationRate remains THE gate. This one costs real requests against a
 * 20-per-day-per-model budget, so it is a tool you reach for when changing the
 * prompt or vetting a model — not something CI runs on every push.
 *
 * Nothing from server/ is imported at module scope; the model client is pulled
 * in dynamically after the gate, so a default run loads no provider SDK.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { RANK_PAIRS, bandMid, inBand } from './fixtures/rankPairs.js';
import { spearman, thresholdAgreement, meanAbsError, pct } from './lib/score.js';

const OPTED_IN = process.env.RUN_LLM_EVALS === '1';
const PROVIDER = String(process.env.RANK_EVAL_PROVIDER || 'gemini').toLowerCase();
const HAS_KEY = PROVIDER === 'groq' ? !!process.env.GROQ_API_KEY : !!process.env.GEMINI_API_KEY;

/**
 * Models under test. Defaults to the rotation chain, so the answer to "can this
 * model join the chain" is the thing the eval reports by default.
 */
const MODELS = String(
  process.env.RANK_EVAL_MODELS ||
    (PROVIDER === 'groq'
      ? 'openai/gpt-oss-120b'
      : 'gemini-3.1-flash-lite,gemini-3.5-flash-lite,gemini-2.5-flash,gemini-3.5-flash,gemini-3.6-flash')
)
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

/**
 * THRESHOLD: ordering must survive the model swap.
 *
 * 0.80 rather than 0.95 because the fixtures include deliberately adjacent
 * pairs — an analytics role against a data engineer, a staff posting against a
 * mid-level profile — where two reasonable humans would also swap the order.
 * What this catches is a model that has no opinion (everything at 80) or an
 * inverted one, both of which sit far below 0.8.
 */
const MIN_RANK_CORRELATION = 0.8;

/**
 * THRESHOLD: agreement on which side of the product's cuts each job falls.
 *
 * 0.75 at each of 50/60/70. Lower than you might want, and honestly so: with
 * twelve pairs one disagreement is 8 points, so a stricter bar would fail on
 * a single defensible judgement call. Read the per-pair table this prints
 * before treating a miss as a regression.
 */
const MIN_THRESHOLD_AGREEMENT = 0.75;

/** The cuts that actually gate what a user sees: GOOD_SCORE, and minMatch. */
const PRODUCT_THRESHOLDS = [50, 60, 70];

test('RankCalibration — scores mean the same thing across models', { concurrency: 1 }, async (t) => {
  if (!OPTED_IN || !HAS_KEY) {
    t.skip(
      `set RUN_LLM_EVALS=1 and ${PROVIDER === 'groq' ? 'GROQ_API_KEY' : 'GEMINI_API_KEY'} to run this eval`
    );
    return;
  }

  const { rankBatch } = await import('../../server/jobs/rank.js');
  const callerFor = await modelCallerFactory(PROVIDER);

  for (const model of MODELS) {
    await t.test(model, async () => {
      const callModel = callerFor(model);
      const actual = [];
      const expected = [];
      const rows = [];

      for (const set of RANK_PAIRS) {
        const jobs = set.jobs.map((entry) => entry.job);
        const { results, scoredBy } = await rankBatch({
          jobs,
          resumeProfile: set.profile,
          callModel,
        });

        // A degraded batch means the provider failed, not that the model is
        // poorly calibrated. Failing the assertion on that would blame the
        // wrong thing, so say which it was.
        assert.notEqual(
          scoredBy,
          'keyword',
          `${model}: every job fell back to the keyword scorer — the provider call failed, so this run measures nothing`
        );

        for (const entry of set.jobs) {
          const got = results.find((r) => r.jobId === entry.job.jobId);
          const score = Number(got?.score);
          actual.push(score);
          expected.push(bandMid(entry.band));
          rows.push({
            cv: set.cvId,
            job: entry.job.title,
            band: entry.band,
            expected: bandMid(entry.band),
            got: score,
            ok: inBand(score, entry.band),
            scoredBy: got?.scoredBy,
          });
        }
      }

      const rho = spearman(actual, expected);
      const mae = meanAbsError(actual, expected);
      const inBandRate = rows.filter((r) => r.ok).length / rows.length;
      const agreement = PRODUCT_THRESHOLDS.map((thr) => ({
        thr,
        value: thresholdAgreement(actual, expected, thr),
      }));

      console.log(`\n  ── ${model} ──`);
      for (const r of rows) {
        console.log(
          `    ${r.ok ? '✓' : '✗'} ${String(r.cv).padEnd(14)} ${String(r.job).slice(0, 34).padEnd(36)}` +
            ` want ${String(r.band).padEnd(8)} (~${r.expected})  got ${r.got}`
        );
      }
      console.log(`    rank correlation  ${rho.toFixed(3)}`);
      console.log(`    mean abs error    ${mae.toFixed(1)} points`);
      console.log(`    landed in band    ${pct(inBandRate)}`);
      for (const a of agreement) console.log(`    agreement @${a.thr}      ${pct(a.value)}`);

      assert.ok(
        rho >= MIN_RANK_CORRELATION,
        `${model}: rank correlation ${rho.toFixed(3)} < ${MIN_RANK_CORRELATION} — this model orders jobs differently from the reference, so rotating onto it reshuffles the user's list`
      );

      for (const a of agreement) {
        assert.ok(
          a.value >= MIN_THRESHOLD_AGREEMENT,
          `${model}: only ${pct(a.value)} agreement at the ${a.thr} cut (need ${pct(MIN_THRESHOLD_AGREEMENT)}) — jobs land on different sides of a filter the user actually sets`
        );
      }
    });
  }
});

/**
 * Build a `(model) => callModel` factory for one provider.
 *
 * Gemini is called with a direct fetch rather than through callGemini, because
 * callGemini lives in server/index.js, which builds the Express app and calls
 * app.listen() on import. The request shape below mirrors it — including
 * thinkingBudget 0 on flash, without which thinking eats the output budget and
 * the JSON array comes back truncated.
 */
async function modelCallerFactory(provider) {
  if (provider === 'groq') {
    const { createGroqModelCaller } = await import('../../server/jobs/rank.js');
    return (model) => createGroqModelCaller({ model });
  }

  const key = process.env.GEMINI_API_KEY;
  return (model) =>
    async function callModel({ system, user, maxTokens, temperature }) {
      const id = model.toLowerCase();
      const generationConfig = { maxOutputTokens: maxTokens, temperature };
      // Mirrors thinkingConfigForGeminiModel in server/index.js: flash-lite
      // rejects the field outright and does not think by default anyway.
      if (id.includes('flash') && !id.includes('flash-lite')) {
        generationConfig.thinkingConfig = { thinkingBudget: 0 };
      }

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: user }] }],
            systemInstruction: { parts: [{ text: system }] },
            generationConfig,
          }),
        }
      );

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(payload?.error?.message || `Gemini ${res.status}`);
        err.statusCode = res.status;
        throw err;
      }
      return (payload?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    };
}
