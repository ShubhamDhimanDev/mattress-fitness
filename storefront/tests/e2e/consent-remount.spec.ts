import {expect, test, type Page} from '@playwright/test';
import {firstProductPath, gotoReady} from './helpers/catalog';
import {
  ANALYTICS_ON,
  ANY_PROVIDER_HOST,
  BANNER_WAIT,
  CONSENT_CHUNK,
  GA_HOST,
  GA_ID,
  META_HOST,
  PROVIDER_COOKIE,
  banner,
  clientNavigate,
  controlIdle,
  cookieNames,
  createGate,
  dataLayer,
  dataLayerText,
  expectSamePage,
  footerPrivacyButton,
  gaDisableFlag,
  gaEvents,
  markWindow,
  metaCalls,
  metaCallsText,
  plantProviderCookies,
  quietPeriod,
  requestsFor,
  scripts,
  showBanner,
  storeDecision,
  stubProviders,
  watchRequests,
} from './helpers/analytics';

// P7-01 follow-up round (V-E204 onwards in progress/TEST_RESULTS.md): the fixes of commit 22c5408 (code re-review M-1,
// m-2..m-9; security A-M1, A-L1..A-L3). REQ-ANL-001, REQ-ANL-002, NFR-011, NFR-013, threat T-05.
//
// UNVERIFIED against Google and Meta: the provider hosts are answered by a stub at the network layer and the stubbed
// gtag.js defines nothing, so "an event was sent" is read from `window.dataLayer` and `window.fbq.queue`, and "a hit
// carried the private address" can only be shown for what the page itself hands to the providers. A-M1 therefore stays
// open until a real GA4 DebugView and Meta Test Events check (CLR-004): what these tests prove is that our pause is in
// place BEFORE the address changes, which is the control the finding asked for.
//
// Server configurations: the blocks marked "analytics on" need E2E_ANALYTICS=on with E2E_ENV_FILE=.env.analyticsqa (dev
// server, and the production preview with E2E_PROD_PREVIEW=1). The Referrer-Policy block needs no ids and runs everywhere.

const ALL = {analytics: true, marketing: true};
const MISSING_PATHS = ['/products/qa-no-such-product', '/qa-no-such-page'];

const goBackHome = (page: Page) =>
  page.getByRole('main').getByRole('link', {name: 'Back to the home page'});

/** The shell has remounted its consent layer once its footer button is back (the chunk publishes the store). */
const consentLayerMounted = (page: Page) =>
  expect(footerPrivacyButton(page)).toBeVisible(BANNER_WAIT);

