import { storage, STORAGE_QUOTA_ERROR } from './storage.js';
import { buildCorpus } from './corpus.js';
import { detectSeniority, extractKeywords, MATCHER_VERSION } from './matching/index.js';
import { log as baseLog } from './logger.js';

const log = baseLog.child('resume');

/**
 * Local resume library.
 *
 * Deliberately shaped like `profileStore.js`: one module-level key, a private
 * `saveResumeStore`, async mutators that load → mutate → save → return the
 * store, and one synchronous `listResumes(store)` for pickers. If you are
 * changing one of these files, read the other first.
 *
 * ═══ RULE 8: LOCAL ONLY ═══
 *
 * Nothing here ever reaches Supabase. The raw file touches the network exactly
 * once, transiently, through the existing `/api/parse-resume` round trip in
 * `resumeParse.js`; what lands here is the result, on the user's device only.
 *
 * ═══ WHY THE RAW FILE IS NOT STORED ═══
 *
 * `extension/manifest.json` has no `unlimitedStorage` permission (adding it is
 * an escalation), so `chrome.storage.local` caps near 10MB and `localStorage`
 * near 5MB of UTF-16. Base64 inflates bytes by 4/3, so three 2MB PDFs would be
 * roughly 8MB on their own and the store would be dead on arrival. Parsed JSON
 * plus extracted text is 20-60KB per resume, so MAX_RESUMES of them stay under
 * ~300KB.
 *
 * The consequence, and it is a real one: after a cache miss the user must
 * re-select the file, because the bytes are gone. `sourceHash` is what lets us
 * recognise the same file when they do, without keeping it.
 */

/**
 * The single key holding the whole store, alongside `onextap_profiles`.
 * Exported so a test can corrupt it directly and watch `loadResumeStore`
 * degrade.
 */
export const RESUMES_STORAGE_KEY = 'onextap_resumes';

/**
 * Longest resume label, matching `MAX_PROFILE_NAME_LENGTH` in profileStore.js.
 * 32 characters is what the switcher's dropdown row fits before truncating, so
 * a name that survives this cap is a name the user can actually read back.
 */
export const MAX_RESUME_NAME_LENGTH = 32;

/**
 * Hard cap on stored resumes. Five at 20-60KB each is a few hundred KB, well
 * under the ~5MB `localStorage` floor described above, with room for the
 * profile store beside it.
 */
export const MAX_RESUMES = 5;

/**
 * ═══ TWO VERSIONS, NOT ONE ═══
 *
 * PARSE_SCHEMA_VERSION tracks the shape `/api/parse-resume` returns. Bumping it
 * forces a RE-UPLOAD, because the raw bytes were discarded on purpose (above)
 * and there is nothing left to re-parse.
 *
 * MATCHER_VERSION (imported, owned by `src/matching/index.js`) tracks keyword
 * extraction and scoring. Bumping it re-derives keywords and corpus from the
 * stored `cvText` with NO network call and NO user action.
 *
 * Splitting them is the whole point: a lexicon tweak is a routine, frequent
 * change, and collapsing these into one version number would make every such
 * tweak demand that every user dig out and re-upload every resume.
 */
export const PARSE_SCHEMA_VERSION = 1;

/**
 * @typedef {{ref: string, kind: string, text: string, sourceSpan: [number,number]|null, meta: object}} CorpusItem
 */

/**
 * @typedef {Object} ParsedResume
 * @property {string[]} skills
 * @property {string[]} titles
 * @property {number|null} yearsExperience
 * @property {Array<{term: string, weight: number}>} keywords
 * @property {number|null} seniority
 * @property {Array<object>} education
 * @property {Array<object>} experience Carried beyond the six required fields
 *   because `buildCorpus` grounds claims on experience bullets and they cannot
 *   be reconstructed from `cvText` alone. See deriveParsed.
 * @property {Array<object>} certificates Same reason.
 * @property {string} summary Same reason.
 */

