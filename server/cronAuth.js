/**
 * Shared-secret guard for cron-triggered routes.
 *
 * The ingest route is unauthenticated in the Supabase-JWT sense — no user is
 * signed in when Vercel Cron fires it — so this is the only thing standing
 * between a scheduled job and the open internet. A caller who can hit it can
 * burn the whole Adzuna quota on demand.
 *
 * FAIL CLOSED. With CRON_SECRET unset the route answers 503, never 200. The
 * tempting alternative — "no secret configured, so allow it" — turns a
 * forgotten environment variable in production into a public endpoint, and
 * nothing about the deploy looks wrong.
 */
import { timingSafeEqual } from 'node:crypto';
import { log } from './logger.js';

const cronLog = log.child('cron');

/**
 * Constant-time string compare.
 *
 * timingSafeEqual THROWS on buffers of unequal length, so the length check has
 * to come first. That check is itself a (tiny) timing leak of the secret's
 * length, which is an accepted trade: the alternative is an unhandled
 * exception turning every wrong-length guess into a 500.
 *
 * @param {unknown} a Presented value; anything but a string is a no.
 * @param {unknown} b The configured secret.
 * @returns {boolean} True only on an exact match.
 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Express middleware. Accepts either:
 *   Authorization: Bearer <CRON_SECRET>   — what Vercel Cron injects
 *                                           automatically when CRON_SECRET is
 *                                           a project environment variable
 *   X-Cron-Secret: <CRON_SECRET>          — for curl / manual runs, where an
 *                                           Authorization header collides with
 *                                           the Supabase JWT habit
 *
 * Never logs the presented value: a rejected guess still belongs to somebody,
 * and a near-miss in a log drain is a gift to whoever reads it.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next Called only on an exact match.
 * @returns {void} Responds 503 when CRON_SECRET is unset, 401 when the
 *   credential is missing or wrong, and otherwise calls next().
 */
export function requireCronSecret(req, res, next) {
  // Read at call time, not module load. Tests mutate process.env between
  // cases, and Vercel can surface env vars after the module graph is built.
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    cronLog.error('cron request rejected', { reason: 'secret_not_configured', path: req.path });
    return res.status(503).json({ error: 'Cron secret not configured' });
  }

  const authHeader = req.headers?.authorization;
  const bearer = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  const headerSecret = req.headers?.['x-cron-secret'];
  const presented = typeof headerSecret === 'string' ? headerSecret : null;

  if (!bearer && !presented) {
    cronLog.warn('cron request rejected', { reason: 'no_credential', path: req.path });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (safeEqual(bearer, secret) || safeEqual(presented, secret)) {
    return next();
  }

  cronLog.warn('cron request rejected', { reason: 'bad_secret', path: req.path });
  return res.status(401).json({ error: 'Unauthorized' });
}

export default requireCronSecret;
