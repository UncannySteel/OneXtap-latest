import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Activity, AlertTriangle, Briefcase, Building2, ChevronDown, Clock, ExternalLink, Info, MapPin, Sparkles, UploadCloud } from 'lucide-react';
import ResumeSwitcher from '../shared/ResumeSwitcher';
import { useFileDrop } from '../shared/useFileDrop';
import { parseResumeFile, MAX_RESUME_LABEL } from '../../resumeParse';
import { getActiveResume, saveParsedResume } from '../../resumeStore';
import { rankJobs, explainJob, fetchJobsMeta, fetchJobLocations } from '../../jobsApi';
import { buildResumeProfile, missingKeywords, keywordCoverage, MATCHER_VERSION } from '../../matching/index.js';
import { log as baseLog } from '../../logger';

const log = baseLog.child('ui');

// ══════════════════════════════════════════════════════════════════
// Class tokens
// ══════════════════════════════════════════════════════════════════
// Written once each, base token first and its hand-written `dark:` twin
// appended, so dark mode cannot drift between two copies of the same surface.
// Tailwind's `darkMode: 'class'` means nothing here is derived automatically —
// every colour, border and shadow below needs its twin spelled out.

const CARD = 'bg-white/80 backdrop-blur-sm rounded-3xl border border-onextap-primary/15 p-8 shadow-lg shadow-onextap-dark/5 dark:bg-onextap-night-surface/80 dark:border-onextap-primary-light/20 dark:shadow-[0_12px_40px_rgba(0,0,0,0.45)]';

const JOB_CARD = 'bg-white/70 backdrop-blur-sm border border-onextap-primary/15 rounded-2xl p-5 group hover:bg-white/90 hover:shadow-md transition-all duration-200 dark:bg-onextap-night-card/70 dark:border-onextap-primary-light/20 dark:hover:bg-onextap-night-card dark:hover:shadow-[0_8px_28px_rgba(0,0,0,0.35)]';

// `text-white` keeps its explicit `dark:` twin: the dark background under it is
// also dark, so white is right in both themes — spelled out so the next reader
// knows that is a decision and not an omission.
const BTN_PRIMARY = 'bg-onextap-dark text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-onextap-dark/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-md shadow-onextap-dark/20 dark:bg-onextap-primary dark:text-white dark:hover:bg-onextap-primary-dark dark:shadow-[0_6px_20px_rgba(0,0,0,0.4)]';

const BTN_GHOST = 'text-xs font-medium px-2.5 py-1.5 rounded-lg border border-onextap-primary/20 text-onextap-primary hover:bg-onextap-primary/10 transition-colors dark:border-onextap-primary-light/30 dark:text-onextap-olive-pale dark:hover:bg-onextap-primary/25';

const BADGE = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold leading-none text-onextap-primary bg-onextap-primary/10 border border-onextap-primary/20 dark:text-onextap-olive-pale dark:bg-onextap-primary/25 dark:border-onextap-primary-light/30';

const FIELD = 'w-full px-4 py-3 border border-onextap-primary/20 rounded-xl text-sm bg-white/80 focus:outline-none focus:border-onextap-primary/40 focus:ring-2 focus:ring-onextap-primary/10 transition-all text-onextap-dark dark:bg-onextap-night-card dark:text-[#E8EFD8] dark:border-onextap-primary-light/25 dark:focus:border-onextap-primary-light/50 dark:focus:ring-onextap-primary/20';

const SKELETON = 'h-10 animate-pulse rounded-xl bg-onextap-primary/10 dark:bg-onextap-primary-light/15';

const AMBER_BOX = 'rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200';

const RED_BOX = 'rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300';

const HEADING = 'text-lg font-semibold text-onextap-dark dark:text-[#E8EFD8]';
const SUBTEXT = 'text-sm text-onextap-secondary dark:text-[#9AB07A]';
const MUTED = 'text-xs text-onextap-muted dark:text-[#9AB07A]';
const FIELD_LABEL = 'mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.08em] text-onextap-muted dark:text-[#9AB07A]';

/** The emphasised first line of a box or a list row. */
const STRONG_TEXT = 'font-medium text-onextap-dark dark:text-[#E8EFD8]';

/** "This one item is degraded" pill — re-upload needed, low detail, not evidenced. */
const AMBER_PILL = 'inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold leading-none text-amber-700 dark:border-amber-700/40 dark:bg-amber-900/25 dark:text-amber-200';

/** Muted pill, for a fact about a card that is not a warning. */
const MUTED_PILL = 'inline-flex items-center gap-1 rounded-full border border-onextap-primary/20 bg-onextap-primary/5 px-2 py-0.5 text-[10px] font-semibold leading-none text-onextap-muted dark:border-onextap-primary-light/20 dark:bg-white/[0.04] dark:text-[#9AB07A]';

/** Centred "there is nothing to show, and that is not an error" panel. */
const EMPTY_BOX = 'rounded-2xl border border-onextap-primary/15 bg-onextap-primary/[0.04] px-5 py-8 text-center dark:border-onextap-primary-light/20 dark:bg-white/[0.03]';

/** Spinner-plus-label row shown while a request is in flight. */
const BUSY_ROW = 'flex items-center gap-2 text-sm font-medium text-onextap-primary dark:text-onextap-olive-pale';

/** One row of the explanation panel's strengths / gaps / suggestions lists. */
const PANEL_ITEM = 'rounded-xl border border-onextap-primary/15 bg-white/60 px-3 py-2 dark:border-onextap-primary-light/20 dark:bg-white/[0.03]';

/** As PANEL_ITEM, tinted — strengths read as positive, gaps as neutral. */
const PANEL_ITEM_ACCENT = 'rounded-xl border border-onextap-primary/15 bg-onextap-primary/[0.04] px-3 py-2 dark:border-onextap-primary-light/20 dark:bg-white/[0.03]';

/** Section heading inside the explanation panel. */
const PANEL_HEADING = 'mb-2 text-sm font-semibold text-onextap-dark dark:text-[#E8EFD8]';

/** Text-only "Try again" button that lives inside an already-coloured notice. */
const INLINE_RETRY = 'text-sm font-medium underline hover:no-underline';

// ══════════════════════════════════════════════════════════════════
// Constants
// ══════════════════════════════════════════════════════════════════

const REMOTE_OPTIONS = [
  { value: 'any', label: 'Any' },
  { value: 'true', label: 'Remote' },
  { value: 'false', label: 'On-site' },
];

/**
 * Turn whatever is in the location box into the filter the server wants.
 *
 * ONE INPUT, TWO BEHAVIOURS, and the difference is whether we recognise what
 * was typed:
 *
 *   a value the API offered  -> the structured filter, matched exactly against
 *                               the location_city/region/country columns
 *   anything else            -> the old free-text substring on the display
 *                               column, which is all we can honestly do
 *
 * Resolution order is country, then region, then city: broadest wins a tie, so
 * typing "Canada" means the country rather than any city of that name. The
 * comparison is case- and space-insensitive because the user may type the
 * suggestion rather than click it.
 *
 * When migration 004 has not been applied there are no suggestions at all and
 * every value takes the free-text path — the box behaves exactly as it did
 * before, which is the point.
 *
 * @param {string} value Raw contents of the location box.
 * @param {object} locations Facets from fetchJobLocations().
 * @returns {{location?: string, locationCity?: string, locationRegion?: string, locationCountry?: string}}
 */
function resolveLocationFilter(value, locations) {
  const typed = String(value || '').trim();
  if (!typed) return {};
  const key = typed.toLowerCase();
  const find = (list) => asObjectArray(list).find((e) => String(e?.value || '').toLowerCase() === key);

  const country = find(locations?.countries);
  if (country) return { locationCountry: country.value };
  const region = find(locations?.regions);
  if (region) return { locationRegion: region.value };
  const city = find(locations?.cities);
  if (city) return { locationCity: city.value };

  return { location: typed };
}

const SORT_OPTIONS = [
  { value: 'match', label: 'Best match' },
  { value: 'newest', label: 'Newest' },
];

/**
 * Debounce on the filters that hit the network.
 *
 * Long enough to swallow a burst — typing in the location box, and the two
 * independent resume reads that both land on mount (this component calls
 * `getActiveResume()` while `ResumeSwitcher` separately reports the same store
 * through `onResumeChange`, each producing a fresh object identity). Short
 * enough that a deliberate change still feels immediate. Every collapsed burst
 * is a rank that was not paid for.
 */
const REFETCH_DEBOUNCE_MS = 400;

/**
 * Mirrors `PREFILTER_LIMIT` (30) and `BATCH_SIZE` (5) in `server/jobs/`.
 *
 * These are duplicated rather than imported because the server is behind its
 * own package.json and nothing in `src/` may import from it. They drive the
 * progress LABEL only — no behaviour depends on them being exact, and a drift
 * costs the user a slightly wrong denominator on a message that is already
 * described as an estimate.
 */
