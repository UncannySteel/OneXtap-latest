/**
 * CLAUDE.md rule 9: scrapeJobPage() references nothing outside its own body.
 *
 * extension/background.js hands it to chrome.scripting.executeScript({ func }),
 * which serializes the function's source into the target page. An import, a
 * module constant or a helper it closes over is simply absent there, and the
 * ReferenceError surfaces in the user's tab, not in the build.
 *
 * Two checks, because each misses something the other catches: ESLint's
 * no-undef over the extracted source with only browser globals (sees every
 * path, but `name`, `status` and friends are browser globals), and a run in a
 * vm context whose only global is a stub `document` (sees only the paths it
 * runs, but nothing is in scope by accident).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Linter } from 'eslint';
import globals from 'globals';

import { scrapeJobPage, runScraper } from './scrapers.js';

const { source } = scrapeJobPage();

test('scrapeJobPage() lints clean standalone, with browser globals only', () => {
  const messages = new Linter().verify(source, {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'script', globals: { ...globals.browser } },
    rules: { 'no-undef': 'error' },
  });
  assert.deepEqual(
    messages.map((m) => `${m.line}:${m.column} ${m.message}`),
    [],
    'scrapeJobPage() reaches outside its own body',
  );
});

const PAGES = {
  empty: { body: null },
  'title only': { title: 'Engineer - Acme' },
  'og:site_name': { elements: [{ tag: 'meta', attrs: { property: 'og:site_name' }, content: 'Acme' }] },
  'every selector path': {
    title: 'Role | Fallback',
    body: 'body text',
    elements: [
      { className: 'company-name', innerText: '' },
      { className: 'employer', innerText: 'Employer' },
      { className: 'job-description', innerText: 'one' },
      { id: 'job-details', innerText: 'two two' },
      { tag: 'article', innerText: 'three three three' },
      { tag: 'main', innerText: 'four' },
    ],
  },
};

for (const [label, page] of Object.entries(PAGES)) {
  test(`scrapeJobPage() runs with nothing in scope but document: ${label}`, () => {
    const result = runScraper(source, page);
    assert.deepEqual(Object.keys(result).sort(), ['company', 'description']);
    assert.equal(typeof result.company, 'string');
    assert.equal(typeof result.description, 'string');
  });
}
