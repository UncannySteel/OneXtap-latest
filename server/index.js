import './load-env.js';
import Groq from 'groq-sdk';
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

// ------------------------------------------------------------------
// Dodo Payments Webhook — MUST use raw body (before express.json)
// ------------------------------------------------------------------
app.post('/api/webhook', express.raw({ type: 'application/json' }), handleWebhook);

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
    console.error('GET /api/me error:', error);
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
    console.error('[API] GET /api/credits error:', apiErrorMessage(error));
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
      console.error(
        '[API] credit_transactions insert failed after deduct:',
        formatSupabaseError(deductTxError)
      );
      try {
        await updateProfile(req.userId, { credits: profile.credits });
      } catch (rollbackErr) {
        console.error(
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
    console.error('POST /api/credits/deduct error:', apiErrorMessage(error));
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
      console.error(
        '[API] credit_transactions insert failed after refund:',
        formatSupabaseError(refundTxError)
      );
      try {
        await updateProfile(req.userId, { credits: profile.credits });
      } catch (rollbackErr) {
        console.error(
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
    console.error('POST /api/credits/refund error:', apiErrorMessage(error));
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
        const sub = await dodo.subscriptions.get(profile.dodo_subscription_id);
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
    console.error('Verify premium error:', apiErrorMessage(error));
    res.status(500).json({ error: apiErrorMessage(error) });
  }
});

// ------------------------------------------------------------------
// Shared Gemini helper
// ------------------------------------------------------------------
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.5-pro';
const GEMINI_MODELS = [...new Set([GEMINI_MODEL, GEMINI_FALLBACK_MODEL].filter(Boolean))];

/** Answer Studio uses Groq (fast inference), not Gemini. */
const GROQ_ANSWER_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_FALLBACK_MODEL = process.env.GROQ_FALLBACK_MODEL || 'llama-3.1-8b-instant';

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

const _groqMaxTok = Number.parseInt(process.env.GROQ_MAX_TOKENS || '4096', 10);
const GROQ_MAX_TOKENS =
  Number.isFinite(_groqMaxTok) && _groqMaxTok >= 256 ? Math.min(_groqMaxTok, 8192) : 4096;

let groqClient;
function getGroq() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('Server missing GROQ_API_KEY');
  if (!groqClient) groqClient = new Groq({ apiKey });
  return groqClient;
}

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

function shouldTryFallbackModel(statusCode, message) {
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

function extractFirstJsonObject(text) {
  if (typeof text !== 'string') return null;

  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;

  const start = trimmed.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return trimmed.slice(start, i + 1);
    }
  }

  return null;
}

function parseJsonLenient(raw) {
  const stripped = String(raw || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  const candidate = extractFirstJsonObject(stripped) || stripped;
  const withoutTrailingCommas = candidate.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(withoutTrailingCommas);
}

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

/** Groq/OpenAI-style messages may use string or array content parts. */
function groqAssistantMessageText(message) {
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
// POST /api/answer-vault/generate — Answer Studio via Groq (groq-sdk)
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

    return res.json({
      text: finalText,
      answer: finalText,
      model: finalModel,
      provider: 'groq',
      finishReason: finishReason || undefined,
    });
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
app.post('/api/parse-resume', requireAuth, async (req, res) => {
  try {
    const { fileData, fileName, fileType } = req.body || {};
    if (!fileData) return res.status(400).json({ error: 'No file data provided' });

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
  "currentJob": { "company": "", "title": "" }
}
Omit fields you cannot find. Return only the JSON object.`;

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
      maxTokens: 2048,
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
        maxTokens: 2048,
        temperature: 0,
      });

      data = parseJsonLenient(repairedRaw);
    }

    return res.json({ data });
  } catch (error) {
    console.error('POST /api/parse-resume error:', error?.message || error);
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
        const sub = await dodo.subscriptions.get(profile.dodo_subscription_id);
        if (['active', 'trialing'].includes(sub.status)) {
          return res.status(400).json({ error: 'You already have an active Premium subscription.' });
        }
      } catch { /* subscription not found — continue */ }
    }

    const clientUrl = process.env.CLIENT_URL || 'https://www.onextap.com';

    const session = await dodo.checkoutSessions.create({
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
    console.error('Checkout session error:', error);
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

    console.log(`[Dodo] Subscription cancelled for user: ${req.userId}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Cancel subscription error:', error);
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
    console.error('Webhook signature verification failed:', err.message);
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
          console.log(`[Dodo] Premium activated for user: ${userId}`);
        } catch (err) {
          console.error('[Dodo] Failed to activate premium:', err);
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
          console.log(`[Dodo] Subscription renewed for user: ${userId}`);
        } catch (err) {
          console.error('[Dodo] Failed to update renewal:', err);
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
          console.log(`[Dodo] Subscription on hold for user: ${userId}`);
        } catch (err) {
          console.error('[Dodo] Failed to update on_hold:', err);
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
          console.log(`[Dodo] Subscription cancelled for user: ${userId}`);
        } catch (err) {
          console.error('[Dodo] Failed to cancel subscription:', err);
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
          console.log(`[Dodo] Subscription failed for user: ${userId}`);
        } catch (err) {
          console.error('[Dodo] Failed to update failure:', err);
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
          console.log(`[Dodo] Payment failed for user: ${userId}`);
        } catch (err) {
          console.error('[Dodo] Failed to process payment failure:', err);
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
      console.error(
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
      console.error(
        '[Dodo] resolveUserId email lookup failed:',
        formatSupabaseError(byEmailErr)
      );
    } else if (profiles?.length) {
      return profiles[0].id;
    }
  }

  console.warn('[Dodo] Could not resolve user for webhook:', JSON.stringify(data).slice(0, 200));
  return null;
}

// ------------------------------------------------------------------
// Health Check
// ------------------------------------------------------------------
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ------------------------------------------------------------------
// Start Server (only when running locally, not on Vercel)
// ------------------------------------------------------------------
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`Onextap server running on port ${PORT}`);
    console.log(`Webhook endpoint: POST /api/webhook`);
    console.log(`Health check:     GET  /api/health`);
    console.log(
      `[Answer Studio] provider=groq model=${GROQ_ANSWER_MODEL} GROQ_API_KEY=${process.env.GROQ_API_KEY ? 'set' : 'MISSING'}`
    );
  });
}

export default app;