test.describe('one consent layer survives the app and the error boundary swapping (code re-review M-1) (REQ-ANL-001, NFR-011)', () => {
  test.skip(!ANALYTICS_ON, 'needs E2E_ANALYTICS=on and an env file with ids');

  for (const missing of MISSING_PATHS) {
    test(`stored consent, a route error at ${missing}, then a valid page: one gtag script, one fbevents script, one config call, view_item once, no repeated script request`, async ({
      page,
      baseURL,
    }) => {
      const requests = await stubProviders(page);
      const chunkRequests = watchRequests(page, CONSENT_CHUNK);
      // Found before the decision is stored, so the listing visit does not count as a load of the tags.
      const product = await firstProductPath(page, '/collections/all');
      // The listing visit is a document load of its own (it asked for the consent chunk): count from the next one.
      chunkRequests.length = 0;
      await storeDecision(page, baseURL, ALL);
      await gotoReady(page, '/');
      await expect
        .poll(() => requestsFor.gtag(requests), BANNER_WAIT)
        .toHaveLength(1);
      await expect
        .poll(() => requestsFor.fbevents(requests), BANNER_WAIT)
        .toHaveLength(1);
      await expect
        .poll(async () =>
          (await dataLayer(page)).some(
            (entry) => entry.kind === 'config' && entry.name === GA_ID,
          ),
        )
        .toBe(true);
      await markWindow(page);
      expect(await scripts.gtag(page), 'gtag/js elements before the swap').toBe(
        1,
      );
      expect(
        await scripts.fbevents(page),
        'fbevents.js elements before the swap',
      ).toBe(1);

      // Control: a product page reached by client navigation with no error page before it. The dev server's React
      // StrictMode runs the product page's publish effect twice (V-E205), so the count per visit is measured here
      // rather than assumed, and the visit after the error page must add exactly as many. The production build must
      // send one.
      await clientNavigate(page, product);
      await expect(page).toHaveURL(new RegExp(`${product}$`));
      await expect
        .poll(async () => (await gaEvents(page, 'view_item')).length)
        .toBeGreaterThan(0);
      await quietPeriod(page, 2000);
      const perVisit = (await gaEvents(page, 'view_item')).length;
      if (process.env.E2E_PROD_PREVIEW === '1') {
        expect(perVisit, 'view_item per product visit, production build').toBe(
          1,
        );
      } else {
        test.info().annotations.push({
          type: 'dev-server-duplicate',
          description: `view_item per product visit on the dev server: ${perVisit} (production build: 1)`,
        });
      }
      await clientNavigate(page, '/');
      await expect(page).toHaveURL(/\/$/);

      // The route error: the root ErrorBoundary replaces the App without a document load.
      await clientNavigate(page, missing);
      await expect(
        page.getByRole('heading', {level: 1, name: 'Page not found'}),
      ).toBeVisible();
      await expectSamePage(
        page,
        'the error page came from a client transition',
      );
      await consentLayerMounted(page);

      // And back to a valid page by the page's own link, then to the product again.
      await goBackHome(page).click();
      await expect(page).toHaveURL(/\/$/);
      await clientNavigate(page, product);
      await expect(page).toHaveURL(new RegExp(`${product}$`));
      await expect
        .poll(async () => (await gaEvents(page, 'view_item')).length)
        .toBeGreaterThan(perVisit);
      // A further send needs time to arrive before its absence means anything (negative assertion).
      await quietPeriod(page, 2500);
      const added = (await gaEvents(page, 'view_item')).length - perVisit;
      if (process.env.E2E_PROD_PREVIEW === '1') {
        expect(added, 'view_item sent by the visit after the error page').toBe(
          1,
        );
      } else {
        // The dev server's duplicate is StrictMode's, so the visit adds one or the control's count, never more.
        expect(
          added,
          'view_item sent by the visit after the error page',
        ).toBeGreaterThanOrEqual(1);
        expect(
          added,
          'no more than a visit without an error page sends',
        ).toBeLessThanOrEqual(perVisit);
      }
      await expectSamePage(page, 'no document load happened on the way');

      // The document's <head> is rebuilt when the error boundary replaces the app, which takes the script elements out
      // of the DOM (the scripts already ran and stay active). So the DOM holds at most one of each; the requests, the
      // data layer and the pixel's queue prove there was never a second load or a second configuration.
      const gtagElements = await scripts.gtag(page);
      const fbElements = await scripts.fbevents(page);
      test.info().annotations.push({
        type: 'script-elements-after-swap',
        description: `gtag/js elements: ${gtagElements}, fbevents.js elements: ${fbElements} (1 and 1 before the swap)`,
      });
      expect(gtagElements, 'gtag/js elements in the DOM').toBeLessThanOrEqual(
        1,
      );
      expect(fbElements, 'fbevents.js elements in the DOM').toBeLessThanOrEqual(
        1,
      );
      expect(
        requestsFor.gtag(requests),
        'gtag/js requests over the whole visit',
      ).toHaveLength(1);
      expect(
        requestsFor.fbevents(requests),
        'fbevents.js requests over the whole visit',
      ).toHaveLength(1);
      const layer = await dataLayer(page);
      expect(
        layer.filter((e) => e.kind === 'config' && e.name === GA_ID),
        'config calls for the measurement id',
      ).toHaveLength(1);
      expect(layer.filter((e) => e.kind === 'js')).toHaveLength(1);
      const meta = await metaCalls(page);
      expect(meta.filter((call) => call.startsWith('init:'))).toHaveLength(1);
      expect(
        chunkRequests,
        'the consent chunk is downloaded once, the remount reuses it',
      ).toHaveLength(1);

      // The error page was reported once, not once per mount of the bridge.
      const errorViews = (await gaEvents(page, 'page_view')).filter((entry) =>
        String(
          (entry.params as {page_location?: string}).page_location,
        ).endsWith(missing),
      );
      expect(errorViews, `page_view for ${missing}`).toHaveLength(1);
      expect(await gaDisableFlag(page)).toBe(false);
    });
  }

  // A decision withdrawn in a second tab reaches the resident tag through the `storage` event, also while no consent
  // component is mounted (the gap in which the error boundary has replaced the app and the idle callback that mounts the
  // new component has not run yet) and after it has adopted the layer again.
  for (const inGap of [true, false]) {
    test(`withdrawal in a second page while on the error page ${inGap ? 'in the gap before the component remounts' : 'after the component remounted'}: the resident tag is paused and revoked, and stays so on return`, async ({
      page,
      baseURL,
    }) => {
      const missing = MISSING_PATHS[0] ?? '/qa-no-such-page';
      const requests = await stubProviders(page);
      await controlIdle(page);
      await page.addInitScript(() => {
        Reflect.set(window, '__storageEvents', 0);
        window.addEventListener('storage', () => {
          Reflect.set(
            window,
            '__storageEvents',
            Number(Reflect.get(window, '__storageEvents')) + 1,
          );
        });
      });
      await storeDecision(page, baseURL, ALL);
      await gotoReady(page, '/');
      await expect
        .poll(() => requestsFor.gtag(requests), BANNER_WAIT)
        .toHaveLength(1);
      await expect
        .poll(async () => (await metaCalls(page)).includes('consent:grant'))
        .toBe(true);
      await consentLayerMounted(page);
      await expect.poll(async () => gaDisableFlag(page)).toBe(false);

      // The second page of the same context: it holds the preferences dialog open, ready to answer.
      const other = await page.context().newPage();
      await stubProviders(other);
      await gotoReady(other, '/');
      await consentLayerMounted(other);
      await footerPrivacyButton(other).click();
      const dialog = other.getByRole('dialog', {name: 'Privacy choices'});
      await expect(dialog).toBeVisible();

      if (inGap) {
        await page.evaluate(() => Reflect.set(window, '__idleHold', true));
      }
      await clientNavigate(page, missing);
      await expect(
        page.getByRole('heading', {level: 1, name: 'Page not found'}),
      ).toBeVisible();
      if (inGap) {
        // The precondition of the case: the new component has not mounted, so only the resident layer can hear this.
        await expect(footerPrivacyButton(page)).toHaveCount(0);
      } else {
        await consentLayerMounted(page);
      }
      const eventsBefore = (await gaEvents(page)).length;
      const trackBefore = (await metaCalls(page)).filter((call) =>
        call.startsWith('track:'),
      );

      await dialog.getByRole('button', {name: 'Reject all'}).click();
      await expect(other.getByRole('dialog')).toHaveCount(0);

      await expect
        .poll(() =>
          page.evaluate(() => Number(Reflect.get(window, '__storageEvents'))),
        )
        .toBeGreaterThan(0);
      await expect.poll(async () => gaDisableFlag(page)).toBe(true);
      await expect
        .poll(async () => (await metaCalls(page)).includes('consent:revoke'))
        .toBe(true);
      if (inGap) {
        await expect(
          footerPrivacyButton(page),
          'still no component when the withdrawal was applied',
        ).toHaveCount(0);
        await page.evaluate(() => {
          const release: unknown = Reflect.get(window, '__releaseIdle');
          if (typeof release === 'function') release();
        });
        await consentLayerMounted(page);
      }

      // The remounted component shows the current choice, not a stale one.
      await footerPrivacyButton(page).click();
      const here = page.getByRole('dialog', {name: 'Privacy choices'});
      await expect(
        here.getByRole('checkbox', {name: /Analytics/}),
      ).not.toBeChecked();
      await expect(
        here.getByRole('checkbox', {name: /Marketing/}),
      ).not.toBeChecked();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);

      // Return to a valid page: nothing is sent, the tag stays paused, and no second script was added.
      await goBackHome(page).click();
      await expect(page).toHaveURL(/\/$/);
      await quietPeriod(page, 2500);
      expect((await gaEvents(page)).length).toBe(eventsBefore);
      expect(await gaDisableFlag(page)).toBe(true);
      expect(await scripts.gtag(page)).toBeLessThanOrEqual(1);
      expect(await scripts.fbevents(page)).toBeLessThanOrEqual(1);
      expect(requestsFor.gtag(requests)).toHaveLength(1);
      expect(requestsFor.fbevents(requests)).toHaveLength(1);
      expect(
        (await metaCalls(page)).filter((call) => call.startsWith('track:')),
        'no Meta event after the withdrawal',
      ).toEqual(trackBefore);
      const providerCookies = (await cookieNames(page)).filter((name) =>
        PROVIDER_COOKIE.test(name),
      );
      expect(providerCookies).toEqual([]);
    });
  }
});

