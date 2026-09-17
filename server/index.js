import './load-env.js';
import express from 'express';
import cors from 'cors';
import DodoPayments from 'dodopayments';
import {
  supabaseAdmin,
  getProfile,
  updateProfile,
  requireAuth,
  formatSupabaseError,
} from './supabase.js';
// Imported after ./load-env.js on purpose: logger.js reads LOG_LEVEL at module load.
import { log, requestLogger, errorLogger, installProcessHandlers } from './logger.js';
import { requireCronSecret } from './cronAuth.js';
import { runIngest } from './jobs/ingest.js';
// Lifted out of this file so the ranking graph can share them without
// importing an Express app that calls app.listen(). Behaviour unchanged.
import { parseJsonLenient } from './llmJson.js';
import {
  getGroq,
  groqAssistantMessageText,
  shouldTryFallbackModel,
  GROQ_ANSWER_MODEL,
  GROQ_FALLBACK_MODEL,
  GROQ_MAX_TOKENS,
} from './groqClient.js';
import { ADAPTERS } from './jobs/adapters/index.js';
import { fetchJobPool } from './jobs/query.js';
import { runRankGraph, keywordOnlyResult, PREFILTER_LIMIT } from './jobs/graph.js';
import { createGroqModelCaller, renderPromptParts } from './jobs/rank.js';
import {
  cacheKey,
  createRankStore,
  rankWithCache,
  RANK_LIMIT_PER_HOUR,
} from './jobs/rankCache.js';
import { getPrompt } from './jobs/prompts/index.js';
import { buildResumeProfile, MATCHER_VERSION, validateAgainstCorpus } from '../src/matching/index.js';
import { startTrace, flushTracing, SpanType } from './observability/opik.js';

installProcessHandlers();

function apiErrorMessage(error) {
  if (error && typeof error.message === 'string' && error.message.trim()) {
    return error.message.trim();
  }
  return formatSupabaseError(error);
}

const dodo = new DodoPayments({
  bearerToken: process.env.DODO_PAYMENTS_API_KEY,
  environment: process.env.DODO_PAYMENTS_ENVIRONMENT || 'test_mode',
  webhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY,
});

