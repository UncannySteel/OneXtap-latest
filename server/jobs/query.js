/**
 * Reading the shared job pool.
 *
 * One function, `fetchJobPool`, plus the two things that make it safe: an
 * explicit column list and a LIKE-metacharacter escape.
 *
 * ═══ THE CLIENT TAKES THE SUPABASE CLIENT AS A PARAMETER ═══
 *
 * Not imported. `fetchJobPool(supabase, filters)` is given its client, so a
 * test injects a recording stub and asserts on the exact query that was built
 * — which columns were selected, which filters were applied — with no network
 * and no database. That is the only way any of this is verifiable while the
 * project is unreachable, and it stays the only honest way to assert "this
 * query never selects the description" afterwards.
 */

/**
 * Rows returned when the caller does not ask for a number.
 *
 * Two hundred is roughly ten screens of an infinite-scroll list, so the first
 * page outruns the user rather than the other way round, and it is also well
 * above PREFILTER_LIMIT — the ranking path reads one page and then keeps the
 * best 30, so a default that dipped below the prefilter's appetite would make
 * the pool read, not the scorer, the thing deciding which jobs a user can see.
 */
export const DEFAULT_LIMIT = 200;

/**
 * Hard ceiling. A caller asking for more gets this.
 *
 * Five hundred description-free rows is about a megabyte on the wire — the
 * point at which a "just show me everything" request stops being a list and
 * starts being a download. Past it the client is paging in memory anyway, so
 * the extra rows buy nothing and cost the server a larger scan.
 */
export const MAX_LIMIT = 500;

/**
 * How far back the pool is read when the caller does not say.
 *
 * Thirty days, because a job posting older than a month is usually either
 * filled or a permanent listing nobody answers — and because the ingest cron
 * refreshes `last_seen_at` daily, so anything still genuinely open keeps
 * reappearing inside the window on its own.
 */
export const DEFAULT_SINCE_DAYS = 30;

/**
 * The columns `fetchJobPool` reads. Explicit, never `select('*')`.
 *
 * ═══ `description` IS NOT IN THIS LIST, AND MUST NOT BE ═══
 *
 * Descriptions are stored for one reason: server-side LLM scoring, where the
 * text is read inside this process and never leaves it except as a score and a
 * one-sentence gap summary. They are the largest column in the table by an
 * order of magnitude, they are third-party content of uncertain licence, and a
 * pool browse returning 200 of them is a multi-megabyte response that no
 * client renders.
 *
 * `select('*')` would put it back silently the moment someone adds a column.
 * That is the entire argument for spelling the list out: the list is a
 * decision, and `*` is the absence of one. There is a test asserting both the
 * absence of `*` and the absence of `description`.
 *
 * The explain route reads one description for one job, deliberately and
 * separately. That is the only path that touches it.
 */
export const JOB_COLUMNS = Object.freeze([
  'id',
  'job_id',
  'source',
  'source_id',
  'title',
  'company',
  'location',
  'url',
  'category',
  'job_type',
  'remote',
  'tags',
  'keywords',
  'keyword_terms',
  'requirements',
  'salary_min',
  'salary_max',
  'salary_currency',
  'description_quality',
  'dedupe_hash',
  'posted_at',
  'ingested_at',
  'last_seen_at',
]);

/**
 * The sources the table's own CHECK constraint allows.
 *
 * THREE PLACES HOLD THIS LIST and they drift silently: the constraint in
 * supabase/migrations/003_ats_source.sql, the adapter registry in
 * server/jobs/adapters/index.js, and this set. Only the last one is on the
 * read path, so a source missing from here is not an error — normalizeSources
 * drops it and the caller gets the UNFILTERED pool back, which looks like a
 * working filter that matches everything. 'ats' was missing for exactly that
 * reason. A test below asserts this set against ADAPTERS.
 */
const KNOWN_SOURCES = new Set(['adzuna', 'remotive', 'ats', 'wellfound', 'cache']);

/**
 * Escape the characters that are wildcards inside a SQL LIKE/ILIKE pattern.
 *
 * ═══ WHY THIS IS NOT OPTIONAL ═══
 *
 * The location and title filters are free text typed by a user and pasted
 * straight into an `ilike` pattern. In LIKE, `%` matches any run of
 * characters and `_` matches exactly one. A user who types `%` into the
 * location box is not searching for a literal percent sign — they are asking
 * for `%%%`, which matches every row in the pool, and the "filtered" list they
 * get back is the unfiltered one. A user who types `_` gets an
 * almost-but-not-quite-right list, which is worse, because nothing looks
 * wrong.
 *
 * Backslash is escaped first-class rather than by ordering, because a single
 * pass with one character class cannot double-escape: each matched character
 * is replaced once, and the backslash it emits is not re-scanned.
 *
 * @param {unknown} value Free text; null/undefined become ''.
 * @returns {string} The same text with `\`, `%` and `_` backslash-escaped.
 */
