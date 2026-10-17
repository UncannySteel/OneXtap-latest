// The cover-letter handoff, end to end, with the extension loaded unpacked
// (docs/extension-protocol.md, "The cover-letter handoff"): a job page with a
// cover-letter field gets the "Customize cover letter" button, the button
// opens the dashboard's Cover Letter workspace with the job filled in, and
// the version saved there comes back to the popup to fill the page.
// playwright.extension.config.js runs this file (`npm run test:e2e:extension`)
// against the build tests/extension-build.js makes; the account and the API
// are stubbed on the whole browser context, as in extension.spec.js.
/* global chrome -- the evaluate() callbacks run in the extension's worker and the site's pages */
import { test as base, expect, chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { EXTENSION_DIR } from './extension-build.js';
import { stubAuth, stubApi } from './stubs.js';

const SITE = 'http://localhost:5173';

// The job page. On localhost:3001, which the manifest's host_permissions list
// and externally_connectable does not: the extension may script it without a
// click on its icon (activeTab), and it is not the Onextap site, which gets no
// button. Nothing listens on 3001; the route answers.
const JOB_URL = 'http://localhost:3001/e2e-job/';
const JOB_PAGE = fileURLToPath(new URL('./fixtures/job-page.html', import.meta.url));

const LETTER = 'Dear Norwick Labs team, letter number 1.';

const test = base.extend({
  // As extension.spec.js: an extension loads only into a persistent context.
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

// Signed in on the website, through its sign-in window.
async function signIn(page) {
  await page.goto(`${SITE}/contact/`);
  await page.click('.hud [data-login]');
  await page.fill('#loginEmail', 'reader@example.com');
  await page.fill('#loginPassword', 'hunter22');
  await page.click('#loginSubmit');
  await expect(page.locator('#loginDoneText')).toHaveText('Signed in as reader@example.com.');
}

const extensionStorage = (serviceWorker, keys) =>
  serviceWorker.evaluate((k) => chrome.storage.local.get(k), keys);
const activeProfile = (store) => store.onextap_profiles.profiles[store.onextap_profiles.activeProfileId];
const handoffsKept = (serviceWorker) => serviceWorker.evaluate(async () =>
  Object.keys(await chrome.storage.session.get(null)).filter((k) => k.startsWith('coverHandoff:')));

// The button's host, in the page's own DOM. What is inside it is in a closed
// shadow root, which Playwright's locators do not enter, by design.
const hostOf = (page) => page.locator('[data-onextap-cover-button]');

/**
 * The page's buttons that name Onextap, as assistive technology finds them:
 * from the accessibility tree, which a closed shadow root does not hide.
 * @returns {Promise<string[]>} Their accessible names.
 */
async function onextapButtons(page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Accessibility.enable');
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    return nodes
      .filter((n) => !n.ignored && n.role?.value === 'button' && /Onextap/.test(n.name?.value || ''))
      .map((n) => n.name.value);
  } finally {
    await cdp.detach();
  }
}

/** Click "Customize cover letter": the left end of the host, where it sits. */
async function clickCustomize(page) {
  const box = await hostOf(page).boundingBox();
  await page.mouse.click(box.x + 24, box.y + Math.min(box.height, 32) / 2);
}

/** What the popup does on opening over a tab: inject content.js, then MOUNT_COVER_BUTTON. */
const mountFromWorker = (serviceWorker, url) => serviceWorker.evaluate(async (jobUrl) => {
  const [tab] = await chrome.tabs.query({ url: jobUrl });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  return chrome.tabs.sendMessage(tab.id, { action: 'MOUNT_COVER_BUTTON' });
}, url);

async function openJobPage(context) {
  const job = await context.newPage();
  await job.goto(JOB_URL);
  await job.bringToFront();
  return job;
}

test.describe('the cover-letter handoff, with the extension loaded', () => {
  test('a job page\'s button opens the dashboard filled in, and the version saved there fills the page from the popup', async ({ context, page, serviceWorker, extensionId }) => {
    await stubAuth(context);
    const api = await stubApi(context, { credits: 2 });
    await context.route(JOB_URL, (route) => route.fulfill({ path: JOB_PAGE, contentType: 'text/html' }));
    await signIn(page);

    // A profile from the dashboard, so the popup has its tabs.
    await page.goto(`${SITE}/dashboard/?extensionId=${extensionId}&view=profiles`);
    await page.getByLabel('First name').fill('Ada');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('.savebar-status')).toHaveText('Saved and synced to the extension');

    // The popup, opened while the job page is the tab in front: it injects
    // content.js there and asks for the button. (Opened in a tab, as the
    // other extension tests do; reloaded, it opens again without coming to
    // the front.)
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/index.html`);
    const job = await openJobPage(context);
    const form = await job.locator('form').boundingBox();
    await popup.reload();

    // One button, under the cover-letter field, outside the form, which has
    // not moved: the host is fixed, in <body>.
    await expect(hostOf(job)).toHaveCount(1);
    await expect(hostOf(job)).toBeVisible();
    expect(await job.evaluate(() => document.querySelector('[data-onextap-cover-button]').parentElement === document.body)).toBe(true);
    expect(await job.locator('form').boundingBox()).toEqual(form);
    const field = await job.locator('#cl').boundingBox();
    const host = await hostOf(job).boundingBox();
    expect(Math.abs(host.y - (field.y + field.height + 6))).toBeLessThanOrEqual(1);
    expect(Math.abs(host.x - field.x)).toBeLessThanOrEqual(1);
    expect(await onextapButtons(job)).toEqual(['Customize cover letter with Onextap', 'Hide the Onextap cover letter button']);

    // Opening the popup again, or autofilling, keeps the one button.
    await popup.reload();
    await popup.getByRole('button', { name: 'Autofill Application' }).click();
    await expect(job.locator('#fn')).toHaveValue('Ada');
    await expect(hostOf(job)).toHaveCount(1);
    expect(await onextapButtons(job)).toHaveLength(2);

    // The button: the dashboard opens with the job, and the handoff is used up.
    await job.bringToFront();
    const [dashboard] = await Promise.all([context.waitForEvent('page'), clickCustomize(job)]);
    await dashboard.waitForURL(/\/dashboard\/.*#\/cover-letter$/);
    const arrived = new URL(dashboard.url());
    expect(arrived.searchParams.has('handoff')).toBe(false);
    expect(arrived.searchParams.get('extensionId')).toBe(extensionId);

    await expect(dashboard.getByText('Filled from the job page: check it before personalising')).toBeVisible();
    await expect(dashboard.getByPlaceholder('Company or organisation')).toHaveValue('Norwick Labs');
    await expect(dashboard.getByPlaceholder('Role', { exact: true })).toHaveValue('Senior Backend Engineer');
    const description = dashboard.getByPlaceholder('Paste the job description — the letter is rewritten around what it asks for.');
    await expect(description).toHaveValue(/^About the role Norwick Labs builds payment systems that stay up\./);
    await expect(description).toHaveValue(/Requirements Python PostgreSQL Docker$/);
    expect(await handoffsKept(serviceWorker)).toEqual([]);
    // Nothing was personalised on arrival: that is the user's click.
    expect(api.calls.filter((c) => c.path === '/api/answer-vault/generate')).toHaveLength(0);

    // A template, personalised for the job (stubbed), and saved.
    await dashboard.getByRole('button', { name: 'Add a template' }).click();
    await dashboard.getByPlaceholder('Template name (e.g. Formal)').fill('Formal');
    await dashboard.getByRole('button', { name: 'Create', exact: true }).click();
    await dashboard.getByPlaceholder('Paste your base cover letter…').fill('Dear team, I build payment systems that stay up.');
    await dashboard.getByRole('button', { name: 'Personalise for this job' }).click();
    await expect(dashboard.getByRole('textbox', { name: 'Personalised version' })).toHaveValue(LETTER);
    const sent = api.calls.find((c) => c.path === '/api/answer-vault/generate').body;
    expect(sent.jobContext).toMatch(/^Organization: Norwick Labs\nRole: Senior Backend Engineer\n\nAbout the role/);
    await dashboard.getByRole('button', { name: 'Save version' }).click();
    await expect.poll(async () => {
      const stored = await extensionStorage(serviceWorker, ['onextap_profiles']);
      return activeProfile(stored).coverLetters?.[0]?.variants?.[0] || null;
    }).toMatchObject({ company: 'Norwick Labs', role: 'Senior Backend Engineer', body: LETTER });

    // The popup's Cover tab: the version, and Fill puts it in the page's field.
    await job.bringToFront();
    await popup.reload();
    await popup.getByRole('button', { name: 'Cover Letter' }).click();
    await expect(popup.getByText('Norwick Labs').first()).toBeVisible();
    await popup.getByRole('button', { name: 'Fill', exact: true }).first().click();
    await expect(job.locator('#cl')).toHaveValue(LETTER);
  });

  test('signed out, the job waits through sign-in; a second read finds nothing', async ({ context, serviceWorker, extensionId }) => {
    await stubAuth(context);
    await stubApi(context);
    await context.route(JOB_URL, (route) => route.fulfill({ path: JOB_PAGE, contentType: 'text/html' }));

    const job = await openJobPage(context);
    expect(await mountFromWorker(serviceWorker, JOB_URL)).toEqual({ success: true, mounted: true });
    await expect(hostOf(job)).toBeVisible();

    // Signed out: the dashboard sends the visitor to the landing page's
    // sign-in window, without the handoff in the address; it waits in the tab.
    const [tab] = await Promise.all([context.waitForEvent('page'), clickCustomize(job)]);
    await expect(tab.locator('#loginEmail')).toBeVisible();
    expect(new URL(tab.url()).pathname).toBe('/');
    expect(tab.url()).not.toContain('handoff');
    const handoff = await tab.evaluate(() => sessionStorage.getItem('onextap_cover_handoff'));
    expect(handoff).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(await handoffsKept(serviceWorker)).toEqual([`coverHandoff:${handoff}`]);

    await tab.fill('#loginEmail', 'reader@example.com');
    await tab.fill('#loginPassword', 'hunter22');
    await tab.click('#loginSubmit');
    await expect(tab.locator('#loginDoneText')).toHaveText('Signed in as reader@example.com.');
    await tab.locator('#loginDone').getByRole('button', { name: 'Continue' }).click();

    await tab.waitForURL(/\/dashboard\/.*#\/cover-letter$/);
    await expect(tab.getByText('Filled from the job page: check it before personalising')).toBeVisible();
    await expect(tab.getByPlaceholder('Company or organisation')).toHaveValue('Norwick Labs');
    await expect(tab.getByPlaceholder('Role', { exact: true })).toHaveValue('Senior Backend Engineer');
    expect(await tab.evaluate(() => sessionStorage.getItem('onextap_cover_handoff'))).toBeNull();
    expect(await handoffsKept(serviceWorker)).toEqual([]);

    // The job was for one read: asked again, the worker has nothing, and the
    // same address again says so in plain words.
    expect(await tab.evaluate(([id, extension]) => new Promise((resolve) =>
      chrome.runtime.sendMessage(extension, { type: 'GET_COVER_HANDOFF', id }, resolve)), [handoff, extensionId]))
      .toEqual({ success: false, error: 'This job has expired or was already opened' });
    await tab.goto(`${SITE}/dashboard/?view=cover&handoff=${handoff}&extensionId=${extensionId}`);
    await expect(tab.getByText('The job page’s details have expired.', { exact: false })).toBeVisible();
    await expect(tab.getByPlaceholder('Company or organisation')).toHaveValue('');
  });

  test('the button stays off a page without a cover-letter field, and off the Onextap site', async ({ context, serviceWorker }) => {
    const plain = 'http://localhost:3001/e2e-plain/';
    await context.route(plain, (route) => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Feedback</title><label for="c">Comments</label><textarea id="c" rows="9"></textarea>'
    }));
    const page = await context.newPage();
    await page.goto(plain);
    expect(await mountFromWorker(serviceWorker, plain)).toEqual({ success: true, mounted: false });
    await expect(hostOf(page)).toHaveCount(0);

    // The site's own pages, the dashboard's template editor included.
    const site = `${SITE}/e2e-site-form/`;
    await context.route(site, (route) => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Site</title><label for="cl">Cover letter</label><textarea id="cl"></textarea>'
    }));
    const own = await context.newPage();
    await own.goto(site);
    expect(await mountFromWorker(serviceWorker, site)).toEqual({ success: true, mounted: false });
    await expect(hostOf(own)).toHaveCount(0);
  });
});
