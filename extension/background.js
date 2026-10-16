// Onextap background service worker (MV3)
// Handles website↔extension sync, resume parsing, job-page scraping, and answer generation.
//
// Every message is accepted on both chrome.runtime.onMessage (from the popup)
// and onMessageExternal (from the dashboard on an externally_connectable
// origin). The message kind may be given as either `type` or `action`.
// Every reply is { success: true, ... } or { success: false, error }:
//
//   ONEXTAP_SYNC_DATA        { payload }                  → {}            — files payload into storage.local.onextap_profiles
//                                                                         as the active profile, and mirrors it to user_profile
//   PARSE_RESUME             { data: { fileData, fileName, fileType, token } }
//                                                         → { data }      — proxies POST /api/parse-resume
//   SCRAPE_ACTIVE_TAB        —                            → { context: { company, description } }
//   GENERATE_IMPROVED_ANSWER { data: { token, ...body } } → { text }      — proxies POST /api/answer-vault/generate
//
// `token` is the caller's Supabase JWT: the two proxied calls hit authenticated
// endpoints, and the worker holds no session of its own.

import { log, installWorkerErrorHandlers } from './logger.js';
import { fileSyncedProfile } from './profileSync.js';

installWorkerErrorHandlers();

const API_URL = (
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? 'https://www.onextap.com' : '')
).replace(/\/$/, '');

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

// ─── Main message handler ─────────────────────────────────────────────────────
async function handleMessage(msg, sendResponse) {
  // Normalise: support both `type` and `action` fields
  const kind = msg.type || msg.action;

  try {
    // 1) SYNC PROFILE FROM WEBSITE
    if (kind === 'ONEXTAP_SYNC_DATA') {
      const payload = msg.payload;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        sendResponse({ success: false, error: 'No profile payload' });
        return;
      }
      // Into the profile store the popup reads, not only the user_profile
      // mirror, which it ignores once the store exists: see profileSync.js.
      const { onextap_profiles: stored } = await chrome.storage.local.get('onextap_profiles');
      await chrome.storage.local.set(fileSyncedProfile(stored, payload));
      sendResponse({ success: true });
      return;
    }

    // 2) PARSE RESUME
    if (kind === 'PARSE_RESUME') {
      const data = msg.data || {};
      const { fileData, fileName, fileType, token } = data;
      try {
        const res = await fetch(`${API_URL}/api/parse-resume`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + token,
          },
          body: JSON.stringify({ fileData, fileName, fileType }),
        });
        const body = await res.json();
        if (res.ok && body.data) {
          // `text` is the raw transcription alongside the structured `data`.
          // The corpus builder and the fabrication validator both diff against
          // it, and the file bytes are discarded after this call — so if it is
          // dropped here, the only way to recover it is another upload. Older
          // server builds do not return it; forwarding undefined is harmless.
          sendResponse({ success: true, data: body.data, text: body.text });
        } else {
          log.error('resume parse rejected by server', {
            status: res.status,
            requestId: res.headers.get('X-Request-Id'),
          });
          sendResponse({
            success: false,
            error: body.error || `Resume parse failed (${res.status})`,
            debug: { status: res.status },
          });
        }
      } catch (err) {
        log.error('resume parse request failed', err, { fileType, api: API_URL });
        sendResponse({ success: false, error: err.message });
      }
      return;
    }

    // 3) SCRAPE ACTIVE TAB
    if (kind === 'SCRAPE_ACTIVE_TAB') {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab || !tab.id) {
          sendResponse({ success: false, error: 'Cannot read this page' });
          return;
        }

        const restricted = [
          'chrome:',
          'chrome-extension:',
          'edge:',
          'about:',
        ];
        const url = tab.url || '';
        const isRestricted =
          restricted.some(scheme => url.startsWith(scheme)) ||
          url.startsWith('https://chrome.google.com');

        if (isRestricted) {
          sendResponse({ success: false, error: 'Cannot read this page' });
          return;
        }

        const injectionResults = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: scrapeJobPage,
        });

        const result = injectionResults?.[0]?.result || {};
        sendResponse({
          success: true,
          context: {
            company: result.company || '',
            description: result.description || '',
          },
        });
      } catch (e) {
        log.error('active tab scrape failed', e);
        sendResponse({ success: false, error: e.message });
      }
      return;
    }

    // 4) GENERATE IMPROVED ANSWER
    if (kind === 'GENERATE_IMPROVED_ANSWER') {
      const payload = msg.data || {};
      const { token, ...body } = payload;
      try {
        const res = await fetch(`${API_URL}/api/answer-vault/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + token,
          },
          body: JSON.stringify(body),
        });
        const respBody = await res.json();
        if (res.ok) {
          sendResponse({ success: true, text: respBody.text || respBody.answer || '' });
        } else {
          log.error('answer generation rejected by server', {
            status: res.status,
            requestId: res.headers.get('X-Request-Id'),
          });
          sendResponse({
            success: false,
            error: respBody.error || `Generation failed (${res.status})`,
          });
        }
      } catch (err) {
        log.error('answer generation request failed', err, { api: API_URL });
        sendResponse({ success: false, error: err.message });
      }
      return;
    }

    // 5) Unknown message
    log.warn('unknown message kind', { kind });
    sendResponse({ success: false, error: 'Unknown request' });
  } catch (outerErr) {
    // Safety net — never let an exception escape without a response
    log.error('unhandled error in message handler', outerErr, { kind });
    sendResponse({ success: false, error: outerErr.message });
  }
}

// Register on both channels; return true to keep the sendResponse port open.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg, sendResponse);
  return true;
});

chrome.runtime.onMessageExternal.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg, sendResponse);
  return true;
});
