import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
  type Request,
  type Response,
  type Route,
  type TestInfo,
} from '@playwright/test';
import {KNOWN_MOCK_SHOP_ERRORS} from './helpers/a11y';
import {gotoReady, ourErrors} from './helpers/catalog';
import {
  NETWORK_PROFILES,
  clickAndTime,
  collectEveryConsoleLine,
  cspConsoleLines,
  median,
  networkControl,
  nonceOf,
  readCspViolations,
  report,
  recordCspViolations,
  telemetryRefusalCount,
  unexpectedViolations,
  watchTraffic,
  type ConsoleLine,
  type NetworkProfileName,
  type OpenKind,
} from './helpers/csp';

// P7-06 on a PRODUCTION build: the four lazy shell panels (cart drawer contents, mobile menu, ZIP form, search
// suggestions) under Hydrogen's enforced nonce Content Security Policy AND the stricter report-only policy
// (docs/security/SECURITY_HEADERS.md), with timing, failure injection and keyboard checks. The dev server cannot
// prove any of this: it serves unbundled modules and a different policy, and a nonce or `script-src` mistake in the
// built chunks shows up only here.
//
// Run it only against a production preview whose env file has a usable DELIVERY_COOKIE_SECRET (without one the ZIP
// control is not rendered and the ZIP tests fail on purpose; the older .env.prodpreview lacks it). From storefront/:
//   npm run build
//   npx shopify hydrogen preview --port 4500 --env-file <file with the four base variables + DELIVERY_COOKIE_SECRET>
//   E2E_PROD_PREVIEW=1 E2E_PORT=4500 npx playwright test tests/e2e/lazy-panels-production.spec.ts --workers=1
// `--workers=1` matters only for the timing numbers (parallel workers share one CPU and skew them); the functional
// tests do not depend on it. Timing tests print `LAZY-TIMING` lines; they assert only loose guards, never a budget.

const PROD_PREVIEW = process.env.E2E_PROD_PREVIEW === '1';

type Panel = OpenKind | 'suggestions';

// Chunks are matched by module file name, which the production build keeps (hashed): /assets/CartMain-<hash>.js.
const CHUNK: Record<Panel, RegExp> = {
  cart: /\/assets\/CartMain-[\w-]+\.js/,
  menu: /\/assets\/MobileNav-[\w-]+\.js/,
  zip: /\/assets\/ZipForm-[\w-]+\.js/,
  suggestions: /\/assets\/SuggestionGroups-[\w-]+\.js/,
};

const SHOPIFY_CDN = 'https://cdn.shopify.com';

type Network = {requests: Request[]; responses: Response[]};

function watchNetwork(page: Page): Network {
  const network: Network = {requests: [], responses: []};
  page.on('request', (request) => network.requests.push(request));
  page.on('response', (response) => network.responses.push(response));
  return network;
}

const requested = (network: Network, panel: Panel) =>
  network.requests.some((request) => CHUNK[panel].test(request.url()));

const cartLink = (page: Page) =>
  page.getByRole('banner').getByRole('link', {name: 'Cart'});
const menuButton = (page: Page) => page.getByRole('button', {name: 'Menu'});
const zipButton = (page: Page) =>
  page.getByRole('button', {name: /delivery ZIP/i});
const searchField = (page: Page) =>
  page.getByRole('combobox', {name: 'Search products and pages'});

type Opened = {
  lines: ConsoleLine[];
  network: Network;
  /** Headers of the document response. */
  headers: Record<string, string>;
};

/** Starts every recorder, then loads the home page of the production preview and waits for hydration. */
async function openHome(
  page: Page,
  options: {narrow?: boolean} = {},
): Promise<Opened> {
  if (options.narrow) await page.setViewportSize({width: 390, height: 844});
  const lines = collectEveryConsoleLine(page);
  const network = watchNetwork(page);
  await recordCspViolations(page);
  const response = await gotoReady(page, '/');
  expect(response, 'the home page answered').not.toBeNull();
  return {lines, network, headers: (await response?.allHeaders()) ?? {}};
}

/**
 * The whole CSP bar for one page state: no violation event from either policy (except the one exact telemetry host,
 * DEC-045), no console line that mentions a policy or a nonce, and no other console error (the known mock-store
 * lines are the only ones dropped).
 */