export function escapeLike(value) {
  return String(value ?? '').replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Clamp a requested row count into [1, MAX_LIMIT]. Junk becomes the default.
 * @param {unknown} raw
 * @returns {number}
 */
function normalizeLimit(raw) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

/**
 * Tri-state remote filter. Anything that is not a recognisable true or false
 * means "do not filter", which is what an absent or garbled value should do.
 * @param {unknown} raw
 * @returns {true|false|null} null means no filter.
 */
function normalizeRemote(raw) {
  if (raw === true || raw === 'true' || raw === '1' || raw === 1) return true;
  if (raw === false || raw === 'false' || raw === '0' || raw === 0) return false;
  return null;
}

/**
 * The `since` floor as an ISO string. Accepts an ISO date, a millisecond
 * number, or nothing; an unparseable value falls back to the default window
 * rather than producing an invalid SQL literal.
 * @param {unknown} raw
 * @returns {string} ISO 8601.
 */
function normalizeSince(raw) {
  if (raw !== undefined && raw !== null && raw !== '') {
    const parsed = new Date(typeof raw === 'number' ? raw : String(raw));
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  const floor = Date.now() - DEFAULT_SINCE_DAYS * 24 * 60 * 60 * 1000;
  return new Date(floor).toISOString();
}

/**
 * Comma-separated source list, filtered to the ones the table can hold.
 *
 * Unknown ids are dropped rather than passed through: the column has a CHECK
 * constraint, so a typo would otherwise become a database error on a filter
 * the user can retype for themselves.
 *
 * @param {unknown} raw Array or comma-separated string.
 * @returns {string[]} Deduplicated, lowercased, known ids only.
 */
function normalizeSources(raw) {
  if (raw === undefined || raw === null || raw === '') return [];
  const list = Array.isArray(raw) ? raw : String(raw).split(',');
  return [...new Set(list.map((s) => String(s).trim().toLowerCase()).filter((s) => KNOWN_SOURCES.has(s)))];
}

/**
 * Encode a keyset cursor.
 *
 * Opaque on purpose (base64 of a two-field object): the client should not be
 * building these by hand, because the pair has to match the ORDER BY exactly
 * or the page boundary silently drops or repeats rows.
 *
 * Total, like its decoder: a missing or non-object position encodes a cursor
 * with no id, which {@link decodeCursor} then rejects, so a caller that built
 * its arguments badly gets an unfiltered first page rather than a throw out of
 * the middle of a pool read.
 *
 * @param {{postedAt: string|null, id: string}} position
 * @returns {string}
 */
export function encodeCursor(position) {
  const p = position && typeof position === 'object' ? position : {};
  return Buffer.from(JSON.stringify({ p: p.postedAt ?? null, i: p.id }), 'utf8')
    .toString('base64url');
}

/**
 * Decode a keyset cursor. Total: any junk yields null and the query simply
 * starts from the beginning, which is the right failure for a value that
 * reaches us from a URL.
 *
 * @param {unknown} raw
 * @returns {{postedAt: string|null, id: string}|null}
 */
export function decodeCursor(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed.i !== 'string' || !parsed.i) return null;
    return { postedAt: typeof parsed.p === 'string' ? parsed.p : null, id: parsed.i };
  } catch {
    return null;
  }
}