test.describe('a click or a pending navigation towards a private page pauses the tags before the address changes (security A-M1) (REQ-ANL-002, NFR-011, T-05)', () => {
  test.skip(!ANALYTICS_ON, 'needs E2E_ANALYTICS=on and an env file with ids');

  /** Holds every non-document request for a private path until the gate opens: the navigation stays "pending". */
  async function holdPrivateNavigation(page: Page) {
    const gate = createGate();
    await page.route(
      (url) => /\/(track-order|account)(\.data|\/|$)/.test(url.pathname),
      async (route) => {
        if (route.request().resourceType() === 'document') {
          await route.continue();
          return;
        }
        await gate.opened;
        await route.continue();
      },
    );
    return gate;
  }

  async function onLoadedProduct(page: Page, baseURL: string | undefined) {
    const requests = await stubProviders(page);
    const product = await firstProductPath(page, '/collections/all');
    await storeDecision(page, baseURL, ALL);
    await gotoReady(page, product);
    await expect
      .poll(() => requestsFor.gtag(requests), BANNER_WAIT)
      .toHaveLength(1);
    await expect
      .poll(async () => (await gaEvents(page, 'view_item')).length)
      .toBe(1);
    await expect
      .poll(async () => (await metaCalls(page)).includes('track:ViewContent'))
      .toBe(true);
    await expect.poll(async () => gaDisableFlag(page)).toBe(false);
    await consentLayerMounted(page);
    await markWindow(page);
    // Let the tail of the first load settle so the baseline below is a fair one.
    await quietPeriod(page, 1500);
    return {requests, product};
  }

  const LINKS = [
    {
      label: 'Track order (header utility bar)',
      path: '/track-order',
      desktopOnly: true,
      link: (page: Page) =>
        page.getByRole('link', {name: 'Track order', exact: true}).first(),
    },
    {
      label: 'Sign in (header account button)',
      path: '/account',
      desktopOnly: false,
      link: (page: Page) =>
        page.locator('header a[href="/account"]:visible').first(),
    },
  ] as const;

  for (const entry of LINKS) {
    test(`${entry.label}: tags are paused while the navigation is pending, nothing carries ${entry.path}, and a safe page resumes sending`, async ({
      page,
      baseURL,
    }, info) => {
      test.skip(
        entry.desktopOnly && info.project.name.includes('mobile'),
        'The utility bar is shown from 1024 px; the phone has the account button case.',
      );
      const {requests, product} = await onLoadedProduct(page, baseURL);
      const layerBefore = (await dataLayer(page)).length;
      const metaBefore = (await metaCalls(page)).length;
      const gate = await holdPrivateNavigation(page);

      await entry.link(page).click();
      // Pending: the address is still the product's, and the tag has already been told to stop.
      await expect.poll(async () => gaDisableFlag(page)).toBe(true);
      expect(new URL(page.url()).pathname, 'still on the product page').toBe(
        product,
      );
      await quietPeriod(page, 500);
      expect(await gaDisableFlag(page)).toBe(true);
      expect((await dataLayer(page)).length).toBe(layerBefore);
      expect((await metaCalls(page)).length).toBe(metaBefore);

      gate.open();
      await expect(page).toHaveURL(new RegExp(`${entry.path}`));
      await expectSamePage(page, 'a client navigation, not a document load');
      await expect.poll(async () => gaDisableFlag(page)).toBe(true);
      await quietPeriod(page, 2500);

      // Nothing the page handed to a provider, and no provider request, names the private path.
      expect(await dataLayerText(page)).not.toContain(entry.path.slice(1));
      expect((await metaCallsText(page)).join('\n')).not.toContain(
        entry.path.slice(1),
      );
      expect(
        requests.filter((url) => url.includes(entry.path.slice(1))),
        'provider requests naming the private path',
      ).toEqual([]);
      expect((await dataLayer(page)).length).toBe(layerBefore);
      expect((await metaCalls(page)).length).toBe(metaBefore);
      expect(
        requests.filter((url) => ANY_PROVIDER_HOST.test(url)),
      ).toHaveLength(2);

      // Leaving for a safe page resumes sending.
      const viewsBefore = (await gaEvents(page, 'page_view')).length;
      // (The header's cart link opens the cart panel and keeps the address, so the home link is the safe target.)
      await page.locator('header a[href="/"]:visible').first().click();
      await expect(page).toHaveURL(/\/$/);
      await expect.poll(async () => gaDisableFlag(page)).toBe(false);
      await expect
        .poll(async () => (await gaEvents(page, 'page_view')).length)
        .toBeGreaterThan(viewsBefore);
      const latest = (await gaEvents(page, 'page_view')).at(-1);
      expect(
        (latest?.params as {page_location?: string}).page_location,
      ).toMatch(/\/$/);
      expect(await dataLayerText(page)).not.toContain(entry.path.slice(1));
    });
  }

  test('a click on a private link that leads nowhere pauses the tag, then releases it after a few seconds', async ({
    page,
    baseURL,
  }) => {
    await onLoadedProduct(page, baseURL);
    await page.evaluate(() => {
      const link = document.createElement('a');
      link.id = 'qa-private-link';
      link.href = '/account/orders';
      link.textContent = 'QA private link';
      link.addEventListener('click', (event) => event.preventDefault());
      document.body.prepend(link);
    });
    await page.locator('#qa-private-link').click();
    await expect.poll(async () => gaDisableFlag(page)).toBe(true);
    // The runtime releases the hold when no navigation follows (PENDING_CLICK_MS = 3000).
    await expect
      .poll(async () => gaDisableFlag(page), {timeout: 10_000})
      .toBe(false);
  });

  test('a modified click, a link that opens another tab, and a link to a safe page do not pause the tag', async ({
    page,
    baseURL,
  }) => {
    await onLoadedProduct(page, baseURL);
    const cases: {
      name: string;
      href: string;
      modifiers?: ('Control' | 'Shift' | 'Alt' | 'Meta')[];
      target?: string;
    }[] = [
      {name: 'Control+click', href: '/track-order', modifiers: ['Control']},
      {name: 'Shift+click', href: '/track-order', modifiers: ['Shift']},
      {name: 'Alt+click', href: '/account', modifiers: ['Alt']},
      {name: 'Meta+click', href: '/account', modifiers: ['Meta']},
      {name: 'target=_blank', href: '/track-order', target: '_blank'},
      {name: 'target=_top', href: '/account', target: '_top'},
      {name: 'a safe page', href: '/cart'},
    ];
    for (const item of cases) {
      await page.evaluate((spec) => {
        document.querySelector('#qa-link')?.remove();
        const link = document.createElement('a');
        link.id = 'qa-link';
        link.href = spec.href;
        if (spec.target) link.target = spec.target;
        link.textContent = 'QA link';
        // A real click on it must not open a tab or leave the page: the question is only what the tag does.
        link.addEventListener('click', (event) => event.preventDefault());
        document.body.prepend(link);
      }, item);
      await page.locator('#qa-link').click({
        modifiers: item.modifiers ?? [],
      });
      // The handler is synchronous (capture phase), so the state right after the click is the state it chose.
      expect(await gaDisableFlag(page), `${item.name} did not pause`).toBe(
        false,
      );
      await quietPeriod(page, 300);
      expect(await gaDisableFlag(page), `${item.name} still not paused`).toBe(
        false,
      );
    }
  });
});

