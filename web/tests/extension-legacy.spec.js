// The website against store 1.0.2, the extension most users still have
// (completion plan §2): the dashboard has to tell it apart (`legacy`, from
// its "Unknown action" reply to ONEXTAP_HELLO), say so after a save, and parse
// resumes without it, since 1.0.2's PARSE_RESUME drops the transcription.
//
// Runs as the `legacy` project of playwright.extension.config.js, and only
// when E2E_LEGACY_EXTENSION_PATH points at an unpacked copy of store 1.0.2
// (its `_metadata` folder removed, its manifest `key` kept, so it loads under
// the store's ID). The account and the API are stubbed on the whole browser
// context. 1.0.2 is built against the live site and Supabase project; nothing
// here asks its worker to call either (no PARSE_RESUME, no
// GENERATE_IMPROVED_ANSWER, no popup), and both are blocked anyway.
/* global chrome -- the evaluate() callbacks run in the extension's worker */
import { readFileSync } from 'node:fs';
import { test as base, expect, chromium } from '@playwright/test';
import { stubAuth, stubApi } from './stubs.js';

const SITE = 'http://localhost:5173';
const LEGACY = process.env.E2E_LEGACY_EXTENSION_PATH;

// The store build's ID and listing, read from src/config.js (it cannot be
// imported here: it reads import.meta.env).
const config = readFileSync(new URL('../../src/config.js', import.meta.url), 'utf8');
const STORE_ID = /EXTENSION_ID_FALLBACK = ["']([a-p]{32})["']/.exec(config)[1];
const STORE_URL = /CHROME_WEB_STORE_URL = `([^`]+)`/.exec(config)[1];

const test = base.extend({
  // As in extension.spec.js, with 1.0.2 loaded instead of this build.
  // eslint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this destructure
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      executablePath: process.env.E2E_CHROMIUM_PATH || undefined,
      viewport: { width: 1280, height: 900 },
      args: [`--disable-extensions-except=${LEGACY}`, `--load-extension=${LEGACY}`]
    });
    // 1.0.2's own addresses. Nothing below should reach them.
    await context.route(/^https:\/\/(www\.)?onextap\.com\//, (route) => route.abort());
    await context.route(/^https:\/\/[^/]+\.supabase\.co\//, (route) => route.abort());
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

test.describe('the website with store 1.0.2 installed', () => {
  test.skip(!LEGACY, 'E2E_LEGACY_EXTENSION_PATH is not set (an unpacked copy of store 1.0.2)');

  test('1.0.2 is under the store ID, and answers 1.0.2\'s way', async ({ serviceWorker, extensionId }) => {
    // The dashboards below carry no ?extensionId=, so they message
    // EXTENSION_ID_FALLBACK, as the live site always does.
    expect(extensionId, 'the copy\'s manifest keeps the store key').toBe(STORE_ID);
    expect(await serviceWorker.evaluate(() => chrome.runtime.getManifest().version)).toBe('1.0.2');
  });

  test('a save says the extension is out of date, links to the store, and still sends the sync', async ({ context, page, serviceWorker }) => {
    await stubAuth(context);
    await stubApi(context);
    await signIn(page);

    await page.goto(`${SITE}/dashboard/?view=profiles`);
    await page.getByLabel('First name').fill('Ada');
    await page.getByLabel('Email', { exact: true }).fill('ada@example.com');
    await page.getByRole('button', { name: 'Save changes' }).click();

    const status = page.locator('.savebar-status');
    await expect(status).toHaveText('Saved — the extension is out of date: update it');
    await expect(status).toHaveAttribute('data-tone', 'warn');
    await expect(status.getByRole('link', { name: 'update it' })).toHaveAttribute('href', STORE_URL);

    // 1.0.2 files a sync into user_profile, and nowhere else: a popup that
    // has never opened reads it from there.
    const stored = await serviceWorker.evaluate(() => chrome.storage.local.get(['user_profile', 'onextap_profiles']));
    expect(stored.user_profile).toMatchObject({ firstName: 'Ada', email: 'ada@example.com' });
    expect(stored.onextap_profiles).toBeUndefined();
  });

  test('a resume is parsed through the API from the page, transcription and all, not through 1.0.2', async ({ context, page }) => {
    await stubAuth(context);
    await stubApi(context);
    // Registered after stubApi, so it answers this one path first.
    const parses = [];
    await context.route((url) => url.pathname === '/api/parse-resume', async (route) => {
      const request = route.request();
      parses.push({ url: request.url(), body: request.postDataJSON(), authorization: request.headers().authorization });
      await route.fulfill({
        json: { data: { firstName: 'Grace', lastName: 'Hopper', email: 'grace@example.com' }, text: 'Grace Hopper. Rear admiral.' }
      });
    });
    await signIn(page);

    await page.goto(`${SITE}/dashboard/?view=profiles`);
    // The resume section's picker (the settings' avatar picker is another file input).
    await page.locator('.drop-act input[type=file]').setInputFiles({
      name: 'cv.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 e2e resume')
    });

    await expect(page.getByLabel('First name')).toHaveValue('Grace');
    await expect(page.getByLabel('Last name')).toHaveValue('Hopper');
    expect(parses).toHaveLength(1);
    // From the page on the site: 1.0.2's worker would have called
    // https://www.onextap.com.
    expect(new URL(parses[0].url).origin).toBe(SITE);
    expect(parses[0].authorization).toMatch(/^Bearer \S+/);
    expect(parses[0].body).toMatchObject({ fileName: 'cv.pdf', fileType: 'application/pdf' });
    expect(parses[0].body.fileData).toBe(Buffer.from('%PDF-1.4 e2e resume').toString('base64'));
  });
});
