// SCRAPE_ACTIVE_TAB → { context: { company, description } }
//
// Reads the job page in the active tab. Since 1.0.2; the popup sends it, and
// so does today's production website.
//
// The scraper itself, scrapeJobPage(), stays in background.js and arrives in
// the context: it is serialized into the page by executeScript({ func }), and
// test/rules/ reads it from that file (CLAUDE.md rules 5 and 9).

// Pages Chrome does not let an extension script.
const RESTRICTED = [
  'chrome:',
  'chrome-extension:',
  'edge:',
  'about:',
];

export default {
  kind: 'SCRAPE_ACTIVE_TAB',
  from: ['site', 'popup'],

  async handle(_msg, { chrome, log, scrapeJobPage }) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab || !tab.id) {
        return { success: false, error: 'Cannot read this page' };
      }

      const url = tab.url || '';
      const isRestricted =
        RESTRICTED.some(scheme => url.startsWith(scheme)) ||
        url.startsWith('https://chrome.google.com');

      if (isRestricted) {
        return { success: false, error: 'Cannot read this page' };
      }

      const injectionResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scrapeJobPage,
      });

      const result = injectionResults?.[0]?.result || {};
      return {
        success: true,
        context: {
          company: result.company || '',
          description: result.description || '',
        },
      };
    } catch (e) {
      log.error('active tab scrape failed', e);
      return { success: false, error: e.message };
    }
  },
};