async function expectNoCspTrouble(page: Page, lines: readonly ConsoleLine[]) {
  expect(
    unexpectedViolations(await readCspViolations(page)),
    'CSP violation events, enforced or report-only (telemetry host excepted)',
  ).toEqual([]);
  expect(
    cspConsoleLines(lines),
    'console lines about a policy or a nonce',
  ).toEqual([]);
  const errors = lines
    .filter((line) => line.type === 'error' || line.type === 'pageerror')
    .map((line) => line.text)
    .filter(
      (text) => !KNOWN_MOCK_SHOP_ERRORS.some((known) => text.includes(known)),
    );
  expect(ourErrors(errors), 'other console errors').toEqual([]);
}

/** Every request for the panel's chunk went to our own origin, under /assets/, and was answered 200 with JavaScript. */
function expectChunkFromOwnOrigin(page: Page, network: Network, panel: Panel) {
  const origin = new URL(page.url()).origin;
  const hits = network.responses.filter((response) =>
    CHUNK[panel].test(response.url()),
  );
  expect(hits.length, `${panel} chunk responses`).toBeGreaterThan(0);
  for (const response of hits) {
    const url = new URL(response.url());
    expect(url.origin, `${panel} chunk origin`).toBe(origin);
    expect(url.pathname.startsWith('/assets/')).toBe(true);
    expect(response.status(), `${panel} chunk status`).toBe(200);
    expect(response.headers()['content-type'] ?? '').toMatch(/javascript/);
  }
  // Nothing else that executes came from anywhere but us or Shopify's CDN (the only script origin the policies allow).
  const foreign = network.requests
    .filter((request) => request.resourceType() === 'script')
    .map((request) => new URL(request.url()).origin)
    .filter(
      (scriptOrigin) => scriptOrigin !== origin && scriptOrigin !== SHOPIFY_CDN,
    );
  expect(foreign, 'scripts from other origins').toEqual([]);
}

const dialogNamed = (page: Page, name: string) =>
  page.getByRole('dialog', {name});

