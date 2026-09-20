/**
 * One-off: re-derive location_city / location_region / location_country for
 * rows already in job_listings.
 *
 * ═══ WHY THIS EXISTS ═══
 *
 * splitLocation used to write the last comma-separated segment of a display
 * string into location_country with no check that it was a country. By
 * 2026-09-19 the column held street addresses ("Altmarkt 21/22"), cities
 * ("Paris"), Canadian provinces ("ON") and German states ("Brandenburg") —
 * all offered to users as countries to filter by. The parser is fixed; this
 * repairs what the broken version already stored, instead of waiting for the
 * ingest cursor to re-walk 3,900 rows over the next several weeks.
 *
 * ═══ WHAT IT WILL NOT DO ═══
 *
 * It must not regress Adzuna. Those rows were parsed from the provider's
 * STRUCTURED `area` array — which is not stored on the row — so re-parsing
 * their display string is strictly worse: "Tampa Palms, Hillsborough County"
 * yields no country at all, and blindly rewriting would delete a correct
 * "United States" and replace the region "Florida" with a county.
 *
 * So a row is only rewritten when what it currently holds is NOT a country
 * (canonicalCountry says null). A row whose country is already real is left
 * alone, except to fold its spelling onto the canonical one — "Deutschland",
 * "GERMANY" and "DE" all become "Germany", which is what un-splits the
 * typeahead's three German buckets.
 *
 * Dry run unless --write is passed. Read-only without it.
 */
import '../server/load-env.js';
import { supabaseAdmin } from '../server/supabase.js';
import { splitLocation, canonicalCountry } from '../server/jobs/normalizeListing.js';

const WRITE = process.argv.includes('--write');
const PAGE = 1000;
/**
 * PATCHes in flight at once.
 *
 * 200 was the first attempt and Node's fetch gave up with a bare
 * "TypeError: fetch failed" partway through the first chunk — the pool cannot
 * take that many sockets to one host. Small and sequential is fine here: this
 * runs once, against a few hundred rows.
 */
const CHUNK = 8;

/**
 * What this row should hold, or null to leave it untouched.
 *
 * ═══ ADZUNA IS A SEPARATE CASE, AND MUST STAY ONE ═══
 *
 * Its parts came from the provider's structured `area` array, which the row
 * does not store. Re-parsing its display string is not a repair, it is a
 * downgrade: "Roscoe, Winnebago County" yields region "Winnebago County",
 * and Adzuna's display string names a COUNTY where `area` named the state —
 * that gap is the entire reason migration 004 exists. Measured on the live
 * pool, doing it anyway would have written 2,188 US counties into the region
 * column and buried the real regions in the typeahead.
 *
 * It also needs no repair: zero Adzuna rows hold a non-country in
 * location_country (checked across all 3,923 rows), because `area[0]` really
 * is the country. So the only edit it can want is a spelling fold, and its
 * null parts are left for a re-ingest to fill from `area` properly.
 *
 * Every other source only ever had the display string to go on, so the fixed
 * parser's opinion supersedes the broken one's wholesale — including the city
 * and region, which the same broken pass produced ("Nord; Paris" as a region,
 * "Remote" and "Taiwan" as cities).
 */
function repair(row) {
  const current = row.location_country;

  if (row.source === 'adzuna') {
    const canonical = canonicalCountry(current);
    if (canonical && canonical !== current) {
      return { ...parts(row), location_country: canonical };
    }
    return null;
  }

  // Nothing to re-derive from. Clearing the parts would be destruction, not
  // repair, so a row with no display string is left exactly as it is.
  if (!String(row.location ?? '').trim()) return null;

  const next = splitLocation(null, row.location);
  const merged = {
    location_city: next.city,
    location_region: next.region,
    location_country: next.country,
  };
  return changed(row, merged) ? merged : null;
}

const parts = (row) => ({
  location_city: row.location_city,
  location_region: row.location_region,
  location_country: row.location_country,
});

const changed = (row, next) =>
  row.location_city !== next.location_city
  || row.location_region !== next.location_region
  || row.location_country !== next.location_country;

/**
 * One row's update, retried once on a transport failure.
 *
 * Idempotent by construction — it writes absolute values, not deltas — so a
 * retry after an ambiguous failure cannot double-apply anything. The whole
 * script is re-runnable for the same reason: it recomputes from whatever is
 * currently stored.
 */
async function patch(e, attempt = 0) {
  const result = await supabaseAdmin
    .from('job_listings')
    .update({
      location_city: e.location_city,
      location_region: e.location_region,
      location_country: e.location_country,
    })
    .eq('id', e.id);
  if (result.error && attempt < 2) {
    await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    return patch(e, attempt + 1);
  }
  return result;
}

async function main() {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('job_listings')
      .select('id,source,location,location_city,location_region,location_country')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }

  const edits = [];
  const tally = { canonicalised: 0, countryCleared: 0, countryGained: 0, partsFilled: 0 };
  const clearedExamples = [];
  const gainedExamples = [];

  for (const row of rows) {
    const next = repair(row);
    if (!next) continue;
    edits.push({ id: row.id, ...next });

    const before = row.location_country;
    const after = next.location_country;
    if (before && after && before !== after) {
      tally.canonicalised += 1;
    } else if (before && !after) {
      tally.countryCleared += 1;
      if (clearedExamples.length < 8) clearedExamples.push(`${row.location}  [${before}] -> region ${next.location_region}`);
    } else if (!before && after) {
      tally.countryGained += 1;
      if (gainedExamples.length < 8) gainedExamples.push(`${row.location}  -> ${after}`);
    } else {
      tally.partsFilled += 1;
    }
  }

  console.log(`rows scanned          ${rows.length}`);
  console.log(`rows to change        ${edits.length}`);
  console.log(`  country canonicalised  ${tally.canonicalised}   (Deutschland -> Germany)`);
  console.log(`  bogus country cleared  ${tally.countryCleared}   (demoted to region)`);
  console.log(`  country recovered      ${tally.countryGained}`);
  console.log(`  city/region only       ${tally.partsFilled}`);
  if (clearedExamples.length) console.log('\ncleared examples:\n  ' + clearedExamples.join('\n  '));
  if (gainedExamples.length) console.log('\nrecovered examples:\n  ' + gainedExamples.join('\n  '));

  if (!WRITE) {
    console.log('\nDRY RUN — nothing written. Re-run with --write to apply.');
    return;
  }

  let written = 0;
  for (let i = 0; i < edits.length; i += CHUNK) {
    const slice = edits.slice(i, i + CHUNK);
    // One PATCH per row: PostgREST has no multi-row UPDATE with per-row
    // values, and an upsert here would need every NOT NULL column on the
    // table. These are three nullable columns on a row that already exists.
    const results = await Promise.all(slice.map((e) => patch(e)));
    const failed = results.filter((r) => r.error);
    if (failed.length) throw new Error(`chunk at ${i} failed: ${failed[0].error.message}`);
    written += slice.length;
    console.log(`  written ${written}/${edits.length}`);
  }
  console.log(`\nDone. ${written} rows updated.`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
