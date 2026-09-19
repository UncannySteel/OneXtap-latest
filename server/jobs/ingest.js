/**
 * Ingest orchestrator — walks the adapter cascade, writes to public.job_listings.
 *
 * Called from one place: the cron-guarded /api/jobs/ingest route. Its job is to
 * get as many fresh listings into the pool as it can inside a serverless
 * function's lifetime, and to leave behind an honest record of what happened
 * when it could not.
 *
 * ═══ THE BUDGET ═══
 *
 * Vercel Hobby kills a function at 60 seconds with no warning and no chance to
 * flush. So:
 *
 *   INGEST_BUDGET_MS        45s - when we stop starting new work
 *   PER_ADAPTER_TIMEOUT_MS  10s - the longest a single in-flight request runs
 *                                 (45 + 10 = 55s worst case, under the ceiling;
 *                                 defined in adapters/httpJson.js, where the
 *                                 timer that enforces it lives)
 *   MAX_PAGES_PER_RUN        6  - ~300 Adzuna listings/run; also the free tier's
 *                                 daily call budget divided by a month of runs
 *
 * The budget is checked BETWEEN PAGES and never mid-write. A run that ends
 * because it ran out of time must end on a page boundary with the cursor
 * pointing at the next unread page — not halfway through an upsert with a
 * cursor that has already moved.
 *
 * ═══ THE CURSOR ═══
 *
 * job_ingest_state.next_page is written IMMEDIATELY after each page's upsert,
 * not once at the end. If the platform kills us on page 4, pages 1-3 are
 * committed and the cursor says 4. That is the only arrangement where a hard
 * kill is not data loss.
 *
 * It wraps back to 1 when the source says hasMore: false or hands back an
 * empty page, which turns the daily job into a rolling refresh rather than a
 * crawler that walks off the end of the result set and re-reads page 1 forever.
 *
 * ═══ WHAT IT NEVER DOES ═══
 *
 * Throw. Every Supabase error and every adapter failure is caught and recorded
 * into perSource[].error. The caller is a cron endpoint; a rejected promise
 * there is a 500 with no detail about which of four sources broke.
 */
import { supabaseAdmin, formatSupabaseError } from '../supabase.js';
import { log } from '../logger.js';
import { ADAPTERS, getAdapter } from './adapters/index.js';
import { normalizeListing } from './normalizeListing.js';
import { SEARCH_TERMS, cursorToSearch } from './searchTerms.js';
import { startTrace, flushTracing, SpanType } from '../observability/opik.js';

const jobsLog = log.child('jobs');

export const INGEST_BUDGET_MS = 45_000;
export const MAX_PAGES_PER_RUN = 6;

/**
 * How deep into each occupation a full sweep goes, for search-capable sources.
 *
 * One page (50 Adzuna listings) per occupation per sweep. With 33 terms and
 * MAX_PAGES_PER_RUN of 6 that is a complete sweep every ~6 daily runs, so
 * every occupation's NEWEST page is re-read roughly weekly and the 30-day
 * retention window holds several sweeps' worth.
 *
 * Depth trades freshness for reach and there is no setting that buys both:
 * page 1 is the newest listings, so going deeper spends the same fixed daily
 * call budget on older ones and slows the return to page 1. Raise it only
 * alongside MAX_PAGES_PER_RUN, which is itself capped by Adzuna's free tier.
 */
export const SWEEP_PAGES_PER_TERM = Math.max(
  1,
  Number.parseInt(process.env.INGEST_SWEEP_PAGES || '', 10) || 1
);

/**
 * Advance a search-capable source's cursor, wrapping at the end of the sweep.
 *
 * The cursor is term-major (see cursorToSearch), so +1 is the next occupation
 * and the sweep is `SEARCH_TERMS.length * SWEEP_PAGES_PER_TERM` values long.
 * Returning 1 means the sweep is complete and the next run starts over at the
 * first occupation's newest page — which is the refresh, not a failure.
 *
 * @param {number} cursor Current 1-based cursor.
 * @returns {number} The next cursor, or 1 at the end of a sweep.
 */
export function nextSweepCursor(cursor) {
  const sweepLength = SEARCH_TERMS.length * SWEEP_PAGES_PER_TERM;
  const next = Math.max(Number(cursor) || 1, 1) + 1;
  return next > sweepLength ? 1 : next;
}

