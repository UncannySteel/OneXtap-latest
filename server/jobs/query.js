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
 * Columns that exist only once migration 004 has been applied.
 *
 * ═══ WHY THIS IS NOT JUST APPENDED TO JOB_COLUMNS ═══
 *
 * A migration in this project is applied BY HAND in the Supabase SQL editor —
 * there is no migration tool and no history table — so there is always a
 * window where the code is deployed and the SQL is not. Selecting a column
 * that does not exist yet is not a degraded read, it is a hard PostgREST error
 * on EVERY pool query, which takes ranking down completely. That precise
 * failure has already happened here once: a missing `job_listings` surfaced as
 * a bare 502 and cost a debugging session (see supabase/migrations/README.md).
 *
 * So the parts are requested optionally and their absence is learned once,
 * from the database, at runtime.
 */
const LOCATION_PART_COLUMNS = Object.freeze(['location_city', 'location_region', 'location_country']);

/**
 * Tri-state: null = not yet known, true = present, false = migration 004 has
 * not run. Cached per process because the answer changes at most once in a
 * deployment's life, and re-probing would double every pool read.
 */
let locationPartsPresent = null;

/** The projection to ask for, given what we know about the schema. */
function selectColumns() {
  return locationPartsPresent === false
    ? JOB_COLUMNS.join(',')
    : [...JOB_COLUMNS, ...LOCATION_PART_COLUMNS].join(',');
}

/**
 * Does this error mean "migration 004 has not been applied"?
 *
 * Postgres 42703 is undefined_column. The message is also matched because
 * PostgREST does not always forward the code, and the column name is required
 * in the text so an unrelated undefined column still throws honestly.
 *
 * @param {object} error A Supabase error.
 * @returns {boolean}
 */
function isMissingLocationParts(error) {
  const text = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return LOCATION_PART_COLUMNS.some((c) => text.includes(c))
    && (text.includes('42703') || text.includes('does not exist') || text.includes('could not find'));
}

/** Test seam: forget what was learned about the schema. */
export function resetLocationPartsCache() {
  locationPartsPresent = null;
}

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
const KNOWN_SOURCES = new Set([
  'adzuna', 'remotive', 'ats', 'cache',
  'arbeitnow', 'remoteok', 'jobicy', 'himalayas',
]);

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
 * How many resume terms reach the relevance filter.
 *
 * Every term is another `or` branch in a PostgREST query string, and that
 * string travels in the URL. A resume with ninety skills would build a filter
 * long enough to be rejected by the gateway rather than the database, which
 * fails as a 400 with no useful text. Twelve is comfortably inside every limit
 * in the path and is already more signal than the ranker needs — the terms are
 * weight-ordered, so the ones dropped are the weakest.
 */
export const MAX_RELEVANCE_TERMS = 12;

/**
 * Strip a resume term down to something safe to interpolate into a filter.
 *
 * ═══ WHY THIS IS NOT OPTIONAL ═══
 *
 * These strings come from a parsed resume, which is a user-supplied file. They
 * are interpolated into PostgREST's `or=(...)` grammar, where `,` separates
 * branches, `.` separates operator parts, `(` `)` nest, and `{` `}` delimit an
 * array literal. A skill listed as "c++, rust" or "node.js (expert)" would not
 * error — it would silently change the SHAPE of the query and filter on
 * something nobody asked for. That is the same failure mode as the unescaped
 * `%` that escapeLike exists to prevent, one grammar along.
 *
 * Allowlist, not denylist: anything outside [a-z0-9 +#.-] is dropped. Real
 * skill terms (`c++`, `node.js`, `ci/cd` -> `cicd`) survive that intact.
 *
 * @param {unknown} value A single term.
 * @returns {string} The safe form, possibly empty — callers must drop empties.
 */
