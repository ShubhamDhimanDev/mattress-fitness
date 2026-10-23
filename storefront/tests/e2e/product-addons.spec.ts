import {expect, test, type Page, type Route} from '@playwright/test';
import {
  collectConsoleErrors,
  expectNoSeriousA11yViolations,
} from './helpers/a11y';
import {
  expectNoHorizontalScroll,
  expectPageNotReloaded,
  findProduct,
  firstCollectionPath,
  gotoReady,
  hasSizes,
  markPage,
  ourErrors,
} from './helpers/catalog';

// REQ-ADD-001 / REQ-CAT-007 / T-01 / NFR-013 (P4-03): the product page's add-on slot (size-matched foundations, adjustable
// bases and frames). NOT YET RUN: written as code for the QA agent, who runs it with the browsers.
//
// What a mock store cannot do: bedding.mock.shop and mock.shop answer no `nodes(ids)` lookups and the dev server has no
// OFFER_CONFIG_JSON, so the server never lists add-ons there. This spec therefore (a) opts the page in with the
// development-only cookie `e2e_addons_expected=1` (the loader honours it only under `import.meta.env.DEV`) and (b)
// answers `/api/product-addons` at the network layer, like protection.spec.ts does for Extend. The real list, the real
// prices and the real add-to-cart success path need the development store and a foundation rule (P4-12, V-02); until
// then they are covered against fakes in tests/unit/offers-runtime/product-addon-steps.test.ts and
// tests/unit/routes/product-addons-routes.test.ts. Run with E2E_ADDONS_RULES=on against a server whose
// OFFER_CONFIG_JSON relates these ids to real variants to expect the success path in the add test below.

const RULES_ON = process.env.E2E_ADDONS_RULES === 'on';
const VARIANT_ID = /^gid:\/\/shopify\/ProductVariant\/\d+$/;
const SLOT = /Foundations, bases and frames/;

type Item = {size: string | null; id: number; title: string; amount: string};

function body(items: readonly Item[]) {
  return {
    status: 'ok',
    items: items.map((item) => ({
      category: 'foundation',
      size: item.size,
      variant: {
        variantId: `gid://shopify/ProductVariant/${item.id}`,
        productTitle: item.title,
        productHandle: 'e2e-foundation',
        variantTitle: item.size,
        price: {amount: item.amount, currencyCode: 'USD'},
      },
    })),
  };
}

async function optIn(page: Page) {
  await page
    .context()
    .addCookies([
      {name: 'e2e_addons_expected', value: '1', domain: 'localhost', path: '/'},
    ]);
}

async function stubList(page: Page, answer: (route: Route) => Promise<void>) {
  const asked: string[] = [];
  await page.route('**/api/product-addons**', async (route) => {
    asked.push(route.request().url());
    await answer(route);
  });
  return asked;
}

const json = (route: Route, payload: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  });

async function openProductWithSizes(page: Page) {
  const listing = await firstCollectionPath(page);
  return findProduct(page, listing, 'sold in two sizes', (p) => hasSizes(p, 2));
}

/** The labels of the enabled size choices, in page order. */
async function sizeLabels(page: Page): Promise<string[]> {
  const labels = await page
    .getByRole('group', {name: /^Size/})
    .locator('input:enabled + label')
    .allTextContents();
  return labels.map((label) => label.trim());
}

/** One foundation per size of the page's product (so whichever size is selected has one) and a frame for every size. */
async function itemsForSizes(page: Page): Promise<Item[]> {
  const sizes = await sizeLabels(page);
  return [
    ...sizes.map((size, index) => ({
      size,
      id: 8100 + index,
      title: `E2E Steel foundation ${size}`,
      amount: String(300 + index * 50) + '.00',
    })),
    {size: null, id: 8200, title: 'E2E Platform frame', amount: '199.00'},
  ];
}

