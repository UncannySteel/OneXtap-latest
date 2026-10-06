/**
 * A per-account hourly ceiling on AI drafts: POST /api/answer-vault/generate
 * (Answer Studio and cover letters).
 *
 * ═══ WHY ═══
 *
 * That route spends the Groq quota, which on Groq's free tier is rationed per
 * minute for the whole app (server/.env.example), and nothing else bounds it:
 * Premium is unlimited, and the free tier's improvements and re-runs are
 * counted by the client (HANDOVER.md §7 item 25). One account in a loop could
 * make generation fail for everyone. This is the ceiling: past it, an account
 * is refused for the rest of its hour, whatever its plan. It is not a price;
 * credits stay what they were.
 *
 * Same shape as ranking's limit (server/jobs/rankCache.js): one row per
 * account, a fixed window, and a read-then-write, so a burst of genuinely
 * simultaneous requests can overshoot by its own size. Acceptable for a
 * ceiling. The table is `generation_rate_limit`
 * (supabase/migrations/006_generation_rate_limit.sql).
 *
 * ═══ FAIL-OPEN, ON PURPOSE ═══
 *
 * If the count cannot be read or written (the migration not applied yet,
 * Supabase unreachable), the request goes through and the failure is logged,
 * once per process. This protects a quota; it must never be the reason nobody
 * can write a cover letter. So deploying this before the migration is safe:
 * the route works, without its ceiling, and says so in the log.
 */
import { log } from './logger.js';

const limitLog = log.child('generate-limit');

const TABLE = 'generation_rate_limit';

/** The window: an hour. */
export const GENERATE_WINDOW_MS = 60 * 60 * 1000;

/** Drafts per account per hour, unless GENERATE_LIMIT_PER_HOUR says otherwise. */
export const DEFAULT_GENERATE_LIMIT = 30;

/**
 * @param {Record<string, string|undefined>} [env]
 * @returns {number} GENERATE_LIMIT_PER_HOUR when it is a positive whole
 *   number, else DEFAULT_GENERATE_LIMIT.
 */
export function generateLimitPerHour(env = process.env) {
  const raw = String(env?.GENERATE_LIMIT_PER_HOUR ?? '').trim();
  const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : DEFAULT_GENERATE_LIMIT;
}

/**
 * The decision both stores make. The count only advances for a request that
 * was allowed, so an account parked at the limit does not push its own reset
 * further away with every retry.
 */
function decide(window, now, limit, windowMs) {
  const startedAt = window ? Number(window.windowStart) : NaN;
  const fresh = !window || Number.isNaN(startedAt) || now - startedAt >= windowMs;
  const windowStart = fresh ? now : startedAt;
  const count = fresh ? 0 : Number(window.count) || 0;
  const allowed = count < limit;
  const nextCount = allowed ? count + 1 : count;
  return {
    allowed,
    windowStart,
    count: nextCount,
    remaining: Math.max(0, limit - nextCount),
    resetAt: new Date(windowStart + windowMs).toISOString(),
  };
}

/**
 * In-process counts: development, tests, and a server with no Supabase.
 * @param {{ now?: () => number }} [options] A clock, for tests.
 */
export function memoryLimitStore({ now = Date.now } = {}) {
  const windows = new Map();
  return {
    kind: 'memory',
    async consume(userId, limit, windowMs = GENERATE_WINDOW_MS) {
      const r = decide(windows.get(userId), now(), limit, windowMs);
      windows.set(userId, { windowStart: r.windowStart, count: r.count });
      return r;
    },
  };
}

/**
 * Counts in Supabase, shared by every instance of the function.
 * @param {object} client A service-role Supabase client (the table has RLS on
 *   and no policies).
 * @param {{ now?: () => number }} [options]
 */
export function supabaseLimitStore(client, { now = Date.now } = {}) {
  return {
    kind: 'supabase',
    async consume(userId, limit, windowMs = GENERATE_WINDOW_MS) {
      const { data, error } = await client
        .from(TABLE)
        .select('window_start,request_count')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw new Error(error.message || `${TABLE} read failed`);

      const r = decide(
        data ? { windowStart: new Date(data.window_start).getTime(), count: data.request_count } : null,
        now(), limit, windowMs,
      );
      const { error: writeError } = await client.from(TABLE).upsert(
        { user_id: userId, window_start: new Date(r.windowStart).toISOString(), request_count: r.count },
        { onConflict: 'user_id' },
      );
      if (writeError) throw new Error(writeError.message || `${TABLE} write failed`);
      return r;
    },
  };
}

let shared = null;
let warned = false;

/**
 * The store the route uses: Supabase when the project is configured and a
 * client is given, memory otherwise. Chosen once per process and announced
 * once.
 * @param {{ client?: object|null, force?: 'memory'|'supabase', fresh?: boolean }} [options]
 */
export function createGenerateLimitStore(options = {}) {
  const o = options && typeof options === 'object' ? options : {};
  if (shared && !o.fresh && !o.force) return shared;
  const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const useSupabase = o.force === 'supabase' || (o.force !== 'memory' && configured && Boolean(o.client));
  const store = useSupabase ? supabaseLimitStore(o.client) : memoryLimitStore();
  if (!shared) {
    limitLog.info(useSupabase
      ? `generation limit: supabase (${TABLE}), ${generateLimitPerHour()} an hour`
      : `generation limit: in-memory, ${generateLimitPerHour()} an hour — not shared between processes`);
  }
  if (!o.fresh) shared = store;
  return store;
}

/**
 * Count one draft against the account's hour.
 * @param {{ consume: Function }} store
 * @param {string} userId
 * @param {{ limit?: number, windowMs?: number }} [options]
 * @returns {Promise<{ allowed: boolean, remaining: number|null, resetAt: string|null, limit: number }>}
 *   Never throws: a store that fails lets the request through (see header).
 */
export async function consumeGeneration(store, userId, { limit = generateLimitPerHour(), windowMs = GENERATE_WINDOW_MS } = {}) {
  try {
    const r = await store.consume(userId, limit, windowMs);
    return { allowed: r.allowed, remaining: r.remaining, resetAt: r.resetAt, limit };
  } catch (err) {
    if (!warned) {
      warned = true;
      limitLog.warn('generation limit unavailable; drafts are not being limited', {
        reason: String(err?.message || err).slice(0, 200),
      });
    }
    return { allowed: true, remaining: null, resetAt: null, limit };
  }
}

/**
 * The refusal, as the pages show it.
 * @param {string|null} resetAt ISO time the window ends.
 * @param {number} limit
 * @param {number} [now]
 */
export function limitMessage(resetAt, limit, now = Date.now()) {
  const left = resetAt ? new Date(resetAt).getTime() - now : GENERATE_WINDOW_MS;
  const minutes = Math.max(1, Math.ceil(left / 60000));
  return `That’s the limit of ${limit} AI drafts an hour. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

/** Tests only: forget the shared store and the warn-once latch. */
export function __resetGenerateLimitForTests() {
  shared = null;
  warned = false;
}