test.describe('the safe-page guard on addresses that look personal (code re-review m-2..m-9) (REQ-ANL-002, NFR-011, T-05)', () => {
  test.skip(!ANALYTICS_ON, 'needs E2E_ANALYTICS=on and an env file with ids');

  // Synthetic values only: 555-01xx numbers, example.test addresses.
  const SENDS_NOTHING = [
    ['a phone number in utm_content', '/?utm_content=415-555-0132'],
    ['a phone number with +1 in utm_content', '/?utm_content=%2B14155550132'],
    [
      'a bracketed phone number in utm_content',
      '/?utm_content=(415)%20555-0132',
    ],
    [
      'an email in variant',
      '/collections/all?variant=qa.nobody%40example.test',
    ],
    [
      'a double-encoded email in variant',
      '/collections/all?variant=qa.nobody%2540example.test',
    ],
    ['an email in the search term', '/search?q=qa.nobody%40example.test'],
    ['a phone number in the search term', '/search?q=4155550132'],
    ['an email in another parameter', '/?ref=qa.nobody%40example.test'],
    ['a long digit run in another parameter', '/?ref=4155550132'],
    ['an email in the fragment', '/#qa.nobody@example.test'],
    ['a phone number in the fragment', '/#4155550132'],
    ['an email in the path', '/qa.nobody@example.test'],
  ] as const;

  for (const [label, address] of SENDS_NOTHING) {
    test(`stored consent, ${label} (${address}): the consent layer runs and nothing is loaded or sent`, async ({
      page,
      baseURL,
    }) => {
      const requests = await stubProviders(page);
      await storeDecision(page, baseURL, ALL);
      await page.goto(address);
      await page.waitForLoadState('networkidle');
      // The gate had its chance: the consent layer is up (its footer button exists) and still nothing went out.
      await consentLayerMounted(page);
      await quietPeriod(page, 3500);
      expect(requests).toEqual([]);
      expect(await scripts.gtag(page)).toBe(0);
      expect(await scripts.fbevents(page)).toBe(0);
      expect(
        await page.evaluate(() => Reflect.get(window, 'dataLayer')),
      ).toBeUndefined();
      expect(
        await page.evaluate(() => Reflect.get(window, 'fbq')),
      ).toBeUndefined();
    });
  }

  const SENDS_PAGE_VIEW = [
    [
      'a dated campaign name',
      '/?utm_campaign=2026-10-23-newsletter',
      '/?utm_campaign=2026-10-23-newsletter',
    ],
    ['an eight-digit date', '/?ref=20261023', '/'],
    ['an ISO date', '/?ref=2026-10-23', '/'],
    [
      'a Shopify variant id',
      '/collections/all?variant=44123456789012',
      '/collections/all',
    ],
    [
      'a variant gid',
      '/collections/all?variant=gid%3A%2F%2Fshopify%2FProductVariant%2F44123456789012',
      '/collections/all',
    ],
    ['a harmless fragment', '/?utm_source=qa#about-us', '/?utm_source=qa'],
    [
      'a click id with a long number',
      '/?fbclid=1234567890123456',
      '/?fbclid=1234567890123456',
    ],
  ] as const;

  for (const [label, address, reported] of SENDS_PAGE_VIEW) {
    test(`stored consent, ${label} (${address}): one page_view is sent with the reduced address ${reported}`, async ({
      page,
      baseURL,
    }) => {
      await stubProviders(page);
      await storeDecision(page, baseURL, ALL);
      await page.goto(address);
      await page.waitForLoadState('networkidle');
      await expect
        .poll(
          async () => (await gaEvents(page, 'page_view')).length,
          BANNER_WAIT,
        )
        .toBe(1);
      await expect
        .poll(async () => (await metaCalls(page)).includes('track:PageView'))
        .toBe(true);
      const [view] = await gaEvents(page, 'page_view');
      const origin = new URL(baseURL ?? 'http://localhost').origin;
      expect(
        (view?.params as {page_location?: string}).page_location,
        'the address sent to Google',
      ).toBe(`${origin}${reported}`);
      // Nothing from the fragment or the dropped parameters reaches either provider.
      const sent = `${await dataLayerText(page)}\n${(await metaCallsText(page)).join('\n')}`;
      expect(sent).not.toContain('about-us');
      expect(sent).not.toContain('variant=');
      expect(sent).not.toContain('ref=');
      expect(sent).not.toContain('#');
      await quietPeriod(page, 2000);
      expect((await gaEvents(page, 'page_view')).length).toBe(1);
    });
  }
});

