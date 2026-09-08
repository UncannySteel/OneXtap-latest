import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import tailwindConfig from './tailwind.config.js';

// Web dashboard build → dist-dashboard/. `npm run build:dashboard`, and the
// buildCommand vercel.json runs on deploy. No crx() plugin and no extension
// APIs — the same React app detects at runtime that chrome.* is absent.
// The extension build is the separate vite.config.js.
export default defineConfig({
  plugins: [
    react(),
  ],
  build: {
    outDir: 'dist-dashboard',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: './index.html',
        privacy: './privacy-policy.html',
      },
    },
  },
  css: {
    postcss: {
      plugins: [tailwindcss(tailwindConfig), autoprefixer()]
    }
  },
  base: '/', // Adjust if deploying to a subdirectory
});
