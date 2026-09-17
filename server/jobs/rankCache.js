/**
 * The rank cache and the rank rate limit.
 *
 * ═══ ONE INTERFACE, TWO IMPLEMENTATIONS ═══
 *
 *   memoryStore()          a Map. Tests and local dev.
 *   supabaseStore(client)  public.rank_cache + public.rank_rate_limit.
 *
 * Both expose exactly `get`, `set` and `consume`, so nothing above this file
 * knows which one it is holding. `createRankStore()` picks: Supabase when it
 * is configured, memory otherwise, announced once at startup rather than on
 * every request.
 *
 * The memory implementation is not a toy. It is what runs in `npm run
 * server:dev`, it is what every test exercises, and — because the interface is
 * three methods — it is also the proof that the Supabase one is substitutable.
 * What it is NOT is a production cache: see the comment on the rank_cache
 * table in supabase/migrations/002_rank_cache.sql for why a Map on Vercel has
 * a hit rate of roughly zero.
 *
 * ═══ NEITHER MAY EVER HARD-FAIL A REQUEST ═══
 *
 * A cache that returns an error instead of a miss is worse than no cache, and
 * a rate limiter that 500s has turned a capacity control into an outage. Every
 * store call in `rankWithCache` is wrapped: a store failure degrades to "miss"
 * and "allowed", logged and then forgotten.
 */
import { createHash } from 'node:crypto';
import { log } from '../logger.js';

const cacheLog = log.child('rank');

/**
 * How long a ranked result stays fresh.
 *
 * Six hours. The pool is refreshed by a daily cron, so a result older than one
 * ingest cycle can be describing jobs that no longer lead the list — but
 * anything much shorter throws away the hit on the case the cache exists for:
 * a user who ranks in the morning, closes the tab, and comes back after lunch.
 */
export const RANK_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Ranking requests per user per hour.
 *
 * Ten. Ranking costs the user no credits, which is deliberate — a job seeker
 * should not be charged to look — so this number is the only thing standing
 * between a component stuck in a render loop and a provider bill. It is a
 * ceiling on accidents, not a product limit: ten distinct ranked searches in
 * an hour is already far more than the feature is used for, and the eleventh
 * is answered rather than refused.
 */
export const RANK_LIMIT_PER_HOUR = 10;

/** The rate-limit window. */
export const RATE_WINDOW_MS = 60 * 60 * 1000;

/** Supabase table names, in one place so a rename is one edit. */
const CACHE_TABLE = 'rank_cache';
const LIMIT_TABLE = 'rank_rate_limit';

/**
 * Recursively sort object keys so that two structurally identical filter
 * objects serialise to the same string regardless of the order their keys
 * happened to be written in.
 *
 * This is the whole reason `cacheKey` is a function and not `JSON.stringify`:
 * `{remote:'any', q:'react'}` and `{q:'react', remote:'any'}` are the same
 * question, and a cache that treats them as different questions has a hit rate
 * determined by the order a React component spread its props.
 *
 * undefined and null values are dropped rather than serialised, so an absent
 * filter and one explicitly set to undefined are also the same question.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const v = canonical(value[key]);
      if (v === undefined || v === null || v === '') continue;
      out[key] = v;
    }
    return out;
  }
  return value;
}

/**
 * The cache key for one ranking question.
 *
 * Everything that can change the answer is in it, and nothing that cannot:
 *
 *   userId          — cache entries are never shared across users.
 *   resumeHash      — a changed resume is a different question.
 *   matcherVersion  — bumping the scorer must invalidate every stored result,
 *                     or the list silently mixes two algorithms.
 *   filters         — canonicalised, so key order and absent-vs-empty do not
 *                     fragment the cache.
 *
 * Notably absent: any score threshold. The client re-ranks locally, so a user
 * moving a "minimum match" slider is not asking a new question and must not
 * cost a new set of LLM calls.
 *
 * Total: null, undefined and a non-object all key the same empty question,
 * because a key is not the place to discover a caller's bad argument — it is
 * on the read path of a request that has to answer either way.
 *
 * @param {{userId?: string, resumeHash?: string, matcherVersion?: unknown,
 *   filters?: object}} [params]
 * @returns {string} Hex sha256.
 */
