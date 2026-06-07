// Onextap background service worker (MV3)
// Handles website↔extension sync, resume parsing, job-page scraping, and answer generation.

const API_URL = (
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? 'https://www.onextap.com' : '')
).replace(/\/$/, '');

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Onextap] background service worker installed');
});

// ─── scrapeJobPage ────────────────────────────────────────────────────────────
// Self-contained function serialized into the target page — NO closure variables.
function scrapeJobPage() {
  // Derive company name
  let company = '';

  // 1) og:site_name meta tag
  const ogSite = document.querySelector('meta[property="og:site_name"]');
  if (ogSite && ogSite.content && ogSite.content.trim()) {
    company = ogSite.content.trim();
  }

  // 2) Known job-board company selectors
  if (!company) {
    const selectors = [
      '[class*="company-name" i]',
      '[class*="companyName" i]',
      '[data-testid*="company" i]',
      '.jobs-unified-top-card__company-name',
      '.job-details-jobs-unified-top-card__company-name',
      '[class*="employer" i]',
    ];
    for (const sel of selectors) {
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
    const parts = title.split(/\s*[\|\-—]\s*|\s+at\s+/i);
    // Usually the last meaningful segment is the company
    if (parts.length > 1) {
      company = parts[parts.length - 1].trim();
    }
  }

  // Derive job description
  let description = '';
  const descSelectors = [
    '[class*="job-description" i]',
    '[class*="jobDescription" i]',
    '[data-testid*="description" i]',
    '#job-details',
    '.jobs-description',
    '.jobs-box__html-content',
    '[class*="description" i]',
    'article',
    'main',
  ];

  let best = null;
  let bestLen = 0;
  for (const sel of descSelectors) {
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

// ─── Main message handler ─────────────────────────────────────────────────────
async function handleMessage(msg, sendResponse) {
  // Normalise: support both `type` and `action` fields
  const kind = msg.type || msg.action;

  try {
    // 1) SYNC PROFILE FROM WEBSITE
    if (kind === 'ONEXTAP_SYNC_DATA') {
      if (!msg.payload) {
        sendResponse({ success: false, error: 'No profile payload' });
        return;
      }
      await chrome.storage.local.set({ user_profile: msg.payload });
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
          sendResponse({ success: true, data: body.data });
        } else {
          sendResponse({
            success: false,
            error: body.error || `Resume parse failed (${res.status})`,
            debug: { status: res.status },
          });
        }
      } catch (err) {
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
          sendResponse({
            success: false,
            error: respBody.error || `Generation failed (${res.status})`,
          });
        }
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return;
    }

    // 5) Unknown message
    sendResponse({ success: false, error: 'Unknown request' });
  } catch (outerErr) {
    // Safety net — never let an exception escape without a response
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
