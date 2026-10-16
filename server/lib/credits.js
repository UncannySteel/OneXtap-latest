/**
 * Charging and refunding one credit on the server, for routes that charge
 * for a generation (today POST /api/jobs/explain).
 */
import { supabaseAdmin, getProfile, updateProfile, formatSupabaseError } from '../supabase.js';
import { log } from '../logger.js';
import { apiErrorMessage } from './errors.js';

/**
 * Deduct one credit, mirroring POST /api/credits/deduct exactly.
 *
 * A local helper rather than a refactor of that route: the credit routes are
 * the anti-tamper surface of this product and are not worth restructuring to
 * save a few lines. Premium is free, the amount is 1, and the audit row is
 * written or the balance is rolled back — same rules, same table.
 *
 * @param {string} userId
 * @param {string} userEmail
 * @param {string} description Written to the audit row.
 * @returns {Promise<{charged: boolean, remaining: number}>} `remaining` is
 *   Infinity for a premium account, which was not charged.
 * @throws {Error} When the balance is empty or the audit write fails; the
 *   caller turns that into a 403/500 and has not yet generated anything.
 */
export async function chargeOneCredit(userId, userEmail, description) {
  const profile = await getProfile(userId, userEmail);
  if (profile.is_premium) return { charged: false, remaining: Infinity };
  if (profile.credits <= 0) {
    const err = new Error('No credits remaining');
    err.statusCode = 403;
    throw err;
  }

  const newCredits = profile.credits - 1;
  await updateProfile(userId, { credits: newCredits });

  const { error: txError } = await supabaseAdmin.from('credit_transactions').insert({
    user_id: userId,
    amount: -1,
    type: 'usage',
    description,
  });

  if (txError) {
    log.error('[API] credit_transactions insert failed after deduct:', formatSupabaseError(txError));
    try {
      await updateProfile(userId, { credits: profile.credits });
    } catch (rollbackErr) {
      log.error('[API] Failed to rollback credits after deduct audit failure:', apiErrorMessage(rollbackErr));
    }
    const err = new Error('Could not record credit usage. Your balance was restored; please try again.');
    err.statusCode = 500;
    throw err;
  }

  return { charged: true, remaining: newCredits };
}

/**
 * Give a credit back after a failure that happened AFTER the deduction.
 *
 * Never throws: this runs on an error path, and a failed refund must not
 * replace the error the user actually needs to see. It logs loudly instead —
 * a silently swallowed refund failure is a credit the user paid for nothing.
 *
 * @param {string} userId
 * @param {string} userEmail
 * @param {string} description Written to the audit row.
 * @returns {Promise<void>}
 */
export async function refundOneCredit(userId, userEmail, description) {
  try {
    const profile = await getProfile(userId, userEmail);
    if (profile.is_premium) return;
    await updateProfile(userId, { credits: profile.credits + 1 });
    const { error: txError } = await supabaseAdmin.from('credit_transactions').insert({
      user_id: userId,
      amount: 1,
      type: 'refund',
      description,
    });
    if (txError) {
      log.error('[API] credit_transactions insert failed after refund:', formatSupabaseError(txError));
    }
  } catch (err) {
    log.error('[API] credit refund failed after a failed generation:', apiErrorMessage(err));
  }
}