/** PostgREST rejects very large payloads; 100 rows is comfortably inside it. */
const UPSERT_CHUNK = 100;
/** A listing not seen by any source for a month is stale; the apply link is probably dead. */
const RETENTION_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** last_error is for a human reading a dashboard, not for a stack trace. */
const MAX_ERROR_LEN = 300;
/** What formatSupabaseError() joins message / details / hint with. */
const SUPABASE_PART_SEPARATOR = ' — ';

/**
 * Collapse any error value into one short single-line string fit for storage:
 * first line only, whitespace collapsed, repeated segments dropped, capped at
 * MAX_ERROR_LEN.
 *
 * WHY FIRST LINE ONLY: Node's fetch errors arrive as a multi-line
 * "TypeError: fetch failed / Caused by: ... / at GetAddrInfoReqWrap..." block.
 * Stored whole, that fills last_error with a stack trace nobody reads and
 * renders as an unusable wall of text in the ingest API response. The first
 * line carries the diagnosis; the full error is already in the log line next
 * to it.
 *
 * WHY DE-DUPLICATE SEGMENTS: on a network failure postgrest-js builds its
 * error object as `{ message: 'TypeError: fetch failed', details: <the stack> }`
 * — and the stack's FIRST LINE is that same string. formatSupabaseError() joins
 * message and details, so taking the first line produced
 * "TypeError: fetch failed — TypeError: fetch failed", which reached both the
 * API response and job_ingest_state.last_error. Keeping only the first
 * occurrence of each segment collapses that back to one diagnosis; a genuine
 * message/details/hint trio has three distinct segments and survives whole.
 *
 * Exported for test/jobs/ingest.test.js.
 *
 * @param {unknown} value An Error message, a formatSupabaseError() string, or
 *   anything else stringifiable.
 * @returns {string|null} The collapsed string, or null if nothing survived.
 */
export function shortError(value) {
  const firstLine = String(value ?? '')
    .split('\n')[0]
    .replace(/\s+/g, ' ')
    .trim();

  const seen = new Set();
  const segments = [];
  for (const part of firstLine.split(SUPABASE_PART_SEPARATOR)) {
    const segment = part.trim();
    if (!segment || seen.has(segment)) continue;
    seen.add(segment);
    segments.push(segment);
  }

  return segments.join(SUPABASE_PART_SEPARATOR).slice(0, MAX_ERROR_LEN) || null;
}

/**
 * Reads the stored cursor. A missing row, or a missing TABLE, both mean
 * "start at page 1" — the upsert later in the same pass is what reports the
 * table problem properly, so this stays quiet.
 *
 * @param {string} sourceId An adapter id.
 * @returns {Promise<number>} The next page to fetch; 1 on any doubt.
 */
async function readCursor(sourceId) {
  try {
    const { data, error } = await supabaseAdmin
      .from('job_ingest_state')
      .select('next_page')
      .eq('source', sourceId)
      .maybeSingle();
    if (error) return 1;
    const page = Number(data?.next_page);
    return Number.isFinite(page) && page > 0 ? page : 1;
  } catch {
    return 1;
  }
}

/**
 * Writes one adapter's row in job_ingest_state.
 *
 * Never throws; a cursor we could not persist is a slower next run, not a
 * failure.
 *
 * @param {string} sourceId An adapter id; the table's primary key.
 * @param {object} patch Columns to write alongside source + updated_at.
 * @returns {Promise<boolean>} Whether the write landed.
 */
async function persistState(sourceId, patch) {
  try {
    const { error } = await supabaseAdmin
      .from('job_ingest_state')
      .upsert({ source: sourceId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'source' });
    if (error) {
      jobsLog.warn('cursor persist failed', { source: sourceId, reason: shortError(formatSupabaseError(error)) });
      return false;
    }
    return true;
  } catch (err) {
    // `errName`, not `name`: logger.js redacts a bare `name` key as PII.
    jobsLog.warn('cursor persist threw', { source: sourceId, errName: err?.name });
    return false;
  }
}

/**
 * Upserts one page of rows, in chunks, on the (source, source_id) conflict
 * target.
 *
 * @param {object[]} rows normalizeListing() output, already stamped with
 *   last_seen_at.
 * @returns {Promise<{written: number, error: string|null}>}
 *   `written` counts rows the upsert affected — inserts AND refreshes of rows
 *   we already had. PostgREST does not distinguish the two, and for a rolling
 *   refresh the distinction matters less than "the page landed". Stops at the
 *   first failed chunk and reports what had been written by then.
 */