const PREFILTER_LIMIT_ESTIMATE = 30;
const RANK_BATCH_SIZE = 30;

/** How often the estimated batch counter advances while a rank is in flight. */
const PROGRESS_TICK_MS = 1600;

/**
 * Chips shown per card, matched and missing.
 *
 * Five is a scanning limit, not a data limit: past about five the row wraps and
 * the card stops being skimmable, and the point of a chip row is the shape of
 * the overlap at a glance. The full picture is one click away in Explain my fit.
 */
const MAX_MATCHED_CHIPS = 5;
const MAX_MISSING_CHIPS = 5;

/** Role titles listed on the resume summary before collapsing to "+N more". */
const MAX_TITLE_CHIPS = 3;

/**
 * Score bands for the badge colour. A score at or above STRONG reads as a real
 * match, FAIR as worth a look, and anything below as listed-for-completeness.
 */
const SCORE_BAND_STRONG = 80;
const SCORE_BAND_FAIR = 60;

// ══════════════════════════════════════════════════════════════════
// Pure helpers
// ══════════════════════════════════════════════════════════════════

/**
 * The value if it is a real array, otherwise an empty one.
 *
 * Every list on this page arrives over the wire, so "the server sent something
 * that is not an array" is a shape this component has to survive rather than
 * throw on. Named once so the guard reads as a decision instead of noise.
 * @param {unknown} value
 * @returns {unknown[]}
 */
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * The usable objects out of a wire array.
 *
 * `asArray` survives "the server sent something that is not an array", but the
 * elements are equally untrusted: a single null in `meta.sources` reached
 * `source.id` and threw, costing the whole page to ErrorBoundary. Filter once
 * here so every consumer can dereference without a guard of its own.
 *
 * @param {unknown} value
 * @returns {object[]} Only the non-null object elements.
 */
function asObjectArray(value) {
  return asArray(value).filter((item) => item && typeof item === 'object');
}

/**
 * The value if it is a finite number, otherwise the fallback.
 *
 * `Number.isFinite` rather than a truthiness check on purpose: 0 is a real
 * count here, and NaN/Infinity/null/undefined must all fall back rather than
 * render as themselves.
 *
 * (Wording note: Tailwind's extractor is a regex over raw file text, comments
 * included, so a bare utility name in prose here emits a real CSS rule.)
 * @param {unknown} value
 * @param {number|null} fallback
 * @returns {number|null}
 */
function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Relative posted time, or null when the timestamp is missing/unparseable —
 * a card with no date should print nothing rather than "Invalid Date".
 * @param {unknown} iso
 * @returns {string|null}
 */
