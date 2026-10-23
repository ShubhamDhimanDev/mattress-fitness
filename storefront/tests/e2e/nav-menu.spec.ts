import {expect, test, type Locator, type Page} from '@playwright/test';
import {expectNoSeriousA11yViolations} from './helpers/a11y';

// REQ-NAV-002 (P3B-02): the main navigation and mega menu come from the Shopify admin menu, which is OPT-IN: the
// header reads a menu only when the server's env file sets PUBLIC_NAV_MENU_HANDLE (otherwise the fixed navigation
// shows, and every other spec depends on that). This whole spec therefore skips unless the served page shows items
// built from a Shopify menu (nav ids `menu-<n>`).
//
// To run it, create a local, git-ignored env file next to the app's other ones, `storefront/.env.navmenu`, with the
// same store settings as the env file of the store you test (for example a copy of .env.demo, never printed or
// committed) plus the line
//   PUBLIC_NAV_MENU_HANDLE=main-menu
// then start a server on it and run:
//   E2E_PORT=6100 E2E_ENV_FILE=.env.navmenu npx playwright test tests/e2e/nav-menu.spec.ts
// On the default mock-store .env the spec reports every test as skipped; no other spec is affected by it.

async function gotoReady(page: Page, url = '/') {
  const response = await page.goto(url);
  await page.waitForLoadState('networkidle');
  return response;
}

const mainNav = (page: Page) => page.getByRole('navigation', {name: 'Main'});

async function fromShopifyMenu(page: Page): Promise<boolean> {
  return (await page.locator('[data-nav-top^="menu-"]').count()) > 0;
}

/** Clicks `trigger` until `target` is visible, so a click before hydration cannot leave the test stuck. */
async function openUntilVisible(trigger: Locator, target: Locator) {
  await expect(async () => {
    if (!(await target.isVisible())) await trigger.click({timeout: 2_000});
    await expect(target).toBeVisible({timeout: 2_000});
  }).toPass({timeout: 15_000});
}

test.beforeEach(async ({page}) => {
  await gotoReady(page);
  test.skip(
    !(await fromShopifyMenu(page)),
    'The fixed navigation is showing: set PUBLIC_NAV_MENU_HANDLE in the env file (see the header of this spec).',
  );
});

test.describe('REQ-NAV-002 desktop menu', () => {
  test.skip(
    ({isMobile}) => isMobile,
    'The desktop navigation is hidden below 1024 px.',
  );

  test('every top-level item is reachable by keyboard, in order, with Home and End', async ({
    page,
  }) => {
    await gotoReady(page);
    const tops = mainNav(page).locator('[data-nav-top]');
    const count = await tops.count();
    expect(count).toBeGreaterThan(1);

    await tops.first().focus();
    for (let index = 1; index < count; index += 1) {
      await page.keyboard.press('ArrowRight');
      await expect(tops.nth(index)).toBeFocused();
    }
    await page.keyboard.press('Home');
    await expect(tops.first()).toBeFocused();
    await page.keyboard.press('End');
    await expect(tops.last()).toBeFocused();
  });

  test('each item with children is a disclosure: it opens, Arrow Down enters, Escape closes and returns focus', async ({
    page,
  }) => {
    await gotoReady(page);
    const buttons = mainNav(page).locator('button[data-nav-top]');
    const count = await buttons.count();
    test.skip(count === 0, 'The live menu has no item with children.');

    for (let index = 0; index < count; index += 1) {
      const button = buttons.nth(index);
      await button.focus();
      await expect(button).toHaveAttribute('aria-expanded', 'false');
      await page.keyboard.press('Enter');
      await expect(button).toHaveAttribute('aria-expanded', 'true');

      await page.keyboard.press('ArrowDown');
      const panel = page.locator(
        `#${(await button.getAttribute('aria-controls')) ?? ''}`,
      );
      await expect(panel.getByRole('link').first()).toBeFocused();

      await page.keyboard.press('Escape');
      await expect(button).toHaveAttribute('aria-expanded', 'false');
      await expect(button).toBeFocused();
    }
  });

  test('an open menu has no serious accessibility violations', async ({
    page,
  }) => {
    await gotoReady(page);
    const button = mainNav(page).locator('button[data-nav-top]').first();
    test.skip((await button.count()) === 0, 'No item with children.');
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expectNoSeriousA11yViolations(page);
  });

  test('a menu built from Shopify has only working internal links and marked external ones', async ({
    page,
  }) => {
    await gotoReady(page);
    const hrefs = await mainNav(page)
      .locator('a[href]')
      .evaluateAll((anchors) =>
        anchors.map((anchor) => ({
          href: anchor.getAttribute('href') ?? '',
          rel: anchor.getAttribute('rel') ?? '',
        })),
      );
    expect(hrefs.length).toBeGreaterThan(0);

    const internal = new Set<string>();
    for (const {href, rel} of hrefs) {
      expect(href, 'no script or data URL').not.toMatch(/^(javascript|data):/i);
      if (href.startsWith('/')) {
        internal.add(href);
      } else {
        expect(href, 'an external link is https').toMatch(/^https:\/\//);
        expect(rel, 'an external link carries rel').toContain('noopener');
      }
    }

    for (const href of internal) {
      const response = await page.request.get(href);
      expect(response.status(), `${href} must not 404`).toBeLessThan(400);
    }
  });
});

test.describe('REQ-NAV-002 mobile accordion', () => {
  test.skip(
    ({isMobile}) => !isMobile,
    'The menu drawer is for widths below 1024 px.',
  );

  test('every section in the drawer opens and closes, and no link is empty', async ({
    page,
  }) => {
    await gotoReady(page);
    const menuButton = page
      .getByRole('banner')
      .getByRole('button', {name: 'Menu'});
    const drawer = page.getByRole('dialog', {name: 'Menu'});
    await openUntilVisible(menuButton, drawer);

    const nav = drawer.getByRole('navigation', {name: 'Mobile'});
    const triggers = nav.locator('button[aria-expanded]');
    const count = await triggers.count();
    test.skip(count === 0, 'The live menu has no item with children.');

    for (let index = 0; index < count; index += 1) {
      const trigger = triggers.nth(index);
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await trigger.click();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      const panel = page.locator(
        `#${(await trigger.getAttribute('aria-controls')) ?? ''}`,
      );
      await expect(panel.getByRole('link').first()).toBeVisible();
      await trigger.click();
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    }

    const hrefs = await nav
      .locator('a')
      .evaluateAll((anchors) =>
        anchors.map((anchor) => anchor.getAttribute('href') ?? ''),
      );
    for (const href of hrefs) {
      expect(href, 'every drawer link has a destination').toMatch(
        /^(\/|https:\/\/)/,
      );
    }
  });

  test('following a drawer link closes the drawer', async ({page}) => {
    await gotoReady(page);
    const menuButton = page
      .getByRole('banner')
      .getByRole('button', {name: 'Menu'});
    const drawer = page.getByRole('dialog', {name: 'Menu'});
    await openUntilVisible(menuButton, drawer);

    // A top-level link row (a collapsed section's links are hidden until it is opened).
    const link = drawer
      .getByRole('navigation', {name: 'Mobile'})
      .locator('a[data-accordion-row][href^="/"]')
      .first();
    test.skip(
      (await link.count()) === 0,
      'The live menu has no plain link row.',
    );
    await expect(link).toBeVisible();
    const href =
      ((await link.getAttribute('href')) ?? '/').split('?')[0] ?? '/';
    await link.click();
    await expect(drawer).toBeHidden();
    await expect.poll(() => new URL(page.url()).pathname).toBe(href);
  });
});
