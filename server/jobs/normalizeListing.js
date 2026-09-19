/**
 * Adapter output  ->  public.job_listings row.
 *
 * Adapters know their provider's field names and nothing else. Everything that
 * has to be true of EVERY row regardless of source lives here: the id prefix,
 * the truncation limit, keyword extraction, the dedupe hash, and the decision
 * to drop a row entirely.
 *
 * Contract: junk in returns null. It never throws. It is called once per item
 * inside the ingest loop, and one malformed provider record must not take down
 * a whole page of good ones.
 */
import { createHash } from 'node:crypto';
import { extractKeywords, stripHtml } from '../../src/matching/index.js';

/** Postgres `text` has no limit, but a 40k-char description is 40k we pay for on every read. */
const MAX_DESCRIPTION = 4000;
/** Matches the matcher's own working set; more than this is noise with a weight of ~0. */
const MAX_KEYWORDS = 25;
/** Enough to show a "what they're asking for" list in a card without scrolling it. */
const MAX_REQUIREMENTS = 8;
/** One requirement is one bullet; past this it is a paragraph that got mis-parsed. */
const MAX_REQUIREMENT_LEN = 160;
/** Providers hand out tag soup; 20 is well past the point of usefulness. */
const MAX_TAGS = 20;
const MAX_TAG_LEN = 80;

/**
 * Per-column caps.
 *
 * None of these are enforced by the schema — every one of those columns is a
 * bare Postgres `text`. They are this layer's own sanity limits, sized to the
 * longest plausible REAL value, so that one pathological provider record
 * cannot push kilobytes into a column that every read pays for.
 */
const MAX_TITLE = 300;
const MAX_URL = 1000;
const MAX_COMPANY = 200;
const MAX_LOCATION = 200;
const MAX_CATEGORY = 120;
const MAX_JOB_TYPE = 60;
const MAX_CURRENCY = 10;

/** The DB check constraint on description_quality allows exactly these. */
const VALID_QUALITY = new Set(['full', 'snippet']);

const MAX_LOCATION_PART = 120;

/**
 * ISO-ish country codes the sources actually emit, to full names.
 *
 * Deliberately tiny. This is not a country dataset — it exists because Adzuna
 * puts a two-letter code in `area[0]` and a user types "United States", and a
 * two-entry lookup beats a dependency. Anything not here passes through
 * unchanged, which is right: Remotive already says "Canada".
 */
const COUNTRY_NAMES = Object.freeze({
  us: 'United States', gb: 'United Kingdom', ca: 'Canada', au: 'Australia',
  // Spelled-out aliases, because these arrive as display text rather than as
  // a code: Remotive writes "USA" and "UK", never "us" or "gb".
  usa: 'United States', 'u.s.': 'United States', 'u.s.a.': 'United States',
  uk: 'United Kingdom', uae: 'United Arab Emirates',
  in: 'India', de: 'Germany', fr: 'France', nl: 'Netherlands', sg: 'Singapore',
  nz: 'New Zealand', za: 'South Africa', pl: 'Poland', br: 'Brazil', it: 'Italy',
  es: 'Spain', at: 'Austria', ch: 'Switzerland', mx: 'Mexico',
});

/**
 * Reverse of COUNTRY_NAMES: the full names, lowercased.
 *
 * Needed because a single-segment location can be either a city or a country
 * and the two are told apart only by recognising one of them. Without this
 * "Canada" — an entire Remotive location value — parsed as a city called
 * Canada, and the typeahead then offered it as one.
 */
const COUNTRY_NAME_SET = new Set(Object.values(COUNTRY_NAMES).map((n) => n.toLowerCase()));

/** US state abbreviations, so "San Francisco, CA" resolves to a country. */
const US_STATES = new Set([
  'al','ak','az','ar','ca','co','ct','de','fl','ga','hi','id','il','in','ia','ks','ky','la','me',
  'md','ma','mi','mn','ms','mo','mt','ne','nv','nh','nj','nm','ny','nc','nd','oh','ok','or','pa',
  'ri','sc','sd','tn','tx','ut','vt','va','wa','wv','wi','wy','dc',
]);

/**
 * Split a listing's location into city / region / country.
 *
 * ═══ WHY THE FREE-TEXT COLUMN WAS NOT ENOUGH ═══
 *
 * The old filter was `ilike '%<what the user typed>%'` against one string, and
 * that string is whatever the provider prints. Adzuna prints
 * "Tampa Palms, Hillsborough County" — a city and a COUNTY, never a state and
 * never a country — so "Florida" and "United States" matched nothing across
 * 83% of the pool while looking like a working filter.
 *
 * Structured input wins when there is any. Adzuna sends `area` ordered
 * broadest-first (['US','Florida','Hillsborough County','Tampa Palms']), which
 * is exactly the split, and the adapter now forwards it. ATS and Remotive send
 * only a display string, so those are parsed:
 *
 *   "San Francisco, CA"   -> city + region, country inferred from the state
 *   "Bengaluru, India"    -> city + country
 *   "London"              -> city only
 *   "Remote (US)"         -> the `remote` flag already covers this; no city
 *   "Europe", "Worldwide" -> a REGION, not a city (Remotive's whole format)
 *
 * Every field is optional and stays null rather than guessing. A wrong city is
 * worse than no city: it puts a job in a place it is not, and the typeahead
 * then offers that place to somebody.
 *
 * @param {unknown} area Structured, broadest-first, when the provider has it.
 * @param {string} display The provider's display string.
 * @returns {{city: string|null, region: string|null, country: string|null}}
 */
