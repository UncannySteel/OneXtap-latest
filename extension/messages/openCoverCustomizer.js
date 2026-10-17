// OPEN_COVER_CUSTOMIZER { job: { company, role, description, url } } → { success }
//
// The job-page button's half of the cover-letter handoff (the "Customize
// cover letter" button content.js mounts under a cover-letter field). The job
// waits in chrome.storage.session under `coverHandoff:<uuid>`, for 30 minutes
// or one read by GET_COVER_HANDOFF (./getCoverHandoff.js), whichever comes
// first; then the dashboard's Cover Letter workspace opens next to the job's
// tab, with the id. New in protocol 2.
//
// From the content script only, and from the top frame only: that is where
// content.js is injected (activeTab's reach). Everything in `job` was read
// off a page we do not control, so it is kept as plain text: markup
// stripped, every field capped, and a url only when it is http(s).
//
// Session storage, not local: content scripts cannot read it (Chrome's
// default access level), and it empties when the browser closes. Nothing
// leaves the device: job text is not profile data, and the dashboard is on
// the site the extension already talks to (docs/extension-protocol.md,
// "The cover-letter handoff").

/** The session-storage key of one handoff is this, then its uuid. */
export const HANDOFF_PREFIX = 'coverHandoff:';

/** How long a handoff waits for the dashboard. */
export const HANDOFF_TTL_MS = 30 * 60 * 1000;

/** The longest each field is kept, in characters, once its markup is gone. */
export const LIMITS = Object.freeze({ company: 120, role: 160, description: 20000, url: 2048 });

// Whole elements whose text is code, not words; then comments (an unclosed one
// runs to the end); then any tag, declaration or processing instruction; then
// a tag cut off by the end of the text.
const MARKUP = [
  /<(script|style|template|noscript|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
  /<!--[\s\S]*?(?:-->|$)/g,
  /<\/?[a-z][^<>]*>|<![^<>]*>|<\?[^<>]*>/gi,
  /<\/?[a-z][^<>]*$/i,
];

// C0 and C1 controls but tab, newline and carriage return; DEL; the
// bidirectional marks and overrides, which can make a company read as another.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F‎‏‪-‮⁦-⁩]/g;

function stripMarkup(text) {
  return MARKUP.reduce((s, pattern) => s.replace(pattern, ' '), text);
}

/** At most `max` characters, never half of a surrogate pair. */
function cap(text, max) {
  let s = text.slice(0, max);
  if (s.length && /[\uD800-\uDBFF]/.test(s[s.length - 1])) s = s.slice(0, -1);
  return s.trimEnd();
}

/**
 * One field as plain text: a string or nothing, markup and invisible
 * characters out, whitespace tidied, capped.
 * @param {unknown} value
 * @param {number} max
 * @param {boolean} paragraphs Keep line breaks (at most one blank line in a row).
 */
function plainText(value, max, paragraphs) {
  if (typeof value !== 'string') return '';
  let s = stripMarkup(value).replace(INVISIBLE, '').replace(/\r\n?/g, '\n');
  if (paragraphs) {
    s = s.replace(/[^\S\n]+/g, ' ')
      .split('\n').map((line) => line.trim()).join('\n')
      .replace(/\n{3,}/g, '\n\n');
  } else {
    s = s.replace(/\s+/g, ' ');
  }
  return cap(s.trim(), max);
}

/** An http(s) address, without any credentials in it; '' for anything else. */
function webUrl(value) {
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  if (!raw || raw.length > LIMITS.url) return '';
  let url;
  try {
    url = new URL(raw);
  } catch {
    return '';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  url.username = '';
  url.password = '';
  return url.href;
}

/**
 * The job as it may be kept and shown: every field a plain string.
 * @param {unknown} job As the content script sent it.
 * @returns {{ company: string, role: string, description: string, url: string }|null}
 *   null when `job` is not an object.
 */
export function sanitiseJob(job) {
  if (!job || typeof job !== 'object' || Array.isArray(job)) return null;
  return {
    company: plainText(job.company, LIMITS.company, false),
    role: plainText(job.role, LIMITS.role, false),
    description: plainText(job.description, LIMITS.description, true),
    url: webUrl(job.url),
  };
}

/**
 * True once an entry is 30 minutes old, and for anything that is not an
 * entry this module wrote.
 * @param {unknown} entry `{ job, createdAt }`
 * @param {number} now Milliseconds since the epoch.
 */
export function isExpired(entry, now) {
  const createdAt = entry && typeof entry === 'object' ? entry.createdAt : undefined;
  return !Number.isFinite(createdAt) || now - createdAt >= HANDOFF_TTL_MS;
}

/** Drop the handoffs nobody came for. The browser empties the rest on exit. */
async function sweepExpired(session, now) {
  const all = await session.get(null);
  const stale = Object.keys(all).filter((key) => key.startsWith(HANDOFF_PREFIX) && isExpired(all[key], now));
  if (stale.length) await session.remove(stale);
}

/**
 * The new tab, next to the job's when Chrome said where that is.
 * @param {string} url
 * @param {chrome.tabs.Tab|undefined} tab The sender's tab.
 */
function nextTo(url, tab) {
  return {
    url,
    ...(Number.isInteger(tab?.index) ? { index: tab.index + 1 } : {}),
    ...(Number.isInteger(tab?.windowId) ? { windowId: tab.windowId } : {}),
    ...(Number.isInteger(tab?.id) ? { openerTabId: tab.id } : {}),
  };
}

export default {
  kind: 'OPEN_COVER_CUSTOMIZER',
  from: ['content'],
  // The job-page button hands a job to the dashboard's Cover Letter workspace.
  capability: 'cover-handoff',

  async handle(msg, { chrome, dashboardUrl, runtimeId, sender, log }) {
    if (sender?.frameId) return { success: false, error: 'Only from the top frame' };
    const job = sanitiseJob(msg.job);
    if (!job) return { success: false, error: 'No job to hand over' };

    const session = chrome.storage.session;
    const now = Date.now();
    await sweepExpired(session, now);

    const id = crypto.randomUUID();
    const key = `${HANDOFF_PREFIX}${id}`;
    await session.set({ [key]: { job, createdAt: now } });

    // ?view=cover opens the Cover Letter workspace, ?extensionId= is the
    // extension a localhost dashboard talks back to (an unpacked build's).
    const url = new URL(dashboardUrl);
    url.searchParams.set('view', 'cover');
    url.searchParams.set('handoff', id);
    url.searchParams.set('extensionId', runtimeId);
    try {
      await chrome.tabs.create(nextTo(url.href, sender?.tab));
    } catch (err) {
      await session.remove(key);
      log.error('could not open the dashboard for a cover letter', err);
      return { success: false, error: 'Could not open the dashboard' };
    }
    return { success: true };
  },
};
