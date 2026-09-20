/**
 * One-off: fold location_region onto one canonical spelling per place, and
 * fill the location_country that a spelled-out region implies.
 *
 * ═══ WHY THIS EXISTS ═══
 *
 * splitLocation reached a region two ways and they disagreed about how to
 * spell it. The free-text branch matched a two-letter code and stored the
 * CODE ('CA'); the structured Adzuna branch stored the provider's NAME
 * ('California'). So one state occupied two rows of the location facets, each
 * holding part of its listings, and picking either in the dropdown returned
 * only that half. Measured on the live pool 2026-09-20:
 *
 *   CA(105) [ats]              + California(55) [adzuna, remoteok]
 *   NY(144) [ats]              + New York(38)   [adzuna, remoteok]
 *   UT(1)   [remoteok]         + Utah(6)        [adzuna]
 *   DE(1)   [arbeitnow]        + Delaware(2)    [adzuna]
 *   DC(1), BC(1), ON(6)        — renamed, nothing to merge with
 *
 * The parser is fixed. This repairs the 259 rows the old one already wrote,
 * instead of waiting for each source's ingest cursor to re-walk them.
 *
 * ═══ WHY THIS IS SAFER THAN backfill-location-parts.mjs ═══
 *
 * That script re-derives all three parts by re-parsing the display string,
 * which is why it has to exclude Adzuna: those rows were parsed from a
 * structured `area` array the row does not store, so re-parsing their display
 * string is a downgrade ("Tampa Palms, Hillsborough County" yields a county,
 * not Florida).
 *
 * This one never parses anything. It reads location_region and asks
 * canonicalRegion — the same function splitLocation now uses — for the
 * canonical spelling of THAT STRING. No display string is consulted, no other
 * column is touched, and a value the table does not recognise is left exactly
 * as it is. So it is safe on every source including Adzuna, and running it
 * twice is a no-op: canonicalRegion('California') is 'California'.
 *
 * ═══ THE ONE THING IT MAKES WORSE, STATED PLAINLY ═══
 *
 * 'DE' is Delaware in the state table and Germany in the country table, and
 * splitLocation checks states first, so an arbeitnow listing in Germany was
 * read as Delaware. One live row. This script rewrites its region to
 * 'Delaware', which does not change what the row means but does make a wrong
 * parse read as a confident one. Fixing that needs city-based disambiguation
 * in splitLocation, which is a different change.
 *
 * Dry run unless --write is passed. Read-only without it.
 */
import '../server/load-env.js';
import { supabaseAdmin } from '../server/supabase.js';
import { canonicalRegion, countryOfRegionName } from '../server/jobs/normalizeListing.js';

const WRITE = process.argv.includes('--write');
const PAGE = 1000;
/** See backfill-location-parts.mjs: 200 in flight exhausts Node's socket pool. */
const CHUNK = 8;

/** One row's update, retried once on a transport failure. Idempotent. */
async function patch(edit, attempt = 0) {
  // Only the columns this row actually changes. `location_country` is absent
  // from the payload for a spelling-only fold, so a row whose country is
  // already correct cannot be touched by the region pass.
  const update = { location_region: edit.location_region };
  if (edit.location_country) update.location_country = edit.location_country;

  const result = await supabaseAdmin
    .from('job_listings')
    .update(update)
    .eq('id', edit.id);
  if (result.error && attempt < 2) {
    await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    return patch(edit, attempt + 1);
  }
  return result;
}

