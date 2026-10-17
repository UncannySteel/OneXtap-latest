import { getActiveResume } from './resumeStore';
import { log as baseLog } from './logger';

const log = baseLog.child('ui');

/**
 * The corpus half of the fabrication check, in plain JS.
 *
 * Plain JS so the website's dashboard (no React) can use it: its Answer Studio
 * and Cover Letter workspaces send the same corpus. (It began in the popup's
 * fabrication notice, which went with the popup's AI in 1.0.4.) The notice
 * itself is presentation, web/dashboard/js/ui/fabrication.js.
 */

/**
 * Caps mirrored from server/routes/generate.js (FABRICATION_CORPUS_MAX_*). The server
 * truncates again — it cannot trust a client — but THIS side is the one that
 * matters: express.json() rejects a body over 100kb with a 413 before the
 * route runs, and that would fail the whole generation, not just the check.
 *
 * The total-character budget is what does the work. 200 items at 500 chars is
 * 100,000 characters on its own, which is already over the ceiling before the
 * job description and draft are added; 40,000 leaves the rest of the body room
 * to breathe. A real resume corpus is nowhere near any of these — 30-60 items
 * of 60-200 characters — so in practice nothing is dropped. Change one, change
 * the other.
 */
const MAX_CORPUS_ITEMS = 200;
const MAX_CORPUS_ITEM_CHARS = 500;
const MAX_CORPUS_TOTAL_CHARS = 40000;

/**
 * The active resume's corpus, shaped and capped for POST /api/answer-vault/generate.
 *
 * Returns `[]` for every failure mode — no resume, no corpus, store unreadable.
 * An empty array means the server omits the fabrication keys entirely and the
 * generation behaves exactly as it did before this check existed, which is the
 * right outcome: a missing resume must never cost someone their answer.
 *
 * @returns {Promise<Array<{ref: string|null, text: string}>>}
 */
export async function loadFabricationCorpus() {
  try {
    const resume = await getActiveResume();
    const items = Array.isArray(resume?.corpus) ? resume.corpus : [];

    const out = [];
    let budget = MAX_CORPUS_TOTAL_CHARS;
    for (const item of items) {
      if (out.length >= MAX_CORPUS_ITEMS || budget <= 0) break;
      const text = String(item?.text || '')
        .trim()
        .slice(0, Math.min(MAX_CORPUS_ITEM_CHARS, budget));
      if (!text) continue;
      budget -= text.length;
      out.push({ ref: typeof item?.ref === 'string' ? item.ref : null, text });
    }
    return out;
  } catch (e) {
    log.warn('Could not read the resume corpus; skipping the fabrication check', { errName: e?.name });
    return [];
  }
}
