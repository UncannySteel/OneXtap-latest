import { COUNTRIES } from '../extension/constants.js';
import {
  DEFAULT_PROFILE,
  emptyCertificate,
  emptyEducation,
  emptyExperience,
} from './profileDefaults.js';

/**
 * Parsed resume → profile, the translation layer.
 *
 * ═══ WHY THIS FILE EXISTS ═══
 *
 * The resume parser and the profile editor were written against two different
 * vocabularies and nothing sat between them. POST /api/parse-resume returns
 * `address.street`, `address.zip`, `education[].startDate`, `.endDate`,
 * `.gpa`; the editor renders `address.addressLine1`, `address.postalCode`,
 * `education[].start`, `.end`, `.cgpa`. Same data, different spelling, so the
 * merge in ProfilesPage dropped seven fields on the floor of a resume that
 * stated every one of them — measured at 17 of 38 editor fields left blank.
 *
 * Note that `src/corpus.js` and `src/resumeStore.js` already read BOTH
 * spellings (`job.startDate ?? job.start`), which is why the resume library
 * and job matching were never affected and why the bug only ever showed up in
 * the editor. This module is the missing third reader, and it is deliberately
 * the only place the two vocabularies are allowed to meet.
 *
 * ═══ THE MERGE CONTRACT, IN ONE LINE ═══
 *
 * **A parsed value wins when it is non-empty, and an empty one never
 * overwrites anything.**
 *
 * The first half is the shipped behaviour and the point of the feature —
 * `extracted.firstName || prev.firstName` is what "auto-fill your profile
 * from your resume" has always meant, and re-uploading a corrected CV has to
 * actually correct something. The second half is the bug fix: the old merge
 * spread `...extracted.address` wholesale, so every key the parser returned
 * EMPTY erased what the user had typed. Observed live — the parser returned
 * `country: ""` and the merge wiped `"United States"`, leaving the Country
 * `<select>` holding a value that matched no `<option>`.
 *
 * ═══ PURE, AND KEPT THAT WAY ═══
 *
 * No `chrome.*`, no fetch, no storage, no logger — it imports two data modules
 * and nothing else, so `node --test` can exercise it directly
 * (test/resume/resumeToProfile.test.js). The transport lives in
 * `resumeParse.js` and the persistence in `profileStore.js`; if you are about
 * to import either one here, the thing you want belongs in the caller.
 *
 * ═══ DO NOT ROUTE THE RESUME LIBRARY THROUGH THIS ═══
 *
 * `saveParsedResume()` is handed the RAW parser output on purpose: the corpus
 * builder diffs claims against the parser's own field names and its
 * `sourceSpan` offsets are computed against the raw transcription. Normalising
 * before that write would silently change what the fabrication validator
 * compares against. This module converts for the EDITOR only.
 */

// ------------------------------------------------------------------
// Small total helpers
// ------------------------------------------------------------------

/**
 * A trimmed string, from anything.
 *
 * Numbers included: a GPA comes back as `3.74` about as often as `"3.74"`,
 * and an editor input bound to a number renders it but cannot edit it
 * sensibly. Booleans and objects are not field values and yield `''`.
 *
 * @param {unknown} value
 * @returns {string}
 */
