// End-to-end checks with the extension loaded unpacked: the dashboard's
// profile sync into it (ONEXTAP_SYNC_DATA), autofill from the popup, the
// popup's read-only Cover tab and the dashboard it sends you to for the rest,
// and deleting the account, which clears the extension (ONEXTAP_WIPE_LOCAL).
// playwright.extension.config.js runs this file
// (`npm run test:e2e:extension`), after tests/extension-build.js has built the
// extension with unresolvable addresses. The account and the API are stubbed
// on the whole browser context, so the same stubs answer the website and the
// extension's pages. Nothing here reaches a real project or a real model.
/* global chrome -- the evaluate() callbacks run in the extension's popup and worker */
import { test as base, expect, chromium } from '@playwright/test';
import { EXTENSION_DIR, EXTENSION_ENV } from './extension-build.js';
import { stubAuth, stubApi, stubDashboard, sessionFor } from './stubs.js';
import { supabaseStorageKey } from '../../src/supabaseSessionKey.js';

const SITE = 'http://localhost:5173';

const test = base.extend({
  // An extension loads only into a persistent context; '' is a fresh
  // profile folder, removed when the context closes. It needs Playwright's
  // full Chromium (`npx playwright install chromium`), not the headless shell
  // the other suites use. E2E_CHROMIUM_PATH points at another chrome.exe: on
  // one Windows machine the installed one failed to start ("side-by-side
  // configuration is incorrect") and a copy of its folder elsewhere ran.
  // eslint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this destructure
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      executablePath: process.env.E2E_CHROMIUM_PATH || undefined,
      viewport: { width: 1280, height: 900 },
      args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`]
    });
    await use(context);
    await context.close();
  },
  page: async ({ context }, use) => {
    await use(context.pages()[0] || await context.newPage());
  },
  serviceWorker: async ({ context }, use) => {
    const [running] = context.serviceWorkers();
    await use(running || await context.waitForEvent('serviceworker'));
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  }
});

// Signed in on the website, through its sign-in window (see dashboard.spec.js).
async function signIn(page) {
  await page.goto(`${SITE}/contact/`);
  await page.click('.hud [data-login]');
  await page.fill('#loginEmail', 'reader@example.com');
  await page.fill('#loginPassword', 'hunter22');
  await page.click('#loginSubmit');
  await expect(page.locator('#loginDoneText')).toHaveText('Signed in as reader@example.com.');
}

// The extension's storage, read in its service worker.
const extensionStorage = (serviceWorker, keys) =>
  serviceWorker.evaluate((k) => chrome.storage.local.get(k), keys);

const activeProfile = (store) => store.onextap_profiles.profiles[store.onextap_profiles.activeProfileId];

// A job application form, served from the site's origin, which the extension
// may script (host_permissions).
const FORM_URL = `${SITE}/e2e-apply/`;
const FORM = `<!doctype html><title>Apply</title>
  <form>
    <label for="fn">First name</label><input id="fn" name="first_name">
    <label for="ln">Last name</label><input id="ln" name="last_name">
    <label for="em">Email</label><input id="em" name="email" type="email">
    <label for="cl">Cover letter</label><textarea id="cl" name="cover_letter"></textarea>
  </form>`;

// A template with two versions saved from it on the dashboard, the older first.
const LETTERS = [{
  id: 'cl-1',
  name: 'Formal',
  body: 'Dear team, I build payment systems that stay up.',
  createdAt: '2026-09-01T00:00:00.000Z',
  variants: [
    { id: 'clv-1', company: 'Norwick Labs', role: 'Backend Engineer', jdSnippet: '', body: 'Dear Norwick Labs team, the older letter.', createdAt: '2026-09-02T00:00:00.000Z' },
    { id: 'clv-2', company: 'Kestrel Analytics', role: 'Platform Engineer', jdSnippet: '', body: 'Dear Kestrel Analytics team, the newer letter.', createdAt: '2026-09-03T00:00:00.000Z' }
  ]
}];

test.describe('the extension, loaded', () => {
  test('dashboard saves reach the popup, even after it made its own store, and autofill uses them', async ({ context, page, serviceWorker, extensionId }) => {
    await stubAuth(context);
    await stubApi(context);
    await context.route(FORM_URL, (route) => route.fulfill({ contentType: 'text/html', body: FORM }));
    await signIn(page);

    // The dashboard as the popup opens it: with the extension's ID.
    await page.goto(`${SITE}/dashboard/?extensionId=${extensionId}&view=profiles`);
    const status = page.locator('.savebar-status');
    await page.getByLabel('First name').fill('Ada');
    await page.getByLabel('Last name').fill('Lovelace');
    await page.getByLabel('Email', { exact: true }).fill('ada@example.com');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(status).toHaveText('Saved and synced to the extension');

    let stored = await extensionStorage(serviceWorker, ['onextap_profiles', 'user_profile']);
    expect(activeProfile(stored).autofillData).toMatchObject({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' });
    expect(stored.user_profile).toMatchObject({ firstName: 'Ada', email: 'ada@example.com' });

    // The popup opens, and finds a profile.
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/index.html`);
    await expect(popup.getByRole('button', { name: 'Dashboard' })).toBeVisible();

    // An edit after that: before checkpoint 2's fix the worker wrote only
    // user_profile, which the popup no longer reads once its store exists.
    await page.getByLabel('First name').fill('Augusta');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(status).toHaveText('Saved and synced to the extension');
    stored = await extensionStorage(serviceWorker, ['onextap_profiles']);
    expect(Object.keys(stored.onextap_profiles.profiles)).toHaveLength(1);
    expect(activeProfile(stored).autofillData.firstName).toBe('Augusta');

    // Autofill, from the popup, into the page in front: the edit is what fills.
    await popup.reload();
    const form = await context.newPage();
    await form.goto(FORM_URL);
    await form.bringToFront();
    await popup.getByRole('button', { name: 'Autofill Application' }).click();
    await expect(form.locator('#fn')).toHaveValue('Augusta');
    await expect(form.locator('#ln')).toHaveValue('Lovelace');
    await expect(form.locator('#em')).toHaveValue('ada@example.com');
  });

  // The popup's Cover tab only reads (completion plan D6): templates and their
  // saved versions as the dashboard synced them, Open and Fill. Writing,
  // personalising and credits are the dashboard's; even a session left in the
  // extension's storage (the popup has no sign-in, D5) brings none of it back.
  test('the popup\'s Cover tab is read-only: templates, saved versions newest first, Open, Copy and Fill', async ({ context, page, serviceWorker, extensionId }) => {
    await stubAuth(context);
    const api = await stubApi(context, { credits: 1 });
    await stubDashboard(context);
    await context.route(FORM_URL, (route) => route.fulfill({ contentType: 'text/html', body: FORM }));
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/index.html`);

    // A profile with a template and two saved versions, filed by the worker's
    // own sync handler, as the dashboard sends it: from a page on the site.
    // First, the popup's first-run setup has to finish: it writes an empty
    // store from what it read before, which would undo a profile filed
    // meanwhile.
    await expect(popup.getByRole('button', { name: 'Open Dashboard' })).toBeVisible();
    await page.goto(`${SITE}/contact/`);
    const synced = await page.evaluate(([id, payload]) => new Promise((resolve) =>
      chrome.runtime.sendMessage(id, { type: 'ONEXTAP_SYNC_DATA', payload }, resolve)),
    [extensionId, { firstName: 'Ada', email: 'ada@example.com', coverLetters: LETTERS }]);
    expect(synced).toEqual({ success: true });
    await serviceWorker.evaluate(([key, session]) => chrome.storage.local.set({ [key]: JSON.stringify(session) }),
      [supabaseStorageKey(EXTENSION_ENV.VITE_SUPABASE_URL), sessionFor('reader@example.com')]);
    await popup.reload();
    await popup.getByRole('button', { name: 'Cover Letter' }).click();

    // The template, read-only.
    await expect(popup.getByText('Formal', { exact: true })).toBeVisible();
    await expect(popup.getByText('2 saved versions')).toBeVisible();

    // The saved versions, newest first, each with Open and Fill.
    const rows = popup.locator('p:text-is("Saved versions") + div > div');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Kestrel Analytics · Platform Engineer');
    await expect(rows.nth(1)).toContainText('Norwick Labs · Backend Engineer');
    await expect(popup.getByRole('button', { name: 'Open', exact: true })).toHaveCount(2);
    await expect(popup.getByRole('button', { name: 'Fill', exact: true })).toHaveCount(2);

    // Nothing to write with: no upload, add, edit or delete, no AI.
    for (const name of ['Upload file', 'Paste manually', 'Add template', 'Delete', 'Save version', 'Retry', /^Personalize/]) {
      await expect(popup.getByRole('button', { name })).toHaveCount(0);
    }
    await expect(popup.getByText('Upload file')).toHaveCount(0);
    await expect(popup.getByRole('textbox')).toHaveCount(0);
    await expect(popup.getByText(/credit/i)).toHaveCount(0);

    // Open: the whole text, read-only, with Copy and Fill.
    await rows.nth(1).getByRole('button', { name: 'Open', exact: true }).click();
    const text = popup.getByRole('textbox', { name: 'Saved version' });
    await expect(text).toHaveValue('Dear Norwick Labs team, the older letter.');
    await expect(text).not.toBeEditable();
    await expect(popup.getByRole('button', { name: 'Copy' })).toBeVisible();
    const form = await context.newPage();
    await form.goto(FORM_URL);
    await form.bringToFront();
    await popup.getByRole('button', { name: 'Fill', exact: true }).click();
    await expect(form.locator('#cl')).toHaveValue('Dear Norwick Labs team, the older letter.');
    await popup.getByRole('button', { name: 'All saved versions' }).click();
    await expect(rows).toHaveCount(2);

    // The rest is on the dashboard: its Cover Letter workspace, told which
    // extension to sync back to.
    const [dashboard] = await Promise.all([
      context.waitForEvent('page'),
      popup.getByRole('button', { name: 'Manage templates on the dashboard' }).click()
    ]);
    await dashboard.waitForLoadState();
    const opened = new URL(dashboard.url());
    expect(opened.pathname).toBe('/dashboard/');
    expect(opened.searchParams.get('view')).toBe('cover');
    expect(opened.searchParams.get('extensionId')).toBe(extensionId);

    // And nothing asked the API for a balance, a charge or a generation.
    expect(api.calls.filter((c) => /^\/api\/(credits|answer-vault|me|verify-premium)/.test(c.path))).toEqual([]);
  });

  test('signed out, the popup sends cover letters to the dashboard, and versions saved there come back to fill', async ({ context, page, serviceWorker, extensionId }) => {
    await stubAuth(context);
    const api = await stubApi(context, { credits: 2 });
    await context.route(FORM_URL, (route) => route.fulfill({ contentType: 'text/html', body: FORM }));
    await signIn(page);

    // A profile from the dashboard, so the popup has its tabs.
    await page.goto(`${SITE}/dashboard/?extensionId=${extensionId}&view=profiles`);
    await page.getByLabel('First name').fill('Ada');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('.savebar-status')).toHaveText('Saved and synced to the extension');

    // Signed in on the website, the popup is still signed out: no AI in it.
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/index.html`);
    await popup.getByRole('button', { name: 'Cover Letter' }).click();
    await expect(popup.getByText('No cover letter templates yet. Add one on the dashboard.')).toBeVisible();
    await expect(popup.getByText('Templates are edited, and letters personalised, on the dashboard. Versions you save there appear here, ready to fill.')).toBeVisible();
    await expect(popup.getByRole('button', { name: /^Personalize/ })).toHaveCount(0);

    // Its button opens the dashboard's Cover Letter workspace, with the
    // extension's ID, so what is saved there syncs back.
    const [dashboard] = await Promise.all([
      context.waitForEvent('page'),
      popup.getByRole('button', { name: 'Manage templates on the dashboard' }).click()
    ]);
    await dashboard.waitForURL(/\/dashboard\/.*#\/cover-letter$/);
    expect(new URL(dashboard.url()).searchParams.get('extensionId')).toBe(extensionId);

    await dashboard.getByRole('button', { name: 'Add a template' }).click();
    await dashboard.getByPlaceholder('Template name (e.g. Formal)').fill('Formal');
    await dashboard.getByRole('button', { name: 'Create', exact: true }).click();
    await dashboard.getByPlaceholder('Paste your base cover letter…').fill('Dear team, I build payment systems that stay up.');
    await dashboard.getByPlaceholder('Company or organisation').fill('Norwick Labs');
    await dashboard.getByPlaceholder('Paste the job description — the letter is rewritten around what it asks for.')
      .fill('Senior Backend Engineer at Norwick Labs. Requirements: Python, PostgreSQL, Docker.');
    await dashboard.getByRole('button', { name: 'Personalise for this job' }).click();
    await expect(dashboard.getByRole('textbox', { name: 'Personalised version' })).toHaveValue('Dear Norwick Labs team, letter number 1.');
    expect(api.state.credits).toBe(1);
    await dashboard.getByRole('button', { name: 'Save version' }).click();
    await expect.poll(async () => {
      const stored = await extensionStorage(serviceWorker, ['onextap_profiles']);
      return activeProfile(stored).coverLetters?.[0]?.variants?.length || 0;
    }).toBe(1);

    // Back in the popup: the version, ready to fill the page in front.
    await popup.reload();
    await popup.getByRole('button', { name: 'Cover Letter' }).click();
    await expect(popup.getByText('Saved versions')).toBeVisible();
    await expect(popup.getByText('Norwick Labs', { exact: true })).toBeVisible();
    const form = await context.newPage();
    await form.goto(FORM_URL);
    await form.bringToFront();
    await popup.getByRole('button', { name: 'Fill', exact: true }).click();
    await expect(form.locator('#cl')).toHaveValue('Dear Norwick Labs team, letter number 1.');
  });

  // Deleting the account clears the extension too (completion plan D10), once
  // DELETE /api/account has succeeded: ONEXTAP_WIPE_LOCAL, which this build
  // reports as `wipe-local`. Store 1.0.2 can't, and the dialog says so there.
  test('deleting the account clears the extension: every key Onextap keeps there, and nothing else', async ({ context, page, serviceWorker, extensionId }) => {
    await stubAuth(context);
    const api = await stubApi(context);
    await signIn(page);

    // A profile synced from the dashboard, and the rest of what the extension
    // can hold: resumes, a setting, a session, and the tour flag store 1.0.2
    // left behind. And one key that isn't ours.
    await page.goto(`${SITE}/dashboard/?extensionId=${extensionId}&view=profiles`);
    await page.getByLabel('First name').fill('Ada');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('.savebar-status')).toHaveText('Saved and synced to the extension');
    await serviceWorker.evaluate((items) => chrome.storage.local.set(items), {
      onextap_resumes: { resumes: {}, activeResumeId: null },
      onextap_application_type: 'job',
      onextap_tutorial_seen: true,
      [supabaseStorageKey(EXTENSION_ENV.VITE_SUPABASE_URL)]: JSON.stringify(sessionFor('reader@example.com')),
      not_onextaps: 'stays'
    });
    expect(Object.keys(await extensionStorage(serviceWorker, null)).sort()).toEqual([
      'not_onextaps', 'onextap_application_type', 'onextap_profiles', 'onextap_resumes', 'onextap_tutorial_seen',
      'sb-e2e-auth-token', 'user_profile'
    ]);

    // The dialog says what happens to this extension's copy: it goes too.
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('menuitem', { name: 'Delete account' }).click();
    const dialog = page.locator('#delete-dialog');
    await expect(dialog.getByText('The Onextap extension in this browser is cleared too.')).toBeVisible();
    await expect(dialog.locator('[data-extension-copy]:visible')).toHaveCount(1);
    await dialog.getByRole('textbox').fill('DELETE');
    await dialog.getByRole('button', { name: 'Delete account' }).click();

    // The account first, then the extension, then home (through the sign-out
    // handler, main.js's onSignedOut). Polled rather than awaited as one
    // navigation, so it holds however the page gets there.
    await expect(page).toHaveURL(`${SITE}/`);
    expect(api.calls.filter((c) => c.method === 'DELETE' && c.path === '/api/account')).toHaveLength(1);
    expect(await extensionStorage(serviceWorker, null)).toEqual({ not_onextaps: 'stays' });

    // The popup is back to its welcome.
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/index.html`);
    await expect(popup.getByRole('button', { name: 'Open Dashboard' })).toBeVisible();
  });

  test('a deletion the server refuses leaves the extension alone', async ({ context, page, serviceWorker, extensionId }) => {
    await stubAuth(context);
    await stubApi(context, { deleteAccount: 'fail' });
    await signIn(page);
    await page.goto(`${SITE}/dashboard/?extensionId=${extensionId}&view=profiles`);
    await page.getByLabel('First name').fill('Ada');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('.savebar-status')).toHaveText('Saved and synced to the extension');

    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('menuitem', { name: 'Delete account' }).click();
    const dialog = page.locator('#delete-dialog');
    await dialog.getByRole('textbox').fill('DELETE');
    await dialog.getByRole('button', { name: 'Delete account' }).click();

    await expect(page.getByText('Could not delete your account. Try again in a moment, or contact us.')).toBeVisible();
    const stored = await extensionStorage(serviceWorker, ['onextap_profiles', 'user_profile']);
    expect(activeProfile(stored).autofillData.firstName).toBe('Ada');
    expect(stored.user_profile.firstName).toBe('Ada');
  });

  test('a wipe the extension does not confirm is told to the user, and the deletion still completes', async ({ context, page, serviceWorker, extensionId }) => {
    await stubAuth(context);
    const api = await stubApi(context);
    await signIn(page);
    await page.goto(`${SITE}/dashboard/?extensionId=${extensionId}&view=profiles`);
    await page.getByLabel('First name').fill('Ada');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('.savebar-status')).toHaveText('Saved and synced to the extension');

    // The extension answers the wipe with a failure (its storage refused it,
    // say), stood in for on the page's end of the channel; everything else,
    // the handshake included, still reaches the real extension.
    const patched = await page.evaluate(() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      const failWipe = (...args) => {
        const msg = typeof args[0] === 'string' ? args[1] : args[0];
        const callback = args.find((a) => typeof a === 'function');
        if ((msg?.type || msg?.action) === 'ONEXTAP_WIPE_LOCAL') return callback({ success: false, error: 'storage refused' });
        return send(...args);
      };
      Object.defineProperty(chrome.runtime, 'sendMessage', { value: failWipe, configurable: true, writable: true });
      return chrome.runtime.sendMessage === failWipe;
    });
    expect(patched).toBe(true);

    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('menuitem', { name: 'Delete account' }).click();
    const dialog = page.locator('#delete-dialog');
    await expect(dialog.getByText('The Onextap extension in this browser is cleared too.')).toBeVisible();
    await dialog.getByRole('textbox').fill('DELETE');
    await dialog.getByRole('button', { name: 'Delete account' }).click();

    // Said in words while the page is still here; then home, once the toast
    // has had its time.
    await expect(page.getByText('Your account is deleted, but the Onextap extension couldn’t clear its copy. Remove the extension to clear it.')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/dashboard/');
    expect(api.calls.filter((c) => c.method === 'DELETE' && c.path === '/api/account')).toHaveLength(1);
    await page.waitForURL(`${SITE}/`, { timeout: 15000 });

    // The copy is still there, as the user was told.
    const stored = await extensionStorage(serviceWorker, ['onextap_profiles', 'user_profile']);
    expect(stored.user_profile.firstName).toBe('Ada');
  });
});
