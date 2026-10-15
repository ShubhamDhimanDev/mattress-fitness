import {defineConfig, devices} from '@playwright/test';

// End-to-end and accessibility tests. See docs/testing/PLAYWRIGHT_WORKFLOW.md.
// Local default: Chromium desktop and a mobile Chromium profile. Set E2E_ALL_BROWSERS=1 to add
// WebKit and Firefox (needs `npx playwright install webkit firefox`); CI sets it.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;
const allBrowsers = process.env.E2E_ALL_BROWSERS === '1';

// The server Playwright starts reads its store and settings from an env file. `E2E_ENV_FILE` names one (a path
// relative to storefront/, for example `.env.bedding`); unset, the app's default `.env` is used. CI writes
// placeholder files and starts one Playwright run per server configuration (DEV_DATA.md "CI"). The value is
// restricted so it cannot add shell syntax to the command, cannot start with `-` (it would be read as another
// option of the server command) and cannot climb out of storefront/ with a `..` segment. The input is trusted
// (a developer or the CI workflow); this is a guard against typos and accidents, not a security boundary.
const envFile = process.env.E2E_ENV_FILE ?? '';
if (
  envFile !== '' &&
  (!/^[\w./-]+$/.test(envFile) ||
    envFile.startsWith('-') ||
    envFile.split('/').includes('..'))
) {
  throw new Error(
    'E2E_ENV_FILE may only contain letters, digits, _ . / -, must not start with "-" and must not contain a ".." segment',
  );
}
const envFileArg = envFile === '' ? '' : ` --env-file ${envFile}`;

// `E2E_RUN_NAME` (letters, digits, _ -) gives one Playwright invocation its own report and result folders.
// Playwright empties its output folders at the start of every run, so without a name a later run in the same CI
// job would erase the evidence of an earlier failed one. Unset, the folders are the plain defaults.
const runName = process.env.E2E_RUN_NAME ?? '';
if (runName !== '' && !/^[\w-]+$/.test(runName)) {
  throw new Error('E2E_RUN_NAME may only contain letters, digits, _ -');
}
const reportFolder =
  runName === '' ? 'playwright-report' : `playwright-report/${runName}`;
const resultsFolder =
  runName === '' ? './test-results' : `./test-results/${runName}`;
// `E2E_PROD_PREVIEW=1` serves the already built production bundle (run `npm run build` first) instead of the dev
// server, for tests/e2e/b20-production.spec.ts.
const serverCommand =
  process.env.E2E_PROD_PREVIEW === '1'
    ? `npx shopify hydrogen preview --port ${PORT}${envFileArg}`
    : `npm run dev -- --port ${PORT} --disable-version-check${envFileArg}`;

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: resultsFolder,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', {open: 'never', outputFolder: reportFolder}]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: serverCommand,
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
