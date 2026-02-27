import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import DodoPayments from 'dodopayments';
import { supabaseAdmin, getProfile, updateProfile, requireAuth } from './supabase.js';

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
    const profile = await getProfile(req.userId);
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
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------------------------
// GET /api/credits — get current credit balance
// ------------------------------------------------------------------
app.get('/api/credits', requireAuth, async (req, res) => {
  try {
    const profile = await getProfile(req.userId);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.json({
      credits: profile.credits,
      isPremium: profile.is_premium,
    });
  } catch (error) {
    console.error('[API] GET /api/credits error:', error?.message || error);
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------------------------
// POST /api/credits/deduct — deduct 1 credit (server-verified)
// ------------------------------------------------------------------
app.post('/api/credits/deduct', requireAuth, async (req, res) => {
  try {
    const profile = await getProfile(req.userId);

    if (profile.is_premium) {
      return res.json({ success: true, remaining: Infinity, isPremium: true });
    }

    if (profile.credits <= 0) {
      return res.status(403).json({ success: false, remaining: 0, error: 'No credits remaining' });
    }

    const newCredits = profile.credits - 1;
    await updateProfile(req.userId, { credits: newCredits });

    await supabaseAdmin.from('credit_transactions').insert({
      user_id: req.userId,
      amount: -1,
      type: 'usage',
      description: 'AI generation credit used',
    });

    res.json({ success: true, remaining: newCredits });
  } catch (error) {
    console.error('POST /api/credits/deduct error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ------------------------------------------------------------------
// POST /api/credits/refund — refund 1 credit (e.g. failed generation)
// ------------------------------------------------------------------
app.post('/api/credits/refund', requireAuth, async (req, res) => {
  try {
    const profile = await getProfile(req.userId);

    if (profile.is_premium) {
      return res.json({ success: true, remaining: Infinity, isPremium: true });
    }

    const newCredits = profile.credits + 1;
    await updateProfile(req.userId, { credits: newCredits });

    await supabaseAdmin.from('credit_transactions').insert({
      user_id: req.userId,
      amount: 1,
      type: 'refund',
      description: 'Credit refunded (failed generation)',
    });

    res.json({ success: true, remaining: newCredits });
  } catch (error) {
    console.error('POST /api/credits/refund error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ------------------------------------------------------------------
// GET /api/verify-premium — verify premium status (authenticated)
// ------------------------------------------------------------------
app.get('/api/verify-premium', requireAuth, async (req, res) => {
  try {
    const profile = await getProfile(req.userId);

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
    console.error('Verify premium error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------------------------
// Shared Gemini helper
// ------------------------------------------------------------------
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.5-pro';
const GEMINI_MODELS = [...new Set([GEMINI_MODEL, GEMINI_FALLBACK_MODEL].filter(Boolean))];
const ANSWER_STUDIO_MODEL = process.env.ANSWER_STUDIO_MODEL || 'gemini-2.5-pro';
const ANSWER_STUDIO_FALLBACK_MODEL =
  process.env.ANSWER_STUDIO_FALLBACK_MODEL || GEMINI_MODEL || 'gemini-2.5-flash';

const ANSWER_STUDIO_ALLOWED_MODELS = new Set(
  [
    ANSWER_STUDIO_MODEL,
    ANSWER_STUDIO_FALLBACK_MODEL,
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    ...GEMINI_MODELS,
  ].filter(Boolean)
);

function sanitizeProviderErrorMessage(message, statusCode) {
  if (typeof message !== 'string') return `Gemini error (${statusCode})`;

  const cleaned = message
    .replace(/\bused_token\s*[:=]?\s*true\b/gi, '')
    .replace(/\bmsg\s*[:=]\s*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return cleaned || `Gemini error (${statusCode})`;
}

function extractGeminiErrorMessage(payload, statusCode) {
  const errorObj = payload?.error || payload || {};
  const rawMessage =
    (typeof errorObj?.message === 'string' && errorObj.message) ||
    (typeof errorObj?.msg === 'string' && errorObj.msg) ||
    (typeof payload?.message === 'string' && payload.message) ||
    null;

  return sanitizeProviderErrorMessage(rawMessage, statusCode);
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

function assessGeneratedAnswerQuality(text) {
  const cleaned = String(text || '').trim();
  if (!cleaned) return { score: 0, issues: ['empty output'], shouldRetry: true };

  const words = cleaned.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const sentenceCount = cleaned.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean).length;

  const hasPlaceholder =
    /\b(job profile|company name|this role|this position)\b/i.test(cleaned) ||
    /\[[^\]]{1,60}\]/.test(cleaned);
  const hasMarkdownOrBullets =
    /^[#>*-]\s/m.test(cleaned) || /```/.test(cleaned);
  const startsTooGeneric =
    /^(i am excited|i'm excited|thank you for considering|dear hiring manager)\b/i.test(cleaned);
  const hasConcreteSignals =
    /\b(\d+%|\d+\+|increased|reduced|improved|launched|built|led|owned|delivered|optimized)\b/i.test(cleaned);

  const issues = [];
  let score = 100;

  if (wordCount < 115) {
    issues.push(`too short (${wordCount} words)`);
    score -= 25;
  }
  if (wordCount > 260) {
    issues.push(`too long (${wordCount} words)`);
    score -= 12;
  }
  if (sentenceCount < 3) {
    issues.push('not enough sentence depth');
    score -= 16;
  }
  if (hasPlaceholder) {
    issues.push('contains placeholder/template wording');
    score -= 40;
  }
  if (hasMarkdownOrBullets) {
    issues.push('contains markdown/bullets');
    score -= 25;
  }
  if (startsTooGeneric) {
    issues.push('opens with generic phrase');
    score -= 14;
  }
  if (!hasConcreteSignals) {
    issues.push('lacks concrete signals/results');
    score -= 12;
  }

  const shouldRetry =
    hasPlaceholder ||
    hasMarkdownOrBullets ||
    wordCount < 110 ||
    score < 70;

  return { score: Math.max(0, score), issues, shouldRetry };
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

  const body = {
    contents: [{ role: 'user', parts: userParts }],
    generationConfig: { maxOutputTokens: maxTokens, temperature },
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  let lastError = new Error('Gemini request failed');

  const modelCandidates = Array.isArray(models) && models.length
    ? [...new Set(models.filter(Boolean))]
    : GEMINI_MODELS;

  for (let i = 0; i < modelCandidates.length; i += 1) {
    const model = modelCandidates[i];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const isLastModel = i === modelCandidates.length - 1;

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
// POST /api/answer-vault/generate — generate Answer Studio text via Gemini
// ------------------------------------------------------------------
app.post('/api/answer-vault/generate', requireAuth, async (req, res) => {
  try {
    const prompt = (req.body?.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
    const profile = await getProfile(req.userId);
    const isPremiumUser = !!profile?.is_premium;
    const qualityMode = isPremiumUser ? 'high' : 'standard';

    const requestedModel = (req.body?.model || '').trim();
    const selectedModel = ANSWER_STUDIO_ALLOWED_MODELS.has(requestedModel)
      ? requestedModel
      : ANSWER_STUDIO_MODEL;

    const answerSystemInstruction = `You are a senior career coach helping candidates win interviews.
Write one polished, open-ended application answer in plain text only.
Requirements:
- Sound human and specific, not generic.
- Use first-person voice ("I") and include 1-2 concrete examples where possible.
- Mention relevant skills and job-description keywords naturally.
- Keep a confident, concise, professional tone.
- Never output placeholders or template phrases like "job profile", "company name", "this role", or bracketed tokens.
- If company or JD context is missing, produce a versatile answer that still feels real and interview-ready.
- Prefer slightly fuller answers when helpful (roughly 130-220 words) while staying crisp.
- No headings, no bullet points, no markdown, no meta commentary.`;

    const answerModels = [...new Set([
      selectedModel,
      ANSWER_STUDIO_FALLBACK_MODEL,
      ...GEMINI_MODELS,
    ])];

    const firstPass = await callGemini({
      prompt,
      systemInstruction: answerSystemInstruction,
      maxTokens: 560,
      temperature: 0.25,
      models: answerModels,
    });

    let finalText = String(firstPass.text || '').trim();
    let finalModel = firstPass.model;
    const firstQuality = assessGeneratedAnswerQuality(finalText);
    const shouldRunSecondPass = qualityMode === 'high' || firstQuality.shouldRetry;

    // Premium gets high-quality mode (always second pass); standard only retries weak drafts.
    if (shouldRunSecondPass) {
      const qualityIssues = firstQuality.issues.length
        ? firstQuality.issues.join('; ')
        : 'answer quality is weak';

      const rewritePrompt = `Rewrite the draft below into a stronger final answer.
Follow the same objective and constraints as the original request.
Fix these issues: ${qualityIssues}
Quality mode: ${qualityMode === 'high' ? 'High quality (premium)' : 'Standard'}

Original Request:
${prompt}

Current Draft:
${finalText}

Return only the final rewritten answer in plain text.`;

      try {
        const secondPass = await callGemini({
          prompt: rewritePrompt,
          systemInstruction: answerSystemInstruction,
          maxTokens: 560,
          temperature: 0.35,
          models: answerModels,
        });

        const secondText = String(secondPass.text || '').trim();
        const secondQuality = assessGeneratedAnswerQuality(secondText);

        if (secondText && secondQuality.score >= firstQuality.score) {
          finalText = secondText;
          finalModel = secondPass.model;
        }
      } catch {
        // Keep first pass if rewrite fails; do not break working flow.
      }
    }

    return res.json({ text: finalText, model: finalModel });
  } catch (error) {
    const isAbort = error?.name === 'AbortError';
    const msg = isAbort ? 'AI request timed out' : (error?.message || 'Generation failed');
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
    const profile = await getProfile(req.userId);

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
    const profile = await getProfile(req.userId);

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
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('dodo_customer_id', customerId)
      .limit(1);
    if (profiles?.length) return profiles[0].id;
  }

  const email = data.customer?.email;
  if (email) {
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', email)
      .limit(1);
    if (profiles?.length) return profiles[0].id;
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
  });
}

export default app;
