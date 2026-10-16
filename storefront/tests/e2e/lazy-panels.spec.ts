import {expect, test, type Page} from '@playwright/test';
import {
  firstCollectionPath,
  firstProductPath,
  gotoReady,
  ourErrors,
} from './helpers/catalog';
import {collectConsoleErrors} from './helpers/a11y';

// P7-06: the cart contents, the mobile menu, the ZIP form and the search suggestions are separate chunks that load
// when wanted. These specs check that they are NOT part of the first load, that pointing at or focusing the
// control starts the download, that the panel then works as before, and that the cart link still works without
// JavaScript. Chunk names are matched by module (file) name, which is stable in the dev server and the production build.

const CHUNKS = {
  cart: /CartMain/,
  menu: /MobileNav/,
  zip: /ZipForm/,
  suggestions: /SuggestionGroups/,
};

function watchRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  return urls;
}

const requested = (urls: readonly string[], chunk: RegExp) =>
  urls.some((url) => chunk.test(url));

test.describe('P7-06 lazy shell panels', () => {
  test('a first load of the home page downloads none of the four panels', async ({
    page,
  }) => {
    const urls = watchRequests(page);
    await gotoReady(page, '/');
    for (const [name, chunk] of Object.entries(CHUNKS)) {
      expect(requested(urls, chunk), `${name} chunk`).toBe(false);
    }
  });

  test('focusing the cart button starts the cart download, and the drawer then shows its contents', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    const urls = watchRequests(page);
    await gotoReady(page, '/');
    const cartButton = page
      .getByRole('banner')
      .getByRole('link', {name: 'Cart'});
    await cartButton.focus();
    await expect.poll(() => requested(urls, CHUNKS.cart)).toBe(true);

    await cartButton.click();
    const drawer = page.getByRole('dialog', {name: 'Cart'});
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(/added anything yet/)).toBeVisible();
    // Focus moved into the drawer (the close button) and returns on Escape.
    await expect(drawer.getByRole('button', {name: 'Close'})).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(cartButton).toBeFocused();
    expect(ourErrors(errors)).toEqual([]);
  });

  test('focusing the ZIP button starts the form download and the dialog puts focus in the field', async ({
    page,
  }) => {
    const urls = watchRequests(page);
    await gotoReady(page, '/');
    const trigger = page.getByRole('button', {name: /delivery ZIP/i});
    test.skip(
      (await trigger.count()) === 0,
      'The ZIP control is hidden when the deployment cannot sign a ZIP cookie (DELIVERY_COOKIE_SECRET unset)',
    );
    await trigger.focus();
    await expect.poll(() => requested(urls, CHUNKS.zip)).toBe(true);
    await trigger.click();
    const dialog = page.getByRole('dialog', {name: 'Delivery ZIP code'});
    await expect(dialog.getByRole('textbox', {name: 'ZIP code'})).toBeFocused();
  });

  test('focusing the search field starts the suggestions download, typing shows the listbox', async ({
    page,
  }) => {
    const urls = watchRequests(page);
    await gotoReady(page, '/');
    const search = page.getByRole('combobox', {
      name: 'Search products and pages',
    });
    await search.focus();
    await expect.poll(() => requested(urls, CHUNKS.suggestions)).toBe(true);
    await search.fill('bed');
    const listbox = page.getByRole('listbox', {name: 'Search suggestions'});
    await expect(listbox).toBeVisible();
    // The closing "view all" option is always offered once the options have rendered.
    await expect(listbox.getByRole('option').last()).toBeVisible();
  });

  test('the menu button (mobile) starts the menu download and the drawer lists the navigation', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'The menu button exists below 1024 px');
    const urls = watchRequests(page);
    await gotoReady(page, '/');
    expect(requested(urls, CHUNKS.menu)).toBe(false);
    const button = page.getByRole('button', {name: 'Menu'});
    await button.focus();
    await expect.poll(() => requested(urls, CHUNKS.menu)).toBe(true);
    await button.click();
    const drawer = page.getByRole('dialog', {name: 'Menu'});
    await expect(
      drawer.getByRole('navigation', {name: 'Mobile'}),
    ).toBeVisible();
  });
});

test.describe('P7-06 without JavaScript', () => {
  test.use({javaScriptEnabled: false});

  test('the cart link is a real link to /cart and the page renders the cart', async ({
    page,
  }) => {
    await page.goto('/');
    const cartLink = page.getByRole('banner').getByRole('link', {name: 'Cart'});
    await expect(cartLink).toHaveAttribute('href', '/cart');
    await cartLink.click();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(
      page.getByRole('heading', {name: /your cart is empty/i}),
    ).toBeVisible();
  });
});

test.describe('REQ-COL-005 brand link on the product page', () => {
  test('a vendor with no brand page is shown as plain text, never as a link to a brand page', async ({
    page,
  }) => {
    const listing = await firstCollectionPath(page);
    const productPath = await firstProductPath(page, listing);
    await gotoReady(page, productPath);
    const main = page.getByRole('main');
    const title = main.getByRole('heading', {level: 1});
    await expect(title).toBeVisible();
    // The mock store has no brand entries, and its vendor is not one of the development preview brands.
    await expect(main.locator('a[href^="/brands/"]')).toHaveCount(0);
  });
});
