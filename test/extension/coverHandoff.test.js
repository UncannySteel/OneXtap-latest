/**
 * The cover-letter handoff (docs/extension-protocol.md, "The cover-letter
 * handoff"): the job-page button's OPEN_COVER_CUSTOMIZER and the dashboard's
 * GET_COVER_HANDOFF. Sanitising the job, the 30-minute expiry, the one-time
 * read and the sender checks, first through the registry with a hand-built
 * context, then through extension/background.js itself. Last, what can be
 * checked of the button's code in public/content.js without a browser (the
 * e2e, web/tests/cover-handoff.spec.js, drives it in one).
 */
import test, { before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as espree from 'espree';

import { MESSAGES, CAPABILITIES, dispatch } from '../../extension/messages/registry.js';
import { allowedOrigins } from '../../extension/messages/senders.js';
import {
  sanitiseJob, isExpired, HANDOFF_PREFIX, HANDOFF_TTL_MS, LIMITS,
} from '../../extension/messages/openCoverCustomizer.js';
import { canLoadViteModules } from './viteModules.js';
import { loadWorker, MANIFEST, EXTENSION_ID, SITE, POPUP, CONTENT } from './fakeWorker.js';
import { walk } from '../rules/scrapers.js';

const quiet = { error() {}, warn() {}, info() {}, debug() {} };
const DASHBOARD = 'https://www.onextap.com/dashboard/';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MINUTE = 60 * 1000;

/** The content script in a job tab, as Chrome reports it: the tab has a place. */
const JOB_TAB = Object.freeze({ ...CONTENT, tab: { id: 7, index: 3, windowId: 2, url: CONTENT.url } });

const JOB = Object.freeze({
  company: 'Norwick Labs',
  role: 'Senior Backend Engineer',
  description: 'Build payment systems that stay up. Python, PostgreSQL, Docker.',
  url: 'https://jobs.example.com/apply/42',
});

/** chrome.storage.session, chrome.tabs.create and the runtime, in memory. */
function fakeChrome() {
  const state = { session: {}, created: [], createError: null, reads: 0 };
  const session = {
    async get(keys) {
      state.reads += 1;
      const list = keys == null ? Object.keys(state.session) : [].concat(keys);
      return Object.fromEntries(list.filter((k) => k in state.session).map((k) => [k, structuredClone(state.session[k])]));
    },
    async set(items) {
      Object.assign(state.session, structuredClone(items));
    },
    async remove(keys) {
      for (const k of [].concat(keys)) delete state.session[k];
    },
  };
  const chrome = {
    runtime: { id: EXTENSION_ID, getManifest: () => structuredClone(MANIFEST) },
    storage: { session },
    tabs: {
      async create(options) {
        if (state.createError) throw state.createError;
        state.created.push(options);
        return { id: 99, ...options };
      },
    },
  };
  return { chrome, state };
}

function contextFor(chrome) {
  return {
    chrome,
    log: quiet,
    dashboardUrl: DASHBOARD,
    runtimeId: EXTENSION_ID,
    origins: allowedOrigins(MANIFEST),
  };
}

const handoffKeys = (state) => Object.keys(state.session).filter((k) => k.startsWith(HANDOFF_PREFIX));
const idFromTab = (options) => new URL(options.url).searchParams.get('handoff');

// ---------- Sanitising (pure) ----------

test('markup is stripped from every field, scripts and styles with their contents', () => {
  const job = sanitiseJob({
    company: '<b>Norwick</b> <script>alert(1)</script>Labs',
    role: 'Senior <img src=x onerror=alert(1)>Backend Engineer',
    description: '<style>p{color:red}</style><p>Build <em>payment</em> systems.</p><!-- tracking --><a href="javascript:alert(1)">Apply</a>',
    url: JOB.url,
  });
  assert.equal(job.company, 'Norwick Labs');
  assert.equal(job.role, 'Senior Backend Engineer');
  assert.equal(job.description, 'Build payment systems. Apply');
  for (const value of Object.values(job)) assert.doesNotMatch(value, /[<>]/);
});

test('a tag cut off at the end, and an unclosed comment, go too', () => {
  assert.equal(sanitiseJob({ description: 'Python, Docker. <img src=x onerror="alert(1)"' }).description, 'Python, Docker.');
  assert.equal(sanitiseJob({ description: 'Python. <!-- and the rest' }).description, 'Python.');
});

test('text that only looks like markup stays, and entities are not decoded into markup', () => {
  assert.equal(sanitiseJob({ description: 'Salary 100k < x < 150k, 5 > 3' }).description, 'Salary 100k < x < 150k, 5 > 3');
  assert.equal(sanitiseJob({ description: '&lt;script&gt;alert(1)&lt;/script&gt;' }).description, '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('each field is capped: company 120, role 160, description 20,000 characters', () => {
  assert.deepEqual(LIMITS, { company: 120, role: 160, description: 20000, url: 2048 });
  const job = sanitiseJob({ company: 'c'.repeat(500), role: 'r'.repeat(500), description: 'd'.repeat(30000) });
  assert.equal(job.company, 'c'.repeat(120));
  assert.equal(job.role, 'r'.repeat(160));
  assert.equal(job.description, 'd'.repeat(20000));
});

test('the cap counts what is left once the markup is gone', () => {
  const job = sanitiseJob({ company: `<span class="a-very-long-class-name">${'c'.repeat(100)}</span>` });
  assert.equal(job.company, 'c'.repeat(100));
});

test('the cap never splits a character in two', () => {
  const job = sanitiseJob({ company: `${'c'.repeat(119)}😀tail` });
  assert.equal(job.company, 'c'.repeat(119));
});

test('company and role are one line; the description keeps its paragraphs', () => {
  const job = sanitiseJob({
    company: '  Norwick\n\tLabs  ',
    role: 'Senior\r\n Backend   Engineer',
    description: '  About us\r\n\r\n\r\n\r\nWe   build\tthings.\n  Requirements \n',
  });
  assert.equal(job.company, 'Norwick Labs');
  assert.equal(job.role, 'Senior Backend Engineer');
  assert.equal(job.description, 'About us\n\nWe build things.\nRequirements');
});

test('control and bidirectional-override characters are removed', () => {
  const job = sanitiseJob({ company: 'Nor\u0000wick\u202E Labs\u0007', description: 'a\u200Fb\u2066c\u0085d' });
  assert.equal(job.company, 'Norwick Labs');
  assert.equal(job.description, 'abcd');
});

test('a field that is not a string is empty', () => {
  assert.deepEqual(sanitiseJob({ company: 42, role: { toString: () => '<b>x</b>' }, description: ['a'], url: null }),
    { company: '', role: '', description: '', url: '' });
  assert.deepEqual(sanitiseJob({}), { company: '', role: '', description: '', url: '' });
});

test('only an object is a job', () => {
  for (const job of [undefined, null, 'Norwick Labs', 42, ['a']]) assert.equal(sanitiseJob(job), null, String(job));
});

test('the url is kept only when it is http(s), without credentials', () => {
  assert.equal(sanitiseJob({ url: 'https://jobs.example.com/apply/42?ref=x#top' }).url, 'https://jobs.example.com/apply/42?ref=x#top');
  assert.equal(sanitiseJob({ url: 'http://localhost:5173/e2e-job/' }).url, 'http://localhost:5173/e2e-job/');
  assert.equal(sanitiseJob({ url: 'https://user:secret@jobs.example.com/a' }).url, 'https://jobs.example.com/a');
  for (const url of ['javascript:alert(1)', 'data:text/html,<b>x</b>', `chrome-extension://${EXTENSION_ID}/index.html`,
    'file:///C:/jobs.html', 'ftp://jobs.example.com/', '/apply/42', 'not a url', `https://jobs.example.com/${'a'.repeat(2048)}`]) {
    assert.equal(sanitiseJob({ url }).url, '', url);
  }
});

// ---------- Expiry (pure) ----------

test('an entry expires 30 minutes after it was made', () => {
  assert.equal(HANDOFF_TTL_MS, 30 * MINUTE);
  const now = Date.UTC(2026, 9, 17, 12);
  assert.equal(isExpired({ createdAt: now - 29 * MINUTE }, now), false);
  assert.equal(isExpired({ createdAt: now - 30 * MINUTE }, now), true);
  assert.equal(isExpired({ createdAt: now - 31 * MINUTE }, now), true);
  for (const entry of [undefined, null, {}, { createdAt: 'yesterday' }, { createdAt: NaN }]) {
    assert.equal(isExpired(entry, now), true, JSON.stringify(entry));
  }
});

// ---------- The registry ----------

test('OPEN_COVER_CUSTOMIZER is the content script\'s alone, GET_COVER_HANDOFF the site\'s', () => {
  const from = Object.fromEntries(MESSAGES.map((m) => [m.kind, [...m.from]]));
  assert.deepEqual(from.OPEN_COVER_CUSTOMIZER, ['content']);
  assert.deepEqual(from.GET_COVER_HANDOFF, ['site']);
  assert.ok(CAPABILITIES.includes('cover-handoff'));
});

// ---------- OPEN_COVER_CUSTOMIZER ----------

test('the content script hands a job over: kept in session storage, the dashboard opened next to its tab', async () => {
  const { chrome, state } = fakeChrome();
  const before = Date.now();
  const reply = await dispatch({ type: 'OPEN_COVER_CUSTOMIZER', job: JOB }, JOB_TAB, 'internal', contextFor(chrome));
  assert.deepEqual(reply, { success: true });

  const [key] = handoffKeys(state);
  assert.equal(handoffKeys(state).length, 1);
  const id = key.slice(HANDOFF_PREFIX.length);
  assert.match(id, UUID);
  assert.deepEqual(state.session[key].job, JOB);
  assert.ok(state.session[key].createdAt >= before && state.session[key].createdAt <= Date.now());

  assert.deepEqual(state.created, [{
    url: `${DASHBOARD}?view=cover&handoff=${id}&extensionId=${EXTENSION_ID}`,
    index: 4,
    windowId: 2,
    openerTabId: 7,
  }]);
});

test('what is kept is the sanitised job, not the page\'s', async () => {
  const { chrome, state } = fakeChrome();
  await dispatch({ action: 'OPEN_COVER_CUSTOMIZER', job: { company: '<i>Norwick</i>', role: 'r'.repeat(400), description: 'x', url: 'javascript:alert(1)' } },
    JOB_TAB, 'internal', contextFor(chrome));
  const [key] = handoffKeys(state);
  assert.deepEqual(state.session[key].job, { company: 'Norwick', role: 'r'.repeat(160), description: 'x', url: '' });
});

test('every handoff gets its own id', async () => {
  const { chrome, state } = fakeChrome();
  await dispatch({ type: 'OPEN_COVER_CUSTOMIZER', job: JOB }, JOB_TAB, 'internal', contextFor(chrome));
  await dispatch({ type: 'OPEN_COVER_CUSTOMIZER', job: JOB }, JOB_TAB, 'internal', contextFor(chrome));
  assert.equal(handoffKeys(state).length, 2);
  assert.notEqual(idFromTab(state.created[0]), idFromTab(state.created[1]));
});

test('a tab without a place still opens the dashboard, wherever Chrome puts it', async () => {
  const { chrome, state } = fakeChrome();
  assert.deepEqual(await dispatch({ type: 'OPEN_COVER_CUSTOMIZER', job: JOB }, CONTENT, 'internal', contextFor(chrome)), { success: true });
  assert.deepEqual(Object.keys(state.created[0]), ['url', 'openerTabId']);
});

test('no job, no handoff: nothing kept, nothing opened', async () => {
  const { chrome, state } = fakeChrome();
  for (const job of [undefined, 'Norwick Labs', ['x']]) {
    assert.deepEqual(await dispatch({ type: 'OPEN_COVER_CUSTOMIZER', job }, JOB_TAB, 'internal', contextFor(chrome)),
      { success: false, error: 'No job to hand over' });
  }
  assert.deepEqual(state.session, {});
  assert.deepEqual(state.created, []);
});

test('only from the top frame: content.js is never injected anywhere else', async () => {
  const { chrome, state } = fakeChrome();
  const reply = await dispatch({ type: 'OPEN_COVER_CUSTOMIZER', job: JOB }, { ...JOB_TAB, frameId: 3 }, 'internal', contextFor(chrome));
  assert.deepEqual(reply, { success: false, error: 'Only from the top frame' });
  assert.deepEqual(state.session, {});
  assert.deepEqual(state.created, []);
});

test('a dashboard that cannot be opened leaves nothing behind', async () => {
  const { chrome, state } = fakeChrome();
  state.createError = new Error('Tabs cannot be edited right now');
  const reply = await dispatch({ type: 'OPEN_COVER_CUSTOMIZER', job: JOB }, JOB_TAB, 'internal', contextFor(chrome));
  assert.deepEqual(reply, { success: false, error: 'Could not open the dashboard' });
  assert.deepEqual(state.session, {});
});

test('a new handoff sweeps the expired ones, and leaves the rest of session storage alone', async () => {
  const { chrome, state } = fakeChrome();
  const now = Date.now();
  state.session[`${HANDOFF_PREFIX}00000000-0000-4000-8000-000000000001`] = { job: JOB, createdAt: now - 45 * MINUTE };
  state.session[`${HANDOFF_PREFIX}00000000-0000-4000-8000-000000000002`] = { job: JOB, createdAt: now - 5 * MINUTE };
  state.session[`${HANDOFF_PREFIX}00000000-0000-4000-8000-000000000003`] = 'not an entry';
  state.session['sb-session'] = 'kept';
  await dispatch({ type: 'OPEN_COVER_CUSTOMIZER', job: JOB }, JOB_TAB, 'internal', contextFor(chrome));
  assert.equal(state.session['sb-session'], 'kept');
  assert.ok(`${HANDOFF_PREFIX}00000000-0000-4000-8000-000000000002` in state.session);
  assert.ok(!(`${HANDOFF_PREFIX}00000000-0000-4000-8000-000000000001` in state.session));
  assert.ok(!(`${HANDOFF_PREFIX}00000000-0000-4000-8000-000000000003` in state.session));
  assert.equal(handoffKeys(state).length, 2);
});

test('the site, the popup and an unknown page may not open a handoff', async () => {
  const { chrome, state } = fakeChrome();
  const evil = { url: 'https://evil.example/', origin: 'https://evil.example', tab: { id: 9 } };
  for (const [sender, channel] of [[SITE, 'external'], [POPUP, 'internal'], [evil, 'external'], [{ ...JOB_TAB, id: 'ponmlkjihgfedcbaponmlkjihgfedcba' }, 'internal']]) {
    assert.deepEqual(await dispatch({ type: 'OPEN_COVER_CUSTOMIZER', job: JOB }, sender, channel, contextFor(chrome)),
      { success: false, error: 'Not accepted from this sender: OPEN_COVER_CUSTOMIZER' });
  }
  assert.deepEqual(state.session, {});
  assert.deepEqual(state.created, []);
});

// ---------- GET_COVER_HANDOFF ----------

async function handedOver(chrome, state, job = JOB) {
  await dispatch({ type: 'OPEN_COVER_CUSTOMIZER', job }, JOB_TAB, 'internal', contextFor(chrome));
  return idFromTab(state.created.at(-1));
}

const GONE = { success: false, error: 'This job has expired or was already opened' };

test('the site reads the job once: the entry goes on the first read', async () => {
  const { chrome, state } = fakeChrome();
  const id = await handedOver(chrome, state);
  assert.deepEqual(await dispatch({ action: 'GET_COVER_HANDOFF', id }, SITE, 'external', contextFor(chrome)), { success: true, job: JOB });
  assert.deepEqual(handoffKeys(state), []);
  assert.deepEqual(await dispatch({ action: 'GET_COVER_HANDOFF', id }, SITE, 'external', contextFor(chrome)), GONE);
});

test('two reads at once: one gets the job, the other nothing', async () => {
  const { chrome, state } = fakeChrome();
  const id = await handedOver(chrome, state);
  const replies = await Promise.all([1, 2, 3].map(() => dispatch({ action: 'GET_COVER_HANDOFF', id }, SITE, 'external', contextFor(chrome))));
  assert.equal(replies.filter((r) => r.success).length, 1);
  assert.deepEqual(replies.filter((r) => !r.success), [GONE, GONE]);
});

test('an entry older than 30 minutes is refused, and deleted all the same', async () => {
  const { chrome, state } = fakeChrome();
  const id = '00000000-0000-4000-8000-0000000000aa';
  state.session[`${HANDOFF_PREFIX}${id}`] = { job: JOB, createdAt: Date.now() - 31 * MINUTE };
  assert.deepEqual(await dispatch({ action: 'GET_COVER_HANDOFF', id }, SITE, 'external', contextFor(chrome)), GONE);
  assert.deepEqual(state.session, {});
});

test('an entry 29 minutes old is still there', async () => {
  const { chrome, state } = fakeChrome();
  const id = '00000000-0000-4000-8000-0000000000bb';
  state.session[`${HANDOFF_PREFIX}${id}`] = { job: JOB, createdAt: Date.now() - 29 * MINUTE };
  assert.deepEqual(await dispatch({ action: 'GET_COVER_HANDOFF', id }, SITE, 'external', contextFor(chrome)), { success: true, job: JOB });
});

test('the id is read the way it was made, whatever its case', async () => {
  const { chrome, state } = fakeChrome();
  const id = await handedOver(chrome, state);
  assert.equal((await dispatch({ action: 'GET_COVER_HANDOFF', id: ` ${id.toUpperCase()} ` }, SITE, 'external', contextFor(chrome))).success, true);
});

test('an id that is not one is refused without reading storage', async () => {
  const { chrome, state } = fakeChrome();
  for (const id of [undefined, '', 42, 'sb-session', `${HANDOFF_PREFIX}x`, '../x', '00000000-0000-4000-8000-00000000000']) {
    assert.deepEqual(await dispatch({ action: 'GET_COVER_HANDOFF', id }, SITE, 'external', contextFor(chrome)), GONE, String(id));
  }
  assert.equal(state.reads, 0);
});

test('the content script and the popup may not read a handoff, and it stays for the site', async () => {
  const { chrome, state } = fakeChrome();
  const id = await handedOver(chrome, state);
  for (const sender of [JOB_TAB, POPUP]) {
    assert.deepEqual(await dispatch({ action: 'GET_COVER_HANDOFF', id }, sender, 'internal', contextFor(chrome)),
      { success: false, error: 'Not accepted from this sender: GET_COVER_HANDOFF' });
  }
  const evil = { url: 'https://evil.example/', origin: 'https://evil.example' };
  assert.deepEqual(await dispatch({ action: 'GET_COVER_HANDOFF', id }, evil, 'external', contextFor(chrome)),
    { success: false, error: 'Not accepted from this sender: GET_COVER_HANDOFF' });
  assert.equal(handoffKeys(state).length, 1);
  assert.equal((await dispatch({ action: 'GET_COVER_HANDOFF', id }, SITE, 'external', contextFor(chrome))).success, true);
});

// ---------- Through the worker ----------

const skip = canLoadViteModules ? false : 'needs module.registerHooks (Node 22.15+)';
let worker;
let fake;

before(async () => {
  if (skip) return;
  mock.method(console, 'error', () => {});
  mock.method(console, 'warn', () => {});
  worker = await loadWorker();
});
beforeEach(() => {
  if (skip) return;
  worker.reset();
  // The worker keeps the chrome object it was loaded with; give it the two
  // APIs the handoff uses, fresh for each test.
  fake = fakeChrome();
  globalThis.chrome.storage.session = fake.chrome.storage.session;
  globalThis.chrome.tabs.create = fake.chrome.tabs.create;
});

test('the worker opens its own dashboard, with its own id, and the site reads the job back once', { skip }, async () => {
  assert.deepEqual(await worker.internal({ type: 'OPEN_COVER_CUSTOMIZER', job: JOB }, JOB_TAB), { success: true });
  const [created] = fake.state.created;
  const url = new URL(created.url);
  // VITE_DASHBOARD_URL is the site; the dashboard is at /dashboard/ on it (src/config.js).
  assert.equal(`${url.origin}${url.pathname}`, DASHBOARD);
  assert.deepEqual([...url.searchParams.keys()], ['view', 'handoff', 'extensionId']);
  assert.equal(url.searchParams.get('view'), 'cover');
  assert.equal(url.searchParams.get('extensionId'), EXTENSION_ID);
  assert.deepEqual([created.index, created.windowId, created.openerTabId], [4, 2, 7]);

  const id = url.searchParams.get('handoff');
  assert.deepEqual(await worker.external({ type: 'GET_COVER_HANDOFF', id }, SITE), { success: true, job: JOB });
  assert.deepEqual(await worker.external({ type: 'GET_COVER_HANDOFF', id }, SITE), GONE);
});

test('the worker checks the senders too', { skip }, async () => {
  assert.deepEqual(await worker.external({ type: 'OPEN_COVER_CUSTOMIZER', job: JOB }, SITE),
    { success: false, error: 'Not accepted from this sender: OPEN_COVER_CUSTOMIZER' });
  assert.deepEqual(await worker.internal({ type: 'OPEN_COVER_CUSTOMIZER', job: JOB }, POPUP),
    { success: false, error: 'Not accepted from this sender: OPEN_COVER_CUSTOMIZER' });
  assert.deepEqual(fake.state.created, []);

  await worker.internal({ type: 'OPEN_COVER_CUSTOMIZER', job: JOB }, JOB_TAB);
  const id = idFromTab(fake.state.created[0]);
  assert.deepEqual(await worker.internal({ type: 'GET_COVER_HANDOFF', id }, CONTENT),
    { success: false, error: 'Not accepted from this sender: GET_COVER_HANDOFF' });
  assert.equal((await worker.external({ type: 'GET_COVER_HANDOFF', id }, SITE)).success, true);
});

test('ONEXTAP_HELLO says this build can hand a job over', { skip }, async () => {
  const reply = await worker.external({ type: 'ONEXTAP_HELLO' }, SITE);
  assert.ok(reply.capabilities.includes('cover-handoff'));
});

// ---------- The button, in public/content.js (read, not run) ----------

const CONTENT_SOURCE = readFileSync(new URL('../../public/content.js', import.meta.url), 'utf8');
const CONTENT_AST = espree.parse(CONTENT_SOURCE, { ecmaVersion: 'latest', sourceType: 'script', range: true });

/** Every call to `name(...)` inside the function declared as `inside`. */
function callsIn(inside, name) {
  let found = 0;
  walk(CONTENT_AST, (node) => {
    if (node.type !== 'FunctionDeclaration' || node.id?.name !== inside) return;
    walk(node.body, (n) => {
      if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === name) found += 1;
    });
  });
  return found;
}

test('content.js never writes page-derived text as HTML: no HTML sinks at all', () => {
  assert.doesNotMatch(CONTENT_SOURCE, /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write|createContextualFragment/);
});

test('the button lives in a closed shadow root, on a host appended to body', () => {
  assert.match(CONTENT_SOURCE, /attachShadow\(\{\s*mode:\s*'closed'\s*\}\)/);
  assert.doesNotMatch(CONTENT_SOURCE, /mode:\s*'open'/);
  assert.match(CONTENT_SOURCE, /document\.body\.append\(host\)/);
});

test('the button is a real <button type="button">, labelled, with an aria-label naming Onextap', () => {
  assert.match(CONTENT_SOURCE, /\.type = 'button'/);
  assert.match(CONTENT_SOURCE, /'Customize cover letter'/);
  assert.match(CONTENT_SOURCE, /setAttribute\('aria-label', '[^']*Onextap[^']*'\)/);
});

test('content.js sets no window property but its re-injection guard', () => {
  const written = new Set();
  walk(CONTENT_AST, (node) => {
    const target = node.type === 'AssignmentExpression' ? node.left : null;
    if (target?.type === 'MemberExpression' && target.object.type === 'Identifier' && ['window', 'globalThis', 'self'].includes(target.object.name)) {
      written.add(target.property.name ?? target.property.value);
    }
  });
  assert.deepEqual([...written], ['__onextapAutofillLoaded']);
});

test('the button\'s code adds no global: it is one block-scoped const, not a function declaration', () => {
  // A function declared in the guard's block becomes a property of the
  // isolated world's window in a classic script (Annex B), so the button's
  // functions live inside one closure.
  let declaredAt = null;
  walk(CONTENT_AST, (node, parent) => {
    if (node.type === 'VariableDeclarator' && node.id.name === 'coverButton') declaredAt = parent.kind;
    if (node.type === 'FunctionDeclaration' && /cover.?button/i.test(node.id?.name || '')) assert.fail(`function ${node.id.name} is a global`);
  });
  assert.equal(declaredAt, 'const');
});

test('the button finds its field the way FILL_COVER_LETTER does: the same function, without the guess', () => {
  assert.equal(callsIn('fillCoverLetter', 'findCoverLetterField'), 1);
  // Filling may fall back to the largest empty textarea; the button needs a
  // field the page calls a cover letter.
  assert.match(CONTENT_SOURCE, /const field = findCoverLetterField\(\{ guess: false \}\)/);
});

test('MOUNT_COVER_BUTTON and AUTOFILL_TRIGGERED both mount it', () => {
  assert.match(CONTENT_SOURCE, /'MOUNT_COVER_BUTTON'/);
  const autofillBranch = CONTENT_SOURCE.slice(CONTENT_SOURCE.indexOf("msg.action === 'AUTOFILL_TRIGGERED'"));
  assert.match(autofillBranch.slice(0, autofillBranch.indexOf('return false;')), /coverButton\.mount\(\)/);
});

/** The FunctionDeclaration `name` in content.js. */
function declared(name) {
  let found = null;
  walk(CONTENT_AST, (node) => {
    if (node.type === 'FunctionDeclaration' && node.id?.name === name) found = node;
  });
  assert.ok(found, `content.js declares no ${name}()`);
  return found;
}

/** The names `x` that `x.method()` (or `x?.method()`) is called on inside `fn`. */
function calledOn(fn, method) {
  const on = [];
  walk(fn.body, (n) => {
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.property.name === method
      && n.callee.object.type === 'Identifier') on.push(n.callee.object.name);
  });
  return on.sort();
}

