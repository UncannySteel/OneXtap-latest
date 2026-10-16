/**
 * Premium through Dodo: verify, checkout, cancel, resume and the billing
 * portal.
 */
import express from 'express';
import { getProfile, updateProfile, requireAuth } from '../supabase.js';
import { log } from '../logger.js';
import { apiErrorMessage } from '../lib/errors.js';
import { dodo, createDodoCheckoutSession } from '../lib/dodo.js';

const router = express.Router();

/**
 * The dashboard's address, for the links the server hands out (the Dodo
 * checkout's return URL).
 *
 * CLIENT_URL keeps its meaning — the site's origin, where the landing page
 * lives — and the dashboard is the /dashboard/ page on it (see
 * vite.dashboard.config.js). A CLIENT_URL that already ends in /dashboard is
 * taken as it is.
 *
 * @returns {string} e.g. https://www.onextap.com/dashboard/
 */
function dashboardUrl() {
  const site = String(process.env.CLIENT_URL || 'https://www.onextap.com').replace(/\/+$/, '');
  return site.endsWith('/dashboard') ? `${site}/` : `${site}/dashboard/`;
}

// ------------------------------------------------------------------
// GET /api/verify-premium — verify premium status (authenticated)
// ------------------------------------------------------------------
router.get('/api/verify-premium', requireAuth, async (req, res) => {
  try {
    const profile = await getProfile(req.userId, req.userEmail);

    if (!profile.is_premium) {
      return res.json({ isPremium: false });
    }

    // Billing dates, when Dodo can be asked. The dashboard's subscription
    // panel shows "renews on …", or "ends on …" once a cancellation is
    // scheduled (POST /api/cancel-subscription cancels at the period's end).
    // Omitted rather than guessed when Dodo is unreachable.
    let billing = {};
    if (profile.dodo_subscription_id) {
      try {
        const sub = await dodo.subscriptions.retrieve(profile.dodo_subscription_id);
        const isActive = ['active', 'trialing'].includes(sub.status);
        if (!isActive) {
          await updateProfile(req.userId, {
            is_premium: false,
            subscription_status: sub.status,
          });
          return res.json({ isPremium: false, reason: 'subscription_inactive' });
        }
        billing = {
          nextBillingDate: sub.next_billing_date || null,
          cancelAtPeriodEnd: sub.cancel_at_next_billing_date === true,
        };
      } catch {
        // If Dodo is unreachable, trust local data (graceful degradation)
      }
    }

    res.json({
      isPremium: true,
      premiumSince: profile.premium_since,
      subscriptionStatus: profile.subscription_status || 'active',
      ...billing,
    });
  } catch (error) {
    log.error('Verify premium error:', apiErrorMessage(error));
    res.status(500).json({ error: apiErrorMessage(error) });
  }
});

