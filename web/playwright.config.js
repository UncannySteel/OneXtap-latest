import { defineConfig, devices } from '@playwright/test';

// End-to-end checks for the stage. `npm run test:e2e` starts its own dev
// server on 5190 (or reuses one already running there).
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
    url: 'http://localhost:5190',
    reuseExistingServer: true,
    timeout: 60000
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