test('a field in the top layer (a modal dialog, an open popover) hides the button: the host in <body> would draw under it', () => {
  const source = CONTENT_SOURCE.slice(...declared('inTopLayer').range);
  for (const selector of ['dialog:modal', ':popover-open']) assert.ok(source.includes(`'${selector}'`), selector);
  // Each selector tried on its own, so a browser without one still checks the others.
  assert.match(source, /\.some\(\(selector\) => \{\s*try \{\s*return !!field\.closest\(selector\);/);
  assert.equal(callsIn('place', 'inTopLayer'), 1);
  assert.match(CONTENT_SOURCE.slice(...declared('place').range), /if \(!shown\(field\) \|\| inTopLayer\(field\)\) \{\s*host\.style\.setProperty\('display', 'none', 'important'\);/);
});

test('a change to the field\'s own attributes moves or hides the button, and unmounting stops listening', () => {
  const build = CONTENT_SOURCE.slice(...declared('build').range);
  assert.match(build, /state\.mutations = new MutationObserver\(schedule\)/);
  assert.match(build, /state\.mutations\.observe\(field, \{ attributes: true, attributeFilter: \['disabled', 'readonly', 'hidden', 'style', 'class'\] \}\)/);
  const unmount = declared('unmount');
  assert.deepEqual(calledOn(unmount, 'disconnect'), ['mutations', 'observer']);
  assert.deepEqual(calledOn(unmount, 'removeEventListener'), ['window', 'window']);
  assert.match(CONTENT_SOURCE.slice(...unmount.range), /const \{ host, observer, mutations, frame \} = mounted;/);
});

test('the button stays off the Onextap site, read from the manifest, and off every frame but the top', () => {
  assert.match(CONTENT_SOURCE, /chrome\.runtime\.getManifest\(\)\.externally_connectable/);
  assert.match(CONTENT_SOURCE, /window\.top !== window/);
});

test('the click sends OPEN_COVER_CUSTOMIZER with what scrapePageContext() read', () => {
  assert.match(CONTENT_SOURCE, /scrapePageContext\(\)/);
  assert.match(CONTENT_SOURCE, /type: 'OPEN_COVER_CUSTOMIZER'/);
});