async function upsertRows(rows) {
  let written = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    try {
      const { data, error } = await supabaseAdmin
        .from('job_listings')
        .upsert(chunk, { onConflict: 'source,source_id', ignoreDuplicates: false })
        // select the narrowest possible column: we want the count, not the rows
        .select('job_id');
      if (error) return { written, error: shortError(formatSupabaseError(error)) };
      written += Array.isArray(data) ? data.length : chunk.length;
    } catch (err) {
      return { written, error: shortError(err?.message || err) };
    }
  }
  return { written, error: null };
}

/**
 * Deletes listings no source has confirmed for RETENTION_DAYS.
 *
 * Uses last_seen_at, not posted_at: a genuinely old posting that the provider
 * still returns is still open, and dropping it would hide a live job.
 *
 * @returns {Promise<{deleted: number, error: string|null}>} Never throws.
 */
async function runRetention() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * MS_PER_DAY).toISOString();
  try {
    const { data, error } = await supabaseAdmin
      .from('job_listings')
      .delete()
      .lt('last_seen_at', cutoff)
      .select('id');
    if (error) return { deleted: 0, error: shortError(formatSupabaseError(error)) };
    return { deleted: Array.isArray(data) ? data.length : 0, error: null };
  } catch (err) {
    return { deleted: 0, error: shortError(err?.message || err) };
  }
}

/**
 * Run the cascade: fetch, normalize, upsert, advance the cursor, then sweep
 * stale rows. Never throws — see the header.
 *
 * @param {object}   [options] Accepts null as well as undefined; this is called
 *   straight from a route handler with whatever the query string produced.
 * @param {string[]} [options.sources]  subset of adapter ids; default = all, in
 *   cascade order. Unknown ids are dropped, not rejected.
 * @param {number}   [options.budgetMs] override INGEST_BUDGET_MS
 * @param {number}   [options.maxPages] override MAX_PAGES_PER_RUN
 * @returns {Promise<{ok: boolean, perSource: object[], totalInserted: number, durationMs: number, deleted: number, retentionError: string|null}>}
 */
