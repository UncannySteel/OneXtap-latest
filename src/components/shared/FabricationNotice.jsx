import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { getActiveResume } from '../../resumeStore';
import { log as baseLog } from '../../logger';

const log = baseLog.child('ui');

// Same token as AMBER_BOX in dashboard/JobMatchesPage.jsx — this is the app's
// one "advisory, not an error" surface and it should look identical wherever
// it appears. Copied rather than imported so a page component does not become
// a dependency of a shared one.
const AMBER_BOX = 'rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200';

const EMPHASIS = 'font-medium text-amber-900 dark:text-amber-100';

/**
 * Caps mirrored from server/index.js (FABRICATION_CORPUS_MAX_*). The server
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

/** Enough flags to act on; more than this is a wall of amber nobody reads. */
const MAX_FLAGS_SHOWN = 6;

/** Quoted excerpts are for recognition, not for reading the whole bullet. */
const EXCERPT_CHARS = 160;

const excerpt = (value) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS)}…` : text;
};

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

/**
 * Advisory notice listing claims the AI made that the user's own resume does
 * not support.
 *
 * Deliberately non-blocking: the text is already in the editor, nothing is
 * disabled, and there is no auto-retry anywhere in this flow. A silent
 * regenerate-until-clean loop would hide the fabrication instead of showing
 * it, spend credits the user did not authorise, and converge on prose so vague
 * it says nothing. Showing the claim beside the nearest thing the resume
 * actually says is the whole point.
 *
 * Renders nothing when there is nothing to say, so call sites can drop it in
 * unconditionally.
 *
 * @param {object} props
 * @param {Array<{claim: string, nearestText: string, severity?: 'high'|'medium'}>} props.flags
 *   `fabricationFlags` straight off the generate response.
 * @param {string} [props.className] Extra layout classes for the wrapper.
 */
const FabricationNotice = ({ flags, className = '' }) => {
  const list = Array.isArray(flags) ? flags.filter((f) => f && f.claim) : [];
  if (list.length === 0) return null;

  // Stable sort (V8), so 'high' items lead and document order survives within
  // each severity — the numbers and named employers are what get probed in an
  // interview, so they belong at the top of the list.
  const ordered = [...list].sort(
    (a, b) => (b.severity === 'high' ? 1 : 0) - (a.severity === 'high' ? 1 : 0)
  );
  const shown = ordered.slice(0, MAX_FLAGS_SHOWN);
  const hidden = ordered.length - shown.length;

  return (
    <div className={`${AMBER_BOX} ${className}`.trim()}>
      <p className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle size={14} className="shrink-0" />
        {ordered.length === 1
          ? 'One claim here is not backed by your resume'
          : `${ordered.length} claims here are not backed by your resume`}
      </p>
      <p className="mt-1 text-xs">
        Nothing has been changed or blocked — check these before you send, and edit the text above if they are wrong.
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-4">
        {shown.map((flag, i) => (
          <li key={`${flag.nearestRef || 'none'}-${i}`}>
            <span className={EMPHASIS}>“{excerpt(flag.claim)}”</span>
            {flag.nearestText
              ? <> — your resume says “{excerpt(flag.nearestText)}”.</>
              : <> — nothing in your resume mentions this.</>}
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <p className="mt-1 text-xs">and {hidden} more.</p>
      )}
    </div>
  );
};

export default FabricationNotice;