export function sanitizeTerm(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 +#.-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

/**
 * Resume terms to a clean, bounded, de-duplicated list.
 *
 * @param {unknown} raw Array of strings, or a comma-separated string.
 * @returns {string[]} At most MAX_RELEVANCE_TERMS safe terms.
 */
export function normalizeTerms(raw) {
  if (raw === undefined || raw === null || raw === '') return [];
  const list = Array.isArray(raw) ? raw : String(raw).split(',');
  const out = [];
  for (const item of list) {
    const term = sanitizeTerm(item);
    if (!term || out.includes(term)) continue;
    out.push(term);
    if (out.length >= MAX_RELEVANCE_TERMS) break;
  }
  return out;
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
    locationCity: r.location_city ?? null,
    locationRegion: r.location_region ?? null,
    locationCountry: r.location_country ?? null,
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
    // `id` and `posted_at` are here for prefilterJobs' SORT, not its scoring.
    // Its tiebreak is "score, then newest, then id", and with these absent
    // every comparison after the score collapsed to `'' vs ''` — so ties fell
    // through to an ascending-UUID ordering that looks deliberate and is not.
    // The scorer ignores both fields; only the comparator reads them.
    id: j.id,
    posted_at: j.postedAt,
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
/**
 * Apply the location filter, structured when the caller gave one.
 *
 * TWO SHAPES, deliberately, because they answer different questions:
 *
 *   {locationCountry: 'United States'}  the typeahead. The user PICKED a value
 *                                       the API offered, so it exists and an
 *                                       exact (case-insensitive) match is
 *                                       right — and hits the lower() indexes
 *                                       from migration 004.
 *   {location: 'new york'}              free text. Still substring, still
 *                                       against the display column, because
 *                                       something typed by hand may not be a
 *                                       value we hold.
 *
 * The structured path wins when both are present. Rows ingested before
 * migration 004 have null parts and simply do not match a structured filter —
 * they are reachable by free text until the cron re-sees them, which is the
 * documented trade in the migration rather than a silent gap.
 *
 * @param {object} query A built Supabase query.
 * @param {object} f The caller's filters.
 * @returns {object} The query with at most one location clause applied.
 */
function applyLocation(query, f) {
  const city = String(f.locationCity ?? '').trim();
  const region = String(f.locationRegion ?? '').trim();
  const country = String(f.locationCountry ?? '').trim();

  if (city || region || country) {
    let q = query;
    // ilike with no wildcard is exact, case-insensitive, and PostgREST sends
    // it as a pattern the lower() index can serve.
    if (city) q = q.ilike('location_city', escapeLike(city));
    if (region) q = q.ilike('location_region', escapeLike(region));
    if (country) q = q.ilike('location_country', escapeLike(country));
    return q;
  }

  const free = String(f.location ?? '').trim();
  return free ? query.ilike('location', `%${escapeLike(free)}%`) : query;
}

/**
 * Run one pool query and hand back rows, turning a Supabase error into a throw.
 *
 * Shared by the relevance pass and the recency pass so a failure on either
 * reads the same way to the caller. The graph catches this and degrades; what
 * it must never get is an empty array that means "the database said no".
 *
 * @param {object} query A built Supabase query.
 * @param {number} limit Row cap.
 * @returns {Promise<object[]>} Raw rows.
 */
async function runPool(build, limit) {
  const { data, error } = await build().limit(limit);
  if (!error) {
    if (locationPartsPresent === null) locationPartsPresent = true;
    return Array.isArray(data) ? data : [];
  }

  // Learn, then retry once WITHOUT the optional columns. Exactly one retry:
  // the flag is now false, so the rebuilt query cannot ask for them again and
  // this cannot recurse.
  if (locationPartsPresent !== false && isMissingLocationParts(error)) {
    locationPartsPresent = false;
    const retry = await build().limit(limit);
    if (!retry.error) return Array.isArray(retry.data) ? retry.data : [];
    const err = new Error(retry.error.message || 'Job pool query failed');
    err.cause = retry.error;
    throw err;
  }

  const err = new Error(error.message || 'Job pool query failed');
  err.cause = error;
  throw err;
}

export async function fetchJobPool(supabase, filters = {}) {
  const f = filters && typeof filters === 'object' ? filters : {};
  const limit = normalizeLimit(f.limit);
  const remote = normalizeRemote(f.remote);
  const sources = normalizeSources(f.source);
  const since = normalizeSince(f.since);
  const cursor = decodeCursor(f.cursor);

  const terms = normalizeTerms(f.terms);
  const term = String(f.q ?? '').trim();

  /** Every filter except relevance, applied identically to both passes. */
  const baseQuery = () => {
    let q = supabase
      .from('job_listings')
      .select(selectColumns())
      .gte('posted_at', since);

    if (remote !== null) q = q.eq('remote', remote);
    if (sources.length === 1) q = q.eq('source', sources[0]);
    else if (sources.length > 1) q = q.in('source', sources);
    q = applyLocation(q, f);
    if (term) q = q.ilike('title', `%${escapeLike(term)}%`);
    return q;
  };

  // ═══ THE RELEVANCE PASS ═══
  //
  // Without this the pool is the newest `limit` rows and nothing else, so
  // relevance plays NO part in deciding what the ranker ever sees. Measured on
  // the live table: the 200 rows a rank actually read spanned a single day of
  // ingest, and three rows in the newest thousand had a tech-ish title. The
  // ranker was scoring a sample chosen entirely by clock.
  //
  // Two conditions, OR'd, because neither is sufficient alone:
  //   keyword_terms.ov  — hits idx_job_listings_keyword_terms (GIN), so this
  //                       is an index scan, not a table walk.
  //   title.ilike       — extraction runs on Adzuna's ~200-char snippet and
  //                       yields boilerplate (`pay`, `earn`, `annually` are
  //                       all real entries in the live pool), so keyword_terms
  //                       alone cannot be trusted yet. The title always says
  //                       what the job is.
  //
  // Cursors are ignored on this path and nextCursor comes back null: a
  // relevance read is a ranking input, not a list a user scrolls, and a keyset
  // cursor over a two-pass union would not survive its own next page.
  if (terms.length) {
    const branches = [
      `keyword_terms.ov.{${terms.join(',')}}`,
      ...terms.map((t) => `title.ilike.*${t}*`),
    ];
    const relevant = await runPool(
      () => baseQuery().or(branches.join(',')).order('posted_at', { ascending: false }),
      limit
    );

    // Top up with recency when relevance alone underfills. A short relevant
    // list is the honest answer to "we hold little for this resume", but the
    // graph still reformulates and re-reads, and handing it nothing to widen
    // from turns a thin pool into an empty page.
    if (relevant.length >= limit) return { jobs: relevant.map(toClientJob), nextCursor: null };

    const seen = new Set(relevant.map((r) => r.id));
    const filler = await runPool(() => baseQuery().order('posted_at', { ascending: false }), limit);
    const topped = [...relevant];
    for (const row of filler) {
      if (topped.length >= limit) break;
      if (!seen.has(row.id)) topped.push(row);
    }
    return { jobs: topped.map(toClientJob), nextCursor: null };
  }

  // A builder, not a query: runPool may need to rebuild it once to retry
  // without the optional location columns. See LOCATION_PART_COLUMNS.
  const buildRecency = () => {
    let query = baseQuery();

    // Keyset, not offset. `posted_at desc, id desc` is the total order, so the
    // boundary is "strictly older, or the same instant with a smaller id" —
    // the id tiebreak is what stops a batch of listings sharing one posted_at
    // from being partly skipped and partly repeated across pages.
    if (cursor) {
      if (cursor.postedAt) {
        query = query.or(
          `posted_at.lt.${cursor.postedAt},and(posted_at.eq.${cursor.postedAt},id.lt.${cursor.id})`
        );
      } else {
        query = query.lt('id', cursor.id);
      }
    }

    return query
      .order('posted_at', { ascending: false })
      .order('id', { ascending: false });
  };

  const rows = await runPool(buildRecency, limit);
  const jobs = rows.map(toClientJob);

  // A full page implies there may be another. A short page is the end, and
  // returning a cursor there would cost the client one guaranteed-empty
  // round trip on every list they scroll to the bottom of.
  const last = rows.length === limit ? rows[rows.length - 1] : null;
  const nextCursor = last ? encodeCursor({ postedAt: last.posted_at ?? null, id: last.id }) : null;

  return { jobs, nextCursor };
}
