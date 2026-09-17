/**
 * EVAL — FitExplanationQuality (LLM judge, OPT-IN ONLY)
 *
 * Grades the one-paragraph "why this job fits you" the ranker shows, using a
 * model as the judge. Unlike the other two evals this one costs money, needs a
 * key, and does not return the same number twice — so it is opt-in and it is
 * NOT the gate. FabricationRate is the gate.
 *
 *   RUN_LLM_EVALS=1 GROQ_API_KEY=... npm run evals
 *
 * Without BOTH of those it skips cleanly. The two conditions are separate on
 * purpose: GROQ_API_KEY is often already in the shell of anyone working on the
 * server, so a key alone must not be enough to start spending money inside a
 * plain `npm test`. Only the explicit RUN_LLM_EVALS=1 does that.
 *
 * Nothing from `server/` is imported at module scope — the client is pulled in
 * with a dynamic import after the gate, so a default run loads no provider SDK
 * and reads no provider config.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { cvById } from './fixtures/cvs.js';
import { FIT_EXPLANATIONS, GOOD_EXPLANATIONS, POOR_EXPLANATIONS } from './fixtures/fitExplanations.js';

const OPTED_IN = process.env.RUN_LLM_EVALS === '1';
const HAS_KEY = !!process.env.GROQ_API_KEY;

/**
 * THRESHOLD: a good explanation should land at 4 of 5 or better.
 *
 * The rubric below reserves 5 for "specific AND honest about the gap" and 4
 * for "specific"; the hand-labelled good fixtures are written to clear both
 * bars, so a mean under 4.0 means either the rubric drifted or the judge model
 * changed underneath us. Not a product regression on its own — read the
 * per-sample reasons before acting on it.
 */
const MIN_MEAN_GOOD = 4.0;

/**
 * THRESHOLD: generic flattery and unsupported claims should sit at 2 or below.
 *
 * Set at 2.5 rather than 2.0 because judges are consistently generous to
 * fluent prose, and half a point of that bias is not worth a red build.
 */
const MAX_MEAN_POOR = 2.5;

/**
 * THRESHOLD: the judge must actually separate the two sets.
 *
 * This is the assertion that matters. Absolute scores drift with the model;
 * a judge that cannot tell a grounded explanation from flattery is useless
 * regardless of where its numbers sit, and a margin under 1.5 points on
 * fixtures this far apart means the judge is not reading.
 */
const MIN_MARGIN = 1.5;

/** Judge temperature is 0: this is noisy enough without sampling on top. */
const JUDGE_TEMPERATURE = 0;

const RUBRIC = `You are grading the quality of a short "why this job fits you" explanation shown
to a job seeker next to a ranked listing. Grade ONLY the explanation.

5 — Every claim traces to something in the candidate summary, the specifics are concrete
    (named tools, real figures, real bullets), and it is honest about any gap.
4 — Concrete and grounded in the candidate summary, but says nothing about gaps.
3 — Partly grounded; some of it would apply to any candidate.
2 — Generic praise, or about the company rather than the candidate. Cites no evidence.
1 — Asserts experience the candidate summary does not support, or is simply wrong.

Return ONLY a JSON object: {"score": <1-5>, "reason": "<one sentence>"}`;

/** Compact candidate summary — the judge grades grounding, not formatting. */
function candidateSummary(cv) {
  const parsed = cv.parsed;
  const jobs = (parsed.experience || [])
    .map((job) => `${job.title} at ${job.company} (${job.startDate} to ${job.endDate || 'present'})\n${job.description}`)
    .join('\n\n');
  return `${parsed.summary}\n\nSKILLS: ${(parsed.skills || []).join(', ')}\n\nEXPERIENCE:\n${jobs}`;
}

function judgePrompt(sample) {
  const cv = cvById(sample.cv);
  return `CANDIDATE SUMMARY:\n${candidateSummary(cv)}\n\n`
    + `JOB: ${sample.job.title} at ${sample.job.company}\n${sample.job.description}\n\n`
    + `EXPLANATION TO GRADE:\n${sample.explanation}`;
}

const mean = (numbers) => (numbers.length ? numbers.reduce((a, b) => a + b, 0) / numbers.length : 0);

test('FitExplanationQuality: an LLM judge separates grounded explanations from flattery', async (t) => {
  if (!OPTED_IN) {
    t.skip('opt-in only — set RUN_LLM_EVALS=1 (and GROQ_API_KEY) to run the LLM judge');
    return;
  }
  if (!HAS_KEY) {
    t.skip('GROQ_API_KEY is not set; the LLM judge cannot run');
    return;
  }

  // Imported here, not at module scope, so a default `npm test` never touches
  // the provider SDK or its configuration.
  const { getGroq, GROQ_ANSWER_MODEL } = await import('../../server/groqClient.js');
  const { parseJsonLenient } = await import('../../server/llmJson.js');
  const groq = getGroq();

  const scores = new Map();
  for (const sample of FIT_EXPLANATIONS) {
    const completion = await groq.chat.completions.create({
      model: GROQ_ANSWER_MODEL,
      temperature: JUDGE_TEMPERATURE,
      messages: [
        { role: 'system', content: RUBRIC },
        { role: 'user', content: judgePrompt(sample) },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content ?? '';
    const verdict = parseJsonLenient(raw);
    const score = Number(verdict?.score);
    assert.ok(
      Number.isFinite(score) && score >= 1 && score <= 5,
      `judge returned an unusable score for ${sample.id}: ${JSON.stringify(raw).slice(0, 200)}`,
    );

    scores.set(sample.id, score);
    t.diagnostic(`${sample.id} [${sample.label}] = ${score} — ${String(verdict?.reason || '').slice(0, 120)}`);
  }

  const goodMean = mean(GOOD_EXPLANATIONS.map((s) => scores.get(s.id)));
  const poorMean = mean(POOR_EXPLANATIONS.map((s) => scores.get(s.id)));
  const margin = goodMean - poorMean;

  t.diagnostic(`FitExplanationQuality: good=${goodMean.toFixed(2)} poor=${poorMean.toFixed(2)} margin=${margin.toFixed(2)}`);

  assert.ok(goodMean >= MIN_MEAN_GOOD, `good explanations averaged ${goodMean.toFixed(2)}, below ${MIN_MEAN_GOOD}`);
  assert.ok(poorMean <= MAX_MEAN_POOR, `poor explanations averaged ${poorMean.toFixed(2)}, above ${MAX_MEAN_POOR}`);
  assert.ok(margin >= MIN_MARGIN, `judge separated the sets by only ${margin.toFixed(2)}, below ${MIN_MARGIN}`);
});

test('FitExplanationQuality: the fixture set is balanced and well formed', () => {
  // Runs unconditionally — offline, no key. It catches the way this eval
  // actually rots: someone adds three "good" fixtures, the means stop meaning
  // anything, and nobody notices because the judge itself is usually skipped.
  assert.ok(GOOD_EXPLANATIONS.length >= 3, 'need at least three grounded fixtures');
  assert.equal(
    GOOD_EXPLANATIONS.length,
    POOR_EXPLANATIONS.length,
    'the good and poor sets must stay the same size or the margin is not comparable',
  );

  for (const sample of FIT_EXPLANATIONS) {
    assert.ok(sample.explanation.trim().length > 80, `${sample.id} explanation is too short to grade`);
    assert.doesNotThrow(() => cvById(sample.cv), `${sample.id} names a CV fixture that does not exist`);
    assert.ok(sample.job?.description?.trim(), `${sample.id} has no job description`);
  }
});
