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

const DEFAULT_JOB_INTELLIGENCE_LOOKBACK_DAYS = 10;
const JOB_MATCH_CATEGORIES = {
  STRONG: 'Strong Match',
  GOOD: 'Good Match',
  STRETCH: 'Stretch Match',
  LOW: 'Low Match',
};
const inMemoryJobIntelState = new Map();

const SAMPLE_JOB_SOURCE = [
  {
    id: 'job-1',
    title: 'Senior Frontend Engineer',
    company: 'Nimbus Labs',
    location: 'Berlin, Germany',
    remoteType: 'hybrid',
    salaryMin: 95000,
    salaryMax: 125000,
    currency: 'EUR',
    visaSponsorship: true,
    seniority: 'Senior',
    experienceMinYears: 5,
    domainTags: ['SaaS', 'Developer Tools'],
    requiredSkills: ['React', 'TypeScript', 'JavaScript', 'Testing'],
    preferredSkills: ['Next.js', 'Design Systems', 'Web Performance'],
    postedAtSource: new Date(Date.now() - 2 * 86400000).toISOString(),
    source: 'aggregated',
    url: 'https://example.com/jobs/senior-frontend-engineer',
  },
  {
    id: 'job-2',
    title: 'Product Marketing Manager',
    company: 'Northstar AI',
    location: 'Remote (US)',
    remoteType: 'remote',
    salaryMin: 120000,
    salaryMax: 150000,
    currency: 'USD',
    visaSponsorship: false,
    seniority: 'Mid-Senior',
    experienceMinYears: 4,
    domainTags: ['AI', 'B2B SaaS'],
    requiredSkills: ['Go-to-market', 'Positioning', 'Content Strategy'],
    preferredSkills: ['Product-led growth', 'Analytics', 'Customer Research'],
    postedAtSource: new Date(Date.now() - 4 * 86400000).toISOString(),
    source: 'aggregated',
    url: 'https://example.com/jobs/product-marketing-manager',
  },
  {
    id: 'job-3',
    title: 'Associate Product Manager',
    company: 'Orbit Commerce',
    location: 'London, UK',
    remoteType: 'onsite',
    salaryMin: 52000,
    salaryMax: 68000,
    currency: 'GBP',
    visaSponsorship: true,
    seniority: 'Junior',
    experienceMinYears: 1,
    domainTags: ['E-commerce'],
    requiredSkills: ['Stakeholder Communication', 'Roadmapping', 'User Stories'],
    preferredSkills: ['SQL', 'Experimentation', 'Agile'],
    postedAtSource: new Date(Date.now() - 1 * 86400000).toISOString(),
    source: 'aggregated',
    url: 'https://example.com/jobs/associate-product-manager',
  },
  {
    id: 'job-4',
    title: 'Staff Data Engineer',
    company: 'Atlas Health',
    location: 'Toronto, Canada',
    remoteType: 'remote',
    salaryMin: 160000,
    salaryMax: 210000,
    currency: 'CAD',
    visaSponsorship: false,
    seniority: 'Staff',
    experienceMinYears: 8,
    domainTags: ['Healthcare', 'Data Platform'],
    requiredSkills: ['Python', 'SQL', 'Data Modeling', 'Spark', 'ETL'],
    preferredSkills: ['Airflow', 'AWS', 'dbt'],
    postedAtSource: new Date(Date.now() - 12 * 86400000).toISOString(),
    source: 'aggregated',
    url: 'https://example.com/jobs/staff-data-engineer',
  },
];

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function toArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function profileToStructuredCandidate(input) {
  const profile = input && typeof input === 'object' ? input : {};
  const rolesFromExperience = toArray((profile.experience || []).map((e) => e?.title).filter(Boolean));
  const roleKeywords = toArray([
    profile.currentJob?.title,
    profile.focusRole,
    profile.resumeTitle,
    ...rolesFromExperience,
  ]);
  const skills = toArray([
    ...(Array.isArray(profile.skills) ? profile.skills : []),
    ...(Array.isArray(profile.keywords) ? profile.keywords : []),
  ]);
  const years = Number(profile.yearsExperience);
  return {
    skills,
    roleKeywords,
    yearsExperience: Number.isFinite(years) ? Math.max(0, years) : null,
    preferredDomains: toArray(profile.domainTags || profile.industries || []),
    locationPreference: normalizeText(profile.locationPreference || profile.country || profile.address?.country),
    wantsRemote: profile.wantsRemote === true || normalizeText(profile.remotePreference) === 'remote',
    needsVisaSponsorship: profile.needsVisaSponsorship === true,
  };
}

