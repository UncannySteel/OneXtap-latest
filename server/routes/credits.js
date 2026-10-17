/**
 * The credit balance: GET /api/credits and POST /api/credits/deduct.
 */
import express from 'express';
import { getProfile, requireAuth } from '../supabase.js';
import { log } from '../logger.js';
import { apiErrorMessage } from '../lib/errors.js';

const router = express.Router();
const creditsLog = log.child('credits');

// ------------------------------------------------------------------
// GET /api/credits — get current credit balance
// ------------------------------------------------------------------
router.get('/api/credits', requireAuth, async (req, res) => {
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
// POST /api/credits/deduct — a no-op, for old clients
// ------------------------------------------------------------------
// Generations are paid for where they happen now: POST
// /api/answer-vault/generate and POST /api/jobs/explain spend before the
// model call, atomically (server/lib/credits.js).
// Nothing current calls this. Clients from before that change (the published
// popup, a cached Answer Studio page) still call it after a generation the
// server has already charged, so it answers as it always did, success and the
// balance, and charges nothing. Charging here as well would charge them twice.
//
// `remaining` is null on Premium, which is what the old `Infinity` became in
// JSON; old clients read `isPremium` first.
router.post('/api/credits/deduct', requireAuth, async (req, res) => {
  try {
    const profile = await getProfile(req.userId, req.userEmail);
    const isPremium = !!profile.is_premium;
    creditsLog.info('POST /api/credits/deduct from an old client: answered with the balance, nothing charged');
    res.json({
      success: true,
      remaining: isPremium ? null : profile.credits,
      isPremium,
      charged: false,
    });
  } catch (error) {
    log.error('POST /api/credits/deduct error:', apiErrorMessage(error));
    res.status(500).json({ success: false, error: apiErrorMessage(error) });
  }
});

// ------------------------------------------------------------------
// There is deliberately NO public refund route.
// ------------------------------------------------------------------
// POST /api/credits/refund used to sit here: one credit back, for any
// signed-in account, with no check that anything had been charged. Called in
// a loop it minted unlimited credits, which is Premium for free, and nothing
// in the product ever called it. Removed on 2026-10-03.
//
// Refunds happen inside the server, on the route that charged: see
// undoGeneration() and refundOneCredit() in server/lib/credits.js, which
// POST /api/answer-vault/generate and /api/jobs/explain call when a paid
// generation fails, and which give back only a charge that happened, once. A
// route that gives credits back must be able to prove what it is giving back.
// test/server/routes.test.js keeps this one from returning.

export default router;
