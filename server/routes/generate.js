/**
 * Answer Studio: POST /api/answer-vault/generate. Prompt text is in
 * server/prompts/answerVault.js.
 */
import express from 'express';
import { supabaseAdmin, requireAuth } from '../supabase.js';
import { log } from '../logger.js';
import { createGenerateLimitStore, consumeGeneration, limitMessage } from '../generateLimit.js';
import {
  getGroq,
  groqAssistantMessageText,
  shouldTryFallbackModel,
  GROQ_ANSWER_MODEL,
  GROQ_FALLBACK_MODEL,
  GROQ_MAX_TOKENS,
} from '../groqClient.js';
import { validateAgainstCorpus } from '../../src/matching/index.js';
import {
  pickRelevantAnswers,
  buildGroqAnswerSystemInstruction,
  buildAnswerVaultUserContent,
} from '../prompts/answerVault.js';

const router = express.Router();

// GROQ_ANSWER_MODEL, GROQ_FALLBACK_MODEL, GROQ_MAX_TOKENS, getGroq() and
// shouldTryFallbackModel() now live in ./groqClient.js — same definitions, one
// copy, shared with the ranking graph. See the header of that file.

const GROQ_ALLOWED_MODELS = new Set(
  [
    GROQ_ANSWER_MODEL,
    GROQ_FALLBACK_MODEL,
    'llama-3.3-70b-versatile',
    'llama-3.1-70b-versatile',
    'llama-3.1-8b-instant',
    'mixtral-8x7b-32768',
  ].filter(Boolean)
);

// ------------------------------------------------------------------
// Optional fabrication check on generated text.
//
// The corpus is the user's own resume, posted by the client; it is never
// stored here and never leaves this request.
//
// Three caps, because validateAgainstCorpus is O(claims x items) and each
// comparison builds trigram sets: an unbounded corpus turns one paid
// generation into unbounded CPU on this process. The total-character budget is
// the one that matters — item count alone does not bound anything when each
// item can be a novel.
//
// These caps do NOT stop a 413. express.json() defaults to a 100kb body and
// rejects an oversized request before this handler runs, so the caps the
// CLIENT applies (src/components/shared/FabricationNotice.jsx, same three
// numbers) are what keep a real request under that ceiling. These are the
// server's own floor under an untrusted body. Change one side, change both.
// ------------------------------------------------------------------
const FABRICATION_CORPUS_MAX_ITEMS = 200;
const FABRICATION_CORPUS_MAX_ITEM_CHARS = 500;
const FABRICATION_CORPUS_MAX_TOTAL_CHARS = 40000;

/**
 * Coerce an untrusted `corpus` body field into the shape validateAgainstCorpus
 * expects, capped. Junk entries are dropped, not rejected: a malformed corpus
 * must never fail a generation the user already paid for.
 *
 * @param {unknown} raw req.body.corpus
 * @returns {Array<{ref: string|null, text: string}>} Empty when unusable.
 */
function sanitizeFabricationCorpus(raw) {
  if (!Array.isArray(raw)) return [];
  const items = [];
  let budget = FABRICATION_CORPUS_MAX_TOTAL_CHARS;
  for (const entry of raw) {
    if (items.length >= FABRICATION_CORPUS_MAX_ITEMS || budget <= 0) break;
    const isObject = !!entry && typeof entry === 'object';
    const rawText = typeof entry === 'string'
      ? entry
      : (isObject && typeof entry.text === 'string' ? entry.text : '');
    const text = rawText.trim().slice(0, Math.min(FABRICATION_CORPUS_MAX_ITEM_CHARS, budget));
    if (!text) continue;
    budget -= text.length;
    const ref = isObject && typeof entry.ref === 'string' ? entry.ref.slice(0, 200) : null;
    items.push({ ref, text });
  }
  return items;
}

