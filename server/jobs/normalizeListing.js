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
 * Codes and alternate spellings the sources actually emit, to canonical names.
 *
 * Still deliberately small, and still not a country dataset: this is the
 * ALIAS table. Adzuna puts a two-letter code in `area[0]`, Remotive writes
 * "USA", and arbeitnow — a German board — writes "Deutschland", so the same
 * country arrived under three spellings and fragmented the typeahead into
 * three buckets ('Deutschland' 48, 'Germany' 33, 'Allemagne' 1 on 2026-09-19).
 * Everything here maps to the English name used in WORLD_COUNTRIES.
 *
 * Two-letter keys are only for codes a source really sends. Adding the full
 * ISO-2 set would collide with US_STATES on a dozen entries ('de' Germany vs
 * Delaware, 'in' India vs Indiana, 'ca' Canada vs California) and the
 * disambiguation is not worth the codes nobody emits.
 */
const COUNTRY_NAMES = Object.freeze({
  us: 'United States', gb: 'United Kingdom', ca: 'Canada', au: 'Australia',
  // Spelled-out aliases, because these arrive as display text rather than as
  // a code: Remotive writes "USA" and "UK", never "us" or "gb".
  usa: 'United States', 'u.s.': 'United States', 'u.s.a.': 'United States',
  'united states of america': 'United States', 'the united states': 'United States',
  uk: 'United Kingdom', 'great britain': 'United Kingdom', uae: 'United Arab Emirates',
  in: 'India', de: 'Germany', fr: 'France', nl: 'Netherlands', sg: 'Singapore',
  nz: 'New Zealand', za: 'South Africa', pl: 'Poland', br: 'Brazil', it: 'Italy',
  es: 'Spain', at: 'Austria', ch: 'Switzerland', mx: 'Mexico',
  // Endonyms and cross-language exonyms. Every one of these was observed in
  // location_country in production before the guard below existed.
  deutschland: 'Germany', allemagne: 'Germany', duitsland: 'Germany',
  germania: 'Germany', alemania: 'Germany',
  frankreich: 'France', frankrijk: 'France', francia: 'France',
  österreich: 'Austria', oesterreich: 'Austria', autriche: 'Austria',
  schweiz: 'Switzerland', suisse: 'Switzerland', svizzera: 'Switzerland',
  nederland: 'Netherlands', 'the netherlands': 'Netherlands', holland: 'Netherlands',
  belgië: 'Belgium', belgie: 'Belgium', belgique: 'Belgium', belgien: 'Belgium',
  españa: 'Spain', espana: 'Spain', espagne: 'Spain',
  italia: 'Italy', italie: 'Italy',
  polska: 'Poland', polen: 'Poland',
  brasil: 'Brazil', brasilien: 'Brazil',
  méxico: 'Mexico', mexiko: 'Mexico',
  sverige: 'Sweden', danmark: 'Denmark', norge: 'Norway', suomi: 'Finland',
  'česko': 'Czechia', 'czech republic': 'Czechia', tschechien: 'Czechia',
  'korea, south': 'South Korea', 'republic of korea': 'South Korea',
  'korea, north': 'North Korea', 'democratic people\'s republic of korea': 'North Korea',
  türkiye: 'Turkey', turkiye: 'Turkey',
});

/**
 * Every country name the validator will accept, lowercase.
 *
 * ═══ WHY THIS EXISTS AND WHY IT IS LONG ═══
 *
 * It used to be `new Set(Object.values(COUNTRY_NAMES))` — twenty names, enough
 * to tell a lone "Canada" from a city called Canada in the single-segment
 * branch. splitLocation now uses it as a GATE on the multi-segment branch too
 * (see the comment there), and the requirements are not the same: as an
 * aliaser a short list is fine, because an unknown value passes through
 * unchanged. As a validator a short list is actively wrong — "Lisbon,
 * Portugal" would fail the gate and Portugal would be filed as a region.
 *
 * So the gate needs real coverage, and this is it. Static data, no dependency.
 * Spellings are the common English exonyms; endonyms and codes reach them
 * through COUNTRY_NAMES above.
 */
