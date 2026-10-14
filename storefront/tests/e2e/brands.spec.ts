import {expect, test} from '@playwright/test';
import {
  collectConsoleErrors,
  expectNoSeriousA11yViolations,
} from './helpers/a11y';
import {
  expectNoHorizontalScroll,
  gotoReady,
  ourErrors,
} from './helpers/catalog';

// REQ-COL-005 / P3B-06: brand pages. The connected demo store has no `brand` metaobjects, so these runs
// exercise the fixture-backed preview (noindex, with a preview notice); real brand data is verified on the
// development store (V-05).

test.describe('REQ-COL-005 brand index', () => {
  test('lists brands, says it is a preview and is kept out of search engines', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    const response = await gotoReady(page, '/brands');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', {level: 1})).toHaveText('Brands');
    await expect(
      page.getByRole('complementary', {name: 'Preview notice'}),
    ).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    );
    const links = page
      .getByRole('main')
      .getByRole('list', {name: 'Brands'})
      .getByRole('link');
    expect(await links.count()).toBeGreaterThan(0);
    await expect(links.first()).toHaveAttribute(
      'href',
      /^\/brands\/[a-z0-9-]+$/,
    );
    expect(ourErrors(errors)).toEqual([]);
  });

  test('has no serious accessibility violations and no horizontal scroll', async ({
    page,
  }) => {
    await gotoReady(page, '/brands');
    await expectNoSeriousA11yViolations(page);
    await expectNoHorizontalScroll(page);
  });
});

test.describe('REQ-COL-005 brand page', () => {
  test('opens from the index with the brand name as the only h1 and its products listed', async ({
    page,
  }) => {
    await gotoReady(page, '/brands');
    const first = page
      .getByRole('main')
      .getByRole('list', {name: 'Brands'})
      .getByRole('link')
      .first();
    const name = ((await first.textContent()) ?? '').trim();
    await first.click();
    await expect(page).toHaveURL(/\/brands\/[a-z0-9-]+$/);
    await expect(page.getByRole('heading', {level: 1})).toHaveCount(1);
    await expect(page.getByRole('heading', {level: 1})).toHaveText(name);
    await expect(
      page
        .getByRole('navigation', {name: 'Breadcrumb'})
        .getByRole('link', {name: 'Brands'}),
    ).toBeVisible();
    await expect(page.locator('main article').first()).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    );
    // Sample brands are fictional: no structured data is published for them.
    await expect(
      page.locator('script[type="application/ld+json"]'),
    ).toHaveCount(0);
  });

  test('has no serious accessibility violations and no horizontal scroll', async ({
    page,
  }) => {
    await gotoReady(page, '/brands');
    await page
      .getByRole('main')
      .getByRole('list', {name: 'Brands'})
      .getByRole('link')
      .first()
      .click();
    await expect(page.getByRole('heading', {level: 1})).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await expectNoHorizontalScroll(page);
  });

  test('an unknown or hostile handle is a 404 with the shell intact', async ({
    page,
  }) => {
    for (const handle of ['no-such-brand', '..%2Fetc', '%3Cscript%3E']) {
      const response = await gotoReady(page, `/brands/${handle}`);
      expect(response?.status(), handle).toBe(404);
      await expect(page.getByRole('banner')).toBeVisible();
      await expect(page.getByRole('heading', {level: 1})).toHaveText(
        'Page not found',
      );
    }
  });
});