/**
 * @typedef {Object} StoredResume
 * @property {string} name User-facing label.
 * @property {string} fileName Original file name.
 * @property {number} fileSize Bytes of the original file.
 * @property {string} mimeType
 * @property {string} uploadedAt ISO timestamp of the upload.
 * @property {string} sourceHash sha256 hex of the raw file bytes.
 * @property {number} parseSchemaVersion
 * @property {number} matcherVersion
 * @property {string} parsedAt ISO timestamp of the last derivation.
 * @property {ParsedResume} parsed
 * @property {CorpusItem[]} corpus
 * @property {string} cvText Raw transcription; the input for re-derivation.
 * @property {boolean} needsReupload True once the parse schema has moved on.
 */

/** @typedef {{ resumes: Record<string, StoredResume>, activeResumeId: string|null }} ResumeStore */

// ------------------------------------------------------------------
// Load / save
// ------------------------------------------------------------------

/**
 * Read the resume store.
 *
 * ═══ DIVERGENCE (a) FROM profileStore ═══
 *
 * This is a PURE READ. `loadProfileStore` writes on first run because it has a
 * legacy `user_profile` blob to fold in; there has never been a pre-multi
 * resume blob, so there is nothing to migrate and no reason to touch storage
 * just because someone looked. A picker that mounts and unmounts must not
 * leave writes behind.
 *
 * Total: malformed stored data degrades to an empty store rather than throwing.
 * @returns {Promise<ResumeStore>}
 */
export async function loadResumeStore() {
  let stored = null;
  try {
    stored = await storage.get(RESUMES_STORAGE_KEY);
  } catch (e) {
    log.warn('resume store read failed; starting empty', { errName: e?.name });
    return emptyStore();
  }

  if (!stored || typeof stored !== 'object' || !stored.resumes || typeof stored.resumes !== 'object') {
    return emptyStore();
  }

  const resumes = {};
  for (const [id, record] of Object.entries(stored.resumes)) {
    if (record && typeof record === 'object') resumes[id] = record;
  }
  const activeId = typeof stored.activeResumeId === 'string' && resumes[stored.activeResumeId]
    ? stored.activeResumeId
    : null;
  return { resumes, activeResumeId: activeId };
}

/**
 * A valid, empty store. The one thing every read degrades to.
 * @returns {ResumeStore}
 */
function emptyStore() {
  return { resumes: {}, activeResumeId: null };
}

/**
 * The `resumes` map out of a store, whatever was actually passed.
 *
 * One guard instead of the same "is it an object, does it have a usable
 * `resumes`" dance repeated in every reader. Callers can iterate the result
 * unconditionally.
 *
 * @param {unknown} store
 * @returns {Record<string, StoredResume>} `{}` when the store is unusable.
 */
function resumesOf(store) {
  const resumes = store && typeof store === 'object' ? store.resumes : null;
  return resumes && typeof resumes === 'object' ? resumes : {};
}

/**
 * Persist the store.
 *
 * Uses `storage.setStrict`, not `storage.set`: a swallowed write here means the
 * user's upload silently vanished. A quota failure is re-thrown naming the
 * oldest resume, so the error the UI shows tells them exactly what to delete.
 *
 * ═══ DIVERGENCE (b) FROM profileStore ═══
 *
 * There is no `syncLegacyUserProfile` equivalent. `public/content.js` autofills
 * form fields from the profile and has no use for resume data, so mirroring
 * this store into `user_profile` would only widen what sits in a page-facing
 * key for nothing.
 *
 * @param {ResumeStore} store
 * @returns {Promise<void>}
 * @throws {Error} `StorageQuotaError` when the store is full.
 */
async function saveResumeStore(store) {
  try {
    await storage.setStrict(RESUMES_STORAGE_KEY, store);
  } catch (e) {
    if (e?.name === STORAGE_QUOTA_ERROR) {
      const oldest = oldestResumeName(store);
      log.warn('resume store write hit the storage quota', { errName: e.name, count: countResumes(store) });
      const err = new Error(
        oldest
          ? `Local storage is full. Delete a saved resume — "${oldest}" is the oldest — and try again.`
          : e.message,
      );
      err.name = STORAGE_QUOTA_ERROR;
      err.cause = e;
      throw err;
    }
    log.error('resume store write failed', { errName: e?.name });
    throw e;
  }
}

