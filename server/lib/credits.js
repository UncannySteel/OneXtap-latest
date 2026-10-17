/**
 * Spending and giving back credits on the server, for the routes that charge
 * for a generation: POST /api/answer-vault/generate (Answer Studio and cover
 * letters) and POST /api/jobs/explain ("Explain my fit").
 *
 * Every spend and every refund is one call to the database's
 * spend_generation() or undo_generation() (migration 007, through
 * ./generationSpend.js). Their single conditional statements are what stop two
 * requests holding the last credit from both spending it, so nothing here, or
 * anywhere in server/, reads a balance and writes it back.
 *
 * Apart from a new account's welcome credits, a balance changes only here
 * (CLAUDE.md rule 6). There is no public refund route:
 * test/server/routes.test.js pins that the only refunds are the ones below,
 * called by the route that charged.
 */
import { supabaseAdmin, getProfile } from '../supabase.js';
import { log } from '../logger.js';
import { supabaseSpendStore, SpendError, MIGRATION_FILE } from './generationSpend.js';

const creditLog = log.child('credits');

let store = null;
function spendStore() {
  if (!store) store = supabaseSpendStore(supabaseAdmin);
  return store;
}

/** Log why a spend failed, once, where it failed; the caller only answers. */
function spendFailure(err, kind) {
  const e = err instanceof SpendError ? err : new SpendError('unavailable', err?.code || null);
  if (e.code === 'not_migrated') {
    creditLog.error(
      `generation charging is not set up: apply ${MIGRATION_FILE}. Paid generations are refused until it is.`,
      { kind, dbCode: e.dbCode },
    );
  } else if (e.code !== 'no_credits') {
    creditLog.error('could not spend for a generation; nothing was generated', {
      kind,
      code: e.code,
      dbCode: e.dbCode,
      reason: String(err?.message || err).slice(0, 200),
    });
  }
  return e;
}

/**
 * Pay for one generation, before it runs: a granted follow-up, Premium, or
 * one credit (server/lib/generationSpend.js has the rules).
 *
 * @param {{ userId: string, userEmail?: string|null, kind: string,
 *   allowanceId?: string|null, subject?: string|null, free?: number,
 *   description?: string }} args `free` is what a charge grants; the caller
 *   takes it from freeFollowUps(), never from a client.
 * @returns {Promise<{charged: boolean, premium: boolean, allowanceId: string|null,
 *   followUpsLeft: number|null, credits: number|null}>}
 * @throws {SpendError} Nothing was spent: 'no_credits' (403), or a 503.
 */
export async function spendGeneration({ userId, userEmail = null, kind, allowanceId = null, subject = null, free = 0, description = null }) {
  const args = { userId, kind, allowanceId, subject, free, description };
  try {
    try {
      return await spendStore().spend(args);
    } catch (err) {
      if (err?.code !== 'no_profile') throw err;
      // No profiles row (a project without the sign-up trigger): getProfile()
      // creates it with the welcome credits, as every other credit route does.
      await getProfile(userId, userEmail);
      return await spendStore().spend(args);
    }
  } catch (err) {
    throw spendFailure(err, kind);
  }
}

/**
 * Give back what a spend took, after the generation it paid for failed: a
 * charge's credit (once: its allowance row is the receipt), or a follow-up's
 * use. A Premium spend took nothing.
 *
 * Never throws: this runs on an error path, and a failed refund must not
 * replace the error the user needs to see. It logs loudly instead; a refund
 * lost silently is a credit the user paid for nothing.
 *
 * @param {string} userId
 * @param {object|null} spend What spendGeneration() resolved with.
 * @param {string} description Written to the refund's audit row.
 * @returns {Promise<void>}
 */
export async function undoGeneration(userId, spend, description) {
  if (!spend?.allowanceId) return;
  try {
    const result = await spendStore().undo(userId, spend, description);
    if (result?.undone !== true) {
      creditLog.error('a failed generation’s spend was not given back: no matching allowance', { charged: spend.charged });
    }
  } catch (err) {
    creditLog.error('could not give back a spend after a failed generation', {
      charged: spend.charged,
      code: err?.code,
      dbCode: err?.dbCode,
    });
  }
}

/**
 * Charge one credit for "Explain my fit", after its analysis succeeded.
 *
 * The same atomic spend as Answer Studio's, of kind 'explain', which grants no
 * follow-up. Premium is free.
 *
 * @param {string} userId
 * @param {string} userEmail Used only to create a missing profile row.
 * @param {string} description Written to the audit row.
 * @returns {Promise<{charged: boolean, remaining: number, spend: object}>}
 *   `remaining` is Infinity for a Premium account, which was not charged;
 *   `spend` is what refundOneCredit() needs to give the credit back.
 * @throws {SpendError} With `statusCode` 403 when the balance is empty, 503
 *   when the spend could not be made. Nothing was charged.
 */
export async function chargeOneCredit(userId, userEmail, description) {
  const spend = await spendGeneration({ userId, userEmail, kind: 'explain', free: 0, description });
  if (spend.premium) return { charged: false, remaining: Infinity, spend };
  return { charged: true, remaining: spend.credits, spend };
}

/**
 * Give back the credit chargeOneCredit() took, after a failure that happened
 * AFTER the charge. Only that charge can be refunded, and only once.
 *
 * Never throws (see undoGeneration()).
 *
 * @param {string} userId
 * @param {string} _userEmail Unused; kept so the call reads like the charge.
 * @param {string} description Written to the audit row.
 * @param {{charged: boolean, spend?: object}|null} charge What
 *   chargeOneCredit() resolved with.
 * @returns {Promise<void>}
 */
export async function refundOneCredit(userId, _userEmail, description, charge) {
  if (!charge?.charged) return;
  if (!charge.spend) {
    creditLog.error('refundOneCredit() was given no charge to refund; nothing was given back');
    return;
  }
  await undoGeneration(userId, charge.spend, description);
}
