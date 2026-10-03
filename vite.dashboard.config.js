import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

// The website build → dist-dashboard/. `npm run build:dashboard`, and the
// buildCommand vercel.json runs on deploy (the name and the output directory
// are kept from when this built only the dashboard, so the Vercel project
// needs no change). `npm run dev` serves the same pages.
//
// One site, one origin:
//   /                              the landing page    (web/index.html, web/src/)
//   /about/ /contact/ /privacy/    its company pages
//   /dashboard/                    the dashboard       (web/dashboard/)
//   /dashboard/contact/ …/privacy/ the dashboard's company pages
//   /api/*                         the Express app     (api/index.js → server/)
//
// Same origin is what lets the landing page's sign-in carry straight into the
// dashboard: the Supabase session lives in localStorage, which is per origin.
//
// Plain JS on both — no React, no Tailwind. The extension popup is the other
// build (vite.config.js) and keeps both.
export default defineConfig({
  root: here('./web'),
  base: '/',
  // The one .env at the repo root serves both builds (VITE_SUPABASE_URL …).
  envDir: here('.'),
  publicDir: here('./web/public'),
  resolve: {
    // The modules the dashboard shares with the popup and the server:
    // profile + resume stores, auth, credits, matching (src/, see
    // docs/repo-structure.md).
    alias: { '@app': here('./src') },
  },
  // An inline config stops Vite picking up the popup's Tailwind setup from
  // postcss.config.js at the repo root.
  css: { postcss: { plugins: [] } },
  server: {
    // 5173 on purpose: it is the local origin extension/manifest.json lets
    // talk to the extension (externally_connectable), and the dashboard's
    // profile sync depends on that.
    port: 5173,
    strictPort: true,
    fs: { allow: [here('.')] },
  },
  preview: { port: 5173, strictPort: true },
  build: {
    outDir: here('./dist-dashboard'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: here('./web/index.html'),
        about: here('./web/about/index.html'),
        contact: here('./web/contact/index.html'),
        privacy: here('./web/privacy/index.html'),
        dashboard: here('./web/dashboard/index.html'),
        dashboardContact: here('./web/dashboard/contact/index.html'),
        dashboardPrivacy: here('./web/dashboard/privacy/index.html'),
        // dist-dashboard/404.html, which Vercel serves for any unknown address.
        notFound: here('./web/404.html'),
      },
    },
  },
});
