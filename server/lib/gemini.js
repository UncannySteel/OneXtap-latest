/**
 * Gemini over raw fetch: the model chain and callGemini(), shared by resume
 * parsing (server/routes/resume.js) and ranking (server/routes/jobRank.js).
 */
import { shouldTryFallbackModel } from '../groqClient.js';

// ------------------------------------------------------------------
// AI provider config — two providers, split by task:
//   Gemini (multimodal) → POST /api/parse-resume
//   Groq   (fast text)   → POST /api/answer-vault/generate
// Each has a primary model plus a fallback tried on 404/429/5xx and on
// empty/blocked responses (see shouldTryFallbackModel).
// ------------------------------------------------------------------
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

/**
 * Parse a comma-separated model list from the environment.
 *
 * Shared by the two Gemini chains (resume parsing here, ranking further down)
 * so they cannot drift in how they read their own configuration.
 *
 * @param {unknown} raw Comma-separated ids, or nothing.
 * @param {string[]} fallback Used when `raw` yields no usable ids.
 * @returns {string[]} Trimmed, de-duplicated, non-empty ids.
 */
function modelList(raw, fallback) {
  const parsed = [...new Set(String(raw || '').split(',').map((m) => m.trim()).filter(Boolean))];
  return parsed.length ? parsed : [...new Set(fallback.filter(Boolean))];
}

/**
 * The model chain for POST /api/parse-resume, tried in order.
 *
 * ═══ WHY A CHAIN AND NOT A PRIMARY + FALLBACK PAIR ═══
 *
 * Gemini's free tier rations `generateContent` at 20 requests per DAY, PER
 * MODEL. Each id is therefore its own quota bucket and a longer chain is
 * strictly more capacity — the same reasoning that produced GEMINI_RANK_MODELS
 * below. Ranking and parsing share those buckets, so a day of ranking can
 * exhaust the model parsing was about to use.
 *
 * This used to be `[GEMINI_MODEL, GEMINI_FALLBACK_MODEL]`, terminating on
 * `gemini-2.5-pro` — retired for new accounts. Being the LAST link is what
 * made it user-visible: `callGemini` advances on "no longer available" (see
 * shouldTryFallbackModel) but had nowhere left to go, so it rethrew and the
 * route returned Google's own sentence verbatim as a 500. The lesson is not
 * "replace the fallback id", it is that a chain must not END on anything that
 * can go away. Every id below is live on this account, and the list is
 * deliberately longer than two.
 *
 * Multimodal-capable ids only: this route sends a PDF or image inline.
 */
const GEMINI_MODELS = modelList(process.env.GEMINI_PARSE_MODELS, [
  GEMINI_MODEL,
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
]);

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

/** Gemini 2.5 counts thinking tokens inside maxOutputTokens; Flash can disable thinking so the budget is mostly answer text. */
function thinkingConfigForGeminiModel(modelId) {
  const id = String(modelId || '').toLowerCase();
  if (id.includes('pro')) return undefined;

  // Flash-lite: send NOTHING. Measured on the live API — these models do not
  // think by default (a two-token answer bills two tokens), and at least one of
  // them, gemini-3.5-flash-lite, rejects thinkingBudget outright with a 400.
  // Omitting the field is both correct and the only thing that works on all of
  // them, so it is not worth a per-model exception list that drifts.
  if (id.includes('flash-lite')) return undefined;

  // Flash: thinking is ON by default from 2.5 onward and bills against the
  // SAME maxOutputTokens the scores come out of, so leaving it on does not just
  // cost latency — it truncates the JSON array and silently keyword-scores the
  // tail of the batch. Verified accepted on 2.5, 3.5 and 3.6 flash.
  if (id.includes('flash')) return { thinkingBudget: 0 };
  return undefined;
}

export async function callGemini({ prompt, systemInstruction, maxTokens = 1024, temperature = 0.4, inlineData, models, timeoutMs = 90000 }) {
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
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

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
