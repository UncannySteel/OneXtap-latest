import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// End-to-end checks for the stage. `npm run test:e2e` starts its own dev
// server on 5190 (or reuses one already running there).
//
// The account and the API are stubbed in the tests themselves (see
// tests/stubs.js). The server is also started with a Supabase address that
// cannot resolve (.invalid is reserved, RFC 2606), so a request a test forgot
// to stub fails instead of reaching a real project. Variables set here win
// over the repo's .env: Vite reads the process environment first.
export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.js/,
  timeout: 60000,
  fullyParallel: false,
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5190',
    trace: 'off'
  },
  webServer: {
    command: 'npm run dev -- --port 5190 --strictPort',
    // The repo root: `npm run dev` is its script, and web/ has no package.json.
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    url: 'http://localhost:5190',
    reuseExistingServer: true,
    timeout: 60000,
    env: {
      VITE_SUPABASE_URL: 'https://e2e.invalid',
      VITE_SUPABASE_ANON_KEY: 'e2e-anon-key',
      // Same origin, so /api/feedback is answered by the test's route.
      VITE_API_URL: ''
    }
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'chromium-phone', use: { ...devices['Pixel 7'] } },
    // Playwright's WebKit on Windows renders in software and manages a few
    // frames a second on the feature deck (the original page did too), so it
    // runs at 1x; the tests that wait on animation allow for that.
    { name: 'webkit-desktop', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } }
  ]
});
