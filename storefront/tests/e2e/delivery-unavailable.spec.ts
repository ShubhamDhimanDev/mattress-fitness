import {expect, test, type Page} from '@playwright/test';
import {collectConsoleErrors} from './helpers/a11y';
import {gotoReady, ourErrors} from './helpers/catalog';

// REQ-DEL-001 / P3B-11 / BV-013 / NFR-001: when the deployment's DELIVERY_COOKIE_SECRET is missing or shorter than 32
// characters, a PRODUCTION build can neither save nor read a ZIP, so the server answers `service-unavailable` for every
// surface (app/lib/delivery-runtime/view.ts). The development server keeps the normal answer so mock stores stay
// usable, which means this state exists only in a built server: the spec runs against a production preview whose env
// file has NO usable DELIVERY_COOKIE_SECRET (a SESSION_SECRET of 32 or more characters is still needed, otherwise the
// build refuses to serve). From storefront/:
//   npx shopify hydrogen build
//   E2E_PROD_PREVIEW=1 E2E_DELIVERY_SECRET=unusable E2E_PORT=4410 E2E_ENV_FILE=.env.nodelivery \
//     npx playwright test tests/e2e/delivery-unavailable.spec.ts --workers=1 --project=desktop-chromium
// `E2E_DELIVERY_SECRET=unusable` is the operator's statement that the server under test was started that way; without
// it every test skips with a stated reason, and with it a page that does NOT show the unavailable text fails (the
// precondition is asserted, not assumed).

const UNUSABLE = process.env.E2E_DELIVERY_SECRET === 'unusable';
const PRODUCTION = process.env.E2E_PROD_PREVIEW === '1';
const TEXT = 'Delivery check unavailable';

test.skip(
  !UNUSABLE || !PRODUCTION,
  'Needs a production preview started on an env file without a usable DELIVERY_COOKIE_SECRET (E2E_PROD_PREVIEW=1 and E2E_DELIVERY_SECRET=unusable; see the header of this spec).',
);

const banner = (page: Page) => page.getByRole('banner');

async function overflowPx(page: Page) {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}

test.describe('delivery check unavailable (REQ-DEL-001, P3B-11)', () => {
  test('the header says the check is unavailable and offers no ZIP form that could never save', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await gotoReady(page, '/');
    await expect(banner(page).getByText(TEXT)).toBeVisible();
    await expect(
      banner(page).getByRole('button', {name: /delivery ZIP|Delivering to/i}),
    ).toHaveCount(0);
    await expect(
      banner(page).getByRole('link', {name: 'Select your store'}),
    ).toBeVisible();
    expect(ourErrors(errors)).toEqual([]);
  });

  test('the delivery page says it is unavailable and makes no yes or no promise', async ({
    page,
  }) => {
    const response = await page.request.get('/delivery');
    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(text).toContain('Delivery information is not available right now.');
    expect(text).not.toMatch(/In-home delivery is available/);
    expect(text).not.toMatch(/In-home delivery is not available to/);
  });

  test('saving a ZIP is refused with 503 and sets no cookie (nothing is kept that could not be verified)', async ({
    page,
    baseURL,
  }) => {
    const response = await page.request.post('/delivery', {
      headers: {origin: baseURL ?? ''},
      multipart: {intent: 'save', zip: '15222'},
    });
    expect(response.status()).toBe(503);
    expect(response.headers()['set-cookie'] ?? '').toBe('');
    expect(await response.text()).not.toContain('15222');
  });

  // BV-013: the unavailable text replaces the ZIP button, so it must not make the utility bar wrap. At 1024 px the
  // right-hand links take about 870 px, the tightest case; the others bracket it.
  for (const width of [320, 360, 412, 768, 1023, 1024, 1280]) {
    test(`BV-013 the utility bar is one row at ${width} px with the unavailable text`, async ({
      page,
    }, info) => {
      test.skip(
        info.project.name.includes('mobile'),
        'The width is set explicitly here, so the desktop project covers every width.',
      );
      await page.setViewportSize({width, height: 900});
      await gotoReady(page, '/');
      const notice = banner(page).getByText(TEXT);
      const store = banner(page).getByRole('link', {name: 'Select your store'});
      await expect(notice).toBeVisible();
      await expect(store).toBeVisible();
      // The 44 px control (icon and text) that replaces the ZIP button, not the 24 px text inside it: the existing
      // BV-006 test compares the same boxes (button against link).
      const [noticeBox, storeBox] = await Promise.all([
        notice.locator('xpath=..').boundingBox(),
        store.boundingBox(),
      ]);
      const barBox = await notice
        .locator('xpath=ancestor::div[contains(@class,"bg-surface-muted")][1]')
        .boundingBox();
      info.annotations.push({
        type: `utility bar ${width}`,
        description: JSON.stringify({
          noticeBox,
          storeBox,
          barHeight: barBox?.height,
        }),
      });
      expect(
        Math.abs((noticeBox?.y ?? 0) - (storeBox?.y ?? 99)),
        'the notice and the store link sit on one row',
      ).toBeLessThanOrEqual(2);
      expect(barBox?.height ?? 999, 'utility bar height').toBeLessThanOrEqual(
        56,
      );
      expect(await overflowPx(page), 'horizontal overflow').toBeLessThanOrEqual(
        0,
      );
      if (width >= 1024) {
        await expect(
          banner(page).getByRole('link', {name: 'Track order'}),
        ).toBeVisible();
      }
    });
  }
});