const WORLD_COUNTRIES = [
  'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Argentina', 'Armenia', 'Australia',
  'Austria', 'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium',
  'Belize', 'Benin', 'Bhutan', 'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei',
  'Bulgaria', 'Burkina Faso', 'Burundi', 'Cambodia', 'Cameroon', 'Canada', 'Cape Verde',
  'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia', 'Comoros', 'Costa Rica',
  'Croatia', 'Cuba', 'Cyprus', 'Czechia', 'Democratic Republic of the Congo', 'Denmark',
  'Djibouti', 'Dominica', 'Dominican Republic', 'Ecuador', 'Egypt', 'El Salvador',
  'Equatorial Guinea', 'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia', 'Fiji', 'Finland', 'France',
  'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Grenada', 'Guatemala', 'Guinea',
  'Guinea-Bissau', 'Guyana', 'Haiti', 'Honduras', 'Hong Kong', 'Hungary', 'Iceland', 'India',
  'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy', 'Ivory Coast', 'Jamaica', 'Japan',
  'Jordan', 'Kazakhstan', 'Kenya', 'Kiribati', 'Kosovo', 'Kuwait', 'Kyrgyzstan',
  'Laos', 'Latvia', 'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania',
  'Luxembourg', 'Macau', 'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta',
  'Mauritania', 'Mauritius', 'Mexico', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Morocco',
  'Mozambique', 'Myanmar', 'Namibia', 'Nepal', 'Netherlands', 'New Zealand', 'Nicaragua', 'Niger',
  'Nigeria', 'North Korea', 'North Macedonia', 'Norway', 'Oman', 'Pakistan', 'Palestine', 'Panama',
  'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal', 'Puerto Rico',
  'Qatar', 'Romania', 'Russia', 'Rwanda', 'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles',
  'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia', 'Somalia', 'South Africa', 'South Sudan',
  'South Korea', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden', 'Switzerland', 'Syria', 'Taiwan',
  'Tajikistan', 'Tanzania', 'Thailand', 'Togo', 'Trinidad and Tobago', 'Tunisia', 'Turkey',
  'Turkmenistan', 'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States',
  'Uruguay', 'Uzbekistan', 'Vanuatu', 'Venezuela', 'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe',
];

/**
 * lowercase spelling -> the canonical spelling to store.
 *
 * One map for both tables, so "deutschland", "DE" and "GERMANY" all land on
 * the single string "Germany" and the typeahead offers one bucket instead of
 * three. Canonicalising the CASE matters as much as the spelling: the facet
 * tally in /api/jobs/locations groups on the exact stored value.
 */
const COUNTRY_BY_LOWER = new Map([
  ...WORLD_COUNTRIES.map((name) => [name.toLowerCase(), name]),
  ...Object.entries(COUNTRY_NAMES).map(([alias, name]) => [alias, name]),
]);

/**
 * US state abbreviations -> the canonical name to STORE.
 *
 * ═══ WHY A MAP AND NOT A SET ═══
 *
 * It was a Set, and splitLocation stored `last.toUpperCase()` — the code, not
 * the name. Meanwhile the structured (Adzuna) branch stored `area[1]`, which
 * is the full name. So one state occupied two rows of the location facets,
 * each holding part of its listings, and picking either got you that half.
 * Measured on the live pool 2026-09-20: CA(105, all from `ats`) alongside
 * California(55, adzuna + remoteok), and NY(144) alongside New York(38).
 *
 * This is the same failure the COUNTRY_NAMES table above exists to prevent —
 * "Deutschland"/"DE"/"Germany" fragmenting one country into three buckets —
 * arriving one column to the left. The fix is the same shape: one alias table,
 * one canonical spelling, resolved through canonicalRegion().
 *
 * NOTE ON 'de'. It is Delaware here and Germany in COUNTRY_NAMES, and the
 * free-text branch below checks this table FIRST, so "Berlin, DE" is read as
 * Delaware. That collision predates this table and is not made worse by it —
 * but expanding the stored value to "Delaware" does make a wrong parse read as
 * a confident one. One row in the live pool (an arbeitnow listing) is affected.
 * Fixing it properly means disambiguating on the city, which is a different
 * change; see the region-inference note in splitLocation.
 */
const US_STATE_NAMES = Object.freeze({
  al: 'Alabama', ak: 'Alaska', az: 'Arizona', ar: 'Arkansas', ca: 'California',
  co: 'Colorado', ct: 'Connecticut', de: 'Delaware', fl: 'Florida', ga: 'Georgia',
  hi: 'Hawaii', id: 'Idaho', il: 'Illinois', in: 'Indiana', ia: 'Iowa',
  ks: 'Kansas', ky: 'Kentucky', la: 'Louisiana', me: 'Maine', md: 'Maryland',
  ma: 'Massachusetts', mi: 'Michigan', mn: 'Minnesota', ms: 'Mississippi',
  mo: 'Missouri', mt: 'Montana', ne: 'Nebraska', nv: 'Nevada', nh: 'New Hampshire',
  nj: 'New Jersey', nm: 'New Mexico', ny: 'New York', nc: 'North Carolina',
  nd: 'North Dakota', oh: 'Ohio', ok: 'Oklahoma', or: 'Oregon', pa: 'Pennsylvania',
  ri: 'Rhode Island', sc: 'South Carolina', sd: 'South Dakota', tn: 'Tennessee',
  tx: 'Texas', ut: 'Utah', vt: 'Vermont', va: 'Virginia', wa: 'Washington',
  wv: 'West Virginia', wi: 'Wisconsin', wy: 'Wyoming', dc: 'District of Columbia',
});