/**
 * Map one `job_listings` row to the shape the client sees.
 *
 * snake_case in the database, camelCase on the wire. The mapping is explicit
 * rather than a generic key transform so that adding a column to the table
 * does not silently add it to the API — a new column is a decision about what
 * users can see, and it should read like one.
 *
 * `description` is absent because it was never selected. See JOB_COLUMNS.
 *
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
export function toClientJob(row) {
  const r = row || {};
  return {
    id: r.id,
    jobId: r.job_id,
    source: r.source,
    sourceId: r.source_id,
    title: r.title,
    company: r.company ?? null,
    location: r.location ?? null,
    url: r.url,
    category: r.category ?? null,
    jobType: r.job_type ?? null,
    isRemote: r.remote === true,
    tags: Array.isArray(r.tags) ? r.tags : [],
    keywords: Array.isArray(r.keywords) ? r.keywords : [],
    keywordTerms: Array.isArray(r.keyword_terms) ? r.keyword_terms : [],
    requirements: Array.isArray(r.requirements) ? r.requirements : [],
    salaryMin: r.salary_min ?? null,
    salaryMax: r.salary_max ?? null,
    salaryCurrency: r.salary_currency ?? null,
    descriptionQuality: r.description_quality || 'full',
    dedupeHash: r.dedupe_hash ?? null,
    postedAt: r.posted_at ?? null,
    ingestedAt: r.ingested_at ?? null,
    lastSeenAt: r.last_seen_at ?? null,
  };
}

/**
 * Present a client-shaped job to the matcher.
 *
 * src/matching/ reads database column names — `keyword_terms` and
 * `description_quality` — because it was written against rows. Handing it a
 * camelCase job does not fail; it silently loses the snippet-confidence
 * discount, because `description_quality` reads as undefined and every job
 * looks like it has a full description. That is exactly the class of bug this
 * adapter exists to prevent, so it is one named function rather than a
 * sprinkling of aliases on the wire object.
 *
 * @param {Record<string, unknown>} job A job from {@link toClientJob}.
 * @returns {Record<string, unknown>} The view src/matching/ expects.
 */
export function toMatcherJob(job) {
  const j = job || {};
  return {
    title: j.title,
    keywords: j.keywords,
    keyword_terms: j.keywordTerms,
    description_quality: j.descriptionQuality,
  };
}

/**
 * Read a page of the shared job pool.
 *
 * Every filter is optional and every filter is total: a junk limit, an
 * unparseable date, an unknown source, a cursor from another schema version
 * and a location full of LIKE metacharacters all produce a valid query. The
 * function throws only when the database itself refuses.
 *
 * @param {object} supabase A Supabase client (or a stub with the same builder
 *   surface). Passed in, never imported — see the file header.
 * @param {object} [filters]
 * @param {number|string} [filters.limit] Rows, default 200, capped at 500.
 * @param {string} [filters.cursor] Opaque keyset cursor from a previous page.
 * @param {'true'|'false'|'any'|boolean} [filters.remote] Tri-state.
 * @param {string} [filters.location] Free text, matched with ilike.
 * @param {string} [filters.source] Comma-separated source ids.
 * @param {string} [filters.q] Free text, matched against the title with ilike.
 * @param {string|number} [filters.since] Floor on posted_at; default 30 days.
 * @returns {Promise<{jobs: object[], nextCursor: string|null}>}
 */
export async function fetchJobPool(supabase, filters = {}) {
  const f = filters && typeof filters === 'object' ? filters : {};
  const limit = normalizeLimit(f.limit);
  const remote = normalizeRemote(f.remote);
  const sources = normalizeSources(f.source);
  const since = normalizeSince(f.since);
  const cursor = decodeCursor(f.cursor);

  let query = supabase
    .from('job_listings')
    .select(JOB_COLUMNS.join(','))
    .gte('posted_at', since);

  if (remote !== null) query = query.eq('remote', remote);
  if (sources.length === 1) query = query.eq('source', sources[0]);
  else if (sources.length > 1) query = query.in('source', sources);

  const location = String(f.location ?? '').trim();
  if (location) query = query.ilike('location', `%${escapeLike(location)}%`);

  const term = String(f.q ?? '').trim();
  if (term) query = query.ilike('title', `%${escapeLike(term)}%`);

  // Keyset, not offset. `posted_at desc, id desc` is the total order, so the
  // boundary is "strictly older, or the same instant with a smaller id" — the
  // id tiebreak is what stops a batch of listings sharing one posted_at from
  // being partly skipped and partly repeated across pages.
  if (cursor) {
    if (cursor.postedAt) {
      query = query.or(
        `posted_at.lt.${cursor.postedAt},and(posted_at.eq.${cursor.postedAt},id.lt.${cursor.id})`
      );
    } else {
      query = query.lt('id', cursor.id);
    }
  }

  query = query
    .order('posted_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  const { data, error } = await query;
  if (error) {
    const err = new Error(error.message || 'Job pool query failed');
    err.cause = error;
    throw err;
  }

  const rows = Array.isArray(data) ? data : [];
  const jobs = rows.map(toClientJob);

  // A full page implies there may be another. A short page is the end, and
  // returning a cursor there would cost the client one guaranteed-empty
  // round trip on every list they scroll to the bottom of.
  const last = rows.length === limit ? rows[rows.length - 1] : null;
  const nextCursor = last ? encodeCursor({ postedAt: last.posted_at ?? null, id: last.id }) : null;

  return { jobs, nextCursor };
}
