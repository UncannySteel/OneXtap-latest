import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './extension/manifest.json';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

// Chrome extension build → dist/. `npm run build` / `npm run dev`.
// Relative base because extension pages load from chrome-extension://.
//
// The web dashboard is a separate build: vite.dashboard.config.js → dist-dashboard/,
// which is what vercel.json runs. Nothing deploys this config.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    crx({ manifest }),
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
    chunkSizeWarningLimit: 1000,
  },
});