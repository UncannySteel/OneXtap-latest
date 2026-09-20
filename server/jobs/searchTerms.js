/**
 * The occupation taxonomy ingest searches with.
 *
 * ═══ WHY THIS FILE EXISTS ═══
 *
 * Ingest used to call `adapter.fetch({ page })` and nothing else. Adzuna's
 * search endpoint with no `what` and no `category` is not "everything" — it is
 * whatever that provider happens to surface, and in the US feed that is
 * overwhelmingly long-haul trucking. Measured 2026-09-19 on the live pool:
 * 1,476 Adzuna rows, of which the top extracted keywords were `drivers`,
 * `cdl-a`, `otr`, `truck`, and **three** rows in the newest thousand had a
 * tech-ish title. A résumé for anything else had nothing to match against, so
 * the ranker did the only thing it could and returned the least-bad trucking
 * job.
 *
 * The product ranks jobs against a résumé rather than against a role name, so
 * the pool has to span the occupations résumés are actually written for. This
 * list is that span.
 *
 * ═══ WHY BLUE-COLLAR TERMS ARE STILL HERE ═══
 *
 * The obvious overcorrection is to fill the rotation with software roles and
 * call the trucking problem solved. That would break the users for whom
 * matching already works — the pool's current bias is somebody's good
 * experience. Logistics, healthcare, hospitality, trades and retail keep their
 * slots. The fix is that they stop being ~100% of the pool, not that they
 * leave it.
 *
 * ═══ HOW WIDE, AND WHY NOT WIDER ═══
 *
 * `MAX_PAGES_PER_RUN` is 6 and is sized against Adzuna's free-tier daily call
 * budget (see the header of ingest.js), so one run covers six entries, one
 * page each. A full sweep of this list therefore takes ceil(N / 6) daily runs
 * — with ~30 entries, five days. Adding entries makes the pool broader and the
 * sweep slower; there is no third option without paying Adzuna. Thirty is the
 * point where every common résumé type has a slot and the sweep still fits
 * inside the 30-day retention window several times over.
 *
 * `adzunaCategory` values are Adzuna's own `tag` strings, read from
 * `GET /v1/api/jobs/us/categories` on 2026-09-19 — not guessed. An unknown tag
 * is not an error there, it is a silently empty result set, so these must stay
 * verifiable rather than plausible.
 *
 * Remotive takes no part in this rotation. Its free API returns the same 16
 * jobs for every query — `search`, `category` and `limit` all measurably do
 * nothing (verified 2026-09-19) — so rotating terms at it would spend calls to
 * re-read one fixed page.
 */

/**
 * @typedef {object} SearchTerm
 * @property {string} term            Free text for Adzuna's `what`.
 * @property {string} adzunaCategory  An Adzuna category `tag`.
 */

/** @type {readonly SearchTerm[]} */
export const SEARCH_TERMS = Object.freeze([
  // ── Software & data ────────────────────────────────────────────────
  { term: 'software engineer', adzunaCategory: 'it-jobs' },
  { term: 'python developer', adzunaCategory: 'it-jobs' },
  { term: 'frontend developer', adzunaCategory: 'it-jobs' },
  { term: 'backend developer', adzunaCategory: 'it-jobs' },
  { term: 'data analyst', adzunaCategory: 'it-jobs' },
  { term: 'data scientist', adzunaCategory: 'it-jobs' },
  { term: 'devops engineer', adzunaCategory: 'it-jobs' },
  { term: 'qa engineer', adzunaCategory: 'scientific-qa-jobs' },
  { term: 'product manager', adzunaCategory: 'it-jobs' },

  // ── Design & content ───────────────────────────────────────────────
  { term: 'graphic designer', adzunaCategory: 'creative-design-jobs' },
  { term: 'ux designer', adzunaCategory: 'creative-design-jobs' },
  { term: 'content writer', adzunaCategory: 'pr-advertising-marketing-jobs' },
  { term: 'digital marketing', adzunaCategory: 'pr-advertising-marketing-jobs' },

  // ── Business & finance ─────────────────────────────────────────────
  { term: 'accountant', adzunaCategory: 'accounting-finance-jobs' },
  { term: 'financial analyst', adzunaCategory: 'accounting-finance-jobs' },
  { term: 'business analyst', adzunaCategory: 'consultancy-jobs' },
  { term: 'project manager', adzunaCategory: 'consultancy-jobs' },
  { term: 'administrative assistant', adzunaCategory: 'admin-jobs' },
  { term: 'human resources', adzunaCategory: 'hr-jobs' },

  // ── Customer-facing ────────────────────────────────────────────────
  { term: 'sales representative', adzunaCategory: 'sales-jobs' },
  { term: 'customer service representative', adzunaCategory: 'customer-services-jobs' },
  { term: 'retail associate', adzunaCategory: 'retail-jobs' },

  // ── Engineering (non-software) ─────────────────────────────────────
  { term: 'mechanical engineer', adzunaCategory: 'engineering-jobs' },
  { term: 'civil engineer', adzunaCategory: 'engineering-jobs' },
  { term: 'electrical engineer', adzunaCategory: 'engineering-jobs' },

  // ── Care, teaching, legal ──────────────────────────────────────────
  { term: 'registered nurse', adzunaCategory: 'healthcare-nursing-jobs' },
  { term: 'medical assistant', adzunaCategory: 'healthcare-nursing-jobs' },
  { term: 'teacher', adzunaCategory: 'teaching-jobs' },
  { term: 'paralegal', adzunaCategory: 'legal-jobs' },

  // ── Trades, logistics, hospitality — kept deliberately, see header ──
  { term: 'electrician', adzunaCategory: 'trade-construction-jobs' },
  { term: 'warehouse associate', adzunaCategory: 'logistics-warehouse-jobs' },
  { term: 'truck driver', adzunaCategory: 'logistics-warehouse-jobs' },
  { term: 'chef', adzunaCategory: 'hospitality-catering-jobs' },
].map(Object.freeze));