/**
 * The name of the earliest-uploaded resume, for the quota message.
 * ISO timestamps sort lexicographically, so no date parsing is needed.
 * @param {ResumeStore} store
 * @returns {string|null} null when the store is empty or unnamed.
 */
function oldestResumeName(store) {
  const entries = Object.values(resumesOf(store));
  if (!entries.length) return null;
  const sorted = entries.slice().sort((a, b) => String(a?.uploadedAt || '').localeCompare(String(b?.uploadedAt || '')));
  return sorted[0]?.name || null;
}

/**
 * How many resumes a store holds. Logged with a quota failure; never the names.
 * @param {ResumeStore} store
 * @returns {number}
 */
function countResumes(store) {
  return Object.keys(resumesOf(store)).length;
}

// ------------------------------------------------------------------
// Derivation
// ------------------------------------------------------------------

/**
 * Turn the raw `/api/parse-resume` payload into the compact stored shape.
 *
 * The six fields the picker and matcher need are `skills`, `titles`,
 * `yearsExperience`, `keywords`, `seniority` and `education`. `experience`,
 * `certificates` and `summary` ride along beyond that because `buildCorpus`
 * grounds fabrication checks on experience bullets, and those cannot be
 * recovered from `cvText` by string matching. They are text the user already
 * gave us; carrying them costs a few KB and buys a faithful corpus after a
 * MATCHER_VERSION bump.
 *
 * Pure and total: junk in produces an empty-but-valid shape, never a throw.
 *
 * @param {object} raw Parsed resume from the server.
 * @param {string} cvText Raw transcription, possibly ''.
 * @returns {ParsedResume}
 */
function deriveParsed(raw, cvText) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const skills = uniqueStrings(input.skills);
  const experience = asObjectArray(input.experience);
  const education = asObjectArray(input.education);
  const certificates = asObjectArray(input.certificates);
  const summary = typeof input.summary === 'string' ? input.summary : '';
  const titles = uniqueStrings(experience.map((job) => job.title));

  const text = typeof cvText === 'string' && cvText.trim()
    ? cvText
    : assembleText({ summary, titles, skills, experience, education });

  let keywords = [];
  try {
    const extracted = extractKeywords(text);
    keywords = Array.isArray(extracted?.keywords) ? extracted.keywords : [];
  } catch (e) {
    log.warn('keyword extraction failed; storing none', { errName: e?.name });
  }

  return {
    skills,
    titles,
    yearsExperience: estimateYears(input, experience),
    keywords,
    seniority: firstSeniority(titles),
    education,
    experience,
    certificates,
    summary,
  };
}

/**
 * Fallback text for keyword extraction when the service worker sent no `text`.
 * Worse than a real transcription, but far better than extracting from nothing.
 * @param {{ summary: string, titles: string[], skills: string[],
 *   experience: Array<object>, education: Array<object> }} parts Already
 *   normalised by `deriveParsed`.
 * @returns {string}
 */
function assembleText({ summary, titles, skills, experience, education }) {
  const parts = [summary, titles.join(' '), skills.join(' ')];
  for (const job of experience) {
    parts.push([job.title, job.company, job.description].filter((v) => typeof v === 'string').join(' '));
  }
  for (const entry of education) {
    parts.push([entry.degree, entry.field, entry.school].filter((v) => typeof v === 'string').join(' '));
  }
  return parts.filter(Boolean).join('\n');
}

/**
 * First seniority level readable off a title, matching how
 * `buildResumeProfile` reads one: most recent title wins.
 * @param {string[]} titles
 * @returns {number|null}
 */
function firstSeniority(titles) {
  for (const title of titles) {
    try {
      const detected = detectSeniority(title);
      if (detected !== null && detected !== undefined) return detected;
    } catch {
      // A malformed title is not worth failing an upload over.
    }
  }
  return null;
}

/** Four-digit years only; "Present"/"Current" read as this year. */
const YEAR_RE = /(19|20)\d{2}/;

/**
 * Ceiling on a derived career span. A CV listing a 1970 start and no end is
 * more likely a typo or an education row misread as a job than a 60-year
 * career, and the matcher weights `yearsExperience` — so cap rather than
 * hand it a number no user would claim.
 */