/** The abbreviations alone, so "San Francisco, CA" resolves to a country. */
const US_STATES = new Set(Object.keys(US_STATE_NAMES));

/**
 * Canadian province abbreviations -> the canonical name to store.
 *
 * Without this, 'ON' failed the US_STATES check, fell through to the trailing
 * segment, and was stored as a COUNTRY called "ON" — one of the values that
 * sent the country typeahead off the rails.
 *
 * 'NL' IS DELIBERATELY ABSENT. It is both Newfoundland and Labrador and the
 * Netherlands' country code, and "Amsterdam, NL" is far likelier in a jobs
 * feed than a Newfoundland posting. COUNTRY_NAMES already resolves it to
 * Netherlands; adding it here would take that away to serve the rarer case.
 */
const CA_PROVINCE_NAMES = Object.freeze({
  ab: 'Alberta', bc: 'British Columbia', mb: 'Manitoba', nb: 'New Brunswick',
  ns: 'Nova Scotia', nt: 'Northwest Territories', nu: 'Nunavut', on: 'Ontario',
  pe: 'Prince Edward Island', qc: 'Quebec', sk: 'Saskatchewan', yt: 'Yukon',
});

/** The abbreviations alone, so "Toronto, ON" resolves to a country. */
const CA_PROVINCES = new Set(Object.keys(CA_PROVINCE_NAMES));

/**
 * lowercase spelling -> the canonical region spelling to store.
 *
 * Both directions in one map, exactly like COUNTRY_BY_LOWER: the CODE ('tx')
 * and the NAME in any case ('texas', 'TEXAS') both land on 'Texas'. Case
 * matters as much as spelling here, because the facet tally in
 * /api/jobs/locations groups on the exact stored string.
 *
 * Codes and names cannot collide — no state or province is named after another
 * one's two-letter code — so the spread order below is not load-bearing.
 */
const REGION_BY_LOWER = new Map([
  ...Object.values(US_STATE_NAMES).map((name) => [name.toLowerCase(), name]),
  ...Object.values(CA_PROVINCE_NAMES).map((name) => [name.toLowerCase(), name]),
  ...Object.entries(US_STATE_NAMES),
  ...Object.entries(CA_PROVINCE_NAMES),
]);

/** Spelled-out region NAMES only, per country, for the inference below. */
const US_STATE_BY_NAME = new Set(Object.values(US_STATE_NAMES).map((n) => n.toLowerCase()));
const CA_PROVINCE_BY_NAME = new Set(Object.values(CA_PROVINCE_NAMES).map((n) => n.toLowerCase()));

/**
 * Region names that are ALSO country names. The country wins.
 *
 * Exactly one entry, and it is not a guess: every US state and Canadian
 * province name was checked against canonicalCountry, and Georgia is the only
 * collision. It is kept as a set rather than an `if` because the check belongs
 * next to the data it guards — if WORLD_COUNTRIES ever gains a name that
 * collides, this is where the next reader will look.
 *
 * WHY THE COUNTRY WINS. "Tbilisi, Georgia" and "Atlanta, Georgia" are
 * genuinely ambiguous from the string alone, and the two errors are not equal:
 * filing the country Georgia as a US state puts its listings behind a filter
 * for the wrong continent, while leaving "Atlanta, Georgia" with a null
 * country costs it one filter it was already missing before this change. So
 * the ambiguous case keeps the behaviour it has always had.
 */
const REGION_COUNTRY_COLLISIONS = new Set(['georgia']);

