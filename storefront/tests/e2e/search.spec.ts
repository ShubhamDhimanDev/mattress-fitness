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

const headerCombobox = (page: Page) =>
  page
    .getByRole('banner')
    .getByRole('combobox', {name: 'Search products and pages'});

/** First word of a real product's title, so the suggestions have something to match on any store. */
async function productTerm(page: Page): Promise<string> {
  const listing = await firstCollectionPath(page);
  await gotoReady(page, await firstProductPath(page, listing));
  const title =
    (await page.getByRole('heading', {level: 1}).textContent()) ?? '';
  const word = title.trim().split(/\s+/)[0] ?? '';
  expect(
    word.length,
    'the product title has a usable first word',
  ).toBeGreaterThan(1);
  return word;
}

// REQ-SRCH-001 predictive search and REQ-SRCH-002 results page with the collection filter set.
test.describe('search results (REQ-SRCH-002)', () => {
  test('lists matches for a term taken from a real product title', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    const listing = await firstCollectionPath(page);
    await gotoReady(page, await firstProductPath(page, listing));
    const title =
      (await page.getByRole('heading', {level: 1}).textContent()) ?? '';
    const term = title.trim().split(/\s+/)[0];

    const response = await gotoReady(
      page,
      `/search?q=${encodeURIComponent(term)}`,
    );
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', {level: 1})).toContainText(term);
    await expect(page.locator('article').first()).toBeVisible();
    // Same filter UI and sort as collections.
    await expect(page.getByLabel('Sort by')).toBeVisible();
    expect(ourErrors(errors)).toEqual([]);
  });

  test('a term with no matches suggests alternatives', async ({page}) => {
    await gotoReady(page, '/search?q=zzzzqqqqxx');
    await expect(
      page.getByRole('heading', {name: /No products found/}),
    ).toBeVisible();
    await expect(page.getByRole('link', {name: 'All products'})).toBeVisible();
  });

  test('sort and filters keep the search term in the URL', async ({page}) => {
    const listing = await firstCollectionPath(page);
    await gotoReady(page, await firstProductPath(page, listing));
    const term = (
      (await page.getByRole('heading', {level: 1}).textContent()) ?? 'a'
    )
      .trim()
      .split(/\s+/)[0];
    await gotoReady(page, `/search?q=${encodeURIComponent(term)}`);
    await page.getByLabel('Sort by').selectOption('price-asc');
    await expect(page).toHaveURL(/q=/);
    await expect(page).toHaveURL(/sort=price-asc/);
  });

  test('hostile input is shown as escaped text and no script runs', async ({
    page,
  }) => {
    let dialogs = 0;
    page.on('dialog', (dialog) => {
      dialogs += 1;
      void dialog.dismiss();
    });
    // Tag-shaped input is stripped by the server; this payload keeps characters that matter when escaping
    // is wrong (a bare "<", "&", quotes, and entity-looking text) next to an event-handler tag.
    const payload = '5 < 6 & "queen" &lt;b&gt; <img src=x onerror=alert(1)>';
    const response = await gotoReady(
      page,
      `/search?q=${encodeURIComponent(payload)}&size=%3Cscript%3E`,
    );
    expect(response?.status()).toBe(200);
    // Shown literally (React escaped it): the entity text is not decoded and the tag is gone.
    await expect(page.getByRole('heading', {level: 1})).toContainText(
      '5 < 6 & "queen" &lt;b&gt;',
    );
    expect(await page.locator('img[src="x"]').count()).toBe(0);
    expect(await page.locator('main b').count()).toBe(0);
    expect(dialogs, 'alert() dialogs opened').toBe(0);
  });

  test('a filtered search with no matches keeps the filters and a reset (REQ-SRCH-002)', async ({
    page,
    isMobile,
  }) => {
    await gotoReady(page, '/search?q=zzzzqqqqxx&size=queen');
    await expect(
      page.getByRole('heading', {name: 'No products match these filters'}),
    ).toBeVisible();
    await expect(
      page.getByRole('list', {name: 'Active filters'}),
    ).toBeVisible();
    await expect(page.getByRole('link', {name: 'Reset filters'})).toBeVisible();
    if (!isMobile) {
      await expect(
        page.getByRole('complementary', {name: 'Filters'}),
      ).toBeVisible();
    }
    await page.getByRole('link', {name: 'Reset filters'}).click();
    await expect(page).not.toHaveURL(/size=/);
    await expect(
      page.getByRole('heading', {name: /No products found/}),
    ).toBeVisible();
  });

  test('has no serious accessibility violations and no horizontal scroll', async ({
    page,
  }) => {
    await gotoReady(page, '/search?q=a');
    await expectNoSeriousA11yViolations(page);
    await expectNoHorizontalScroll(page);
  });
});

