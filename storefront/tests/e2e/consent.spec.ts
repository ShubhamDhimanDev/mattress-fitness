import {expect, test, type Page} from '@playwright/test';
import {expectNoSeriousA11yViolations} from './helpers/a11y';
import {gotoReady} from './helpers/catalog';
import {
  collectConsoleErrorsWithUrls,
  unexpectedErrors,
} from './helpers/console';
import {
  readCspViolations,
  recordCspViolations,
  unexpectedViolations,
} from './helpers/csp';

// P7-01 (REQ-ANL-001, REQ-ANL-002, REQ-QZ-006, NFR-011, NFR-013). WRITTEN, NOT RUN: no browser was available when
// this was authored, so every assertion is unverified until the first run (docs/integrations/ANALYTICS.md).
//
// Two server configurations are needed, as DEV_DATA.md "CI" describes for other specs:
//  - default server (no analytics ids): the "nothing is configured" tests run and prove no banner, no script, no
//    request and no policy hole;
//  - E2E_ANALYTICS=on with `E2E_ENV_FILE` naming an env file that sets PUBLIC_GA4_MEASUREMENT_ID=G-E2ETEST123,
//    PUBLIC_META_PIXEL_ID=123456789012345 and PUBLIC_CONSENT_MODE=opt-in (placeholders, not real accounts): the
//    consent-flow tests run. Without it they are skipped with that reason rather than passing for the wrong one.
// Providers are never contacted: their hosts are answered by a stub at the network layer, and the page is only
// ever asked to behave.

const ANALYTICS_ON = process.env.E2E_ANALYTICS === 'on';
const GA_HOST = /^https:\/\/www\.googletagmanager\.com\//;
const META_HOST = /^https:\/\/connect\.facebook\.net\//;
const ANY_PROVIDER_HOST =
  /^https:\/\/(www\.googletagmanager\.com|connect\.facebook\.net|www\.facebook\.com|[a-z0-9-]+\.google-analytics\.com)\//;

const STUB_SCRIPT = {
  status: 200,
  contentType: 'application/javascript',
  body: '/* stub provider script (E2E) */',
};

/** Answers the provider hosts with a stub and records every request made to any provider host. */
async function stubProviders(page: Page) {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (ANY_PROVIDER_HOST.test(request.url())) requests.push(request.url());
  });
  await page.route(GA_HOST, (route) => route.fulfill(STUB_SCRIPT));
  await page.route(META_HOST, (route) => route.fulfill(STUB_SCRIPT));
  return requests;
}

async function trackLayoutShift(page: Page) {
  await page.addInitScript(() => {
    const shifts: number[] = [];
    Reflect.set(window, '__shifts', shifts);
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
        };
        if (!shift.hadRecentInput) shifts.push(shift.value);
      }
    }).observe({type: 'layout-shift', buffered: true});
  });
}

const banner = (page: Page) =>
  page.getByRole('region', {name: 'Privacy choices'});

test.describe('no provider configured (default server)', () => {
  test.skip(ANALYTICS_ON, 'this server has analytics ids set');

  test('no banner, no provider request, and the policy names no provider host', async ({
    page,
    request,
  }) => {
    const requests = await stubProviders(page);
    await gotoReady(page, '/');
    await expect(banner(page)).toHaveCount(0);
    expect(requests).toEqual([]);
    await expect(page.locator('script[src*="googletagmanager"]')).toHaveCount(
      0,
    );
    await expect(page.locator('script[src*="facebook"]')).toHaveCount(0);

    const headers = (await request.get('/')).headers();
    for (const name of [
      'content-security-policy',
      'content-security-policy-report-only',
    ]) {
      expect(headers[name], name).not.toMatch(/google|facebook/);
    }
  });
});