const MAX_PLAUSIBLE_YEARS = 60;

/**
 * Years of experience: an explicit number if the parser gave one, otherwise
 * the span from the earliest start year to the latest end year.
 *
 * A span, not a sum, because overlapping roles would otherwise double-count and
 * hand the matcher a number well above anything the user would claim.
 *
 * @param {object} input Raw parsed resume.
 * @param {Array<object>} experience
 * @returns {number|null} null when nothing datable was found.
 */
function estimateYears(input, experience) {
  if (Number.isFinite(input.yearsExperience) && input.yearsExperience >= 0) {
    return Math.min(Math.trunc(input.yearsExperience), MAX_PLAUSIBLE_YEARS);
  }

  const thisYear = new Date().getFullYear();
  let earliest = null;
  let latest = null;

  for (const job of experience) {
    const startRaw = pickString(job.startDate, job.start);
    const endRaw = pickString(job.endDate, job.end);

    const startMatch = YEAR_RE.exec(startRaw);
    if (startMatch) {
      const year = Number(startMatch[0]);
      if (earliest === null || year < earliest) earliest = year;
    }

    const endsNow = job.isCurrent === true || /present|current|now/i.test(endRaw);
    const endMatch = YEAR_RE.exec(endRaw);
    const endYear = endsNow ? thisYear : (endMatch ? Number(endMatch[0]) : null);
    if (endYear !== null && (latest === null || endYear > latest)) latest = endYear;
  }

  if (earliest === null) return null;
  const span = (latest === null ? thisYear : latest) - earliest;
  if (!Number.isFinite(span) || span < 0) return null;
  return Math.min(span, MAX_PLAUSIBLE_YEARS);
}

/** @returns {string} First string argument, or ''. */
function pickString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

/** @returns {string[]} Trimmed, deduped, non-empty strings. */
function uniqueStrings(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const entry of value) {
    const text = typeof entry === 'string' ? entry.trim() : (typeof entry?.name === 'string' ? entry.name.trim() : '');
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

/** @returns {Array<object>} Only the plain-object entries. */
function asObjectArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry));
}

/**
 * Build a full record from a parse result. Every field is coerced here, so a
 * stored record always has the StoredResume shape no matter what came back
 * from the server.
 * @param {{ name: string, fileName?: unknown, fileSize?: unknown,
 *   mimeType?: unknown, sourceHash?: unknown, parsed?: unknown,
 *   cvText?: unknown, uploadedAt?: unknown }} input `name` is the only field
 *   the caller must have validated already.
 * @returns {StoredResume}
 */
function buildRecord({ name, fileName, fileSize, mimeType, sourceHash, parsed, cvText, uploadedAt }) {
  const text = typeof cvText === 'string' ? cvText : '';
  const derived = deriveParsed(parsed, text);
  const now = new Date().toISOString();
  return {
    name,
    fileName: typeof fileName === 'string' ? fileName : '',
    fileSize: Number.isFinite(fileSize) ? fileSize : 0,
    mimeType: typeof mimeType === 'string' ? mimeType : '',
    uploadedAt: typeof uploadedAt === 'string' ? uploadedAt : now,
    sourceHash: typeof sourceHash === 'string' ? sourceHash : '',
    parseSchemaVersion: PARSE_SCHEMA_VERSION,
    matcherVersion: MATCHER_VERSION,
    parsedAt: now,
    parsed: derived,
    corpus: safeBuildCorpus(derived, text),
    cvText: text,
    needsReupload: false,
  };
}

/**
 * `buildCorpus` is documented as total, but it is the one call here that runs
 * over wholly untrusted parsed output; an empty corpus must not cost the user
 * their upload.
 * @param {ParsedResume} parsed
 * @param {string} cvText
 * @returns {CorpusItem[]} `[]` when the build threw.
 */
function safeBuildCorpus(parsed, cvText) {
  try {
    const items = buildCorpus(parsed, cvText);
    return Array.isArray(items) ? items : [];
  } catch (e) {
    log.warn('corpus build failed; storing an empty corpus', { errName: e?.name });
    return [];
  }
}

