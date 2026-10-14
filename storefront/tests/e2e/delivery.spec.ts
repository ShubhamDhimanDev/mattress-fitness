import {expect, test, type Page} from '@playwright/test';
import {
  collectConsoleErrors,
  expectNoSeriousA11yViolations,
} from './helpers/a11y';
import {
  expectNoHorizontalScroll,
  findProduct,
  firstCollectionPath,
  firstProductPath,
  gotoReady,
  isPurchasable,
  ourErrors,
} from './helpers/catalog';

// P3B-11 (ZIP cookie, server-side read), P5B-03 (product-page promise): REQ-NAV-003, REQ-DEL-001,
// REQ-DEL-002, T-05. Needs a delivery zone in the server configuration, so it runs against a dev server
// started with OFFER_CONFIG_JSON that has a `zone` (see DEV_DATA.md, "Delivery ZIP"). The zone used here
// covers 606* and 60007. Without a zone the page says nothing about delivery (by design), and this spec
// skips with that reason instead of passing vacuously.
//
// The haul-away and delivery-choice steps need Storefront `nodes(ids)` lookups that mock.shop cannot answer,
// so they are covered by tests/unit/routes/delivery-routes.test.ts and need a development store (V-06, V-17).

const IN_ZONE = '60645';
const OUT_OF_ZONE = '90210';

// A plain request, not a navigation, so the check cannot race the test's own first page load.
async function zoneIsConfigured(page: Page): Promise<boolean> {
  const response = await page.request.get('/delivery');
  return !(await response.text()).includes(
    'Delivery information is not available right now.',
  );
}

test.beforeEach(async ({page}) => {
  test.skip(
    !(await zoneIsConfigured(page)),
    'no delivery zone in the server configuration (OFFER_CONFIG_JSON); see DEV_DATA.md',
  );
});

async function productPage(page: Page): Promise<string> {
  const listing = await firstCollectionPath(page);
  const path = await firstProductPath(page, listing);
  await gotoReady(page, path);
  return path;
}

function deliveryRegion(page: Page) {
  // Exact name: other regions on the page (the delivery and warranty section) also mention delivery.
  return page.getByRole('region', {name: 'Delivery', exact: true});
}

async function saveZip(page: Page, zip: string) {
  const region = deliveryRegion(page);
  await region.getByRole('textbox', {name: 'ZIP code'}).fill(zip);
  const answered = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.startsWith('/delivery') &&
      response.request().method() === 'POST',
  );
  await region.getByRole('button', {name: 'Check delivery'}).click();
  await answered;
}

