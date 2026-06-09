import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './extension/manifest.json';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

// Set BUILD_TARGET=web in Vercel environment variables.
// Extension build (default, no env var): includes crx() plugin + relative base.
// Web build (BUILD_TARGET=web): standard Vite SPA, no extension assumptions.
const isWebBuild = process.env.BUILD_TARGET === 'web';

export default defineConfig({
  base: isWebBuild ? '/' : './',
  plugins: [
    react(),
    ...(isWebBuild ? [] : [crx({ manifest })]),
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