async function main() {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('job_listings')
      // location_country IS LOAD-BEARING in this list, not decoration. The country
      // half below only fills a NULL, and a column that is not selected reads as
      // undefined — which is indistinguishable from null, so every row would
      // have looked like it needed one. Left out, a dry run claimed 952 rows to
      // change against a true 693, and the "never overwrites a country someone
      // else decided" guarantee would have been false while still appearing to
      // hold.
      .select('id,source,location,location_region,location_country')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }

  // What the column holds now, so the report can say which values merge into
  // which rather than only how many rows moved.
  const before = new Map();
  for (const row of rows) {
    const v = row.location_region;
    if (typeof v === 'string' && v.trim()) before.set(v, (before.get(v) || 0) + 1);
  }

  const edits = [];
  /** canonical name -> the spellings folding into it. */
  const folds = new Map();
  /** canonical name -> rows that gain a country from it. */
  const gained = new Map();
  const tally = { respelled: 0, countryFilled: 0, both: 0 };

  for (const row of rows) {
    const current = row.location_region;
    if (typeof current !== 'string' || !current.trim()) continue;

    const canonical = canonicalRegion(current) || current;
    const spellingChanged = canonical !== current;

    // ═══ THE COUNTRY HALF ═══
    //
    // "Austin, Texas" used to store region 'Texas' with a NULL country while
    // "Austin, TX" got 'United States'. The parser now agrees on both; this
    // repairs the rows the old one wrote.
    //
    // Only ever FILLS a null. A row that already names a country keeps it,
    // whatever it says — this script's whole safety argument is that it never
    // overwrites a value some other path decided, and a US state sitting under
    // a non-US country is a different defect that deserves its own look rather
    // than a silent correction here. `countryOfRegionName` is the parser's own
    // function, so Georgia is excluded here exactly as it is there.
    const needsCountry = !String(row.location_country ?? '').trim();
    const inferred = needsCountry ? countryOfRegionName(canonical.toLowerCase()) : null;

    if (!spellingChanged && !inferred) continue;

    const edit = { id: row.id };
    edit.location_region = canonical;
    if (inferred) edit.location_country = inferred;
    edits.push(edit);

    if (spellingChanged && inferred) tally.both += 1;
    else if (spellingChanged) tally.respelled += 1;
    else tally.countryFilled += 1;

    if (spellingChanged) {
      if (!folds.has(canonical)) folds.set(canonical, new Map());
      const from = folds.get(canonical);
      from.set(current, (from.get(current) || 0) + 1);
    }
    if (inferred) {
      const key = `${canonical} -> ${inferred}`;
      gained.set(key, (gained.get(key) || 0) + 1);
    }
  }

  console.log(`rows scanned            ${rows.length}`);
  console.log(`distinct regions now    ${before.size}`);
  console.log(`rows to change          ${edits.length}`);
  console.log(`  region respelled        ${tally.respelled}`);
  console.log(`  country filled in       ${tally.countryFilled}`);
  console.log(`  both                    ${tally.both}`);
  console.log(`values folding away     ${[...folds.values()].reduce((n, m) => n + m.size, 0)}`);
  console.log('');
  for (const [canonical, from] of [...folds].sort((a, b) => a[0].localeCompare(b[0]))) {
    const parts = [...from].map(([spelling, n]) => `${spelling}(${n})`).join(' + ');
    const existing = before.get(canonical) || 0;
    const total = existing + [...from.values()].reduce((a, b) => a + b, 0);
    console.log(`  ${parts}${existing ? ` + ${canonical}(${existing})` : ''}  ->  ${canonical}(${total})`);
  }

  if (gained.size) {
    console.log('\ncountry filled in from the region (null -> value only):');
    for (const [key, n] of [...gained].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${key}  (${n} rows)`);
    }
  }

  if (!WRITE) {
    console.log('\nDRY RUN — nothing written. Re-run with --write to apply.');
    return;
  }

  let written = 0;
  for (let i = 0; i < edits.length; i += CHUNK) {
    const slice = edits.slice(i, i + CHUNK);
    const results = await Promise.all(slice.map((e) => patch(e)));
    const failed = results.filter((r) => r.error);
    if (failed.length) throw new Error(`chunk at ${i} failed: ${failed[0].error.message}`);
    written += slice.length;
    console.log(`  written ${written}/${edits.length}`);
  }
  console.log(`\nDone. ${written} rows updated.`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
