import React from 'react';
import { AlertTriangle } from 'lucide-react';

// The corpus loader lives in plain JS so the website's dashboard can share it
// (src/fabricationCorpus.js). Re-exported so existing imports keep working.
export { loadFabricationCorpus } from '../../fabricationCorpus';

// This is the app's one "advisory, not an error" surface and it should look
// identical wherever it appears in the popup.
const AMBER_BOX = 'rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200';

const EMPHASIS = 'font-medium text-amber-900 dark:text-amber-100';

/** Enough flags to act on; more than this is a wall of amber nobody reads. */
const MAX_FLAGS_SHOWN = 6;

/** Quoted excerpts are for recognition, not for reading the whole bullet. */
const EXCERPT_CHARS = 160;

const excerpt = (value) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS)}…` : text;
};

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