test.describe('the private areas answer with Referrer-Policy: origin (security A-L2) (T-05)', () => {
  for (const path of [
    '/account',
    '/account/orders',
    '/account/orders/gid-qa-1',
    '/account/profile',
    '/track-order',
    '/track-order/',
    '/Account',
    '/TRACK-ORDER',
    '/%61ccount',
    '/account//orders',
  ]) {
    test(`${path}: origin, on the response a shopper's browser receives`, async ({
      request,
    }) => {
      const response = await request.get(path);
      expect(
        response.status(),
        `status of ${path} (any answer carries the header)`,
      ).toBeLessThan(600);
      expect(response.headers()['referrer-policy']).toBe('origin');
    });
  }

  test('the answer to a redirect that leaves an account page also carries it (no redirect is followed)', async ({
    request,
  }) => {
    const response = await request.get('/account', {maxRedirects: 0});
    expect(response.headers()['referrer-policy']).toBe('origin');
  });

  for (const path of [
    '/',
    '/cart',
    '/collections/all',
    '/accounting',
    '/account-help',
  ]) {
    test(`${path}: the site-wide policy, not the private one`, async ({
      request,
    }) => {
      const response = await request.get(path);
      expect(response.headers()['referrer-policy']).toBe(
        'strict-origin-when-cross-origin',
      );
    });
  }
});

