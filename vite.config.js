import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './extension/manifest.json';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { extensionBuild } from './scripts/releaseManifest.js';

// Chrome extension build → dist/. `npm run build` / `npm run dev:extension`.
// Relative base because extension pages load from chrome-extension://.
//
// ONEXTAP_RELEASE=1 (set by `npm run build:release`) is the store build: →
// dist-release/, with the localhost entries dropped from the manifest
// (scripts/releaseManifest.js). Without it the manifest goes in as it is.
//
// The web dashboard is a separate build: vite.dashboard.config.js → dist-dashboard/,
// which is what vercel.json runs. Nothing deploys this config.
const extension = extensionBuild(manifest, process.env);

export default defineConfig({
  base: './',
  plugins: [
    react(),
    crx({ manifest: extension.manifest }),
  ],
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      port: 5173,
    },
  },
  css: {
    postcss: {
      plugins: [tailwindcss(), autoprefixer()]
    }
  },
  build: {
    outDir: extension.outDir,
    chunkSizeWarningLimit: 1000,
  },
});