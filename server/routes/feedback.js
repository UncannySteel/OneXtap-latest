/**
 * The landing page's feedback form: POST /api/feedback, emailed via Resend.
 */
import express from 'express';
import { Resend } from 'resend';
import { log } from '../logger.js';
import { apiErrorMessage } from '../lib/errors.js';

const router = express.Router();

// ------------------------------------------------------------------
// POST /api/feedback — public feedback form on the signed-out landing page.
// No auth (there is no user yet at that point) and nothing is persisted —
// feedback is not "content" this app otherwise stores; it is emailed via
// Resend straight to FEEDBACK_TO_EMAIL. UNSET RESEND_API_KEY = the route
// answers 500 rather than silently pretending to send.
// ------------------------------------------------------------------
const FEEDBACK_CATEGORY_LABELS = {
  idea: 'An idea',
  bug: 'Something broke',
  'job-board': 'A job board',
  other: 'Something else',
};
const FEEDBACK_MESSAGE_MAX = 2000;
const FEEDBACK_TO_EMAIL = process.env.FEEDBACK_TO_EMAIL || 'mazzah70@gmail.com';
const FEEDBACK_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Onextap Feedback <onboarding@resend.dev>';

// Best-effort per-IP throttle against one warm process. It holds nothing
// across Vercel's stateless invocations, so it is real protection only for
// `server:dev` — a deliberately small guard, not the production defense.
const feedbackHitsByIp = new Map();
const FEEDBACK_RATE_WINDOW_MS = 10 * 60 * 1000;
const FEEDBACK_RATE_MAX = 5;

function isFeedbackRateLimited(ip) {
  const now = Date.now();
  const hits = (feedbackHitsByIp.get(ip) || []).filter((t) => now - t < FEEDBACK_RATE_WINDOW_MS);
  hits.push(now);
  feedbackHitsByIp.set(ip, hits);
  return hits.length > FEEDBACK_RATE_MAX;
}

router.post('/api/feedback', async (req, res) => {
  try {
    if (isFeedbackRateLimited(req.ip)) {
      return res.status(429).json({ error: 'Too many submissions — try again later.' });
    }

    const { category, message, email } = req.body || {};
    const trimmedMessage = typeof message === 'string' ? message.trim() : '';
    if (!trimmedMessage) {
      return res.status(400).json({ error: 'Message is required.' });
    }
    if (trimmedMessage.length > FEEDBACK_MESSAGE_MAX) {
      return res.status(400).json({ error: 'Message is too long.' });
    }
    const trimmedEmail = typeof email === 'string' ? email.trim().slice(0, 320) : '';

    if (!process.env.RESEND_API_KEY) {
      log.error('[Feedback] RESEND_API_KEY is not set — cannot send');
      return res.status(500).json({ error: 'Feedback is not configured.' });
    }

    const categoryLabel = FEEDBACK_CATEGORY_LABELS[category] || 'Feedback';
    const bodyLines = [trimmedMessage];
    if (trimmedEmail) bodyLines.push('', `Reply to: ${trimmedEmail}`);

    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error: sendError } = await resend.emails.send({
      from: FEEDBACK_FROM_EMAIL,
      to: FEEDBACK_TO_EMAIL,
      subject: `Onextap feedback: ${categoryLabel}`,
      text: bodyLines.join('\n'),
      ...(trimmedEmail ? { replyTo: trimmedEmail } : {}),
    });

    if (sendError) {
      log.error('[Feedback] Resend send failed:', sendError?.message || sendError);
      return res.status(502).json({ error: 'Could not send feedback.' });
    }

    res.json({ ok: true });
  } catch (error) {
    log.error('POST /api/feedback error:', apiErrorMessage(error));
    res.status(500).json({ error: apiErrorMessage(error) });
  }
});

export default router;
