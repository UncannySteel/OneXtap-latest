/**
 * One job in depth: POST /api/jobs/explain, the paid fit analysis plus
 * tailoring suggestions. Prompt text is in server/jobs/prompts/.
 */
import express from 'express';
import { supabaseAdmin, getProfile, requireAuth } from '../supabase.js';
import { parseJsonLenient } from '../llmJson.js';
import { createGroqModelCaller, renderPromptParts } from '../jobs/rank.js';
import { getPrompt } from '../jobs/prompts/index.js';
import { buildResumeProfile } from '../../src/matching/index.js';
import { startTrace, flushTracing, SpanType } from '../observability/opik.js';
import { clientErrorMessage } from '../lib/errors.js';
import { chargeOneCredit, refundOneCredit } from '../lib/credits.js';
import { jobsLog } from '../lib/jobRoutes.js';

const router = express.Router();

// ------------------------------------------------------------------
// POST /api/jobs/explain — one job, in depth
// ------------------------------------------------------------------
// COSTS 1 CREDIT, unlike ranking. This one reads the full description and the
// full corpus and makes two model calls for a single job — it is the
// expensive, deliberate act, not the browse.
//
// The credit is deducted AFTER a successful generation, mirroring
// VaultPage.jsx: a user whose generation failed has received nothing and must
// not be charged for it. A failure after the deduction refunds.

/**
 * Corpus items and profile skills sent with the explain prompt.
 *
 * The corpus is the user's own material and arrives whole from the client;
 * two hundred items is well past any real resume and vault combined, so the
 * cap only ever bites on something malformed.
 */
/** One job's full description, capped. Generous: this is the single input the
 *  fit analysis is actually reasoning over, and truncating it mid-requirement
 *  produces confident nonsense. The row itself is already capped at 4000. */
const EXPLAIN_MAX_DESCRIPTION_CHARS = 20000;

const EXPLAIN_CORPUS_ITEMS = 200;
const EXPLAIN_PROFILE_SKILLS = 60;

/**
 * Output budget and temperature for the two explain-route completions.
 *
 * The analysis gets the larger budget because it returns prose plus two
 * arrays; tailoring returns short structured notes. Both run cooler than a
 * writing task would — this is assessment, and a user who re-runs it on the
 * same job should not get a different verdict.
 *
 * The budgets cover hidden reasoning too. On a reasoning model
 * (`openai/gpt-oss-120b`, the Groq default here) reasoning tokens count
 * against `max_tokens`: one analysis measured 1,061 reasoning + ~890 answer
 * tokens, 1,947 of the old 2,048 cap, and a slightly longer one was cut off
 * mid-JSON and failed to parse. A cap is not a spend, so headroom is free.
 */
const EXPLAIN_MAX_TOKENS = 4096;
const EXPLAIN_TEMPERATURE = 0.25;
const TAILOR_MAX_TOKENS = 3072;
const TAILOR_TEMPERATURE = 0.2;

/**
 * Tailoring suggestions returned to the client.
 *
 * Five, because this is advice a person acts on by hand before applying. A
 * longer list is not more helpful; it is a backlog, and it makes the strongest
 * suggestion harder to find.
 */
const MAX_TAILORING_SUGGESTIONS = 5;

/**
 * Keep only suggestions that point at real corpus items, and strip anything
 * that is not one of the four allowed keys.
 *
 * ═══ THIS IS A PRODUCT BOUNDARY, NOT A SCHEMA CHECK ═══
 *
 * `suggest_tailoring.md` forbids the model from returning rewritten prose:
 * automated rewriting of a candidate's own account of their work is out of
 * scope pending sign-off. A prompt is an instruction, not an enforcement, so
 * this is the enforcement. Only `corpusRef`, `currentText`, `reason` and
 * `suggestedAngle` survive, and `currentText` must match a corpus item
 * verbatim — which is exactly the check that catches a model that "helpfully"
 * improved the quotation on its way past.
 *
 * A suggestion pointing at material the user did not send is dropped rather
 * than repaired: an invented reference is a fabrication, and there is nothing
 * to repair it against.
 *
 * @param {unknown} suggestions Whatever the model returned under `suggestions`.
 * @param {Array<{ref: string, text: string}>} corpus The items the user sent.
 * @returns {Array<{corpusRef: string, currentText: string, reason: string,
 *   suggestedAngle: string}>} At most MAX_TAILORING_SUGGESTIONS, and `[]` for
 *   any input that is not an array.
 */
