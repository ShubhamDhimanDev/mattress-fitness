import {expect, test, type Page} from '@playwright/test';
import {
  collectConsoleErrors,
  expectNoSeriousA11yViolations,
} from './helpers/a11y';
import {
  findProduct,
  firstCollectionPath,
  isPurchasable,
  ourErrors,
} from './helpers/catalog';

// REQ-ADD-003 / REQ-EXT-001 / REQ-EXT-004 / NFR-013 / P5A-05 (product-page protection panel).
//
// The panel renders only when the server's Extend flag is on (PUBLIC_EXTEND_ENABLED=true plus a complete mock
// configuration, see DEV_DATA.md "Extend protection"). Run the flag-on server and set E2E_PROTECTION_FLAG=on for the
// first describe; without it those tests are skipped WITH that reason, and the flag-off test runs instead.
//
// What this spec cannot do: bedding.mock.shop answers no `nodes(ids)` lookups and has no `custom.extend_category`
// metafield or `extend-coverage` products, so the SUCCESS path of an add-with-protection (item plus nested coverage
// line) cannot run here. It is covered by tests/unit/offers-runtime/protection-steps.test.ts against fakes and needs
// the development store (V-16, V-02) for a live run. Here /api/extend/offers is answered at the network layer.

const FLAG_ON = process.env.E2E_PROTECTION_FLAG === 'on';
const VARIANT_ID = /^gid:\/\/shopify\/ProductVariant\/\d+$/;

const PLANS = [
  {
    planId: 'E2E-PLAN-3Y',
    title: 'Accident plan 3 years',
    priceCents: 7999,
    termMonths: 36,
    termsUrl: 'https://extend.example/terms',
    imageUrl: null,
    recommended: true,
  },
  {
    planId: 'E2E-PLAN-5Y',
    title: 'Accident plan 5 years',
    priceCents: 9999,
    termMonths: 60,
    termsUrl: 'https://extend.example/terms',
    imageUrl: null,
    recommended: false,
  },
];

async function stubOffers(page: Page, body: unknown, status = 200) {
  const asked: string[] = [];
  await page.route('**/api/extend/offers**', async (route) => {
    asked.push(route.request().url());
    const url = new URL(route.request().url());
    const variantId = url.searchParams.get('variantId') ?? '';
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(
        typeof body === 'function'
          ? (body as (id: string) => unknown)(variantId)
          : body,
      ),
    });
  });
  return asked;
}

const answerWith = (plans: unknown[]) => (variantId: string) => ({
  status: 'ok',
  poweredBy: 'Extend',
  items: [{variantId, quantity: 1, plans}],
});

// Not gotoReady (networkidle): Shopify telemetry refused by our CSP keeps the network busy in dev. Each test waits for
// what it needs (the panel, or the offers request) instead.
async function visit(page: Page, path: string) {
  await page.goto(path, {waitUntil: 'domcontentloaded'});
}

async function openBuyableProduct(page: Page) {
  const listing = await firstCollectionPath(page);
  const product = await findProduct(page, listing, 'buyable', isPurchasable);
  return product;
}

