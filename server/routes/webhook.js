/**
 * The Dodo Payments webhook handler.
 *
 * Exported as a plain handler, not a router: server/app.js registers it with
 * express.raw() directly on the app, ahead of every JSON parser (CLAUDE.md
 * rule 4; test/rules/rule4-webhook-raw-body.test.js checks the app's stack).
 */
import { supabaseAdmin, updateProfile, formatSupabaseError } from '../supabase.js';
import { log } from '../logger.js';
import { isForeignSubscription, activationDecision } from '../subscriptionGuard.js';
import { dodo } from '../lib/dodo.js';

// ==================================================================
// DODO PAYMENTS WEBHOOK (unauthenticated — verified via signature)
// ==================================================================

/**
 * Log a webhook's failed profile update.
 *
 * A webhook can outlive its account: DELETE /api/account cancels the
 * subscription first, and Dodo's `subscription.cancelled` lands a moment after
 * the profile is gone. Logging that as "Failed to cancel subscription" was
 * wrong twice over — the cancellation succeeded, and nothing is left to update.
 */
function logWebhookUpdateFailure(what, userId, err) {
  if (err?.code === 'PGRST116') {
    log.info(`[Dodo] ${what}: no profile for user ${userId}, account already deleted`);
    return;
  }
  log.error(`[Dodo] Failed to ${what}:`, err);
}

/**
 * The subscription id the account is linked to, or null. Reads only: unlike
 * getProfile(), it never creates a profile for a user who has none — a
 * webhook can arrive after the account was deleted.
 */
async function linkedSubscriptionId(userId) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('dodo_subscription_id')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(formatSupabaseError(error));
  return data?.dodo_subscription_id || null;
}

/**
 * True, and logged, when the event is about a subscription other than the
 * account's own (server/subscriptionGuard.js). When the account cannot be
 * read, false: the event is handled as it was before this check existed.
 */
async function isAboutAnotherSubscription(type, userId, data) {
  let linkedId;
  try {
    linkedId = await linkedSubscriptionId(userId);
  } catch (err) {
    log.warn(`[Dodo] ${type}: could not read the linked subscription, handling as before`, { errName: err?.name });
    return false;
  }
  if (!isForeignSubscription(linkedId, data?.subscription_id)) return false;
  log.info(`[Dodo] ${type} ignored: ${data.subscription_id} is not the subscription user ${userId} is linked to (${linkedId})`);
  return true;
}

/**
 * For `subscription.active`: if the account already has a different
 * subscription in force, cancel this new one at Dodo and return true. Its
 * first payment is refunded by hand in Dodo's dashboard — the warning names
 * both subscriptions. Any doubt (Dodo or the profile cannot be read) returns
 * false, and the new subscription is linked as it always was.
 */
async function cancelIfDuplicate(userId, newId) {
  let linkedId;
  let linkedStatus = null;
  try {
    linkedId = await linkedSubscriptionId(userId);
    if (linkedId && linkedId !== newId) {
      linkedStatus = (await dodo.subscriptions.retrieve(linkedId)).status;
    }
  } catch (err) {
    log.warn('[Dodo] subscription.active: could not check for a duplicate, linking the new subscription', { errName: err?.name });
    return false;
  }
  if (activationDecision({ linkedId, linkedStatus, newId }) !== 'duplicate') return false;

  try {
    await dodo.subscriptions.update(newId, { status: 'cancelled' });
  } catch (err) {
    log.error(`[Dodo] Second subscription ${newId} for user ${userId} (already on ${linkedId}) could not be cancelled; cancel and refund it in Dodo:`, err);
    return true;
  }
  log.warn(`[Dodo] Second subscription ${newId} for user ${userId} cancelled (already on ${linkedId}); refund its payment in Dodo`);
  return true;
}

export async function handleWebhook(req, res) {
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
    log.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const data = event.data;

  switch (event.type) {
    // --- Subscription activated — activate premium ---
    case 'subscription.active': {
      const userId = await resolveUserId(data);
      if (userId) {
        if (await cancelIfDuplicate(userId, data.subscription_id)) break;
        try {
          await updateProfile(userId, {
            is_premium: true,
            dodo_subscription_id: data.subscription_id,
            dodo_customer_id: data.customer?.customer_id || null,
            subscription_status: 'active',
            premium_since: new Date().toISOString(),
          });
          log.info(`[Dodo] Premium activated for user: ${userId}`);
        } catch (err) {
          logWebhookUpdateFailure('activate premium', userId, err);
        }
      }
      break;
    }

    // --- Subscription renewed ---
    case 'subscription.renewed': {
      const userId = await resolveUserId(data);
      if (userId) {
        if (await isAboutAnotherSubscription(event.type, userId, data)) break;
        try {
          await updateProfile(userId, {
            is_premium: true,
            subscription_status: 'active',
          });
          log.info(`[Dodo] Subscription renewed for user: ${userId}`);
        } catch (err) {
          logWebhookUpdateFailure('update renewal', userId, err);
        }
      }
      break;
    }

    // --- Subscription on hold (payment issue) ---
    case 'subscription.on_hold': {
      const userId = await resolveUserId(data);
      if (userId) {
        if (await isAboutAnotherSubscription(event.type, userId, data)) break;
        try {
          await updateProfile(userId, {
            subscription_status: 'on_hold',
            payment_failed: true,
            last_failed_payment: new Date().toISOString(),
          });
          log.info(`[Dodo] Subscription on hold for user: ${userId}`);
        } catch (err) {
          logWebhookUpdateFailure('update on_hold', userId, err);
        }
      }
      break;
    }

    // --- Subscription cancelled ---
    case 'subscription.cancelled': {
      const userId = await resolveUserId(data);
      if (userId) {
        if (await isAboutAnotherSubscription(event.type, userId, data)) break;
        try {
          await updateProfile(userId, {
            is_premium: false,
            subscription_status: 'cancelled',
            cancelled_at: new Date().toISOString(),
          });
          log.info(`[Dodo] Subscription cancelled for user: ${userId}`);
        } catch (err) {
          logWebhookUpdateFailure('record the cancellation', userId, err);
        }
      }
      break;
    }

    // --- Subscription failed (mandate creation failed) ---
    case 'subscription.failed': {
      const userId = await resolveUserId(data);
      if (userId) {
        if (await isAboutAnotherSubscription(event.type, userId, data)) break;
        try {
          await updateProfile(userId, {
            is_premium: false,
            subscription_status: 'failed',
          });
          log.info(`[Dodo] Subscription failed for user: ${userId}`);
        } catch (err) {
          logWebhookUpdateFailure('update failure', userId, err);
        }
      }
      break;
    }

    // --- Payment failed ---
    case 'payment.failed': {
      const userId = await resolveUserId(data);
      if (userId) {
        if (await isAboutAnotherSubscription(event.type, userId, data)) break;
        try {
          await updateProfile(userId, {
            payment_failed: true,
            last_failed_payment: new Date().toISOString(),
          });
          log.info(`[Dodo] Payment failed for user: ${userId}`);
        } catch (err) {
          logWebhookUpdateFailure('process payment failure', userId, err);
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
      log.error(
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
      log.error(
        '[Dodo] resolveUserId email lookup failed:',
        formatSupabaseError(byEmailErr)
      );
    } else if (profiles?.length) {
      return profiles[0].id;
    }
  }

  log.warn('[Dodo] Could not resolve user for webhook:', JSON.stringify(data).slice(0, 200));
  return null;
}
