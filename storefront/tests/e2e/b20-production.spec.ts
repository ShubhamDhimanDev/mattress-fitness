import {expect, test, type Page, type Route} from '@playwright/test';
import {collectConsoleErrors} from './helpers/a11y';
import {
  findProduct,
  firstCollectionPath,
  gotoReady,
  isPurchasable,
  ourErrors,
} from './helpers/catalog';

// REQ-CART-001 / B-20 on a PRODUCTION build: a refusal returned by the cart action must be visible to the shopper.
// The unit tests (tests/unit/ui/CartMessages.test.tsx) prove it against a real data router; this spec proves it in a
// browser against the built server bundle, where React StrictMode is off and the dev server is not involved.
//
// Run it only against a production preview. From storefront/:
//   npm run build
//   npx shopify hydrogen preview --port 4400 --env-file .env.prodpreview     (see DEV_DATA.md, "Production preview")
//   E2E_PROD_PREVIEW=1 E2E_PORT=4400 npx playwright test tests/e2e/b20-production.spec.ts
// The refusal is real: the request leaves the browser with a forged quantity (rewritten in flight, the way a hostile
// client would), and the server's own validation (T-01, `validateAddLines` / `validateUpdateLines`) answers 400.

const PROD_PREVIEW = process.env.E2E_PROD_PREVIEW === '1';
const ADD_REFUSED = 'Invalid item or quantity.';
const UPDATE_REFUSED = 'Invalid line or quantity.';
// Chromium's own console line for any 4xx answer; expected exactly once for the one forged request.
const REFUSED_RESOURCE_LOG = /status of 400/;

function isCartPost(url: string, method: string) {
  const path = new URL(url).pathname;
  return method === 'POST' && (path === '/cart' || path === '/cart.data');
}

/**
 * Rewrites the next cart POST so every line carries an over-limit quantity (500; the server accepts 1 to 99).
 * Later posts pass through untouched, so the same page can then make a valid request.
 */
/** The cart form input is {action, inputs: {lines: [...]}}; this finds the lines without trusting the shape. */
function linesOf(parsed: unknown): Record<string, unknown>[] {
  if (typeof parsed !== 'object' || parsed === null || !('inputs' in parsed)) {
    return [];
  }
  const {inputs} = parsed;
  if (typeof inputs !== 'object' || inputs === null || !('lines' in inputs)) {
    return [];
  }
  const {lines} = inputs;
  return Array.isArray(lines)
    ? lines.filter(
        (line): line is Record<string, unknown> =>
          typeof line === 'object' && line !== null,
      )
    : [];
}

async function forgeNextCartPost(page: Page) {
  let forged = 0;
  await page.route(
    (url) => url.pathname === '/cart' || url.pathname === '/cart.data',
    async (route: Route) => {
      const request = route.request();
      if (!isCartPost(request.url(), request.method()) || forged > 0) {
        await route.continue();
        return;
      }
      const form = new URLSearchParams(request.postData() ?? '');
      const raw = form.get('cartFormInput');
      if (raw === null) {
        await route.continue();
        return;
      }
      const parsed: unknown = JSON.parse(raw);
      for (const line of linesOf(parsed)) line.quantity = 500;
      form.set('cartFormInput', JSON.stringify(parsed));
      forged += 1;
      await route.continue({postData: form.toString()});
    },
  );
  return () => forged;
}

async function openBuyableProduct(page: Page) {
  const listing = await firstCollectionPath(page);
  const product = await findProduct(page, listing, 'buyable', isPurchasable);
  await gotoReady(page, product);
  return product;
}

function answerOf(page: Page) {
  return page.waitForResponse((response) =>
    isCartPost(response.url(), response.request().method()),
  );
}

