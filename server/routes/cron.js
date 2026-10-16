/**
 * Scheduled work: the job ingest, GET and POST /api/jobs/ingest.
 */
import express from 'express';
import { log } from '../logger.js';
import { requireCronSecret } from '../cronAuth.js';
import { runIngest } from '../jobs/ingest.js';
import { apiErrorMessage } from '../lib/errors.js';

const router = express.Router();

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

router.get('/api/jobs/ingest', requireCronSecret, handleJobIngest);
router.post('/api/jobs/ingest', requireCronSecret, handleJobIngest);

export default router;