test.describe('product page add-on slot (REQ-ADD-001)', () => {
  test('shows nothing, and asks for nothing, when no rule relates add-ons to the product', async ({
    page,
  }) => {
    test.skip(
      RULES_ON,
      'The server under test has foundation rules, so a product may legitimately show the slot.',
    );
    const asked = await stubList(page, (route) =>
      json(route, body([{size: null, id: 1, title: 'x', amount: '1.00'}])),
    );
    const product = await openProductWithSizes(page);
    await gotoReady(page, product);
    await expect(page.getByRole('region', {name: SLOT})).toHaveCount(0);
    expect(asked).toEqual([]);
  });

  test('lists the items that fit the selected size with their prices, and swaps them when the size changes', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await optIn(page);
    const product = await openProductWithSizes(page);
    await gotoReady(page, product);
    // Answer from the sizes this product really has.
    const items = await itemsForSizes(page);
    const asked = await stubList(page, (route) => json(route, body(items)));
    await page.reload({waitUntil: 'domcontentloaded'});

    const slot = page.getByRole('region', {name: SLOT});
    await expect(slot).toBeVisible();
    const selected = await page
      .getByRole('group', {name: /^Size/})
      .locator('input:checked + label')
      .innerText();
    await expect(slot.getByRole('listitem').first()).toContainText(
      `E2E Steel foundation ${selected.trim()}`,
    );
    // The frame has no size, so it fits every size; prices are shown as the server listed them.
    await expect(slot).toContainText('E2E Platform frame');
    await expect(slot).toContainText('$199.00');
    const before = await slot.getByRole('listitem').allInnerTexts();

    await markPage(page);
    const sizes = page.getByRole('group', {name: /^Size/});
    await sizes.locator('input:enabled + label').nth(1).click();
    await expect(page).toHaveURL(/[?&]Size=/);
    await expectPageNotReloaded(page);
    await expect
      .poll(async () => slot.getByRole('listitem').allInnerTexts())
      .not.toEqual(before);
    // One request for the page, none for the size change.
    expect(asked).toHaveLength(1);
    expect(
      new URL(asked[0] ?? 'http://x').searchParams.get('productId'),
    ).toMatch(/^gid:\/\/shopify\/Product\/\d+$/);

    await expectNoSeriousA11yViolations(page);
    await expectNoHorizontalScroll(page);
    expect(ourErrors(errors)).toEqual([]);
  });

  test('holds its space while loading, then shows the list', async ({page}) => {
    await optIn(page);
    const product = await openProductWithSizes(page);
    await gotoReady(page, product);
    const items = await itemsForSizes(page);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await stubList(page, async (route) => {
      await gate;
      await json(route, body(items));
    });
    await page.reload({waitUntil: 'domcontentloaded'});
    await expect(page.locator('[aria-busy="true"]').first()).toBeVisible();
    await expect(page.getByRole('region', {name: SLOT})).toHaveCount(0);
    release();
    await expect(page.getByRole('region', {name: SLOT})).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  });

  test('a failed list shows an announced error and a retry that loads the list', async ({
    page,
  }) => {
    await optIn(page);
    const product = await openProductWithSizes(page);
    await gotoReady(page, product);
    const items = await itemsForSizes(page);
    let calls = 0;
    await stubList(page, async (route) => {
      calls += 1;
      if (calls === 1) await json(route, {status: 'invalid'}, 500);
      else await json(route, body(items));
    });
    await page.reload({waitUntil: 'domcontentloaded'});
    await expect(
      page.getByRole('alert').filter({hasText: /could not load/}),
    ).toBeVisible();
    // The rest of the page is unaffected (NFR-013).
    await expect(page.getByRole('button', {name: 'Add to cart'})).toBeEnabled();
    await page.getByRole('button', {name: 'Try again'}).click();
    await expect(page.getByRole('region', {name: SLOT})).toBeVisible();
  });

  test('renders nothing when the server lists nothing for this size', async ({
    page,
  }) => {
    await optIn(page);
    const product = await openProductWithSizes(page);
    await gotoReady(page, product);
    const asked = await stubList(page, (route) => json(route, body([])));
    await page.reload({waitUntil: 'domcontentloaded'});
    await expect.poll(() => asked.length).toBeGreaterThan(0);
    await expect(page.getByRole('region', {name: SLOT})).toHaveCount(0);
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  });

  test('an add posts the two variant ids only, and the result is shown in words', async ({
    page,
  }) => {
    await optIn(page);
    const product = await openProductWithSizes(page);
    await gotoReady(page, product);
    const items = await itemsForSizes(page);
    await stubList(page, (route) => json(route, body(items)));
    await page.reload({waitUntil: 'domcontentloaded'});
    const slot = page.getByRole('region', {name: SLOT});
    await expect(slot).toBeVisible();

    const posted = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname.startsWith('/cart') &&
        request.method() === 'POST',
    );
    await slot
      .getByRole('button', {name: /^Add with mattress/})
      .first()
      .click();
    const request = await posted;
    // The cart form's single JSON field (URL-encoded by the router's fetcher). Nothing else travels.
    const field = new URLSearchParams(request.postData() ?? '').get(
      'cartFormInput',
    );
    expect(field, 'the cart form field').not.toBeNull();
    const sent: unknown = JSON.parse(field ?? 'null');
    expect(sent).toMatchObject({action: 'CustomAddAddOn'});
    const inputs =
      typeof sent === 'object' && sent !== null && 'inputs' in sent
        ? sent.inputs
        : null;
    // The add-on and the viewed mattress, as variant ids: no price, quantity, title or parent.
    expect(Object.keys(inputs ?? {}).sort()).toEqual([
      'mattressVariantId',
      'variantId',
    ]);
    for (const value of Object.values(inputs ?? {})) {
      expect(String(value)).toMatch(VARIANT_ID);
    }

    if (RULES_ON) {
      await expect(
        slot.getByRole('button', {name: 'Added to cart'}),
      ).toBeDisabled();
      await expect(slot.getByRole('button', {name: 'View cart'})).toBeVisible();
    } else {
      // No offer rules on a mock store: the server refuses with a fixed message and adds nothing.
      await expect(
        page.getByText('That item is not offered for your cart right now.'),
      ).toBeVisible();
      await expect(
        slot.getByRole('button', {name: /^Add with mattress/}).first(),
      ).toBeEnabled();
    }
  });

  test('a forged pair posted straight to /cart is refused with a fixed message and nothing is added (T-01)', async ({
    page,
  }) => {
    const response = await page.request.post('/cart', {
      multipart: {
        cartFormInput: JSON.stringify({
          action: 'CustomAddAddOn',
          inputs: {
            variantId: 'gid://shopify/ProductVariant/1',
            mattressVariantId: 'gid://shopify/ProductVariant/2',
            quantity: 50,
            price: '0.00',
          },
        }),
      },
    });
    expect(response.status()).toBe(400);
    // A fixed message, never the ids the request carried.
    expect(await response.text()).not.toContain(
      'gid://shopify/ProductVariant/2',
    );
  });

  test('a malformed product id is refused by the list route', async ({
    page,
  }) => {
    const response = await page.request.get(
      '/api/product-addons?productId=nope',
    );
    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({status: 'invalid'});
  });
});