// ------------------------------------------------------------------
// POST /api/answer-vault/generate — Answer Studio via Groq (groq-sdk)
//
// Body is unchanged except for an OPTIONAL `corpus`. Omit it and the response
// is exactly what it has always been; send it and two extra keys
// (fabricationFlags, fabricationRate) appear alongside the existing ones. Both
// call sites in production predate the field, so the additive shape is the
// contract, not a convenience.
// ------------------------------------------------------------------
router.post('/api/answer-vault/generate', requireAuth, async (req, res) => {
  try {
    const taskHint = String(req.body?.taskHint || '').trim();
    const styleHint = String(req.body?.styleHint || '').trim();

    const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
    const legacyPrompt = String(req.body?.userPrompt ?? req.body?.prompt ?? '').trim();

    const draft = typeof req.body?.draft === 'string' ? req.body.draft.trim() : '';
    const jobContext = typeof req.body?.jobContext === 'string' ? req.body.jobContext.trim() : '';
    const profileContext = typeof req.body?.profileContext === 'string' ? req.body.profileContext.trim() : '';
    const vaultAnswers = Array.isArray(req.body?.vaultAnswers) ? req.body.vaultAnswers : [];

    let userContent;
    if (question) {
      const relevantAnswers = pickRelevantAnswers(vaultAnswers, question);
      const profileBlock = profileContext
        ? `PROFILE (brief):\n${profileContext}\n\n`
        : '';
      userContent = buildAnswerVaultUserContent({ relevantAnswers, profileBlock, jobContext, question, draft });
    } else if (legacyPrompt) {
      userContent = legacyPrompt;
    } else {
      return res.status(400).json({ error: 'Missing question or userPrompt' });
    }

    const requestedModel = (req.body?.model || '').trim();
    const modelAllowed = GROQ_ALLOWED_MODELS.has(requestedModel);
    const selectedModel = modelAllowed ? requestedModel : GROQ_ANSWER_MODEL;

    // Failing closed is right; failing SILENTLY is what cost a debugging pass.
    // VITE_ANSWER_STUDIO_MODEL was set to a Gemini id and posted to this
    // Groq-only route for weeks: the allowlist discarded it, every request
    // quietly ran on the default, and the "model switch" looked wired end to
    // end while doing nothing. A rejected id is now a log line, so the next
    // mismatch is one grep away instead of invisible.
    if (requestedModel && !modelAllowed) {
      log.warn('requested model is not allowlisted, using the default', {
        requestedModel,
        selectedModel,
      });
    }

    // The hourly ceiling on drafts per account (server/generateLimit.js),
    // counted once the request is known to be well formed and before the
    // model is called. It fails open: if the count cannot be kept, the draft
    // goes ahead.
    const gate = await consumeGeneration(createGenerateLimitStore({ client: supabaseAdmin }), req.userId);
    if (!gate.allowed) {
      const retrySeconds = gate.resetAt
        ? Math.max(1, Math.ceil((new Date(gate.resetAt).getTime() - Date.now()) / 1000))
        : 3600;
      res.set('Retry-After', String(retrySeconds));
      return res.status(429).json({ error: limitMessage(gate.resetAt, gate.limit), resetAt: gate.resetAt });
    }

    const modelChain = [...new Set([selectedModel, GROQ_FALLBACK_MODEL].filter(Boolean))];

    const systemInstruction = buildGroqAnswerSystemInstruction(taskHint, styleHint);
    const groq = getGroq();

    let finalText = '';
    let finalModel = selectedModel;
    let finishReason;
    let lastError;

    for (let i = 0; i < modelChain.length; i += 1) {
      const model = modelChain[i];
      const isLastModel = i === modelChain.length - 1;
      try {
        const completion = await groq.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: userContent },
          ],
          temperature: 0.35,
          max_tokens: GROQ_MAX_TOKENS,
        });
        const choice = completion.choices?.[0];
        const assistantMsg = choice?.message;
        if (assistantMsg?.refusal && String(assistantMsg.refusal).trim()) {
          const err = new Error(String(assistantMsg.refusal).trim());
          err.code = 'REFUSAL';
          throw err;
        }
        const raw = groqAssistantMessageText(assistantMsg);
        finalText = String(raw || '').trim();
        finishReason = choice?.finish_reason || null;
        finalModel = completion.model || model;
        if (finalText) break;
        const err = new Error('Groq returned no text');
        err.statusCode = 503;
        lastError = err;
        if (!isLastModel) continue;
      } catch (e) {
        if (e?.code === 'REFUSAL') throw e;
        lastError = e;
        const status = e?.status ?? e?.statusCode;
        if (!isLastModel && shouldTryFallbackModel(status, e?.message)) continue;
        throw e;
      }
    }

    if (!finalText) {
      throw lastError || new Error('Groq returned no text');
    }

    // Do not use English word count — CJK text often has no spaces and was mis-counted as 1 "word".
    const nonSpaceChars = finalText.replace(/\s/g, '').length;
    if (nonSpaceChars < 8) {
      throw new Error('AI returned an incomplete answer. Please try again.');
    }
    if (finishReason === 'length') {
      throw new Error(
        'The answer hit the model output limit. Shorten the pasted job description or try again.'
      );
    }

    const payload = {
      text: finalText,
      answer: finalText,
      model: finalModel,
      provider: 'groq',
      finishReason: finishReason || undefined,
    };

    // Additive by construction: with no usable `corpus` in the body, `payload`
    // is byte-identical to what this route returned before the check existed.
    const corpus = sanitizeFabricationCorpus(req.body?.corpus);
    if (corpus.length > 0) {
      // Deterministic, zero model calls — safe to run on every generation.
      const { flags, rate } = validateAgainstCorpus(finalText, corpus);
      payload.fabricationFlags = flags;
      payload.fabricationRate = rate;
      // NEVER auto-retry on a flag. A silent regenerate-until-clean loop hides
      // the fabrication from the user, spends credits they did not authorise,
      // and converges on vague text that says nothing. The flags are returned;
      // the user sees them and decides.
      if (flags.length > 0) {
        // Counts only — the claims themselves are profile data (CLAUDE.md 8/11).
        log.debug('Fabrication flags on generated answer', {
          flagged: flags.length,
          corpusItems: corpus.length,
        });
      }
    }

    return res.json(payload);
  } catch (error) {
    if (error?.code === 'REFUSAL') {
      return res.status(502).json({ error: error.message || 'The model declined to answer.' });
    }
    const isAbort = error?.name === 'AbortError';
    const status = error?.status ?? error?.statusCode;
    let msg = isAbort ? 'AI request timed out' : (error?.message || 'Generation failed');
    if (status === 429) {
      msg = 'AI provider rate limit — wait a minute and try again.';
    }
    const lower = String(msg).toLowerCase();
    if (!isAbort && (lower.includes('rate limit') || lower.includes('too many requests'))) {
      msg = 'AI provider rate limit — wait a minute and try again.';
    }
    return res.status(error?.message?.includes('missing') ? 500 : 502).json({ error: msg });
  }
});

export default router;
