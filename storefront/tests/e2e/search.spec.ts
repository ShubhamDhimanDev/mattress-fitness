import {expect, test} from '@playwright/test';
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

  test('hostile input renders as text and does not break the page', async ({
    page,
  }) => {
    const response = await gotoReady(
      page,
      `/search?q=${encodeURIComponent('<img src=x onerror=alert(1)>')}&size=%3Cscript%3E`,
    );
    expect(response?.status()).toBe(200);
    expect(await page.locator('img[src="x"]').count()).toBe(0);
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
      .getByRole('searchbox', {name: 'Search products and pages'});
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
      .getByRole('searchbox', {name: 'Search products and pages'});
    await box.fill('lin');
    await box.press('Escape');
    await expect(page.getByText(/View all results for/)).toBeHidden();
  });
});