// ------------------------------------------------------------------
// Name rules
// ------------------------------------------------------------------

/**
 * Normalise a user-supplied label into a storable resume name.
 *
 * Trim then cap, in that order, so trailing whitespace never eats into the
 * budget. `addResume` and `renameResume` share this so the cap and the "blank
 * is not a name" rule cannot drift apart between them.
 *
 * @param {unknown} raw Anything; non-strings normalise to blank, not to
 *   "undefined".
 * @returns {string} A non-empty name, at most MAX_RESUME_NAME_LENGTH long.
 * @throws {Error} When nothing usable is left after trimming.
 */
function requireResumeName(raw) {
  const trimmed = String(raw || '').trim().slice(0, MAX_RESUME_NAME_LENGTH);
  if (!trimmed) throw new Error('Resume name is required.');
  return trimmed;
}

/**
 * Reject a name that collides with another resume, case-insensitively and
 * whitespace-trimmed.
 *
 * The rule is `profileNameExists` in profileStore.js, deliberately duplicated
 * rather than shared — these two stores hold different things and neither
 * imports the other. Assert-shaped rather than predicate-shaped only so the
 * collision wording has one home; both mutators need it.
 *
 * @param {Record<string, StoredResume>} resumes
 * @param {string} name Already normalised by `requireResumeName`.
 * @param {string|null} [excludeId] Id being renamed, so it cannot collide with
 *   itself.
 * @returns {void}
 * @throws {Error} When another resume already holds the name.
 */
function requireUniqueResumeName(resumes, name, excludeId = null) {
  const normalized = String(name || '').trim().toLowerCase();
  const collides = Object.entries(resumes).some(([id, r]) => {
    if (excludeId && id === excludeId) return false;
    return String(r?.name || '').trim().toLowerCase() === normalized;
  });
  if (collides) throw new Error('A resume with this name already exists.');
}

/**
 * A collision-free id.
 *
 * ═══ DIVERGENCE FROM profileStore ═══
 *
 * `createProfile` uses a bare `profile-${Date.now()}`, which collides when two
 * creates land in the same millisecond. Uploads arrive in bursts (and tests add
 * five in a tight loop), so a same-millisecond collision here would silently
 * overwrite a resume instead of adding one.
 * @param {Record<string, StoredResume>} resumes
 * @returns {string}
 */
function nextResumeId(resumes) {
  const base = `resume-${Date.now()}`;
  if (!resumes[base]) return base;
  let suffix = 1;
  while (resumes[`${base}-${suffix}`]) suffix += 1;
  return `${base}-${suffix}`;
}

// ------------------------------------------------------------------
// Mutators
// ------------------------------------------------------------------

/**
 * Store a freshly parsed resume and make it active.
 *
 * @param {{ name?: string, fileName?: string, fileSize?: number,
 *   mimeType?: string, sourceHash?: string, parsed?: object, cvText?: string }} input
 *   Typically the result of `parseResumeFile`, with a `name` added.
 * @returns {Promise<{ store: ResumeStore, resumeId: string }>} Mirrors
 *   `createProfile`, which also returns the new id alongside the store.
 * @throws {Error} When the name is blank, the store is full, or the name
 *   duplicates an existing resume. `StorageQuotaError` when the write fails.
 */
export async function addResume(input) {
  const store = await loadResumeStore();
  const data = input && typeof input === 'object' ? input : {};
  const trimmed = requireResumeName(data.name || data.fileName);

  // Cap before duplicate: a full store is the harder stop, and telling someone
  // to rename a file they cannot store anyway wastes their time.
  if (Object.keys(store.resumes).length >= MAX_RESUMES) {
    throw new Error(`You can store up to ${MAX_RESUMES} resumes. Delete one before uploading another.`);
  }
  requireUniqueResumeName(store.resumes, trimmed);

  const id = nextResumeId(store.resumes);
  store.resumes[id] = buildRecord({
    name: trimmed,
    fileName: data.fileName,
    fileSize: data.fileSize,
    mimeType: data.mimeType,
    sourceHash: data.sourceHash,
    parsed: data.parsed,
    cvText: data.cvText,
  });
  store.activeResumeId = id;
  await saveResumeStore(store);
  return { store, resumeId: id };
}