/**
 * The country a spelled-out region name implies, or null.
 *
 * Only NAMES reach this — the two-letter codes are matched earlier, by
 * US_STATES / CA_PROVINCES, because a bare code is far more likely to be a
 * state than anything else. A name is the safer signal of the two and this is
 * the later, weaker check.
 *
 * Exported for the same reason canonicalCountry and canonicalRegion are: the
 * backfill in scripts/ repairs rows it did not parse and must reach the
 * identical judgement, Georgia exclusion included. A second copy of that rule
 * is how these columns drift apart in the first place.
 *
 * @param {string} lower A lowercased trailing segment.
 * @returns {string|null} 'United States', 'Canada', or null.
 */
export function countryOfRegionName(lower) {
  if (REGION_COUNTRY_COLLISIONS.has(lower)) return null;
  if (US_STATE_BY_NAME.has(lower)) return 'United States';
  if (CA_PROVINCE_BY_NAME.has(lower)) return 'Canada';
  return null;
}

/** Separators a source uses between two whole locations in one string. */
const MULTI_LOCATION_SPLIT = /[\u2022;|]/;

/**
 * Broad regions that are neither a city nor a country. Remotive's entire
 * location vocabulary, plus what the aggregators use for a continent.
 */
const BROAD_REGIONS = /^(worldwide|anywhere|remote|global|europe|americas|apac|latam|emea|asia|africa|oceania|middle east|north america|south america)$/i;

/**
 * The canonical country name for a value, or null when it is not a country.
 *
 * The GATE, exported because two callers need to agree on it exactly:
 * splitLocation when it decides whether a trailing segment may be promoted to
 * a country, and the one-off backfill in scripts/, which must be able to ask
 * "is what we already stored a country at all?" of a row it did not parse.
 * A second, drifting copy of that judgement is how the column got into the
 * state the backfill exists to repair.
 *
 * @param {unknown} value Any location fragment.
 * @returns {string|null} The canonical spelling, or null.
 */
export function canonicalCountry(value) {
  const t = String(value ?? '').trim();
  if (!t) return null;
  return COUNTRY_BY_LOWER.get(t.toLowerCase()) || null;
}

/**
 * The canonical spelling for a US state or Canadian province, or null.
 *
 * ALIAS SEMANTICS, NOT VALIDATION — the mirror of canonicalCountry, and the
 * difference matters at every call site. A null here means "not a US state or
 * Canadian province", which for a region is the ORDINARY case: Île-de-France,
 * Bayern and Hillsborough County are all real regions this table has never
 * heard of. So callers fold with `canonicalRegion(v) || v` and pass unknown
 * values through untouched, rather than treating null as a rejection.
 *
 * Exported for the same reason canonicalCountry is: the backfill in scripts/
 * has to reach the identical judgement about a row it did not parse, and a
 * second drifting copy of that judgement is how this column got into the state
 * a backfill is needed to repair.
 *
 * @param {unknown} value Any region fragment — a code, a name, any case.
 * @returns {string|null} The canonical spelling, or null when unrecognised.
 */
