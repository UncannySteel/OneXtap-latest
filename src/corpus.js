/**
 * Addressable CV corpus — the grounding primitive the fabrication validator
 * diffs generated text against.
 *
 * ═══ THE ZERO-IMPORT RULE ═══
 *
 * This file may import from `./matching/normalize.js` and nothing else. No
 * `./logger.js`, no `./config.js`, no `./storage.js`, no npm packages, no
 * `node:` builtins.
 *
 * WHY: `src/config.js` evaluates `import.meta.env.VITE_API_URL` at module
 * scope, which throws a TypeError in bare Node where `import.meta.env` is
 * `undefined`; `src/storage.js` and `src/logger.js` reference `chrome` /
 * `localStorage` at module load, neither of which exists in Node or in the
 * Express server process. This module has to be importable by the Vite bundle,
 * by `node --test`, and by the server, so it depends on (almost) nothing.
 *
 * `test/matching/no-side-imports.test.js` enforces this mechanically.
 */

import { asObject, normalizeText } from './matching/normalize.js';

/**
 * @typedef {{ref: string, kind: string, text: string, sourceSpan: [number,number]|null, meta: object}} CorpusItem
 */

/** Bullet markers and newlines both end a bullet inside a description blob. */
const BULLET_SPLIT = /[\n\r•·▪●]+/;

/**
 * Leading list punctuation left over after splitting ("- ", "* ", "1. ").
 *
 * Applied by {@link stripLeadingMarkers} in a loop, never once: alternation in
 * a non-global `replace` removes only the first alternative that matches, so
 * `"- 1. Led the payments rewrite"` kept its `"1."`. That stray numeral then
 * reaches the fabrication validator's numeral gate as an ungrounded number and
 * raises a false `high`-severity flag — and a validator that cries wolf gets
 * ignored, which costs more than a missed flag.
 */
const LEADING_MARKER = /^(?:[\s\-*–—]+|\d+[.)]\s*)/;

/** Cap on marker-stripping passes, so a pathological "1.1.1.1…" cannot spin. */
const MAX_MARKER_PASSES = 8;

/** A bullet this short is a fragment, not a claim worth grounding. */
const MIN_BULLET_CHARS = 8;

/** Slug length cap, so a pasted paragraph cannot become a ref. */
const SLUG_MAX_CHARS = 60;

/**
 * Content-derived slug for a skill ref.
 *
 * Derived from the skill TEXT, never from its array index, because refs are
 * persisted alongside generated documents: if a user reorders or deletes one
 * skill, every other skill's ref must stay pointing at the same thing.
 *
 * @param {unknown} value Skill text.
 * @returns {string} URL-safe slug, or `''` when nothing usable remains.
 */
function slugify(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_CHARS)
    // The cap can land exactly on a separator, so trim AGAIN after truncating.
    // Refs are persisted next to generated documents; they should not carry a
    // dangling dash that came from nothing but the length limit.
    .replace(/^-+|-+$/g, '');
}

/**
 * Remove every leading list marker from a bullet, not just the first kind.
 *
 * @param {string} line One split bullet line.
 * @returns {string} The line with leading markers gone.
 */
function stripLeadingMarkers(line) {
  let current = line;
  for (let pass = 0; pass < MAX_MARKER_PASSES; pass += 1) {
    const next = current.replace(LEADING_MARKER, '');
    if (next === current) break;
    current = next;
  }
  return current;
}

/**
 * Locate an item's text inside the raw CV so a claim can be proved grounded
 * rather than merely plausible.
 *
 * @param {string} text Item text.
 * @param {string|null} cvText Raw CV text, when available.
 * @returns {[number, number]|null} `[start, end)` offsets, or `null` when the
 *   text is not found verbatim (structured fields are frequently reassembled
 *   from several parts and will not appear literally).
 */
function locate(text, cvText) {
  if (typeof cvText !== 'string' || !cvText || !text) return null;
  const start = cvText.indexOf(text);
  if (start === -1) return null;
  return [start, start + text.length];
}

/**
 * Push an item onto the corpus, skipping empties and duplicate refs.
 *
 * First write wins for a given ref, which is what keeps a resume listing the
 * same skill twice from producing two items that point at each other.
 *
 * @param {CorpusItem[]} items Accumulator, mutated in place.
 * @param {Set<string>} seen Refs already used.
 * @param {string} ref Stable identifier for this item.
 * @param {string} kind One of: summary, title, bullet, education, certification, skill.
 * @param {unknown} rawText Item text; non-strings and blanks are skipped.
 * @param {string|null} cvText Raw CV text for span location, when available.
 * @param {object} meta Provenance shown alongside a validator flag.
 * @returns {void}
 */
function addItem(items, seen, ref, kind, rawText, cvText, meta) {
  const text = typeof rawText === 'string' ? rawText.trim() : '';
  if (!text || !ref || seen.has(ref)) return;
  seen.add(ref);
  items.push({ ref, kind, text, sourceSpan: locate(text, cvText), meta: meta ?? {} });
}

