/**
 * Paying for an AI generation: a follow-up the server granted, nothing on
 * Premium, or one credit. POST /api/answer-vault/generate (Answer Studio and
 * cover letters) and POST /api/jobs/explain spend through here, by way of
 * server/lib/credits.js.
 *
 * ═══ WHERE THE RULES LIVE ═══
 *
 * In the database: spend_generation() and undo_generation(), from
 * supabase/migrations/007_generation_charges.sql. Each step there is one
 * conditional statement (`update … where credits > 0`, `update … where
 * remaining > 0`), so two requests holding the last credit cannot both spend
 * it: the row lock makes the second one see zero. A read here and a write
 * after it would reopen exactly that window, which is why nothing in server/
 * computes a balance.
 *
 * This module is the doorway. supabaseSpendStore() calls the two functions
 * over RPC; memorySpendStore() is the same rules in JS, for npm test and the
 * route tests' fake database. Change one, change the other, and the SQL tests
 * in test/server/generationSpend.test.js.
 *
 * ═══ A CHARGE'S ROW IS ITS RECEIPT ═══
 *
 * Every charge writes a `generation_allowances` row (with 0 follow-ups for
 * "Explain my fit"). undo_generation() refunds a charge only by deleting that
 * row, so a charge is refunded at most once, and only a charge that happened.
 *
 * ═══ FAIL-CLOSED, ON PURPOSE ═══
 *
 * The hourly limit (server/generateLimit.js) fails open: it protects a quota.
 * This fails closed: a spend that cannot be made refuses the generation (503,
 * and an error log naming migration 007 when that is the reason). Generating
 * anyway would be the free path this exists to close.
 */
import { randomUUID } from 'node:crypto';
import { applicationKey, COVER_LETTER_FREE_RERUNS } from '../../src/coverLetterCredits.js';

/** Named in the error log when the functions are missing. */
export const MIGRATION_FILE = 'supabase/migrations/007_generation_charges.sql';

/** Every kind the database accepts. 'explain' is "Explain my fit". */
export const SPEND_KINDS = Object.freeze(['answer', 'cover_letter', 'explain']);

/** The kinds a client may name on POST /api/answer-vault/generate. */
export const CLIENT_KINDS = Object.freeze(['answer', 'cover_letter']);

/** Free improvements one paid answer buys (Answer Studio's rule). */
export const ANSWER_FREE_IMPROVEMENTS = 3;

/** How long granted follow-ups last. The SQL's column default says the same. */
export const FOLLOW_UP_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Follow-ups a charge of this kind grants: 3 for an answer, the cover
 * letter's re-run from src/coverLetterCredits.js, none for anything else.
 * @param {string} kind
 * @returns {number}
 */
export function freeFollowUps(kind) {
  if (kind === 'answer') return ANSWER_FREE_IMPROVEMENTS;
  if (kind === 'cover_letter') return COVER_LETTER_FREE_RERUNS;
  return 0;
}

/**
 * The header lines both front ends put before the description in a cover
 * letter's job context: "Organization: <company>\n", then "Role: <role>\n\n"
 * (cover-letter.js's jobContextFor(), CoverLetterPanel.jsx). Each is one
 * line, and only a short one counts as a header: a long first line is part
 * of the description, so a whole other job cannot ride in the company field.
 */
const CONTEXT_HEADERS = [/^Organization:[^\n]{0,200}\n/, /^Role:[^\n]{0,200}\n/];

/**
 * The job description inside a cover letter's job context: the context with
 * its leading "Organization:" and "Role:" lines removed.
 * @param {string} jobContext
 * @returns {string}
 */
export function jobDescriptionOf(jobContext) {
  let rest = String(jobContext || '').trimStart();
  for (const header of CONTEXT_HEADERS) rest = rest.replace(header, '').trimStart();
  return rest;
}

