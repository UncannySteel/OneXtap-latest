import { h, ico, fill } from '../ui/dom.js';
import { section, field, input, select, button, setBusy, note, tag, skeleton, spinner } from '../ui/controls.js';
import { fileDrop } from '../ui/file-drop.js';
import { resumeSwitcher } from '../ui/switchers.js';
import { parseResumeFile, MAX_RESUME_LABEL } from '@app/resumeParse.js';
import { getActiveResume, saveParsedResume } from '@app/resumeStore.js';
import { rankJobs, explainJob, fetchJobsMeta, fetchJobLocations } from '@app/jobsApi.js';
import { buildResumeProfile, missingKeywords, keywordCoverage, MATCHER_VERSION } from '@app/matching/index.js';
import { log as baseLog } from '@app/logger.js';

const log = baseLog.child('ui');

// Job Matches — pick a resume, filter the shared pool, read the ranked result
// and the run behind it. The backend's JobMatchesPage, rule for rule:
//
//   - Filters are a DRAFT the user edits and an APPLIED copy that ranks.
//     Nothing re-ranks until Apply (or Enter in the filter card); a rank is
//     5-20 seconds of LLM calls against daily budgets, so it is never spent
//     on a half-made selection.
//   - Sort re-orders results already in hand: instant, free, no re-rank.
//   - Leaving the page and coming back does not re-rank either: the last
//     result is kept at module scope, keyed by the exact question it answers
//     (resume content + applied filters). Refresh is the one way to ask the
//     same question again.
//   - Degraded states are never silent: keyword-only scoring, a partly
//     AI-scored run, filters broadened to fill the list, the hourly limit.
//   - A job whose posting was only a ~200-character snippet gets "Low
//     detail" instead of a list of skills it may never have asked for.
//   - Explain my fit costs a credit (the server charges it); reopening a job
//     already explained is free.
//
// The resume never leaves the device except as the parsed fields the ranker
// needs and, for Explain my fit, the corpus — transient request bodies, never
// stored server-side (CLAUDE.md rule 8).

// ---------- constants (as the backend page) ----------

const REMOTE_OPTIONS = [
  { value: 'any', label: 'Any' },
  { value: 'true', label: 'Remote' },
  { value: 'false', label: 'On-site' },
];
const SORT_OPTIONS = [
  { value: 'match', label: 'Best match' },
  { value: 'newest', label: 'Newest' },
];
const EMPTY_FILTERS = Object.freeze({ remote: 'any', location: '', sources: [] });
const REFETCH_DEBOUNCE_MS = 400;
// Mirrors PREFILTER_LIMIT / the batch size in server/jobs/ — the progress
// label only; nothing depends on them being exact.
const PREFILTER_LIMIT_ESTIMATE = 30;
const RANK_BATCH_SIZE = 30;
const PROGRESS_TICK_MS = 1600;
const THIN_POOL = 12;
const MAX_MATCHED_CHIPS = 5;
const MAX_MISSING_CHIPS = 5;
const MAX_TITLE_CHIPS = 3;
const SCORE_BAND_STRONG = 80;
const SCORE_BAND_FAIR = 60;
const RELAXED_LABELS = { location: 'location', remote: 'remote' };

/**
 * The rank that survives leaving the page: `{ key, filters, result }`. Module
 * scope on purpose — the view is unmounted when another workspace opens. A
 * full reload clears it, which is right: that is a new session and the pool
 * has probably moved. Memory only: it holds third-party listings, not the
 * user's material, and nothing here needs to outlive the tab.
 */
let lastRank = null;

// ---------- pure helpers (as the backend page) ----------

const asArray = (value) => (Array.isArray(value) ? value : []);
const asObjectArray = (value) => asArray(value).filter((item) => item && typeof item === 'object');
const finiteOr = (value, fallback) => (Number.isFinite(value) ? value : fallback);

/** The location value is `"<kind>:<value>"`, so resolving it is a split, not a guess. */
function resolveLocationFilter(selection) {
  const raw = String(selection || '').trim();
  if (!raw) return {};
  const cut = raw.indexOf(':');
  const kind = cut > 0 ? raw.slice(0, cut) : '';
  const value = cut > 0 ? raw.slice(cut + 1).trim() : '';
  if (value) {
    if (kind === 'country') return { locationCountry: value };
    if (kind === 'region') return { locationRegion: value };
    if (kind === 'city') return { locationCity: value };
  }
  // Degraded path: a free-text box with no facets behind it.
  return { location: raw };
}

function locationDisplayName(selection) {
  const raw = String(selection || '').trim();
  if (!raw) return '';
  const cut = raw.indexOf(':');
  return (cut > 0 ? raw.slice(cut + 1).trim() : raw) || '';
}