/**
 * Map the ingest cursor onto one (country, term, page) triple.
 *
 * ═══ WHY THIS DECODES ALL THREE, AND USED TO DECODE TWO ═══
 *
 * The cursor used to be split in two places: this returned (term, sub-cursor),
 * and `cursorToTarget` in adapters/adzuna.js split that sub-cursor into
 * (country, page). Nothing stated that they composed, and the composition was
 * wrong in a way neither half could show on its own.
 *
 * The sub-cursor was `floor(zeroBased / SEARCH_TERMS.length) + 1`, so it moved
 * ONCE PER FULL PASS OVER THE TAXONOMY — which made country the SLOWEST-moving
 * dimension of the three. `cursorToTarget`'s own docstring promises round-robin
 * ("a run that exhausts its time budget after two pages should have covered two
 * countries, not the first two pages of one"), and it delivers that on the
 * number it is given; it simply was never given a number that moved. With 33
 * terms and `ADZUNA_COUNTRIES=us,in`, cursors 1-33 were all the US and India
 * began at 34 — eleven daily runs of nothing. At the old default of
 * INGEST_SWEEP_PAGES=1 the sub-cursor was the CONSTANT 1 and India was never
 * reached at all. Measured 2026-09-20: 8 India rows in the 30-day window, none
 * of them from Adzuna, against 1,211 for the US.
 *
 * So the decode lives in one function now, and country is the FASTEST-moving
 * dimension: consecutive cursors are the same occupation in each country in
 * turn, then the next occupation. Every run covers every country. The ordering
 * within the other two is unchanged — term-major over page, because walking
 * pages within one term would spend a whole daily budget deepening a single
 * occupation, which is the failure this file exists to undo.
 *
 *   countries = [us, in]
 *   cursor 1 → us, software engineer, p1    cursor 4 → in, python developer, p1
 *   cursor 2 → in, software engineer, p1    cursor 5 → us, frontend developer, p1
 *   cursor 3 → us, python developer, p1     ...
 *
 * Called with no `countries` the decode is byte-identical to the old
 * term-major one (a single implied country), which is what every non-Adzuna
 * caller and the existing tests rely on.
 *
 * @param {number} cursor 1-based page from job_ingest_state.
 * @param {readonly SearchTerm[]} [terms] Defaults to SEARCH_TERMS.
 * @param {readonly string[]} [countries] Two-letter codes from
 *   `configuredCountries()`. Empty or absent means the caller has one implied
 *   country and `country` comes back undefined.
 * @returns {{term: string, adzunaCategory: string, country: string|undefined,
 *   page: number}} `page` is the page WITHIN that (country, term).
 */
export function cursorToSearch(cursor, terms = SEARCH_TERMS, countries = []) {
  const list = Array.isArray(terms) && terms.length ? terms : SEARCH_TERMS;
  const places = Array.isArray(countries) ? countries.filter(Boolean) : [];
  const width = Math.max(places.length, 1);
  const zeroBased = Math.max(Number(cursor) || 1, 1) - 1;

  // Country first, so it is the dimension that moves on every single cursor
  // value; the remaining quotient is the old term-major cursor exactly.
  const country = places.length ? places[zeroBased % width] : undefined;
  const slot = Math.floor(zeroBased / width);
  const entry = list[slot % list.length];
  return {
    term: entry.term,
    adzunaCategory: entry.adzunaCategory,
    country,
    page: Math.floor(slot / list.length) + 1,
  };
}
