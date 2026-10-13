import {expect, test, type Page} from '@playwright/test';
import {
  collectConsoleErrors,
  expectNoSeriousA11yViolations,
} from './helpers/a11y';

// P6-06 / P6-11: the store locator. REQ-LOC-001 (state, city and store pages with address, tap-to-call,
// hours, directions, JSON-LD, 404s), REQ-LOC-003 (set and clear "my store"), NFR-001 (360 px), NFR-003 (axe).
// The data is the synthetic fixtures (app/lib/stores/fixtures.ts). Times are not asserted exactly because the
// run date varies; the hours logic is unit-tested with a fixed clock in tests/unit/pages/stores-view.test.ts.

const STORE_PATH = '/stores/new-york/buffalo/buffalo-gallery';
const COOKIE = 'my_store';

async function gotoReady(page: Page, url: string) {
  const response = await page.goto(url);
  await page.waitForLoadState('networkidle');
  return response;
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, 'page-level horizontal overflow in px').toBeLessThanOrEqual(
    0,
  );
}

async function myStoreCookie(page: Page) {
  const cookies = await page.context().cookies();
  return cookies.find((cookie) => cookie.name === COOKIE);
}

test.describe('REQ-LOC-001 locator pages', () => {
  test('the index lists states with store counts, is accessible and quiet', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    const response = await gotoReady(page, '/stores');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', {level: 1})).toHaveText(
      'Find a store',
    );
    const newYork = page
      .getByRole('main')
      .getByRole('link', {name: /New York/});
    await expect(newYork).toContainText('2 stores');
    await expect(
      page.getByRole('main').getByRole('link', {name: /Texas/}),
    ).toContainText('2 stores');
    await expectNoSeriousA11yViolations(page);
    expect(errors, 'console errors').toEqual([]);
  });

  test('state, city and store pages are reachable by clicking through', async ({
    page,
  }) => {
    await gotoReady(page, '/stores');
    await page
      .getByRole('main')
      .getByRole('link', {name: /New York/})
      .click();
    await expect(page).toHaveURL(/\/stores\/new-york$/);
    await expect(page.getByRole('heading', {level: 1})).toHaveText(
      'Stores in New York',
    );
    await expect(
      page.getByRole('navigation', {name: 'Breadcrumb'}),
    ).toContainText('Stores');

    await page
      .getByRole('main')
      .getByRole('heading', {level: 2, name: 'Buffalo'})
      .getByRole('link')
      .click();
    await expect(page).toHaveURL(/\/stores\/new-york\/buffalo$/);
    await expect(page.getByRole('heading', {level: 1})).toHaveText(
      'Stores in Buffalo, NY',
    );

    await page
      .getByRole('main')
      .getByRole('link', {name: 'Wrenfield Sleep Gallery Buffalo', exact: true})
      .click();
    await expect(page).toHaveURL(new RegExp(`${STORE_PATH}$`));
    await expect(page.getByRole('heading', {level: 1})).toHaveText(
      'Wrenfield Sleep Gallery Buffalo',
    );
  });

  test('a store page has address, tap-to-call, status, weekly hours and directions', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    const response = await gotoReady(page, STORE_PATH);
    expect(response?.status()).toBe(200);
    const main = page.getByRole('main');

    await expect(page.getByRole('heading', {level: 1})).toHaveCount(1);
    await expect(main.getByText('100 Example Street').first()).toBeVisible();
    await expect(main.getByText('Buffalo, NY 14201').first()).toBeVisible();

    const call = main.getByRole('link', {name: /Call \(716\) 555-0101/});
    await expect(call).toHaveAttribute('href', 'tel:+17165550101');

    // Today's hours and an open or closed status in the store's time zone.
    await expect(main.getByText(/^(Open now|Closed)/).first()).toBeVisible();
    const hours = main.getByRole('table', {name: 'Opening hours for the week'});
    await expect(hours.getByRole('row')).toHaveCount(8); // header (visually hidden) and seven days
    await expect(hours.getByRole('row', {name: /Monday/})).toContainText(
      '10:00 AM – 9:00 PM',
    );
    await expect(hours.getByRole('row', {name: /Sunday/})).toContainText(
      'Closed',
    );
    await expect(hours).toContainText('(today)');

    // Directions go to Google Maps with the address only; no map library is loaded.
    const directions = main.getByRole('link', {name: /Get directions/});
    const href = (await directions.getAttribute('href')) ?? '';
    expect(href).toMatch(
      /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=/,
    );
    expect(href).toContain(encodeURIComponent('100 Example Street'));
    await expect(directions).toHaveAttribute('rel', /noopener/);
    await expect(page.locator('.leaflet-container')).toHaveCount(0);

    await expectNoSeriousA11yViolations(page);
    expect(errors, 'console errors').toEqual([]);
  });

  test('a store page carries valid LocalBusiness structured data that matches the page', async ({
    page,
  }) => {
    await gotoReady(page, STORE_PATH);
    const raw = await page
      .locator('script[type="application/ld+json"]')
      .first()
      .textContent();
    const data: unknown = JSON.parse(raw ?? 'null');
    expect(data).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      name: 'Wrenfield Sleep Gallery Buffalo',
      telephone: '+17165550101',
      address: {
        '@type': 'PostalAddress',
        streetAddress: '100 Example Street',
        addressLocality: 'Buffalo',
        addressRegion: 'NY',
        postalCode: '14201',
        addressCountry: 'US',
      },
    });
    expect(JSON.stringify(data)).toContain('openingHoursSpecification');
  });

  test('a sparse store shows what is missing without guessing', async ({
    page,
  }) => {
    await gotoReady(page, '/stores/oregon/portland/portland-pearl');
    const main = page.getByRole('main');
    await expect(main.getByText('Phone number not available.')).toBeVisible();
    await expect(
      main.getByText('Opening hours are not available for this store.', {
        exact: false,
      }),
    ).toBeVisible();
    await expect(main.getByText('Hours not available').first()).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('the state and city pages pass axe', async ({page}) => {
    for (const url of ['/stores/texas', '/stores/texas/austin']) {
      await gotoReady(page, url);
      await expect(page.getByRole('heading', {level: 1})).toHaveCount(1);
      await expectNoSeriousA11yViolations(page);
    }
  });
});

