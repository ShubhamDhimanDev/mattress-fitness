import {expect, type Page} from '@playwright/test';
import {isBlockedTelemetryRefusal} from './a11y';

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
 * The one console error we accept from the demo stores: mock.shop and bedding.mock.shop price in CAD, and
 * the Price component (NFR-008, USD only) refuses to format a non-USD amount and logs this message instead.
 * It cannot occur on the client's USD store (P3A-01); delete this entry then. Every other console error is
 * ours and fails the spec.
 */
const MOCK_SHOP_CAD_LOG = 'Only USD is supported, got CAD';

export function ourErrors(errors: readonly string[]): string[] {
  return errors.filter(
    (message) =>
      // Only the exact telemetry host Shopify's consent script posts to, and only as a CSP refusal (DEC-045).
      !message.includes(MOCK_SHOP_CAD_LOG) &&
      !isBlockedTelemetryRefusal(message),
  );
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

/** Product paths linked from a listing page, in order, without repeats (first page only). */
export async function productPathsOn(page: Page, listing: string) {
  await gotoReady(page, listing);
  const hrefs = await page
    .locator('article a[href^="/products/"]')
    .evaluateAll((links) =>
      links.flatMap((link) => {
        const href = link.getAttribute('href');
        return href ? [href] : [];
      }),
    );
  return [...new Set(hrefs)];
}

/**
 * The first product in the listing whose page satisfies `wanted`. A spec that needs a particular kind of
 * product (a buyable one, one with two sizes, one with a gallery) calls this instead of skipping when the
 * first product is not that kind, so the same spec runs on every store. It fails, loudly, when no product on
 * the first page qualifies: that means the store is missing data the spec exists to check.
 */
export async function findProduct(
  page: Page,
  listing: string,
  description: string,
  wanted: (page: Page) => Promise<boolean>,
): Promise<string> {
  const paths = await productPathsOn(page, listing);
  expect(paths.length, `${listing} lists products`).toBeGreaterThan(0);
  for (const path of paths) {
    // The server-rendered page has everything the predicates read; no need to wait for hydration here.
    await page.goto(path, {waitUntil: 'domcontentloaded'});
    if (await wanted(page)) return path;
  }
  throw new Error(
    `No product on ${listing} is ${description} (checked ${paths.length}). The connected store lacks data this spec needs.`,
  );
}

export async function isPurchasable(page: Page) {
  const button = page.getByRole('button', {name: 'Add to cart'});
  return (await button.count()) > 0 && (await button.first().isEnabled());
}

export async function hasSizes(page: Page, atLeast: number) {
  const sizes = page.getByRole('group', {name: /^Size/});
  if ((await sizes.count()) === 0) return false;
  return (
    (await sizes.locator('input[type="radio"]:enabled').count()) >= atLeast
  );
}

export async function hasGallery(page: Page) {
  return (await page.getByRole('button', {name: 'Next image'}).count()) > 0;
}