export function cacheKey(params = {}) {
  const { userId, resumeHash, matcherVersion, filters } =
    params && typeof params === 'object' ? params : {};

  const payload = JSON.stringify(
    canonical({
      userId: String(userId ?? ''),
      resumeHash: String(resumeHash ?? ''),
      matcherVersion: String(matcherVersion ?? ''),
      filters: filters && typeof filters === 'object' ? filters : {},
    })
  );
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * In-process store. A Map for the cache, a Map for the counters.
 * @returns {{kind: string, get: Function, set: Function, consume: Function, clear: Function}}
 */
export function memoryStore() {
  /** @type {Map<string, {payload: unknown, expiresAt: number}>} */
  const cache = new Map();
  /** @type {Map<string, {windowStart: number, count: number}>} */
  const counters = new Map();

  return {
    kind: 'memory',

    async get(userId, key) {
      const entry = cache.get(`${userId}::${key}`);
      if (!entry) return null;
      if (entry.expiresAt <= Date.now()) {
        cache.delete(`${userId}::${key}`);
        return null;
      }
      return entry.payload;
    },

    async set(userId, key, payload, ttlMs = RANK_CACHE_TTL_MS) {
      cache.set(`${userId}::${key}`, { payload, expiresAt: Date.now() + ttlMs });
    },

    async consume(userId, limit = RANK_LIMIT_PER_HOUR, windowMs = RATE_WINDOW_MS) {
      const now = Date.now();
      const current = counters.get(userId);
      const window =
        current && now - current.windowStart < windowMs
          ? current
          : { windowStart: now, count: 0 };

      // Read-then-decide-then-write: the count only advances for a request
      // that was actually allowed, so a user parked over the limit does not
      // push their own window's reset further away with every retry.
      const allowed = window.count < limit;
      if (allowed) window.count += 1;
      counters.set(userId, window);

      return {
        allowed,
        count: window.count,
        remaining: Math.max(0, limit - window.count),
        resetAt: new Date(window.windowStart + windowMs).toISOString(),
      };
    },

    /** Tests only. */
    clear() {
      cache.clear();
      counters.clear();
    },
  };
}

/**
 * Supabase-backed store.
 *
 * The client is a parameter, like everywhere else in this batch, so this is
 * exercisable against a stub without a database.
 *
 * @param {object} client A Supabase client with service-role rights: both
 *   tables are service-role-only by design (see migration 002).
 */
export function supabaseStore(client) {
  return {
    kind: 'supabase',

    async get(userId, key) {
      const { data, error } = await client
        .from(CACHE_TABLE)
        .select('payload,expires_at')
        .eq('user_id', userId)
        .eq('cache_key', key)
        .maybeSingle();

      if (error) throw new Error(error.message || 'rank_cache read failed');
      if (!data) return null;
      if (new Date(data.expires_at).getTime() <= Date.now()) return null;
      return data.payload ?? null;
    },

    async set(userId, key, payload, ttlMs = RANK_CACHE_TTL_MS) {
      const { error } = await client.from(CACHE_TABLE).upsert(
        {
          user_id: userId,
          cache_key: key,
          payload,
          expires_at: new Date(Date.now() + ttlMs).toISOString(),
        },
        { onConflict: 'user_id,cache_key' }
      );
      if (error) throw new Error(error.message || 'rank_cache write failed');
    },

    async consume(userId, limit = RANK_LIMIT_PER_HOUR, windowMs = RATE_WINDOW_MS) {
      const now = Date.now();

      const { data, error } = await client
        .from(LIMIT_TABLE)
        .select('window_start,request_count')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw new Error(error.message || 'rank_rate_limit read failed');

      const startedAt = data?.window_start ? new Date(data.window_start).getTime() : 0;
      const fresh = !data || Number.isNaN(startedAt) || now - startedAt >= windowMs;
      const windowStart = fresh ? now : startedAt;
      const count = fresh ? 0 : Number(data.request_count) || 0;

      const allowed = count < limit;
      const nextCount = allowed ? count + 1 : count;

      // Read-modify-write, not an atomic increment: two ranking requests from
      // one user landing in the same millisecond can each read the same count
      // and each write count+1, so the limit can be overshot by the number of
      // genuinely concurrent requests. That is acceptable here and a Postgres
      // function would be over-engineering — this is a ceiling on accidental
      // loops, not a billing meter, and the cost of a race is one extra rank.
      const { error: writeError } = await client.from(LIMIT_TABLE).upsert(
        {
          user_id: userId,
          window_start: new Date(windowStart).toISOString(),
          request_count: nextCount,
        },
        { onConflict: 'user_id' }
      );
      if (writeError) throw new Error(writeError.message || 'rank_rate_limit write failed');

      return {
        allowed,
        count: nextCount,
        remaining: Math.max(0, limit - nextCount),
        resetAt: new Date(windowStart + windowMs).toISOString(),
      };
    },
  };
}

/** Announced once per process, not per request. */
let announced = false;
/** @type {object|null} */
let shared = null;

/**
 * Pick a store.
 *
 * Supabase when a client is available and the project is configured; memory
 * otherwise. The choice is logged exactly once, because "which cache am I
 * running" is a thing you want to know at startup and never want repeated on
 * every request.
 *
 * @param {{client?: object|null, force?: 'memory'|'supabase', fresh?: boolean}} [options]
 *   Null or junk reads as no options, which is the memory store.
 * @returns {object} A store.
 */
export function createRankStore(options = {}) {
  const o = options && typeof options === 'object' ? options : {};
  if (shared && !o.fresh && !o.force) return shared;

  const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const useSupabase =
    o.force === 'supabase' || (o.force !== 'memory' && configured && Boolean(o.client));

  const store = useSupabase ? supabaseStore(o.client) : memoryStore();

  if (!announced) {
    announced = true;
    cacheLog.info(
      useSupabase
        ? 'rank cache: supabase (rank_cache / rank_rate_limit)'
        : 'rank cache: in-memory — results are not shared between processes or invocations'
    );
  }

  if (!o.fresh) shared = store;
  return store;
}

/** Tests only: forget the shared store and the "announced once" latch. */
export function __resetRankStoreForTests() {
  shared = null;
  announced = false;
}

/**
 * Cache, rate-limit and run one ranking request.
 *
 * The order is deliberate and load-bearing:
 *
 *   1. CACHE FIRST. A hit costs nothing and must not consume rate-limit
 *      budget — re-rendering a list the user already has is not a new request.
 *   2. THEN the rate limit.
 *   3. OVER THE LIMIT IS NOT AN ERROR. The caller gets the keyword-only
 *      result, flagged `limited: true` and `degraded: true`. A job seeker who
 *      hits a ceiling they did not know existed should see a slightly worse
 *      list with an explanation, not an error toast.
 *   4. A DEGRADED RESULT IS NOT CACHED. Caching the output of an outage would
 *      keep serving it for six hours after the provider recovered.
 *
 * `store`, `runGraph` and `keywordFallback` are required. A store that throws
 * is handled — that is the point of steps above — but a missing `runGraph` is
 * a wiring error with no honest answer, and this function will not invent one.
 *
 * @param {object} params
 * @param {object} params.store From createRankStore().
 * @param {string} params.userId
 * @param {string} params.key From cacheKey().
 * @param {() => Promise<object>} params.runGraph
 * @param {() => Promise<object>} params.keywordFallback Used when over limit.
 * @param {number} [params.ttlMs]
 * @param {number} [params.limit]
 * @param {number} [params.windowMs]
 * @returns {Promise<object>} The result, plus `cached` and `limited`.
 */
export async function rankWithCache({
  store,
  userId,
  key,
  runGraph,
  keywordFallback,
  ttlMs = RANK_CACHE_TTL_MS,
  limit = RANK_LIMIT_PER_HOUR,
  windowMs = RATE_WINDOW_MS,
} = {}) {
  let cached = null;
  try {
    cached = await store.get(userId, key);
  } catch (err) {
    cacheLog.warn('rank cache read failed, treating as a miss', { errName: err?.name });
  }
  if (cached) {
    return { ...cached, cached: true, limited: false };
  }

  let gate = { allowed: true, remaining: limit, resetAt: null };
  try {
    gate = await store.consume(userId, limit, windowMs);
  } catch (err) {
    // Fail open. A limiter that cannot read its own counter must not become
    // the reason nobody can search.
    cacheLog.warn('rank rate limit check failed, allowing the request', { errName: err?.name });
  }

  if (!gate.allowed) {
    const fallback = await keywordFallback();
    return {
      ...fallback,
      degraded: true,
      cached: false,
      limited: true,
      limitResetAt: gate.resetAt || null,
    };
  }

  const result = await runGraph();

  if (!result?.degraded) {
    try {
      await store.set(userId, key, result, ttlMs);
    } catch (err) {
      cacheLog.warn('rank cache write failed', { errName: err?.name });
    }
  }

  return { ...result, cached: false, limited: false, rateRemaining: gate.remaining ?? null };
}