export function splitLocation(area, display) {
  const clean = (v) => {
    const t = String(v ?? '').replace(/\((?:HQ|hq)\)/g, '').trim();
    return t ? t.slice(0, MAX_LOCATION_PART) : null;
  };
  const named = (v) => {
    const t = clean(v);
    if (!t) return null;
    return COUNTRY_NAMES[t.toLowerCase()] || t;
  };

  // ── Structured (Adzuna) ────────────────────────────────────────────
  const parts = Array.isArray(area) ? area.map(clean).filter(Boolean) : [];
  if (parts.length) {
    return {
      country: named(parts[0]),
      // area[1] is the state/province. Skipped when the array is only
      // [country, city], which is what a country-level posting looks like.
      region: parts.length > 2 ? parts[1] : null,
      city: parts.length > 1 ? parts[parts.length - 1] : null,
    };
  }

  // ── Free text (ATS, Remotive) ──────────────────────────────────────
  // A multi-location string ("SF - New York - United States") is not one
  // place, so only its first location is taken rather than inventing a
  // composite nobody can search for.
  const first = String(display ?? '').split('\u2022')[0];
  const segs = first.split(',').map(clean).filter(Boolean);
  if (!segs.length) return { city: null, region: null, country: null };

  const last = segs[segs.length - 1];
  const lastLower = last.toLowerCase();

  if (segs.length === 1) {
    // One token: a country or a broad region if we recognise it as one,
    // otherwise a city. "Worldwide"/"Europe" are Remotive's whole vocabulary
    // and are neither a city nor a country.
    if (COUNTRY_NAMES[lastLower]) return { city: null, region: null, country: COUNTRY_NAMES[lastLower] };
    if (COUNTRY_NAME_SET.has(lastLower)) return { city: null, region: null, country: last };
    if (/^(worldwide|anywhere|europe|americas|apac|latam|emea)$/i.test(last)) {
      return { city: null, region: last, country: null };
    }
    return { city: last, region: null, country: null };
  }

  if (US_STATES.has(lastLower)) {
    return { city: segs[0], region: last.toUpperCase(), country: 'United States' };
  }
  return { city: segs[0], region: segs.length > 2 ? segs[1] : null, country: named(last) };
}


/**
 * Anything to a trimmed string, or '' when there is nothing sensible to show.
 *
 * @param {unknown} value
 * @returns {string} Objects and arrays deliberately collapse to '' rather than
 *   to "[object Object]".
 */
