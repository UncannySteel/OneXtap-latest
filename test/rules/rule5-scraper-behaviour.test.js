/**
 * CLAUDE.md rule 5, behaviourally: the two page scrapers give the same answer
 * on job-board markup.
 *
 * scrapeJobPage() (extension/background.js) and scrapePageContext()
 * (public/content.js) cannot call each other, so each is run here from its
 * own source, in a bare vm context, against the same stub pages. The one
 * intended difference is that scrapePageContext() also reads school /
 * university / organization / essay markup for college and scholarship
 * applications; scrapeJobPage() scrapes job pages only, and must not.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { scrapeJobPage, scrapePageContext, runScraper } from './scrapers.js';

const SCRAPERS = {
  scrapeJobPage: scrapeJobPage().source,
  scrapePageContext: scrapePageContext().source,
};

const og = (content) => ({ tag: 'meta', attrs: { property: 'og:site_name' }, content });
const long = (word, n = 40) => Array.from({ length: n }, () => word).join(' ');

/** Run `page` through both scrapers and check `expected` against each. */
function both(name, page, expected) {
  for (const [scraper, source] of Object.entries(SCRAPERS)) {
    test(`${scraper}: ${name}`, () => {
      const result = runScraper(source, page);
      for (const [key, value] of Object.entries(expected)) assert.equal(result[key], value, key);
    });
  }
}

// ── Shared behaviour ──────────────────────────────────────────────────────

both(
  'og:site_name wins over company markup',
  { elements: [og(' Acme '), { className: 'company-name', innerText: 'Other' }], title: 'Role - Title Co' },
  { company: 'Acme' },
);

both(
  'a blank og:site_name falls through to the company selectors, case-insensitively',
  { elements: [og('   '), { className: 'TopCard__CompanyName', innerText: ' Initech ' }] },
  { company: 'Initech' },
);

both(
  'a company element with no text is skipped for the next selector',
  {
    elements: [
      { className: 'company-name', innerText: '   ' },
      { attrs: { 'data-testid': 'job-company' }, innerText: 'Globex' },
    ],
  },
  { company: 'Globex' },
);

both(
  'company selectors are tried in list order, not document order',
  {
    elements: [
      { className: 'employer-info', innerText: 'Employer Co' },
      { className: 'company-name', innerText: 'Name Co' },
    ],
  },
  { company: 'Name Co' },
);

both('the title fallback takes the last " - " segment', { title: 'Senior Engineer - Acme Corp' }, { company: 'Acme Corp' });
both('the title fallback splits on " at "', { title: 'Engineer at Initech' }, { company: 'Initech' });
both('the title fallback splits on | and —', { title: 'Engineer | Hooli — Careers' }, { company: 'Careers' });
both('a title with no separator gives no company', { title: 'Careers' }, { company: '' });

both(
  'the longest description candidate wins, whitespace collapsed',
  {
    elements: [
      { className: 'job-description', innerText: 'short' },
      { tag: 'article', innerText: '  a much   longer\n\n article text ' },
    ],
  },
  { description: 'a much longer article text' },
);

both(
  '#job-details is a description candidate',
  { elements: [{ id: 'job-details', innerText: long('details') }, { tag: 'main', innerText: 'main' }] },
  { description: long('details') },
);

both('the description is capped at 8000 characters', { elements: [{ tag: 'article', innerText: 'x'.repeat(9000) }] }, {
  description: 'x'.repeat(8000),
});

both('with no candidate, the body text is the description', { body: '  Body   text \n here ' }, { description: 'Body text here' });
both('with no candidate and no body, the description is empty', { body: null }, { description: '' });

// ── Job-board fixes (rule 5: both copies carry them) ──────────────────────

// [class*="company-name" i] already matches this class, but only finds the
// first such element; the exact class reaches past an empty one.
both(
  "LinkedIn's .job-details-jobs-unified-top-card__company-name behind an empty company-name element",
  {
    elements: [
      { className: 'company-name', innerText: '' },
      { className: 'job-details-jobs-unified-top-card__company-name', innerText: 'LinkedIn Co' },
    ],
    title: 'Role | Fallback',
  },
  { company: 'LinkedIn Co' },
);

both(
  "LinkedIn's .jobs-box__html-content",
  {
    elements: [
      { className: 'jobs-box__html-content', innerText: long('posting') },
      { tag: 'main', innerText: 'short main' },
    ],
  },
  { description: long('posting') },
);

both(
  'a data-testid description',
  {
    elements: [
      { attrs: { 'data-testid': 'jobDescriptionText' }, innerText: long('testid') },
      { tag: 'main', innerText: 'short main' },
    ],
  },
  { description: long('testid') },
);

both(
  '.jobs-description behind an earlier, shorter description element',
  {
    elements: [
      { className: 'description', innerText: 'tiny' },
      { className: 'jobs-description', innerText: long('jobs') },
    ],
  },
  { description: long('jobs') },
);

both(
  'a jobDescription class behind an earlier, shorter description element',
  {
    elements: [
      { className: 'description', innerText: 'tiny' },
      { className: 'jobDescriptionContent', innerText: long('camel') },
    ],
  },
  { description: long('camel') },
);

both(
  'on an exact-length tie, the earlier selector in the list wins',
  {
    elements: [
      { className: 'description', innerText: 'from-description' },
      { id: 'job-details', innerText: 'from-job-details' },
    ],
  },
  // 16 characters each; #job-details precedes [class*="description" i].
  { description: 'from-job-details' },
);

// ── The intended difference ───────────────────────────────────────────────

const ACADEMIC_COMPANY = [
  ['organization', { className: 'organization-name', innerText: 'Rotary Club' }],
  ['school', { className: 'school-name', innerText: 'Springfield High' }],
  ['university', { className: 'university-title', innerText: 'State University' }],
];

for (const [kind, element] of ACADEMIC_COMPANY) {
  test(`scrapePageContext: reads ${kind} markup as the institution`, () => {
    const result = runScraper(SCRAPERS.scrapePageContext, { elements: [element], title: 'Apply | Fallback' });
    assert.equal(result.company, element.innerText);
  });

  test(`scrapeJobPage: ignores ${kind} markup`, () => {
    const result = runScraper(SCRAPERS.scrapeJobPage, { elements: [element], title: 'Apply | Fallback' });
    assert.equal(result.company, 'Fallback');
  });
}

test('scrapePageContext: academic institutions come after every job-board selector', () => {
  const result = runScraper(SCRAPERS.scrapePageContext, {
    elements: [
      { className: 'school-name', innerText: 'Springfield High' },
      { className: 'employer', innerText: 'Employer Co' },
    ],
  });
  assert.equal(result.company, 'Employer Co');
});

for (const kind of ['personal-statement', 'essay']) {
  const page = { elements: [{ className: `${kind}-prompt`, innerText: long(kind) }], body: 'Body' };

  test(`scrapePageContext: reads ${kind} markup as the description`, () => {
    assert.equal(runScraper(SCRAPERS.scrapePageContext, page).description, long(kind));
  });

  test(`scrapeJobPage: ignores ${kind} markup`, () => {
    assert.equal(runScraper(SCRAPERS.scrapeJobPage, page).description, 'Body');
  });
}
