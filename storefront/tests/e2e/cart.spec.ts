import {expect, test, type Page} from '@playwright/test';
import {
  collectConsoleErrors,
  expectNoSeriousA11yViolations,
} from './helpers/a11y';
import {
  ourErrors,
  expectNoHorizontalScroll,
  firstCollectionPath,
  firstProductPath,
  gotoReady,
} from './helpers/catalog';

// REQ-CART-001 cart drawer and page, REQ-CHK-001 hand-off link, and the T-01 / T-08 negative cases.
// These add to a real cart on the connected (mock or development) store and stop before checkout.

async function addFirstProduct(page: Page) {
  const listing = await firstCollectionPath(page);
  await gotoReady(page, await firstProductPath(page, listing));
  const add = page.getByRole('button', {name: 'Add to cart'});
  test.skip((await add.count()) === 0, 'The first product is sold out.');
  // Shopify's answer, not just the optimistic line, so later steps (reload, remove) see a real cart.
  const answered = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.startsWith('/cart') &&
      response.request().method() === 'POST',
  );
  await add.click();
  await answered;
  const drawer = page.getByRole('dialog', {name: 'Cart'});
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('list', {name: 'Cart items'})).toBeVisible();
  return drawer;
}

test.describe('cart drawer (REQ-CART-001)', () => {
  test('Add to cart opens the drawer with the line and a checkout link', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    const drawer = await addFirstProduct(page);

    await expect(drawer.getByRole('listitem').first()).toBeVisible();
    await expect(drawer.getByText('Subtotal')).toBeVisible();
    // The hand-off is a plain https link to Shopify's hosted checkout (REQ-CHK-001, ADR-0003).
    await expect(drawer.getByRole('link', {name: 'Checkout'})).toHaveAttribute(
      'href',
      /^https:\/\//,
    );
    expect(ourErrors(errors)).toEqual([]);
  });

  test('quantity changes and removal update the cart; removing the last line shows the empty state', async ({
    page,
  }) => {
    const drawer = await addFirstProduct(page);
    const increase = drawer.getByRole('button', {name: /^Increase quantity/});
    await increase.click();
    await expect(drawer.getByRole('textbox', {name: /^Quantity/})).toHaveValue(
      '2',
    );

    await drawer.getByRole('button', {name: /^Remove .* from cart/}).click();
    await expect(
      drawer.getByRole('heading', {name: 'Your cart is empty'}),
    ).toBeVisible();
  });

  test('the drawer closes with Escape', async ({page}) => {
    const drawer = await addFirstProduct(page);
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
  });
});

test.describe('cart page (REQ-CART-001)', () => {
  test('shows the empty state for a new visitor', async ({page}) => {
    await gotoReady(page, '/cart');
    await expect(page.getByRole('heading', {level: 1})).toHaveText('Your cart');
    await expect(
      page.getByRole('heading', {name: 'Your cart is empty'}),
    ).toBeVisible();
    await expect(
      page.getByRole('link', {name: 'Continue shopping'}),
    ).toBeVisible();
  });

  test('keeps the cart after a reload and has no serious accessibility violations', async ({
    page,
  }) => {
    await addFirstProduct(page);
    await page.keyboard.press('Escape');
    await gotoReady(page, '/cart');
    await expect(page.getByRole('list', {name: 'Cart items'})).toBeVisible();
    await expect(
      page.getByRole('region', {name: 'Discount code'}),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await expectNoHorizontalScroll(page);
  });
});

test.describe('hostile cart input (T-01, T-08)', () => {
  test('the discount link never redirects off the site', async ({request}) => {
    for (const target of [
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      'javascript:alert(1)',
    ]) {
      const response = await request.get(
        `/discount/SAVE10?redirect=${encodeURIComponent(target)}`,
        {maxRedirects: 0},
      );
      expect(response.status()).toBe(303);
      expect(
        new URL(response.headers().location ?? '', 'http://x').pathname,
      ).toBe('/');
      expect(response.headers().location ?? '').not.toContain('evil');
    }
  });

  test('the cart permalink rejects invalid lines and creates nothing', async ({
    request,
  }) => {
    for (const lines of [
      'abc:1',
      '123:0',
      '123:100',
      '123:1:price=1',
      '1:1,x:1',
    ]) {
      const response = await request.get(`/cart/${lines}`, {maxRedirects: 0});
      expect(response.status(), lines).toBe(400);
    }
  });

  test('the cart action rejects a tampered request', async ({request}) => {
    const form = {
      cartFormInput: JSON.stringify({
        action: 'LinesAdd',
        inputs: {
          lines: [
            {
              merchandiseId: 'gid://shopify/Product/1',
              quantity: 500,
              price: '0.01',
            },
          ],
        },
      }),
    };
    const response = await request.post('/cart', {form});
    expect(response.status()).toBe(400);
  });
});