function overlapRatio(haystack, needles) {
  const h = new Set(toArray(haystack));
  const n = toArray(needles);
  if (n.length === 0) return 1;
  const hit = n.filter((item) => h.has(item)).length;
  return hit / n.length;
}

function seniorityScore(job, candidate) {
  const title = normalizeText(job.title);
  const years = candidate.yearsExperience;
  if (years === null) return 50;
  if (title.includes('staff') || title.includes('principal')) return years >= 8 ? 100 : 35;
  if (title.includes('senior')) return years >= 5 ? 100 : years >= 3 ? 70 : 40;
  if (title.includes('manager') || title.includes('lead')) return years >= 6 ? 100 : 60;
  if (title.includes('associate') || title.includes('junior')) return years <= 3 ? 90 : 70;
  return 75;
}

function roleSimilarityScore(job, candidate) {
  const jobTokens = toArray([job.title, ...(job.domainTags || [])]).join(' ');
  if (!jobTokens) return 50;
  const hits = candidate.roleKeywords.filter((k) => jobTokens.includes(k)).length;
  if (!candidate.roleKeywords.length) return 45;
  return Math.min(100, Math.round((hits / candidate.roleKeywords.length) * 130));
}

function computeJobMatch(job, candidate) {
  const requiredScore = Math.round(overlapRatio(candidate.skills, job.requiredSkills) * 100);
  const preferredScore = Math.round(overlapRatio(candidate.skills, job.preferredSkills) * 100);
  const semanticScore = roleSimilarityScore(job, candidate);
  const experienceScore =
    candidate.yearsExperience === null
      ? 55
      : candidate.yearsExperience >= Number(job.experienceMinYears || 0)
      ? 95
      : Math.max(25, 95 - (Number(job.experienceMinYears || 0) - candidate.yearsExperience) * 14);
  const seniorityFit = seniorityScore(job, candidate);
  const domainScore = Math.round(overlapRatio(candidate.preferredDomains, job.domainTags) * 100);
  const transferableScore = Math.round((semanticScore * 0.7 + preferredScore * 0.3));

  const missingCriticalRequirements = (job.requiredSkills || []).filter(
    (skill) => !candidate.skills.includes(normalizeText(skill))
  );
  const criticalGapPenalty = Math.min(24, missingCriticalRequirements.length * 6);

  const weighted =
    requiredScore * 0.3 +
    preferredScore * 0.15 +
    semanticScore * 0.2 +
    experienceScore * 0.15 +
    seniorityFit * 0.1 +
    domainScore * 0.1 +
    transferableScore * 0.05 -
    criticalGapPenalty;
  const finalScore = Math.max(0, Math.min(100, Math.round(weighted)));

  let category = JOB_MATCH_CATEGORIES.LOW;
  if (finalScore >= 78 && missingCriticalRequirements.length <= 1) category = JOB_MATCH_CATEGORIES.STRONG;
  else if (finalScore >= 62) category = JOB_MATCH_CATEGORIES.GOOD;
  else if (finalScore >= 45) category = JOB_MATCH_CATEGORIES.STRETCH;

  const reasons = [];
  if (requiredScore >= 70) reasons.push('Strong overlap with required skills');
  if (experienceScore >= 85) reasons.push('Experience aligns with role expectations');
  if (domainScore >= 60) reasons.push('Relevant domain background');
  if (missingCriticalRequirements.length) {
    reasons.push(`Missing critical requirements: ${missingCriticalRequirements.slice(0, 3).join(', ')}`);
  }
  if (!reasons.length) reasons.push('Potential fit based on transferable experience');

  return {
    category,
    finalScore,
    subScores: {
      requiredSkill: requiredScore,
      preferredSkill: preferredScore,
      semanticSimilarity: semanticScore,
      experienceAlignment: Math.round(experienceScore),
      seniorityFit,
      domainRelevance: domainScore,
      transferableExperience: transferableScore,
      criticalGapPenalty,
    },
    reasons,
    missingCriticalRequirements,
  };
}

function getUserIntelState(userId) {
  if (!inMemoryJobIntelState.has(userId)) {
    inMemoryJobIntelState.set(userId, { applications: [] });
  }
  return inMemoryJobIntelState.get(userId);
}

