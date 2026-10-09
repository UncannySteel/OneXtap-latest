// End-to-end checks with the extension loaded unpacked: the dashboard's
// profile sync into it (ONEXTAP_SYNC_DATA), autofill from the popup, and the
// popup's cover letters, signed out (sent to the dashboard) and signed in
// (credits). playwright.extension.config.js runs this file
// (`npm run test:e2e:extension`), after tests/extension-build.js has built the
// extension with unresolvable addresses. The account and the API are stubbed
// on the whole browser context, so the same stubs answer the website and the
// extension's pages. Nothing here reaches a real project or a real model.
import { test as base, expect, chromium } from '@playwright/test';
import { EXTENSION_DIR } from './extension-build.js';
import { stubAuth, stubApi, sessionFor } from './stubs.js';

const SITE = 'http://localhost:5173';

const test = base.extend({
  // An extension loads only into a persistent context; '' is a fresh
  // profile folder, removed when the context closes. It needs Playwright's
  // full Chromium (`npx playwright install chromium`), not the headless shell
  // the other suites use. E2E_CHROMIUM_PATH points at another chrome.exe: on
  // one Windows machine the installed one failed to start ("side-by-side
  // configuration is incorrect") and a copy of its folder elsewhere ran.
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

  test('popup cover letters: one credit buys a personalisation and one free re-run', async ({ context, serviceWorker, extensionId }) => {
    await stubAuth(context);
    const api = await stubApi(context, { credits: 1 });
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/index.html`);

    // A profile, filed by the worker's own sync handler, and a session put in
    // place: the popup has no sign-in of its own (HANDOVER.md §7 item 27), so
    // this path is dormant until it gets one. Signed out, see the next test.
    // First, the popup's first-run setup has to finish: it writes an empty
    // store from what it read before, which would undo a profile filed
    // meanwhile.
    await expect(popup.getByRole('button', { name: 'Open Dashboard' })).toBeVisible();
    await popup.evaluate((payload) => chrome.runtime.sendMessage({ type: 'ONEXTAP_SYNC_DATA', payload }),
      { firstName: 'Ada', email: 'ada@example.com' });
    await serviceWorker.evaluate((session) => chrome.storage.local.set({ 'sb-e2e-auth-token': JSON.stringify(session) }),
      sessionFor('reader@example.com'));
    await popup.reload();

    const deducts = () => api.calls.filter((c) => c.path === '/api/credits/deduct').length;
    const generations = () => api.calls.filter((c) => c.path === '/api/answer-vault/generate').length;
    const button = popup.getByRole('button', { name: 'Personalize for this job application' });
    const suggestion = popup.locator('p:text-is("AI Suggestion") + textarea');
    const description = popup.getByPlaceholder('Paste job description, program details, or scholarship prompt…');

    await popup.getByRole('button', { name: 'Cover Letter' }).click();
    await popup.getByRole('button', { name: 'Paste manually' }).click();
    await popup.getByPlaceholder('Template name (e.g. Formal)').fill('Formal');
    await popup.getByRole('button', { name: 'Save', exact: true }).click();
    await popup.getByPlaceholder('Paste your base cover letter…').fill('Dear team, I build payment systems that stay up.');
    await popup.getByPlaceholder('Company / school / organization').fill('Norwick Labs');
    await description.fill('Senior Backend Engineer at Norwick Labs. Requirements: Python, PostgreSQL, Docker.');
    await expect(popup.getByText('Uses 1 credit · includes 1 free re-run')).toBeVisible();

    // Paid: one credit, through the server, after the letter came back.
    await button.click();
    await expect(suggestion).toHaveValue('Dear Norwick Labs team, letter number 1.');
    expect(deducts()).toBe(1);
    expect(api.state.credits).toBe(0);
    await expect(popup.getByText('Free re-run for this description')).toBeVisible();

    // Its re-run is free, with the balance at zero.
    await button.click();
    await expect(suggestion).toHaveValue('Dear Norwick Labs team, letter number 2.');
    expect(deducts()).toBe(1);

    // Another job, no credits: refused before any AI call.
    await description.fill('Platform Engineer at Kestrel Analytics. Requirements: Kubernetes, Terraform.');
    await expect(popup.getByText('No credits left · Premium makes cover letters unlimited')).toBeVisible();
    await button.click();
    await expect(popup.getByText('No credits remaining. Premium makes cover letters unlimited.')).toBeVisible();
    expect(generations()).toBe(2);
    expect(deducts()).toBe(1);

    // The allowance is kept on the template, in the extension's store.
    const stored = await extensionStorage(serviceWorker, ['onextap_profiles']);
    expect(activeProfile(stored).coverLetters[0]).toMatchObject({ name: 'Formal', aiRerunsLeft: 0 });
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
    await expect(popup.getByText('AI personalization is on the dashboard. Versions you save there appear here, ready to fill.')).toBeVisible();
    await expect(popup.getByRole('button', { name: /^Personalize for this/ })).toHaveCount(0);

    // Its button opens the dashboard's Cover Letter workspace, with the
    // extension's ID, so what is saved there syncs back.
    const [dashboard] = await Promise.all([
      context.waitForEvent('page'),
      popup.getByRole('button', { name: 'Personalize on the dashboard' }).click()
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
});
