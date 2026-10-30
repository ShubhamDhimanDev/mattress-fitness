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
    // Each tile names the size and its real dimensions (CR-31).
    await expect(sizes.getByRole('link').first()).toContainText(/\d+ x \d+ in/);
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

  test('the hero finder goes to the collection with only known filter values (CR-31)', async ({
    page,
  }) => {
    await gotoReady(page, '/');
    const finder = page.getByRole('form', {name: 'Find mattresses by size'});
    // The finder hides itself when there is nothing to choose from; the dev data has sizes.
    await expect(finder).toBeVisible();
    await finder.getByText('Queen', {exact: true}).click();
    await finder.getByRole('button', {name: 'Show mattresses'}).click();
    await expect(page).toHaveURL(/\/collections\/[^?]*\?size=queen$/);
  });

  test('the finder works as a plain GET form and the quiz tab links to the quiz (CR-31)', async ({
    page,
  }) => {
    await gotoReady(page, '/');
    const finder = page.getByRole('form', {name: 'Find mattresses by size'});
    await expect(finder).toHaveAttribute('method', 'get');
    await expect(finder).toHaveAttribute('action', /^\/collections/);
    await page.getByRole('tab', {name: 'Sleep quiz'}).click();
    await expect(
      page
        .getByRole('tabpanel')
        .getByRole('link', {name: 'Take the sleep quiz'}),
    ).toHaveAttribute('href', '/quiz');
  });

  test('has no serious accessibility violations and no horizontal scroll at 360, 768, 1280 and 1536 px', async ({
    page,
  }, info) => {
    test.skip(
      info.project.name.includes('mobile'),
      'The widths are set by the test, so the desktop project covers them.',
    );
    for (const width of [360, 768, 1280, 1536]) {
      await page.setViewportSize({width, height: 900});
      await gotoReady(page, '/');
      await expectNoSeriousA11yViolations(page);
      await expectNoHorizontalScroll(page);
    }
  });
});

test.describe('home page reassurance (CR-31)', () => {
  // The promises show once, in the strip under the main menu; the page body repeats none of them.
  test('shows the promises under the menu and not again in the page body', async ({
    page,
  }) => {
    await gotoReady(page, '/');
    await expect(
      page.getByRole('banner').getByText('Price guarantee', {exact: true}),
    ).toBeVisible();
    await expect(
      page.getByRole('region', {name: 'Buy with confidence'}),
    ).toHaveCount(0);
    await expect(
      page.getByRole('main').getByText(/in-home delivery/i),
    ).toHaveCount(0);
  });
});