function relativeTime(iso) {
  const parsed = Date.parse(typeof iso === 'string' ? iso : '');
  if (!Number.isFinite(parsed)) return null;
  const diff = Date.now() - parsed;
  if (diff < 0) return 'just posted';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return minutes <= 1 ? 'just posted' : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/**
 * The pool stores `description_quality`; the wire shape renames it
 * `descriptionQuality` (`server/jobs/query.js`). Read both, plus the bare
 * `quality` an older shape used, and default to 'full'.
 *
 * The default runs that way round deliberately. A snippet SUPPRESSES the
 * missing-keyword list, and suppressing it is the conservative choice only when
 * we actually know the description was truncated — an unknown quality treated
 * as a snippet would silently hide real gaps on every job we failed to read.
 * @param {object} job
 * @returns {string}
 */
function qualityOf(job) {
  return job?.descriptionQuality || job?.description_quality || job?.quality || 'full';
}

/** True when only ~200 characters of the posting were ever read. */
function isSnippet(job) {
  return qualityOf(job) === 'snippet';
}

/**
 * Score band colours: strong primary, fair amber, the rest muted.
 * @param {unknown} score
 * @returns {string} Tailwind classes, dark twin included.
 */
/**
 * Tone for the evidence meter, keyed on the fraction met.
 *
 * The bands are the same visual language the score badge used, but the input
 * is now a ratio the client computed rather than a number a model chose, so
 * the colour means the same thing on every run.
 */
function coverageBadgeClass(met, total) {
  const value = total > 0 ? Math.round((met / total) * 100) : 0;
  if (value >= SCORE_BAND_STRONG) {
    return 'text-onextap-primary bg-onextap-primary/12 border-onextap-primary/30 dark:text-onextap-olive-pale dark:bg-onextap-primary/30 dark:border-onextap-primary-light/40';
  }
  if (value >= SCORE_BAND_FAIR) {
    return 'text-amber-700 bg-amber-100 border-amber-300 dark:text-amber-200 dark:bg-amber-900/30 dark:border-amber-700/50';
  }
  return 'text-onextap-muted bg-onextap-primary/5 border-onextap-primary/15 dark:text-[#9AB07A] dark:bg-white/[0.04] dark:border-onextap-primary-light/20';
}

/** Severity pill for one explain gap. */
function severityClass(severity) {
  if (severity === 'blocking') {
    return 'text-red-700 bg-red-50 border-red-200 dark:text-red-300 dark:bg-red-900/25 dark:border-red-700/40';
  }
  if (severity === 'significant') {
    return 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-200 dark:bg-amber-900/25 dark:border-amber-700/40';
  }
  return 'text-onextap-primary bg-onextap-primary/10 border-onextap-primary/20 dark:text-onextap-olive-pale dark:bg-onextap-primary/25 dark:border-onextap-primary-light/30';
}

/**
 * A millisecond timing rendered as seconds, or an em dash when the server did
 * not report that phase. Named for what it returns, not for what it takes.
 * @param {unknown} milliseconds
 * @returns {string}
 */
function durationLabel(milliseconds) {
  return Number.isFinite(milliseconds) ? `${(milliseconds / 1000).toFixed(1)}s` : '—';
}

/**
 * The four fields `/api/jobs/rank` and `/api/jobs/explain` expect.
 *
 * Deliberately NOT a built profile: `buildResumeProfile` returns an object
 * holding a Map, and `JSON.stringify` flattens a Map to `{}` — every job would
 * then score against an empty keyword set and come back zero, with no error
 * anywhere. The server builds the profile from these plain fields.
 *
 * @param {object|null} resume A StoredResume.
 * @returns {{skills: string[], titles: string[], seniority: number|null, yearsExperience: number|null}}
 */
function parsedProfileOf(resume) {
  const parsed = resume?.parsed || {};
  return {
    skills: asArray(parsed.skills),
    titles: asArray(parsed.titles),
    seniority: finiteOr(parsed.seniority, null),
    yearsExperience: finiteOr(parsed.yearsExperience, null),
  };
}

/**
 * `src/matching/` reads database column names. Handing it the camelCase wire
 * job does not throw — it silently loses the snippet discount and the keyword
 * list. One named adapter, mirroring `toMatcherJob` on the server side.
 * @param {object} job
 */
function toMatcherJob(job) {
  return {
    title: job?.title,
    keywords: job?.keywords,
    keyword_terms: job?.keywordTerms,
    description_quality: qualityOf(job),
  };
}

// ══════════════════════════════════════════════════════════════════
// Presentational pieces
// ══════════════════════════════════════════════════════════════════
//
// All of these are declared at MODULE scope, never inside JobMatchesPage.
// A component defined inside a render is a new type on every render, so React
// unmounts and remounts its whole subtree each time — which here would throw
// away the open explanation panel and every input's focus.

const NOTICE_TONES = { amber: AMBER_BOX, red: RED_BOX };

/**
 * A coloured notice: icon on the left, message beside it.
 *
 * Degraded states on this page are never allowed to be silent, so this exists
 * to make saying one cheap rather than to make it pretty.
 *
 * @param {object} props
 * @param {'amber'|'red'} props.tone
 * @param {React.ComponentType<{size?: number, className?: string}>} props.icon
 * @param {string} [props.className] Layout only — spacing from its neighbours.
 */
const Notice = ({ tone, icon: Icon, className = '', children }) => (
  <div className={`${NOTICE_TONES[tone]} ${className} flex items-start gap-2`}>
    <Icon size={15} className="mt-0.5 shrink-0" />
    {children}
  </div>
);

/**
 * A notice that failed at something and offers to do it again.
 *
 * Stacked rather than inline: the retry is an action, and putting it on the
 * message's own line stops it reading as part of the sentence.
 *
 * @param {object} props
 * @param {'amber'|'red'} props.tone
 * @param {string} props.message
 * @param {() => void} props.onRetry
 */
const RetryNotice = ({ tone, message, onRetry }) => (
  <div className={`${NOTICE_TONES[tone]} flex flex-col items-start gap-2`}>
    <div className="flex items-start gap-2">
      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
    <button type="button" onClick={onRetry} className={INLINE_RETRY}>
      Try again
    </button>
  </div>
);

/**
 * A labelled `<select>`. The four filter controls were the same twelve lines
 * with a different options array.
 *
 * @param {object} props
 * @param {string} props.id Ties the label to the control for screen readers.
 * @param {string} props.label
 * @param {string|number} props.value
 * @param {(value: string) => void} props.onChange Receives the raw string; a
 *   numeric field is the caller's job to coerce, so this stays dumb.
 * @param {Array<{value: string|number, label: string}>} props.options
 */
const SelectField = ({ id, label, value, onChange, options }) => (
  <div>
    <label className={FIELD_LABEL} htmlFor={id}>{label}</label>
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={FIELD}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  </div>
);

/**
 * The badge row summarising the resume everything is ranked against.
 *
 * @param {object} props
 * @param {object} props.resume The StoredResume.
 * @param {{skills: string[], titles: string[], yearsExperience: number|null}} props.profile
 *   The same parsed shape that goes to the server, so what is shown here is
 *   what was actually scored against.
 */
const ResumeSummary = ({ resume, profile }) => (
  <div className="mt-4 flex flex-wrap items-center gap-2">
    <span className={BADGE}>{profile.skills.length} skills</span>
    <span className={BADGE}>
      {Number.isFinite(profile.yearsExperience)
        ? `${profile.yearsExperience} yrs experience`
        : 'Experience not detected'}
    </span>
    <span className={BADGE}>{asArray(resume.corpus).length} corpus items</span>
    {profile.titles.slice(0, MAX_TITLE_CHIPS).map((title) => (
      <span key={title} className={BADGE}>{title}</span>
    ))}
    {profile.titles.length > MAX_TITLE_CHIPS && (
      <span className={MUTED}>+{profile.titles.length - MAX_TITLE_CHIPS} more titles</span>
    )}
    {resume.needsReupload && (
      <span className={AMBER_PILL}>
        <AlertTriangle size={10} /> Re-upload needed
      </span>
    )}
  </div>
);

/**
 * The source checkboxes.
 *
 * Driven entirely by `/api/jobs/meta` rather than a hardcoded list: adding an
 * adapter server-side has to make the source appear here without a client
 * release, and a source the pool has never seen must not appear at all.
 * Unchecked everywhere means "all of them" — see the note under the row.
 *
 * ═══ WHICH SOURCES ARE HIDDEN ═══
 *
 * A source is dropped only when it is BOTH switched off server-side AND holds
 * nothing in the pool. Both halves matter, and the second is the one that is
 * easy to get wrong:
 *
 *   - `wellfound` and `cache` are off with 0 rows, so they are not filters at
 *     all — checking one asks for a subset that cannot exist. They were also
 *     actively misleading: `cache` names an internal fixture source of
 *     synthetic listings to someone who has no idea what it is, and neither
 *     has anything to do with the jobs on screen.
 *   - `ats` is off right now (its board list is unset in this deploy) and
 *     still holds hundreds of real, searchable listings from when it last ran.
 *     Hiding it on "off" alone would take away a filter that works. Off is not
 *     the same as empty, and only the pair is grounds for hiding.
 *
 * `enabled !== false` rather than `=== true`, so a meta response that omits
 * the field still shows the source: the failure mode of something unrecognised
 * is to appear, not to vanish silently.
 *
 * @param {object} props
 * @param {Array<{id: string, count: number, enabled?: boolean, lastError?: string}>|undefined} props.sources
 * @param {boolean} props.loading
 * @param {string[]} props.selected
 * @param {(sourceId: string) => void} props.onToggle
 */
const SourceFilters = ({ sources, loading, selected, onToggle }) => {
  const available = asObjectArray(sources).filter(
    (source) => source.enabled !== false || finiteOr(source.count, 0) > 0
  );
  return (
    <div className="mt-4">
      <span className={FIELD_LABEL}>Sources</span>
      {loading ? (
        <div className={`${SKELETON} h-8 w-56`} />
      ) : available.length === 0 ? (
        <p className={MUTED}>No sources reported. All available listings are included.</p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {available.map((source) => (
            <label
              key={source.id}
              className="inline-flex items-center gap-2 rounded-lg border border-onextap-primary/20 bg-white/70 px-3 py-1.5 text-xs font-medium text-onextap-dark transition-colors hover:bg-onextap-primary/[0.06] dark:border-onextap-primary-light/25 dark:bg-onextap-night-card dark:text-[#E8EFD8] dark:hover:bg-white/[0.06]"
            >
              <input
                type="checkbox"
                checked={selected.includes(source.id)}
                onChange={() => onToggle(source.id)}
                className="h-3.5 w-3.5 accent-onextap-primary dark:accent-onextap-primary-light"
              />
              {source.id}
              <span className={MUTED}>{finiteOr(source.count, 0)}</span>
              {/* A source that failed its last collection run says so here too. */}
              {source.lastError && <AlertTriangle size={11} className="text-amber-600 dark:text-amber-400" />}
            </label>
          ))}
        </div>
      )}
      <p className={`mt-2 ${MUTED}`}>
        Leave every source unchecked to search all of them.
      </p>
    </div>
  );
};

/** The percentage pill on a job card, coloured by band. */
/**
 * What the job asks for, against what the resume evidences.
 *
 * This replaced a percentage badge. The score still exists and still orders
 * this list — it is just not shown, because it is the half of the result that
 * cannot be trusted at face value: the rank order holds across models
 * (correlation ~0.99) while the absolute number drifts, so the same job reads
 * 55% or 70% depending on who answered. A count does not drift, and unlike a
 * percentage it points at something actionable — the amber chips below say
 * exactly which of those requirements are unmet.
 *
 * Renders nothing when coverage is null. That is mostly snippet jobs, where
 * roughly 200 characters of the posting were read: the "Low detail" badge is
 * the honest statement there, and a confident-looking "1 of 3" would not be.
 */
const EvidenceMeter = ({ coverage }) => {
  if (!coverage || !Number.isFinite(coverage.total) || coverage.total <= 0) return null;
  const { met, total } = coverage;
  return (
    <span
      className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold leading-none ${coverageBadgeClass(met, total)}`}
      title={`This role lists ${total} things; your resume evidences ${met}.`}
    >
      {met} of {total} matched
    </span>
  );
};

/**
 * One ranked job.
 *
 * Takes the ranked ENVELOPE, not a job: the wire shape is
 * `{job, jobId, score, gapSummary, matchedSignals, missingSignals, scoredBy,
 * confidence, fallbackReason}` with the posting nested under `job`, and
 * flattening it here would lose which half a field came from.
 *
 * @param {object} props
 * @param {object} props.entry The ranked envelope.
 * @param {Array<{term: string, required?: boolean}>} props.missingTerms The
 *   deterministic client-side diff. Already empty for a snippet job — the
 *   caller suppresses it; see the comment on the row below.
 * @param {boolean} props.explaining True while this card's explain call is out.
 * @param {(entry: object) => void} props.onExplain
 */
const JobCard = ({ entry, missingTerms, coverage, explaining, onExplain }) => {
  const job = entry.job || {};
  const snippet = isSnippet(job);
  const posted = relativeTime(job.postedAt);
  const matched = asArray(entry.matchedSignals);

  return (
    <article className={JOB_CARD}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-onextap-dark dark:text-[#E8EFD8]">
            {job.title || 'Untitled role'}
          </h3>
          <div className={`mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 ${SUBTEXT}`}>
            {job.company && (
              <span className="inline-flex items-center gap-1">
                <Building2 size={12} /> {job.company}
              </span>
            )}
            {job.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin size={12} /> {job.location}
              </span>
            )}
            {posted && (
              <span className="inline-flex items-center gap-1">
                <Clock size={12} /> {posted}
              </span>
            )}
          </div>
        </div>
        <EvidenceMeter coverage={coverage} />
      </div>

      {entry.gapSummary && (
        <p className={`mt-3 ${SUBTEXT}`}>{entry.gapSummary}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {job.isRemote && <span className={BADGE}>Remote</span>}
        {job.source && <span className={BADGE}>{job.source}</span>}
        {/*
          A snippet job says "Low detail" INSTEAD OF a missing-keyword list, not
          alongside one. This badge is the honest half of that trade.
        */}
        {snippet && (
          <span className={AMBER_PILL}>
            <AlertTriangle size={10} /> Low detail
          </span>
        )}
        {entry.scoredBy === 'keyword' && (
          <span className={MUTED_PILL}>Keyword score</span>
        )}
      </div>

      {matched.length > 0 && (
        <div className="mt-3">
          <p className={`mb-1.5 ${MUTED}`}>Matched</p>
          <div className="flex flex-wrap gap-1.5">
            {/* Index in the key, not the term alone: matchedSignals comes off
                the wire and a model can repeat a term, which React reports as
                a duplicate-key warning and renders wrong on reorder. */}
            {matched.slice(0, MAX_MATCHED_CHIPS).map((term, index) => (
              <span key={`${term}-${index}`} className={BADGE}>{term}</span>
            ))}
          </div>
        </div>
      )}

      {/*
        The deterministic missing row, suppressed entirely for a snippet job.
        We read roughly 200 characters of that posting — telling someone they
        lack a skill the posting may never have mentioned is worse than saying
        nothing. The `!snippet` guard is belt to the braces of `missingFor`,
        which already returns [] for one.
      */}
      {!snippet && missingTerms.length > 0 && (
        <div className="mt-3">
          <p className={`mb-1.5 ${MUTED}`}>Not evidenced in your resume</p>
          <div className="flex flex-wrap gap-1.5">
            {missingTerms.map((item) => (
              <span key={item.term} className={AMBER_PILL}>
                {item.term}
                {item.required && <span className="opacity-70">required</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {job.url && (
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`${BTN_GHOST} inline-flex items-center gap-1.5`}
          >
            <ExternalLink size={12} /> Open posting
          </a>
        )}
        <button
          type="button"
          onClick={() => onExplain(entry)}
          disabled={explaining}
          className={`${BTN_GHOST} inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {explaining ? <Activity className="animate-spin" size={16} /> : <Sparkles size={12} />}
          Explain my fit
          <span className="opacity-70">1 credit</span>
        </button>
      </div>
    </article>
  );
};

/**
 * The collapsible "How this run worked" footer.
 *
 * Its job is to let a user tell a slow run from a degraded one without asking
 * anyone, so everything in here is reported as what it actually is rather than
 * as what would read most cleanly.
 *
 * @param {object} props
 * @param {object|null} props.result The rank response.
 * @param {object|null} props.meta The pool metadata from /api/jobs/meta.
 * @param {number} props.returnedCount Envelopes the rank actually returned.
 * @param {boolean} props.open
 * @param {() => void} props.onToggle
 * @param {() => void} props.onRetryMeta Re-reads metadata only — a failed meta
 *   read is no reason to pay for another ranking run.
 */
const RunTransparency = ({ result, meta, returnedCount, open, onToggle, onRetryMeta }) => {
  const runSources = asObjectArray(result?.meta?.sources);
  const reformulations = asArray(result?.reformulations);
  const failedSources = asObjectArray(meta?.sources).filter((source) => source.lastError);
  const timings = result?.meta?.timings;

  return (
    <div className="mt-6 border-t border-onextap-primary/15 pt-4 dark:border-onextap-primary-light/20">
      <button
        type="button"
        onClick={onToggle}
        className={`flex w-full items-center justify-between gap-2 ${MUTED} hover:text-onextap-primary dark:hover:text-onextap-olive-pale transition-colors`}
      >
        <span className="font-semibold uppercase tracking-[0.08em]">How this run worked</span>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <dl className={`mt-3 space-y-2 ${MUTED}`}>
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-semibold">Sources used:</dt>
            <dd>
              {runSources.length > 0
                ? runSources.map((source) => `${source.id} (${source.count})`).join(', ')
                : 'none reported'}
            </dd>
          </div>

          <div className="flex flex-wrap gap-x-2">
            <dt className="font-semibold">Phase timing:</dt>
            <dd>
              {/*
                The server reports PHASE timings, not per-source ones — a single
                pool query serves every source at once, so there is no
                per-source clock to report. Per-source counts are the row above;
                last-run times are below. The label says "Phase" for that
                reason, and changing it to "Source timing" would be a lie.
              */}
              prefilter {durationLabel(timings?.prefilterMs)} · rank{' '}
              {durationLabel(timings?.rankMs)} · reformulate{' '}
              {durationLabel(timings?.reformulateMs)} · total{' '}
              {durationLabel(timings?.totalMs)}
            </dd>
          </div>

          <div className="flex flex-wrap gap-x-2">
            <dt className="font-semibold">Jobs considered:</dt>
            <dd>
              {finiteOr(result?.meta?.poolSize, 0)} in the pool ·{' '}
              {finiteOr(result?.meta?.sentToScorer, finiteOr(result?.meta?.prefilterLimit, PREFILTER_LIMIT_ESTIMATE))} sent to the scorer ·{' '}
              {returnedCount} returned
            </dd>
          </div>

          <div className="flex flex-wrap gap-x-2">
            <dt className="font-semibold">Scored by:</dt>
            <dd>
              {/* The wire carries how it was scored, not a model id. */}
              {result?.scoredBy === 'llm' ? 'AI model'
                : result?.scoredBy === 'mixed' ? 'AI model, with a keyword fallback on some jobs'
                  : 'keyword matcher only'}
              {result?.cached === true && ' · served from cache'}
              {Number.isFinite(result?.meta?.matcherVersion) && ` · matcher v${result.meta.matcherVersion}`}
              {/* Why the run stopped, when it stopped early. Without this a run
                  cut short by its own clock is indistinguishable from one that
                  simply found nothing better to say — same short list, same
                  flat scores, no way to tell which. */}
              {result?.meta?.budgetExhausted === true && ' · stopped early to stay within the time budget'}
            </dd>
          </div>

          <div>
            <dt className="font-semibold">Query reformulation:</dt>
            <dd className="mt-1">
              {reformulations.length > 0 ? (
                <ul className="list-disc space-y-1 pl-4">
                  {reformulations.map((step, idx) => (
                    <li key={`${step?.step || 'step'}-${idx}`}>
                      <span className="font-medium">{step?.step || 'broadened'}</span>
                      {' — '}
                      {step?.reason || `broadened ${step?.broadened || 'the query'} from ${step?.from} to ${step?.to}`}
                    </li>
                  ))}
                </ul>
              ) : (
                <span>
                  The query was not reformulated
                  {Number.isFinite(result?.loops) ? ` (${result.loops} loop${result.loops === 1 ? '' : 's'})` : ''}.
                </span>
              )}
            </dd>
          </div>

          {/* An ingest that failed is surfaced here, never swallowed. */}
          {failedSources.length > 0 && (
            <div className={`${AMBER_BOX} mt-2`}>
              <p className="font-semibold">Some sources failed at their last collection run:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {failedSources.map((source) => (
                  <li key={source.id}>
                    <span className="font-medium">{source.id}</span>: {source.lastError}
                    {source.lastRunAt && ` (last run ${relativeTime(source.lastRunAt) || source.lastRunAt})`}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {meta?.degraded && (
            <div className={`${AMBER_BOX} mt-2`}>
              Source status could not be read in full{meta?.error ? `: ${meta.error}` : '.'}{' '}
              <button type="button" onClick={onRetryMeta} className="font-medium underline hover:no-underline">
                Try again
              </button>
            </div>
          )}

          {result?.meta?.requestId && (
            <div className="flex flex-wrap gap-x-2">
              {/* The correlation key between a user's report and a server log line. */}
              <dt className="font-semibold">Request id:</dt>
              <dd className="font-mono">{result.meta.requestId}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
};

/**
 * The tailoring list.
 *
 * ADVICE, NOT REPLACEMENT TEXT. `suggestedAngle` describes a direction to take
 * and `currentText` quotes the user's own wording back at them; there is
 * deliberately no field on the wire containing rewritten prose, and nothing
 * here may present one as if there were. The standing line below says so to
 * the user, and it stays until that is no longer true.
 *
 * @param {object} props
 * @param {Array<object|string>} props.suggestions
 */
const TailoringAdvice = ({ suggestions }) => (
  <div>
    <h3 className={PANEL_HEADING}>How to tailor your application</h3>
    <p className={`mb-3 ${MUTED}`}>
      These are directions to take, not rewritten text. Automated rewriting is not
      enabled yet — the wording stays yours.
    </p>
    <ul className="space-y-2">
      {suggestions.map((item, idx) => {
        // An older shape sent bare strings; both still render.
        if (typeof item === 'string') {
          return (
            <li key={`suggestion-${idx}`} className={`${PANEL_ITEM} text-sm text-onextap-dark dark:text-[#E8EFD8]`}>
              {item}
            </li>
          );
        }
        return (
          <li key={`${item?.corpusRef || 'suggestion'}-${idx}`} className={PANEL_ITEM}>
            {item?.corpusRef && (
              <span className={`${BADGE} mb-1.5`}>{item.corpusRef}</span>
            )}
            {item?.currentText && (
              <div className="mb-2">
                <p className={MUTED}>Your current wording</p>
                {/* A blockquote, because it is a quotation of the user, not a proposal. */}
                <blockquote className="mt-0.5 border-l-2 border-onextap-primary/25 pl-2 text-sm italic text-onextap-secondary dark:border-onextap-primary-light/30 dark:text-[#9AB07A]">
                  {item.currentText}
                </blockquote>
              </div>
            )}
            {item?.suggestedAngle && (
              <div className="mb-2">
                <p className={MUTED}>Angle to take</p>
                <p className="mt-0.5 text-sm text-onextap-dark dark:text-[#E8EFD8]">{item.suggestedAngle}</p>
              </div>
            )}
            {item?.reason && (
              <div>
                <p className={MUTED}>Why</p>
                <p className={`mt-0.5 ${SUBTEXT}`}>{item.reason}</p>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  </div>
);

/**
 * The rendered body of a successful explain call.
 * @param {object} props
 * @param {object} props.data The explain response.
 * @param {boolean} props.snippet True when only an excerpt was analysed.
 */
const ExplanationBody = ({ data, snippet }) => {
  const strengths = asArray(data.strengths);
  const gaps = asArray(data.gaps);
  const suggestions = asArray(data.tailoringSuggestions);

  return (
    <div className="space-y-5">
      {data.fitAnalysis && (
        <div className="space-y-2">
          {String(data.fitAnalysis).split(/\n{2,}/).filter(Boolean).map((paragraph, idx) => (
            <p key={idx} className="text-sm leading-relaxed text-onextap-dark dark:text-[#E8EFD8]">{paragraph}</p>
          ))}
        </div>
      )}

      {strengths.length > 0 && (
        <div>
          <h3 className={PANEL_HEADING}>Strengths</h3>
          <ul className="space-y-2">
            {strengths.map((item, idx) => (
              <li key={`${item?.requirement || 'strength'}-${idx}`} className={PANEL_ITEM_ACCENT}>
                <p className={`text-sm ${STRONG_TEXT}`}>{item?.requirement || 'Strength'}</p>
                {item?.evidence && <p className={`mt-0.5 ${SUBTEXT}`}>{item.evidence}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {gaps.length > 0 && (
        <div>
          <h3 className={PANEL_HEADING}>Gaps</h3>
          <ul className="space-y-2">
            {gaps.map((item, idx) => (
              <li key={`${item?.requirement || 'gap'}-${idx}`} className={PANEL_ITEM}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className={`text-sm ${STRONG_TEXT}`}>{item?.requirement || 'Gap'}</p>
                  {item?.severity && (
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-none ${severityClass(item.severity)}`}>
                      {item.severity}
                    </span>
                  )}
                </div>
                {item?.evidence && <p className={`mt-0.5 ${SUBTEXT}`}>{item.evidence}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {suggestions.length > 0 && <TailoringAdvice suggestions={suggestions} />}

      {/*
        Said at the bottom of the analysis rather than suppressing it: unlike the
        deterministic keyword diff, a model reading an excerpt still produces
        something useful — it just has to be read knowing what it read.
      */}
      {snippet && (
        <Notice tone="amber" icon={AlertTriangle}>
          <span>
            Only a short excerpt of this posting was available, so this analysis reads a
            partial description. Open the posting for the full requirements.
          </span>
        </Notice>
      )}
    </div>
  );
};

/**
 * "Your fit" — the per-job analysis, one open at a time.
 *
 * @param {object} props
 * @param {object|null} props.entry The ranked envelope being explained. Null is
 *   reachable: the panel stays open across a re-rank that drops the job.
 * @param {{loading: boolean, error: string|null, data: object|null}|null} props.state
 * @param {() => void} props.onClose
 * @param {() => void} props.onRetry
 */
const ExplanationPanel = ({ entry, state, onClose, onRetry }) => (
  <section className={CARD}>
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className={HEADING}>Your fit</h2>
        <p className={`mt-1 truncate ${SUBTEXT}`}>
          {entry?.job?.title || 'This role'}
          {entry?.job?.company ? ` · ${entry.job.company}` : ''}
        </p>
      </div>
      <button type="button" onClick={onClose} className={BTN_GHOST}>
        Close
      </button>
    </div>

    {state?.loading ? (
      <div className="space-y-3">
        <div className={BUSY_ROW}>
          <Activity className="animate-spin" size={16} />
          <span>Reading the full posting against your resume...</span>
        </div>
        <div className={SKELETON} />
        <div className={SKELETON} />
        <div className={`${SKELETON} w-2/3`} />
      </div>
    ) : state?.error ? (
      <div className={`${RED_BOX} flex flex-col items-start gap-2`}>
        <div className="flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>{state.error}</span>
        </div>
        {/* No entry means nothing to retry against, so the button goes away. */}
        {entry && (
          <button type="button" onClick={onRetry} className={INLINE_RETRY}>
            Try again
          </button>
        )}
      </div>
    ) : state?.data ? (
      <ExplanationBody data={state.data} snippet={Boolean(entry?.job) && isSnippet(entry.job)} />
    ) : (
      <p className={SUBTEXT}>Select Explain my fit on a job to see the analysis here.</p>
    )}
  </section>
);

// ══════════════════════════════════════════════════════════════════
// Component
// ══════════════════════════════════════════════════════════════════

/**
 * Job Matches: pick a resume, filter the shared pool, and read the ranked
 * result with its run transparency.
 *
 * Authentication is ambient rather than a prop — `jobsApi` attaches the
 * Supabase token to every call itself, so there is nothing about the user this
 * component needs to be told.
 *
 * @param {object} props
 * @param {(message: string, type?: 'success'|'error') => void} [props.showToast]
 */
const JobMatchesPage = ({ showToast }) => {
  // Async handlers below resolve after the user may have navigated away; the
  // effects use a `cancelled` flag, but a bare `await` in an event handler has
  // no cleanup to hang one on, so those check this instead.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const [resume, setResume] = useState(null);
  const [resumeLoading, setResumeLoading] = useState(true);

  const [meta, setMeta] = useState(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [locations, setLocations] = useState({ countries: [], regions: [], cities: [], degraded: true });

  // ── Filters that REFETCH ──────────────────────────────────────────
  const [remote, setRemote] = useState('any');
  const [location, setLocation] = useState('');
  const [selectedSources, setSelectedSources] = useState([]);

  // ── Filters that DO NOT refetch (see the effect below) ───────────
  // Defaults to the least restrictive option: the first run should show the
  // whole ranking, and narrowing it costs nothing.
  const [sort, setSort] = useState('match');

  const [result, setResult] = useState(null);
  const [ranking, setRanking] = useState(false);
  const [scoredSoFar, setScoredSoFar] = useState(0);
  const [loadError, setLoadError] = useState(null);
  const [actionError, setActionError] = useState(null);

  // Bumped to force a re-run of the effect that reads it. Three of them, so the
  // rank, the metadata read and the resume picker can be refreshed
  // independently.
  const [rankNonce, setRankNonce] = useState(0);
  const [metaNonce, setMetaNonce] = useState(0);
  const [resumeNonce, setResumeNonce] = useState(0);

  // ── Empty-state drop zone ─────────────────────────────────────────
  // Its own upload state, not shared with ResumeSwitcher's: the two zones are
  // separate elements and only one of them is ever mid-upload.
  const [dropUploading, setDropUploading] = useState(false);
  const [dropError, setDropError] = useState('');

  const [explanations, setExplanations] = useState({});
  const [openExplainId, setOpenExplainId] = useState(null);
  const [footerOpen, setFooterOpen] = useState(false);

  // Sorted before joining so that checking A then B and B then A produce the
  // same key — the ranking effect keys off this string, and an unstable one
  // would refetch on a reorder that changed nothing.
  const sourceKey = selectedSources.slice().sort().join(',');

  // ── Resume ────────────────────────────────────────────────────────

  const applyStore = useCallback((store) => {
    const id = store?.activeResumeId;
    const record = id && store?.resumes?.[id] ? { id, ...store.resumes[id] } : null;
    if (!mountedRef.current) return;
    setResume(record);
    setResumeLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getActiveResume()
      .then((record) => {
        if (cancelled) return;
        setResume(record);
        setResumeLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        log.warn('active resume read failed', error?.message || error);
        setResume(null);
        setResumeLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  /**
   * A resume dropped onto the empty-state panel.
   *
   * The panel is the biggest, most obviously droppable target on the page and
   * it is the thing that says "upload a resume", so it takes a drop rather
   * than pointing at the picker above it.
   *
   * It writes to the store directly — the same two calls the picker makes —
   * and then bumps `resumeNonce` so the picker re-reads and reports the new
   * active resume back through `applyStore`. That keeps ONE path from store to
   * `resume` state; this handler never calls `setResume` itself.
   *
   * No capacity check: this panel only renders when there are no resumes.
   *
   * @param {File[]} files Never empty.
   */
  const handleResumeDrop = useCallback(async (files) => {
    setDropError('');
    if (files.length > 1) {
      setDropError('Drop one resume at a time.');
      return;
    }
    setDropUploading(true);
    try {
      const result = await parseResumeFile(files[0]);
      if (!result.ok) {
        if (mountedRef.current) setDropError(result.error.message);
        return;
      }
      await saveParsedResume(result);
      if (!mountedRef.current) return;
      setResumeNonce((n) => n + 1);
      showToast?.('Resume parsed successfully', 'success');
    } catch (e) {
      log.warn('resume drop upload failed', { errName: e?.name });
      if (mountedRef.current) setDropError(e?.message || 'Upload failed.');
    } finally {
      if (mountedRef.current) setDropUploading(false);
    }
  }, [showToast]);

  const { isDragging: resumeDragging, dropProps: resumeDropProps } = useFileDrop({
    onDrop: handleResumeDrop,
    disabled: dropUploading,
  });

  // A new drag is a retry, so the last failure stops applying the moment one
  // starts — otherwise the panel reads "Drop to upload" over a red sentence
  // about the file before it. Mirrors the same effect in ResumeSwitcher.
  useEffect(() => {
    if (resumeDragging) setDropError('');
  }, [resumeDragging]);

  // ── Pool metadata: the honest empty state and the footer both need it ──

  useEffect(() => {
    let cancelled = false;
    setMetaLoading(true);
    fetchJobsMeta()
      .then((data) => {
        if (cancelled) return;
        setMeta(data);
        setMetaLoading(false);
      })
      .catch((error) => {
        // fetchJobsMeta is documented never to throw; this is belt to braces.
        if (cancelled) return;
        log.warn('job meta read failed', error?.message || error);
        setMeta({ sources: [], total: 0, oldestPostedAt: null, degraded: true, error: error?.message || String(error) });
        setMetaLoading(false);
      });
    return () => { cancelled = true; };
  }, [metaNonce]);

  // Location suggestions. Same nonce as the pool metadata: both describe what
  // the pool currently holds, and an ingest changes both at once.
  useEffect(() => {
    let cancelled = false;
    fetchJobLocations().then((data) => {
      if (!cancelled) setLocations(data);
    });
    return () => { cancelled = true; };
  }, [metaNonce]);

  /**
   * Content identity for the resume, deliberately not object identity.
   *
   * `applyStore` builds a fresh `{id, ...record}` on EVERY ResumeSwitcher
   * refresh — re-selecting the resume that is already active, renaming a
   * different one, deleting a different one, even an upload that fails. Each of
   * those produced a new object, so a rank effect keyed on `resume` re-ran a
   * 5-20 second LLM rank against byte-identical scoring inputs, and the user
   * paid for it. The debounce does not help: the previous run has long finished.
   *
   * This string changes only when something the ranker actually reads changes.
   */
  const resumeHash = resume?.sourceHash || '';
  const resumeSignature = useMemo(
    () => (resume ? JSON.stringify([resumeHash, parsedProfileOf(resume)]) : ''),
    [resume, resumeHash],
  );

  // Keyed on the signature, not on `resume`: when the signature is unchanged the
  // parsed profile is by definition identical, so reusing it is correct and a
  // fresh object here would defeat everything above.
  const resumeProfile = useMemo(() => parsedProfileOf(resume), [resumeSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * The built profile for the deterministic missing-keyword row.
   *
   * Built from the SAME object that is sent to the server, not from the whole
   * parsed record, so the client-side "you are missing X" row cannot disagree
   * with the score the server produced from a narrower input.
   */
  const builtProfile = useMemo(() => {
    try {
      return buildResumeProfile(resumeProfile);
    } catch (error) {
      log.warn('resume profile build failed', error?.message || error);
      return null;
    }
  }, [resumeProfile]);

  // ── Ranking ───────────────────────────────────────────────────────
  //
  // ═══ WHY sort IS NOT IN THIS DEPENDENCY LIST ═══
  //
  // A rank is a pool read, a prefilter and up to three rounds of batched LLM
  // calls — 5-20 seconds and real spend. `sort` is an ordering over results
  // that have ALREADY been scored, so it is applied in `visibleJobs` below,
  // client-side, instantly and for free.
  //
  // Adding it here would turn every click of a radio button into a fresh
  // ranking run. If you are here to "fix" a control that does not refetch: it
  // is not broken. That is the entire reason ranking stays affordable.
  //
  // `minMatch` used to be named here too. It is gone — the score it cut on is
  // no longer shown, and cutting on a number that drifts between models is
  // what made "85%" return an empty page.
  useEffect(() => {
    // Signature, not the object: it is the empty string exactly when there is
    // no resume, and unlike  it is in this effect's dependency list.
    if (!resumeSignature) {
      setResult(null);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setRanking(true);
      setLoadError(null);
      rankJobs({
        resumeProfile,
        filters: {
          remote,
          source: sourceKey,
          // One box, resolved: a value the API offered becomes an exact
          // structured filter, anything else stays a free-text substring.
          ...resolveLocationFilter(location, locations),
        },
        resumeHash,
        matcherVersion: MATCHER_VERSION,
      })
        .then((data) => {
          if (cancelled) return;
          setResult(data);
          setRanking(false);
        })
        .catch((error) => {
          if (cancelled) return;
          log.warn('job ranking failed', error?.message || error);
          setLoadError(error?.message || 'Could not rank jobs.');
          setRanking(false);
        });
    }, REFETCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // / rather than : see the signature
    // comment above. A rebuilt-but-identical record must not buy a fresh rank.
    // `locations` is read by resolveLocationFilter above and is deliberately
    // NOT a dependency. It is a lookup table, not a filter: when the
    // suggestions finish loading, nothing the user chose has changed, and
    // re-running on arrival would spend a full rank to reach the same pool.
    // The box is empty on first load anyway, and any later edit re-runs this
    // with the table present.
  }, [resumeSignature, resumeHash, resumeProfile, remote, location, sourceKey, rankNonce]);

  /**
   * Batch progress.
   *
   * `/api/jobs/rank` is one POST with no progress channel, so this is an
   * ESTIMATE advanced on a timer against the server's own batch size — it is
   * labelled as an estimate in the UI. A bare spinner for twenty seconds reads
   * as a hang; a counter that moves reads as work.
   */
  useEffect(() => {
    if (!ranking) return undefined;
    setScoredSoFar(0);
    const id = setInterval(() => {
      setScoredSoFar((n) => Math.min(n + RANK_BATCH_SIZE, PREFILTER_LIMIT_ESTIMATE - RANK_BATCH_SIZE));
    }, PROGRESS_TICK_MS);
    return () => clearInterval(id);
  }, [ranking]);

  /** Every scored envelope the server returned, before the client-side filter. */
  const rankedJobs = asArray(result?.jobs);

  /**
   * The client-side re-rank. Pure: a filter and a sort over already-scored
   * envelopes. Never a network call — see the ranking effect above.
   */
  const visibleJobs = useMemo(() => {
    // No threshold. There used to be a 50/70/85 filter here, cutting on a
    // score the user could see — and the score is the part of the result that
    // drifts between models, so "85%" meant a different bar on every run and
    // routinely emptied a perfectly good list. The page is an ordered list
    // now: everything the ranker returned, best first.
    //
    // Copied before sorting: `rankedJobs` aliases `result.jobs`, and sorting in
    // place would reorder the stored response behind the memo's back.
    const sorted = rankedJobs.slice();
    if (sort === 'newest') {
      // Score breaks a date tie, so two jobs posted the same minute still come
      // back in a stable, meaningful order rather than an arbitrary one.
      sorted.sort((a, b) => {
        const aPosted = Date.parse(a?.job?.postedAt || '') || 0;
        const bPosted = Date.parse(b?.job?.postedAt || '') || 0;
        if (bPosted !== aPosted) return bPosted - aPosted;
        return (b?.score || 0) - (a?.score || 0);
      });
    } else {
      // Title breaks a score tie, for the same reason.
      sorted.sort((a, b) => {
        const diff = (b?.score || 0) - (a?.score || 0);
        if (diff !== 0) return diff;
        return String(a?.job?.title || '').localeCompare(String(b?.job?.title || ''));
      });
    }
    return sorted;
  }, [rankedJobs, sort]);

  /**
   * The deterministic "not evidenced in your resume" terms for one job.
   *
   * Returns [] for a snippet job — that is the FIRST of the two places snippet
   * suppression happens, and the load-bearing one: the card's `!snippet` guard
   * is only there so a reader of the card can see the rule without following
   * this call. Roughly 200 characters of that posting were read, and naming a
   * skill it may never have asked for is worse than naming none.
   *
   * Throwing is caught rather than propagated: a keyword diff is an extra, and
   * losing it must not take the whole ranked list down with it.
   */
  const missingFor = useCallback((job) => {
    if (!builtProfile || isSnippet(job)) return [];
    try {
      return missingKeywords(builtProfile, toMatcherJob(job), { limit: MAX_MISSING_CHIPS });
    } catch (error) {
      log.warn('missing keyword diff failed', error?.message || error);
      return [];
    }
  }, [builtProfile]);

  /**
   * Evidence count for one job, or null when it is not countable.
   *
   * Same guards as `missingFor` and for the same reason: a snippet job is not
   * a badly-matched job, it is an unread one, and keywordCoverage returns null
   * there rather than a confident-looking fraction of an excerpt. Throwing is
   * caught, not propagated — losing a count must not take the list down.
   */
  const coverageFor = useCallback((job) => {
    if (!builtProfile || isSnippet(job)) return null;
    try {
      return keywordCoverage(builtProfile, toMatcherJob(job));
    } catch (error) {
      log.warn('coverage count failed', error?.message || error);
      return null;
    }
  }, [builtProfile]);

  /**
   * The datalist's options: countries, then regions, then cities.
   *
   * Broadest first, matching resolveLocationFilter's resolution order, so the
   * order a user reads them in is the order a typed value is interpreted in.
   * Deduplicated by value because a place can legitimately appear in two
   * buckets — "Singapore" is both a city and a country in this pool — and a
   * datalist with the same value twice renders a repeated row.
   */
  const locationSuggestions = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const kind of ['countries', 'regions', 'cities']) {
      for (const entry of asObjectArray(locations?.[kind])) {
        const value = String(entry?.value || '').trim();
        if (!value || seen.has(value.toLowerCase())) continue;
        seen.add(value.toLowerCase());
        out.push({ kind, value, count: finiteOr(entry?.count, 0) });
      }
    }
    return out;
  }, [locations]);

  const toggleSource = (sourceId) => {
    setSelectedSources((prev) => (
      prev.includes(sourceId) ? prev.filter((id) => id !== sourceId) : [...prev, sourceId]
    ));
  };

  // Three separate refresh affordances, deliberately not one. Bumping a nonce
  // re-runs only the effect that reads it, so a failed rank does not also
  // re-fetch pool metadata that loaded perfectly well, and vice versa.
  const requestFreshRank = useCallback(() => setRankNonce((n) => n + 1), []);
  const requestFreshMeta = useCallback(() => setMetaNonce((n) => n + 1), []);
  const refreshEverything = useCallback(() => {
    setRankNonce((n) => n + 1);
    setMetaNonce((n) => n + 1);
  }, []);

  const toggleFooter = useCallback(() => setFooterOpen((isOpen) => !isOpen), []);
  const closeExplanation = useCallback(() => setOpenExplainId(null), []);

  /**
   * Open the panel for a job and, unless it is already analysed, buy one.
   *
   * The cached-result early return is what makes reopening a job free: an
   * explain costs a credit, and clicking the same card twice must not.
   */
  const handleExplain = async (entry) => {
    const jobId = entry?.jobId;
    if (!jobId) return;
    setOpenExplainId(jobId);
    setActionError(null);
    if (explanations[jobId]?.data) return;

    setExplanations((prev) => ({ ...prev, [jobId]: { loading: true, error: null, data: null } }));
    try {
      const analysis = await explainJob({
        job: entry.job,
        // Rule 8: the corpus is the user's own material, held locally. It goes
        // out as a transient request body for this one call and is never stored
        // server-side.
        corpus: asArray(resume?.corpus),
        resumeProfile,
      });
      if (!mountedRef.current) return;
      setExplanations((prev) => ({ ...prev, [jobId]: { loading: false, error: null, data: analysis } }));
    } catch (error) {
      log.warn('job explain failed', error?.message || error);
      if (!mountedRef.current) return;
      const message = error?.message || 'Could not analyse this job.';
      setExplanations((prev) => ({ ...prev, [jobId]: { loading: false, error: message, data: null } }));
      setActionError(message);
      showToast?.(message, 'error');
    }
  };

  /**
   * The open job's envelope. Checked against the visible list first and the
   * full ranking second, because minimum-match can filter out the very job
   * whose panel is open without the panel having any reason to close.
   */
  const openEntry = visibleJobs.find((entry) => entry.jobId === openExplainId)
    || rankedJobs.find((entry) => entry.jobId === openExplainId)
    || null;
  const openExplanation = openExplainId ? explanations[openExplainId] : null;

  /** Drop the failed record first, so handleExplain does not see a cache hit. */
  const retryExplanation = () => {
    if (!openEntry) return;
    setExplanations((prev) => {
      const next = { ...prev };
      delete next[openEntry.jobId];
      return next;
    });
    handleExplain(openEntry);
  };

  /**
   * True only when the server actually reported a count and that count was
   * zero. A missing total means "we could not read the pool", which is a
   * different story and gets told by the footer's degraded row instead.
   */
  const poolIsEmpty = Number.isFinite(meta?.total) ? meta.total === 0 : false;

  /**
   * Whole-run degradation: NO job was AI-scored.
   *
   * Reads scoredBy alone, deliberately. This used to be
   * `result?.degraded === true || result?.scoredBy === 'keyword'`, and the
   * first half of that is a much weaker claim than the banner it was driving:
   * the server sets `degraded` when ANY SINGLE job falls back (rank.js —
   * `results.some((r) => r.scoredBy !== 'llm')`), so one recovered job out of
   * thirty put "AI scoring unavailable" above a list that was twenty-nine
   * thirtieths AI-scored. A banner that overstates the outage is read as noise
   * within a week, and then the real one goes unread too.
   *
   * scoredBy is the honest summary: 'keyword' means zero jobs were AI-scored,
   * 'mixed' means some were, 'llm' means all were.
   */
  const keywordOnly = result?.scoredBy === 'keyword';

  /** Partial degradation: some jobs are AI-scored, some fell back. */
  const partiallyScored = result?.scoredBy === 'mixed';

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="animate-fade-in max-w-3xl mx-auto space-y-6">

      {/* ══ 1 — YOUR RESUME ══════════════════════════════════════ */}
      <section className={CARD}>
        <div className="mb-4 flex items-center gap-2">
          <Briefcase size={18} className="text-onextap-primary dark:text-onextap-olive-pale" />
          <h2 className={HEADING}>Your resume</h2>
        </div>

        {resumeLoading ? (
          <div className="space-y-3">
            <div className={SKELETON} />
            <div className={`${SKELETON} w-2/3`} />
          </div>
        ) : (
          <>
            <ResumeSwitcher onResumeChange={applyStore} refreshNonce={resumeNonce} />

            {!resume ? (
              <div
                {...resumeDropProps}
                className={`mt-4 rounded-2xl border border-dashed px-5 py-8 text-center transition-colors ${
                  resumeDragging
                    ? 'border-onextap-primary bg-onextap-primary/10 dark:border-onextap-primary-light dark:bg-onextap-primary/20'
                    : 'border-onextap-primary/25 bg-onextap-primary/[0.04] dark:border-onextap-primary-light/25 dark:bg-white/[0.03]'
                }`}
              >
                {dropUploading ? (
                  <>
                    <Activity size={22} className="mx-auto mb-3 animate-spin text-onextap-primary dark:text-onextap-olive-pale" />
                    <p className={STRONG_TEXT}>Parsing resume...</p>
                    <p className={`mt-1 ${SUBTEXT}`}>Reading the file and pulling out your skills and experience.</p>
                  </>
                ) : (
                  <>
                    {resumeDragging
                      ? <UploadCloud size={22} className="mx-auto mb-3 text-onextap-primary dark:text-onextap-olive-pale" />
                      : <Sparkles size={22} className="mx-auto mb-3 text-onextap-primary dark:text-onextap-olive-pale" />}
                    <p className={STRONG_TEXT}>
                      {resumeDragging ? 'Drop to upload' : 'Drop a resume here, or use the picker above'}
                    </p>
                    <p className={`mt-1 ${SUBTEXT}`}>
                      Jobs are ranked against your resume. Nothing is ranked until there is one to rank against.
                    </p>
                    <p className={`mt-2 text-xs ${SUBTEXT}`}>PDF or image, up to {MAX_RESUME_LABEL}.</p>
                  </>
                )}
                {dropError && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{dropError}</p>}
              </div>
            ) : (
              <ResumeSummary resume={resume} profile={resumeProfile} />
            )}
          </>
        )}
      </section>

      {/* Everything below depends on a resume. No resume, no filters, no list. */}
      {resume && (
        <>
          {/* ══ 2 — FILTERS ═════════════════════════════════════════ */}
          <section className={CARD}>
            <h2 className={`${HEADING} mb-4`}>Filters</h2>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SelectField
                id="jobs-remote"
                label="Remote"
                value={remote}
                onChange={setRemote}
                options={REMOTE_OPTIONS}
              />

              <div>
                <label className={FIELD_LABEL} htmlFor="jobs-location">Location</label>
                {/*
                  A native datalist rather than a custom combobox. It gives the
                  suggest-and-pick behaviour of a job site's location box for
                  no JavaScript, keeps keyboard and screen-reader support the
                  platform already provides, and — the part that matters here —
                  it still accepts free text. So a picked suggestion becomes an
                  exact structured filter while anything typed falls back to
                  the old substring match, and a pool whose location columns
                  are not populated yet simply offers no suggestions.
                */}
                <input
                  id="jobs-location"
                  type="text"
                  list="jobs-location-options"
                  autoComplete="off"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder={locationSuggestions.length ? 'Start typing, or pick a place' : 'City, region, or country'}
                  className={FIELD}
                />
                <datalist id="jobs-location-options">
                  {locationSuggestions.map((entry) => (
                    <option key={`${entry.kind}:${entry.value}`} value={entry.value}>
                      {`${entry.count} ${entry.count === 1 ? 'job' : 'jobs'}`}
                    </option>
                  ))}
                </datalist>
              </div>

              <SelectField
                id="jobs-sort"
                label="Sort"
                value={sort}
                onChange={setSort}
                options={SORT_OPTIONS}
              />
            </div>

            <SourceFilters
              sources={meta?.sources}
              loading={metaLoading}
              selected={selectedSources}
              onToggle={toggleSource}
            />

            {/* The reason ranking stays affordable, said out loud. */}
            <p className={`mt-4 flex items-start gap-2 ${MUTED}`}>
              <Info size={12} className="mt-0.5 shrink-0" />
              <span>
                Remote, location and source changes fetch a fresh ranking. Sort re-orders the
                results you already have — instantly, and without re-scoring anything.
              </span>
            </p>
          </section>

          {/* ══ 3 — RANKED JOBS ═════════════════════════════════════ */}
          <section className={CARD}>
            {/*
              A refresh that failed while a previous run is still in hand. The
              list below stays exactly as it was — throwing away results the
              user can still act on, to show them an error, is strictly worse
              than showing both. The footer is suppressed separately, because
              its timings and request id describe the run that failed.
            */}
            {loadError && result && (
              <div className={`mb-4 ${AMBER_BOX}`}>
                <p className={STRONG_TEXT}>Couldn&rsquo;t refresh: {loadError}</p>
                <p className="mt-1">
                  Showing your previous results.{' '}
                  <button type="button" onClick={requestFreshRank} className={INLINE_RETRY}>
                    Try again
                  </button>
                </p>
              </div>
            )}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-baseline gap-3">
                <h2 className={HEADING}>Ranked jobs</h2>
                {/* Safe alongside a failed refresh: the list, this count and
                    the footer all describe the same previous run. */}
                {!ranking && result && (
                  <span className={MUTED}>
                    {/* One number now. It was "N of M shown" when a
                        threshold could hide part of the list; nothing hides
                        anything any more, so two numbers could only ever be
                        the same number printed twice. */}
                    {visibleJobs.length} {visibleJobs.length === 1 ? 'match' : 'matches'}
                  </span>
                )}
              </div>
              {/*
                The server caches a rank by resume hash and filters, so without
                this there is no way to ask for a fresh run when the pool has
                moved on but the filters have not.
              */}
              <button
                type="button"
                onClick={refreshEverything}
                disabled={ranking}
                className={BTN_PRIMARY}
              >
                {ranking ? <Activity className="animate-spin" size={16} /> : <Sparkles size={16} />}
                Refresh matches
              </button>
            </div>

            {/* Degraded states — never silent. */}
            {!ranking && result && keywordOnly && (
              <Notice tone="amber" icon={AlertTriangle} className="mb-4">
                <div>
                  <p className="font-medium">AI scoring unavailable — showing keyword matches.</p>
                  <p className="mt-1 text-xs opacity-90">
                    {result?.meta?.degradeReason === 'rate_limited'
                      ? 'The scoring service is rate limited right now. Scores come from keyword overlap alone, so treat them as approximate — try again shortly.'
                      : 'Scores come from keyword overlap alone, so treat them as approximate.'}
                  </p>
                </div>
              </Notice>
            )}

            {!ranking && result && partiallyScored && (
              <Notice tone="amber" icon={AlertTriangle} className="mb-4">
                <div>
                  <p className="font-medium">Some jobs were scored by keyword only.</p>
                  <p className="mt-1 text-xs opacity-90">
                    The rest are AI-scored. Mixed runs are not cached, so a refresh re-scores them.
                  </p>
                </div>
              </Notice>
            )}

            {!ranking && result?.limited === true && (
              <Notice tone="amber" icon={Clock} className="mb-4">
                <div>
                  <p className="font-medium">Refreshing again shortly.</p>
                  <p className="mt-1 text-xs opacity-90">
                    The hourly ranking limit was reached, so this is a partial result. Everything that
                    came back is shown below.
                  </p>
                </div>
              </Notice>
            )}

            {actionError && (
              <Notice tone="red" icon={AlertTriangle} className="mb-4">
                <span>{actionError}</span>
              </Notice>
            )}

            {ranking ? (
              <div className="space-y-3">
                <div className={BUSY_ROW}>
                  <Activity className="animate-spin" size={16} />
                  <span>
                    Scoring {Math.min(scoredSoFar + RANK_BATCH_SIZE, PREFILTER_LIMIT_ESTIMATE)} of{' '}
                    {PREFILTER_LIMIT_ESTIMATE} jobs
                  </span>
                </div>
                <p className={MUTED}>
                  Ranking runs in batches and usually takes 5-20 seconds. The count is an estimate —
                  the server reports the exact numbers when it finishes.
                </p>
                <div className={SKELETON} />
                <div className={SKELETON} />
                <div className={SKELETON} />
              </div>
            ) : loadError && !result ? (
              // Only when there is nothing to fall back to. A failed REFRESH keeps
              // the list the user already had — see the notice above, which
              // renders instead when a previous result is still in hand.
              <RetryNotice tone="amber" message={loadError} onRetry={requestFreshRank} />
            ) : !result ? (
              <p className={SUBTEXT}>Adjust a filter to start a ranking run.</p>
            ) : poolIsEmpty && rankedJobs.length === 0 ? (
              // The NORMAL state before the first ingest run. It is not a bug,
              // and it must not read like one.
              <div className={EMPTY_BOX}>
                <Clock size={22} className="mx-auto mb-3 text-onextap-primary dark:text-onextap-olive-pale" />
                <p className={STRONG_TEXT}>
                  Job listings are still being collected. Check back tomorrow.
                </p>
                <p className={`mt-1 ${SUBTEXT}`}>
                  Listings are gathered on a schedule, so the pool fills up before the first search
                  can return anything.
                </p>
              </div>
            ) : visibleJobs.length === 0 ? (
              <div className={EMPTY_BOX}>
                {/* With no threshold, empty can only mean the pool held
                    nothing for these filters — never "nothing cleared your
                    bar". The old copy said the latter and sent people to
                    lower a control that was hiding real results. */}
                <p className={STRONG_TEXT}>Nothing matched these filters.</p>
                <p className={`mt-1 ${SUBTEXT}`}>
                  Try widening the location, or turning off a source filter.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {visibleJobs.map((entry) => (
                  <JobCard
                    key={entry.jobId}
                    entry={entry}
                    missingTerms={missingFor(entry.job || {})}
                    coverage={coverageFor(entry.job || {})}
                    explaining={explanations[entry.jobId]?.loading === true}
                    onExplain={handleExplain}
                  />
                ))}
              </div>
            )}

            {(result || meta) && (
              <RunTransparency
                result={result}
                meta={meta}
                returnedCount={rankedJobs.length}
                open={footerOpen}
                onToggle={toggleFooter}
                onRetryMeta={requestFreshMeta}
              />
            )}
          </section>

          {/* ══ 4 — EXPLANATION PANEL ═══════════════════════════════ */}
          {openExplainId && (
            <ExplanationPanel
              entry={openEntry}
              state={openExplanation}
              onClose={closeExplanation}
              onRetry={retryExplanation}
            />
          )}
        </>
      )}
    </div>
  );
};

export default JobMatchesPage;
