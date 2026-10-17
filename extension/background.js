// Onextap background service worker (MV3)
// Handles website↔extension sync, resume parsing, job-page scraping, and answer generation.
//
// Messages arrive on chrome.runtime.onMessage (the popup, the content script)
// and onMessageExternal (the website, on an externally_connectable origin),
// and both go to the registry in ./messages/registry.js: one module per
// message, each naming who may send it. The contract, every message's payload
// and reply, and what 1.0.2 answers, are in docs/extension-protocol.md.

import { log, installWorkerErrorHandlers } from './logger.js';
import { dispatch } from './messages/registry.js';
import { allowedOrigins } from './messages/senders.js';

installWorkerErrorHandlers();

const API_URL = (
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? 'https://www.onextap.com' : '')
).replace(/\/$/, '');

// The dashboard, where the cover-letter handoff opens a tab. Worked out as
// src/config.js works out DASHBOARD_URL, which the worker cannot import
// (docs/repo-structure.md): VITE_DASHBOARD_URL is the site's origin, and the
// dashboard is at /dashboard/ on it.
const SITE_URL = String(import.meta.env.VITE_DASHBOARD_URL || 'https://www.onextap.com')
  .replace(/\/+$/, '')
  .replace(/\/dashboard$/, '');
const DASHBOARD_URL = `${SITE_URL}/dashboard/`;

chrome.runtime.onInstalled.addListener(() => {
  log.info('background service worker installed');
});

// ─── scrapeJobPage ────────────────────────────────────────────────────────────
// Self-contained function serialized into the target page — NO closure variables.
// It is passed to chrome.scripting.executeScript({ func }), so it may not
// reference anything outside its own body (imports, module constants, helpers);
// doing so throws in the page, not here.
//
// public/content.js has a near-identical scrapePageContext() for the same job.
// Neither can call the other: this one must stay inline-serialisable, that one
// runs from an injected file. Both open with the same SELECTORS literal, and
// test/rules/rule5-scraper-selectors.test.js fails if the two copies differ,
// so a selector fix goes into both. That one also reads the *Academic lists
// (school / university / essay markup for the college and scholarship
// application types); this one must not.
//
// Returns { company, description } — description whitespace-collapsed, capped
// at 8000 chars.
/* eslint-disable no-undef -- runs in the page, not the worker; test/rules lints it standalone with browser globals */
function scrapeJobPage() {
  // Identical in scrapePageContext() (public/content.js): change both or
  // neither. companyAcademic and descriptionAcademic are read only there, on
  // purpose: this scrapes job pages, where a "school" class could be taken for
  // the employer. Declared inside the body because this function is
  // serialized into the page (CLAUDE.md rule 9).
  const SELECTORS = {
    siteName: 'meta[property="og:site_name"]',
    company: [
      '[class*="company-name" i]',
      '[class*="companyName" i]',
      '[data-testid*="company" i]',
      '.jobs-unified-top-card__company-name',
      '.job-details-jobs-unified-top-card__company-name',
      '[class*="employer" i]',
    ],
    companyAcademic: [
      '[class*="organization" i]',
      '[class*="school" i]',
      '[class*="university" i]',
    ],
    description: [
      '[class*="job-description" i]',
      '[class*="jobDescription" i]',
      '[data-testid*="description" i]',
      '#job-details',
      '.jobs-description',
      '.jobs-box__html-content',
      '[class*="description" i]',
      'article',
      'main',
    ],
    descriptionAcademic: [
      '[class*="personal-statement" i]',
      '[class*="essay" i]',
    ],
  };

  // Derive company name
  let company = '';

  // 1) og:site_name meta tag
  const ogSite = document.querySelector(SELECTORS.siteName);
  if (ogSite && ogSite.content && ogSite.content.trim()) {
    company = ogSite.content.trim();
  }

  // 2) Known job-board company selectors
  if (!company) {
    for (const sel of SELECTORS.company) {
      const el = document.querySelector(sel);
      if (el && el.innerText && el.innerText.trim()) {
        company = el.innerText.trim();
        break;
      }
    }
  }

  // 3) Parse document.title
  if (!company) {
    const title = document.title || '';
    // Split on | - — or " at "
    const parts = title.split(/\s*[|\-—]\s*|\s+at\s+/i);
    // Usually the last meaningful segment is the company
    if (parts.length > 1) {
      company = parts[parts.length - 1].trim();
    }
  }

  // Derive job description
  let description = '';

  let best = null;
  let bestLen = 0;
  for (const sel of SELECTORS.description) {
    const el = document.querySelector(sel);
    if (el) {
      const text = (el.innerText || '').trim();
      if (text.length > bestLen) {
        bestLen = text.length;
        best = text;
      }
    }
  }

  description = best || (document.body && document.body.innerText) || '';

  // Collapse whitespace and cap at 8000 chars
  description = description.replace(/\s+/g, ' ').trim().slice(0, 8000);

  return { company, description };
}
/* eslint-enable no-undef */

// ─── Message routing ──────────────────────────────────────────────────────────
// Built once: what the handlers use, and what the sender checks read. The
// allowlist comes from this build's own manifest, so a release manifest
// without the localhost entries narrows it.
const context = {
  chrome,
  // Wrapped: a bare `fetch` called as context.fetch() is an illegal invocation.
  fetch: (...args) => fetch(...args),
  apiUrl: API_URL,
  dashboardUrl: DASHBOARD_URL,
  log,
  scrapeJobPage,
  runtimeId: chrome.runtime.id,
  origins: allowedOrigins(chrome.runtime.getManifest()),
};

// Register on both channels; return true to keep the sendResponse port open.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  dispatch(msg, sender, 'internal', context).then(sendResponse);
  return true;
});

chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  dispatch(msg, sender, 'external', context).then(sendResponse);
  return true;
});