export function canonicalRegion(value) {
  const t = String(value ?? '').trim();
  if (!t) return null;
  return REGION_BY_LOWER.get(t.toLowerCase()) || null;
}

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
 *   "Toronto, ON"         -> city + region, country inferred from the province
 *   "Bengaluru, India"    -> city + country
 *   "London"              -> city only
 *   "Remote (US)"         -> the `remote` flag already covers this; no city
 *   "Europe", "Worldwide" -> a REGION, not a city (Remotive's whole format)
 *   "Dresden, Altmarkt 21/22" -> city + region; NOT a country called
 *                            "Altmarkt 21/22"
 *
 * ═══ THE TRAILING SEGMENT IS NOT A COUNTRY UNTIL IT IS RECOGNISED ═══
 *
 * This is the rule the multi-segment branch used to be missing, and it cost
 * the country filter. The branch ended `country: named(last)`, which wrote
 * whatever came after the last comma into location_country unconditionally —
 * `named` only rewrites values it knows and passes the rest through. A single
 * day of ingest put these in the COUNTRY column in production:
 *
 *   "Dresden, Altmarkt 21/22"            -> country "Altmarkt 21/22"  (a street)
 *   "Paris, Paris"                       -> country "Paris"           (a city)
 *   "Toronto, ON"                        -> country "ON"              (a province)
 *   "Düsseldorf, North Rhine-Westphalia" -> country "North Rhine-Westphalia"
 *
 * The typeahead then offered every one of them as a country to pick, and
 * picking a real one returned a third of its jobs because the rest were filed
 * under a state or a street. The single-segment branch below had always
 * validated before committing; this one now does the same, and an
 * unrecognised trailing segment degrades to a REGION — the weaker claim —
 * rather than being promoted to a country.
 *
 * That gate is only as good as COUNTRY_BY_LOWER is complete, which is why
 * that table is no longer twenty entries. A country missing from it is not
 * silently mangled any more, but it is still misfiled as a region, so add it
 * there rather than loosening the gate here.
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
  /** Alias-resolved, for a slot already known to hold a country. */
  const named = (v) => {
    const t = clean(v);
    if (!t) return null;
    return canonicalCountry(t) || t;
  };
  const asCountry = (v) => canonicalCountry(clean(v));
  /**
   * Alias-resolved, for a slot already known to hold a region.
   *
   * Folds 'TX' and 'texas' onto 'Texas' and leaves everything else alone —
   * see canonicalRegion on why an unrecognised region is normal rather than
   * an error. Applied on EVERY path that writes a region, which is the point:
   * the two branches disagreeing about how to spell one state is the whole
   * defect this replaced.
   */
  const asRegion = (v) => {
    const t = clean(v);
    if (!t) return null;
    return canonicalRegion(t) || t;
  };

  // ── Structured (Adzuna) ────────────────────────────────────────────
  // area[0] IS the country by the provider's contract, so it is aliased, not
  // gated: a country Adzuna names and this file has never heard of should be
  // stored as given rather than thrown away.
  const parts = Array.isArray(area) ? area.map(clean).filter(Boolean) : [];
  if (parts.length) {
    return {
      country: named(parts[0]),
      // area[1] is the state/province. Skipped when the array is only
      // [country, city], which is what a country-level posting looks like.
      // Folded through asRegion so Adzuna's "Texas" and an ATS board's "TX"
      // reach the facets as one value rather than two.
      region: parts.length > 2 ? asRegion(parts[1]) : null,
      city: parts.length > 1 ? parts[parts.length - 1] : null,
    };
  }

  // ── Free text (ATS, Remotive, arbeitnow) ───────────────────────────
  // A multi-location string ("SF - New York - United States") is not one
  // place, so only its first location is taken rather than inventing a
  // composite nobody can search for. Both separators are real: Remotive uses
  // the bullet, arbeitnow uses a semicolon ("Lille - Btwin Village, Nord;
  // Paris, Paris"), and splitting on only one of them let the other collapse
  // two places into a single bogus row.
  const first = String(display ?? '').split(MULTI_LOCATION_SPLIT)[0];
  const segs = first.split(',').map(clean).filter(Boolean);
  if (!segs.length) return { city: null, region: null, country: null };

  const last = segs[segs.length - 1];
  const lastLower = last.toLowerCase();

  if (segs.length === 1) {
    // One token: a country or a broad region if we recognise it as one,
    // otherwise a city. "Worldwide"/"Europe" are Remotive's whole vocabulary
    // and are neither a city nor a country.
    const solo = asCountry(last);
    if (solo) return { city: null, region: null, country: solo };
    if (BROAD_REGIONS.test(last)) return { city: null, region: last, country: null };
    return { city: last, region: null, country: null };
  }

  // The stored value is the NAME, not the code that was matched. Storing the
  // code is what split California into CA(105) and California(55); the code is
  // only ever an input spelling, never the canonical one.
  //
  if (US_STATES.has(lastLower)) {
    return { city: segs[0], region: US_STATE_NAMES[lastLower], country: 'United States' };
  }
  if (CA_PROVINCES.has(lastLower)) {
    return { city: segs[0], region: CA_PROVINCE_NAMES[lastLower], country: 'Canada' };
  }

  // A state or province spelled out rather than abbreviated. "Austin, Texas"
  // used to reach the trailing-segment return below and store region 'Texas'
  // with a NULL country, while "Austin, TX" got 'United States' from the
  // branch above — the same place described two ways, landing in the country
  // filter only half the time.
  //
  // Checked AFTER the codes and BEFORE asCountry, which is the order that
  // keeps Georgia working: it is excluded here (see
  // REGION_COUNTRY_COLLISIONS) and so still falls through to asCountry and is
  // read as the country, exactly as before.
  const regionCountry = countryOfRegionName(lastLower);
  if (regionCountry) {
    return { city: segs[0], region: asRegion(last), country: regionCountry };
  }

  const country = asCountry(last);
  if (country) {
    return { city: segs[0], region: segs.length > 2 ? asRegion(segs[1]) : null, country };
  }

  // Not a country. `last` is the broadest thing said about this place, so it
  // is the best region candidate — and a wrong region costs a filter nobody
  // reaches for, where a wrong country corrupts the one they do.
  return { city: segs[0], region: asRegion(last), country: null };
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