test.describe('product page delivery promise (REQ-DEL-002)', () => {
  test('asks for a ZIP, says yes inside the zone with the approved wording, and remembers it', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    const path = await productPage(page);
    const region = deliveryRegion(page);
    await expect(region.getByRole('textbox', {name: 'ZIP code'})).toBeVisible();

    await saveZip(page, IN_ZONE);
    await expect(
      region.getByText(`In-home delivery is available to ${IN_ZONE}.`),
    ).toBeVisible();
    await expect(
      region.getByText('Free in-home delivery and setup for your area.'),
    ).toBeVisible();
    // The ZIP is a POST field and a cookie, never part of the address.
    expect(page.url()).not.toContain(IN_ZONE);

    // Reload and a fresh navigation both read it back from the server.
    await gotoReady(page, path);
    await expect(
      deliveryRegion(page).getByText(
        `In-home delivery is available to ${IN_ZONE}.`,
      ),
    ).toBeVisible();
    expect(ourErrors(errors)).toEqual([]);
  });

  test('says no outside the zone, with no promise text', async ({page}) => {
    await productPage(page);
    await saveZip(page, OUT_OF_ZONE);
    const region = deliveryRegion(page);
    await expect(
      region.getByText(`In-home delivery is not available to ${OUT_OF_ZONE}.`),
    ).toBeVisible();
    await expect(
      region.getByText('Free in-home delivery and setup for your area.'),
    ).toHaveCount(0);
  });

  test('rejects an invalid ZIP inline and sends nothing', async ({page}) => {
    await productPage(page);
    const posts: string[] = [];
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        new URL(request.url()).pathname.startsWith('/delivery')
      ) {
        posts.push(request.url());
      }
    });
    const region = deliveryRegion(page);
    await region.getByRole('textbox', {name: 'ZIP code'}).fill('12');
    await region.getByRole('button', {name: 'Check delivery'}).click();
    await expect(
      region.getByText('Enter a 5-digit US ZIP code.'),
    ).toBeVisible();
    await expect(
      region.getByRole('textbox', {name: 'ZIP code'}),
    ).toHaveAttribute('aria-invalid', 'true');
    expect(posts).toEqual([]);
  });

  test('changing and clearing the ZIP updates the answer', async ({page}) => {
    await productPage(page);
    await saveZip(page, IN_ZONE);
    const region = deliveryRegion(page);
    await region.getByRole('button', {name: 'Change ZIP code'}).click();
    await expect(region.getByRole('textbox', {name: 'ZIP code'})).toBeFocused();
    await saveZip(page, OUT_OF_ZONE);
    await expect(
      region.getByText(`In-home delivery is not available to ${OUT_OF_ZONE}.`),
    ).toBeVisible();

    await region.getByRole('button', {name: 'Clear'}).click();
    await expect(region.getByRole('textbox', {name: 'ZIP code'})).toBeVisible();
    await expect(region.getByText(/available to/)).toHaveCount(0);
  });

  test('the cookie is HttpOnly, SameSite and signed, and the endpoint is private and uncached (T-05)', async ({
    page,
    context,
  }) => {
    await productPage(page);
    await saveZip(page, IN_ZONE);
    const cookies = await context.cookies();
    const zipCookie = cookies.find((cookie) => cookie.name === 'delivery_zip');
    expect(zipCookie, 'the ZIP cookie was set').toBeDefined();
    expect(zipCookie?.httpOnly).toBe(true);
    expect(zipCookie?.sameSite).toBe('Lax');
    // The value is signed, not the bare ZIP.
    expect(zipCookie?.value).not.toBe(IN_ZONE);
    expect(zipCookie?.value).toContain('.');
    expect(await page.evaluate(() => document.cookie)).not.toContain(
      'delivery_zip',
    );
    expect(
      await page.evaluate(() =>
        JSON.stringify({...localStorage, ...sessionStorage}),
      ),
    ).not.toContain(IN_ZONE);

    const response = await page.request.get('/delivery.data');
    expect(response.headers()['cache-control']).toBe('private, no-store');
  });

  test('a forged, unsigned cookie is not believed', async ({page, context}) => {
    const path = await productPage(page);
    await context.addCookies([
      {name: 'delivery_zip', value: IN_ZONE, url: new URL(page.url()).origin},
    ]);
    await gotoReady(page, path);
    await expect(
      deliveryRegion(page).getByRole('textbox', {name: 'ZIP code'}),
    ).toBeVisible();
    await expect(deliveryRegion(page).getByText(/available to/)).toHaveCount(0);
  });

  test('has no serious accessibility violations and no horizontal scroll', async ({
    page,
  }) => {
    await productPage(page);
    await saveZip(page, IN_ZONE);
    await expectNoSeriousA11yViolations(page);
    await expectNoHorizontalScroll(page);
  });
});

test.describe('without JavaScript (REQ-NAV-003)', () => {
  test.use({javaScriptEnabled: false});

  test('the form posts to /delivery and the answer is shown there', async ({
    page,
  }) => {
    await page.goto('/delivery');
    await page.getByRole('textbox', {name: 'ZIP code'}).fill(IN_ZONE);
    await page.getByRole('button', {name: 'Check delivery'}).click();
    await expect(
      page.getByText(`In-home delivery is available to ${IN_ZONE}.`),
    ).toBeVisible();
    expect(page.url()).not.toContain(IN_ZONE);
  });

  test('an invalid ZIP shows the error', async ({page}) => {
    await page.goto('/delivery');
    await page.getByRole('textbox', {name: 'ZIP code'}).fill('abc');
    await page.getByRole('button', {name: 'Check delivery'}).click();
    await expect(page.getByText('Enter a 5-digit US ZIP code.')).toBeVisible();
  });
});

test.describe('cart page (P3B-11, P5B-04)', () => {
  test('offers the same control and shares the saved ZIP', async ({page}) => {
    const listing = await firstCollectionPath(page);
    const product = await findProduct(page, listing, 'buyable', isPurchasable);
    await gotoReady(page, product);
    await saveZip(page, IN_ZONE);

    const answered = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.startsWith('/cart') &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', {name: 'Add to cart'}).click();
    await answered;

    await gotoReady(page, '/cart');
    const region = deliveryRegion(page);
    await expect(
      region.getByText(`In-home delivery is available to ${IN_ZONE}.`),
    ).toBeVisible();
  });
});