function str(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/**
 * @param {unknown} value
 * @returns {number|null} A finite number, or null. Infinity and NaN are null:
 *   Postgres `numeric` has no representation for them.
 */
function numOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * ISO string, or null. Providers send ISO, epoch seconds, and nonsense alike.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function isoOrNull(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  const t = d.getTime();
  return Number.isFinite(t) ? d.toISOString() : null;
}

/**
 * @param {unknown} value Expected to be an array of tag strings.
 * @returns {string[]} At most MAX_TAGS non-empty strings, each at most
 *   MAX_TAG_LEN chars. A non-array returns [].
 */
function stringArray(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    const s = str(item);
    if (s) out.push(s.slice(0, MAX_TAG_LEN));
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/**
 * Collapse a field to its comparable form for hashing: lowercase, punctuation
 * out, whitespace collapsed. "Acme, Inc." and "Acme Inc" have to land on the
 * same hash or the dedupe hint is worthless.
 *
 * @param {unknown} value
 * @returns {string}
 */
function normForHash(value) {
  return str(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * "San Francisco, CA, US" -> "san francisco". The city is the stable part.
 *
 * @param {unknown} location
 * @returns {string}
 */
function cityOf(location) {
  const first = str(location).split(',')[0];
  return normForHash(first);
}

/**
 * sha256(company|title|city) as hex.
 *
 * A *hint* that two rows may be the same opening syndicated across boards, not
 * a key. See the comment on job_listings.dedupe_hash: it is intentionally not
 * unique, because one company hiring three backend engineers in one city
 * legitimately produces three rows with an identical hash.
 *
 * @param {unknown} company
 * @param {unknown} title
 * @param {unknown} location Full location string; only the city part is used.
 * @returns {string} 64 hex characters.
 */
export function dedupeHash(company, title, location) {
  const basis = `${normForHash(company)}|${normForHash(title)}|${cityOf(location)}`;
  return createHash('sha256').update(basis).digest('hex');
}

/**
 * @param {unknown} rawListing - an adapter's toListing() output
 * @param {unknown} adapterId  - the source id; overrides rawListing.source
 * @returns {object|null} a job_listings row, or null when the row is unusable
 */
export function normalizeListing(rawListing, adapterId) {
  try {
    if (!rawListing || typeof rawListing !== 'object' || Array.isArray(rawListing)) {
      return null;
    }

    const source = str(adapterId) || str(rawListing.source);
    if (!source) return null;

    // Always String(): Adzuna ids arrive as numbers, and a numeric source_id
    // compared against a text column in Postgres is a type error at query time.
    const sourceId = String(rawListing.source_id ?? rawListing.id ?? '').trim();
    if (!sourceId) return null;

    const title = str(rawListing.title);
    const url = str(rawListing.url);
    // No title or no url means the row cannot be shown or clicked. There is
    // nothing to salvage, so it is dropped rather than stored half-formed.
    if (!title || !url) return null;

    const quality = VALID_QUALITY.has(rawListing.description_quality)
      ? rawListing.description_quality
      : 'full';

    // stripHtml first, then truncate, so the 4000 is 4000 characters of text
    // the user would actually read rather than 4000 characters of <div>.
    const description = stripHtml(str(rawListing.description))
      .trim()
      .slice(0, MAX_DESCRIPTION);

    const company = str(rawListing.company) || null;
    const location = str(rawListing.location) || null;
    // After `location`, not before it: `const` is in the temporal dead zone
    // until its declaration, and this function's catch-all would have turned
    // that ReferenceError into a silent null listing.
    const locationParts = splitLocation(rawListing.location_area, location);
    const category = str(rawListing.category) || null;
    const tags = stringArray(rawListing.tags);

    // Extraction runs on the STORED (truncated) description, not the original.
    // Keeping the two in step means a stored keyword can always be traced back
    // to text in the same row — worth more than the marginal recall from
    // extracting over text nobody will ever see.
    let extracted = { keywords: [], requirements: [] };
    try {
      extracted = extractKeywords(description, {
        source,
        title,
        category: category || undefined,
        tags,
        quality,
      }) || extracted;
    } catch {
      // A pathological description must not lose the listing; it just loses
      // its keywords and falls back to title matching.
      extracted = { keywords: [], requirements: [] };
    }

    // Stored compact as {t, w, r} rather than {term, weight, required, count}.
    // 25 keywords x ~40 rows per page x every read — the short keys are worth
    // roughly 40% of the jsonb column.
    const keywords = (Array.isArray(extracted.keywords) ? extracted.keywords : [])
      .slice(0, MAX_KEYWORDS)
      .map((k) => ({ t: str(k?.term), w: numOrNull(k?.weight) ?? 1, r: !!k?.required }))
      .filter((k) => k.t);

    // Flat mirror of keywords[].t — this is what idx_job_listings_keyword_terms
    // indexes. Derived from `keywords` (not re-extracted) so the two can never
    // disagree.
    const keywordTerms = keywords.map((k) => k.t);

    const requirements = (Array.isArray(extracted.requirements) ? extracted.requirements : [])
      .slice(0, MAX_REQUIREMENTS)
      .map((r) => str(r).slice(0, MAX_REQUIREMENT_LEN))
      .filter(Boolean);

    return {
      // Source-prefixed. Adzuna and Remotive both hand out bare integer ids and
      // they collide; 'adzuna:12345' and 'remotive:12345' do not.
      job_id: `${source}:${sourceId}`,
      source,
      source_id: sourceId,
      title: title.slice(0, MAX_TITLE),
      url: url.slice(0, MAX_URL),
      company: company ? company.slice(0, MAX_COMPANY) : null,
      location: location ? location.slice(0, MAX_LOCATION) : null,
      location_city: locationParts.city,
      location_region: locationParts.region,
      location_country: locationParts.country,
      category: category ? category.slice(0, MAX_CATEGORY) : null,
      job_type: str(rawListing.job_type).slice(0, MAX_JOB_TYPE) || null,
      remote: !!rawListing.remote,
      description,
      tags,
      keywords,
      keyword_terms: keywordTerms,
      requirements,
      salary_min: numOrNull(rawListing.salary_min),
      salary_max: numOrNull(rawListing.salary_max),
      salary_currency: str(rawListing.salary_currency).slice(0, MAX_CURRENCY) || null,
      description_quality: quality,
      dedupe_hash: dedupeHash(company, title, location),
      posted_at: isoOrNull(rawListing.posted_at),
    };
  } catch {
    // Belt and braces. The contract this function sells to ingest.js is "never
    // throws", and that promise is worth more than a diagnosable stack trace
    // for one bad row out of fifty.
    return null;
  }
}

export default normalizeListing;