function isMissingTableError(error) {
  const msg = String(error?.message || '').toLowerCase();
  return msg.includes('relation') && msg.includes('does not exist');
}

function normalizeJobRecord(job) {
  const metadata = job?.metadata && typeof job.metadata === 'object' ? job.metadata : {};
  return {
    id: String(job.id || ''),
    title: String(job.title || ''),
    company: String(job.company || ''),
    location: String(job.location || ''),
    remoteType: String(job.remote_type || metadata.remoteType || 'onsite'),
    salaryMin: Number(job.salary_min || metadata.salaryMin || 0) || 0,
    salaryMax: Number(job.salary_max || metadata.salaryMax || 0) || 0,
    currency: String(job.currency || metadata.currency || ''),
    visaSponsorship: Boolean(job.visa_sponsorship || metadata.visaSponsorship),
    seniority: String(job.seniority || metadata.seniority || ''),
    experienceMinYears: Number(job.experience_min_years || metadata.experienceMinYears || 0) || 0,
    domainTags: toArray(job.domain_tags || metadata.domainTags || []),
    requiredSkills: toArray(job.required_skills || metadata.requiredSkills || []),
    preferredSkills: toArray(job.preferred_skills || metadata.preferredSkills || []),
    postedAtSource: String(job.posted_at_source || job.created_at || new Date().toISOString()),
    source: String(job.source || metadata.source || 'aggregated'),
    url: String(job.url || metadata.url || ''),
  };
}

async function loadCandidateJobsFromSupabase({ lookbackDays }) {
  const freshnessCutoffIso = new Date(Date.now() - lookbackDays * 86400000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('job_openings')
    .select('*')
    .gte('posted_at_source', freshnessCutoffIso)
    .order('posted_at_source', { ascending: false })
    .limit(1000);

  if (error) throw error;
  return (Array.isArray(data) ? data : []).map(normalizeJobRecord).filter((job) => job.id && job.title);
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
// POST /api/job-intelligence/match-feed — ranked opportunities per resume/profile
// ------------------------------------------------------------------
app.post('/api/job-intelligence/match-feed', requireAuth, async (req, res) => {
  try {
    const lookbackDaysRaw = Number(req.body?.lookbackDays);
    const lookbackDays = Number.isFinite(lookbackDaysRaw) && lookbackDaysRaw > 0
      ? Math.min(30, lookbackDaysRaw)
      : DEFAULT_JOB_INTELLIGENCE_LOOKBACK_DAYS;
    const profileName = String(req.body?.profileName || 'Primary Resume').trim();
    const filters = req.body?.filters && typeof req.body.filters === 'object' ? req.body.filters : {};
    const candidate = profileToStructuredCandidate(req.body?.candidateProfile || {});

    const freshnessCutoff = Date.now() - lookbackDays * 86400000;
    let baseJobs = [];
    let source = 'sample-fallback';
    try {
      const supabaseJobs = await loadCandidateJobsFromSupabase({ lookbackDays });
      if (supabaseJobs.length > 0) {
        baseJobs = supabaseJobs;
        source = 'supabase';
      }
    } catch (jobLoadErr) {
      if (!isMissingTableError(jobLoadErr)) {
        console.warn('match-feed load jobs fallback:', formatSupabaseError(jobLoadErr));
      }
    }
    if (baseJobs.length === 0) {
      baseJobs = SAMPLE_JOB_SOURCE.filter((job) => {
        const postedAt = new Date(job.postedAtSource).getTime();
        return Number.isFinite(postedAt) && postedAt >= freshnessCutoff;
      });
    }

    const filtered = baseJobs.filter((job) => {
      if (filters.remoteOnly && job.remoteType !== 'remote') return false;
      if (filters.visaRequired && !job.visaSponsorship) return false;
      if (filters.location && !normalizeText(job.location).includes(normalizeText(filters.location))) return false;
      if (filters.seniority && normalizeText(job.seniority) !== normalizeText(filters.seniority)) return false;
      return true;
    });

    const ranked = filtered
      .map((job) => {
        const match = computeJobMatch(job, candidate);
        return {
          ...job,
          ...match,
          postedDaysAgo: Math.max(0, Math.floor((Date.now() - new Date(job.postedAtSource).getTime()) / 86400000)),
        };
      })
      .sort((a, b) => {
        const categoryRank = {
          [JOB_MATCH_CATEGORIES.STRONG]: 4,
          [JOB_MATCH_CATEGORIES.GOOD]: 3,
          [JOB_MATCH_CATEGORIES.STRETCH]: 2,
          [JOB_MATCH_CATEGORIES.LOW]: 1,
        };
        const byCategory = categoryRank[b.category] - categoryRank[a.category];
        if (byCategory !== 0) return byCategory;
        if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
        return new Date(b.postedAtSource).getTime() - new Date(a.postedAtSource).getTime();
      });

    const feed = ranked.filter((job) => job.category !== JOB_MATCH_CATEGORIES.LOW);
    try {
      const scoreRows = ranked.map((job) => ({
        user_id: req.userId,
        profile_name: profileName,
        job_id: String(job.id),
        final_score: job.finalScore,
        match_category: job.category,
        score_breakdown: job.subScores || {},
        reasons: Array.isArray(job.reasons) ? job.reasons : [],
      }));
      if (scoreRows.length > 0) {
        const { error: scoreError } = await supabaseAdmin
          .from('job_match_scores')
          .upsert(scoreRows, { onConflict: 'user_id,profile_name,job_id' });
        if (scoreError && !isMissingTableError(scoreError)) {
          console.warn('match-feed score persistence warning:', formatSupabaseError(scoreError));
        }
      }
    } catch (scorePersistErr) {
      if (!isMissingTableError(scorePersistErr)) {
        console.warn('match-feed score persistence fallback:', formatSupabaseError(scorePersistErr));
      }
    }
    return res.json({
      profileName,
      lookbackDays,
      source,
      generatedAt: new Date().toISOString(),
      totalConsidered: filtered.length,
      jobs: feed,
      hiddenLowMatchCount: ranked.length - feed.length,
    });
  } catch (error) {
    console.error('POST /api/job-intelligence/match-feed error:', error?.message || error);
    return res.status(500).json({ error: error?.message || 'Failed to generate match feed' });
  }
});

// ------------------------------------------------------------------
// GET /api/job-intelligence/applications — tracked job applications
// ------------------------------------------------------------------
app.get('/api/job-intelligence/applications', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('job_applications')
      .select('*')
      .eq('user_id', req.userId)
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return res.json({ source: 'supabase', applications: data || [] });
  } catch (error) {
    if (!isMissingTableError(error)) {
      console.warn('GET /api/job-intelligence/applications fallback:', formatSupabaseError(error));
    }
    const state = getUserIntelState(req.userId);
    return res.json({ source: 'memory-fallback', applications: state.applications || [] });
  }
});

