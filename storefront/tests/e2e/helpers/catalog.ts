import {expect, type Page} from '@playwright/test';

/** Navigates and waits until the page has hydrated, so clicks reach React handlers. */
export async function gotoReady(page: Page, url: string) {
  const response = await page.goto(url);
  await page.waitForLoadState('networkidle');
  return response;
}

/** No horizontal scroll at the current viewport (NFR-001). */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(0);
}

/**
 * Path of the first collection the connected store has. Specs run against whatever store is configured
 * (mock.shop, bedding.mock.shop or the development store), so they assert structure every store has
 * instead of fixed handles.
 */
export async function firstCollectionPath(page: Page): Promise<string> {
  await gotoReady(page, '/collections');
  const href = await page
    .locator('main a[href^="/collections/"]')
    .first()
    .getAttribute('href');
  expect(href, 'the store has at least one collection').toBeTruthy();
  return href ?? '/collections/all';
}

/** Path of the first product shown on a listing page. */
export async function firstProductPath(page: Page, listing: string) {
  await gotoReady(page, listing);
  const href = await page
    .locator('article a[href^="/products/"]')
    .first()
    .getAttribute('href');
  expect(href, 'the listing shows at least one product').toBeTruthy();
  return href ?? '/products/none';
}

/**
 * Console errors that come from our code. Shopify's own performance telemetry
 * (otlp-http-production.shopifysvc.com) is refused by our Content Security Policy in development; it is
 * not part of this work package, so it is left out of the assertion.
 */
export function ourErrors(errors: readonly string[]): string[] {
  return errors.filter((message) => !message.includes('shopifysvc.com'));
}

/** Marks the document so a test can prove that a later action did not reload the page. */
export async function markPage(page: Page) {
  await page.evaluate(() => {
    document.documentElement.dataset.e2eMarker = '1';
  });
}

export async function expectPageNotReloaded(page: Page) {
  await expect(page.locator('html')).toHaveAttribute('data-e2e-marker', '1');
}