test.describe('B-20 cart refusals are visible on a production build (REQ-CART-001)', () => {
  test.skip(
    !PROD_PREVIEW,
    'needs a production preview server (npm run build, then shopify hydrogen preview) and E2E_PROD_PREVIEW=1; see this file and DEV_DATA.md',
  );

  // Each test visits a listing, several product pages and the cart on a live mock store; 30 s is too tight with four workers.
  test.setTimeout(90_000);

  test('the server is a production build, not the dev server', async ({
    page,
  }) => {
    const response = await page.goto('/');
    const html = (await response?.text()) ?? '';
    // The Vite dev server injects its client; a build serves hashed files from /assets and never injects it.
    expect(html).not.toContain('/@vite/client');
    expect(html).toContain('/assets/');
  });

  test('Add to cart refused by the server (forged quantity) shows a visible alert', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await openBuyableProduct(page);
    const forgedCount = await forgeNextCartPost(page);

    const answered = answerOf(page);
    await page.getByRole('button', {name: 'Add to cart'}).click();
    const response = await answered;

    expect(forgedCount(), 'the request was forged in flight').toBe(1);
    expect(response.status()).toBe(400);
    // The refusal text is not read from the response body (Chromium sometimes evicts a fetch body before Playwright can
    // read it, which made this test flaky): the alert below carries exactly that text, so it proves the body too.
    // The shopper SEES it, in a live alert region (the product page and the drawer each have one).
    await expect(
      page.getByRole('alert').filter({hasText: ADD_REFUSED}).first(),
    ).toBeVisible();
    // Nothing was added: no cart line, and no optimistic "1 item" left on the header cart link.
    await expect(page.getByRole('list', {name: 'Cart items'})).toHaveCount(0);
    await expect(
      page.getByRole('link', {name: /^Cart/}),
    ).not.toHaveAccessibleName(/\d+ items?/);
    // The browser logs the refused request itself (one line per refusal); nothing from our code beyond that.
    expect(
      ourErrors(errors).filter(
        (message) => !REFUSED_RESOURCE_LOG.test(message),
      ),
    ).toEqual([]);
    await expect
      .poll(
        () =>
          ourErrors(errors).filter((message) =>
            REFUSED_RESOURCE_LOG.test(message),
          ).length,
      )
      .toBe(1);
  });

  test('a later successful add clears the refusal', async ({page}) => {
    await openBuyableProduct(page);
    await forgeNextCartPost(page);
    const refused = answerOf(page);
    await page.getByRole('button', {name: 'Add to cart'}).click();
    expect((await refused).status()).toBe(400);
    await expect(
      page.getByRole('alert').filter({hasText: ADD_REFUSED}).first(),
    ).toBeVisible();

    // The drawer opened on the first click; close it so the product page button is reachable again.
    await page.keyboard.press('Escape');
    const accepted = answerOf(page);
    await page.getByRole('button', {name: 'Add to cart'}).click();
    expect((await accepted).status()).toBe(200);
    await expect(page.getByRole('list', {name: 'Cart items'})).toBeVisible();
    await expect(
      page.getByRole('alert').filter({hasText: ADD_REFUSED}),
    ).toHaveCount(0);
  });

  test('a quantity change refused on the cart page shows a visible alert and leaves the line alone', async ({
    page,
  }) => {
    await openBuyableProduct(page);
    const added = answerOf(page);
    await page.getByRole('button', {name: 'Add to cart'}).click();
    expect((await added).status()).toBe(200);
    await page.keyboard.press('Escape');

    await gotoReady(page, '/cart');
    const quantity = page.getByRole('textbox', {name: /^Quantity/});
    await expect(quantity).toHaveValue('1');
    const forgedCount = await forgeNextCartPost(page);
    const answered = answerOf(page);
    await page.getByRole('button', {name: /^Increase quantity/}).click();
    const response = await answered;

    expect(forgedCount()).toBe(1);
    expect(response.status()).toBe(400);
    await expect(
      page.getByRole('alert').filter({hasText: UPDATE_REFUSED}).first(),
    ).toBeVisible();
    // The refusal changed nothing on the server: a reload shows the original quantity.
    await gotoReady(page, '/cart');
    await expect(page.getByRole('textbox', {name: /^Quantity/})).toHaveValue(
      '1',
    );
  });
});