test.describe('P7-06 lazy panels on a production build', () => {
  test.skip(
    !PROD_PREVIEW,
    'needs a production preview (npm run build, then shopify hydrogen preview) and E2E_PROD_PREVIEW=1; see the top of this file',
  );
  test.setTimeout(120_000);

  test('the server is a production build and sends both policies with one shared nonce', async ({
    page,
  }) => {
    const {headers} = await openHome(page);
    const html = await page.content();
    expect(html).not.toContain('/@vite/client');
    expect(html).toContain('/assets/');

    const enforced = headers['content-security-policy'];
    const reportOnly = headers['content-security-policy-report-only'];
    expect(enforced, 'enforced policy').toBeTruthy();
    expect(reportOnly, 'report-only policy').toBeTruthy();
    const nonce = nonceOf(enforced);
    expect(nonce, 'nonce in the enforced policy').not.toBeNull();
    expect(nonceOf(reportOnly), 'same nonce in the report-only policy').toBe(
      nonce,
    );
    // Neither policy may allow inline or eval script.
    expect(`${enforced} ${reportOnly}`).not.toMatch(/unsafe-eval/);
    expect(reportOnly).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(enforced).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  test('every executable inline script carries the response nonce (no inline-script nonce error is possible)', async ({
    page,
  }) => {
    const {headers, lines} = await openHome(page);
    const nonce = nonceOf(headers['content-security-policy']);
    const inline = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll<HTMLScriptElement>('script:not([src])'),
      )
        .filter((script) =>
          ['', 'module', 'text/javascript'].includes(script.type),
        )
        .map((script) => script.nonce),
    );
    expect(
      inline.length,
      'executable inline scripts on the page',
    ).toBeGreaterThan(0);
    expect(inline.every((value) => value === nonce)).toBe(true);
    await expectNoCspTrouble(page, lines);
  });

  test('the known telemetry refusal is the only policy message on the home page, and it is recorded', async ({
    page,
  }) => {
    const {lines} = await openHome(page);
    // Evidence only: how often Shopify's consent script was refused its telemetry host on this load.
    report(
      `LAZY-CSP telemetry refusals on first load: ${telemetryRefusalCount(lines)}`,
    );
    expect(cspConsoleLines(lines)).toEqual([]);
  });

  test.describe('each chunk loads and the panel works under both policies', () => {
    for (const mode of ['preloaded by focus', 'on demand'] as const) {
      test(`cart drawer (${mode})`, async ({page}) => {
        const {lines, network} = await openHome(page);
        const trigger = cartLink(page);
        expect(requested(network, 'cart'), 'not in the first load').toBe(false);
        if (mode === 'on demand') {
          await trigger.evaluate((element) => (element as HTMLElement).click());
        } else {
          await trigger.focus();
          await expect.poll(() => requested(network, 'cart')).toBe(true);
          await trigger.press('Enter');
        }
        const drawer = dialogNamed(page, 'Cart');
        await expect(drawer.getByText(/added anything yet/)).toBeVisible();
        await expect(drawer.getByRole('button', {name: 'Close'})).toBeFocused();
        expectChunkFromOwnOrigin(page, network, 'cart');
        await expectNoCspTrouble(page, lines);
      });

      test(`mobile menu (${mode})`, async ({page}) => {
        const {lines, network} = await openHome(page, {narrow: true});
        const trigger = menuButton(page);
        expect(requested(network, 'menu'), 'not in the first load').toBe(false);
        if (mode === 'on demand') {
          await trigger.evaluate((element) => (element as HTMLElement).click());
        } else {
          await trigger.focus();
          await expect.poll(() => requested(network, 'menu')).toBe(true);
          await trigger.press('Enter');
        }
        const drawer = dialogNamed(page, 'Menu');
        await expect(
          drawer.getByRole('navigation', {name: 'Mobile'}),
        ).toBeVisible();
        await expect(drawer.getByRole('button', {name: 'Close'})).toBeFocused();
        expectChunkFromOwnOrigin(page, network, 'menu');
        await expectNoCspTrouble(page, lines);
      });

      test(`ZIP form (${mode})`, async ({page}) => {
        const {lines, network} = await openHome(page);
        const trigger = zipButton(page);
        await expect(
          trigger,
          'the ZIP control is rendered (the env file needs a usable DELIVERY_COOKIE_SECRET)',
        ).toBeVisible();
        expect(requested(network, 'zip'), 'not in the first load').toBe(false);
        if (mode === 'on demand') {
          await trigger.evaluate((element) => (element as HTMLElement).click());
        } else {
          await trigger.focus();
          await expect.poll(() => requested(network, 'zip')).toBe(true);
          await trigger.press('Enter');
        }
        const dialog = dialogNamed(page, 'Delivery ZIP code');
        // On demand the form may arrive after the dialog frame; focus must still end in the field (WCAG 2.4.3).
        await expect(
          dialog.getByRole('textbox', {name: 'ZIP code'}),
        ).toBeFocused();
        expectChunkFromOwnOrigin(page, network, 'zip');
        await expectNoCspTrouble(page, lines);
      });
    }

    test('search suggestions', async ({page}) => {
      const {lines, network} = await openHome(page);
      expect(requested(network, 'suggestions'), 'not in the first load').toBe(
        false,
      );
      const search = searchField(page);
      await search.focus();
      await expect.poll(() => requested(network, 'suggestions')).toBe(true);
      await search.fill('bed');
      const listbox = page.getByRole('listbox', {name: 'Search suggestions'});
      await expect(listbox).toBeVisible();
      await expect(listbox.getByRole('option').last()).toBeVisible();
      expectChunkFromOwnOrigin(page, network, 'suggestions');
      await expectNoCspTrouble(page, lines);
    });

    test('all four panels in one session, one after the other, leave the policy logs clean', async ({
      page,
    }) => {
      const {lines, network} = await openHome(page, {narrow: true});
      await cartLink(page).click();
      await expect(
        dialogNamed(page, 'Cart').getByText(/added anything yet/),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await menuButton(page).click();
      await expect(
        dialogNamed(page, 'Menu').getByRole('navigation', {name: 'Mobile'}),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await zipButton(page).click();
      await expect(
        dialogNamed(page, 'Delivery ZIP code').getByRole('textbox', {
          name: 'ZIP code',
        }),
      ).toBeFocused();
      await page.keyboard.press('Escape');
      await searchField(page).fill('bed');
      await expect(
        page
          .getByRole('listbox', {name: 'Search suggestions'})
          .getByRole('option')
          .last(),
      ).toBeVisible();
      for (const panel of ['cart', 'menu', 'zip', 'suggestions'] as const) {
        expectChunkFromOwnOrigin(page, network, panel);
      }
      await expectNoCspTrouble(page, lines);
    });
  });

  test.describe('keyboard: open, close, focus comes back', () => {
    test('cart link: Enter opens, Escape closes, focus returns to the link', async ({
      page,
    }) => {
      await openHome(page);
      const trigger = cartLink(page);
      await trigger.focus();
      await page.keyboard.press('Enter');
      const drawer = dialogNamed(page, 'Cart');
      await expect(drawer.getByText(/added anything yet/)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();
      await expect(trigger).toBeFocused();
    });

    for (const key of ['Enter', 'Space'] as const) {
      test(`menu button: ${key} opens, Escape closes, focus returns to the button`, async ({
        page,
      }) => {
        await openHome(page, {narrow: true});
        const trigger = menuButton(page);
        await trigger.focus();
        await page.keyboard.press(key);
        const drawer = dialogNamed(page, 'Menu');
        await expect(
          drawer.getByRole('navigation', {name: 'Mobile'}),
        ).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(drawer).toBeHidden();
        await expect(trigger).toBeFocused();
      });

      test(`ZIP button: ${key} opens, focus lands in the field, Escape closes, focus returns to the button`, async ({
        page,
      }) => {
        await openHome(page);
        const trigger = zipButton(page);
        await trigger.focus();
        await page.keyboard.press(key);
        const dialog = dialogNamed(page, 'Delivery ZIP code');
        await expect(
          dialog.getByRole('textbox', {name: 'ZIP code'}),
        ).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(trigger).toBeFocused();
      });
    }

    test('Escape pressed while the chunk is still downloading closes the panel cleanly, and the next open works', async ({
      page,
      browserName,
    }) => {
      test.skip(
        browserName !== 'chromium',
        'network throttling uses the DevTools protocol',
      );
      const {lines, network} = await openHome(page);
      const control = await networkControl(page);
      await control.apply(NETWORK_PROFILES.slow3g);
      const trigger = zipButton(page);
      // Pointing at the button starts the (slow) download; the press opens the dialog while it is still on its way.
      await trigger.focus();
      await trigger.click();
      const dialog = dialogNamed(page, 'Delivery ZIP code');
      // The skeleton is on screen while the form's chunk crawls in.
      await expect(dialog.getByRole('status')).toContainText('Loading');
      await expect(dialog.getByRole('textbox', {name: 'ZIP code'})).toHaveCount(
        0,
      );
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
      // The download finishes after the panel closed: no error, no stray state update.
      await expect.poll(() => requested(network, 'zip')).toBe(true);
      await page.waitForLoadState('networkidle');
      await control.apply(NETWORK_PROFILES.unthrottled);
      await trigger.press('Enter');
      await expect(
        dialogNamed(page, 'Delivery ZIP code').getByRole('textbox', {
          name: 'ZIP code',
        }),
      ).toBeFocused();
      await expectNoCspTrouble(page, lines);
    });

    test('search field: ArrowDown moves through the suggestions and Escape closes them, focus stays in the field', async ({
      page,
    }) => {
      await openHome(page);
      const search = searchField(page);
      await search.fill('bed');
      const listbox = page.getByRole('listbox', {name: 'Search suggestions'});
      await expect(listbox.getByRole('option').last()).toBeVisible();
      await page.keyboard.press('ArrowDown');
      await expect(search).toHaveAttribute('aria-activedescendant', /.+/);
      await page.keyboard.press('Escape');
      await expect(listbox).toBeHidden();
      await expect(search).toBeFocused();
    });
  });

  test.describe('a chunk that cannot be loaded shows the panel failure, not the root error screen', () => {
    const rootErrorHeading = (page: Page) =>
      page.getByRole('heading', {name: /something went wrong|page not found/i});

    /** The browser's own echo of the injected failure, and React's report of the caught error: expected, named exactly. */
    function unexpectedFailureLines(
      lines: readonly ConsoleLine[],
      panel: Panel,
    ): string[] {
      return (
        lines
          .filter((line) =>
            ['error', 'warning', 'pageerror'].includes(line.type),
          )
          .filter(
            (line) =>
              !(
                line.text.startsWith('Failed to load resource') &&
                CHUNK[panel].test(line.url)
              ),
          )
          .filter(
            (line) =>
              !KNOWN_MOCK_SHOP_ERRORS.some((known) =>
                line.text.includes(known),
              ),
          )
          .map((line) => `${line.type}: ${line.text}`)
          .filter((text) => ourErrors([text]).length > 0)
          // Chromium's wording for a module that would not load (any Chromium version), and the page error React rethrows.
          .filter(
            (text) =>
              !/dynamically imported module|Importing a module script failed|Failed to load module script|Failed to fetch/i.test(
                text,
              ),
          )
      );
    }

    const FAILURES: {name: string; fail: (route: Route) => Promise<void>}[] = [
      {
        name: 'the request is aborted (network error)',
        fail: (route) => route.abort('failed'),
      },
      {
        name: 'the server answers 404 (a stale chunk after a deployment)',
        fail: (route) =>
          route.fulfill({status: 404, contentType: 'text/plain', body: 'gone'}),
      },
      {
        name: 'the server answers 200 with an HTML page (a catch-all fallback)',
        fail: (route) =>
          route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: '<!doctype html><title>x</title>',
          }),
      },
    ];

    for (const {name, fail} of FAILURES) {
      test(`cart drawer, ${name}: the drawer says so and links to /cart`, async ({
        page,
      }) => {
        const {lines} = await openHome(page);
        await page.route(CHUNK.cart, fail);
        await cartLink(page).click();
        const drawer = dialogNamed(page, 'Cart');
        await expect(
          drawer.getByRole('alert').filter({hasText: 'could not be loaded'}),
        ).toBeVisible();
        const link = drawer.getByRole('link', {name: 'Open the cart page'});
        await expect(link).toHaveAttribute('href', '/cart');
        await expect(rootErrorHeading(page)).toHaveCount(0);
        // The rest of the shell still works: the drawer closes and the page behind it is intact.
        await page.keyboard.press('Escape');
        await expect(drawer).toBeHidden();
        await expect(page.getByRole('banner')).toBeVisible();
        expect(unexpectedFailureLines(lines, 'cart')).toEqual([]);
      });
    }

    test('cart drawer: the "Open the cart page" link works once the chunk is reachable again', async ({
      page,
    }) => {
      await openHome(page);
      await page.route(CHUNK.cart, (route) => route.abort('failed'));
      await cartLink(page).click();
      const drawer = dialogNamed(page, 'Cart');
      const link = drawer.getByRole('link', {name: 'Open the cart page'});
      await expect(link).toBeVisible();
      await page.unroute(CHUNK.cart);
      await link.click();
      await expect(page).toHaveURL(/\/cart$/);
      await expect(
        page.getByRole('heading', {name: /your cart is empty/i}),
      ).toBeVisible();
    });

    test('mobile menu: the drawer says so and links to all products', async ({
      page,
    }) => {
      const {lines} = await openHome(page, {narrow: true});
      await page.route(CHUNK.menu, (route) => route.abort('failed'));
      await menuButton(page).click();
      const drawer = dialogNamed(page, 'Menu');
      await expect(
        drawer.getByRole('alert').filter({hasText: 'could not be loaded'}),
      ).toBeVisible();
      await expect(
        drawer.getByRole('link', {name: 'Browse all products'}),
      ).toHaveAttribute('href', '/collections');
      await expect(rootErrorHeading(page)).toHaveCount(0);
      expect(unexpectedFailureLines(lines, 'menu')).toEqual([]);
    });

    test('ZIP form: the dialog says so and offers a reload that works', async ({
      page,
    }) => {
      const {lines} = await openHome(page);
      await page.route(CHUNK.zip, (route) => route.abort('failed'));
      await zipButton(page).click();
      const dialog = dialogNamed(page, 'Delivery ZIP code');
      await expect(
        dialog.getByRole('alert').filter({hasText: 'could not be loaded'}),
      ).toBeVisible();
      await expect(rootErrorHeading(page)).toHaveCount(0);
      expect(unexpectedFailureLines(lines, 'zip')).toEqual([]);

      await page.unroute(CHUNK.zip);
      await Promise.all([
        page.waitForEvent('load'),
        dialog.getByRole('button', {name: 'Reload the page'}).click(),
      ]);
      await page.waitForLoadState('networkidle');
      await zipButton(page).click();
      await expect(
        dialogNamed(page, 'Delivery ZIP code').getByRole('textbox', {
          name: 'ZIP code',
        }),
      ).toBeFocused();
    });

    test('search suggestions: with the chunk blocked the field still searches (Enter) and no error screen appears', async ({
      page,
    }) => {
      const {lines} = await openHome(page);
      await page.route(CHUNK.suggestions, (route) => route.abort('failed'));
      const search = searchField(page);
      await search.fill('bed');
      await expect(rootErrorHeading(page)).toHaveCount(0);
      await expect(search).toBeFocused();
      await search.press('Enter');
      await expect(page).toHaveURL(/\/search\?.*q=bed/);
      await expect(rootErrorHeading(page)).toHaveCount(0);
      expect(unexpectedFailureLines(lines, 'suggestions')).toEqual([]);
    });

    // QA-P7-L1 (fixed): a failed download no longer poisons the panel. React.lazy keeps its rejected result, so the
    // helper hands out a fresh lazy component after a failure; "Try again" mounts the panel again in place, and so does
    // closing and reopening the drawer. Before the fix the first reopening still failed and recovery within four
    // reopenings was not guaranteed (Minor defect found by QA on 2026-10-16).
    async function failPanelOnce(
      page: Page,
      panel: Panel,
      dialogName: string,
      trigger: (page: Page) => Locator,
    ) {
      await openHome(page);
      let chunkUrl = '';
      const failing = (route: Route) => {
        chunkUrl = route.request().url();
        return route.abort('failed');
      };
      await page.route(CHUNK[panel], failing);
      const drawer = dialogNamed(page, dialogName);
      await trigger(page).click();
      await expect(
        drawer.getByRole('alert').filter({hasText: 'could not be loaded'}),
      ).toBeVisible();
      return {
        drawer,
        // Releases the failure and proves the network is back before the shopper tries again (the unroute reaches the
        // browser asynchronously).
        restore: async () => {
          await page.unroute(CHUNK[panel], failing);
          await expect
            .poll(() =>
              page.evaluate(
                async (url) => (await fetch(url, {cache: 'no-store'})).status,
                chunkUrl,
              ),
            )
            .toBe(200);
        },
      };
    }

    const failCartOnce = (page: Page) =>
      failPanelOnce(page, 'cart', 'Cart', cartLink);

    test('recovery: "Try again" shows the cart contents in place, without a page reload, once the network is back', async ({
      page,
    }) => {
      const {drawer, restore} = await failCartOnce(page);
      await page.evaluate(() => {
        (window as unknown as {reloadMarker: boolean}).reloadMarker = true;
      });
      await restore();
      await drawer.getByRole('button', {name: 'Try again'}).click();
      await expect(drawer.getByText(/added anything yet/)).toBeVisible();
      // The pressed button is gone; focus goes to the first tabbable element of the drawer, not to the page behind it
      // and not left on the drawer container (WCAG 2.4.3).
      await expect(drawer.getByRole('button', {name: 'Close'})).toBeFocused();
      await expect(
        drawer.getByRole('alert').filter({hasText: 'could not be loaded'}),
      ).toHaveCount(0);
      expect(
        await page.evaluate(
          () => (window as unknown as {reloadMarker?: boolean}).reloadMarker,
        ),
        'the document was not reloaded',
      ).toBe(true);
      await expect(rootErrorHeading(page)).toHaveCount(0);
    });

    test('recovery: "Try again" in the ZIP dialog shows the form in place and focus lands in the ZIP field', async ({
      page,
    }) => {
      const {drawer: dialog, restore} = await failPanelOnce(
        page,
        'zip',
        'Delivery ZIP code',
        zipButton,
      );
      await restore();
      await dialog.getByRole('button', {name: 'Try again'}).click();
      await expect(
        dialog.getByRole('textbox', {name: 'ZIP code'}),
      ).toBeFocused();
      await expect(
        dialog.getByRole('alert').filter({hasText: 'could not be loaded'}),
      ).toHaveCount(0);
      await expect(rootErrorHeading(page)).toHaveCount(0);
    });

    test('recovery: closing and reopening the drawer after the network is back shows the cart contents the first time', async ({
      page,
    }) => {
      const {drawer, restore} = await failCartOnce(page);
      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();
      await restore();
      await cartLink(page).click();
      await expect(drawer.getByText(/added anything yet/)).toBeVisible();
      await expect(rootErrorHeading(page)).toHaveCount(0);
    });

    test('recovery: while the network is still down "Try again" shows the failure and the cart page link again, and a later try works', async ({
      page,
    }) => {
      const {drawer, restore} = await failCartOnce(page);
      await drawer.getByRole('button', {name: 'Try again'}).click();
      await expect(
        drawer.getByRole('alert').filter({hasText: 'could not be loaded'}),
      ).toBeVisible();
      await expect(
        drawer.getByRole('link', {name: 'Open the cart page'}),
      ).toHaveAttribute('href', '/cart');
      // The keyboard user keeps their place on the new button.
      await expect(
        drawer.getByRole('button', {name: 'Try again'}),
      ).toBeFocused();
      await restore();
      await drawer.getByRole('button', {name: 'Try again'}).click();
      await expect(drawer.getByText(/added anything yet/)).toBeVisible();
    });

    test('search suggestions: with the chunk blocked the listbox still offers "View all results" and the status says suggestions are unavailable', async ({
      page,
    }) => {
      await openHome(page);
      await page.route(CHUNK.suggestions, (route) => route.abort('failed'));
      const search = searchField(page);
      await search.fill('bed');
      const listbox = page.getByRole('listbox', {name: 'Search suggestions'});
      const viewAll = listbox.getByRole('option', {name: /View all results/});
      await expect(viewAll).toBeVisible();
      await expect(
        page
          .getByRole('status')
          .filter({hasText: 'Suggestions are unavailable'}),
      ).toHaveText('Suggestions are unavailable. Press Enter to search.');
      await search.press('ArrowDown');
      await expect(search).toHaveAttribute('aria-activedescendant', /.+/);
      await search.press('Enter');
      await expect(page).toHaveURL(/\/search\?.*q=bed/);
      await expect(rootErrorHeading(page)).toHaveCount(0);
    });
  });
});

// --------------------------------------------------------------------------------------------------------------
// First-open timing. Numbers are evidence, not a budget (nothing is approved, Q-012): the machine, the mock store and
// the absence of a CDN move them. Guards are loose on purpose.
// --------------------------------------------------------------------------------------------------------------

const REPEATS = 3;

/** A new browser context shaped like the current project (viewport, device flags), so nothing is cached from before. */
async function freshVisit(
  browser: Browser,
  testInfo: TestInfo,
  options: {narrow?: boolean} = {},
) {
  const use = testInfo.project.use;
  const context = await browser.newContext({
    baseURL: use.baseURL,
    userAgent: use.userAgent,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    deviceScaleFactor: use.deviceScaleFactor,
    viewport: options.narrow ? {width: 390, height: 844} : use.viewport,
  });
  const page = await context.newPage();
  return {page, close: () => context.close()};
}
const MODES = ['on demand', 'pressed 100 ms', 'preloaded'] as const;
type Mode = (typeof MODES)[number];
const PROFILES: readonly NetworkProfileName[] = [
  'unthrottled',
  'fast3g',
  'slow3g',
];

test.describe('P7-06 first-open timing on a production build (Chromium, fresh context per measurement, network throttled by DevTools)', () => {
  test.skip(
    !PROD_PREVIEW,
    'needs a production preview and E2E_PROD_PREVIEW=1; see the top of this file',
  );
  test.setTimeout(300_000);

  const triggerOf = (page: Page, kind: OpenKind): Locator =>
    kind === 'cart'
      ? cartLink(page)
      : kind === 'menu'
        ? menuButton(page)
        : zipButton(page);

  for (const kind of ['cart', 'menu', 'zip'] as const) {
    for (const profileName of PROFILES) {
      test(`${kind} on ${profileName}: click to panel ready with and without a preload`, async ({
        browser,
        browserName,
      }, testInfo) => {
        test.skip(browserName !== 'chromium', 'DevTools protocol throttling');
        const results = new Map<
          Mode,
          {
            ready: number[];
            skeleton: boolean[];
            jsRequests: number[];
            jsBytes: number[];
          }
        >();

        for (const mode of MODES) {
          const bucket = {
            ready: [] as number[],
            skeleton: [] as boolean[],
            jsRequests: [] as number[],
            jsBytes: [] as number[],
          };
          results.set(mode, bucket);
          for (let repeat = 0; repeat < REPEATS; repeat += 1) {
            // A fresh context per measurement: empty HTTP cache and module map, like a first visit.
            const visit = await freshVisit(browser, testInfo, {
              narrow: kind === 'menu',
            });
            try {
              const {page} = visit;
              const control = await networkControl(page);
              const traffic = watchTraffic(page);
              await gotoReady(page, '/');
              const trigger = triggerOf(page, kind);
              await expect(trigger).toBeVisible();
              await control.apply(NETWORK_PROFILES[profileName]);
              if (mode === 'preloaded') {
                const chunk = page.waitForResponse((response) =>
                  CHUNK[kind].test(response.url()),
                );
                await trigger.hover();
                await (await chunk).finished();
                await traffic.idle();
              }
              traffic.mark();
              const measured = await clickAndTime(
                trigger,
                kind,
                mode === 'pressed 100 ms' ? 100 : 0,
              );
              expect(
                measured.readyMs,
                `${kind} ${mode} ${profileName} became ready`,
              ).toBeGreaterThan(0);
              await traffic.idle();
              bucket.ready.push(measured.readyMs);
              bucket.skeleton.push(measured.skeletonSeen);
              const onOpen = traffic.sinceMark();
              bucket.jsRequests.push(onOpen.length);
              bucket.jsBytes.push(
                onOpen.reduce((sum, item) => sum + item.bytes, 0),
              );
            } finally {
              await visit.close();
            }
          }
        }

        const lines: string[] = [];
        for (const [mode, bucket] of results) {
          lines.push(
            `LAZY-TIMING project=${testInfo.project.name} panel=${kind} network=${profileName} mode="${mode}" ` +
              `readyMs=[${bucket.ready.map((value) => Math.round(value)).join(',')}] ` +
              `medianMs=${Math.round(median(bucket.ready))} skeletonSeen=${bucket.skeleton.filter(Boolean).length}/${REPEATS} ` +
              `jsRequestsOnOpen=${median(bucket.jsRequests)} jsBytesOnOpen=${median(bucket.jsBytes)}`,
          );
        }
        for (const line of lines) report(line);
        await testInfo.attach(`timing-${kind}-${profileName}.txt`, {
          body: lines.join('\n'),
          contentType: 'text/plain',
        });

        // Guards, not budgets. A preloaded panel is already in memory: opening it must not wait for the network, so
        // it stays fast on every profile. On a slow link an on-demand open has to show the skeleton, not a blank
        // frame, while it waits.
        const preloaded = results.get('preloaded');
        expect(median(preloaded?.ready ?? [Number.NaN])).toBeLessThan(1500);
        if (profileName === 'slow3g') {
          const onDemand = results.get('on demand');
          expect(
            onDemand?.skeleton.every(Boolean),
            'the skeleton was shown on every slow on-demand open',
          ).toBe(true);
        }
      });
    }
  }

  for (const profileName of PROFILES) {
    test(`search suggestions on ${profileName}: typing right after focus versus typing after the chunk arrived`, async ({
      browser,
      browserName,
    }, testInfo) => {
      test.skip(browserName !== 'chromium', 'DevTools protocol throttling');
      const fresh: number[] = [];
      const warm: number[] = [];
      for (let repeat = 0; repeat < REPEATS; repeat += 1) {
        for (const mode of ['typed at once', 'chunk already loaded'] as const) {
          const visit = await freshVisit(browser, testInfo);
          try {
            const {page} = visit;
            const control = await networkControl(page);
            const traffic = watchTraffic(page);
            await gotoReady(page, '/');
            const search = searchField(page);
            await control.apply(NETWORK_PROFILES[profileName]);
            const chunk = page.waitForResponse((response) =>
              CHUNK.suggestions.test(response.url()),
            );
            await search.focus();
            if (mode === 'chunk already loaded') {
              await (await chunk).finished();
              await traffic.idle();
            }
            const started = Date.now();
            await search.fill('bed');
            const option = page
              .getByRole('listbox', {name: 'Search suggestions'})
              .getByRole('option')
              .last();
            await expect(option).toBeVisible({timeout: 60_000});
            (mode === 'typed at once' ? fresh : warm).push(
              Date.now() - started,
            );
          } finally {
            await visit.close();
          }
        }
      }
      const line =
        `LAZY-TIMING project=${testInfo.project.name} panel=suggestions network=${profileName} ` +
        `typedAtOnceMs=[${fresh.join(',')}] median=${median(fresh)} chunkLoadedMs=[${warm.join(',')}] median=${median(warm)} ` +
        `(Playwright round trips included; the predictive-search request is throttled too)`;
      report(line);
      await testInfo.attach(`timing-suggestions-${profileName}.txt`, {
        body: line,
        contentType: 'text/plain',
      });
      expect(median(warm)).toBeLessThan(60_000);
    });
  }
});
