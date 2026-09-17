/**
 * ATS boards — Greenhouse, Lever and Ashby behind one adapter.
 *
 * WHY THIS EXISTS: Adzuna's search endpoint truncates `description` to ~200
 * characters, so every row from there is stamped description_quality
 * 'snippet', the matcher down-weights it, and the UI hides the missing-keywords
 * row behind a "Low detail" badge. An applicant tracking system's public board
 * API returns the COMPLETE posting — measured 8,518 characters from Greenhouse
 * and 7,341 from Ashby — which is why every row from here is stamped 'full'.
 * That stamp is this file's entire reason for existing.
 *
 * THREE PROVIDERS, ONE SOURCE. All three are keyless, board-scoped, and return
 * a whole board in a single response. They differ only in URL shape, envelope,
 * and field names, so they live behind one adapter id ('ats') rather than three
 * near-identical files with three cursors and three ingest-state rows. The
 * provider and the board both go into source_id — 'greenhouse:figma:5426468004'
 * — so ids from different boards cannot collide.
 *
 * NO PAGING PER BOARD. Each endpoint hands back its entire job list at once;
 * none of them takes an offset, a page, a limit or a search parameter, so
 * `query` and `limit` from the adapter contract are accepted and ignored.
 * Instead the single integer cursor rotates through the CONFIGURED BOARDS, the
 * same trick adzuna.js plays with countries — see cursorToBoard().
 *
 *   ATS_BOARDS=greenhouse:figma,lever:spotify,ashby:ramp
 *
 * BOARDS MOVE. A board that is renamed or taken private answers 404, which
 * httpJson maps to 'network'. That is a named failure, not a crash: the board
 * name goes in the log line so it is diagnosable, and the run falls through to
 * the next source.
 *
 * NOTHING HERE LOGS A URL OR A DESCRIPTION — board names, counts and statuses
 * only. That is also why, unlike adzuna.js, the failure log omits the response
 * body snippet: a board's 200-with-bad-JSON body would be posting text.
 */
import { log } from '../../logger.js';
import { fetchJson, emptyResult, PER_ADAPTER_TIMEOUT_MS } from './httpJson.js';

const atsLog = log.child('jobs').child('ats');

/**
 * None of the three providers exposes a remote flag except Ashby, so for the
 * other two remoteness is inferred from title + location, as in adzuna.js.
 */
const REMOTE_RE = /\bremote\b/i;

/**
 * The board slug goes into the URL PATH, so it is validated, not escaped —
 * there is no encoding that makes an arbitrary string safe in a path segment.
 * Same reasoning as safeCountry() in adzuna.js. Anything that does not match is
 * dropped from the configured list rather than coerced into something else.
 */
const BOARD_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

// ------------------------------------------------------------------
// Small local helpers
//
// Deliberately not imported from src/matching or normalizeListing.js: adapters
// sit below that layer, and normalizeListing's stripHtml() strips tags BEFORE
// decoding entities, which is precisely the order that fails on Greenhouse.
// ------------------------------------------------------------------

/**
 * @param {unknown} value
 * @returns {string} A trimmed string; objects and arrays collapse to '' rather
 *   than to "[object Object]".
 */
