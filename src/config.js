/**
 * App Configuration
 *
 * Build-time constants shared by the extension popup and the web dashboard:
 * the published extension ID, its Chrome Web Store listing, the dashboard
 * and API origins, and the Answer Studio model name.
 *
 * The URL and model values read `import.meta.env`, so Vite inlines them at
 * build time and they can differ between the extension build and the
 * dashboard build. Public values only — anything `VITE_*` ships inside the
 * bundle, so server secrets stay in server/.env.
 */

// Fallback extension ID (e.g. for published extension). When opening dashboard from popup we pass the real ID via ?extensionId=
export const EXTENSION_ID_FALLBACK = "fpleipjggoiolomkcnchnlelbjcnoklj";
export const CHROME_WEB_STORE_URL = `https://chromewebstore.google.com/detail/fpleipjggoiolomkcnchnlelbjcnoklj?utm_source=item-share-cb`;
export const DASHBOARD_URL = import.meta.env.VITE_DASHBOARD_URL || "https://www.onextap.com";
export const API_URL = (
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? 'https://www.onextap.com' : '')
).replace(/\/$/, '');
export const ANSWER_STUDIO_MODEL = import.meta.env.VITE_ANSWER_STUDIO_MODEL || "llama-3.3-70b-versatile";