test.describe('REQ-LOC-001 unknown places are a 404 with the shell intact', () => {
  for (const url of [
    '/stores/atlantis',
    '/stores/new-york/nowhere',
    '/stores/new-york/buffalo/no-such-store',
    '/stores/%3Cscript%3E',
    '/stores/new-york/buffalo/../../etc',
  ]) {
    test(`${url}`, async ({page}) => {
      const response = await page.goto(url);
      expect(response?.status()).toBe(404);
      await expect(
        page.getByRole('heading', {name: 'Page not found'}),
      ).toBeVisible();
      // The header and footer are still there.
      await expect(page.getByRole('banner')).toBeVisible();
      await expect(page.getByRole('contentinfo')).toBeVisible();
    });
  }
});

test.describe('REQ-LOC-003 my store', () => {
  test('Set as my store sets a first-party cookie and Clear removes it', async ({
    page,
  }) => {
    await gotoReady(page, STORE_PATH);
    expect(await myStoreCookie(page)).toBeUndefined();

    await page
      .getByRole('main')
      .getByRole('button', {name: /Set as my store/})
      .click();
    await expect(page.getByText('This is your store.')).toBeVisible();

    const cookie = await myStoreCookie(page);
    expect(cookie?.value).toBe('new-york.buffalo.buffalo-gallery');
    expect(cookie?.sameSite).toBe('Lax');
    expect(cookie?.httpOnly).toBe(true);
    // Served over plain http in tests, so Secure is off; it is on for https (unit-tested).
    expect(cookie?.secure).toBe(false);
    expect(cookie?.domain).toBe('localhost');
    expect(cookie?.path).toBe('/');
    // Persists for a long time (a year), not just the session.
    expect(cookie?.expires).toBeGreaterThan(Date.now() / 1000 + 300 * 86400);

    // It survives a reload and shows on the list pages.
    await page.reload();
    await expect(page.getByText('This is your store.')).toBeVisible();
    await gotoReady(page, '/stores');
    await expect(page.getByRole('heading', {name: 'Your store'})).toBeVisible();
    await expect(
      page
        .getByRole('region', {name: 'Your store'})
        .or(page.locator('section', {hasText: 'Your store'}))
        .first()
        .getByText('My store', {exact: true}),
    ).toBeVisible();

    await gotoReady(page, STORE_PATH);
    await page
      .getByRole('main')
      .getByRole('button', {name: 'Clear my store'})
      .click();
    await expect(
      page.getByRole('button', {name: /Set as my store/}),
    ).toBeVisible();
    await expect(page.getByText('This is your store.')).toHaveCount(0);
    expect(await myStoreCookie(page)).toBeUndefined();
    await expect(page).toHaveURL(new RegExp(`${STORE_PATH}$`));
  });

  test('choosing a different store replaces the first', async ({page}) => {
    await gotoReady(page, STORE_PATH);
    await page
      .getByRole('main')
      .getByRole('button', {name: /Set as my store/})
      .click();
    await expect(page.getByText('This is your store.')).toBeVisible();

    await gotoReady(page, '/stores/texas/austin');
    await page
      .getByRole('main')
      .getByRole('button', {
        name: /Set as my store \(Larkmoor Sleep Austin North\)/,
      })
      .click();
    await expect(page).toHaveURL(/\/stores\/texas\/austin\/austin-north$/);
    expect((await myStoreCookie(page))?.value).toBe(
      'texas.austin.austin-north',
    );
    await gotoReady(page, '/stores/texas/austin');
    await expect(
      page.getByRole('main').getByText('My store', {exact: true}),
    ).toHaveCount(1);
  });

  test('a tampered cookie selects nothing and breaks nothing', async ({
    page,
    context,
  }) => {
    for (const value of [
      'new-york.buffalo.nope',
      '%3Cscript%3Ealert(1)%3C%2Fscript%3E',
      '../../etc/passwd',
      'a.b.c.d',
    ]) {
      await context.addCookies([
        {name: COOKIE, value, domain: 'localhost', path: '/'},
      ]);
      const response = await page.goto(STORE_PATH);
      expect(response?.status(), value).toBe(200);
      await expect(page.getByText('This is your store.')).toHaveCount(0);
      await expect(
        page.getByRole('main').getByRole('button', {name: /Set as my store/}),
      ).toBeVisible();
    }
  });

  test('a forged request for an unknown store is rejected and sets no cookie', async ({
    page,
    request,
  }) => {
    await gotoReady(page, '/stores');
    const response = await request.post('/stores', {
      form: {intent: 'set', store: 'new-york.buffalo.does-not-exist'},
      maxRedirects: 0,
    });
    expect(response.status()).toBe(400);
    expect(response.headers()['set-cookie']).toBeUndefined();

    // A valid key redirects only to our own store path, never to a caller-supplied address.
    const ok = await request.post('/stores', {
      form: {
        intent: 'set',
        store: 'new-york.buffalo.buffalo-gallery',
        redirectTo: 'https://evil.example',
      },
      maxRedirects: 0,
    });
    expect(ok.status()).toBe(302);
    expect(ok.headers()['location']).toBe(STORE_PATH);
  });
});

test.describe('NFR-001 layout at 360 px', () => {
  test('index, state, city and store pages have no horizontal scroll and pass axe', async ({
    page,
  }) => {
    await page.setViewportSize({width: 360, height: 740});
    for (const url of [
      '/stores',
      '/stores/new-york',
      '/stores/new-york/buffalo',
      STORE_PATH,
    ]) {
      await gotoReady(page, url);
      await noHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
    }
  });

  test('tap targets on a store card are at least 44 px', async ({page}) => {
    await page.setViewportSize({width: 360, height: 740});
    await gotoReady(page, '/stores/new-york/buffalo');
    const card = page.getByRole('article', {
      name: 'Wrenfield Sleep Gallery Buffalo',
    });
    for (const target of [
      card.getByRole('link', {name: /Call/}),
      card.getByRole('link', {name: /Directions/}),
      card.getByRole('button', {name: /Set as my store/}),
    ]) {
      const box = await target.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
});
