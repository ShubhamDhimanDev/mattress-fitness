import {defineConfig, devices} from '@playwright/test';

// End-to-end and accessibility tests. See docs/testing/PLAYWRIGHT_WORKFLOW.md.
// Local default: Chromium desktop and a mobile Chromium profile. Set E2E_ALL_BROWSERS=1 to add
// WebKit and Firefox (needs `npx playwright install webkit firefox`); CI sets it.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;
const allBrowsers = process.env.E2E_ALL_BROWSERS === '1';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['list'],
    ['html', {open: 'never', outputFolder: 'playwright-report'}],
  ],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: `npm run dev -- --port ${PORT} --disable-version-check`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: {...devices['Desktop Chrome'], viewport: {width: 1280, height: 800}},
    },
    {name: 'mobile-chromium', use: {...devices['Pixel 7']}},
    ...(allBrowsers
      ? [
          {name: 'desktop-webkit', use: {...devices['Desktop Safari']}},
          {name: 'mobile-webkit', use: {...devices['iPhone 14']}},
          {name: 'desktop-firefox', use: {...devices['Desktop Firefox']}},
        ]
      : []),
  ],
});