/**
 * File a parse result in the library: select the copy already stored for these
 * exact bytes, or add a new resume and make it active.
 *
 * ═══ WHY THIS LIVES IN THE STORE, NOT IN THE TWO UPLOAD SCREENS ═══
 *
 * Both upload surfaces — the dashboard's ProfilesPage and the ResumeSwitcher
 * dropdown — need the same rule: re-uploading the same file is a SELECT, not a
 * duplicate-name error. That rule was written out twice, and two copies of a
 * cache-hit branch is exactly how the two page scrapers in this repo drifted.
 *
 * The argument is the shape `parseResumeFile` returns, matched structurally
 * rather than by importing it: `resumeParse.js` pulls in `src/config.js`, which
 * reads `import.meta.env` at module scope and throws outside a Vite bundle.
 * Importing it here would take this whole store out of `node --test`.
 *
 * @param {{ fileName?: string, fileSize?: number, mimeType?: string,
 *   sourceHash?: string, parsed?: object, cvText?: string }} result A
 *   successful `ResumeParseResult`.
 * @returns {Promise<{ resumeId: string, reused: boolean }>} `reused` is true
 *   when the cached copy was selected and nothing new was written.
 * @throws {Error} Whatever `addResume` throws: blank name, store full,
 *   duplicate name, or `StorageQuotaError`.
 */
export async function saveParsedResume(result) {
  const data = result && typeof result === 'object' ? result : {};

  const existing = findResumeBySourceHash(await loadResumeStore(), data.sourceHash);
  if (existing) {
    await setActiveResumeId(existing.id);
    return { resumeId: existing.id, reused: true };
  }

  // Same bytes, older parse schema. `findResumeBySourceHash` deliberately
  // cannot see this record — a stale parse must not be served as a cache hit —
  // but it still occupies its name, so falling through to addResume() below
  // would fail with "A resume with this name already exists". That made the
  // re-upload the UI asks for the one action guaranteed to fail. Same bytes are
  // the same resume, so refresh it in place and keep its id: every corpusRef
  // already handed out stays pointing at the same document.
  const stale = findStaleResumeBySourceHash(await loadResumeStore(), data.sourceHash);
  if (stale) {
    const resumeId = await refreshResumeFromParse(stale.id, data);
    if (resumeId) {
      await setActiveResumeId(resumeId);
      return { resumeId, reused: false, refreshed: true };
    }
  }

  const fileName = typeof data.fileName === 'string' ? data.fileName : '';
  const { resumeId } = await addResume({
    // The label is the file name without its extension; "Resume" when there is
    // nothing left, so an unnamed upload still gets a usable row in the picker.
    name: fileName.replace(/\.[^.]+$/, '') || 'Resume',
    fileName,
    fileSize: data.fileSize,
    mimeType: data.mimeType,
    sourceHash: data.sourceHash,
    parsed: data.parsed,
    cvText: data.cvText,
  });
  return { resumeId, reused: false };
}

/**
 * Rename a resume in place. Does not change which resume is active.
 * @param {string} resumeId
 * @param {string} newName Trimmed to MAX_RESUME_NAME_LENGTH.
 * @returns {Promise<ResumeStore>}
 * @throws {Error} When the resume is missing, the name is blank, or the name
 *   duplicates a different resume.
 */
export async function renameResume(resumeId, newName) {
  const store = await loadResumeStore();
  const resume = store.resumes[resumeId];
  if (!resume) throw new Error('Resume not found.');
  const trimmed = requireResumeName(newName);
  requireUniqueResumeName(store.resumes, trimmed, resumeId);
  resume.name = trimmed;
  await saveResumeStore(store);
  return store;
}