test.describe('predictive search (REQ-SRCH-001)', () => {
  test('does not call the API below two characters', async ({page}) => {
    await gotoReady(page, '/');
    const predictive: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('predictive=')) predictive.push(request.url());
    });
    const box = page
      .getByRole('banner')
      .getByRole('combobox', {name: 'Search products and pages'});
    await box.pressSequentially('a');
    // Typing the second character is what triggers the first request, so waiting for it proves the
    // single-character state passed without one.
    const second = page.waitForRequest(
      (request) =>
        request.url().includes('predictive=') &&
        /[?&]q=ab(&|$)/.test(request.url()),
    );
    await box.pressSequentially('b');
    await second;
    expect(
      predictive.filter((url) => /[?&]q=a(&|$)/.test(url)),
      'requests for a single character',
    ).toEqual([]);
  });

  test('Escape closes the suggestions', async ({page}) => {
    await gotoReady(page, '/');
    const box = page
      .getByRole('banner')
      .getByRole('combobox', {name: 'Search products and pages'});
    await box.fill('lin');
    await box.press('Escape');
    await expect(page.getByText(/View all results for/)).toBeHidden();
  });

  test('is a combobox with a listbox, and announces how many suggestions there are', async ({
    page,
  }) => {
    const term = await productTerm(page);
    await gotoReady(page, '/');
    const box = headerCombobox(page);
    await expect(box).toHaveAttribute('aria-autocomplete', 'list');
    await expect(box).toHaveAttribute('aria-expanded', 'false');
    await expect(box).not.toHaveAttribute('aria-controls');

    await box.fill(term);
    await expect(box).toHaveAttribute('aria-expanded', 'true');
    const listboxId = await box.getAttribute('aria-controls');
    expect(listboxId, 'aria-controls names the popup').toBeTruthy();
    const listbox = page.getByRole('listbox', {name: 'Search suggestions'});
    await expect(listbox).toHaveAttribute('id', listboxId ?? '');
    // Real suggestions arrive, and the final option always offers the full results page.
    await expect(listbox.getByRole('option').first()).toBeVisible();
    await expect(
      listbox.getByRole('option', {name: /View all results for/}),
    ).toBeVisible();
    await expect(
      page.getByRole('status').filter({hasText: /suggestion/}),
    ).toHaveText(/\d+ suggestions? available|No suggestions/);
    // Focus never leaves the text field.
    await expect(box).toBeFocused();
  });

  test('arrow keys move through the options with aria-activedescendant, Enter opens one', async ({
    page,
  }) => {
    const term = await productTerm(page);
    await gotoReady(page, '/');
    const box = headerCombobox(page);
    await box.fill(term);
    const options = page
      .getByRole('listbox', {name: 'Search suggestions'})
      .getByRole('option');
    // Wait for the real suggestions (more than the closing "view all" option).
    await expect.poll(() => options.count()).toBeGreaterThan(1);
    const count = await options.count();

    await expect(box).not.toHaveAttribute('aria-activedescendant');
    await box.press('ArrowDown');
    const first = await box.getAttribute('aria-activedescendant');
    expect(first).toBeTruthy();
    await expect(options.first()).toHaveAttribute('aria-selected', 'true');
    await expect(options.first()).toHaveAttribute('id', first ?? '');

    await box.press('ArrowDown');
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(options.first()).toHaveAttribute('aria-selected', 'false');

    // ArrowUp from the second option goes back; from the first it wraps to the closing option.
    await box.press('ArrowUp');
    await box.press('ArrowUp');
    await expect(options.nth(count - 1)).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(box).toBeFocused();

    // Enter on the highlighted "view all" option opens the results page for the typed term.
    await box.press('Enter');
    await expect(page).toHaveURL(/\/search\?q=/);
    await expect(page.getByRole('heading', {level: 1})).toContainText(term);
  });

  test('Enter on a highlighted product opens that product', async ({page}) => {
    const term = await productTerm(page);
    await gotoReady(page, '/');
    const box = headerCombobox(page);
    await box.fill(term);
    const products = page
      .getByRole('listbox', {name: 'Search suggestions'})
      .getByRole('group', {name: 'Products'})
      .getByRole('option');
    await expect(products.first()).toBeVisible();
    expect(await products.first().getAttribute('href')).toMatch(
      /^\/products\//,
    );
    // Down until the first product is the active option.
    for (let step = 0; step < 6; step += 1) {
      await box.press('ArrowDown');
      if ((await products.first().getAttribute('aria-selected')) === 'true') {
        break;
      }
    }
    await expect(products.first()).toHaveAttribute('aria-selected', 'true');
    await box.press('Enter');
    await expect(page).toHaveURL(/\/products\//);
    // Choosing a product ends the search: the box is empty and the popup is closed.
    await expect(headerCombobox(page)).toHaveValue('');
    await expect(headerCombobox(page)).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  test('Escape closes the popup and keeps the text and the focus', async ({
    page,
  }) => {
    const term = await productTerm(page);
    await gotoReady(page, '/');
    const box = headerCombobox(page);
    await box.fill(term);
    await expect(box).toHaveAttribute('aria-expanded', 'true');
    await box.press('ArrowDown');
    await box.press('Escape');
    await expect(box).toHaveAttribute('aria-expanded', 'false');
    await expect(box).not.toHaveAttribute('aria-activedescendant');
    await expect(box).toHaveValue(term);
    await expect(box).toBeFocused();
    // The popup comes back as the shopper keeps typing.
    await box.pressSequentially('x');
    await expect(box).toHaveAttribute('aria-expanded', 'true');
  });

  test('Enter with nothing highlighted still submits the search', async ({
    page,
  }) => {
    await gotoReady(page, '/');
    const box = headerCombobox(page);
    await box.fill('queen firm');
    await box.press('Enter');
    await expect(page).toHaveURL(/\/search\?q=queen\+firm$/);
  });

  test('a single character shows no popup and a search still works', async ({
    page,
  }) => {
    await gotoReady(page, '/');
    const box = headerCombobox(page);
    await box.pressSequentially('a');
    await expect(box).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await box.press('Enter');
    await expect(page).toHaveURL(/\/search\?q=a$/);
  });

  test('the open popup has no serious accessibility violations and no horizontal scroll', async ({
    page,
  }) => {
    const term = await productTerm(page);
    await gotoReady(page, '/');
    const box = headerCombobox(page);
    await box.fill(term);
    await expect(
      page
        .getByRole('listbox', {name: 'Search suggestions'})
        .getByRole('option')
        .first(),
    ).toBeVisible();
    await box.press('ArrowDown');
    await expectNoSeriousA11yViolations(page);
    await expectNoHorizontalScroll(page);
  });

  test('a failed suggestions request falls back to the plain search option', async ({
    page,
  }) => {
    await page.route(
      (url) => url.searchParams.has('predictive'),
      (route) => route.abort(),
    );
    await gotoReady(page, '/');
    const box = headerCombobox(page);
    await box.fill('queen');
    const listbox = page.getByRole('listbox', {name: 'Search suggestions'});
    await expect(
      listbox.getByRole('option', {name: /View all results for/}),
    ).toBeVisible();
    await box.press('Enter');
    await expect(page).toHaveURL(/\/search\?q=queen$/);
  });
});
