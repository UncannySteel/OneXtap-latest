import { h } from './dom.js';
import { note } from './controls.js';

// Claims the AI made that the user's own resume does not back — the server's
// deterministic check (POST /api/answer-vault/generate returns
// `fabricationFlags` when the request carried the resume corpus; see
// src/fabricationCorpus.js).
//
// Advisory, never blocking, as in the popup: the text is already in the
// editor, nothing is disabled, and nothing is regenerated behind the user's
// back. Showing the claim beside what the resume actually says is the point.
// Returns null when there is nothing to say, so callers can drop it in.

const MAX_FLAGS_SHOWN = 6;     // enough to act on; more is a wall nobody reads
const EXCERPT_CHARS = 160;     // quoted for recognition, not for reading whole

function excerpt(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS)}…` : text;
}

export function fabricationNotice(flags) {
  const list = (Array.isArray(flags) ? flags : []).filter((f) => f && f.claim);
  if (!list.length) return null;

  // 'high' first — numbers and named employers are what get probed in an
  // interview — with document order kept inside each severity.
  const ordered = [...list].sort((a, b) => (b.severity === 'high' ? 1 : 0) - (a.severity === 'high' ? 1 : 0));
  const shown = ordered.slice(0, MAX_FLAGS_SHOWN);
  const hidden = ordered.length - shown.length;

  return note('amber',
    h('p.note-title', null, ordered.length === 1
      ? 'One claim here is not backed by your resume'
      : `${ordered.length} claims here are not backed by your resume`),
    h('p.note-sub', null, 'Nothing has been changed or blocked — check these before you send, and edit the text if they are wrong.'),
    h('ul.note-list', null, shown.map((flag) => h('li', null,
      h('strong', null, `“${excerpt(flag.claim)}”`),
      flag.nearestText
        ? ` — your resume says “${excerpt(flag.nearestText)}”.`
        : ' — nothing in your resume mentions this.'))),
    hidden > 0 && h('p.note-sub', null, `and ${hidden} more.`));
}