// ------------------------------------------------------------------
// POST /api/job-intelligence/applications — upsert application status
// ------------------------------------------------------------------
app.post('/api/job-intelligence/applications', requireAuth, async (req, res) => {
  try {
    const jobId = String(req.body?.jobId || '').trim();
    const status = String(req.body?.status || 'saved').trim();
    const profileName = String(req.body?.profileName || 'Primary Resume').trim();
    const company = String(req.body?.company || '').trim();
    const title = String(req.body?.title || '').trim();
    const url = String(req.body?.url || '').trim();

    if (!jobId) return res.status(400).json({ error: 'Missing jobId' });

    const payload = {
      user_id: req.userId,
      job_id: jobId,
      status,
      profile_name: profileName || null,
      company: company || null,
      title: title || null,
      url: url || null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from('job_applications')
      .upsert(payload, { onConflict: 'user_id,job_id' })
      .select()
      .single();

    if (error) throw error;
    return res.json({ source: 'supabase', application: data });
  } catch (error) {
    if (!isMissingTableError(error)) {
      console.warn('POST /api/job-intelligence/applications fallback:', formatSupabaseError(error));
    }
    const state = getUserIntelState(req.userId);
    const jobId = String(req.body?.jobId || '').trim();
    const record = {
      user_id: req.userId,
      job_id: jobId,
      status: String(req.body?.status || 'saved').trim(),
      profile_name: String(req.body?.profileName || 'Primary Resume').trim(),
      company: String(req.body?.company || '').trim(),
      title: String(req.body?.title || '').trim(),
      url: String(req.body?.url || '').trim(),
      updated_at: new Date().toISOString(),
    };
    state.applications = (state.applications || []).filter((a) => a.job_id !== jobId);
    state.applications.unshift(record);
    return res.json({ source: 'memory-fallback', application: record });
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

    if (!dodo.checkoutSessions?.create) {
      return res.status(500).json({
        error: 'Payment service misconfigured. Please update the server SDK.',
      });
    }

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