function str(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/**
 * ISO string, or null. Never the string "Invalid Date", which is what
 * `new Date(junk).toISOString()` throws on and what string concatenation would
 * otherwise store.
 *
 * @param {unknown} value ISO string, Date, or epoch milliseconds.
 * @returns {string|null}
 */
function isoOrNull(value) {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  const t = d.getTime();
  return Number.isFinite(t) ? d.toISOString() : null;
}

/** The named entities that actually appear in board copy. */
const NAMED_ENTITIES = new Map(Object.entries({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', bull: '•',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
}));

const ENTITY_RE = /&(?:#x([0-9a-fA-F]{1,6})|#(\d{1,7})|([a-zA-Z][a-zA-Z0-9]{1,31}));/g;

/**
 * @param {number} value A parsed code point.
 * @param {string} fallback The original entity text, returned unchanged when
 *   the code point is not representable.
 * @returns {string}
 */
function fromCodePoint(value, fallback) {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) return fallback;
  try {
    return String.fromCodePoint(value);
  } catch {
    return fallback;
  }
}

/**
 * Decode HTML entities. An unknown entity is left exactly as it was — a bare
 * "&foo;" in body copy is more useful than a silently deleted one.
 *
 * @param {string} text
 * @returns {string}
 */
function decodeEntities(text) {
  if (!text) return '';
  return text.replace(ENTITY_RE, (match, hex, decimal, name) => {
    if (hex !== undefined) return fromCodePoint(parseInt(hex, 16), match);
    if (decimal !== undefined) return fromCodePoint(parseInt(decimal, 10), match);
    const key = String(name).toLowerCase();
    return NAMED_ENTITIES.has(key) ? NAMED_ENTITIES.get(key) : match;
  });
}

/** Tags that end a line of prose; everything else collapses to a space. */
const BLOCK_TAG_RE = /<\s*\/?\s*(?:p|div|br|li|ul|ol|tr|table|section|article|blockquote|h[1-6])\b[^>]*>/gi;
const ANY_TAG_RE = /<[^>]*>/g;

/**
 * Greenhouse markup → readable plain text.
 *
 * ORDER IS THE WHOLE POINT, and it is the single easiest thing to get wrong
 * here: Greenhouse returns `content` HTML-ESCAPED, so the body literally
 * contains "&lt;p&gt;" and "&quot;". Decode FIRST, then strip. Stripping first
 * finds no tags at all — the angle brackets are still entities — and the
 * decode afterwards hands the matcher a description full of visible "<p>".
 * normalizeListing's stripHtml() does it in that losing order, which is why
 * this function exists rather than a call to it.
 *
 * Newlines are preserved on purpose. extractKeywords() runs a heading state
 * machine over line structure (SEGMENT_SPLIT is /[\n\r•·]+|(?:\.\s)/), so
 * flattening a posting to one line would cost the "Requirements:" detection
 * that full descriptions are being fetched for in the first place.
 *
 * @param {unknown} value Raw `content` from the Greenhouse item.
 * @returns {string} Plain text, or ''.
 */
function htmlToText(value) {
  const decoded = decodeEntities(str(value));
  if (!decoded) return '';
  return decoded
    .replace(BLOCK_TAG_RE, '\n')
    .replace(ANY_TAG_RE, ' ')
    // \u00a0 is spelled out rather than pasted: a literal non-breaking space
    // inside a character class is invisible in a diff, and the next editor to
    // touch this line would silently drop it. Board copy is full of raw NBSPs.
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * First non-empty `name` out of a Greenhouse departments/offices array.
 *
 * @param {unknown} list
 * @returns {string}
 */
function firstName(list) {
  if (!Array.isArray(list)) return '';
  for (const entry of list) {
    const name = str(entry?.name);
    if (name) return name;
  }
  return '';
}

// ------------------------------------------------------------------
// The three providers
// ------------------------------------------------------------------

/**
 * Per-provider: how to build the URL, where the items live in the response,
 * and how one item maps onto the shared field names. `listing()` returns a
 * partial — toListing() below owns the final shape so all three land on
 * identical keys. `remote: undefined` means "infer it", which is every
 * provider except Ashby.
 */
const PROVIDERS = {
  /**
   * GET https://boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true
   * -> { jobs: [...] }. Confirmed: figma (154 jobs), stripe (647).
   * `location` is an OBJECT, `content` is escaped HTML, `company_name` is the
   * only place any of the three names the employer for us.
   */
  greenhouse: {
    url: (board) => `https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`,
    items: (data) => (Array.isArray(data?.jobs) ? data.jobs : null),
    listing: (raw) => ({
      title: str(raw.title),
      url: str(raw.absolute_url),
      company: str(raw.company_name),
      location: str(raw.location?.name),
      category: firstName(raw.departments),
      job_type: '',
      description: htmlToText(raw.content),
      posted_at: isoOrNull(raw.updated_at),
      remote: undefined,
    }),
  },

  /**
   * GET https://api.lever.co/v0/postings/{board}?mode=json
   * -> a BARE ARRAY, not an object. Confirmed: spotify (68), leverdemo (11);
   * plaid and anthropic 404 today, which is why a 404 is a named error here.
   * The title field is `text`, not `title`, and `createdAt` is epoch
   * MILLISECONDS rather than an ISO string.
   */
  lever: {
    url: (board) => `https://api.lever.co/v0/postings/${board}?mode=json`,
    items: (data) => (Array.isArray(data) ? data : null),
    listing: (raw) => ({
      title: str(raw.text),
      url: str(raw.hostedUrl) || str(raw.applyUrl),
      company: '',
      location: str(raw.categories?.location),
      category: str(raw.categories?.department) || str(raw.categories?.team),
      job_type: str(raw.categories?.commitment),
      // Already plain text upstream; nothing to decode and nothing to strip.
      description: str(raw.descriptionPlain),
      posted_at: isoOrNull(typeof raw.createdAt === 'number' ? raw.createdAt : null),
      remote: undefined,
    }),
  },

  /**
   * GET https://api.ashbyhq.com/posting-api/job-board/{board}
   * -> { jobs: [...] }. Confirmed: ramp (148 jobs). `location` is a plain
   * STRING here, and `isRemote` is a real boolean — the only one of the three
   * that states remoteness instead of leaving it to be guessed from a title.
   */
  ashby: {
    url: (board) => `https://api.ashbyhq.com/posting-api/job-board/${board}`,
    items: (data) => (Array.isArray(data?.jobs) ? data.jobs : null),
    listing: (raw) => ({
      title: str(raw.title),
      url: str(raw.jobUrl) || str(raw.applyUrl),
      company: '',
      location: str(raw.location),
      category: str(raw.department) || str(raw.team),
      job_type: str(raw.employmentType),
      description: str(raw.descriptionPlain),
      posted_at: isoOrNull(raw.publishedAt),
      remote: typeof raw.isRemote === 'boolean' ? raw.isRemote : undefined,
    }),
  },
};

/**
 * Every provider:board pair configured in ATS_BOARDS, validated.
 *
 * Sibling of configuredCountries() in adzuna.js, and invalid entries are
 * dropped for the same reason they are dropped there: coercing a typo into
 * something valid turns one mistake into a silent duplicate, or worse, into a
 * request for a board nobody asked for.
 *
 * Unlike adzuna's, this one has NO fallback. There is no sensible default
 * board, so nothing valid means [] — which is what makes enabled() false.
 *
 * @returns {{provider: string, board: string}[]} Possibly empty. The provider
 *   is lowercased; the board keeps its case, because the slug is a path
 *   segment on someone else's server.
 */
export function configuredBoards() {
  const seen = new Set();
  const boards = [];

  for (const part of String(process.env.ATS_BOARDS || '').split(',')) {
    const entry = part.trim();
    if (!entry) continue;

    // indexOf, not split: a third segment must fail validation rather than be
    // quietly discarded, so 'greenhouse:figma:oops' is dropped, not fetched.
    const at = entry.indexOf(':');
    if (at <= 0) continue;

    const provider = entry.slice(0, at).trim().toLowerCase();
    const board = entry.slice(at + 1).trim();
    if (!Object.prototype.hasOwnProperty.call(PROVIDERS, provider)) continue;
    if (!BOARD_RE.test(board)) continue;

    const key = `${provider}:${board}`;
    if (seen.has(key)) continue;
    seen.add(key);
    boards.push({ provider, board });
  }

  return boards;
}

/**
 * Map the ingest cursor onto one configured board.
 *
 * `job_ingest_state` stores ONE integer per source and each board returns its
 * whole job list in a single response, so there is no page-within-board to
 * count — the cursor's only job here is to say whose turn it is:
 *
 *   boards = [greenhouse:figma, lever:spotify, ashby:ramp]
 *   cursor 1 -> greenhouse:figma    cursor 4 -> greenhouse:figma
 *   cursor 2 -> lever:spotify       cursor 5 -> lever:spotify
 *   cursor 3 -> ashby:ramp          cursor 6 -> ashby:ramp
 *
 * Same round-robin, and the same reason, as cursorToTarget() in adzuna.js: a
 * run that exhausts its time budget after two requests should have covered two
 * boards rather than one board twice.
 *
 * @param {number} cursor 1-based cursor from job_ingest_state.
 * @param {{provider: string, board: string}[]} boards From configuredBoards().
 * @returns {{provider: string, board: string}|null} null only when there is
 *   nothing configured; total against junk otherwise.
 */
export function cursorToBoard(cursor, boards) {
  // hasOwnProperty, not PROVIDERS[b.provider]: `{ provider: 'constructor' }`
  // hits Object.prototype and would pass a truthiness check, then blow up on
  // `.url()` inside fetch() — a throw out of the one layer that must not throw.
  const list = Array.isArray(boards)
    ? boards.filter((b) => b && typeof b === 'object'
      && Object.prototype.hasOwnProperty.call(PROVIDERS, b.provider)
      && BOARD_RE.test(String(b.board ?? '')))
    : [];
  if (!list.length) return null;
  // Math.floor, not just Math.max: a fractional cursor makes `zeroBased % len`
  // fractional too, and list[0.7] is undefined — a hole in a function whose
  // whole contract is that it is total. The column is an integer today, so this
  // is a guard against the shape of the input, not against a live caller.
  const zeroBased = Math.floor(Math.max(Number(cursor) || 1, 1)) - 1;
  return list[zeroBased % list.length];
}

/**
 * Which provider an item came from.
 *
 * fetch() stamps `_provider` onto every item it returns, the way adzuna.js
 * stamps `_country` — toListing() is called without the request context, and
 * three providers' field names cannot be told apart by guessing alone. The
 * shape sniffing below is only a fallback for an item that reached here
 * unstamped; each of the three URL fields is unique to its provider.
 *
 * @param {object} raw
 * @returns {string|null}
 */
function providerOf(raw) {
  const stamped = str(raw._provider).toLowerCase();
  if (Object.prototype.hasOwnProperty.call(PROVIDERS, stamped)) return stamped;
  if (typeof raw.absolute_url === 'string') return 'greenhouse';
  if (typeof raw.hostedUrl === 'string') return 'lever';
  if (typeof raw.jobUrl === 'string') return 'ashby';
  return null;
}

/** @type {import('./index.js').JobAdapter} */
export const atsAdapter = {
  id: 'ats',

  /**
   * @returns {boolean} True only when ATS_BOARDS parses to at least one valid
   *   provider:board pair. There is no default board to fall back on, so an
   *   unset or entirely invalid value means the source is simply off.
   */
  enabled() {
    return configuredBoards().length > 0;
  },

  supportsPaging: true,

  /**
   * Fetch one board. Never throws.
   *
   * @param {object} [opts]
   * @param {number} [opts.page=1] 1-based cursor; selects the board.
   * @param {AbortSignal} [opts.signal] The run's budget signal.
   * @returns {Promise<{items: object[], hasMore: boolean, error: string|null}>}
   *   `query`, `location`, `country`, `remote` and `limit` are accepted and
   *   ignored: none of the three endpoints takes a filter of any kind.
   */
  async fetch(options) {
    // Destructure from a coerced object, not a defaulted parameter: a default
    // only fires on `undefined`, so `fetch(null)` would throw here and break
    // the never-throws contract the whole cascade rests on. See adzuna.js.
    const { page = 1, signal } = options || {};

    const boards = configuredBoards();
    const target = cursorToBoard(page, boards);
    if (!target) return emptyResult('disabled');

    const provider = PROVIDERS[target.provider];
    const url = provider.url(target.board);

    const res = await fetchJson(url, { signal, timeoutMs: PER_ADAPTER_TIMEOUT_MS });

    if (!res.ok) {
      // Board name and status, never the URL and never the body — a 200 with
      // an unparseable body would be posting text, and this line is the only
      // way to tell "board renamed" (404) from "provider down" (5xx).
      atsLog.warn('fetch failed', {
        reason: res.error,
        status: res.status,
        cursor: page,
        provider: target.provider,
        board: target.board,
      });
      return emptyResult(res.error);
    }

    const jobs = provider.items(res.data);
    if (!jobs) {
      atsLog.warn('unexpected payload shape', {
        reason: 'parse',
        provider: target.provider,
        board: target.board,
      });
      return emptyResult('parse');
    }

    // Stamp the provider and board onto each item so toListing() can resolve
    // field names and build a collision-proof source_id without being handed
    // the request context. Same trick as adzuna's `_country`.
    for (const item of jobs) {
      if (item && typeof item === 'object') {
        item._provider = target.provider;
        item._board = target.board;
      }
    }

    // `hasMore: false` makes ingest wrap the cursor back to 1. A board has no
    // second page, so "more" here means "boards left unvisited in this cycle" —
    // exactly adzuna's midCycle reasoning. Wrapping on the last slot restarts
    // the rotation, which is also the refresh: boards gain and lose postings.
    const cyclePosition = (Math.floor(Math.max(Number(page) || 1, 1)) - 1) % boards.length;
    const hasMore = cyclePosition < boards.length - 1;

    atsLog.debug('board fetched', {
      cursor: page,
      provider: target.provider,
      board: target.board,
      count: jobs.length,
      hasMore,
    });

    return { items: jobs, hasMore, error: null };
  },

  /**
   * A Greenhouse, Lever or Ashby item → the shared listing shape.
   *
   * @param {unknown} raw One element of the provider's job array.
   * @returns {object|null} A listing for normalizeListing(), or null to skip.
   */
  toListing(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

    const providerId = providerOf(raw);
    if (!providerId) return null;

    const board = str(raw._board);
    const mapped = PROVIDERS[providerId].listing(raw);

    const title = str(mapped.title);
    const url = str(mapped.url);
    // No title or no url means the row cannot be shown or clicked.
    if (!title || !url) return null;

    const location = mapped.location || '';
    const remote = typeof mapped.remote === 'boolean'
      ? mapped.remote
      : REMOTE_RE.test(`${title} ${location}`);

    return {
      source: 'ats',
      // provider AND board, because 'greenhouse:12345' and 'lever:12345' are
      // different jobs, and so are the same numeric id on two Greenhouse
      // boards. normalizeListing prefixes the source on top of this.
      source_id: [providerId, board, str(raw.id)].filter(Boolean).join(':'),
      title,
      url,
      // Greenhouse is the only one that names the employer; for the other two
      // the board slug IS the company.
      company: mapped.company || board || null,
      location: location || null,
      category: mapped.category || null,
      job_type: mapped.job_type || null,
      remote,
      description: mapped.description || '',
      // None of the three returns a tag list; departments/teams land in
      // `category` instead, where the matcher already looks for them.
      tags: [],
      // No salary data from any of the three. Inventing a range from body copy
      // would be a guess stored as a number.
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      // The reason this adapter exists. Every one of these is the complete
      // posting, not a 200-character teaser.
      description_quality: 'full',
      posted_at: mapped.posted_at || null,
    };
  },
};

export default atsAdapter;