/**
 * Split an experience description into individual bullets.
 * @param {unknown} description Free text, one bullet per line.
 * @returns {string[]} Bullets with list markers stripped, fragments dropped.
 */
function splitBullets(description) {
  if (typeof description !== 'string' || !description.trim()) return [];
  return description
    .split(BULLET_SPLIT)
    .map((line) => stripLeadingMarkers(line).trim())
    .filter((line) => line.length >= MIN_BULLET_CHARS);
}

/**
 * Turn a parsed resume into a flat list of addressable, individually
 * verifiable claims.
 *
 * Refs are stable and human-readable (`exp.2.bullet.1`, `skill.react`,
 * `edu.0`, `cert.1`, `summary`) so a flag raised by the validator can be shown
 * to the user as "this sentence does not match anything in your CV" with a
 * pointer to what it was compared against.
 *
 * Pure and total: no I/O, and any missing or malformed field is skipped rather
 * than thrown on — a half-parsed PDF must still produce a usable corpus.
 *
 * @param {{firstName?: string, lastName?: string, skills?: unknown[],
 *   experience?: Array<{company?: string, title?: string, startDate?: string,
 *   endDate?: string, description?: string}>,
 *   education?: Array<{school?: string, degree?: string, field?: string}>,
 *   certificates?: Array<{name?: string, issuer?: string}>, summary?: string}} parsed
 * @param {string} [cvText] Raw CV text; when supplied, items found verbatim in
 *   it get a `sourceSpan`.
 * @returns {CorpusItem[]} In document order: summary, experience, education,
 *   certifications, skills. Always an array.
 */
export function buildCorpus(parsed, cvText) {
  const input = asObject(parsed);
  const raw = typeof cvText === 'string' ? cvText : null;
  const items = [];
  const seen = new Set();

  addItem(items, seen, 'summary', 'summary', input.summary, raw, { kind: 'summary' });

  const experience = Array.isArray(input.experience) ? input.experience : [];
  experience.forEach((job, index) => {
    if (!job || typeof job !== 'object') return;
    const company = typeof job.company === 'string' ? job.company.trim() : '';
    const title = typeof job.title === 'string' ? job.title.trim() : '';
    // Every bullet carries its job's meta, so a flag can name the employer the
    // claim was supposedly about without a second lookup.
    const meta = {
      company,
      title,
      startDate: job.startDate ?? null,
      endDate: job.endDate ?? null,
    };
    const headline = [title, company].filter(Boolean).join(' at ');
    addItem(items, seen, `exp.${index}.title`, 'title', headline, raw, meta);
    splitBullets(job.description).forEach((bullet, bulletIndex) => {
      addItem(items, seen, `exp.${index}.bullet.${bulletIndex}`, 'bullet', bullet, raw, meta);
    });
  });

  const education = Array.isArray(input.education) ? input.education : [];
  education.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;
    const degree = typeof entry.degree === 'string' ? entry.degree.trim() : '';
    const field = typeof entry.field === 'string' ? entry.field.trim() : '';
    const school = typeof entry.school === 'string' ? entry.school.trim() : '';
    const text = [[degree, field].filter(Boolean).join(' in '), school].filter(Boolean).join(', ');
    addItem(items, seen, `edu.${index}`, 'education', text, raw, { degree, field, school });
  });

  const certificates = Array.isArray(input.certificates) ? input.certificates : [];
  certificates.forEach((cert, index) => {
    if (!cert || typeof cert !== 'object') return;
    const name = typeof cert.name === 'string' ? cert.name.trim() : '';
    const issuer = typeof cert.issuer === 'string' ? cert.issuer.trim() : '';
    const text = [name, issuer].filter(Boolean).join(', ');
    addItem(items, seen, `cert.${index}`, 'certification', text, raw, { name, issuer });
  });

  const skills = Array.isArray(input.skills) ? input.skills : [];
  for (const skill of skills) {
    const text = typeof skill === 'string' ? skill.trim() : (skill?.name ?? '');
    const slug = slugify(text);
    if (!slug) continue;
    addItem(items, seen, `skill.${slug}`, 'skill', text, raw, { slug });
  }

  return items;
}

/**
 * Index a corpus by ref for O(1) lookup when rendering a validator flag.
 *
 * @param {CorpusItem[]} corpus Items from {@link buildCorpus}.
 * @returns {Map<string, CorpusItem>} Empty map for malformed input; entries
 *   without a string `ref` are skipped rather than throwing.
 */
export function indexCorpus(corpus) {
  const map = new Map();
  if (!Array.isArray(corpus)) return map;
  for (const item of corpus) {
    if (item && typeof item === 'object' && typeof item.ref === 'string') map.set(item.ref, item);
  }
  return map;
}
