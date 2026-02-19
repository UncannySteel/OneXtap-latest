import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './extension/manifest.json';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

export default defineConfig({
  base: './', // Required for Chrome Extension: relative paths work; absolute "/" causes MIME errors
  plugins: [
    react(),
    crx({ manifest }), // This handles the Chrome Extension build logic
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
  }
});