test.describe('provider cookies are removed whenever there is no consent for them (security A-L3) (NFR-011, T-05)', () => {
  test.skip(!ANALYTICS_ON, 'needs E2E_ANALYTICS=on and an env file with ids');

  const DAY = 24 * 60 * 60;

  test('consent withdrawn while the provider scripts are still scheduled: no script ever loads and the cookies are gone', async ({
    page,
    baseURL,
  }) => {
    const requests = await stubProviders(page);
    // The idle work runs 4 s after it is asked for, so there is a known window between "scheduled" and "loading".
    await controlIdle(page, 4000);
    await storeDecision(page, baseURL, ALL);
    await plantProviderCookies(page, baseURL);
    await page.goto('/');
    await consentLayerMounted(page);
    expect(requests, 'precondition: nothing requested yet').toEqual([]);
    await footerPrivacyButton(page).click();
    await page
      .getByRole('dialog', {name: 'Privacy choices'})
      .getByRole('button', {name: 'Reject all'})
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(requests, 'withdrawn inside the window: still nothing').toEqual([]);
    await expect
      .poll(async () =>
        (await cookieNames(page)).filter((name) => PROVIDER_COOKIE.test(name)),
      )
      .toEqual([]);
    // Past the 4 s the load would have happened.
    await quietPeriod(page, 5500);
    expect(requests, 'the scheduled load was cancelled').toEqual([]);
    expect(await scripts.gtag(page)).toBe(0);
    expect(await scripts.fbevents(page)).toBe(0);
    const names = await cookieNames(page);
    expect(names.filter((name) => PROVIDER_COOKIE.test(name))).toEqual([]);
    expect(
      names,
      'a cookie that is not a provider cookie is left alone',
    ).toContain('qa_unrelated');
    expect(names, 'the decision itself is kept').toContain('mf_consent');
  });

  test('consent withdrawn while the provider scripts are downloading: cookies gone at once, nothing sent when they arrive', async ({
    page,
    baseURL,
  }) => {
    const gate = createGate();
    const requests = await stubProviders(page, {hold: gate.opened});
    await storeDecision(page, baseURL, ALL);
    await plantProviderCookies(page, baseURL);
    await page.goto('/');
    await expect
      .poll(() => requests.some((url) => GA_HOST.test(url)), BANNER_WAIT)
      .toBe(true);
    await expect
      .poll(() => requests.some((url) => META_HOST.test(url)), BANNER_WAIT)
      .toBe(true);
    await consentLayerMounted(page);
    await footerPrivacyButton(page).click();
    await page
      .getByRole('dialog', {name: 'Privacy choices'})
      .getByRole('button', {name: 'Reject all'})
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect
      .poll(async () =>
        (await cookieNames(page)).filter((name) => PROVIDER_COOKIE.test(name)),
      )
      .toEqual([]);
    // The scripts now "arrive".
    gate.open();
    await expect.poll(async () => scripts.gtag(page)).toBe(1);
    await quietPeriod(page, 2500);
    expect(await gaEvents(page), 'no event reached the tag').toEqual([]);
    expect(
      (await metaCalls(page)).filter((call) => call.startsWith('track:')),
      'no event reached the pixel',
    ).toEqual([]);
    await expect.poll(async () => gaDisableFlag(page)).toBe(true);
    await expect
      .poll(async () => (await metaCalls(page)).includes('consent:revoke'))
      .toBe(true);
    const names = await cookieNames(page);
    expect(names.filter((name) => PROVIDER_COOKIE.test(name))).toEqual([]);
    expect(names).toContain('qa_unrelated');
  });

  test('a stored decision older than 180 days is no decision: the banner asks again, nothing loads and the old provider cookies are removed', async ({
    page,
    baseURL,
  }) => {
    const requests = await stubProviders(page);
    await storeDecision(
      page,
      baseURL,
      ALL,
      Math.floor(Date.now() / 1000) - 181 * DAY,
    );
    await plantProviderCookies(page, baseURL);
    await page.goto('/');
    await showBanner(page);
    await expect
      .poll(async () =>
        (await cookieNames(page)).filter((name) => PROVIDER_COOKIE.test(name)),
      )
      .toEqual([]);
    await quietPeriod(page, 3500);
    expect(requests).toEqual([]);
    expect(await cookieNames(page)).toContain('qa_unrelated');
  });

  test('control: a decision 179 days old is still honoured (the boundary is real)', async ({
    page,
    baseURL,
  }) => {
    const requests = await stubProviders(page);
    await storeDecision(
      page,
      baseURL,
      ALL,
      Math.floor(Date.now() / 1000) - 179 * DAY,
    );
    await plantProviderCookies(page, baseURL);
    await page.goto('/');
    await expect
      .poll(() => requests.some((url) => GA_HOST.test(url)), BANNER_WAIT)
      .toBe(true);
    await expect(banner(page)).toHaveCount(0);
    expect(await cookieNames(page)).toEqual(
      expect.arrayContaining(['_ga', '_fbp']),
    );
  });

  test('no decision at all: the first look removes cookies an earlier visit left', async ({
    page,
    baseURL,
  }) => {
    const requests = await stubProviders(page);
    await plantProviderCookies(page, baseURL);
    await page.goto('/');
    await showBanner(page);
    await expect
      .poll(async () =>
        (await cookieNames(page)).filter((name) => PROVIDER_COOKIE.test(name)),
      )
      .toEqual([]);
    expect(requests).toEqual([]);
    expect(await cookieNames(page)).toContain('qa_unrelated');
  });

  test('a stored refusal: stale provider cookies are removed on the next visit', async ({
    page,
    baseURL,
  }) => {
    const requests = await stubProviders(page);
    await storeDecision(page, baseURL, {analytics: false, marketing: false});
    await plantProviderCookies(page, baseURL);
    await page.goto('/');
    await consentLayerMounted(page);
    await expect
      .poll(async () =>
        (await cookieNames(page)).filter((name) => PROVIDER_COOKIE.test(name)),
      )
      .toEqual([]);
    await quietPeriod(page, 3500);
    expect(requests).toEqual([]);
  });

  test('analytics only: the marketing cookies go, the analytics cookies stay (each category on its own)', async ({
    page,
    baseURL,
  }) => {
    const requests = await stubProviders(page);
    await storeDecision(page, baseURL, {analytics: true, marketing: false});
    await plantProviderCookies(page, baseURL);
    await page.goto('/');
    await expect
      .poll(() => requests.some((url) => GA_HOST.test(url)), BANNER_WAIT)
      .toBe(true);
    await expect
      .poll(async () => cookieNames(page))
      .not.toEqual(expect.arrayContaining(['_fbp']));
    const names = await cookieNames(page);
    expect(names).not.toContain('_fbc');
    expect(names).toEqual(expect.arrayContaining(['_ga']));
    expect(requests.some((url) => META_HOST.test(url))).toBe(false);
  });
});
