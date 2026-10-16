/**
 * The credit balance: GET /api/credits and POST /api/credits/deduct.
 */
import express from 'express';
import {
  supabaseAdmin,
  getProfile,
  updateProfile,
  requireAuth,
  formatSupabaseError,
} from '../supabase.js';
import { log } from '../logger.js';
import { apiErrorMessage } from '../lib/errors.js';

const router = express.Router();

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
// POST /api/credits/deduct — deduct 1 credit (server-verified)
// ------------------------------------------------------------------
router.post('/api/credits/deduct', requireAuth, async (req, res) => {
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
// There is deliberately NO public refund route.
// ------------------------------------------------------------------
// POST /api/credits/refund used to sit here: one credit back, for any
// signed-in account, with no check that anything had been charged. Called in
// a loop it minted unlimited credits, which is Premium for free, and nothing
// in the product ever called it. Removed on 2026-10-03.
//
// Refunds happen inside the server, on the route that charged: see
// refundOneCredit(), which /api/jobs/explain calls when a paid explanation
// fails. A route that gives credits back must be able to prove what it is
// giving back. test/server/routes.test.js keeps this one from returning.

export default router;
