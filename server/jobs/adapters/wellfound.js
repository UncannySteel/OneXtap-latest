/**
 * Wellfound (formerly AngelList Talent) — REGISTERED BUT PERMANENTLY OFF.
 *
 * There is no public jobs API. AngelList's `api.angel.co` endpoints — including
 * /1/jobs and the startup search that fed it — were deprecated and switched
 * off during the rebrand to Wellfound, and nothing replaced them. Wellfound's
 * current API surface is recruiter/ATS-side and gated behind a partnership; it
 * is not a job search feed.
 *
 * DO NOT WRITE A SCRAPER HERE. The reasons, in order of how much they cost:
 *   1. It violates their terms of service, and this is a product that asks
 *      users for their employment history.
 *   2. Wellfound serves its listings from a client-rendered app behind bot
 *      detection, so a scraper means a headless browser — a dependency far too
 *      heavy for a 60-second serverless function.
 *   3. Scraped markup breaks silently on a CSS class rename, which is exactly
 *      the failure the `error` field in this contract exists to prevent.
 *
 * It stays in ADAPTERS instead of being deleted so that the cascade, the API
 * response, and job_ingest_state all show 'wellfound: disabled' explicitly.
 * A source that is absent from the list looks like an oversight; a source that
 * reports 'disabled' is a decision someone made, with this comment attached.
 */
import { emptyResult } from './httpJson.js';

/** @type {import('./index.js').JobAdapter} */
export const wellfoundAdapter = {
  id: 'wellfound',

  /**
   * @returns {boolean} Always false. Not configuration — there is no API to
   *   turn on. See the header before changing this.
   */
  enabled() {
    return false;
  },

  supportsPaging: false,

  /**
   * @returns {Promise<{items: object[], hasMore: boolean, error: string|null}>}
   *   Always the disabled result. No network call: resolves, never throws,
   *   never rejects — the same contract the live adapters honour.
   */
  async fetch() {
    return emptyResult('disabled');
  },

  /**
   * @returns {null} Always. Nothing ever reaches here, because fetch() returns
   *   no items; it exists so the adapter satisfies the contract shape.
   */
  toListing() {
    return null;
  },
};

export default wellfoundAdapter;