/**
 * Which application a cover letter's re-run is for: applicationKey() of the
 * description in the job context the server was actually sent, so a client
 * cannot claim one description and send another. The company and role lines
 * are left out: editing them does not make a new application
 * (src/coverLetterCredits.js), and the dashboard's cost hint keys the
 * description alone too. Answers' improvements are not tied to text: null.
 * @param {string} kind
 * @param {string} jobContext
 * @returns {string|null}
 */
export function subjectKeyFor(kind, jobContext) {
  return kind === 'cover_letter' ? applicationKey(jobDescriptionOf(jobContext)) : null;
}

const MESSAGES = {
  no_credits: 'No credits remaining',
  no_profile: 'Your account is still being set up. Try again in a moment.',
  not_migrated: 'AI writing is unavailable right now, so nothing was generated or charged. Please try again later.',
  unavailable: 'Couldn’t check your credits, so nothing was generated. Try again in a moment.',
};

/**
 * A spend that did not happen.
 *
 * `code`: 'no_credits' (403), 'no_profile' (the caller creates the row and
 * tries again), 'not_migrated' (migration 007 is missing) or 'unavailable'
 * (anything else). Every one of them means nothing was spent.
 */
export class SpendError extends Error {
  /**
   * @param {'no_credits'|'no_profile'|'not_migrated'|'unavailable'} code
   * @param {string|null} [dbCode] PostgREST's or Postgres's code, for the log.
   */
  constructor(code, dbCode = null) {
    super(MESSAGES[code] || MESSAGES.unavailable);
    this.name = 'SpendError';
    this.code = MESSAGES[code] ? code : 'unavailable';
    this.dbCode = dbCode || null;
    this.statusCode = this.code === 'no_credits' ? 403 : 503;
  }
}

/**
 * What a PostgREST error from spend_generation()/undo_generation() means.
 *
 * The functions raise 'no_credits' and 'no_profile' themselves. A missing
 * function is PGRST202 from PostgREST's schema cache (or 42883 from Postgres),
 * and a missing table under it 42P01: all three are migration 007 not being
 * applied. Anything else, the network included, is 'unavailable'.
 * @param {{code?: string, message?: string}|null|undefined} error
 * @returns {'no_credits'|'no_profile'|'not_migrated'|'unavailable'}
 */
export function classifySpendError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (/\bno_credits\b/.test(message)) return 'no_credits';
  if (/\bno_profile\b/.test(message)) return 'no_profile';
  if (['PGRST202', '42883', '42P01'].includes(code)) return 'not_migrated';
  return 'unavailable';
}

const finiteOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * spend_generation()'s answer, checked. A shape that is not a spend is
 * treated as no spend at all.
 * @returns {{charged: boolean, premium: boolean, allowanceId: string|null,
 *   followUpsLeft: number|null, credits: number|null}}
 */
function readSpend(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.charged !== 'boolean') {
    throw new SpendError('unavailable', 'bad_response');
  }
  return {
    charged: data.charged,
    premium: data.premium === true,
    allowanceId: typeof data.allowanceId === 'string' && data.allowanceId ? data.allowanceId : null,
    followUpsLeft: finiteOrNull(data.followUpsLeft),
    credits: finiteOrNull(data.credits),
  };
}

/**
 * The store the server uses: the two database functions, over RPC.
 * @param {{rpc: Function}} client A service-role Supabase client. The
 *   functions are executable by the service role only.
 */
export function supabaseSpendStore(client) {
  async function call(fn, args) {
    let result;
    try {
      result = await client.rpc(fn, args);
    } catch (err) {
      throw new SpendError('unavailable', err?.code || null);
    }
    if (result?.error) throw new SpendError(classifySpendError(result.error), result.error.code || null);
    return result?.data;
  }

  return {
    kind: 'supabase',
    /**
     * @param {{userId: string, kind: string, allowanceId?: string|null,
     *   subject?: string|null, free?: number, description?: string}} args
     */
    async spend({ userId, kind, allowanceId = null, subject = null, free = 0, description = null }) {
      return readSpend(await call('spend_generation', {
        p_user: userId,
        p_kind: kind,
        p_allowance: allowanceId,
        p_subject: subject,
        p_free: free,
        p_description: description,
      }));
    },
    /** Give back what `spend` took. Resolves with the function's answer. */
    async undo(userId, spend, description = null) {
      return call('undo_generation', {
        p_user: userId,
        p_spend: { charged: spend?.charged === true, allowanceId: spend?.allowanceId ?? null },
        p_description: description,
      });
    },
  };
}

