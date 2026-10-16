/**
 * The Express app: middleware in order, then the routers from server/routes/.
 *
 * Imported by server/index.js, after ./load-env.js. The ORDER of the app.use()
 * calls below is load-bearing; the routes themselves live in server/routes/.
 */
import express from 'express';
import cors from 'cors';
import { requestLogger, errorLogger, installProcessHandlers } from './logger.js';
import { handleWebhook } from './routes/webhook.js';
import accountRouter from './routes/account.js';
import creditsRouter from './routes/credits.js';
import billingRouter from './routes/billing.js';
import generateRouter from './routes/generate.js';
import resumeRouter from './routes/resume.js';
import cronRouter from './routes/cron.js';
import jobsRouter from './routes/jobs.js';
import jobRankRouter from './routes/jobRank.js';
import jobExplainRouter from './routes/jobExplain.js';
import feedbackRouter from './routes/feedback.js';
import healthRouter from './routes/health.js';

installProcessHandlers();

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
// their floor under an untrusted body (see the fabrication corpus caps in
// server/routes/generate.js)
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
app.use(accountRouter);
app.use(creditsRouter);
app.use(billingRouter);
app.use(generateRouter);
app.use(resumeRouter);

app.use(cronRouter);

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
app.use(jobsRouter);
app.use(jobRankRouter);
app.use(jobExplainRouter);

app.use(feedbackRouter);
app.use(healthRouter);

// ------------------------------------------------------------------
// Error handler — must stay last, after every route
// ------------------------------------------------------------------
// Catches anything thrown outside a route's own try/catch. Without it Express
// serves its default HTML stack-trace page and logs nothing.
app.use(errorLogger);

export default app;