// ------------------------------------------------------------------
// POST /api/create-checkout-session — Dodo Payments Checkout (authenticated)
// ------------------------------------------------------------------
router.post('/api/create-checkout-session', requireAuth, async (req, res) => {
  try {
    const profile = await getProfile(req.userId, req.userEmail);

    if (profile.is_premium && profile.dodo_subscription_id) {
      try {
        const sub = await dodo.subscriptions.retrieve(profile.dodo_subscription_id);
        if (['active', 'trialing'].includes(sub.status)) {
          return res.status(400).json({ error: 'You already have an active Premium subscription.' });
        }
      } catch { /* subscription not found — continue */ }
    }

    const session = await createDodoCheckoutSession({
      product_cart: [{ product_id: process.env.DODO_PRODUCT_ID, quantity: 1 }],
      customer: {
        email: profile.email || req.userEmail || undefined,
        name: profile.display_name || undefined,
      },
      return_url: `${dashboardUrl()}?payment=success`,
      metadata: {
        supabaseUserId: req.userId,
      },
    });

    res.json({ url: session.checkout_url, sessionId: session.session_id });
  } catch (error) {
    log.error('Checkout session error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------------------------
// POST /api/cancel-subscription — Cancel subscription (authenticated)
// ------------------------------------------------------------------
//
// ═══ AT THE END OF THE PERIOD, NOT NOW ═══
//
// Premium stays on until the end of the period the user has already paid
// for. Dodo is told to cancel at the next billing date instead of renewing;
// on that date it sends `subscription.cancelled`, and the webhook turns
// is_premium off then. Until it does, nothing changes locally — the flag,
// credits and the subscription id all stay as they are, so
// POST /api/resume-subscription can undo it.
//
// A subscription that is not in good standing (on hold after a failed
// payment, pending, past due) has no paid-up period to run out, so that one
// is cancelled on the spot, as every cancellation used to be.
router.post('/api/cancel-subscription', requireAuth, async (req, res) => {
  try {
    const profile = await getProfile(req.userId, req.userEmail);

    if (!profile.dodo_subscription_id) {
      return res.status(400).json({ error: 'No active subscription found for this account.' });
    }

    const current = await dodo.subscriptions.retrieve(profile.dodo_subscription_id);

    if (['active', 'trialing'].includes(current.status)) {
      const sub = await dodo.subscriptions.update(profile.dodo_subscription_id, {
        cancel_at_next_billing_date: true,
      });
      const endsAt = sub?.next_billing_date || current.next_billing_date || null;
      log.info(`[Dodo] Cancellation scheduled for the end of the period, user: ${req.userId}`);
      return res.json({ success: true, cancelAtPeriodEnd: true, endsAt });
    }

    await dodo.subscriptions.update(profile.dodo_subscription_id, {
      status: 'cancelled',
    });

    await updateProfile(req.userId, {
      is_premium: false,
      subscription_status: 'cancelled',
      cancelled_at: new Date().toISOString(),
    });

    log.info(`[Dodo] Subscription cancelled immediately (status was ${current.status}) for user: ${req.userId}`);
    res.json({ success: true, cancelAtPeriodEnd: false, endsAt: null });
  } catch (error) {
    log.error('Cancel subscription error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------------------------
// POST /api/resume-subscription — Undo a scheduled cancellation (authenticated)
// ------------------------------------------------------------------
// The other half of cancelling at the period's end: until that date the
// subscription is still active at Dodo, so keeping it is one update. After
// it, the subscription has ended and the way back is a new checkout.
router.post('/api/resume-subscription', requireAuth, async (req, res) => {
  try {
    const profile = await getProfile(req.userId, req.userEmail);

    if (!profile.dodo_subscription_id) {
      return res.status(400).json({ error: 'No subscription found for this account.' });
    }

    const current = await dodo.subscriptions.retrieve(profile.dodo_subscription_id);
    if (!['active', 'trialing'].includes(current.status)) {
      return res.status(400).json({ error: 'This subscription has already ended. Upgrade again to start a new one.' });
    }

    const sub = await dodo.subscriptions.update(profile.dodo_subscription_id, {
      cancel_at_next_billing_date: false,
    });

    log.info(`[Dodo] Scheduled cancellation withdrawn for user: ${req.userId}`);
    res.json({
      success: true,
      cancelAtPeriodEnd: false,
      nextBillingDate: sub?.next_billing_date || current.next_billing_date || null,
    });
  } catch (error) {
    log.error('Resume subscription error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------------------------
// POST /api/create-portal-session — Dodo's hosted billing portal (authenticated)
// ------------------------------------------------------------------
// Invoices, the card on file, billing details — all Dodo's own pages. We
// hand out a short-lived link to them and store nothing. The customer id
// arrives with the first `subscription.active` webhook, so an account that
// has never paid has no portal to open.
router.post('/api/create-portal-session', requireAuth, async (req, res) => {
  try {
    const profile = await getProfile(req.userId, req.userEmail);

    if (!profile.dodo_customer_id) {
      return res.status(400).json({ error: 'There is no billing history for this account yet.' });
    }

    const session = await dodo.customers.customerPortal.create(profile.dodo_customer_id, {
      send_email: false,
    });

    res.json({ url: session.link });
  } catch (error) {
    log.error('Customer portal error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