/**
 * Delete a resume.
 *
 * ═══ DIVERGENCE (c) FROM profileStore ═══
 *
 * There is no default resume and no "cannot delete the last one" guard.
 * Autofill needs a profile to exist, so profileStore protects one; nothing
 * breaks with zero resumes, and a user who uploaded the wrong CV should be able
 * to remove it outright. When the deleted resume was active, `activeResumeId`
 * falls back to whatever remains, or to `null` — never to a dangling id.
 *
 * @param {string} resumeId
 * @returns {Promise<ResumeStore>}
 * @throws {Error} When the resume is missing.
 */
export async function deleteResume(resumeId) {
  const store = await loadResumeStore();
  if (!store.resumes[resumeId]) throw new Error('Resume not found.');

  delete store.resumes[resumeId];
  if (store.activeResumeId === resumeId) {
    store.activeResumeId = Object.keys(store.resumes)[0] ?? null;
  }
  await saveResumeStore(store);
  return store;
}

/**
 * Switch the active resume. Unknown ids are ignored (the store comes back
 * unchanged) rather than throwing, matching `setActiveProfileId`. Pass `null`
 * to deliberately clear the selection.
 * @param {string|null} resumeId
 * @returns {Promise<ResumeStore>}
 */
export async function setActiveResumeId(resumeId) {
  const store = await loadResumeStore();
  if (resumeId === null) {
    if (store.activeResumeId === null) return store;
    store.activeResumeId = null;
    await saveResumeStore(store);
    return store;
  }
  if (!store.resumes[resumeId]) return store;
  store.activeResumeId = resumeId;
  await saveResumeStore(store);
  return store;
}

// ------------------------------------------------------------------
// Reads
// ------------------------------------------------------------------

/**
 * Flatten the store into a list for pickers. Synchronous — pass a store you
 * already loaded. Same `{ id, name, ... }` contract as `listProfiles`.
 * @param {ResumeStore} store
 * @returns {Array<{ id: string, name: string, fileName: string, uploadedAt: string, needsReupload: boolean }>}
 */
export function listResumes(store) {
  return Object.entries(resumesOf(store)).map(([id, r]) => ({
    id,
    name: r?.name || '',
    fileName: r?.fileName || '',
    uploadedAt: r?.uploadedAt || '',
    needsReupload: r?.needsReupload === true,
  }));
}

/**
 * The active resume, id included. Async and store-loading, mirroring
 * `getActiveLegacyProfile`.
 * @returns {Promise<(StoredResume & { id: string })|null>} null when nothing is
 *   selected.
 */
export async function getActiveResume() {
  const store = await loadResumeStore();
  const id = store.activeResumeId;
  if (!id || !store.resumes[id]) return null;
  return { id, ...store.resumes[id] };
}

/**
 * Find an already-parsed resume for these exact file bytes.
 *
 * ═══ THE CACHE RULE ═══
 *
 * A hash match alone is NOT a hit: `parseSchemaVersion` must match the current
 * one too. A record parsed under an older schema has fields in places the
 * current code does not look, and serving it from cache would be worse than
 * re-parsing — the user would see a half-populated profile with no error.
 *
 * Synchronous, pairing with `listResumes`: pass a store you already loaded.
 *
 * @param {ResumeStore} store
 * @param {string} sourceHash sha256 hex of the raw file bytes.
 * @returns {(StoredResume & { id: string })|null}
 */
export function findResumeBySourceHash(store, sourceHash) {
  const hash = typeof sourceHash === 'string' ? sourceHash.trim().toLowerCase() : '';
  if (!hash) return null;

  for (const [id, record] of Object.entries(resumesOf(store))) {
    if (!record || typeof record !== 'object') continue;
    if (String(record.sourceHash || '').toLowerCase() !== hash) continue;
    if (record.parseSchemaVersion !== PARSE_SCHEMA_VERSION) continue;
    return { id, ...record };
  }
  return null;
}

/**
 * Bring one stored resume up to date with the current versions.
 *
 * - `matcherVersion` behind  → re-derive keywords and corpus from the stored
 *   `cvText`. No network, no user action. This is the cheap path, and it is why
 *   `cvText` is worth its bytes.
 * - `parseSchemaVersion` behind → flag `needsReupload` and leave the record
 *   alone. The raw bytes are gone (see the header), so there is nothing to
 *   re-parse; only the user can fix this.
 *
 * Total: an unknown id returns `{ status: 'missing' }` rather than throwing.
 *
 * @param {string} resumeId
 * @returns {Promise<{ store: ResumeStore, status: 'fresh'|'rederived'|'needs-reupload'|'missing', resume: (StoredResume & { id: string })|null }>}
 */