function locationPoolCount(selection, groups) {
  const raw = String(selection || '').trim();
  const cut = raw.indexOf(':');
  if (cut <= 0) return null;
  const kind = raw.slice(0, cut);
  const value = raw.slice(cut + 1).trim().toLowerCase();
  for (const group of asArray(groups)) {
    if (group?.kind !== kind) continue;
    for (const entry of asArray(group.entries)) {
      if (String(entry?.value || '').trim().toLowerCase() === value) return finiteOr(entry?.count, null);
    }
  }
  return null;
}

/** Sources sorted, so ticking A then B and B then A is the same question. */
function rankKey(resumeSignature, filters) {
  const sources = asArray(filters?.sources).slice().sort().join(',');
  return JSON.stringify([resumeSignature, filters?.remote ?? 'any', filters?.location ?? '', sources]);
}
const sameFilters = (a, b) => rankKey('', a) === rankKey('', b);

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

const qualityOf = (job) => job?.descriptionQuality || job?.description_quality || job?.quality || 'full';
const isSnippet = (job) => qualityOf(job) === 'snippet';
const durationLabel = (ms) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)}s` : '—');

/** The four plain fields /api/jobs/rank and /explain expect — never a built profile (it holds a Map). */
function parsedProfileOf(resume) {
  const parsed = resume?.parsed || {};
  return {
    skills: asArray(parsed.skills),
    titles: asArray(parsed.titles),
    seniority: finiteOr(parsed.seniority, null),
    yearsExperience: finiteOr(parsed.yearsExperience, null),
  };
}

/** src/matching reads database column names; this is the wire job, renamed. */
function toMatcherJob(job) {
  return { title: job?.title, keywords: job?.keywords, keyword_terms: job?.keywordTerms, description_quality: qualityOf(job) };
}

function coverageTone(met, total) {
  const value = total > 0 ? Math.round((met / total) * 100) : 0;
  if (value >= SCORE_BAND_STRONG) return 'olive';
  if (value >= SCORE_BAND_FAIR) return 'amber';
  return undefined;
}

const severityTone = (severity) => (severity === 'blocking' ? 'clay' : severity === 'significant' ? 'amber' : 'olive');

function relaxedNames(relaxed) {
  const list = asArray(relaxed).map((name) => RELAXED_LABELS[name] || String(name));
  if (!list.length) return '';
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}
function relaxedFilterPhrase(relaxed) {
  const names = relaxedNames(relaxed);
  return names ? `your ${names} ${asArray(relaxed).length === 1 ? 'filter' : 'filters'}` : '';
}
function relaxedLabel(relaxed) {
  const phrase = relaxedFilterPhrase(relaxed);
  return phrase ? `Outside ${phrase}` : '';
}

// ---------- the view ----------

export function mount(body, ctx) {
  let alive = true;

  let resume = null;
  let resumeLoading = true;
  let meta = null;
  let metaLoading = true;
  let locations = { countries: [], regions: [], cities: [], degraded: true };

  let draft = lastRank?.filters || EMPTY_FILTERS;
  let applied = lastRank?.filters || EMPTY_FILTERS;
  let sort = 'match';

  let result = null;
  let ranking = false;
  let scoredSoFar = 0;
  let loadError = null;
  let actionError = null;
  let explanations = {};
  let openExplainId = null;
  let footerOpen = false;
  let dropUploading = false;
  let dropError = '';

  let rankTimer = null;
  let rankSeq = 0;
  let progressTimer = null;
  let lastSignature = null;
  let drop = null;

  // ---------- derived ----------
  const resumeSignature = () => (resume ? JSON.stringify([resume.sourceHash || '', parsedProfileOf(resume)]) : '');
  let builtProfile = null;
  function rebuildProfile() {
    try {
      builtProfile = resume ? buildResumeProfile(parsedProfileOf(resume)) : null;
    } catch (error) {
      log.warn('resume profile build failed', error?.message || error);
      builtProfile = null;
    }
  }

  function locationGroups() {
    return [
      { kind: 'country', label: 'Countries', entries: asObjectArray(locations?.countries) },
      { kind: 'region', label: 'States & regions', entries: asObjectArray(locations?.regions) },
      { kind: 'city', label: 'Cities', entries: asObjectArray(locations?.cities) },
    ].map((group) => ({
      ...group,
      entries: group.entries
        .map((entry) => ({ value: String(entry?.value || '').trim(), count: finiteOr(entry?.count, 0) }))
        .filter((entry) => entry.value),
    })).filter((group) => group.entries.length);
  }

  const missingFor = (job) => {
    if (!builtProfile || isSnippet(job)) return [];
    try {
      return missingKeywords(builtProfile, toMatcherJob(job), { limit: MAX_MISSING_CHIPS });
    } catch (error) {
      log.warn('missing keyword diff failed', error?.message || error);
      return [];
    }
  };
  const coverageFor = (job) => {
    if (!builtProfile || isSnippet(job)) return null;
    try {
      return keywordCoverage(builtProfile, toMatcherJob(job));
    } catch (error) {
      log.warn('coverage count failed', error?.message || error);
      return null;
    }
  };

  /** Tier first (jobs honouring every filter ahead of broadened ones), then the sort. */
  function visibleJobs() {
    const sorted = asArray(result?.jobs).slice();
    const tier = (entry) => (entry?.relaxedFilters ? 1 : 0);
    if (sort === 'newest') {
      sorted.sort((a, b) => {
        const byTier = tier(a) - tier(b);
        if (byTier) return byTier;
        const ap = Date.parse(a?.job?.postedAt || '') || 0;
        const bp = Date.parse(b?.job?.postedAt || '') || 0;
        if (bp !== ap) return bp - ap;
        return (b?.score || 0) - (a?.score || 0);
      });
    } else {
      sorted.sort((a, b) => {
        const byTier = tier(a) - tier(b);
        if (byTier) return byTier;
        const diff = (b?.score || 0) - (a?.score || 0);
        if (diff) return diff;
        return String(a?.job?.title || '').localeCompare(String(b?.job?.title || ''));
      });
    }
    return sorted;
  }

  // ---------- layout ----------
  const resumeSec = h('div');
  const filtersSec = h('div');
  const resultsSec = h('div');
  const explainSec = h('div');
  fill(body, resumeSec, filtersSec, resultsSec, explainSec);

  const switcher = resumeSwitcher({
    toast: ctx.toast,
    onChange: (store) => {
      const id = store?.activeResumeId;
      resume = id && store?.resumes?.[id] ? { id, ...store.resumes[id] } : null;
      resumeLoading = false;
      onResumeChanged();
    },
  });

  // ---------- resume ----------
  function renderResume() {
    let content;
    if (resumeLoading || resume) {
      // No drop zone on screen, so none listening.
      drop?.destroy();
      drop = null;
    }
    if (resumeLoading) {
      content = skeleton(2, ['100%', '66%']);
    } else if (!resume) {
      const zone = h('div.drop.drop-tall', null,
        h('div.drop-icon', null, ico(dropUploading ? 'spark' : 'upload', 22)),
        h('div.drop-text', null,
          h('p.drop-title', null, dropUploading ? 'Reading your resume…' : 'Drop a resume here, or use the picker'),
          h('p.drop-sub', null, dropUploading
            ? 'Pulling out your skills and experience.'
            : `Jobs are ranked against your resume, so nothing is ranked until there is one. PDF or image, up to ${MAX_RESUME_LABEL}.`)),
        dropUploading && spinner(),
        dropError && h('p.drop-err', { role: 'alert' }, dropError));
      drop?.destroy();
      drop = fileDrop(zone, {
        isDisabled: () => dropUploading,
        onDragChange: (on) => { if (on && dropError) { dropError = ''; zone.querySelector('.drop-err')?.remove(); } },
        onDrop: handleResumeDrop,
      });
      content = zone;
    } else {
      const profile = parsedProfileOf(resume);
      content = h('div.chips.resume-summary', null,
        tag(`${profile.skills.length} skills`, 'ink'),
        tag(Number.isFinite(profile.yearsExperience) ? `${profile.yearsExperience} yrs experience` : 'Experience not detected', 'ink'),
        tag(`${asArray(resume.corpus).length} corpus items`),
        profile.titles.slice(0, MAX_TITLE_CHIPS).map((title) => tag(title)),
        profile.titles.length > MAX_TITLE_CHIPS && h('span.meta-note', null, `+${profile.titles.length - MAX_TITLE_CHIPS} more titles`),
        resume.needsReupload && tag('Re-upload needed', 'amber'));
    }
    fill(resumeSec, section({ num: 1, label: 'Resume', title: 'What you are ranked on', desc: 'Upload a resume or pick one you have used before. Only its skills, titles and experience go to the ranker.' },
      h('div.card', null, switcher.el, h('div.resume-body', null, content))));
  }

  async function handleResumeDrop(files) {
    dropError = '';
    if (files.length > 1) {
      dropError = 'Drop one resume at a time.';
      renderResume();
      return;
    }
    dropUploading = true;
    renderResume();
    try {
      const parsed = await parseResumeFile(files[0]);
      if (!parsed.ok) {
        dropError = parsed.error.message;
        return;
      }
      await saveParsedResume(parsed);
      if (!alive) return;
      await switcher.refresh();   // reports the new active resume back through onChange
      ctx.toast('Resume read.');
    } catch (e) {
      log.warn('resume drop upload failed', { errName: e?.name });
      dropError = e?.message || 'Upload failed.';
    } finally {
      dropUploading = false;
      if (alive) renderResume();
    }
  }

  // ---------- filters ----------
  function renderFilters() {
    if (!resume) {
      fill(filtersSec);
      return;
    }
    const groups = locationGroups();
    const degraded = groups.length === 0;

    // A selection whose place aged out of the pool is re-offered and named,
    // rather than letting the select snap silently to another value.
    let orphan = null;
    if (draft.location && !degraded && !groups.some((g) => g.entries.some((e) => `${g.kind}:${e.value}` === draft.location))) {
      const cut = draft.location.indexOf(':');
      orphan = cut > 0 ? draft.location.slice(cut + 1) : draft.location;
    }

    const remoteSel = select(REMOTE_OPTIONS, { value: draft.remote, onchange: (e) => setDraft({ remote: e.target.value }) });
    const locationControl = degraded
      ? input({ value: draft.location, placeholder: 'City, region, or country', oninput: (e) => setDraft({ location: e.target.value }) })
      : select([
        { value: '', label: 'Anywhere' },
        ...(orphan ? [{ value: draft.location, label: `${orphan} (no current listings)` }] : []),
        ...groups.map((g) => ({ label: g.label, options: g.entries.map((e) => ({ value: `${g.kind}:${e.value}`, label: `${e.value} (${e.count})` })) })),
      ], { value: draft.location, onchange: (e) => setDraft({ location: e.target.value }) });
    const sortSel = select(SORT_OPTIONS, { value: sort, onchange: (e) => { sort = e.target.value; renderResults(); } });

    const available = asObjectArray(meta?.sources).filter((s) => s.enabled !== false || finiteOr(s.count, 0) > 0);
    const sources = metaLoading
      ? skeleton(1, ['14rem'])
      : available.length === 0
        ? h('p.muted', null, 'No sources reported. All available listings are included.')
        : h('div.chips', { role: 'group', 'aria-label': 'Sources' }, available.map((s) => h('button.chip.is-toggle', {
          type: 'button',
          'aria-pressed': String(draft.sources.includes(s.id)),
          title: s.lastError ? `Last collection run failed: ${s.lastError}` : null,
          onclick: (e) => {
            const on = !draft.sources.includes(s.id);
            setDraft({ sources: on ? [...draft.sources, s.id] : draft.sources.filter((id) => id !== s.id) });
            e.currentTarget.setAttribute('aria-pressed', String(on));
          },
        }, s.id, h('span.chip-count', null, String(finiteOr(s.count, 0))), s.lastError && ico('alert', 12))));

    const card = h('div.card', {
      onkeydown: (e) => {
        if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
          e.preventDefault();
          applyFilters();
        }
      },
    },
    h('div.fgrid', null,
      field({ label: 'Remote', span: 2, control: remoteSel }),
      field({ label: 'Location', span: 2, control: locationControl }),
      field({ label: 'Sort', span: 2, control: sortSel })),
    h('div.f.span-6.sources', null,
      h('p.f-k', null, 'Sources'),
      sources,
      h('p.f-hint', null, 'Leave every source unselected to search all of them.')),
    applyBar,
    h('p.filters-note', null, ico('info', 13),
      h('span', null, 'Remote, location and source changes take effect when you press Apply. Sort re-orders the results you already have, instantly and without re-scoring. Nothing re-ranks on its own — not even when you leave this page and come back.')));

    fill(filtersSec, section({ num: 2, label: 'Filters', title: 'Narrow the pool' }, card));
    renderApplyBar();
  }

  const applyBtn = button('Apply filters', { kind: 'solid', icon: 'check', onClick: () => applyFilters() });
  const discardBtn = button('Discard changes', { kind: 'ghost', size: 'sm', onClick: () => { draft = applied; renderFilters(); } });
  const pendingNote = h('span.meta-note');
  const applyBar = h('div.apply-bar', null, applyBtn, discardBtn, pendingNote);

  function renderApplyBar() {
    const pending = !sameFilters(draft, applied);
    applyBtn.disabled = !pending || ranking;
    discardBtn.hidden = !pending;
    pendingNote.textContent = pending
      ? 'Not applied yet — the list below still answers the previous filters.'
      : 'These are the filters the list below was ranked with.';
  }

  function setDraft(patch) {
    draft = { ...draft, ...patch };
    renderApplyBar();
  }

  function applyFilters() {
    if (sameFilters(draft, applied)) return;
    applied = draft;
    renderApplyBar();
    scheduleRank(false);
  }

  // ---------- ranking ----------
  function onResumeChanged() {
    const signature = resumeSignature();
    renderResume();
    if (signature === lastSignature) return;   // same content: no re-rank
    lastSignature = signature;
    rebuildProfile();
    renderFilters();
    scheduleRank(false);
    renderResults();
  }

  /**
   * Asks for a ranking of the applied filters. `fresh` (Refresh) asks again
   * even when the same question has an answer in hand; anything else is
   * answered from `lastRank` when the question matches, with no network.
   */
  function scheduleRank(fresh) {
    clearTimeout(rankTimer);
    // Any new question supersedes a rank still in flight: its answer is kept
    // in lastRank for its own question, but no longer shown.
    const seq = ++rankSeq;
    if (ranking) setRanking(false);
    const signature = resumeSignature();
    if (!signature) {
      result = null;
      renderResults();
      return;
    }
    const key = rankKey(signature, applied);
    if (!fresh && lastRank && lastRank.key === key) {
      result = lastRank.result;
      loadError = null;
      renderResults();
      return;
    }
    const filters = applied;
    const profile = parsedProfileOf(resume);
    const resumeHash = resume?.sourceHash || '';
    rankTimer = setTimeout(() => {
      if (seq !== rankSeq) return;
      setRanking(true);
      loadError = null;
      renderResults();
      rankJobs({
        resumeProfile: profile,
        filters: { remote: filters.remote, source: asArray(filters.sources).slice().sort().join(','), ...resolveLocationFilter(filters.location) },
        resumeHash,
        matcherVersion: MATCHER_VERSION,
      })
        .then((data) => {
          // Kept even if superseded: it is still the right answer to its question.
          lastRank = { key, filters, result: data };
          if (!alive || seq !== rankSeq) return;
          result = data;
          setRanking(false);
          renderResults();
        })
        .catch((error) => {
          if (!alive || seq !== rankSeq) return;
          log.warn('job ranking failed', error?.message || error);
          loadError = error?.message || 'Could not rank jobs.';
          setRanking(false);
          renderResults();
        });
    }, REFETCH_DEBOUNCE_MS);
  }

  /** The batch counter is an estimate on a timer: one POST, no progress channel. */
  function setRanking(on) {
    ranking = on;
    clearInterval(progressTimer);
    if (on) {
      scoredSoFar = 0;
      progressTimer = setInterval(() => {
        scoredSoFar = Math.min(scoredSoFar + RANK_BATCH_SIZE, PREFILTER_LIMIT_ESTIMATE - RANK_BATCH_SIZE);
        const counter = resultsSec.querySelector('[data-progress]');
        if (counter) counter.textContent = progressText();
      }, PROGRESS_TICK_MS);
    }
    renderApplyBar();
  }
  const progressText = () => `Scoring ${Math.min(scoredSoFar + RANK_BATCH_SIZE, PREFILTER_LIMIT_ESTIMATE)} of ${PREFILTER_LIMIT_ESTIMATE} jobs`;

  function refreshEverything() {
    scheduleRank(true);
    loadMeta();
  }

  // ---------- results ----------
  function renderResults() {
    if (!resume) {
      fill(resultsSec);
      return;
    }
    const ranked = asArray(result?.jobs);
    const visible = visibleJobs();
    const keywordOnly = result?.scoredBy === 'keyword';
    const partial = result?.scoredBy === 'mixed';
    const relaxed = asArray(result?.relaxedFilters);
    const inFilterCount = Number.isFinite(result?.inFilterCount) ? result.inFilterCount : ranked.filter((e) => !e?.relaxedFilters).length;
    const belowFloorCount = Number.isFinite(result?.belowFloorCount) ? result.belowFloorCount : 0;
    const minScore = Number.isFinite(result?.minScore) ? result.minScore : null;
    const poolIsEmpty = Number.isFinite(meta?.total) ? meta.total === 0 : false;
    const place = locationDisplayName(applied.location);
    const placeCount = locationPoolCount(applied.location, locationGroups());

    const refreshBtn = button('Refresh matches', { kind: 'solid', icon: 'refresh', size: 'sm', onClick: refreshEverything, disabled: ranking });
    if (ranking) setBusy(refreshBtn, true, 'Ranking…');

    let list;
    if (ranking) {
      list = h('div.ranking', null,
        h('p.busy-row', null, h('span.spin', { 'aria-hidden': 'true' }), h('span', { 'data-progress': '' }, progressText())),
        h('p.meta-note', null, 'Ranking runs in batches and usually takes 5–20 seconds. The count is an estimate; the exact numbers arrive with the result.'),
        skeleton(3, ['100%', '100%', '100%']).map((el) => { el.classList.add('skel-card'); return el; }));
    } else if (loadError && !result) {
      list = note('amber', h('p', null, loadError), h('button.link-btn', { type: 'button', onclick: () => scheduleRank(true) }, 'Try again'));
    } else if (!result) {
      list = h('p.muted', null, 'Apply a filter to start a ranking run.');
    } else if (poolIsEmpty && ranked.length === 0) {
      list = h('div.empty-box', null, ico('clock', 22),
        h('p.empty-title', null, 'Job listings are still being collected. Check back tomorrow.'),
        h('p.muted', null, 'Listings are gathered on a schedule, so the pool fills up before the first search can return anything.'));
    } else if (visible.length === 0) {
      list = h('div.empty-box', null, ico('briefcase', 22),
        h('p.empty-title', null, place ? `No matches in ${place} right now.` : 'No matches right now.'),
        h('p.muted', null, belowFloorCount > 0 && minScore !== null
          ? `We scored ${belowFloorCount} ${belowFloorCount === 1 ? 'listing' : 'listings'}${place ? ` in ${place}` : ''} and none reached a ${minScore}% match, so none are shown. Nothing was substituted from elsewhere.`
          : place && placeCount !== null && placeCount <= THIN_POOL
            ? `We are only holding ${placeCount} ${placeCount === 1 ? 'listing' : 'listings'} for ${place}, and none of them line up with your resume. Nothing was substituted from elsewhere.`
            : 'Nothing was substituted from another location. Try a different place, or clear a source filter.'));
    } else {
      list = h('div.jobs', null, visible.map(jobCard));
    }

    fill(resultsSec, section({ num: 3, label: 'Matches', title: 'Ranked for you' },
      h('div.card.results', null,
        loadError && result && note('amber',
          h('p', null, h('strong', null, `Couldn’t refresh: ${loadError}`)),
          h('p', null, 'Showing your previous results. ', h('button.link-btn', { type: 'button', onclick: () => scheduleRank(true) }, 'Try again'))),
        h('div.results-head', null,
          h('p.results-count', null, !ranking && result ? `${visible.length} ${visible.length === 1 ? 'match' : 'matches'}` : ''),
          refreshBtn),
        !ranking && result && keywordOnly && note('amber',
          h('p.note-title', null, 'AI scoring unavailable — showing keyword matches.'),
          h('p.note-sub', null, result?.meta?.degradeReason === 'rate_limited'
            ? 'The scoring service is rate limited right now. Scores come from keyword overlap alone, so treat them as approximate — try again shortly.'
            : 'Scores come from keyword overlap alone, so treat them as approximate.')),
        !ranking && result && partial && note('amber',
          h('p.note-title', null, 'Some jobs were scored by keyword only.'),
          h('p.note-sub', null, 'The rest are AI-scored. This result is kept for a shorter time than a fully scored one, so it refreshes sooner on its own.')),
        !ranking && result && relaxed.length > 0 && note('amber',
          h('p.note-title', null, inFilterCount === 0
            ? `Nothing matched inside ${relaxedFilterPhrase(relaxed)}, so the search was broadened.`
            : `Only ${inFilterCount} ${inFilterCount === 1 ? 'job' : 'jobs'} matched inside ${relaxedFilterPhrase(relaxed)}, so the search was broadened.`),
          h('p.note-sub', null, inFilterCount === 0
            ? 'Every job below ignores it, and each is marked with what it ignores.'
            : 'Those are listed first. The rest are marked with what they ignore.')),
        !ranking && result?.limited === true && note('amber',
          h('p.note-title', null, 'Refreshing again shortly.'),
          h('p.note-sub', null, 'The hourly ranking limit was reached, so this is a partial result. Everything that came back is shown below.')),
        actionError && note('clay', h('p', null, actionError)),
        list,
        (result || meta) && runTransparency(ranked.length))));
  }

  function jobCard(entry) {
    const job = entry.job || {};
    const snippet = isSnippet(job);
    const posted = relativeTime(job.postedAt);
    const matched = asArray(entry.matchedSignals);
    const missing = missingFor(job);
    const coverage = coverageFor(job);
    const relaxed = relaxedLabel(entry.relaxedFilters);
    const explaining = explanations[entry.jobId]?.loading === true;
    const explainBtn = button('Explain my fit', { kind: 'ghost', size: 'sm', icon: 'spark', onClick: () => handleExplain(entry), disabled: explaining });
    explainBtn.append(h('span.btn-cost', null, explanations[entry.jobId]?.data ? 'ready' : '1 credit'));
    if (explaining) setBusy(explainBtn, true, 'Reading…');

    return h('article.job', { class: openExplainId === entry.jobId ? 'is-open' : '' },
      h('div.job-top', null,
        h('div.job-id', null,
          h('h4.job-title', null, job.title || 'Untitled role'),
          h('p.job-meta', null,
            job.company && h('span', null, ico('building', 13), job.company),
            job.location && h('span', null, ico('pin', 13), job.location),
            posted && h('span', null, ico('clock', 13), posted))),
        coverage && Number.isFinite(coverage.total) && coverage.total > 0
          && tag(`${coverage.met} of ${coverage.total} matched`, coverageTone(coverage.met, coverage.total), { title: `This role lists ${coverage.total} things; your resume evidences ${coverage.met}.` })),
      entry.gapSummary && h('p.job-gap', null, entry.gapSummary),
      h('div.chips', null,
        relaxed && tag(relaxed, 'amber', { title: 'Too few strong matches were found inside your filters, so this search was broadened.' }),
        job.isRemote && tag('Remote', 'ink'),
        job.source && tag(job.source),
        snippet && tag('Low detail', 'amber', { title: 'Only a short excerpt of this posting was available.' }),
        entry.scoredBy === 'keyword' && tag('Keyword score', 'slate')),
      matched.length > 0 && h('div.job-signals', null,
        h('p.f-k', null, 'Matched'),
        h('div.chips', null, matched.slice(0, MAX_MATCHED_CHIPS).map((term) => tag(term, 'olive')))),
      !snippet && missing.length > 0 && h('div.job-signals', null,
        h('p.f-k', null, 'Not evidenced in your resume'),
        h('div.chips', null, missing.map((item) => tag(item.required ? `${item.term} · required` : item.term, 'amber')))),
      h('div.job-acts', null,
        job.url && h('a.btn.btn-ghost.btn-sm', { href: job.url, target: '_blank', rel: 'noopener noreferrer' }, ico('external', 14), h('span.btn-label', null, 'Open posting')),
        explainBtn));
  }

  function runTransparency(returnedCount) {
    const runSources = asObjectArray(result?.meta?.sources);
    const reformulations = asArray(result?.reformulations);
    const failed = asObjectArray(meta?.sources).filter((s) => s.lastError);
    const timings = result?.meta?.timings;
    const toggle = h('button.run-toggle', { type: 'button', 'aria-expanded': String(footerOpen), onclick: () => { footerOpen = !footerOpen; renderResults(); } },
      h('span.label', null, 'How this run worked'), ico('chevron', 14));
    if (!footerOpen) return h('div.run', null, toggle);

    const row = (k, v) => h('div.run-row', null, h('dt', null, k), h('dd', null, v));
    return h('div.run', null, toggle,
      h('dl.run-list', null,
        row('Sources used', runSources.length ? runSources.map((s) => `${s.id} (${s.count})`).join(', ') : 'none reported'),
        // Phase timings, not per source: one pool query serves every source.
        row('Phase timing', `prefilter ${durationLabel(timings?.prefilterMs)} · rank ${durationLabel(timings?.rankMs)} · reformulate ${durationLabel(timings?.reformulateMs)} · total ${durationLabel(timings?.totalMs)}`),
        row('Jobs considered', `${finiteOr(result?.meta?.poolSize, 0)} in the pool · ${finiteOr(result?.meta?.sentToScorer, finiteOr(result?.meta?.prefilterLimit, PREFILTER_LIMIT_ESTIMATE))} sent to the scorer · ${returnedCount} returned${Number.isFinite(result?.belowFloorCount) && result.belowFloorCount > 0 && Number.isFinite(result?.minScore) ? ` · ${result.belowFloorCount} below the ${result.minScore}% match floor, not shown` : ''}`),
        row('Scored by', `${result?.scoredBy === 'llm' ? 'AI model' : result?.scoredBy === 'mixed' ? 'AI model, with a keyword fallback on some jobs' : 'keyword matcher only'}${result?.cached === true ? ' · served from cache' : ''}${Number.isFinite(result?.meta?.matcherVersion) ? ` · matcher v${result.meta.matcherVersion}` : ''}${result?.meta?.budgetExhausted === true ? ' · stopped early to stay within the time budget' : ''}`),
        row('Query reformulation', reformulations.length
          ? h('ul.run-steps', null, reformulations.map((step) => h('li', null, h('strong', null, step?.step || 'broadened'), ' — ', step?.reason || `broadened ${step?.broadened || 'the query'} from ${step?.from} to ${step?.to}`)))
          : `The query was not reformulated${Number.isFinite(result?.loops) ? ` (${result.loops} loop${result.loops === 1 ? '' : 's'})` : ''}.`),
        result?.meta?.requestId && row('Request id', h('code', null, result.meta.requestId))),
      failed.length > 0 && note('amber',
        h('p.note-title', null, 'Some sources failed at their last collection run:'),
        h('ul.note-list', null, failed.map((s) => h('li', null, h('strong', null, s.id), `: ${s.lastError}${s.lastRunAt ? ` (last run ${relativeTime(s.lastRunAt) || s.lastRunAt})` : ''}`)))),
      meta?.degraded && note('amber',
        h('p', null, `Source status could not be read in full${meta?.error ? `: ${meta.error}` : '.'} `,
          h('button.link-btn', { type: 'button', onclick: loadMeta }, 'Try again'))));
  }

  // ---------- explain my fit ----------
  async function handleExplain(entry) {
    const jobId = entry?.jobId;
    if (!jobId) return;
    openExplainId = jobId;
    actionError = null;
    if (explanations[jobId]?.data) {
      renderResults();
      renderExplain(true);
      return;
    }
    explanations = { ...explanations, [jobId]: { loading: true, error: null, data: null } };
    renderResults();
    renderExplain(true);
    try {
      const analysis = await explainJob({ job: entry.job, corpus: asArray(resume?.corpus), resumeProfile: parsedProfileOf(resume) });
      if (!alive) return;
      explanations = { ...explanations, [jobId]: { loading: false, error: null, data: analysis } };
      refreshCreditsQuietly();
    } catch (error) {
      log.warn('job explain failed', error?.message || error);
      if (!alive) return;
      const message = error?.message || 'Could not analyse this job.';
      explanations = { ...explanations, [jobId]: { loading: false, error: message, data: null } };
      actionError = message;
      ctx.toast(message, 'error');
    }
    renderResults();
    renderExplain();
  }

  /** The server charged a credit for the explanation; the settings pill should say so. */
  async function refreshCreditsQuietly() {
    try {
      const credits = await ctx.getCredits();
      if (credits !== null && alive) ctx.setCredits(credits);
    } catch {
      /* the pill catches up on the next read */
    }
  }

  function renderExplain(scrollTo = false) {
    if (!openExplainId || !resume) {
      fill(explainSec);
      return;
    }
    const entry = asArray(result?.jobs).find((e) => e.jobId === openExplainId) || null;
    const state = explanations[openExplainId];
    let content;
    if (state?.loading) {
      content = h('div', null,
        h('p.busy-row', null, h('span.spin', { 'aria-hidden': 'true' }), 'Reading the full posting against your resume…'),
        skeleton(3, ['100%', '100%', '66%']));
    } else if (state?.error) {
      content = note('clay', h('p', null, state.error),
        entry && h('button.link-btn', { type: 'button', onclick: () => { const next = { ...explanations }; delete next[entry.jobId]; explanations = next; handleExplain(entry); } }, 'Try again'));
    } else if (state?.data) {
      content = explanationBody(state.data, Boolean(entry?.job) && isSnippet(entry.job));
    } else {
      content = h('p.muted', null, 'Choose Explain my fit on a job to see the analysis here.');
    }

    fill(explainSec, section({ num: 4, label: 'Your fit', title: entry?.job?.title || 'This role', desc: entry?.job?.company || '' },
      h('div.card.explain', null,
        h('div.explain-head', null, button('Close', { kind: 'ghost', size: 'sm', icon: 'x', onClick: () => { openExplainId = null; renderResults(); renderExplain(); } })),
        content)));
    if (scrollTo) explainSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function explanationBody(data, snippet) {
    const strengths = asArray(data.strengths);
    const gaps = asArray(data.gaps);
    const suggestions = asArray(data.tailoringSuggestions);
    return h('div.explain-body', null,
      data.fitAnalysis && h('div.explain-analysis', null,
        String(data.fitAnalysis).split(/\n{2,}/).filter(Boolean).map((p) => h('p', null, p))),
      strengths.length > 0 && h('div.explain-block', null,
        h('p.label', null, 'Strengths'),
        h('ul.explain-list', null, strengths.map((item) => h('li.is-strength', null,
          h('p.explain-req', null, item?.requirement || 'Strength'),
          item?.evidence && h('p.explain-ev', null, item.evidence))))),
      gaps.length > 0 && h('div.explain-block', null,
        h('p.label', null, 'Gaps'),
        h('ul.explain-list', null, gaps.map((item) => h('li', null,
          h('div.explain-req-row', null,
            h('p.explain-req', null, item?.requirement || 'Gap'),
            item?.severity && tag(item.severity, severityTone(item.severity))),
          item?.evidence && h('p.explain-ev', null, item.evidence))))),
      suggestions.length > 0 && h('div.explain-block', null,
        h('p.label', null, 'How to tailor your application'),
        // Advice, not replacement text: nothing here is rewritten prose.
        h('p.meta-note', null, 'These are directions to take, not rewritten text. The wording stays yours.'),
        h('ul.explain-list', null, suggestions.map((item) => (typeof item === 'string'
          ? h('li', null, h('p', null, item))
          : h('li', null,
            item?.corpusRef && tag(item.corpusRef),
            item?.currentText && h('div.explain-quote', null, h('p.f-k', null, 'Your current wording'), h('blockquote', null, item.currentText)),
            item?.suggestedAngle && h('div', null, h('p.f-k', null, 'Angle to take'), h('p', null, item.suggestedAngle)),
            item?.reason && h('div', null, h('p.f-k', null, 'Why'), h('p.explain-ev', null, item.reason))))))),
      snippet && note('amber', h('p', null, 'Only a short excerpt of this posting was available, so this analysis reads a partial description. Open the posting for the full requirements.')));
  }

  // ---------- pool metadata ----------
  function loadMeta() {
    metaLoading = true;
    renderFilters();
    fetchJobsMeta()
      .then((data) => { meta = data; })
      .catch((error) => {
        log.warn('job meta read failed', error?.message || error);
        meta = { sources: [], total: 0, oldestPostedAt: null, degraded: true, error: error?.message || String(error) };
      })
      .finally(() => {
        metaLoading = false;
        if (alive) { renderFilters(); renderResults(); }
      });
    fetchJobLocations().then((data) => {
      if (!alive) return;
      locations = data;
      renderFilters();
    });
  }

  // ---------- boot ----------
  renderResume();
  getActiveResume()
    .then((record) => {
      if (!alive || !resumeLoading) return;   // the switcher answered first
      resume = record;
      resumeLoading = false;
      onResumeChanged();
    })
    .catch((error) => {
      log.warn('active resume read failed', error?.message || error);
      if (!alive || !resumeLoading) return;
      resume = null;
      resumeLoading = false;
      onResumeChanged();
    });
  loadMeta();

  return {
    unmount() {
      alive = false;
      clearTimeout(rankTimer);
      clearInterval(progressTimer);
      drop?.destroy();
      switcher.destroy();
    },
  };
}
