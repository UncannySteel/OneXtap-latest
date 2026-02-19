import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import tailwindConfig from './tailwind.config.js';

// Separate config for building dashboard as standalone website
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