export async function rederiveIfStale(resumeId) {
  const store = await loadResumeStore();
  const record = store.resumes[resumeId];
  if (!record) return { store, status: 'missing', resume: null };

  if (record.parseSchemaVersion !== PARSE_SCHEMA_VERSION) {
    if (record.needsReupload !== true) {
      record.needsReupload = true;
      await saveResumeStore(store);
    }
    return { store, status: 'needs-reupload', resume: { id: resumeId, ...record } };
  }

  if (record.matcherVersion === MATCHER_VERSION) {
    return { store, status: 'fresh', resume: { id: resumeId, ...record } };
  }

  const cvText = typeof record.cvText === 'string' ? record.cvText : '';
  const rederived = deriveParsed(record.parsed, cvText);
  record.parsed = rederived;
  record.corpus = safeBuildCorpus(rederived, cvText);
  record.matcherVersion = MATCHER_VERSION;
  record.parsedAt = new Date().toISOString();
  record.needsReupload = false;
  await saveResumeStore(store);
  return { store, status: 'rederived', resume: { id: resumeId, ...record } };
}

/**
 * Find a record with this source hash whose parse is from an OLDER schema.
 *
 * The mirror of {@link findResumeBySourceHash}, which only matches records the
 * current parser produced. This one matches exactly the records that function
 * skips, so the two together cover every stored copy of a given file.
 *
 * @param {{ resumes?: Record<string, object> }} store A loaded store.
 * @param {string} sourceHash Hash of the raw file bytes.
 * @returns {{ id: string }|null} null when nothing matches.
 */
export function findStaleResumeBySourceHash(store, sourceHash) {
  const hash = typeof sourceHash === 'string' ? sourceHash.trim().toLowerCase() : '';
  if (!hash) return null;

  for (const [id, record] of Object.entries(resumesOf(store))) {
    if (!record || typeof record !== 'object') continue;
    if (String(record.sourceHash || '').toLowerCase() !== hash) continue;
    if (record.parseSchemaVersion === PARSE_SCHEMA_VERSION) continue;
    return { id, ...record };
  }
  return null;
}

/**
 * Replace a record's parse in place, keeping its id and its user-chosen name.
 *
 * Used when a file is re-uploaded after the parse schema moved on. The id is
 * deliberately preserved: corpus refs are handed out alongside generated
 * documents, and a new id would orphan every one of them.
 *
 * @param {string} resumeId Id of the record to refresh.
 * @param {{ fileName?: string, fileSize?: number, mimeType?: string, sourceHash?: string, parsed?: object, cvText?: string }} data Fresh parse result.
 * @returns {Promise<string|null>} The resume id, or null when it no longer exists.
 */
export async function refreshResumeFromParse(resumeId, data) {
  const store = await loadResumeStore();
  const resumes = resumesOf(store);
  const previous = Object.prototype.hasOwnProperty.call(resumes, resumeId)
    ? resumes[resumeId]
    : null;
  if (!previous || typeof previous !== 'object') return null;

  const fresh = data && typeof data === 'object' ? data : {};
  resumes[resumeId] = buildRecord({
    // The name and the original upload time are the user's, not the parser's.
    name: previous.name,
    uploadedAt: previous.uploadedAt,
    fileName: typeof fresh.fileName === 'string' ? fresh.fileName : previous.fileName,
    fileSize: Number.isFinite(fresh.fileSize) ? fresh.fileSize : previous.fileSize,
    mimeType: typeof fresh.mimeType === 'string' ? fresh.mimeType : previous.mimeType,
    sourceHash: typeof fresh.sourceHash === 'string' ? fresh.sourceHash : previous.sourceHash,
    parsed: fresh.parsed,
    cvText: fresh.cvText,
  });

  await saveResumeStore(store);
  return resumeId;
}
