import {expect, test, type Page} from '@playwright/test';
import {
  collectConsoleErrors,
  expectNoSeriousA11yViolations,
} from './helpers/a11y';
import {
  findProduct,
  firstCollectionPath,
  gotoReady,
  isPurchasable,
  ourErrors,
} from './helpers/catalog';

// REQ-CART-002, REQ-CART-003, REQ-ADD-002 / T-01, T-02: the cart pickers' server actions, from a browser.
// mock.shop and bedding.mock.shop answer no `nodes(ids)` lookups, so no offer can be built from a rule there: the
// picker UI round trips are skipped below with that reason. What a mock store CAN show is that no offer renders when
// no rule applies, and that forged picker posts are refused with a fixed message and change nothing.

async function addFirstProduct(page: Page) {
  const listing = await firstCollectionPath(page);
  const product = await findProduct(page, listing, 'buyable', isPurchasable);
  await gotoReady(page, product);
  const answered = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.startsWith('/cart') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', {name: 'Add to cart'}).click();
  await answered;
  await expect(page.getByRole('dialog', {name: 'Cart'})).toBeVisible();
}

test.describe('cart pickers (REQ-CART-002, REQ-CART-003, REQ-ADD-002)', () => {
  test('no offer region renders when no rule applies, and the cart page is accessible', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await addFirstProduct(page);
    await gotoReady(page, '/cart');
    await expect(
      page.getByRole('heading', {name: 'Your cart', level: 1}),
    ).toBeVisible();
    await expect(
      page.getByRole('region', {name: 'Offers for your cart'}),
    ).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
    expect(ourErrors(errors)).toEqual([]);
  });

  const FORGED = [
    {
      name: 'gift',
      action: 'CustomAddGift',
      inputs: {
        ruleId: 'forged',
        variantId: 'gid://shopify/ProductVariant/1',
        quantity: 50,
      },
    },
    {
      name: 'add-on',
      action: 'CustomAddAddOn',
      inputs: {variantId: 'gid://shopify/ProductVariant/1', quantity: 50},
    },
    {
      name: 'bundle',
      action: 'CustomAddBundle',
      inputs: {
        bundleId: 'forged',
        anchorLineId: 'gid://shopify/CartLine/forged',
      },
    },
  ];

  for (const forged of FORGED) {
    test(`a forged ${forged.name} post is refused with a fixed message and the cart is unchanged (T-01)`, async ({
      page,
    }) => {
      await addFirstProduct(page);
      const before = await page.request.get('/cart');
      expect(before.ok()).toBe(true);
      const response = await page.request.post('/cart', {
        multipart: {
          cartFormInput: JSON.stringify({
            action: forged.action,
            inputs: forged.inputs,
          }),
        },
      });
      // Never a server error, never a success.
      expect(response.status()).toBe(400);
      const text = await response.text();
      expect(text).not.toContain('forged');
      await page.goto('/cart');
      await expect(page.getByRole('list', {name: 'Cart items'})).toBeVisible();
      await expect(
        page.getByRole('list', {name: 'Cart items'}).getByRole('listitem'),
      ).toHaveCount(1);
    });
  }

  test.skip('gift choose-one, add-on and bundle buttons add through the server on a real store', () => {
    // Needs a store that answers Storefront `nodes(ids)` and a gift/add-on/bundle rule in OFFER_CONFIG_JSON pointing at
    // its variants (dev store, P4-12, V-03). Covered meanwhile by tests/unit/ui/CartOffers.test.tsx and
    // tests/unit/routes/picker-routes.test.ts against fakes.
  });
});
