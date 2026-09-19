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
 * Map the ingest cursor onto one search term plus a page within it.
 *
 * Deliberately the same shape as `cursorToTarget` in adapters/adzuna.js, and
 * it composes with it: this splits the flat cursor into (term, sub-cursor),
 * and Adzuna then splits that sub-cursor into (country, page). Each cursor
 * value therefore names a distinct (term, country, page) triple.
 *
 * Term-major on purpose. Walking pages within one term before moving on would
 * spend an entire run — the whole daily budget — deepening one occupation,
 * which is the failure this file exists to undo. Rotating first means a run
 * that dies at page 3 still touched three different occupations.
 *
 * @param {number} cursor 1-based page from job_ingest_state.
 * @param {readonly SearchTerm[]} [terms] Defaults to SEARCH_TERMS.
 * @returns {{term: string, adzunaCategory: string, page: number}}
 */
export function cursorToSearch(cursor, terms = SEARCH_TERMS) {
  const list = Array.isArray(terms) && terms.length ? terms : SEARCH_TERMS;
  const zeroBased = Math.max(Number(cursor) || 1, 1) - 1;
  const entry = list[zeroBased % list.length];
  return {
    term: entry.term,
    adzunaCategory: entry.adzunaCategory,
    page: Math.floor(zeroBased / list.length) + 1,
  };
}
