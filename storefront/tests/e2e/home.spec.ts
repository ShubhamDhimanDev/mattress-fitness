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
    // The "Buy with confidence" block is absent until the client supplies its claims (REQ-CNT-001, B-15);
    // the reassurance test below covers that.
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
  // Every reassurance item is invented wording until the client supplies it (B-15), so the block is absent.
  // When items are published (drop `awaitingContent` in lib/navigation.ts), expect the region and its links.
  test('does not show the invented delivery, comfort and price claims', async ({
    page,
  }) => {
    await gotoReady(page, '/');
    await expect(
      page.getByRole('region', {name: 'Buy with confidence'}),
    ).toHaveCount(0);
    await expect(
      page.getByRole('main').getByRole('link', {
        name: /In-home delivery|Comfort guarantee|Price guarantee/,
      }),
    ).toHaveCount(0);
  });
});