/**
 * The same rules in process, for tests. Each method's body runs without an
 * await, so concurrent calls serialise the way the database's row locks make
 * them: two spends holding one credit, one passes.
 *
 * @param {{ now?: () => number,
 *   accounts?: Record<string, {credits?: number, isPremium?: boolean}> }} [options]
 */
export function memorySpendStore({ now = Date.now, accounts = {} } = {}) {
  const profiles = new Map();
  const allowances = new Map();
  const transactions = [];

  const setAccount = (userId, { credits = 0, isPremium = false } = {}) => {
    profiles.set(userId, { credits, isPremium: !!isPremium });
  };
  for (const [userId, account] of Object.entries(accounts)) setAccount(userId, account);

  function spendNow({ userId, kind, allowanceId = null, subject = null, free = 0, description = null }) {
    if (!SPEND_KINDS.includes(kind)) throw new SpendError('unavailable', '22023');
    const t = now();

    // 1. A follow-up this account was granted.
    if (allowanceId) {
      const row = allowances.get(allowanceId);
      if (row && row.userId === userId && row.kind === kind && row.remaining > 0 && row.expiresAt > t
        && (row.subjectKey === null || row.subjectKey === subject)) {
        row.remaining -= 1;
        return { charged: false, premium: false, allowanceId, followUpsLeft: row.remaining, credits: profiles.get(userId)?.credits ?? null };
      }
    }

    // 2. Premium.
    const profile = profiles.get(userId);
    if (profile?.isPremium) return { charged: false, premium: true, allowanceId: null, followUpsLeft: null, credits: null };

    // 3. One credit.
    if (!profile) throw new SpendError('no_profile', 'P0001');
    if (!(profile.credits > 0)) throw new SpendError('no_credits', 'P0001');
    profile.credits -= 1;
    transactions.push({ userId, amount: -1, type: 'usage', description: description || 'AI generation credit used' });
    const id = randomUUID();
    const remaining = Math.max(0, Math.trunc(Number(free) || 0));
    allowances.set(id, { id, userId, kind, subjectKey: subject ?? null, remaining, createdAt: t, expiresAt: t + FOLLOW_UP_DAYS * DAY_MS });
    return { charged: true, premium: false, allowanceId: id, followUpsLeft: remaining, credits: profile.credits };
  }

  function undoNow(userId, spend, description = null) {
    const id = spend?.allowanceId;
    const row = id ? allowances.get(id) : null;
    if (!row || row.userId !== userId) return { undone: false };
    if (spend.charged === true) {
      allowances.delete(id);
      const profile = profiles.get(userId);
      if (profile) profile.credits = profile.credits + 1;
      transactions.push({ userId, amount: 1, type: 'refund', description: description || 'Credit refunded (failed generation)' });
      return { undone: true, credits: profile ? profile.credits : null };
    }
    row.remaining += 1;
    return { undone: true, followUpsLeft: row.remaining };
  }

  return {
    kind: 'memory',
    async spend(args) {
      return spendNow(args);
    },
    async undo(userId, spend, description) {
      return undoNow(userId, spend, description);
    },
    /** Tests and the fake database: an account's row. */
    setAccount,
    account: (userId) => (profiles.has(userId) ? { ...profiles.get(userId) } : null),
    /** Tests: the audit rows and allowances written. */
    transactions,
    allowances,
  };
}
