import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// The extension, loaded unpacked in Chromium, with the website beside it.
// `npm run test:e2e:extension`. Separate from playwright.config.js because
// both halves are pinned: an extension can only be loaded into a persistent
// Chromium context, and the website must be on localhost:5173, the only local
// origin extension/manifest.json lets message the extension.
//
// tests/extension-build.js builds the extension into a temp folder first,
// with unresolvable addresses; the tests stub the account and the API.
// reuseExistingServer is off: a server already on 5173 is most likely
// `npm run dev` with the repo's real .env, and the run stops instead.
export default defineConfig({
  testDir: './tests',
  testMatch: /extension\.spec\.js/,
  timeout: 90000,
  workers: 1,
  reporter: [['list']],
  globalSetup: './tests/extension-build.js',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'off'
  },
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    url: 'http://localhost:5173',
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      VITE_SUPABASE_URL: 'https://e2e.invalid',
      VITE_SUPABASE_ANON_KEY: 'e2e-anon-key',
      VITE_API_URL: ''
    }
  }
});
