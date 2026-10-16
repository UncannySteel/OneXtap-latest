/**
 * The four messages store 1.0.2 answers, answered the same way by this build
 * (completion plan §0.3 and §2). Today's production website still sends
 * ONEXTAP_SYNC_DATA, PARSE_RESUME and SCRAPE_ACTIVE_TAB, and the store build
 * can ship before the website deploys, so these replies are a contract.
 *
 * Driven through extension/background.js itself (the listeners it registers),
 * each message from the sender that really sends it: the site over
 * onMessageExternal, the popup over onMessage. Written against the worker
 * before it moved to extension/messages/, and kept green after.
 */
import test, { before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { canLoadViteModules } from './viteModules.js';
import { loadWorker, json, API, SITE, POPUP } from './fakeWorker.js';

const skip = canLoadViteModules ? false : 'needs module.registerHooks (Node 22.15+)';
let worker;

before(async () => {
  if (skip) return;
  // Error paths below log through the worker's logger; the assertions are
  // on the replies.
  mock.method(console, 'error', () => {});
  worker = await loadWorker();
});
beforeEach(() => worker?.reset());

// ---------- ONEXTAP_SYNC_DATA ----------

test('ONEXTAP_SYNC_DATA from the site: success, and the profile filed where the popup reads it', { skip }, async () => {
  const reply = await worker.external({ type: 'ONEXTAP_SYNC_DATA', payload: { firstName: 'Ada', email: 'ada@example.com' } }, SITE);
  assert.deepEqual(reply, { success: true });
  const { onextap_profiles: store, user_profile: mirror } = worker.state.store;
  assert.equal(store.activeProfileId, 'default');
  assert.equal(store.profiles.default.autofillData.firstName, 'Ada');
  assert.equal(mirror.firstName, 'Ada');
});

test('ONEXTAP_SYNC_DATA: the kind may be sent as `action` too', { skip }, async () => {
  const reply = await worker.external({ action: 'ONEXTAP_SYNC_DATA', payload: { firstName: 'Ada' } }, SITE);
  assert.deepEqual(reply, { success: true });
  assert.equal(worker.state.store.user_profile.firstName, 'Ada');
});

test('ONEXTAP_SYNC_DATA without a profile object is refused, and nothing is written', { skip }, async () => {
  for (const payload of [undefined, null, 'Ada', ['Ada']]) {
    const reply = await worker.external({ type: 'ONEXTAP_SYNC_DATA', payload }, SITE);
    assert.deepEqual(reply, { success: false, error: 'No profile payload' });
  }
  assert.deepEqual(worker.state.store, {});
});

// ---------- PARSE_RESUME ----------

// As main's src/resumeParse.js sends it.
const parseMessage = () => ({
  action: 'PARSE_RESUME',
  data: { fileData: 'JVBERi0x', fileName: 'cv.pdf', fileType: 'application/pdf', isImage: false, isPDF: true, token: 'jwt-1' },
});

test('PARSE_RESUME from the site: proxied to /api/parse-resume with the caller\'s token', { skip }, async () => {
  worker.state.respond = () => json({ data: { firstName: 'Ada' }, text: 'Ada Lovelace, engineer' });
  const reply = await worker.external(parseMessage(), SITE);

  assert.equal(reply.success, true);
  assert.deepEqual(reply.data, { firstName: 'Ada' });
  assert.equal(reply.text, 'Ada Lovelace, engineer');

  assert.equal(worker.state.fetches.length, 1);
  const [{ url, init }] = worker.state.fetches;
  assert.equal(url, `${API}/api/parse-resume`);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer jwt-1');
  assert.deepEqual(JSON.parse(init.body), { fileData: 'JVBERi0x', fileName: 'cv.pdf', fileType: 'application/pdf' });
});

test('PARSE_RESUME: a server without `text` still succeeds, with text undefined', { skip }, async () => {
  worker.state.respond = () => json({ data: { firstName: 'Ada' } });
  const reply = await worker.external(parseMessage(), SITE);
  assert.equal(reply.success, true);
  assert.deepEqual(reply.data, { firstName: 'Ada' });
  assert.equal(reply.text, undefined);
});

test('PARSE_RESUME: a refusal carries the server\'s error, or the status, with debug.status', { skip }, async () => {
  worker.state.respond = () => json({ error: 'Could not read that file.' }, 422);
  assert.deepEqual(await worker.external(parseMessage(), SITE),
    { success: false, error: 'Could not read that file.', debug: { status: 422 } });

  worker.state.respond = () => json({}, 500);
  assert.deepEqual(await worker.external(parseMessage(), SITE),
    { success: false, error: 'Resume parse failed (500)', debug: { status: 500 } });

  // 200 without `data` is a failure too.
  worker.state.respond = () => json({ text: 'only text' });
  assert.deepEqual(await worker.external(parseMessage(), SITE),
    { success: false, error: 'Resume parse failed (200)', debug: { status: 200 } });
});

test('PARSE_RESUME: a network failure is the error\'s message', { skip }, async () => {
  worker.state.respond = () => { throw new TypeError('fetch failed'); };
  assert.deepEqual(await worker.external(parseMessage(), SITE), { success: false, error: 'fetch failed' });
});

// ---------- SCRAPE_ACTIVE_TAB ----------

for (const [label, channel, sender] of [['the site', 'external', SITE], ['the popup', 'internal', POPUP]]) {
  test(`SCRAPE_ACTIVE_TAB from ${label}: scrapeJobPage() runs in the active tab`, { skip }, async () => {
    const reply = await worker[channel]({ action: 'SCRAPE_ACTIVE_TAB' }, sender);
    assert.deepEqual(reply, { success: true, context: { company: 'Acme', description: 'Build payment systems.' } });
    assert.equal(worker.state.scripts.length, 1);
    assert.deepEqual(worker.state.scripts[0].target, { tabId: 7 });
    assert.equal(worker.state.scripts[0].func.name, 'scrapeJobPage');
  });
}

test('SCRAPE_ACTIVE_TAB: missing fields come back as empty strings', { skip }, async () => {
  worker.state.scriptResult = [{ result: null }];
  assert.deepEqual(await worker.external({ action: 'SCRAPE_ACTIVE_TAB' }, SITE),
    { success: true, context: { company: '', description: '' } });
  worker.state.scriptResult = [];
  assert.deepEqual(await worker.external({ action: 'SCRAPE_ACTIVE_TAB' }, SITE),
    { success: true, context: { company: '', description: '' } });
});

test('SCRAPE_ACTIVE_TAB: no tab, or a page Chrome will not script, is "Cannot read this page"', { skip }, async () => {
  const urls = [null, 'chrome://extensions/', `chrome-extension://${POPUP.id}/index.html`, 'edge://settings', 'about:blank',
    'https://chrome.google.com/webstore/detail/x'];
  for (const url of urls) {
    worker.state.tabs = url === null ? [] : [{ id: 7, url }];
    assert.deepEqual(await worker.external({ action: 'SCRAPE_ACTIVE_TAB' }, SITE),
      { success: false, error: 'Cannot read this page' }, String(url));
  }
  assert.equal(worker.state.scripts.length, 0);
});

test('SCRAPE_ACTIVE_TAB: an injection failure is the error\'s message', { skip }, async () => {
  worker.state.scriptResult = new Error('Cannot access contents of the page');
  assert.deepEqual(await worker.external({ action: 'SCRAPE_ACTIVE_TAB' }, SITE),
    { success: false, error: 'Cannot access contents of the page' });
});

// ---------- GENERATE_IMPROVED_ANSWER ----------

const generateMessage = () => ({
  type: 'GENERATE_IMPROVED_ANSWER',
  data: { token: 'jwt-2', question: 'Why us?', draft: 'Because.' },
});

test('GENERATE_IMPROVED_ANSWER from the popup: proxied to /api/answer-vault/generate, token as the header only', { skip }, async () => {
  worker.state.respond = () => json({ text: 'A better answer.' });
  assert.deepEqual(await worker.internal(generateMessage(), POPUP), { success: true, text: 'A better answer.' });

  const [{ url, init }] = worker.state.fetches;
  assert.equal(url, `${API}/api/answer-vault/generate`);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer jwt-2');
  assert.deepEqual(JSON.parse(init.body), { question: 'Why us?', draft: 'Because.' });
});

test('GENERATE_IMPROVED_ANSWER: `answer` stands in for `text`, else an empty string', { skip }, async () => {
  worker.state.respond = () => json({ answer: 'From answer.' });
  assert.deepEqual(await worker.internal(generateMessage(), POPUP), { success: true, text: 'From answer.' });
  worker.state.respond = () => json({});
  assert.deepEqual(await worker.internal(generateMessage(), POPUP), { success: true, text: '' });
});

test('GENERATE_IMPROVED_ANSWER: a refusal carries the server\'s error, or the status', { skip }, async () => {
  worker.state.respond = () => json({ error: 'No credits remaining' }, 402);
  assert.deepEqual(await worker.internal(generateMessage(), POPUP), { success: false, error: 'No credits remaining' });
  worker.state.respond = () => json({}, 500);
  assert.deepEqual(await worker.internal(generateMessage(), POPUP), { success: false, error: 'Generation failed (500)' });
  worker.state.respond = () => { throw new TypeError('fetch failed'); };
  assert.deepEqual(await worker.internal(generateMessage(), POPUP), { success: false, error: 'fetch failed' });
});

// ---------- Anything else ----------

test('an unknown kind is refused in 1.0.2\'s words, which the website reads as "legacy"', { skip }, async () => {
  assert.deepEqual(await worker.external({ type: 'NOT_A_MESSAGE' }, SITE),
    { success: false, error: 'Unknown action: NOT_A_MESSAGE' });
  assert.deepEqual(await worker.internal({ action: 'NOT_A_MESSAGE' }, POPUP),
    { success: false, error: 'Unknown action: NOT_A_MESSAGE' });
  assert.deepEqual(await worker.external({}, SITE), { success: false, error: 'Unknown action: undefined' });
});