test.describe('product-page protection panel, flag ON', () => {
  test.skip(
    !FLAG_ON,
    'needs the flag-on dev server (PUBLIC_EXTEND_ENABLED=true) and E2E_PROTECTION_FLAG=on; see DEV_DATA.md',
  );

  test('shows plans with price, term, terms link and Extend branding; "No protection" is the default; the panel keeps its place', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    const asked = await stubOffers(page, answerWith(PLANS));
    const product = await openBuyableProduct(page);
    await visit(page, product);

    const panel = page.getByRole('group', {name: 'Accident protection'});
    await expect(panel).toBeVisible();
    await expect(
      panel.getByRole('radio', {name: 'No protection'}),
    ).toBeChecked();
    await expect(
      panel.getByRole('radio', {name: /Accident plan 3 years/}),
    ).toBeVisible();
    await expect(panel.getByText('$79.99')).toBeVisible();
    await expect(panel.getByText('3 years of coverage')).toBeVisible();
    await expect(panel.getByText('Powered by Extend')).toBeVisible();
    const terms = panel
      .getByRole('link', {name: /Plan details and terms/})
      .first();
    await expect(terms).toHaveAttribute('href', 'https://extend.example/terms');
    await expect(terms).toHaveAttribute('rel', 'noopener noreferrer');

    // The browser asked OUR route, with a variant id and a quantity only.
    expect(asked.length).toBeGreaterThan(0);
    const query = new URL(asked[0] ?? '').searchParams;
    expect([...query.keys()].sort()).toEqual(['quantity', 'variantId']);
    expect(query.get('variantId')).toMatch(VARIANT_ID);

    // Keyboard: the radio group is operable with the arrow keys.
    await panel.getByRole('radio', {name: 'No protection'}).focus();
    await page.keyboard.press('ArrowDown');
    await expect(
      panel.getByRole('radio', {name: /Accident plan 3 years/}),
    ).toBeChecked();
    await expect(
      page.getByRole('button', {name: 'Add to cart with protection'}),
    ).toBeVisible();
    await panel.getByRole('radio', {name: 'No protection'}).check();
    await expect(page.getByRole('button', {name: 'Add to cart'})).toBeVisible();

    await expectNoSeriousA11yViolations(page);
    expect(ourErrors(errors)).toEqual([]);
  });

  test('no layout shift: the Add to cart button does not move when the plans arrive', async ({
    page,
  }) => {
    await page.route('**/api/extend/offers**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const variantId =
        new URL(route.request().url()).searchParams.get('variantId') ?? '';
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(answerWith([PLANS[0]])(variantId)),
      });
    });
    const product = await openBuyableProduct(page);
    // Not gotoReady: it waits for the network to go quiet, which would wait out the delayed answer.
    await page.goto(product, {waitUntil: 'domcontentloaded'});
    const add = page.getByRole('button', {name: 'Add to cart'});
    await expect(page.locator('[aria-busy="true"]')).toBeVisible();
    const before = await add.boundingBox();
    await expect(
      page.getByRole('group', {name: 'Accident protection'}),
    ).toBeVisible();
    const after = await add.boundingBox();
    expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThanOrEqual(2);
  });

  test('Extend unavailable or without a plan: the panel is not shown and the item can still be added', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    const asked = await stubOffers(page, {status: 'unavailable'});
    const product = await openBuyableProduct(page);
    await visit(page, product);
    await expect(
      page.getByRole('group', {name: 'Accident protection'}),
    ).toHaveCount(0);
    await expect(page.getByRole('button', {name: 'Add to cart'})).toBeEnabled();
    expect(ourErrors(errors)).toEqual([]);
  });

  test('a failing offers route (500) hides the panel and does not break the page', async ({
    page,
  }) => {
    const asked = await stubOffers(page, {}, 500);
    const product = await openBuyableProduct(page);
    await visit(page, product);
    await expect(
      page.getByRole('group', {name: 'Accident protection'}),
    ).toHaveCount(0);
    await expect(page.getByRole('button', {name: 'Add to cart'})).toBeEnabled();
  });

  test('choosing a plan the server cannot verify shows a fixed message and adds nothing (the mock store answers no variant lookups)', async ({
    page,
  }) => {
    await stubOffers(page, answerWith(PLANS));
    const product = await openBuyableProduct(page);
    await visit(page, product);
    const panel = page.getByRole('group', {name: 'Accident protection'});
    await panel.getByRole('radio', {name: /Accident plan 3 years/}).check();
    const answered = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.startsWith('/cart') &&
        response.request().method() === 'POST',
    );
    await page
      .getByRole('button', {name: 'Add to cart with protection'})
      .click();
    const response = await answered;
    // The real server re-quotes: bedding.mock.shop cannot confirm the variant, so nothing is added and the shopper is
    // told so in fixed text (T-01: the plan key alone is never enough).
    expect(response.status()).toBe(400);
    // The answer carries the fixed text. Whether the shopper SEES it is CartMessages' job; in dev, React StrictMode's
    // double effect deletes the form's fetcher before CartMessages can read it (pre-existing, all cart forms; to confirm
    // in a production build), so this asserts the response, not the dev DOM.
    expect(await response.text()).toContain(
      'Protection is not available for this item right now',
    );
  });
});

test.describe('product-page protection panel, flag OFF (NFR-013)', () => {
  test.skip(
    FLAG_ON,
    'the flag-on server is running; this checks the default dev server with no Extend configuration',
  );

  test('nothing Extend-related renders and /api/extend/offers is never called', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    const asked = await stubOffers(page, answerWith(PLANS));
    const product = await openBuyableProduct(page);
    await visit(page, product);
    await expect(page.getByRole('button', {name: 'Add to cart'})).toBeEnabled();
    await expect(
      page.getByRole('group', {name: 'Accident protection'}),
    ).toHaveCount(0);
    await expect(page.getByText('Powered by Extend')).toHaveCount(0);
    expect(asked).toEqual([]);
    expect(ourErrors(errors)).toEqual([]);
  });
});
