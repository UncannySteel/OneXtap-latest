/**
 * App Configuration
 *
 * Build-time constants shared by the extension popup, the website (landing
 * page + dashboard) and the matching code's callers: the published extension
 * ID, its Chrome Web Store listing, the site and API origins, and the Answer
 * Studio model name.
 *
 * The URL and model values read `import.meta.env`, so Vite inlines them at
 * build time and they can differ between the extension build and the
 * website build. Public values only — anything `VITE_*` ships inside the
 * bundle, so server secrets stay in server/.env.
 *
 * ═══ ONE SITE ═══
 *
 * The landing page, the dashboard and the API share one origin: the landing
 * page at `/`, the dashboard at DASHBOARD_PATH, the API at `/api/`.
 * `VITE_DASHBOARD_URL` keeps its name from when the dashboard sat at the site
 * root, and its value is still the site's origin (`https://www.onextap.com`,
 * `http://localhost:5173`) — the dashboard's path is appended here, so an
 * existing .env or Vercel variable needs no change. A value that already ends
 * in the dashboard path is taken as it is.
 */

// Fallback extension ID (e.g. for published extension). When opening dashboard from popup we pass the real ID via ?extensionId=
export const EXTENSION_ID_FALLBACK = "fpleipjggoiolomkcnchnlelbjcnoklj";
export const CHROME_WEB_STORE_URL = `https://chromewebstore.google.com/detail/fpleipjggoiolomkcnchnlelbjcnoklj?utm_source=item-share-cb`;

/** Where the dashboard lives on the site. The website links to it by this path. */
export const DASHBOARD_PATH = '/dashboard/';

const configuredSite = String(import.meta.env.VITE_DASHBOARD_URL || "https://www.onextap.com").replace(/\/+$/, '');

/** The site's origin: the landing page is here. */
export const SITE_URL = configuredSite.endsWith(DASHBOARD_PATH.replace(/\/$/, ''))
  ? configuredSite.slice(0, -DASHBOARD_PATH.replace(/\/$/, '').length)
  : configuredSite;

/**
 * The dashboard, absolute — for the extension, which is not on the site and
 * opens it in a tab (`?extensionId=` and `?view=` are appended to this).
 */
export const DASHBOARD_URL = `${SITE_URL}${DASHBOARD_PATH}`;

/**
 * The API's origin, with no trailing slash. VITE_API_URL wins when set.
 * Without it, a production build answers by where it runs: on the website,
 * the page's own origin, since the API is at /api/ on the same site (so a
 * preview or a new domain calls its own API, not the live one); in the
 * extension, https://www.onextap.com, since an extension page has no site
 * origin of its own. Development builds get '' and need VITE_API_URL.
 * `chrome.runtime.id` exists only in extension contexts, never on a web page,
 * even one the extension can message.
 */
const inExtension = typeof chrome !== 'undefined' && !!chrome?.runtime?.id;
const productionApi = inExtension || typeof window === 'undefined'
  ? 'https://www.onextap.com'
  : window.location.origin;

export const API_URL = (
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? productionApi : '')
).replace(/\/$/, '');
export const ANSWER_STUDIO_MODEL = import.meta.env.VITE_ANSWER_STUDIO_MODEL || "llama-3.3-70b-versatile";