export async function runIngest(options = {}) {
  const { sources, budgetMs, maxPages } = options || {};

  const startedAt = Date.now();
  const budget = Number.isFinite(Number(budgetMs)) && Number(budgetMs) > 0
    ? Number(budgetMs)
    : INGEST_BUDGET_MS;
  const pageCap = Number.isFinite(Number(maxPages)) && Number(maxPages) > 0
    ? Number(maxPages)
    : MAX_PAGES_PER_RUN;

  const selected = Array.isArray(sources) && sources.length
    ? sources.map((id) => getAdapter(String(id).trim())).filter(Boolean)
    : ADAPTERS;

  // One signal for the whole run. An adapter that hangs past the budget is cut
  // off rather than being allowed to eat the next adapter's share.
  const runController = new AbortController();
  const budgetTimer = setTimeout(() => runController.abort(), budget);
  budgetTimer.unref?.();

  const perSource = [];
  let totalInserted = 0;

  const elapsed = () => Date.now() - startedAt;

  // Tracing is entirely optional. startTrace() returns a working handle even
  // when OPIK_API_KEY is unset, so nothing below needs an `if (trace)` and the
  // no-key path executes the same statements it always did.
  const trace = startTrace({
    name: 'job_ingest',
    input: { sources: selected.map((a) => a.id), budgetMs: budget, maxPages: pageCap },
    metadata: { requestedSources: Array.isArray(sources) ? sources.length : 0, adapters: selected.length },
    tags: ['ingest', 'jobs'],
  });

  try {
    try {
      for (const adapter of selected) {
        const t0 = Date.now();
        const entry = {
          id: adapter.id,
          enabled: false,
          fetched: 0,
          inserted: 0,
          // One of the adapter reasons (timeout|quota|bad_key|parse|network|
          // disabled), 'budget' when this run ran out of time, or a 'db: …'
          // string when Supabase rejected the write.
          error: null,
          ms: 0,
        };
        perSource.push(entry);

        // Declared out here so the span's finally can report it on every exit
        // path — including the two `continue`s below.
        let pagesThisRun = 0;

        // One span per adapter. The per-source `ms` is the point of the whole
        // exercise: when a run starts brushing the 45s budget, this is what
        // names the source responsible instead of leaving four suspects.
        const sourceSpan = trace.span({
          name: `source_fetch:${adapter.id}`,
          type: SpanType.Tool,
          input: { source: adapter.id, supportsPaging: !!adapter.supportsPaging, pageCap },
        });

        try {
          try {
            entry.enabled = !!adapter.enabled();
          } catch {
            entry.enabled = false;
          }

          if (!entry.enabled) {
            entry.error = 'disabled';
            entry.ms = Date.now() - t0;
            await persistState(adapter.id, {
              last_run_at: new Date().toISOString(),
              last_status: 'disabled',
              last_error: 'disabled',
            });
            continue;
          }

          if (elapsed() >= budget) {
            entry.error = 'budget';
            entry.ms = Date.now() - t0;
            continue;
          }

          let page = await readCursor(adapter.id);

          while (pagesThisRun < pageCap) {
            // BETWEEN pages, never mid-write. Crossing the budget here means the
            // previous page is committed and its cursor is already stored.
            if (elapsed() >= budget) {
              entry.error = entry.error || 'budget';
              break;
            }

            // Nested so a slow page inside a slow source is visible, rather
            // than one opaque 40-second source_fetch span.
            const pageStartedAt = Date.now();
            const pageRequested = page; // `page` is reassigned below
            const pageSpan = sourceSpan.span({
              name: 'page_fetch',
              type: SpanType.Tool,
              input: { source: adapter.id, page: pageRequested },
            });
            let pageFetched = 0;
            let pageWritten = 0;

            // Search-capable sources get one occupation from the taxonomy per
            // cursor value; everything else gets its plain feed. Skipping this
            // for a whole year is what filled the pool with trucking: Adzuna
            // with no `what` and no `category` is not "all jobs", it is
            // whatever that provider promotes. See jobs/searchTerms.js.
            const search = adapter.supportsSearch ? cursorToSearch(page) : null;

            try {
              const result = await adapter.fetch({
                // A searching source pages WITHIN its current term, so it gets
                // the decoded sub-page; everything else still gets the raw
                // cursor it has always been handed.
                page: search ? search.page : page,
                query: search?.term,
                category: search?.adzunaCategory,
                signal: runController.signal,
              });
              const items = Array.isArray(result?.items) ? result.items : [];
              entry.fetched += items.length;
              pageFetched = items.length;

              if (result?.error) {
                // A budget abort surfaces from the adapter as 'timeout'. Relabel it:
                // blaming the provider for our own clock would send the next person
                // to the wrong dashboard.
                entry.error = runController.signal.aborted && result.error === 'timeout'
                  ? 'budget'
                  : result.error;
                break;
              }

              if (!items.length) {
                // Empty page = we have walked off the end. Wrap so tomorrow's run
                // starts fresh instead of paging into nothing forever.
                //
                // This has to be persisted HERE. There is no upsert on this path (no
                // rows to write) and no error (an empty page is not a failure), so
                // neither the per-page write below nor the final error write would
                // ever fire — and the cursor would stay parked past the end of the
                // result set, fetching nothing, every day, silently.
                // For a searching source an empty page means THIS OCCUPATION
                // ran out, not the source — the cursor is term-major, so the
                // next value is a different occupation and resetting to 1
                // would throw away the whole sweep because one narrow term
                // (say 'paralegal') had fewer than 50 listings.
                page = search ? nextSweepCursor(page) : 1;
                await persistState(adapter.id, {
                  next_page: page,
                  last_run_at: new Date().toISOString(),
                  last_status: 'ok',
                  last_error: null,
                  inserted_count: entry.inserted,
                });
                break;
              }

              const rows = [];
              const seenAt = new Date().toISOString();
              for (const item of items) {
                let listing = null;
                try {
                  listing = adapter.toListing(item);
                } catch {
                  listing = null;
                }
                if (!listing) continue;
                const row = normalizeListing(listing, adapter.id);
                if (!row) continue;
                // last_seen_at is refreshed on every pass — it is what retention
                // reads. ingested_at is deliberately NOT in this payload: PostgREST
                // builds the ON CONFLICT DO UPDATE SET list from the keys present,
                // so leaving it out should preserve the original first-seen time on
                // a re-ingest.
                //
                // TODO(empirical): confirm with a two-run test once the tables exist
                // — run ingest twice against the same source and assert that
                // ingested_at is unchanged while last_seen_at moved. Until that is
                // done this is reasoned behaviour, not verified behaviour.
                row.last_seen_at = seenAt;
                rows.push(row);
              }

              const dbStartedAt = Date.now();
              const chunkCount = Math.ceil(rows.length / UPSERT_CHUNK);
              const dbSpan = pageSpan.span({
                name: 'db_upsert',
                type: SpanType.Tool,
                input: { table: 'job_listings', rows: rows.length, chunks: chunkCount },
              });

              const { written, error: writeError } = await upsertRows(rows);
              entry.inserted += written;
              totalInserted += written;
              pageWritten = written;

              // rows/chunks are repeated on the output so a span reads on its
              // own: the Opik UI shows one side at a time, and "written 0" is
              // only diagnostic next to how many rows were offered.
              dbSpan.update({
                output: {
                  rows: rows.length,
                  chunks: chunkCount,
                  written,
                  error: writeError,
                  ms: Date.now() - dbStartedAt,
                },
              }).end();

              if (writeError) {
                // Already collapsed by upsertRows(); the final persistState() below
                // re-caps it after the 'db: ' prefix pushes it past MAX_ERROR_LEN.
                entry.error = `db: ${writeError}`;
                break;
              }

              pagesThisRun += 1;

              // Cursor persisted immediately after this page's write, before another
              // page is fetched.
              // `hasMore` answers "are there more pages of THIS query". For a
              // searching source that is a statement about one occupation, so
              // it cannot decide the cursor: a term with 30 listings reports
              // hasMore:false on page 1, and honouring that here would wrap the
              // sweep back to the first occupation forever. The sweep's own
              // length is the only thing that ends it.
              const wraps = search
                ? nextSweepCursor(page) === 1
                : (!adapter.supportsPaging || !result.hasMore);
              const nextPage = wraps ? 1 : (search ? nextSweepCursor(page) : page + 1);
              await persistState(adapter.id, {
                next_page: nextPage,
                last_run_at: new Date().toISOString(),
                last_status: 'ok',
                last_error: null,
                inserted_count: entry.inserted,
              });
              page = nextPage;

              if (wraps) break;
            } finally {
              // Every exit from this page is a `break`; the finally is what
              // guarantees the span closes on all of them.
              pageSpan.update({
                output: {
                  page: pageRequested,
                  fetched: pageFetched,
                  written: pageWritten,
                  error: entry.error,
                  ms: Date.now() - pageStartedAt,
                },
              }).end();
            }
          }

          entry.ms = Date.now() - t0;

          // Final status write. The per-page write above never sees the error path.
          if (entry.error) {
            await persistState(adapter.id, {
              next_page: page,
              last_run_at: new Date().toISOString(),
              last_status: 'error',
              last_error: shortError(entry.error),
              inserted_count: entry.inserted,
            });
          }

          jobsLog.info('source complete', {
            source: entry.id,
            enabled: entry.enabled,
            fetched: entry.fetched,
            inserted: entry.inserted,
            pages: pagesThisRun,
            reason: entry.error,
            ms: entry.ms,
          });
        } finally {
          // In a finally because the body has two `continue`s and the span has
          // to be closed on every one of them.
          sourceSpan.update({
            output: {
              enabled: entry.enabled,
              fetched: entry.fetched,
              inserted: entry.inserted,
              pages: pagesThisRun,
              error: entry.error,
              ms: entry.ms,
            },
          }).end();
        }
      }
    } finally {
      clearTimeout(budgetTimer);
    }

    const retentionStartedAt = Date.now();
    const retentionSpan = trace.span({
      name: 'retention',
      type: SpanType.Tool,
      input: { table: 'job_listings', retentionDays: RETENTION_DAYS },
    });
    const retention = await runRetention();
    retentionSpan.update({
      output: {
        deleted: retention.deleted,
        error: retention.error,
        ms: Date.now() - retentionStartedAt,
      },
    }).end();

    // ok means "at least one enabled source finished clean". Zero enabled
    // sources is NOT ok — in production that is a missing key, not a quiet day.
    const ok = perSource.some((s) => s.enabled && !s.error);

    const durationMs = elapsed();

    jobsLog.info('ingest run complete', {
      ok,
      sources: perSource.length,
      totalInserted,
      deleted: retention.deleted,
      durationMs,
    });

    const report = {
      ok,
      perSource,
      totalInserted,
      durationMs,
      deleted: retention.deleted,
      retentionError: retention.error,
    };

    trace.update({
      output: report,
      metadata: {
        sources: perSource.length,
        enabled: perSource.filter((s) => s.enabled).length,
        failed: perSource.filter((s) => s.error).length,
        totalFetched: perSource.reduce((n, s) => n + (s.fetched || 0), 0),
        totalInserted,
        deleted: retention.deleted,
      },
    }).end();

    return report;
  } finally {
    // Must happen before we return, not after. On Vercel the function can be
    // frozen the moment the response is written, and anything still batched in
    // the SDK dies with it. flushTracing() is bounded, so a sick Opik endpoint
    // costs the run at most MAX_FLUSH_MS — and nothing at all when tracing is
    // off, where this is a single env-var check.
    await flushTracing();
  }
}

export default runIngest;
