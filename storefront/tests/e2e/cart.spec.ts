import {expect, test, type Page} from '@playwright/test';
import {
  collectConsoleErrors,
  expectNoSeriousA11yViolations,
} from './helpers/a11y';
import {
  ourErrors,
  expectNoHorizontalScroll,
  firstCollectionPath,
  findProduct,
  gotoReady,
  isPurchasable,
} from './helpers/catalog';

// REQ-CART-001 cart drawer and page, REQ-CHK-001 hand-off link, and the T-01 / T-08 negative cases.
// These add to a real cart on the connected (mock or development) store and stop before checkout.

async function addFirstProduct(page: Page) {
  const listing = await firstCollectionPath(page);
  // The first buyable product, whatever the store sells; fails if the listing has none (no silent skip).
  const product = await findProduct(page, listing, 'buyable', isPurchasable);
  await gotoReady(page, product);
  const add = page.getByRole('button', {name: 'Add to cart'});
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
    await expect(drawer.getByText('Estimated total')).toBeVisible();
    // Checkout opens the server gate, which revalidates the cart and then redirects to Shopify's hosted
    // checkout (REQ-CHK-001, REQ-PRE-006, ADR-0003).
    await expect(drawer.getByRole('link', {name: 'Checkout'})).toHaveAttribute(
      'href',
      '/checkout-steps',
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

test.describe('server hand-off and cart hardening (REQ-PRE-006, REQ-CHK-001)', () => {
  test('the checkout gate sends a verified cart to the https checkout of Shopify, uncached', async ({
    page,
  }) => {
    await addFirstProduct(page);
    const response = await page.request.get('/checkout-steps', {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(302);
    expect(response.headers().location ?? '').toMatch(/^https:\/\//);
    expect(response.headers()['cache-control']).toBe('private, no-store');
  });

  test('the gate sends an empty cart back to the cart page', async ({
    request,
  }) => {
    const response = await request.get('/checkout-steps', {maxRedirects: 0});
    expect(response.status()).toBe(302);
    expect(
      new URL(response.headers().location ?? '', 'http://x').pathname,
    ).toBe('/cart');
  });

  test('the cart cookie is HttpOnly, SameSite=Lax and expires (P-M1)', async ({
    page,
  }) => {
    await addFirstProduct(page);
    const cookies = await page.context().cookies();
    const cart = cookies.find((cookie) => cookie.name === 'cart');
    expect(cart, 'a cart cookie is set').toBeDefined();
    expect(cart?.httpOnly).toBe(true);
    expect(cart?.sameSite).toBe('Lax');
    expect(cart?.expires ?? -1).toBeGreaterThan(Date.now() / 1000);
  });

  test('cart pages are private and not stored (P-L3)', async ({request}) => {
    const response = await request.get('/cart');
    expect(response.headers()['cache-control']).toBe('private, no-store');
  });

  test('a cross-site POST to the cart is refused (T-01)', async ({request}) => {
    const response = await request.post('/cart', {
      headers: {Origin: 'https://evil.example'},
      form: {
        cartFormInput: JSON.stringify({
          action: 'LinesAdd',
          inputs: {
            lines: [
              {merchandiseId: 'gid://shopify/ProductVariant/1', quantity: 1},
            ],
          },
        }),
      },
    });
    // React Router refuses a mismatched Origin first (400); our own check (403) is the second layer.
    expect([400, 403]).toContain(response.status());
  });

  test('a permalink loaded as an image or prefetch creates no cart (P-L4)', async ({
    request,
  }) => {
    const embedded: Array<Record<string, string>> = [
      {'Sec-Fetch-Dest': 'image'},
      {'Sec-Purpose': 'prefetch'},
    ];
    for (const headers of embedded) {
      const response = await request.get('/cart/1:1', {
        headers,
        maxRedirects: 0,
      });
      expect(response.status()).toBe(400);
      expect(response.headers()['set-cookie']).toBeUndefined();
    }
  });

  test('a size can be swapped on a cart line when the product has several sizes (REQ-CART-001)', async ({
    page,
  }) => {
    const drawer = await addFirstProduct(page);
    const select = drawer.getByRole('combobox', {name: /^Size of /});
    // The sizes arrive with the offers view, a moment after the drawer opens.
    const appeared = await select
      .waitFor({timeout: 10_000})
      .then(() => true)
      .catch(() => false);
    test.skip(!appeared, 'The first product has one size.');
    const before = await select.inputValue();
    const other = await select
      .locator('option:not([disabled])')
      .evaluateAll(
        (options, current) =>
          options
            .map((option) =>
              option instanceof HTMLOptionElement ? option.value : '',
            )
            .find((value) => value !== '' && value !== current) ?? '',
        before,
      );
    test.skip(other === '', 'No other size is in stock.');
    const answered = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.startsWith('/cart') &&
        response.request().method() === 'POST',
    );
    await select.selectOption(other);
    expect((await answered).status()).toBe(200);
    await expect(drawer.getByRole('combobox', {name: /^Size of /})).toHaveValue(
      other,
    );
  });
});