function str(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/**
 * The first argument that is a non-empty string.
 *
 * Call it with the parsed value FIRST and the existing one last: that ordering
 * is the merge contract in the module header — parsed wins, empty never does.
 *
 * @param {...unknown} values Preferred first.
 * @returns {string} `''` when every argument is empty.
 */
function firstNonEmpty(...values) {
  for (const value of values) {
    const s = str(value);
    if (s) return s;
  }
  return '';
}

/**
 * The four-digit year inside a date the resume wrote however it liked —
 * "June 2019", "2019-06", "06/2019" all yield "2019".
 *
 * Used to populate the editor's dedicated Graduation Year / Enrollment Year
 * inputs, which have no counterpart in the parser's schema and which the user
 * would otherwise retype from the dates sitting two fields to the left.
 *
 * Range-bounded to 1900-2099 so a GPA, a street number or a course code can
 * never be mistaken for a year.
 *
 * @param {unknown} value
 * @returns {string} `''` when there is no plausible year.
 */
function yearOf(value) {
  const match = /\b(?:19|20)\d{2}\b/.exec(str(value));
  return match ? match[0] : '';
}

/**
 * Whether a date field means "still there".
 *
 * Resumes write the open end of a range as a word, and the editor has a
 * checkbox for it. Without this the checkbox stays unticked next to an End
 * field reading "Present", which is the sort of disagreement a reviewer
 * notices and the user has to fix by hand.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function looksCurrent(value) {
  return /\b(present|current|now|ongoing|to date|till date)\b/i.test(str(value));
}

/**
 * Whether an education end date describes a degree not yet finished.
 *
 * Wider than `looksCurrent` because resumes date an unfinished degree in a
 * way they never date a job: "Expected 2028", "Anticipated May 2026". The
 * editor has a separate Expected Graduation input for exactly this, and
 * routing "Expected 2028" into Graduation Year instead would state a
 * qualification the candidate does not hold yet.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function looksUnfinished(value) {
  return looksCurrent(value) || /\b(expected|anticipated|in progress|pursuing)\b/i.test(str(value));
}

/** @param {unknown} value @returns {any[]} */
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/** @param {unknown} value @returns {object} */
function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

// ------------------------------------------------------------------
// Link types
// ------------------------------------------------------------------

/**
 * The link types the editor's `<select>` offers, and the only spellings
 * `urlOf()` in public/content.js will match.
 *
 * ═══ CASE IS LOAD-BEARING HERE ═══
 *
 * The parse prompt asks the model for `"linkedin|github|portfolio|other"`,
 * lowercase. The editor's options are `LinkedIn|GitHub|Portfolio|Other`, and
 * the autofiller looks up `urls.find((u) => u.type === 'LinkedIn')` — an exact
 * match. So every parsed link landed with a type that rendered as the wrong
 * option AND could never be autofilled. Canonicalising on the way in is the
 * fix; `urlOf` was also made case-insensitive so profiles already saved with
 * lowercase types recover without a re-upload.
 */
const URL_TYPES = ['LinkedIn', 'GitHub', 'Portfolio', 'Other'];

/**
 * A parser link type, in the editor's spelling.
 *
 * @param {unknown} value
 * @returns {string} One of URL_TYPES; an unknown type becomes 'Other' rather
 *   than being dropped, because the URL itself is still worth keeping.
 */
function canonicalUrlType(value) {
  const lower = str(value).toLowerCase().replace(/[^a-z]/g, '');
  const exact = URL_TYPES.find((t) => t.toLowerCase() === lower);
  if (exact) return exact;
  // The model occasionally answers with the site rather than the label.
  if (lower.includes('linkedin')) return 'LinkedIn';
  if (lower.includes('github') || lower.includes('gitlab')) return 'GitHub';
  if (lower.includes('portfolio') || lower.includes('website') || lower.includes('personal')) return 'Portfolio';
  return 'Other';
}

// ------------------------------------------------------------------
// Row normalisers
// ------------------------------------------------------------------

/**
 * One parsed education entry as a complete editor row.
 *
 * Hydrated from `emptyEducation()` so every key the editor renders exists —
 * see the row-factory note in profileDefaults.js for why a missing key is not
 * merely cosmetic.
 *
 * @param {object} entry Raw parser entry, or an existing editor row.
 * @returns {object} A full education row.
 */
function educationRow(entry) {
  const e = asObject(entry);
  const start = firstNonEmpty(e.startDate, e.start);
  const end = firstNonEmpty(e.endDate, e.end, e.graduationDate);
  const open = looksUnfinished(end);
  return {
    ...emptyEducation(),
    school: firstNonEmpty(e.school, e.institution, e.university),
    degree: firstNonEmpty(e.degree, e.qualification),
    field: firstNonEmpty(e.field, e.fieldOfStudy, e.major),
    start,
    end,
    cgpa: firstNonEmpty(e.gpa, e.cgpa, e.grade),
    specialization: firstNonEmpty(e.specialization, e.concentration),
    minor: firstNonEmpty(e.minor),
    // Derived, not invented: the year is read back out of the dates the
    // resume already stated, and stays empty when they carry none.
    enrollmentYear: firstNonEmpty(e.enrollmentYear, yearOf(start)),
    graduationYear: firstNonEmpty(e.graduationYear, open ? '' : yearOf(end)),
    graduationDate: firstNonEmpty(e.graduationDate),
    expectedGraduation: firstNonEmpty(e.expectedGraduation, open ? yearOf(end) : ''),
  };
}

/**
 * One parsed experience entry as a complete editor row.
 *
 * Both date spellings are written out: `start`/`end` for the editor, and
 * `startDate`/`endDate` kept alongside them because corpus.js reads those
 * first when it builds the grounding claims a cover letter is checked against.
 *
 * @param {object} entry Raw parser entry, or an existing editor row.
 * @returns {object} A full experience row.
 */
function experienceRow(entry) {
  const e = asObject(entry);
  const start = firstNonEmpty(e.startDate, e.start);
  const end = firstNonEmpty(e.endDate, e.end);
  return {
    ...emptyExperience(),
    company: firstNonEmpty(e.company, e.employer, e.organization),
    title: firstNonEmpty(e.title, e.role, e.position),
    start,
    end,
    startDate: start,
    endDate: end,
    description: firstNonEmpty(e.description, e.summary),
    duration: firstNonEmpty(e.duration),
    type: firstNonEmpty(e.type, e.employmentType),
    isCurrent: typeof e.isCurrent === 'boolean' ? e.isCurrent : looksCurrent(end),
  };
}

/**
 * One parsed certificate entry as a complete editor row.
 * @param {object} entry Raw parser entry, or an existing editor row.
 * @returns {object} A full certificate row.
 */
function certificateRow(entry) {
  const c = asObject(entry);
  return {
    ...emptyCertificate(),
    name: firstNonEmpty(c.name, c.title),
    issuer: firstNonEmpty(c.issuer, c.authority, c.organization),
    date: firstNonEmpty(c.date, c.issued, c.issueDate),
    expiry: firstNonEmpty(c.expiry, c.expires, c.expiryDate, c.expirationDate),
  };
}

// ------------------------------------------------------------------
// Section mergers
// ------------------------------------------------------------------

/**
 * Any address object in the editor's vocabulary, and only its keys.
 *
 * `street` → `addressLine1` and `zip` → `postalCode` are the two renames that
 * cost users their address entirely.
 *
 * ═══ WHY THIS RUNS OVER THE STORED ADDRESS TOO, NOT JUST THE PARSED ONE ═══
 *
 * The old merge spread the parser's address straight into the profile, so a
 * profile saved by any earlier build has `street` and `zip` sitting inside
 * `address` — written there, persisted, and rendered by nothing. Translating
 * only the incoming side would leave those users with an address the editor
 * still cannot show until they upload again. Canonicalising both sides means
 * simply opening the page repairs it.
 *
 * Returning only the canonical keys is the other half: the legacy spellings
 * are dropped on the way out, so the repair is permanent at the next save
 * rather than something every future reader has to keep allowing for.
 *
 * @param {unknown} raw An address in any of the spellings above.
 * @returns {object} Exactly the keys DEFAULT_PROFILE.address declares.
 */
function canonicalAddress(raw) {
  const a = asObject(raw);
  return {
    addressLine1: firstNonEmpty(a.addressLine1, a.street, a.line1, a.address),
    addressLine2: firstNonEmpty(a.addressLine2, a.line2, a.street2),
    addressLine3: firstNonEmpty(a.addressLine3, a.line3),
    city: firstNonEmpty(a.city, a.town),
    state: firstNonEmpty(a.state, a.region, a.province),
    postalCode: firstNonEmpty(a.postalCode, a.zip, a.zipCode, a.postcode),
    country: firstNonEmpty(a.country),
  };
}

/**
 * Address, in the editor's vocabulary, with nothing blanked.
 *
 * Both sides are canonicalised first, so the comparison is key-for-key and
 * the merge contract applies cleanly: parsed wins, empty never does.
 *
 * @param {object} parsedAddress The parser's address object.
 * @param {object} prevAddress The address already on the profile.
 * @returns {object} A full address object.
 */
function mergeAddress(parsedAddress, prevAddress) {
  const parsed = canonicalAddress(parsedAddress);
  const prev = canonicalAddress({ ...DEFAULT_PROFILE.address, ...asObject(prevAddress) });
  return Object.fromEntries(
    Object.keys(parsed).map((key) => [key, firstNonEmpty(parsed[key], prev[key])])
  );
}

/**
 * Links, merged BY TYPE rather than replaced.
 *
 * The old merge assigned `next.urls = extracted.urls`, so uploading a resume
 * that mentions only LinkedIn deleted the GitHub and Portfolio rows the user
 * had filled in by hand. Keeping the existing slots and writing parsed values
 * into the matching one — appending only genuinely new types — is what
 * "auto-fill your profile" was supposed to mean.
 *
 * @param {Array} parsedUrls
 * @param {Array} prevUrls
 * @returns {Array<{type: string, value: string}>} Never empty: falls back to
 *   the three default slots so the editor still renders its link rows.
 */
function mergeUrls(parsedUrls, prevUrls) {
  const merged = asArray(prevUrls)
    .filter((u) => u && typeof u === 'object')
    .map((u) => ({ type: canonicalUrlType(u.type), value: str(u.value) }));

  for (const raw of asArray(parsedUrls)) {
    const entry = asObject(raw);
    const value = firstNonEmpty(entry.value, entry.url);
    if (!value) continue;
    const type = canonicalUrlType(entry.type);

    // Already present under some type, possibly one the user re-labelled.
    if (merged.some((u) => u.value.toLowerCase() === value.toLowerCase())) continue;

    // Prefer an empty slot of this type, then any slot of this type.
    const slot = merged.find((u) => u.type === type && !u.value)
      || merged.find((u) => u.type === type && type !== 'Other');
    if (slot) slot.value = value;
    else merged.push({ type, value });
  }

  return merged.length ? merged : asArray(DEFAULT_PROFILE.urls).map((u) => ({ ...u }));
}

/**
 * Skills, de-duplicated case-insensitively.
 *
 * `new Set([...prev, ...parsed])` kept "Python" and "python" as two skills,
 * which then autofilled as `"Python, python"`. First spelling wins, because
 * the one the user typed is the one they chose.
 *
 * @param {Array} prevSkills Listed first: their spelling survives.
 * @param {Array} parsedSkills
 * @returns {string[]}
 */
function mergeSkills(prevSkills, parsedSkills) {
  const out = [];
  const seen = new Set();
  for (const skill of [...asArray(prevSkills), ...asArray(parsedSkills)]) {
    const s = str(skill);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * Whether a row holds anything at all.
 *
 * Parsed rows REPLACE the editor's rows — a new resume is a new history, not
 * an addition to the old one — but only when there is something to replace
 * them with. `isCurrent` is excluded because `false` is the default, not data.
 *
 * @param {object} row
 * @returns {boolean}
 */
function rowHasContent(row) {
  return Object.entries(asObject(row)).some(([key, v]) => key !== 'isCurrent' && str(v) !== '');
}

/**
 * One section of rows: the parsed ones when the parser found any, otherwise
 * the existing ones — either way hydrated to the full editor shape.
 *
 * The hydration of the fallback is not incidental. Profiles saved before this
 * change hold rows missing the keys the editor renders, and re-normalising
 * them on every upload is what repairs those in place.
 *
 * @param {Array} parsedRows
 * @param {Array} prevRows
 * @param {(entry: object) => object} rowFn
 * @returns {object[]} Never empty: falls back to one blank row.
 */
function mergeRows(parsedRows, prevRows, rowFn) {
  const parsed = asArray(parsedRows).map(rowFn).filter(rowHasContent);
  if (parsed.length) return parsed;
  const prev = asArray(prevRows).map(rowFn);
  return prev.length ? prev : [rowFn({})];
}

// ------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------

/**
 * The parser's output in the profile's own vocabulary, with no merge.
 *
 * Every renamed key is translated and every row is complete, but nothing is
 * defaulted in: a field the resume did not state comes back `''`. Exported
 * for tests and for callers that want the translation alone; ProfilesPage
 * wants the merge and calls the function below.
 *
 * @param {object} parsed Raw `data` from POST /api/parse-resume.
 * @returns {{firstName: string, lastName: string, email: string, phone: string,
 *   address: object, education: object[], experience: object[],
 *   certificates: object[], skills: string[], urls: object[],
 *   currentJob: object}}
 */
export function normalizeParsedResume(parsed) {
  const p = asObject(parsed);
  const job = asObject(p.currentJob);
  const blankAddress = Object.fromEntries(
    Object.keys(DEFAULT_PROFILE.address).map((k) => [k, ''])
  );
  return {
    firstName: firstNonEmpty(p.firstName, p.givenName),
    lastName: firstNonEmpty(p.lastName, p.familyName, p.surname),
    email: firstNonEmpty(p.email),
    phone: firstNonEmpty(p.phone, p.phoneNumber, p.mobile),
    address: mergeAddress(p.address, blankAddress),
    education: asArray(p.education).map(educationRow),
    experience: asArray(p.experience).map(experienceRow),
    certificates: asArray(p.certificates).map(certificateRow),
    skills: mergeSkills([], p.skills),
    urls: asArray(p.urls)
      .map((u) => ({ type: canonicalUrlType(asObject(u).type), value: firstNonEmpty(asObject(u).value, asObject(u).url) }))
      .filter((u) => u.value),
    currentJob: {
      company: firstNonEmpty(job.company, job.employer),
      title: firstNonEmpty(job.title, job.role),
      isCurrent: true,
    },
  };
}

/**
 * A profile with the parsed resume merged over it.
 *
 * See the merge contract in the module header: parsed wins when non-empty,
 * empty never overwrites, and the three row sections are replaced wholesale
 * when the parser found anything — a resume describes one coherent history,
 * and interleaving two of them positionally produces rows belonging to
 * neither.
 *
 * Total: any shape of input yields a complete, renderable profile. A parse
 * that found nothing returns the profile intact rather than a damaged one.
 *
 * @param {object} prev The profile currently in the editor.
 * @param {object} parsed Raw `data` from POST /api/parse-resume.
 * @returns {object} A new profile object; `prev` is not mutated.
 */
export function mergeParsedResumeIntoProfile(prev, parsed) {
  const base = { ...DEFAULT_PROFILE, ...asObject(prev) };
  const p = asObject(parsed);

  const next = {
    ...base,
    firstName: firstNonEmpty(p.firstName, p.givenName, base.firstName),
    lastName: firstNonEmpty(p.lastName, p.familyName, p.surname, base.lastName),
    email: firstNonEmpty(p.email, base.email),
    phone: firstNonEmpty(p.phone, p.phoneNumber, p.mobile, base.phone),
    address: mergeAddress(p.address, base.address),
    skills: mergeSkills(base.skills, p.skills),
    urls: mergeUrls(p.urls, base.urls),
    education: mergeRows(p.education, base.education, educationRow),
    experience: mergeRows(p.experience, base.experience, experienceRow),
    certificates: mergeRows(p.certificates, base.certificates, certificateRow),
  };

  // Current job: the parser's own field first, then whichever experience row
  // says it is current. The resume states this twice and the editor has one
  // place to put it.
  const parsedJob = asObject(p.currentJob);
  const currentRow = asObject(next.experience.find((e) => e.isCurrent));
  const prevJob = asObject(base.currentJob);
  next.currentJob = {
    company: firstNonEmpty(parsedJob.company, parsedJob.employer, currentRow.company, prevJob.company),
    title: firstNonEmpty(parsedJob.title, parsedJob.role, currentRow.title, prevJob.title),
    isCurrent: typeof prevJob.isCurrent === 'boolean' ? prevJob.isCurrent : true,
  };

  // Country / dial code, aligned from the address — but ONLY when the resume
  // itself named a country, and only against one the picker actually offers.
  //
  // Both halves of that guard earn their place. Matching an unrecognised name
  // would set the `<select>` to a value with no matching `<option>`. And
  // aligning when the parser said nothing would make this function unusable
  // for rehydrating a stored profile: the top-level Country (which drives the
  // phone dial code) and the address country are separate fields a user may
  // deliberately have set differently, and quietly collapsing them on every
  // load is not a merge, it is data loss.
  const parsedCountry = firstNonEmpty(asObject(p.address).country);
  const matched = parsedCountry
    && COUNTRIES.find((c) => c.name.toLowerCase() === parsedCountry.toLowerCase());
  if (matched) {
    next.country = matched.name;
    next.countryCode = matched.dial_code;
    next.address = { ...next.address, country: matched.name };
  }

  // Never parsed, never touched: the editor owns these and a resume upload
  // must not disturb them. Normalised in shape only, so a row saved by an
  // older build still renders as a controlled input.
  next.customFields = asArray(base.customFields).map((f) => ({
    label: str(asObject(f).label),
    value: str(asObject(f).value),
  }));

  return next;
}
