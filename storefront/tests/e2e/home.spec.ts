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

// REQ-HOME-001: data-driven home sections that tolerate missing data.
test.describe('REQ-HOME-001 home page', () => {
  test('has one h1 and builds its sections from catalog data', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    const response = await gotoReady(page, '/');
    expect(response?.status()).toBe(200);

    await expect(page.getByRole('heading', {level: 1})).toHaveCount(1);
    const sizes = page.getByRole('region', {name: 'Shop by size'});
    await expect(sizes).toBeVisible();
    // Tiles link to a collection with the size filter in the URL (REQ-COL-002 codec).
    await expect(sizes.getByRole('link').first()).toHaveAttribute(
      'href',
      /^\/collections\/[^?]+\?size=/,
    );
    await expect(
      page.getByRole('region', {name: 'Buy with confidence'}),
    ).toBeVisible();
    expect(ourErrors(errors), 'console errors on the home page').toEqual([]);
  });

  test('a size tile opens the collection with that size filtered', async ({
    page,
  }) => {
    await gotoReady(page, '/');
    await page
      .getByRole('region', {name: 'Shop by size'})
      .getByRole('link')
      .first()
      .click();
    await expect(page).toHaveURL(/\/collections\/[^?]+\?size=/);
    await expect(page.getByRole('heading', {level: 1})).toHaveCount(1);
  });

  test('has no serious accessibility violations and no horizontal scroll', async ({
    page,
  }) => {
    await gotoReady(page, '/');
    await expectNoSeriousA11yViolations(page);
    await expectNoHorizontalScroll(page);
  });
});

test.describe('home page reassurance (REQ-CNT-001 pending)', () => {
  test('does not show the invented comfort and price guarantee links', async ({
    page,
  }) => {
    await gotoReady(page, '/');
    const section = page.getByRole('region', {name: 'Buy with confidence'});
    await expect(section).toBeVisible();
    await expect(
      section.getByRole('link', {name: /Comfort guarantee|Price guarantee/}),
    ).toHaveCount(0);
  });
});
