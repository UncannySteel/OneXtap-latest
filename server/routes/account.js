/**
 * The signed-in account: GET /api/me and DELETE /api/account.
 */
import express from 'express';
import { supabaseAdmin, getProfile, requireAuth } from '../supabase.js';
import { log } from '../logger.js';
import { subscriptionsToCancel } from '../subscriptionGuard.js';
import { apiErrorMessage } from '../lib/errors.js';
import { dodo } from '../lib/dodo.js';

const router = express.Router();

// ------------------------------------------------------------------
// GET /api/me — get authenticated user profile
// ------------------------------------------------------------------
router.get('/api/me', requireAuth, async (req, res) => {
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
    log.error('GET /api/me error:', error);
    res.status(500).json({ error: apiErrorMessage(error) });
  }
});

// ------------------------------------------------------------------
// DELETE /api/account — Delete the signed-in account (authenticated)
// ------------------------------------------------------------------
//
// ═══ BILLING FIRST, THEN THE ACCOUNT ═══
//
// A deleted account must never go on being charged, so every subscription of
// its own that can still bill (anything short of cancelled / failed /
// expired) is cancelled at Dodo first — immediately, not at the period's end,
// because there will be no account left to run it out on. "Of its own" means
// the linked one plus any other the checkout tagged with this user id: a
// second, unlinked subscription once outlived its account this way
// (server/subscriptionGuard.js). If Dodo cannot confirm all of that, nothing
// is deleted and the user is told to try again.
//
// Then the Supabase auth user goes, and everything keyed to it with it:
// `profiles` references auth.users ON DELETE CASCADE, and credit_transactions,
// rank_cache, rank_rate_limit and generation_rate_limit (migration 006) all
// cascade from `profiles`. Profile content
// (personal details, answers, cover letters, resumes) was never on the server
// (rule 8); the dashboard clears the browser's copy after this returns.
router.delete('/api/account', requireAuth, async (req, res) => {
  try {
    const profile = await getProfile(req.userId, req.userEmail);

    const subscriptions = [];
    if (profile.dodo_customer_id) {
      // Errors propagate: if Dodo cannot list them, we cannot be sure.
      for await (const sub of dodo.subscriptions.list({ customer_id: profile.dodo_customer_id, page_size: 100 })) {
        subscriptions.push(sub);
      }
    }
    if (profile.dodo_subscription_id && !subscriptions.some((s) => s.subscription_id === profile.dodo_subscription_id)) {
      try {
        subscriptions.push(await dodo.subscriptions.retrieve(profile.dodo_subscription_id));
      } catch (err) {
        // A subscription Dodo has no record of cannot bill; anything else
        // (Dodo down, bad key) means we cannot be sure, so stop here.
        if (err?.status !== 404) throw err;
      }
    }

    const toCancel = subscriptionsToCancel(subscriptions, {
      userId: req.userId,
      linkedId: profile.dodo_subscription_id,
    });
    for (const subscriptionId of toCancel) {
      await dodo.subscriptions.update(subscriptionId, { status: 'cancelled' });
    }
    if (toCancel.length) {
      log.info(`[Account] ${toCancel.length} subscription(s) cancelled ahead of deleting user: ${req.userId}`);
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(req.userId);
    if (error) throw error;

    log.info(`[Account] Deleted user: ${req.userId}`);
    res.json({ success: true });
  } catch (error) {
    log.error('Delete account error:', apiErrorMessage(error));
    res.status(500).json({ error: 'Could not delete your account. Try again in a moment, or contact us.' });
  }
});

export default router;