/** Create a Dodo checkout session via SDK (v2+) or REST fallback (v0.x / missing SDK). */
async function createDodoCheckoutSession(payload) {
  if (dodo.checkoutSessions?.create) {
    return dodo.checkoutSessions.create(payload);
  }

  const env = process.env.DODO_PAYMENTS_ENVIRONMENT || 'test_mode';
  const baseUrl = env === 'live_mode'
    ? 'https://live.dodopayments.com'
    : 'https://test.dodopayments.com';

  const response = await fetch(`${baseUrl}/checkouts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.DODO_PAYMENTS_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  const body = await response.text();
  if (!response.ok) {
    let message = body.slice(0, 300);
    try {
      const parsed = JSON.parse(body);
      message = parsed.message || parsed.error || message;
    } catch { /* use raw text */ }
    throw new Error(message || `Dodo checkout failed (${response.status})`);
  }

  return JSON.parse(body);
}

const app = express();

// ------------------------------------------------------------------
// CORS — allow dashboard + local dev origins
// ------------------------------------------------------------------
const allowedOrigins = [
  process.env.CLIENT_URL || 'https://www.onextap.com',
  'https://www.onextap.com',
  'https://onextap.com',
  'http://localhost:5173',
  'http://localhost:3000',
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.some(o => origin.startsWith(o)) || origin.startsWith('chrome-extension://')) {
      return cb(null, true);
    }
    cb(new Error('CORS not allowed'));
  },
  credentials: true,
}));

// Request id (X-Request-Id) + one log line per completed request.
// Safe here: requestLogger reads no body, so the raw-body webhook below is
// unaffected.
app.use(requestLogger);

// ------------------------------------------------------------------
// Dodo Payments Webhook — MUST use raw body (before express.json)
// ------------------------------------------------------------------
app.post('/api/webhook', express.raw({ type: 'application/json' }), handleWebhook);

// ------------------------------------------------------------------
// Resume uploads carry the file itself, inline, as base64 — so this one route
// needs a far bigger body than everything else.
//
// Mounted HERE, path-scoped and ahead of the global parser, for the same
// mechanical reason the webhook is: body-parser marks a request parsed and
// skips it thereafter, so whichever parser runs first owns the limit.
//
// Path-scoped and not global on purpose. express.json()'s 100kb default is
// load-bearing for every other route — the AI generation routes lean on it as
// their floor under an untrusted body (see the fabrication corpus caps below)
// — and raising it globally would quietly hand that ceiling to all of them.
//
// 3mb, not 2mb: base64 is 4/3 the size of the bytes, so a 2 MB resume arrives
// as ~2.7 MB of JSON. RESUME_MAX_BYTES (at the route) is what actually rejects
// an oversized resume; this number only has to be loose enough that a legal
// one is not cut off first, and tight enough to still be a ceiling.
app.use('/api/parse-resume', express.json({ limit: '3mb' }));

// JSON parser for all other routes
app.use(express.json());

// ==================================================================
// AUTHENTICATED ROUTES (require Supabase JWT)
// ==================================================================

// ------------------------------------------------------------------
// GET /api/me — get authenticated user profile
// ------------------------------------------------------------------
app.get('/api/me', requireAuth, async (req, res) => {
  try {
    const profile = await getProfile(req.userId, req.userEmail);
    res.json({
      id: profile.id,
      email: profile.email,
      displayName: profile.display_name,
      credits: profile.credits,
      isPremium: profile.is_premium,
      subscriptionStatus: profile.subscription_status,
      premiumSince: profile.premium_since,
      createdAt: profile.created_at,
    });
  } catch (error) {
    log.error('GET /api/me error:', error);
    res.status(500).json({ error: apiErrorMessage(error) });
  }
});

// ------------------------------------------------------------------
// GET /api/credits — get current credit balance
// ------------------------------------------------------------------
app.get('/api/credits', requireAuth, async (req, res) => {
  try {
    const profile = await getProfile(req.userId, req.userEmail);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.json({
      credits: profile.credits,
      isPremium: profile.is_premium,
    });
  } catch (error) {
    log.error('[API] GET /api/credits error:', apiErrorMessage(error));
    res.status(500).json({ error: apiErrorMessage(error) });
  }
});

// ------------------------------------------------------------------
// POST /api/credits/deduct — deduct 1 credit (server-verified)
// ------------------------------------------------------------------
app.post('/api/credits/deduct', requireAuth, async (req, res) => {
  try {
    const profile = await getProfile(req.userId, req.userEmail);

    if (profile.is_premium) {
      return res.json({ success: true, remaining: Infinity, isPremium: true });
    }

    if (profile.credits <= 0) {
      return res.status(403).json({ success: false, remaining: 0, error: 'No credits remaining' });
    }

    const newCredits = profile.credits - 1;
    await updateProfile(req.userId, { credits: newCredits });

    const { error: deductTxError } = await supabaseAdmin
      .from('credit_transactions')
      .insert({
        user_id: req.userId,
        amount: -1,
        type: 'usage',
        description: 'AI generation credit used',
      });

    if (deductTxError) {
      log.error(
        '[API] credit_transactions insert failed after deduct:',
        formatSupabaseError(deductTxError)
      );
      try {
        await updateProfile(req.userId, { credits: profile.credits });
      } catch (rollbackErr) {
        log.error(
          '[API] Failed to rollback credits after deduct audit failure:',
          apiErrorMessage(rollbackErr)
        );
      }
      return res.status(500).json({
        success: false,
        error:
          'Could not record credit usage. Your balance was restored; please try again.',
      });
    }

    res.json({ success: true, remaining: newCredits });
  } catch (error) {
    log.error('POST /api/credits/deduct error:', apiErrorMessage(error));
    res.status(500).json({ success: false, error: apiErrorMessage(error) });
  }
});

// ------------------------------------------------------------------
// POST /api/credits/refund — refund 1 credit (e.g. failed generation)
// ------------------------------------------------------------------
app.post('/api/credits/refund', requireAuth, async (req, res) => {
  try {
    const profile = await getProfile(req.userId, req.userEmail);

    if (profile.is_premium) {
      return res.json({ success: true, remaining: Infinity, isPremium: true });
    }

    const newCredits = profile.credits + 1;
    await updateProfile(req.userId, { credits: newCredits });

    const { error: refundTxError } = await supabaseAdmin
      .from('credit_transactions')
      .insert({
        user_id: req.userId,
        amount: 1,
        type: 'refund',
        description: 'Credit refunded (failed generation)',
      });

    if (refundTxError) {
      log.error(
        '[API] credit_transactions insert failed after refund:',
        formatSupabaseError(refundTxError)
      );
      try {
        await updateProfile(req.userId, { credits: profile.credits });
      } catch (rollbackErr) {
        log.error(
          '[API] Failed to rollback credits after refund audit failure:',
          apiErrorMessage(rollbackErr)
        );
      }
      return res.status(500).json({
        success: false,
        error:
          'Could not record credit refund. Your balance was reverted; please try again.',
      });
    }

    res.json({ success: true, remaining: newCredits });
  } catch (error) {
    log.error('POST /api/credits/refund error:', apiErrorMessage(error));
    res.status(500).json({ success: false, error: apiErrorMessage(error) });
  }
});

// ------------------------------------------------------------------
// GET /api/verify-premium — verify premium status (authenticated)
// ------------------------------------------------------------------
app.get('/api/verify-premium', requireAuth, async (req, res) => {
  try {
    const profile = await getProfile(req.userId, req.userEmail);

    if (!profile.is_premium) {
      return res.json({ isPremium: false });
    }

    if (profile.dodo_subscription_id) {
      try {
        const sub = await dodo.subscriptions.retrieve(profile.dodo_subscription_id);
        const isActive = ['active', 'trialing'].includes(sub.status);
        if (!isActive) {
          await updateProfile(req.userId, {
            is_premium: false,
            subscription_status: sub.status,
          });
          return res.json({ isPremium: false, reason: 'subscription_inactive' });
        }
      } catch {
        // If Dodo is unreachable, trust local data (graceful degradation)
      }
    }

    res.json({
      isPremium: true,
      premiumSince: profile.premium_since,
      subscriptionStatus: profile.subscription_status || 'active',
    });
  } catch (error) {
    log.error('Verify premium error:', apiErrorMessage(error));
    res.status(500).json({ error: apiErrorMessage(error) });
  }
});

// ------------------------------------------------------------------
// AI provider config — two providers, split by task:
//   Gemini (multimodal) → POST /api/parse-resume
//   Groq   (fast text)   → POST /api/answer-vault/generate
// Each has a primary model plus a fallback tried on 404/429/5xx and on
// empty/blocked responses (see shouldTryFallbackModel).
// ------------------------------------------------------------------
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.5-pro';
const GEMINI_MODELS = [...new Set([GEMINI_MODEL, GEMINI_FALLBACK_MODEL].filter(Boolean))];

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

function sanitizeProviderErrorMessage(message, statusCode, label = 'Gemini') {
  if (typeof message !== 'string') return `${label} error (${statusCode})`;

  const cleaned = message
    .replace(/\bused_token\s*[:=]?\s*true\b/gi, '')
    .replace(/\bmsg\s*[:=]\s*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return cleaned || `${label} error (${statusCode})`;
}

function extractGeminiErrorMessage(payload, statusCode) {
  const errorObj = payload?.error || payload || {};
  const rawMessage =
    (typeof errorObj?.message === 'string' && errorObj.message) ||
    (typeof errorObj?.msg === 'string' && errorObj.msg) ||
    (typeof payload?.message === 'string' && payload.message) ||
    null;

  return sanitizeProviderErrorMessage(rawMessage, statusCode, 'Gemini');
}

function extractGeminiText(payload) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  const firstCandidate = candidates[0] || {};
  const parts = Array.isArray(firstCandidate?.content?.parts) ? firstCandidate.content.parts : [];

  const text = parts
    .filter((p) => p && p.thought !== true)
    .filter((p) => typeof p?.text === 'string' && p.text.trim().length > 0)
    .map((p) => p.text)
    .join('\n')
    .trim();

  if (text) {
    return { text, reason: null };
  }

  const finishReason = firstCandidate?.finishReason || null;
  const blockReason = payload?.promptFeedback?.blockReason || null;
  const details = [finishReason, blockReason].filter(Boolean).join(', ');
  const reason = details || 'no text returned by model';
  return { text: '', reason };
}

// extractFirstJsonObject() and parseJsonLenient() moved to ./llmJson.js so the
// ranking graph parses model output with the same battle-tested code rather
// than a third copy of it. parseJsonLenient is imported at the top of this file.

/** Top vault entries by word overlap with the application question (not full dump). */
function pickRelevantAnswers(vaultAnswers, question) {
  const q = String(question || '').trim();
  const list = Array.isArray(vaultAnswers) ? vaultAnswers : [];
  if (!q) return '(No question provided.)';
  if (list.length === 0) return '(No saved answers in vault.)';

  const questionWords = new Set(
    q.toLowerCase().split(/\W+/).filter((w) => w.length > 4)
  );

  const scored = list.map((entry) => {
    const eq = String(entry?.question || '');
    const ea = String(entry?.answer || '');
    const entryWords = `${eq} ${ea}`.toLowerCase().split(/\W+/);
    const overlap = entryWords.filter((w) => questionWords.has(w)).length;
    return { question: eq, answer: ea, score: overlap };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((e) => `Q: ${e.question}\nA: ${e.answer}`)
    .join('\n\n');
}

function buildGroqAnswerSystemInstruction(taskHint, styleHint) {
  const hints = [taskHint, styleHint].filter(Boolean);
  const hintBlock = hints.length
    ? `\n\nFollow for this request:\n${hints.map((h) => `- ${h}`).join('\n')}`
    : '';

  return `You are a job application assistant. Always write complete, polished answers in plain text only.
Never truncate. Never use "..." to stand in for content. Return only the answer text the employer should read—no headings, bullet lists, markdown, labels, or meta commentary.${hintBlock}

Rules:
- Answer the QUESTION in the user message directly; do not answer a different question.
- When job context is provided, tie concrete details to that role (tools, domain). Do not invent employer facts.
- First person ("I"); include specific examples and a measurable or observable result when consistent with context; never fabricate numbers.
- About 160–230 words unless the question clearly needs less.
- Never use placeholders like "company name" or "this role" as stand-ins.`;
}

/** Gemini 2.5 counts thinking tokens inside maxOutputTokens; Flash can disable thinking so the budget is mostly answer text. */
function thinkingConfigForGeminiModel(modelId) {
  const id = String(modelId || '').toLowerCase();
  if (!id.includes('gemini-2.5')) return undefined;
  if (id.includes('pro')) return undefined;
  if (id.includes('flash')) return { thinkingBudget: 0 };
  return undefined;
}

async function callGemini({ prompt, systemInstruction, maxTokens = 1024, temperature = 0.4, inlineData, models }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Server missing GEMINI_API_KEY');
  const userParts = [{ text: prompt }];
  if (inlineData?.data && inlineData?.mimeType) {
    userParts.push({
      inlineData: {
        mimeType: inlineData.mimeType,
        data: inlineData.data,
      },
    });
  }

  let lastError = new Error('Gemini request failed');

  const modelCandidates = Array.isArray(models) && models.length
    ? [...new Set(models.filter(Boolean))]
    : GEMINI_MODELS;

  for (let i = 0; i < modelCandidates.length; i += 1) {
    const model = modelCandidates[i];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const isLastModel = i === modelCandidates.length - 1;

    const generationConfig = { maxOutputTokens: maxTokens, temperature };
    const thinkingCfg = thinkingConfigForGeminiModel(model);
    if (thinkingCfg) generationConfig.thinkingConfig = thinkingCfg;

    const body = {
      contents: [{ role: 'user', parts: userParts }],
      generationConfig,
    };
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);

    try {
      const aiRes = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const payload = await aiRes.json().catch(() => ({}));
      if (!aiRes.ok) {
        const msg = extractGeminiErrorMessage(payload, aiRes.status);
        const err = new Error(msg);
        err.statusCode = aiRes.status;
        throw err;
      }

      const { text, reason } = extractGeminiText(payload);
      if (!text) {
        const err = new Error(`Gemini returned no text (${reason})`);
        // Treat as transient/provider behavior so fallback model gets a chance.
        err.statusCode = 503;
        throw err;
      }
      return { text, model };
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      const canFallback = !isLastModel && shouldTryFallbackModel(error?.statusCode, error?.message);
      if (canFallback) continue;
      break;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}

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
app.post('/api/answer-vault/generate', requireAuth, async (req, res) => {
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
      userContent = `
SAVED ANSWERS FOR CONTEXT:
${relevantAnswers}

${profileBlock}JOB CONTEXT:
${jobContext || 'Not provided'}

QUESTION:
${question}

EXISTING DRAFT (improve this):
${draft || 'None'}
`.trim();
    } else if (legacyPrompt) {
      userContent = legacyPrompt;
    } else {
      return res.status(400).json({ error: 'Missing question or userPrompt' });
    }

    const requestedModel = (req.body?.model || '').trim();
    const selectedModel = GROQ_ALLOWED_MODELS.has(requestedModel)
      ? requestedModel
      : GROQ_ANSWER_MODEL;

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

// ------------------------------------------------------------------
// POST /api/parse-resume — extract structured profile from resume via Gemini
// ------------------------------------------------------------------

/**
 * Largest resume file accepted, in decoded bytes.
 *
 * Mirrors MAX_RESUME_BYTES in src/resumeParse.js, which is what users actually
 * hit — this is the server's own floor under a body that did not come from our
 * client. Change one side, change both, and check the express.json() limit
 * mounted on this path stays above 4/3 of it.
 */
const RESUME_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Decoded byte length of a base64 payload, without decoding it.
 *
 * `Buffer.from(s, 'base64')` would answer the same question by allocating the
 * megabytes we are trying to decide whether to accept.
 *
 * @param {unknown} value
 * @returns {number} 0 for anything that is not a string.
 */
function base64ByteLength(value) {
  if (typeof value !== 'string' || !value) return 0;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}

app.post('/api/parse-resume', requireAuth, async (req, res) => {
  try {
    const { fileData, fileName, fileType } = req.body || {};
    if (!fileData) return res.status(400).json({ error: 'No file data provided' });

    const byteLength = base64ByteLength(fileData);
    if (byteLength > RESUME_MAX_BYTES) {
      return res.status(413).json({
        error: `Resume is too large (${(byteLength / (1024 * 1024)).toFixed(1)} MB). The limit is 2 MB.`,
      });
    }

    const systemInstruction = `You are a resume parser. Extract structured data from the resume text below and return ONLY valid JSON (no markdown fences, no explanation). Use this exact schema:
{
  "firstName": "",
  "lastName": "",
  "email": "",
  "phone": "",
  "address": { "street": "", "city": "", "state": "", "zip": "", "country": "" },
  "education": [{ "school": "", "degree": "", "field": "", "startDate": "", "endDate": "", "gpa": "" }],
  "experience": [{ "company": "", "title": "", "startDate": "", "endDate": "", "description": "" }],
  "skills": [""],
  "urls": [{ "type": "linkedin|github|portfolio|other", "value": "" }],
  "certificates": [{ "name": "", "issuer": "", "date": "" }],
  "currentJob": { "company": "", "title": "" },
  "__rawText": ""
}
Omit fields you cannot find. Return only the JSON object.

"__rawText" is the complete plain-text content of the document, transcribed
verbatim in reading order: every heading, bullet and line, with line breaks
preserved and nothing summarised, reordered, corrected or omitted. It is a
transcription, not a rewrite.`;

    const mimeType = (typeof fileType === 'string' && fileType.trim()) || 'application/pdf';
    const supportedMimeTypes = new Set([
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/webp',
      'image/heic',
      'image/heif',
    ]);
    if (!supportedMimeTypes.has(mimeType)) {
      return res.status(400).json({
        error: `Unsupported resume file type (${mimeType}). Please upload PDF or image files.`,
      });
    }
    const prompt = `Parse this resume file (filename: ${fileName || 'resume'}).
Use the attached file content, not guesses.
Return only valid JSON matching the schema.`;

    const { text: raw } = await callGemini({
      prompt,
      systemInstruction,
      // Raised from 2048 with the addition of "__rawText": the structured
      // fields alone fit comfortably in 2048, but a verbatim transcription of
      // a two-page resume does not, and a truncated response is an unparseable
      // one. The budget is a ceiling, not a cost — a short resume still
      // returns a short response.
      maxTokens: 8192,
      temperature: 0.1,
      inlineData: {
        mimeType,
        data: fileData,
      },
    });

    let data;
    try {
      data = parseJsonLenient(raw);
    } catch {
      // One repair attempt: ask model to return strictly valid JSON only.
      const repairPrompt = `Convert the following into valid JSON only.
Do not add explanations, markdown, or code fences.

${raw}`;

      const { text: repairedRaw } = await callGemini({
        prompt: repairPrompt,
        maxTokens: 8192,
        temperature: 0,
      });

      data = parseJsonLenient(repairedRaw);
    }

    // ═══ ADDITIVE, AND PROVABLY SO ═══
    //
    // The response is now { data, text }. `data` keeps EXACTLY the shape it
    // has always had: __rawText is deleted from it before it is returned, so
    // an existing caller that destructures `{ data }` sees a byte-identical
    // object and nothing downstream of it changes.
    //
    // WHY THE TEXT HAS TO COME BACK AT ALL: the corpus builder and the
    // fabrication validator both work against the resume's raw text, and
    // sourceSpan offsets are meaningless without it. The uploaded file's bytes
    // are discarded the moment this response is written, so the only
    // alternative to this key is asking the user to upload the same file a
    // second time.
    //
    // It rides along inside the existing extraction call rather than costing a
    // second one: the model is already reading the document.
    let text = '';
    if (data && typeof data === 'object') {
      if (typeof data.__rawText === 'string') text = data.__rawText;
      delete data.__rawText;
    }

    return res.json({ data, text });
  } catch (error) {
    log.error('POST /api/parse-resume error:', error?.message || error);
    if (error instanceof SyntaxError) {
      return res.status(502).json({ error: 'AI returned invalid JSON. Please try again.' });
    }
    return res.status(500).json({ error: error?.message || 'Resume parsing failed' });
  }
});

// ------------------------------------------------------------------
// POST /api/create-checkout-session — Dodo Payments Checkout (authenticated)
// ------------------------------------------------------------------
app.post('/api/create-checkout-session', requireAuth, async (req, res) => {
  try {
    const profile = await getProfile(req.userId, req.userEmail);

    if (profile.is_premium && profile.dodo_subscription_id) {
      try {
        const sub = await dodo.subscriptions.retrieve(profile.dodo_subscription_id);
        if (['active', 'trialing'].includes(sub.status)) {
          return res.status(400).json({ error: 'You already have an active Premium subscription.' });
        }
      } catch { /* subscription not found — continue */ }
    }

    const clientUrl = process.env.CLIENT_URL || 'https://www.onextap.com';

    const session = await createDodoCheckoutSession({
      product_cart: [{ product_id: process.env.DODO_PRODUCT_ID, quantity: 1 }],
      customer: {
        email: profile.email || req.userEmail || undefined,
        name: profile.display_name || undefined,
      },
      return_url: `${clientUrl}?payment=success`,
      metadata: {
        supabaseUserId: req.userId,
      },
    });

    res.json({ url: session.checkout_url, sessionId: session.session_id });
  } catch (error) {
    log.error('Checkout session error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------------------------
// POST /api/cancel-subscription — Cancel subscription (authenticated)
// ------------------------------------------------------------------
app.post('/api/cancel-subscription', requireAuth, async (req, res) => {
  try {
    const profile = await getProfile(req.userId, req.userEmail);

    if (!profile.dodo_subscription_id) {
      return res.status(400).json({ error: 'No active subscription found for this account.' });
    }

    await dodo.subscriptions.update(profile.dodo_subscription_id, {
      status: 'cancelled',
    });

    await updateProfile(req.userId, {
      is_premium: false,
      subscription_status: 'cancelled',
      cancelled_at: new Date().toISOString(),
    });

    log.info(`[Dodo] Subscription cancelled for user: ${req.userId}`);
    res.json({ success: true });
  } catch (error) {
    log.error('Cancel subscription error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================================================================
// DODO PAYMENTS WEBHOOK (unauthenticated — verified via signature)
// ==================================================================
async function handleWebhook(req, res) {
  let event;

  try {
    event = dodo.webhooks.unwrap(req.body.toString(), {
      headers: {
        'webhook-id': req.headers['webhook-id'],
        'webhook-signature': req.headers['webhook-signature'],
        'webhook-timestamp': req.headers['webhook-timestamp'],
      },
    });
  } catch (err) {
    log.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const data = event.data;

  switch (event.type) {
    // --- Subscription activated — activate premium ---
    case 'subscription.active': {
      const userId = await resolveUserId(data);
      if (userId) {
        try {
          await updateProfile(userId, {
            is_premium: true,
            dodo_subscription_id: data.subscription_id,
            dodo_customer_id: data.customer?.customer_id || null,
            subscription_status: 'active',
            premium_since: new Date().toISOString(),
          });
          log.info(`[Dodo] Premium activated for user: ${userId}`);
        } catch (err) {
          log.error('[Dodo] Failed to activate premium:', err);
        }
      }
      break;
    }

    // --- Subscription renewed ---
    case 'subscription.renewed': {
      const userId = await resolveUserId(data);
      if (userId) {
        try {
          await updateProfile(userId, {
            is_premium: true,
            subscription_status: 'active',
          });
          log.info(`[Dodo] Subscription renewed for user: ${userId}`);
        } catch (err) {
          log.error('[Dodo] Failed to update renewal:', err);
        }
      }
      break;
    }

    // --- Subscription on hold (payment issue) ---
    case 'subscription.on_hold': {
      const userId = await resolveUserId(data);
      if (userId) {
        try {
          await updateProfile(userId, {
            subscription_status: 'on_hold',
            payment_failed: true,
            last_failed_payment: new Date().toISOString(),
          });
          log.info(`[Dodo] Subscription on hold for user: ${userId}`);
        } catch (err) {
          log.error('[Dodo] Failed to update on_hold:', err);
        }
      }
      break;
    }

    // --- Subscription cancelled ---
    case 'subscription.cancelled': {
      const userId = await resolveUserId(data);
      if (userId) {
        try {
          await updateProfile(userId, {
            is_premium: false,
            subscription_status: 'cancelled',
            cancelled_at: new Date().toISOString(),
          });
          log.info(`[Dodo] Subscription cancelled for user: ${userId}`);
        } catch (err) {
          log.error('[Dodo] Failed to cancel subscription:', err);
        }
      }
      break;
    }

    // --- Subscription failed (mandate creation failed) ---
    case 'subscription.failed': {
      const userId = await resolveUserId(data);
      if (userId) {
        try {
          await updateProfile(userId, {
            is_premium: false,
            subscription_status: 'failed',
          });
          log.info(`[Dodo] Subscription failed for user: ${userId}`);
        } catch (err) {
          log.error('[Dodo] Failed to update failure:', err);
        }
      }
      break;
    }

    // --- Payment failed ---
    case 'payment.failed': {
      const userId = await resolveUserId(data);
      if (userId) {
        try {
          await updateProfile(userId, {
            payment_failed: true,
            last_failed_payment: new Date().toISOString(),
          });
          log.info(`[Dodo] Payment failed for user: ${userId}`);
        } catch (err) {
          log.error('[Dodo] Failed to process payment failure:', err);
        }
      }
      break;
    }
  }

  res.json({ received: true });
}

/**
 * Resolve the Supabase user ID from a Dodo webhook payload.
 * Tries metadata first, then dodo_customer_id lookup, then email lookup.
 */
async function resolveUserId(data) {
  if (data.metadata?.supabaseUserId) {
    return data.metadata.supabaseUserId;
  }

  const customerId = data.customer?.customer_id;
  if (customerId) {
    const { data: profiles, error: byCustomerErr } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('dodo_customer_id', customerId)
      .limit(1);
    if (byCustomerErr) {
      log.error(
        '[Dodo] resolveUserId dodo_customer_id lookup failed:',
        formatSupabaseError(byCustomerErr)
      );
    } else if (profiles?.length) {
      return profiles[0].id;
    }
  }

  const email = data.customer?.email;
  if (email) {
    const { data: profiles, error: byEmailErr } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', email)
      .limit(1);
    if (byEmailErr) {
      log.error(
        '[Dodo] resolveUserId email lookup failed:',
        formatSupabaseError(byEmailErr)
      );
    } else if (profiles?.length) {
      return profiles[0].id;
    }
  }

  log.warn('[Dodo] Could not resolve user for webhook:', JSON.stringify(data).slice(0, 200));
  return null;
}

// ------------------------------------------------------------------
// Job ingest (cron)
// ------------------------------------------------------------------
// Walks the adapter cascade and refreshes public.job_listings. Guarded by a
// shared secret, not a Supabase JWT — no user is signed in when a scheduler
// fires it.
//
// REGISTERED ON BOTH VERBS ON PURPOSE. **Vercel Cron issues a GET**, always,
// with no body. A POST-only route would 404 in production and nowhere else:
// every local curl and every manual test would pass, the cron dashboard would
// show a 404 nobody reads, and the pool would silently never refresh. POST is
// kept because it is the honest verb for an operation with side effects, and
// because it is what a human reaches for.
//
// Optional query params: ?sources=adzuna,cache  ?maxPages=2  ?budgetMs=15000
async function handleJobIngest(req, res) {
  const rawSources = typeof req.query?.sources === 'string' ? req.query.sources : '';
  const sources = rawSources
    ? rawSources.split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;

  try {
    const result = await runIngest({
      sources,
      maxPages: req.query?.maxPages,
      budgetMs: req.query?.budgetMs,
    });
    // Non-2xx when nothing ingested cleanly, so a failed cron run shows red on
    // the scheduler's dashboard instead of a green 200 with an empty pool.
    res.status(result.ok ? 200 : 500).json(result);
  } catch (error) {
    // runIngest catches its own failures; this is the belt to that braces.
    log.child('jobs').error('ingest route failed', error);
    res.status(500).json({ ok: false, error: apiErrorMessage(error) });
  }
}

app.get('/api/jobs/ingest', requireCronSecret, handleJobIngest);
app.post('/api/jobs/ingest', requireCronSecret, handleJobIngest);

// ==================================================================
// JOB SEARCH — pool browse, ranking, explanation
// ==================================================================
// All four routes are registered here: after app.use(express.json()) (they
// read JSON bodies and query strings) and before app.use(errorLogger) (so a
// throw that escapes a handler still becomes a logged JSON error rather than
// Express's default HTML stack page). The Dodo webhook's express.raw()
// registration above express.json() is untouched and must stay that way.
//
// EVERY ONE OF THESE ANSWERS WITH JSON WHEN THE DATABASE IS DOWN. Supabase
// being unreachable is a normal operating condition for a job board —
// a cold project, a paused instance, a bad key — and the difference between
// a JSON error and an HTML stack page is the difference between a client that
// shows "couldn't load jobs, retry" and one that renders a parse error.

// One child logger per area, built once at module load rather than per request
// — log.child() only tags a scope string, so a fresh one on every call is pure
// waste. Both names end in `Log` on purpose: test/server/logger.test.js scans
// for `*Log.warn({ name: ... })` call sites, and a variable named anything else
// would drop these lines out of that scan.
const jobsLog = log.child('jobs');
const rankLog = log.child('rank');

/** Provider/database error text in a JSON body. Enough to act on, never a stack. */
const CLIENT_ERROR_CHARS = 300;

/**
 * A provider or database error, trimmed to something a client can display.
 *
 * postgrest-js puts the whole `TypeError: fetch failed` stack into `details`,
 * and formatSupabaseError joins message + details — so an unreachable database
 * produces a JSON body containing a multi-line Node stack trace. It is JSON
 * rather than Express's HTML error page, but a stack in a response body is
 * still a stack in a response body: it tells the user nothing, it is the kind
 * of internal detail that should not cross a trust boundary, and it makes the
 * actual message impossible to find.
 *
 * The first line carries the diagnosis; the rest is for the log, which already
 * has it under the same X-Request-Id.
 *
 * Applied in the job routes only. The existing routes are left exactly as they
 * were — changing what they return is a separate decision from adding these.
 *
 * @param {unknown} error
 * @returns {string} A single line, never empty.
 */
function clientErrorMessage(error) {
  const raw = apiErrorMessage(error);
  const firstLine = String(raw).split('\n')[0].trim();
  return (firstLine || 'Request failed').slice(0, CLIENT_ERROR_CHARS);
}

/**
 * Body-or-query filters, normalised once for both the browse and rank paths.
 *
 * Deliberately shallow — it picks the seven keys the pool understands and
 * coerces the two free-text ones, and leaves the rest to fetchJobPool, which
 * is where limit clamping, date parsing and LIKE escaping already live and
 * where a test can see them. Two normalisation layers would be one too many.
 *
 * @param {unknown} source req.query or req.body.filters.
 * @returns {object} Filters in the shape query.js expects.
 */
function readJobFilters(source = {}) {
  const s = source && typeof source === 'object' ? source : {};
  return {
    limit: s.limit,
    cursor: typeof s.cursor === 'string' ? s.cursor : undefined,
    remote: s.remote,
    location: typeof s.location === 'string' ? s.location : '',
    source: typeof s.source === 'string' ? s.source : undefined,
    q: typeof s.q === 'string' ? s.q : '',
    since: s.since,
  };
}

/**
 * Deduct one credit, mirroring POST /api/credits/deduct exactly.
 *
 * A local helper rather than a refactor of that route: the credit routes are
 * the anti-tamper surface of this product and are not worth restructuring to
 * save a few lines. Premium is free, the amount is 1, and the audit row is
 * written or the balance is rolled back — same rules, same table.
 *
 * @param {string} userId
 * @param {string} userEmail
 * @param {string} description Written to the audit row.
 * @returns {Promise<{charged: boolean, remaining: number}>} `remaining` is
 *   Infinity for a premium account, which was not charged.
 * @throws {Error} When the balance is empty or the audit write fails; the
 *   caller turns that into a 403/500 and has not yet generated anything.
 */
async function chargeOneCredit(userId, userEmail, description) {
  const profile = await getProfile(userId, userEmail);
  if (profile.is_premium) return { charged: false, remaining: Infinity };
  if (profile.credits <= 0) {
    const err = new Error('No credits remaining');
    err.statusCode = 403;
    throw err;
  }

  const newCredits = profile.credits - 1;
  await updateProfile(userId, { credits: newCredits });

  const { error: txError } = await supabaseAdmin.from('credit_transactions').insert({
    user_id: userId,
    amount: -1,
    type: 'usage',
    description,
  });

  if (txError) {
    log.error('[API] credit_transactions insert failed after deduct:', formatSupabaseError(txError));
    try {
      await updateProfile(userId, { credits: profile.credits });
    } catch (rollbackErr) {
      log.error('[API] Failed to rollback credits after deduct audit failure:', apiErrorMessage(rollbackErr));
    }
    const err = new Error('Could not record credit usage. Your balance was restored; please try again.');
    err.statusCode = 500;
    throw err;
  }

  return { charged: true, remaining: newCredits };
}

/**
 * Give a credit back after a failure that happened AFTER the deduction.
 *
 * Never throws: this runs on an error path, and a failed refund must not
 * replace the error the user actually needs to see. It logs loudly instead —
 * a silently swallowed refund failure is a credit the user paid for nothing.
 *
 * @param {string} userId
 * @param {string} userEmail
 * @param {string} description Written to the audit row.
 * @returns {Promise<void>}
 */
async function refundOneCredit(userId, userEmail, description) {
  try {
    const profile = await getProfile(userId, userEmail);
    if (profile.is_premium) return;
    await updateProfile(userId, { credits: profile.credits + 1 });
    const { error: txError } = await supabaseAdmin.from('credit_transactions').insert({
      user_id: userId,
      amount: 1,
      type: 'refund',
      description,
    });
    if (txError) {
      log.error('[API] credit_transactions insert failed after refund:', formatSupabaseError(txError));
    }
  } catch (err) {
    log.error('[API] credit refund failed after a failed generation:', apiErrorMessage(err));
  }
}

// ------------------------------------------------------------------
// GET /api/jobs — unranked pool browse
// ------------------------------------------------------------------
// No LLM, no credits, no resume. This is the "just show me what's there" path:
// the empty state, the source filter, the thing that still works when every
// AI provider in the stack is down.
app.get('/api/jobs', requireAuth, async (req, res) => {
  try {
    const { jobs, nextCursor } = await fetchJobPool(supabaseAdmin, readJobFilters(req.query));
    res.json({ jobs, nextCursor, total: jobs.length });
  } catch (error) {
    jobsLog.error('GET /api/jobs failed', { errName: error?.name });
    res.status(502).json({ error: clientErrorMessage(error), jobs: [], nextCursor: null });
  }
});

// ------------------------------------------------------------------
// GET /api/jobs/meta — what is in the pool, and what is broken
// ------------------------------------------------------------------
// This route is why the empty state can be honest. "No jobs found" is four
// completely different situations — a quiet market, a filter that excludes
// everything, a dead Adzuna key, a cron that has not run since Tuesday — and
// a UI that cannot tell them apart can only shrug. The per-source lastError
// and lastRunAt here are what turn that shrug into a named cause.
app.get('/api/jobs/meta', requireAuth, async (_req, res) => {
  // Adapter identity and enablement come from the registry, not the database:
  // a source that has never run has no state row, and the answer for it is
  // "configured but never run", not "does not exist".
  const registry = ADAPTERS.map((adapter) => {
    let enabled = false;
    try {
      enabled = adapter.enabled() === true;
    } catch {
      enabled = false;
    }
    return { id: adapter.id, enabled, count: 0, lastRunAt: null, lastError: null };
  });

  const byId = new Map(registry.map((s) => [s.id, s]));
  let total = 0;
  let oldestPostedAt = null;
  let degraded = false;

  try {
    const { data: states, error: stateError } = await supabaseAdmin
      .from('job_ingest_state')
      .select('source,last_run_at,last_status,last_error,inserted_count');
    if (stateError) throw new Error(formatSupabaseError(stateError));

    for (const row of states || []) {
      const entry = byId.get(row.source) || { id: row.source, enabled: false, count: 0 };
      entry.lastRunAt = row.last_run_at || null;
      // last_error is read through last_status, never raw: "ok with an old
      // error string" and "failing right now" look identical otherwise. A
      // successful ingest already nulls last_error (see ingest.js), so this is
      // belt to that braces — it guarantees an 'ok' source can never render as
      // broken, whatever a partial write or an older ingest left behind.
      // last_status itself is not forwarded: the client renders a cause, not a
      // state machine, and `lastError === null` already means healthy.
      entry.lastError = row.last_status === 'ok' ? null : row.last_error || null;
      if (!byId.has(row.source)) {
        byId.set(row.source, entry);
        registry.push(entry);
      }
    }
  } catch (error) {
    degraded = true;
    jobsLog.warn('ingest state unavailable for /api/jobs/meta', { errName: error?.name });
  }

  try {
    for (const entry of registry) {
      const { count, error } = await supabaseAdmin
        .from('job_listings')
        .select('id', { count: 'exact', head: true })
        .eq('source', entry.id);
      if (error) throw new Error(formatSupabaseError(error));
      entry.count = count || 0;
      total += entry.count;
    }

    const { data: oldest, error: oldestError } = await supabaseAdmin
      .from('job_listings')
      .select('posted_at')
      .order('posted_at', { ascending: true })
      .limit(1);
    if (oldestError) throw new Error(formatSupabaseError(oldestError));
    oldestPostedAt = oldest?.[0]?.posted_at || null;
  } catch (error) {
    degraded = true;
    jobsLog.warn('pool counts unavailable for /api/jobs/meta', { errName: error?.name });
  }

  // 200 even when degraded. The caller asked "what is in the pool"; "we could
  // not reach the pool" is an answer to that question, and the shape it needs
  // to render is the same shape.
  res.json({
    sources: registry.map((s) => ({
      id: s.id,
      enabled: s.enabled,
      count: s.count,
      lastRunAt: s.lastRunAt ?? null,
      lastError: s.lastError ?? null,
    })),
    total,
    oldestPostedAt,
    degraded,
  });
});

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
app.post('/api/jobs/rank', requireAuth, async (req, res) => {
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
          deps: { fetchJobs, callModel: createGroqModelCaller(), trace },
        }),
      // Over the hourly limit: still a list, still ordered, just scored by the
      // local matcher. Never an error — see rankWithCache.
      keywordFallback: async () => {
        try {
          const { jobs } = await fetchJobs(filters);
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
    const jobs = outcome.jobs || [];
    const totalFailure = Boolean(outcome.error) && jobs.length === 0 && outcome.limited !== true;

    res.status(totalFailure ? 502 : 200).json({
      error: outcome.error ? clientErrorMessage(outcome.error) : null,
      jobs,
      loops: outcome.loops ?? 0,
      reformulations: outcome.reformulations || [],
      degraded: outcome.degraded === true,
      scoredBy: outcome.scoredBy || 'keyword',
      limited: outcome.limited === true,
      cached: outcome.cached === true,
      meta: {
        requestId: req.id || null,
        total: jobs.length,
        poolSize: outcome.poolSize ?? 0,
        prefilterLimit: PREFILTER_LIMIT,
        matcherVersion: outcome.matcherVersion ?? MATCHER_VERSION,
        sources: outcome.sources || [],
        timings: outcome.timings || null,
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
      degraded: true,
      scoredBy: 'keyword',
      limited: false,
      cached: false,
      meta: { requestId: req.id || null, total: 0 },
    });
  }
});

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

/** Audit-row text for the charge, and for the refund that undoes it. */
const EXPLAIN_CHARGE_DESCRIPTION = 'Job fit analysis';
const EXPLAIN_REFUND_DESCRIPTION = 'Credit refunded (failed job fit analysis)';

/**
 * How much of one job description reaches the model.
 *
 * Twenty thousand characters is a long posting in full plus its boilerplate.
 * The cap exists because this is the one route that handles third-party text
 * of unbounded length — a scraped page can be a whole careers site — and a
 * single request must not be able to price itself arbitrarily.
 */
const EXPLAIN_DESCRIPTION_CHARS = 20000;

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
 */
const EXPLAIN_MAX_TOKENS = 2048;
const EXPLAIN_TEMPERATURE = 0.25;
const TAILOR_MAX_TOKENS = 1500;
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

app.post('/api/jobs/explain', requireAuth, async (req, res) => {
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
    const explained = parseJsonLenient(explainRaw);
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


// ------------------------------------------------------------------
// Health Check
// ------------------------------------------------------------------
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ------------------------------------------------------------------
// Error handler — must stay last, after every route
// ------------------------------------------------------------------
// Catches anything thrown outside a route's own try/catch. Without it Express
// serves its default HTML stack-trace page and logs nothing.
app.use(errorLogger);

// ------------------------------------------------------------------
// Start Server (only when running locally, not on Vercel)
// ------------------------------------------------------------------
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    log.info(`Onextap server running on port ${PORT}`);
    log.info(`Webhook endpoint: POST /api/webhook`);
    log.info(`Health check:     GET  /api/health`);
    log.info(
      `[Answer Studio] provider=groq model=${GROQ_ANSWER_MODEL} GROQ_API_KEY=${process.env.GROQ_API_KEY ? 'set' : 'MISSING'}`
    );
  });
}

export default app;
