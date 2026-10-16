/* The label Job Matches shows while a rank runs (HANDOVER item 21).

   A rank is one POST with no progress channel, so the label claims no running
   count: it says what the server does (score the closest jobs it finds) and
   the one number known before the result, the pool's size from
   /api/jobs/meta. That counts the whole pool, so it is quoted only while no
   filter narrows it. How many were scored arrives with the result (the run
   footer's "sent to the scorer").

   Pure and import-free, so test/web/jobMatchesLabel.test.js can load it;
   job-matches.js itself imports through @app and cannot load under Node. */

/**
 * @param {{ total?: number, degraded?: boolean }|null} meta /api/jobs/meta's reply, or null before it arrives.
 * @param {boolean} filtered Whether any filter is applied to the rank.
 * @returns {string}
 */
export function rankingLabel(meta, filtered) {
  const pool = !filtered && !meta?.degraded && Number.isFinite(meta?.total) && meta.total > 0 ? meta.total : null;
  return pool === null
    ? 'Scoring the closest jobs in the pool'
    : `Scoring the closest of ${pool.toLocaleString()} ${pool === 1 ? 'job' : 'jobs'} in the pool`;
}