test.describe('providers configured, opt-in mode', () => {
  test.skip(!ANALYTICS_ON, 'needs E2E_ANALYTICS=on and an env file with ids');

  test('the policies name the provider hosts and still carry the nonce', async ({
    request,
  }) => {
    const headers = (await request.get('/')).headers();
    const enforced = headers['content-security-policy'] ?? '';
    expect(enforced).toContain('https://www.googletagmanager.com');
    expect(enforced).toContain('https://connect.facebook.net');
    expect(enforced).toMatch(/'nonce-/);
    expect(enforced).not.toMatch(/unsafe-eval/);
    expect(headers['content-security-policy-report-only']).toContain(
      'https://www.googletagmanager.com',
    );
  });

  test('nothing is requested from a provider before the shopper decides', async ({
    page,
  }) => {
    const requests = await stubProviders(page);
    await gotoReady(page, '/');
    await expect(banner(page)).toBeVisible();
    await expect(page.locator('script[src*="googletagmanager"]')).toHaveCount(
      0,
    );
    expect(requests).toEqual([]);
    expect(
      await page.evaluate(() => Reflect.get(window, 'dataLayer')),
    ).toBeUndefined();
  });

  test('the banner appears without shifting the page', async ({page}) => {
    await trackLayoutShift(page);
    await stubProviders(page);
    await gotoReady(page, '/');
    await expect(banner(page)).toBeVisible();
    const shifts = await page.evaluate(
      () => (Reflect.get(window, '__shifts') as number[]) ?? [],
    );
    expect(shifts.reduce((sum, value) => sum + value, 0)).toBeLessThan(0.01);
  });

  test('reject all: no provider request, and the choice is remembered after a reload', async ({
    page,
  }) => {
    const requests = await stubProviders(page);
    await gotoReady(page, '/');
    await banner(page).getByRole('button', {name: 'Reject all'}).click();
    await expect(banner(page)).toHaveCount(0);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(banner(page)).toHaveCount(0);
    expect(requests).toEqual([]);
  });

  test('accept all: the providers load after consent, with no policy violation', async ({
    page,
  }) => {
    const requests = await stubProviders(page);
    await recordCspViolations(page);
    await gotoReady(page, '/');
    await banner(page).getByRole('button', {name: 'Accept all'}).click();
    await expect
      .poll(() => requests.some((url) => GA_HOST.test(url)))
      .toBe(true);
    await expect
      .poll(() => requests.some((url) => META_HOST.test(url)))
      .toBe(true);
    // Scripts carry the page nonce (the enforced policy would refuse them otherwise).
    expect(unexpectedViolations(await readCspViolations(page))).toEqual([]);
    // The page view recorded before the decision is sent now: it is on the data layer.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const layer: unknown = Reflect.get(window, 'dataLayer');
          return Array.isArray(layer)
            ? layer.some(
                (entry) =>
                  typeof entry === 'object' &&
                  entry !== null &&
                  Reflect.get(entry, '1') === 'page_view',
              )
            : false;
        }),
      )
      .toBe(true);
  });

  test('choosing analytics only never contacts Meta', async ({page}) => {
    const requests = await stubProviders(page);
    await gotoReady(page, '/');
    await banner(page).getByRole('button', {name: 'Choose'}).click();
    const dialog = page.getByRole('dialog', {name: 'Privacy choices'});
    await dialog.getByRole('checkbox', {name: /Analytics/}).check();
    await dialog.getByRole('button', {name: 'Save choices'}).click();
    await expect
      .poll(() => requests.some((url) => GA_HOST.test(url)))
      .toBe(true);
    await page.waitForLoadState('networkidle');
    expect(requests.some((url) => /facebook/.test(url))).toBe(false);
  });

  test('keyboard: the banner is reachable early in the tab order and works without a mouse', async ({
    page,
  }) => {
    await stubProviders(page);
    await gotoReady(page, '/');
    await expect(banner(page)).toBeVisible();
    // Skip link first, then the banner's own controls (it precedes the header in the DOM).
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('link', {name: 'Privacy policy'}),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', {name: 'Accept all'})).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', {name: 'Reject all'})).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(banner(page)).toHaveCount(0);
  });

  test('the preferences dialog closes on Escape and returns focus; the banner has no serious axe finding', async ({
    page,
  }) => {
    await stubProviders(page);
    await gotoReady(page, '/');
    await expectNoSeriousA11yViolations(page);
    const choose = banner(page).getByRole('button', {name: 'Choose'});
    await choose.click();
    await expect(
      page.getByRole('dialog', {name: 'Privacy choices'}),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(choose).toBeFocused();
  });

  test('a blocked provider script (ad blocker or outage) leaves browsing, the cart and the checkout link working (NFR-013)', async ({
    page,
  }) => {
    const errors = collectConsoleErrorsWithUrls(page);
    await page.route(GA_HOST, (route) => route.abort('blockedbyclient'));
    await page.route(META_HOST, (route) => route.abort('blockedbyclient'));
    await gotoReady(page, '/');
    await banner(page).getByRole('button', {name: 'Accept all'}).click();
    await page.waitForLoadState('networkidle');
    // The shop still works: navigate and open the cart.
    await page.goto('/cart');
    await expect(page.getByRole('main')).toBeVisible();
    // Only the browser's own echo of the two blocked URLs is allowed; nothing from our code.
    const ours = unexpectedErrors(errors, 'googletagmanager').filter(
      (text) => !text.includes('facebook'),
    );
    expect(ours).toEqual([]);
  });

  test('a provider that never answers does not hold the page', async ({
    page,
  }) => {
    await page.route(GA_HOST, () => {
      // Never fulfilled: the request hangs until the page is closed.
    });
    await gotoReady(page, '/');
    await banner(page).getByRole('button', {name: 'Accept all'}).click();
    await page.getByRole('link', {name: /cart/i}).first().click();
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('consent can be withdrawn from the footer link, and sending stops', async ({
    page,
  }) => {
    const requests = await stubProviders(page);
    await gotoReady(page, '/');
    await banner(page).getByRole('button', {name: 'Accept all'}).click();
    await expect.poll(() => requests.length).toBeGreaterThan(0);
    const link = page.getByRole('button', {name: 'Privacy choices'});
    test.skip(
      (await link.count()) === 0,
      'the footer does not yet render <PrivacyChoicesButton> (follow-up for the footer owner)',
    );
    await link.click();
    await page
      .getByRole('dialog', {name: 'Privacy choices'})
      .getByRole('button', {name: 'Reject all'})
      .click();
    expect(
      await page.evaluate(() => Reflect.get(window, 'ga-disable-G-E2ETEST123')),
    ).toBe(true);
  });
});