function sanitizeTailoringSuggestions(suggestions, corpus) {
  if (!Array.isArray(suggestions)) return [];

  const byRef = new Map();
  for (const item of corpus) {
    if (item && typeof item.ref === 'string') byRef.set(item.ref, String(item.text || ''));
  }

  const out = [];
  for (const raw of suggestions) {
    if (!raw || typeof raw !== 'object') continue;
    const corpusRef = typeof raw.corpusRef === 'string' ? raw.corpusRef : '';
    if (!byRef.has(corpusRef)) continue;

    const actual = byRef.get(corpusRef);
    const quoted = typeof raw.currentText === 'string' ? raw.currentText.trim() : '';
    if (!quoted || quoted !== actual.trim()) continue;

    const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';
    const suggestedAngle = typeof raw.suggestedAngle === 'string' ? raw.suggestedAngle.trim() : '';
    if (!reason || !suggestedAngle) continue;

    // The stored text, not the model's quotation of it. They are equal after
    // trimming or we would not be here; taking ours means no round trip can
    // ever hand the user back a subtly edited version of their own sentence.
    out.push({ corpusRef, currentText: actual, reason, suggestedAngle });
    if (out.length >= MAX_TAILORING_SUGGESTIONS) break;
  }
  return out;
}

router.post('/api/jobs/explain', requireAuth, async (req, res) => {
  let charged = false;

  try {
    const body = req.body || {};
    const job = body.job && typeof body.job === 'object' ? body.job : null;
    if (!job || !String(job.title || '').trim()) {
      return res.status(400).json({ error: 'Missing job' });
    }

    const corpus = Array.isArray(body.corpus) ? body.corpus : [];
    const resumeProfile = buildResumeProfile(body.resumeProfile || {});

    // Pre-flight the balance so an out-of-credit user is refused before the
    // model calls rather than after them.
    const profile = await getProfile(req.userId, req.userEmail);
    if (!profile.is_premium && profile.credits <= 0) {
      return res.status(403).json({ error: 'No credits remaining' });
    }

    const trace = startTrace({
      name: 'explain_request',
      input: { jobId: job.jobId || job.id || null },
      metadata: { requestId: req.id || null },
      tags: ['explain'],
    });

    const callModel = createGroqModelCaller();

    // The full description goes to the model here and nowhere else.
    //
    // It CANNOT come from the client: JOB_COLUMNS in jobs/query.js deliberately
    // omits `description`, so no job object the client holds has ever carried
    // one. Without this read, `job.description` was always undefined and the
    // user paid a credit for an analysis of the job title. Read the single row
    // by id — one indexed lookup, and the only place the description is ever
    // pulled out of the pool.
    const jobRowId = job.jobId || job.job_id || job.id || null;
    let fullDescription = '';
    if (jobRowId) {
      try {
        const { data: row, error: rowError } = await supabaseAdmin
          .from('job_listings')
          .select('description,description_quality,requirements')
          .eq('job_id', String(jobRowId))
          .maybeSingle();
        if (rowError) {
          jobsLog.warn('explain could not read job description', { errName: rowError?.name });
        } else if (row) {
          fullDescription = typeof row.description === 'string' ? row.description : '';
          if (!job.descriptionQuality && row.description_quality) {
            job.descriptionQuality = row.description_quality;
          }
          if (!Array.isArray(job.requirements) && Array.isArray(row.requirements)) {
            job.requirements = row.requirements;
          }
        }
      } catch (readError) {
        // A missing description degrades the analysis; it must not fail the
        // request the user is about to be charged for.
        jobsLog.warn('explain description read threw', { errName: readError?.name });
      }
    }
    const jobBlock = JSON.stringify(
      {
        jobId: job.jobId || job.id || null,
        title: job.title,
        company: job.company ?? null,
        location: job.location ?? null,
        isRemote: job.isRemote === true,
        descriptionQuality: job.descriptionQuality || 'full',
        description: fullDescription.slice(0, EXPLAIN_MAX_DESCRIPTION_CHARS),
        requirements: Array.isArray(job.requirements) ? job.requirements : [],
      },
      null,
      2
    );

    const profileBlock = JSON.stringify(
      {
        skills: [...(resumeProfile.keywordSet?.keys?.() || [])].slice(0, EXPLAIN_PROFILE_SKILLS),
        titles: resumeProfile.titles || [],
        seniority: resumeProfile.level ?? null,
        yearsExperience: resumeProfile.yearsExperience ?? null,
      },
      null,
      2
    );

    const corpusBlock = JSON.stringify(
      corpus
        .filter((item) => item && typeof item === 'object' && typeof item.ref === 'string')
        .slice(0, EXPLAIN_CORPUS_ITEMS)
        .map((item) => ({ ref: item.ref, kind: item.kind || 'other', text: String(item.text || '') })),
      null,
      2
    );

    const explainPrompt = getPrompt('explain');
    const explainSpan = trace?.span?.({
      name: 'explain',
      type: SpanType.Llm,
      metadata: { promptName: explainPrompt.name, promptVersion: explainPrompt.version },
    });

    const explainParts = renderPromptParts(explainPrompt.text, {
      PROFILE: profileBlock,
      JOB: jobBlock,
    });
    const explainRaw = await callModel({
      system: explainParts.system,
      user: explainParts.user,
      maxTokens: EXPLAIN_MAX_TOKENS,
      temperature: EXPLAIN_TEMPERATURE,
    });
    let explained;
    try {
      explained = parseJsonLenient(explainRaw);
    } catch (parseError) {
      // Usually a reply cut off at the token cap. The parser's own message
      // ("Unterminated string in JSON at position …") means nothing to the
      // user, and nothing has been charged yet.
      jobsLog.warn('explain response did not parse', { errName: parseError?.name, chars: explainRaw.length });
      explainSpan?.update?.({ output: { error: 'unparseable' } }).end?.();
      const incomplete = new Error('The fit analysis came back incomplete. Try again; no credit was used.');
      incomplete.statusCode = 502;
      throw incomplete;
    }
    explainSpan?.update?.({ output: { ok: true } }).end?.();

    // Tailoring is a SECOND prompt, not a field of the first, because the two
    // answer different questions and the tailoring one carries a hard "do not
    // write replacement prose" constraint that must not be diluted by sharing
    // a context with a prose-writing instruction.
    let tailoringSuggestions = [];
    if (corpus.length) {
      const tailorPrompt = getPrompt('suggest_tailoring');
      const tailorSpan = trace?.span?.({
        name: 'suggest_tailoring',
        type: SpanType.Llm,
        metadata: { promptName: tailorPrompt.name, promptVersion: tailorPrompt.version },
      });
      try {
        const tailorParts = renderPromptParts(tailorPrompt.text, {
          JOB: jobBlock,
          CORPUS: corpusBlock,
        });
        const tailorRaw = await callModel({
          system: tailorParts.system,
          user: tailorParts.user,
          maxTokens: TAILOR_MAX_TOKENS,
          temperature: TAILOR_TEMPERATURE,
        });
        const parsed = parseJsonLenient(tailorRaw);
        tailoringSuggestions = sanitizeTailoringSuggestions(parsed?.suggestions, corpus);
        tailorSpan?.update?.({ output: { suggestions: tailoringSuggestions.length } }).end?.();
      } catch (err) {
        // Tailoring is additive. Losing it must not lose the analysis the user
        // is actually paying for.
        jobsLog.warn('tailoring suggestions failed; returning analysis only', { errName: err?.name });
        tailorSpan?.update?.({ output: { error: 'failed' } }).end?.();
      }
    }

    // Generation succeeded. Charge now — and from here on, any failure refunds.
    const charge = await chargeOneCredit(req.userId, req.userEmail, 'Job fit analysis');
    charged = charge.charged;

    try {
      const payload = {
        fitAnalysis: typeof explained?.fitAnalysis === 'string' ? explained.fitAnalysis : '',
        gaps: Array.isArray(explained?.gaps) ? explained.gaps : [],
        strengths: Array.isArray(explained?.strengths) ? explained.strengths : [],
        tailoringSuggestions,
        creditsRemaining: charge.remaining === Infinity ? null : charge.remaining,
        isPremium: charge.remaining === Infinity,
      };
      trace?.update?.({ output: { gaps: payload.gaps.length, strengths: payload.strengths.length } }).end?.();
      await flushTracing();
      return res.json(payload);
    } catch (err) {
      await refundOneCredit(req.userId, req.userEmail, 'Credit refunded (failed job fit analysis)');
      charged = false;
      throw err;
    }
  } catch (error) {
    if (charged) {
      await refundOneCredit(req.userId, req.userEmail, 'Credit refunded (failed job fit analysis)');
    }
    const status = error?.statusCode || 502;
    jobsLog.error('POST /api/jobs/explain failed', { errName: error?.name });
    return res.status(status).json({ error: clientErrorMessage(error) });
  }
});

export default router;
