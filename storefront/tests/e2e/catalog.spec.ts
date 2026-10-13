import {expect, test} from '@playwright/test';
import {
  collectConsoleErrors,
  expectNoSeriousA11yViolations,
} from './helpers/a11y';
import {
  ourErrors,
  expectNoHorizontalScroll,
  expectPageNotReloaded,
  firstCollectionPath,
  firstProductPath,
  gotoReady,
  markPage,
} from './helpers/catalog';

// REQ-COL-001/002/004 collection page and REQ-PDP-001/002 product page. Written against structure every
// store has; metafield-dependent UI (comfort, type, benefits) is only asserted when it is on the page.
test.describe('collection page (REQ-COL-001, REQ-COL-002)', () => {
  test('lists products with a price, one h1 and a breadcrumb', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    const path = await firstCollectionPath(page);
    const response = await gotoReady(page, path);
    expect(response?.status()).toBe(200);

    await expect(page.getByRole('heading', {level: 1})).toHaveCount(1);
    await expect(
      page.getByRole('navigation', {name: 'Breadcrumb'}),
    ).toBeVisible();
    const cards = page.locator('article');
    await expect(cards.first()).toBeVisible();
    await expect(cards.first().getByText(/\$\d/).first()).toBeVisible();
    expect(ourErrors(errors)).toEqual([]);
  });

  test('sorting changes the URL and keeps the list', async ({page}) => {
    const path = await firstCollectionPath(page);
    await gotoReady(page, path);
    await page.getByLabel('Sort by').selectOption('price-asc');
    await expect(page).toHaveURL(/sort=price-asc/);
    await expect(page.locator('article').first()).toBeVisible();
  });

  test('a price filter lives in the URL, shows as a removable chip and can be reset', async ({
    page,
    isMobile,
  }) => {
    const path = await firstCollectionPath(page);
    await gotoReady(page, path);
    if (isMobile) {
      await page.getByRole('button', {name: /^Filters/}).click();
    }
    const scope = isMobile
      ? page.getByRole('dialog', {name: 'Filters'})
      : page.getByRole('complementary', {name: 'Filters'});
    await scope.getByLabel('Minimum price in dollars').fill('1');
    await scope.getByRole('button', {name: 'Apply price'}).click();
    await expect(page).toHaveURL(/price_min=1/);
    if (isMobile) {
      await page
        .getByRole('dialog', {name: 'Filters'})
        .getByRole('button', {name: 'Show results'})
        .click();
    }
    const chips = page.getByRole('list', {name: 'Active filters'});
    await expect(chips).toBeVisible();
    await chips.getByRole('link').first().click();
    await expect(page).not.toHaveURL(/price_min/);
  });

  test('an impossible filter shows the empty state with a reset', async ({
    page,
  }) => {
    const path = await firstCollectionPath(page);
    await gotoReady(page, `${path}?price_min=99999&price_max=100000`);
    // mock.shop ignores the price filter and returns every product; a real store returns none.
    test.skip(
      (await page.locator('article').count()) > 0,
      'The connected store does not apply the price filter.',
    );
    await expect(
      page.getByRole('heading', {name: 'No products match these filters'}),
    ).toBeVisible();
    await page.getByRole('link', {name: 'Reset filters'}).click();
    await expect(page).not.toHaveURL(/price_min/);
  });

  test('hostile filter values are dropped and the page still renders', async ({
    page,
  }) => {
    const path = await firstCollectionPath(page);
    const response = await gotoReady(
      page,
      `${path}?size=%3Cscript%3E&sort=hack&cursor=%27%3B--&price_min=abc`,
    );
    expect(response?.status()).toBe(200);
    await expect(page.locator('article').first()).toBeVisible();
  });

  test('"Load more" appends products without a full reload when there are more', async ({
    page,
  }) => {
    await gotoReady(page, '/collections/all');
    const button = page.getByRole('link', {name: 'Load more'});
    test.skip(
      (await button.count()) === 0,
      'The store has one page of products.',
    );
    const before = await page.locator('article').count();
    await markPage(page);
    await button.click();
    await expect
      .poll(() => page.locator('article').count())
      .toBeGreaterThan(before);
    await expectPageNotReloaded(page);
  });

  test('has no serious accessibility violations and no horizontal scroll', async ({
    page,
  }) => {
    const path = await firstCollectionPath(page);
    await gotoReady(page, path);
    await expectNoSeriousA11yViolations(page);
    await expectNoHorizontalScroll(page);
  });
});

test.describe('product page (REQ-PDP-001, REQ-PDP-002)', () => {
  test('shows title, price, availability and an Add to cart button', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    const listing = await firstCollectionPath(page);
    const product = await firstProductPath(page, listing);
    const response = await gotoReady(page, product);
    expect(response?.status()).toBe(200);

    await expect(page.getByRole('heading', {level: 1})).toHaveCount(1);
    await expect(page.getByText(/In stock|Sold out/).first()).toBeVisible();
    await expect(
      page.getByRole('button', {name: /Add to cart|Sold out/}).first(),
    ).toBeVisible();
    expect(ourErrors(errors)).toEqual([]);
  });

  test('emits Product and breadcrumb structured data from the same data', async ({
    page,
  }) => {
    const listing = await firstCollectionPath(page);
    await gotoReady(page, await firstProductPath(page, listing));
    const blocks = await page
      .locator('script[type="application/ld+json"]')
      .allTextContents();
    const types = blocks.map((text) => {
      const parsed: unknown = JSON.parse(text);
      return typeof parsed === 'object' && parsed !== null
        ? Object.entries(parsed).find(([key]) => key === '@type')?.[1]
        : undefined;
    });
    expect(types).toContain('Product');
    expect(types).toContain('BreadcrumbList');
  });

  test('choosing a size updates the URL without a full reload', async ({
    page,
  }) => {
    const listing = await firstCollectionPath(page);
    await gotoReady(page, await firstProductPath(page, listing));
    const sizes = page.getByRole('group', {name: /^Size/});
    test.skip((await sizes.count()) === 0, 'This product has no Size option.');
    const enabled = sizes.locator('input[type="radio"]:enabled');
    test.skip((await enabled.count()) < 2, 'Only one size can be bought.');
    await markPage(page);
    // The radio is visually hidden; its label is what a shopper clicks.
    await sizes.locator('input:enabled + label').nth(1).click();
    await expect(page).toHaveURL(/[?&]Size=/);
    await expectPageNotReloaded(page);
  });

  test('an unknown option value in the URL is ignored', async ({page}) => {
    const listing = await firstCollectionPath(page);
    const product = await firstProductPath(page, listing);
    const response = await gotoReady(
      page,
      `${product}?Size=%3Cimg%20src%3Dx%3E`,
    );
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', {level: 1})).toHaveCount(1);
  });

  test('the gallery is keyboard operable', async ({page}) => {
    const listing = await firstCollectionPath(page);
    await gotoReady(page, await firstProductPath(page, listing));
    const next = page.getByRole('button', {name: 'Next image'});
    test.skip((await next.count()) === 0, 'This product has one image.');
    await next.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText(/Image 2 of/)).toBeAttached();
  });

  test('has no serious accessibility violations and no horizontal scroll', async ({
    page,
  }) => {
    const listing = await firstCollectionPath(page);
    await gotoReady(page, await firstProductPath(page, listing));
    await expectNoSeriousA11yViolations(page);
    await expectNoHorizontalScroll(page);
  });
});
