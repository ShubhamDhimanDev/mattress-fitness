import {expect, test, type Page} from '@playwright/test';
import {expectNoSeriousA11yViolations} from './helpers/a11y';
import {
  expectNoHorizontalScroll,
  expectPageNotReloaded,
  firstProductPath,
  gotoReady,
  markPage,
} from './helpers/catalog';
import {
  collectConsoleErrorsWithUrls,
  unexpectedErrors,
} from './helpers/console';
import {
  readCspViolations,
  recordCspViolations,
  unexpectedViolations,
} from './helpers/csp';

// P7-01 (REQ-ANL-001, REQ-ANL-002, REQ-QZ-006, NFR-011, NFR-003, NFR-013). First run: V-E164 onwards in
// progress/TEST_RESULTS.md. Everything here is unverified against GA4 DebugView and Meta's Test Events tool (CLR-004):
// the provider hosts are answered by a stub at the network layer, so what is proved is OUR behaviour (consent gate,
// loading rules, safe pages, focus, layout, policy), not what Google or Meta do with the events.
//
// Server configurations (names only; values are placeholders and never real accounts):
//  - default server, no ids (`.env.bedding`): the "no provider configured" block runs; the rest is skipped;
//  - E2E_ANALYTICS=on with E2E_ENV_FILE=.env.analyticsqa (PUBLIC_GA4_MEASUREMENT_ID, PUBLIC_META_PIXEL_ID,
//    PUBLIC_CONSENT_MODE=opt-in; the ids must match GA_ID and PIXEL_ID below, or set E2E_GA4_ID / E2E_PIXEL_ID):
//    the consent-flow block runs, in the dev server and, with E2E_PROD_PREVIEW=1, in the production preview.
// The stubbed gtag.js defines nothing, so "an event was sent" is read from `window.dataLayer` (what gtag.js itself
// consumes) and, for Meta, from `window.fbq.queue`.

const ANALYTICS_ON = process.env.E2E_ANALYTICS === 'on';
const GA_ID = process.env.E2E_GA4_ID ?? 'G-TESTTEST01';
const GA_DISABLE_FLAG = `ga-disable-${GA_ID}`;
const GA_HOST = /^https:\/\/www\.googletagmanager\.com\//;
const META_HOST = /^https:\/\/connect\.facebook\.net\//;
const ANY_PROVIDER_HOST =
  /^https:\/\/(www\.googletagmanager\.com|connect\.facebook\.net|www\.facebook\.com|[a-z0-9-]+\.google-analytics\.com|analytics\.google\.com|[a-z0-9-]+\.analytics\.google\.com)\//;
const CONSENT_CHUNK = /ConsentRuntime/;
const LISTING_EVENTS_CHUNK = /listing-events/;

const STUB_SCRIPT = {
  status: 200,
  contentType: 'application/javascript',
  body: '/* stub provider script (E2E) */',
};

/** Answers the provider hosts with a stub and records every request made to any provider host. */
async function stubProviders(page: Page) {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (ANY_PROVIDER_HOST.test(request.url())) requests.push(request.url());
  });
  await page.route(GA_HOST, (route) => route.fulfill(STUB_SCRIPT));
  await page.route(META_HOST, (route) => route.fulfill(STUB_SCRIPT));
  return requests;
}

/** Every request whose URL matches `pattern`, so a test can prove a chunk was (not) downloaded. */
function watchRequests(page: Page, pattern: RegExp) {
  const seen: string[] = [];
  page.on('request', (request) => {
    if (pattern.test(request.url())) seen.push(request.url());
  });
  return seen;
}

async function trackLayoutShift(page: Page) {
  await page.addInitScript(() => {
    const shifts: number[] = [];
    Reflect.set(window, '__shifts', shifts);
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
        };
        if (!shift.hadRecentInput) shifts.push(shift.value);
      }
    }).observe({type: 'layout-shift', buffered: true});
  });
}

type LayerEntry = {kind: string; name: string; params: unknown};

/** `window.dataLayer` as plain data: gtag pushes `Arguments` objects (kind, name, params). */
async function dataLayer(page: Page): Promise<LayerEntry[]> {
  return page.evaluate(() => {
    const layer: unknown = Reflect.get(window, 'dataLayer');
    if (!Array.isArray(layer)) return [];
    return layer.map((entry: unknown) => ({
      kind: String(Reflect.get(entry as object, '0')),
      name: String(Reflect.get(entry as object, '1')),
      params: JSON.parse(
        JSON.stringify(Reflect.get(entry as object, '2') ?? null),
      ) as unknown,
    }));
  });
}

async function gaEvents(page: Page, name?: string): Promise<LayerEntry[]> {
  return (await dataLayer(page)).filter(
    (entry) =>
      entry.kind === 'event' && (name === undefined || entry.name === name),
  );
}

/** Names of the `fbq(...)` calls queued by the bootstrap (the stub never replays them): "track:PageView". */
async function metaCalls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const fbq: unknown = Reflect.get(window, 'fbq');
    const queue: unknown = fbq ? Reflect.get(fbq as object, 'queue') : null;
    if (!Array.isArray(queue)) return [];
    return queue.map((call: unknown) => {
      const first = String(Reflect.get(call as object, '0'));
      const second = String(Reflect.get(call as object, '1'));
      return `${first}:${second}`;
    });
  });
}

async function gaDisableFlag(page: Page) {
  return page.evaluate(
    (flag) => Reflect.get(window, flag) as unknown,
    GA_DISABLE_FLAG,
  );
}

/**
 * A quiet period for a NEGATIVE assertion ("nothing happens"): there is no event to wait for, so the only honest
 * form is a bounded wait. The runtime loads a provider when the browser is idle with a 3 s limit
 * (docs/integrations/ANALYTICS.md), so 4 s is longer than anything it would take to act. Used only where the
 * absence of a request is the behaviour.
 */
async function quietPeriod(page: Page, ms = 4000) {
  await page.evaluate(
    (wait) => new Promise<void>((resolve) => setTimeout(resolve, wait)),
    ms,
  );
}

/** Dialogs and buttons fade and recolour; axe measured halfway through a transition reports false contrast. */
async function settled(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.getAnimations().length))
    .toBe(0);
}

/** The cookie the app stores the decision in (the name and shape are in app/lib/analytics/consent.ts). */
async function storeDecision(
  page: Page,
  baseURL: string | undefined,
  choice: {analytics: boolean; marketing: boolean},
) {
  const stored = JSON.stringify({
    version: 1,
    ...choice,
    decidedAt: Math.floor(Date.now() / 1000),
  });
  await page.context().addCookies([
    {
      name: 'mf_consent',
      value: encodeURIComponent(stored),
      url: baseURL ?? '',
    },
  ]);
}

/**
 * A client-side navigation (no document load) to `path`: React Router listens for popstate, so pushing the address and
 * dispatching one is the same transition a link click makes. Used because the utility links are not in the phone header.
 */
async function clientNavigate(page: Page, path: string) {
  await page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

const banner = (page: Page) =>
  page.getByRole('region', {name: 'Privacy choices'});
// The banner arrives after hydration and browser idle (up to about 3 s on a fast machine, longer on the dev server).
const BANNER_WAIT = {timeout: 20_000};
const showBanner = (page: Page) =>
  expect(banner(page)).toBeVisible(BANNER_WAIT);
const footerPrivacyButton = (page: Page) =>
  page.getByRole('button', {name: 'Privacy choices'});

test.describe('no provider configured (default server) (REQ-ANL-001, NFR-011)', () => {
  test.skip(ANALYTICS_ON, 'this server has analytics ids set');

  for (const path of ['/', '/collections/all']) {
    test(`${path}: no banner, no footer button, no consent chunk, no provider request, no cookie`, async ({
      page,
      request,
    }) => {
      const providerRequests = await stubProviders(page);
      const chunkRequests = watchRequests(page, CONSENT_CHUNK);
      await gotoReady(page, path);
      // The idle window in which the chunk would have been requested had a provider been configured.
      await quietPeriod(page, 3500);
      await expect(banner(page)).toHaveCount(0);
      await expect(footerPrivacyButton(page)).toHaveCount(0);
      expect(
        chunkRequests,
        'the lazy consent chunk is never requested',
      ).toEqual([]);
      expect(providerRequests).toEqual([]);
      await expect(page.locator('script[src*="googletagmanager"]')).toHaveCount(
        0,
      );
      await expect(page.locator('script[src*="facebook"]')).toHaveCount(0);
      expect(
        await page.evaluate(() => Reflect.get(window, 'dataLayer')),
      ).toBeUndefined();
      const names = (await page.context().cookies()).map((c) => c.name);
      expect(names).not.toContain('mf_consent');

      const headers = (await request.get(path)).headers();
      for (const name of [
        'content-security-policy',
        'content-security-policy-report-only',
      ]) {
        expect(headers[name], name).not.toMatch(/google|facebook/);
      }
    });
  }

  test('a product page and the cart also load nothing from a provider', async ({
    page,
  }) => {
    const providerRequests = await stubProviders(page);
    const chunkRequests = watchRequests(page, CONSENT_CHUNK);
    const product = await firstProductPath(page, '/collections/all');
    await gotoReady(page, product);
    await gotoReady(page, '/cart');
    await quietPeriod(page, 3500);
    expect(providerRequests).toEqual([]);
    expect(chunkRequests).toEqual([]);
    await expect(footerPrivacyButton(page)).toHaveCount(0);
  });
});

test.describe('providers configured, opt-in mode (REQ-ANL-001, REQ-ANL-002, NFR-011, NFR-003, NFR-013)', () => {
  test.skip(!ANALYTICS_ON, 'needs E2E_ANALYTICS=on and an env file with ids');

  test('the policies name the provider hosts and still carry the nonce', async ({
    request,
  }) => {
    const headers = (await request.get('/')).headers();
    const enforced = headers['content-security-policy'] ?? '';
    expect(enforced).toContain('https://www.googletagmanager.com');
    expect(enforced).toContain('https://connect.facebook.net');
    expect(enforced).toMatch(/'nonce-/);
    expect(enforced).not.toMatch(/unsafe-eval/);
    expect(headers['content-security-policy-report-only']).toContain(
      'https://www.googletagmanager.com',
    );
  });

  test('the server HTML has no banner; the lazy chunk arrives after the page, then the banner (no layout shift)', async ({
    page,
    request,
  }) => {
    const html = await (await request.get('/')).text();
    expect(html).not.toContain('data-consent="banner"');
    await trackLayoutShift(page);
    await stubProviders(page);
    const chunkRequests = watchRequests(page, CONSENT_CHUNK);
    await page.goto('/', {waitUntil: 'commit'});
    await showBanner(page);
    expect(chunkRequests.length, 'the consent chunk was requested').toBe(1);
    const shifts = await page.evaluate(
      () => (Reflect.get(window, '__shifts') as number[]) ?? [],
    );
    expect(shifts.reduce((sum, value) => sum + value, 0)).toBeLessThan(0.01);
  });

  test('nothing is requested from a provider before the shopper decides, also after moving between pages', async ({
    page,
  }) => {
    const requests = await stubProviders(page);
    await gotoReady(page, '/');
    await showBanner(page);
    await quietPeriod(page);
    await expect(page.locator('script[src*="googletagmanager"]')).toHaveCount(
      0,
    );
    await expect(page.locator('script[src*="facebook"]')).toHaveCount(0);
    expect(requests).toEqual([]);
    expect(
      await page.evaluate(() => Reflect.get(window, 'dataLayer')),
    ).toBeUndefined();
    expect(
      await page.evaluate(() => Reflect.get(window, 'fbq')),
    ).toBeUndefined();
    // A second page, by full load and by client navigation: still nothing, and the decision is still open.
    await page.goto('/collections/all');
    await page.waitForLoadState('networkidle');
    await showBanner(page);
    expect(requests).toEqual([]);
    const names = (await page.context().cookies()).map((c) => c.name);
    expect(names).not.toContain('mf_consent');
    expect(names.filter((name) => /^(_ga|_fbp|_fbc)/.test(name))).toEqual([]);
  });

  test('reject all: nothing is requested, focus moves to the page, the choice is remembered and the footer button reopens it', async ({
    page,
  }) => {
    const requests = await stubProviders(page);
    await gotoReady(page, '/');
    await showBanner(page);
    await banner(page).getByRole('button', {name: 'Reject all'}).click();
    await expect(banner(page)).toHaveCount(0);
    await expect(page.getByRole('main')).toBeFocused();
    await page.reload();
    await page.waitForLoadState('networkidle');
    // The footer button appears when the chunk has published its store, which proves the chunk ran after the reload.
    await expect(footerPrivacyButton(page)).toBeVisible(BANNER_WAIT);
    await expect(banner(page)).toHaveCount(0);
    await page.goto('/cart');
    await page.waitForLoadState('networkidle');
    await quietPeriod(page);
    expect(requests).toEqual([]);
    expect(
      await page.evaluate(() => Reflect.get(window, 'dataLayer')),
    ).toBeUndefined();
  });

  test('accept all: both providers load after consent, focus moves to the page, no policy violation, the page view is counted (production build)', async ({
    page,
  }) => {
    const requests = await stubProviders(page);
    await recordCspViolations(page);
    await gotoReady(page, '/');
    await showBanner(page);
    await banner(page).getByRole('button', {name: 'Accept all'}).click();
    await expect(page.getByRole('main')).toBeFocused();
    await expect
      .poll(() => requests.some((url) => GA_HOST.test(url)))
      .toBe(true);
    await expect
      .poll(() => requests.some((url) => META_HOST.test(url)))
      .toBe(true);
    // The tag is configured as documented: our own page_view only, no signals, no personalisation.
    await expect
      .poll(async () =>
        (await dataLayer(page)).some(
          (entry) => entry.kind === 'config' && entry.name === GA_ID,
        ),
      )
      .toBe(true);
    const config = (await dataLayer(page)).find(
      (entry) => entry.kind === 'config',
    );
    expect(config?.params).toEqual({
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
    // Scripts carry the page nonce (the enforced policy would refuse them otherwise).
    expect(unexpectedViolations(await readCspViolations(page))).toEqual([]);
  });

  test('accept all: the page view recorded before the decision is sent once after it, to Google and to Meta', async ({
    page,
  }) => {
    await stubProviders(page);
    await gotoReady(page, '/');
    await showBanner(page);
    await banner(page).getByRole('button', {name: 'Accept all'}).click();
    await expect
      .poll(async () => (await gaEvents(page, 'page_view')).length, BANNER_WAIT)
      .toBe(1);
    await expect
      .poll(async () => await metaCalls(page), BANNER_WAIT)
      .toContain('track:PageView');
  });

  test('choosing analytics only never contacts Meta, and Save moves focus to the page', async ({
    page,
  }) => {
    const requests = await stubProviders(page);
    await gotoReady(page, '/');
    await showBanner(page);
    await banner(page).getByRole('button', {name: 'Choose'}).click();
    const dialog = page.getByRole('dialog', {name: 'Privacy choices'});
    await expect(
      dialog.getByRole('checkbox', {name: /Analytics/}),
    ).not.toBeChecked();
    await expect(
      dialog.getByRole('checkbox', {name: /Marketing/}),
    ).not.toBeChecked();
    await dialog.getByRole('checkbox', {name: /Analytics/}).check();
    await dialog.getByRole('button', {name: 'Save choices'}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('main')).toBeFocused();
    await expect
      .poll(() => requests.some((url) => GA_HOST.test(url)))
      .toBe(true);
    await page.waitForLoadState('networkidle');
    await quietPeriod(page, 2000);
    expect(requests.some((url) => /facebook/.test(url))).toBe(false);
    expect(await metaCalls(page)).toEqual([]);
  });

  test('choosing marketing only never contacts Google', async ({page}) => {
    const requests = await stubProviders(page);
    await gotoReady(page, '/');
    await showBanner(page);
    await banner(page).getByRole('button', {name: 'Choose'}).click();
    const dialog = page.getByRole('dialog', {name: 'Privacy choices'});
    await dialog.getByRole('checkbox', {name: /Marketing/}).check();
    await dialog.getByRole('button', {name: 'Save choices'}).click();
    await expect
      .poll(() => requests.some((url) => META_HOST.test(url)))
      .toBe(true);
    await quietPeriod(page, 2000);
    expect(requests.some((url) => /googletagmanager/.test(url))).toBe(false);
    expect(
      await page.evaluate(() => Reflect.get(window, 'dataLayer')),
    ).toBeUndefined();
  });

  test('keyboard: skip link, then the banner (policy link, Accept, Reject, Choose), then the header; Enter on Reject works without a mouse', async ({
    page,
  }) => {
    await stubProviders(page);
    await gotoReady(page, '/');
    await showBanner(page);
    const inBanner = banner(page);
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('link', {name: 'Skip to main content'}),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      inBanner.getByRole('link', {name: 'Privacy policy'}),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      inBanner.getByRole('button', {name: 'Accept all'}),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      inBanner.getByRole('button', {name: 'Reject all'}),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(inBanner.getByRole('button', {name: 'Choose'})).toBeFocused();
    await page.keyboard.press('Tab');
    // Past the banner the next stop is on the page, never a trap inside the banner.
    expect(
      await page.evaluate(
        () =>
          document.activeElement?.closest('[data-consent="banner"]') ?? null,
      ),
    ).toBeNull();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(
      inBanner.getByRole('button', {name: 'Reject all'}),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(banner(page)).toHaveCount(0);
    await expect(page.getByRole('main')).toBeFocused();
  });

  test('the banner announces itself politely once and does not take focus', async ({
    page,
  }) => {
    await stubProviders(page);
    await gotoReady(page, '/');
    await showBanner(page);
    await expect(
      banner(page)
        .getByRole('status')
        .filter({hasText: 'Cookie choices available'}),
    ).toHaveCount(1);
    expect(
      await page.evaluate(
        () =>
          document.activeElement?.closest('[data-consent="banner"]') ?? null,
      ),
    ).toBeNull();
  });

  test('the preferences dialog closes on Escape and returns focus; the banner and the dialog have no serious axe finding', async ({
    page,
  }) => {
    await stubProviders(page);
    await gotoReady(page, '/');
    await showBanner(page);
    await settled(page);
    await expectNoSeriousA11yViolations(page);
    const choose = banner(page).getByRole('button', {name: 'Choose'});
    await choose.click();
    await expect(
      page.getByRole('dialog', {name: 'Privacy choices'}),
    ).toBeVisible();
    await settled(page);
    await expectNoSeriousA11yViolations(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(choose).toBeFocused();
  });

  test('while the banner is shown the page keeps a bottom scroll padding of its height plus 16 px; it is removed after the answer', async ({
    page,
  }) => {
    await stubProviders(page);
    await gotoReady(page, '/');
    await showBanner(page);
    const measure = () =>
      page.evaluate(() => {
        const root = document.documentElement;
        const element = document.querySelector('[data-consent="banner"]');
        return {
          padding: root.style.scrollPaddingBottom,
          height: element ? (element as HTMLElement).offsetHeight : -1,
        };
      });
    await expect
      .poll(async () => {
        const {padding, height} = await measure();
        return padding === `${height + 16}px`;
      })
      .toBe(true);
    await banner(page).getByRole('button', {name: 'Reject all'}).click();
    await expect(banner(page)).toHaveCount(0);
    expect((await measure()).padding).toBe('');
  });

  test('Tab to a link that sits under the banner scrolls it clear of the banner (WCAG 2.4.11); without the scroll padding it would stay covered', async ({
    page,
  }) => {
    await stubProviders(page);
    await gotoReady(page, '/collections/all');
    await showBanner(page);
    // A link under the banner's horizontal span is scrolled to 20 px above the window's bottom edge (so the banner
    // covers it), the control before it takes focus, and Tab moves to it. Programmatic focus() does not scroll a
    // visible element in Chromium, so a real Tab press is the only honest probe. With the page's scroll padding
    // removed the link MUST stay covered (the control: it proves the geometry can fail); with the padding the app sets
    // it MUST end clear of the banner.
    const run = async (padding: 'app' | 'none') => {
      await page.evaluate((mode) => {
        const root = document.documentElement;
        if (root.dataset.e2eKeepPadding === undefined) {
          root.dataset.e2eKeepPadding = root.style.scrollPaddingBottom;
        }
        root.style.scrollPaddingBottom =
          mode === 'none' ? '0px' : (root.dataset.e2eKeepPadding ?? '');
        const bannerBox = document
          .querySelector('[data-consent="banner"]')
          ?.getBoundingClientRect();
        window.scrollTo(0, 0);
        const tabbables = [
          ...document.querySelectorAll<HTMLElement>('main a, main button'),
        ];
        const target = tabbables
          .filter((link) => {
            const box = link.getBoundingClientRect();
            return (
              link.matches('a[data-si]') &&
              bannerBox !== undefined &&
              box.left < bannerBox.right &&
              box.right > bannerBox.left
            );
          })
          .at(-1);
        if (!target) throw new Error('no product link under the banner');
        const before = tabbables[tabbables.indexOf(target) - 1];
        if (!before) throw new Error('no control before the product link');
        const box = target.getBoundingClientRect();
        window.scrollBy(0, box.top - (window.innerHeight - 20 - box.height));
        target.dataset.e2eTarget = '1';
        before.focus({preventScroll: true});
      }, padding);
      await page.keyboard.press('Tab');
      return page.evaluate(() => {
        const focused = document.activeElement as HTMLElement | null;
        const bannerBox = document
          .querySelector('[data-consent="banner"]')
          ?.getBoundingClientRect();
        if (!focused || focused.dataset.e2eTarget !== '1' || !bannerBox) {
          return 'wrong element';
        }
        const box = focused.getBoundingClientRect();
        const covered =
          box.left < bannerBox.right &&
          box.right > bannerBox.left &&
          box.top < bannerBox.bottom &&
          box.bottom > bannerBox.top;
        focused.removeAttribute('data-e2e-target');
        return covered ? 'covered' : 'clear';
      });
    };
    expect(await run('none'), 'control: without the padding').toBe('covered');
    expect(await run('app'), 'with the padding the app sets').toBe('clear');
  });

  test('a blocked provider script (ad blocker or outage) leaves browsing, the cart and the checkout link working (NFR-013)', async ({
    page,
  }) => {
    const errors = collectConsoleErrorsWithUrls(page);
    await page.route(GA_HOST, (route) => route.abort('blockedbyclient'));
    await page.route(META_HOST, (route) => route.abort('blockedbyclient'));
    await gotoReady(page, '/');
    await showBanner(page);
    await banner(page).getByRole('button', {name: 'Accept all'}).click();
    await page.waitForLoadState('networkidle');
    // The shop still works: navigate and open the cart.
    await page.goto('/cart');
    await expect(page.getByRole('main')).toBeVisible();
    // Only the browser's own echo of the two blocked URLs is allowed; nothing from our code.
    const ours = unexpectedErrors(
      errors.filter(
        (error) =>
          !(
            error.text.startsWith('Failed to load resource') &&
            (error.url.includes('googletagmanager') ||
              error.url.includes('connect.facebook.net'))
          ),
      ),
      'no-such-url',
    );
    expect(ours).toEqual([]);
  });

  test('a provider that never answers does not hold the page', async ({
    page,
  }) => {
    await page.route(GA_HOST, () => {
      // Never fulfilled: the request hangs until the page is closed.
    });
    await gotoReady(page, '/');
    await showBanner(page);
    await banner(page).getByRole('button', {name: 'Accept all'}).click();
    await page.getByRole('link', {name: /cart/i}).first().click();
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('consent given on a private page loads no script there; the next safe page does (review L-4)', async ({
    page,
  }) => {
    const requests = await stubProviders(page);
    await gotoReady(page, '/track-order');
    await showBanner(page);
    await banner(page).getByRole('button', {name: 'Accept all'}).click();
    await quietPeriod(page);
    expect(requests).toEqual([]);
    await page.goto('/cart');
    await expect
      .poll(() => requests.some((url) => GA_HOST.test(url)))
      .toBe(true);
  });

  // On the mock store /account answers with the Customer Account API credential error and the app shell (and with it the
  // consent chunk) is not mounted, so for it only the absence of requests is checked: the weaker result is stated, not hidden.
  for (const [path, mountsShell] of [
    ['/track-order', true],
    ['/delivery', true],
    ['/account', false],
  ] as const) {
    test(`private page ${path}: with consent already stored, no provider script and no event`, async ({
      page,
      baseURL,
    }) => {
      const requests = await stubProviders(page);
      const chunkRequests = watchRequests(page, CONSENT_CHUNK);
      await storeDecision(page, baseURL, {analytics: true, marketing: true});
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      // The consent chunk did run here (so the gate had its chance), and still nothing went out.
      if (mountsShell) {
        await expect
          .poll(() => chunkRequests.length, BANNER_WAIT)
          .toBeGreaterThan(0);
      } else {
        test.info().annotations.push({
          type: 'weaker-check',
          description:
            'the page errors on this store (no Customer Account API credential), so the consent chunk never ran: only the absence of provider requests is proved',
        });
      }
      await quietPeriod(page);
      expect(requests).toEqual([]);
      await expect(page.locator('script[src*="googletagmanager"]')).toHaveCount(
        0,
      );
      await expect(page.locator('script[src*="facebook"]')).toHaveCount(0);
      expect(
        await page.evaluate(() => Reflect.get(window, 'dataLayer')),
      ).toBeUndefined();
    });
  }

  test('a loaded tag is paused on a private page reached by client navigation and resumes on the next safe page', async ({
    page,
    baseURL,
  }) => {
    const requests = await stubProviders(page);
    await storeDecision(page, baseURL, {analytics: true, marketing: true});
    await gotoReady(page, '/');
    await expect
      .poll(() => requests.some((url) => GA_HOST.test(url)))
      .toBe(true);
    await expect.poll(async () => gaDisableFlag(page)).toBe(false);
    await markPage(page);
    const viewsBefore = (await gaEvents(page, 'page_view')).length;
    await clientNavigate(page, '/track-order');
    await expect(page).toHaveURL(/\/track-order$/);
    await expectPageNotReloaded(page);
    await expect.poll(async () => gaDisableFlag(page)).toBe(true);
    const countOnPrivate = (await dataLayer(page)).length;
    await quietPeriod(page, 2000);
    expect((await dataLayer(page)).length).toBe(countOnPrivate);
    await clientNavigate(page, '/cart');
    await expect(page).toHaveURL(/\/cart$/);
    await expectPageNotReloaded(page);
    await expect.poll(async () => gaDisableFlag(page)).toBe(false);
    await expect
      .poll(async () => (await gaEvents(page, 'page_view')).length)
      .toBeGreaterThan(viewsBefore);
  });

  test('with consent already stored, a product page sends view_item exactly once, also though the consent chunk loads after the page (review M-1)', async ({
    page,
    baseURL,
  }) => {
    await stubProviders(page);
    await storeDecision(page, baseURL, {analytics: true, marketing: true});
    const product = await firstProductPath(page, '/collections/all');
    await gotoReady(page, product);
    await expect
      .poll(async () => (await gaEvents(page, 'view_item')).length)
      .toBe(1);
    // Give a second, duplicate send the chance to arrive before asserting there is none (negative assertion).
    await quietPeriod(page, 2000);
    expect((await gaEvents(page, 'view_item')).length).toBe(1);
    const [viewItem] = await gaEvents(page, 'view_item');
    const params = viewItem?.params as {
      currency?: string;
      value?: number;
      items?: {item_id?: string; price?: number; quantity?: number}[];
    };
    expect(params.currency).toBe('USD');
    expect(params.items?.length).toBe(1);
    expect(params.items?.[0]?.item_id).toMatch(/^\d+$/);
    expect(params.items?.[0]?.price).toBeGreaterThan(0);
    // The page view recorded with that load is not a duplicate either.
    await expect
      .poll(async () => (await gaEvents(page, 'page_view')).length)
      .toBeLessThanOrEqual(1);
  });

  test('a product card click sends select_item once with list id, position and price, and no brand (data-si)', async ({
    page,
    baseURL,
  }) => {
    await stubProviders(page);
    await storeDecision(page, baseURL, {analytics: true, marketing: true});
    await gotoReady(page, '/collections/all');
    await expect
      .poll(() => page.evaluate(() => Reflect.has(window, 'dataLayer')))
      .toBe(true);
    await expect
      .poll(async () =>
        (await dataLayer(page)).some((entry) => entry.kind === 'config'),
      )
      .toBe(true);
    const link = page.locator('article a[data-si]').nth(1);
    const attribute = (await link.getAttribute('data-si')) ?? '';
    const [gid, cents, position, listId] = attribute.split('|');
    expect(gid).toMatch(/^(gid:\/\/shopify\/Product\/)?\d+$/);
    expect(cents).toMatch(/^\d{1,9}$/);
    expect(position).toBe('1');
    expect(listId).toBe('all');
    await link.click();
    await expect
      .poll(async () => (await gaEvents(page, 'select_item')).length)
      .toBe(1);
    const [selected] = await gaEvents(page, 'select_item');
    const params = selected?.params as {
      item_list_id?: string;
      transport_type?: string;
      items?: {
        item_id?: string;
        price?: number;
        index?: number;
        item_brand?: string;
        item_name?: string;
      }[];
    };
    expect(params.item_list_id).toBe('all');
    expect(params.transport_type).toBe('beacon');
    expect(params.items?.length).toBe(1);
    expect(params.items?.[0]?.index).toBe(1);
    expect(params.items?.[0]?.item_brand).toBeUndefined();
    expect(params.items?.[0]?.item_name?.length).toBeGreaterThan(0);
    expect(params.items?.[0]?.price).toBeCloseTo(Number(cents) / 100, 2);
    expect(params.items?.[0]?.item_id).toBe(gid?.replace(/^.*\//, ''));
  });

  // The card attribute on every surface that shows product cards (REQ-ANL-001): home, a collection, search, a brand.
  // Each reads the list id back from the card itself and expects Google to receive the same one, once.
  const SURFACES: {
    label: string;
    open: (page: Page) => Promise<string | null>;
    listId: (fromCard: string) => boolean;
  }[] = [
    {
      label: 'home (featured products)',
      open: async () => '/',
      listId: (id) => /^[a-z0-9-]+$/.test(id),
    },
    {
      label: 'a collection page',
      open: async (page) => {
        await gotoReady(page, '/collections');
        return (
          (await page
            .locator('main a[href^="/collections/"]')
            .first()
            .getAttribute('href')) ?? null
        );
      },
      listId: (id) => /^[a-z0-9-]+$/.test(id),
    },
    {
      label: 'search results',
      open: async (page) => {
        await gotoReady(page, '/collections/all');
        const title =
          (await page.locator('article a[data-si]').first().innerText()) ?? '';
        const word = title
          .split(/\s+/)
          .find((part) => /^[A-Za-z]{4,}$/.test(part));
        return word ? `/search?q=${encodeURIComponent(word)}` : null;
      },
      listId: (id) => id === 'search',
    },
    {
      label: 'a brand page',
      open: async (page) => {
        await gotoReady(page, '/brands');
        // The brand index lists fixture brands in the dev server only; a production build of a store with no brand
        // metaobjects has none, which is a data gap, not a failure: the test skips with that reason.
        const brands = page
          .getByRole('main')
          .getByRole('list', {name: 'Brands'})
          .getByRole('link');
        return (await brands.count()) === 0
          ? null
          : ((await brands.first().getAttribute('href')) ?? null);
      },
      listId: (id) => /^brand-[a-z0-9-]+$/.test(id),
    },
  ];

  for (const surface of SURFACES) {
    test(`select_item on ${surface.label}: one event, with the list id the card carries`, async ({
      page,
      baseURL,
    }) => {
      await stubProviders(page);
      await storeDecision(page, baseURL, {analytics: true, marketing: true});
      const path = await surface.open(page);
      test.skip(path === null, `no way into ${surface.label} on this store`);
      await gotoReady(page, path ?? '/');
      // Not a skip (review m-6): a listing without cards, or a card with a USD price and no data-si, is a defect.
      const articles = page.locator('article');
      expect(
        await articles.count(),
        `${surface.label} shows product cards`,
      ).toBeGreaterThan(0);
      const priced = articles.filter({hasText: /\$\s?\d/});
      const pricedCount = await priced.count();
      expect(
        pricedCount,
        `${surface.label} shows at least one card with a USD price`,
      ).toBeGreaterThan(0);
      for (let index = 0; index < pricedCount; index += 1) {
        await expect(
          priced.nth(index).locator('a[data-si]'),
          `card ${index} with a USD price carries data-si`,
        ).toHaveCount(1);
      }
      const cards = page.locator('article a[data-si]');
      await expect
        .poll(async () =>
          (await dataLayer(page)).some((entry) => entry.kind === 'config'),
        )
        .toBe(true);
      const link = cards.first();
      const [id, , position, listId] = (
        (await link.getAttribute('data-si')) ?? ''
      ).split('|');
      expect(surface.listId(listId ?? ''), `list id "${listId}"`).toBe(true);
      await link.click();
      if (!/^(gid:\/\/shopify\/Product\/)?\d+$/.test(id ?? '')) {
        // The brand preview lists fixture products ("fixture-product:..."), which are not Shopify ids: the mapper must
        // refuse them (nothing is sent for an id Google could not join to a product) rather than guess.
        test.info().annotations.push({
          type: 'fixture-ids',
          description: `card id "${id}" is not a Shopify product id: asserting that no select_item is sent`,
        });
        await expect(page).toHaveURL(/\/products\//);
        await quietPeriod(page, 2000);
        expect(await gaEvents(page, 'select_item')).toEqual([]);
        return;
      }
      await expect
        .poll(async () => (await gaEvents(page, 'select_item')).length)
        .toBe(1);
      const [selected] = await gaEvents(page, 'select_item');
      const params = selected?.params as {
        item_list_id?: string;
        items?: {index?: number}[];
      };
      expect(params.item_list_id).toBe(listId);
      expect(params.items?.[0]?.index).toBe(Number(position));
    });
  }

  test('select_item is not sent without consent (the click only navigates)', async ({
    page,
  }) => {
    const requests = await stubProviders(page);
    await gotoReady(page, '/collections/all');
    await showBanner(page);
    await page.locator('article a[data-si]').first().click();
    await expect(page).toHaveURL(/\/products\//);
    await quietPeriod(page, 2000);
    expect(requests).toEqual([]);
    expect(
      await page.evaluate(() => Reflect.get(window, 'dataLayer')),
    ).toBeUndefined();
  });

  test('a listing reports view_item_list once with its products and indexes; the listing code is fetched on listing pages only', async ({
    page,
    baseURL,
  }) => {
    await stubProviders(page);
    const listingChunk = watchRequests(page, LISTING_EVENTS_CHUNK);
    await storeDecision(page, baseURL, {analytics: true, marketing: true});
    await gotoReady(page, '/');
    await quietPeriod(page, 2000);
    expect(listingChunk, 'home is not a listing').toEqual([]);
    await gotoReady(page, '/collections/all');
    await expect
      .poll(async () => (await gaEvents(page, 'view_item_list')).length)
      .toBe(1);
    expect(listingChunk.length).toBeGreaterThan(0);
    await quietPeriod(page, 2000);
    const lists = await gaEvents(page, 'view_item_list');
    expect(lists.length).toBe(1);
    const params = lists[0]?.params as {
      item_list_id?: string;
      items?: {index?: number; item_id?: string}[];
    };
    expect(params.item_list_id).toBe('all');
    expect((params.items ?? []).length).toBeGreaterThan(1);
    expect((params.items ?? []).map((item) => item.index)).toEqual(
      (params.items ?? []).map((_, index) => index),
    );
  });

  test('consent can be withdrawn from the footer button: current choices shown, sending stops, tools told to stop, cookies cleared', async ({
    page,
    baseURL,
  }) => {
    const requests = await stubProviders(page);
    await storeDecision(page, baseURL, {analytics: true, marketing: true});
    await page.context().addCookies([
      {name: '_ga', value: 'GA1.1.111.222', url: baseURL ?? ''},
      {name: '_fbp', value: 'fb.1.111.222', url: baseURL ?? ''},
    ]);
    await gotoReady(page, '/');
    await expect
      .poll(() => requests.some((url) => META_HOST.test(url)))
      .toBe(true);
    await expect
      .poll(async () => (await metaCalls(page)).includes('consent:grant'))
      .toBe(true);
    await footerPrivacyButton(page).click();
    const dialog = page.getByRole('dialog', {name: 'Privacy choices'});
    await expect(
      dialog.getByRole('checkbox', {name: /Analytics/}),
    ).toBeChecked();
    await expect(
      dialog.getByRole('checkbox', {name: /Marketing/}),
    ).toBeChecked();
    await dialog.getByRole('button', {name: 'Reject all'}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Focus goes back to the control that opened the dialog (it still exists); the move to <main> is only for a
    // first answer given in the banner, whose controls disappear.
    await expect(footerPrivacyButton(page)).toBeFocused();
    await expect.poll(async () => gaDisableFlag(page)).toBe(true);
    await expect
      .poll(async () => (await metaCalls(page)).includes('consent:revoke'))
      .toBe(true);
    await expect
      .poll(async () =>
        (await page.context().cookies())
          .map((cookie) => cookie.name)
          .filter((name) => name === '_ga' || name === '_fbp'),
      )
      .toEqual([]);
    // Sending has stopped: a further page view adds nothing to either provider.
    const gaBefore = (await dataLayer(page)).length;
    const metaBefore = (await metaCalls(page)).length;
    await page.getByRole('link', {name: /cart/i}).first().click();
    await quietPeriod(page, 2500);
    expect((await dataLayer(page)).length).toBe(gaBefore);
    expect((await metaCalls(page)).length).toBe(metaBefore);
    // The withdrawal is stored: a reload shows no banner and loads no provider.
    const after = requests.length;
    await page.reload();
    await page.waitForLoadState('networkidle');
    await quietPeriod(page);
    expect(requests.length).toBe(after);
  });
});

// REQ-ANL-001 / NFR-011 / NFR-001 / NFR-003: the banner at the three widths the plan names. On the phone project the
// device's own 412 px is covered by the tests above; 320 and 360 are set explicitly on both projects, 1280 on desktop.
test.describe('banner layout at 320, 360 and 1280 px (NFR-001, NFR-003)', () => {
  test.skip(!ANALYTICS_ON, 'needs E2E_ANALYTICS=on and an env file with ids');

  for (const [width, height] of [
    [320, 568],
    [360, 640],
    [1280, 800],
  ] as const) {
    test(`${width} px: inside the viewport, no overflow, 44 px buttons, no serious axe finding, dialog usable`, async ({
      page,
    }, info) => {
      test.skip(
        info.project.name.includes('mobile') && width > 600,
        'A 1280 px window is a desktop case; the desktop project covers it.',
      );
      await stubProviders(page);
      await page.setViewportSize({width, height});
      await gotoReady(page, '/');
      await showBanner(page);
      await settled(page);
      await expectNoHorizontalScroll(page);
      const box = await banner(page).boundingBox();
      expect(box, 'banner box').not.toBeNull();
      if (box) {
        expect(box.x).toBeGreaterThanOrEqual(-0.5);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
        expect(box.y + box.height).toBeLessThanOrEqual(height + 0.5);
        // It must leave the page usable: not more than 60 % of a small screen.
        expect(box.height / height).toBeLessThanOrEqual(0.6);
      }
      for (const name of ['Accept all', 'Reject all', 'Choose']) {
        const button = banner(page).getByRole('button', {name});
        await expect(button).toBeInViewport();
        const buttonBox = await button.boundingBox();
        expect(buttonBox?.height ?? 0, `${name} height`).toBeGreaterThanOrEqual(
          44,
        );
        expect(buttonBox?.width ?? 0, `${name} width`).toBeGreaterThanOrEqual(
          44,
        );
      }
      // Accept and Reject are the same size (refusing is as easy as agreeing).
      const accept = await banner(page)
        .getByRole('button', {name: 'Accept all'})
        .boundingBox();
      const reject = await banner(page)
        .getByRole('button', {name: 'Reject all'})
        .boundingBox();
      expect(Math.round(accept?.width ?? 0)).toBe(
        Math.round(reject?.width ?? -1),
      );
      expect(Math.round(accept?.height ?? 0)).toBe(
        Math.round(reject?.height ?? -1),
      );
      await expectNoSeriousA11yViolations(page);

      await banner(page).getByRole('button', {name: 'Choose'}).click();
      const dialog = page.getByRole('dialog', {name: 'Privacy choices'});
      await expect(dialog).toBeVisible();
      await settled(page);
      const dialogBox = await dialog.boundingBox();
      if (dialogBox) {
        expect(dialogBox.x).toBeGreaterThanOrEqual(-0.5);
        expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(width + 0.5);
      }
      for (const name of ['Save choices', 'Reject all']) {
        await expect(dialog.getByRole('button', {name})).toBeVisible();
      }
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
    });
  }

  // WCAG 2.4.11 / 2.5.8: with the banner open and the page scrolled to its end, every footer link and button must still
  // be reachable (the document cannot scroll further, so the banner's scroll padding alone cannot lift them).
  test('at the end of the page the banner does not cover any footer link or button', async ({
    page,
  }) => {
    await stubProviders(page);
    await gotoReady(page, '/');
    await showBanner(page);
    await settled(page);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            Math.round(window.scrollY + window.innerHeight) >=
            document.documentElement.scrollHeight - 1,
        ),
      )
      .toBe(true);
    const covered = await page.evaluate(() => {
      const hidden: string[] = [];
      const controls = document.querySelectorAll<HTMLElement>(
        'footer a, footer button, [role="contentinfo"] a, [role="contentinfo"] button',
      );
      for (const control of controls) {
        const box = control.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        const top = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        );
        if (top && !control.contains(top) && !top.contains(control)) {
          hidden.push(
            `${control.tagName.toLowerCase()} "${(control.textContent ?? '').trim().slice(0, 30)}" under ${top.closest('[data-consent]') ? 'the consent banner' : top.tagName.toLowerCase()}`,
          );
        }
      }
      return hidden;
    });
    expect(covered, 'footer controls covered by another element').toEqual([]);
  });

  // WCAG 1.4.10 at 400 % zoom (a 1280 px window zoomed to 400 % is 320 x 256 CSS px, the viewport a11y-audit uses): a
  // fixed banner taller than the window would hide the page and could put its own buttons out of reach.
  test('at 400 % zoom (320 x 256 px) the banner fits the window, its buttons are reachable and it leaves part of the page visible', async ({
    page,
  }, info) => {
    test.skip(
      info.project.name.includes('mobile'),
      'The window size is set explicitly, so the desktop project covers it.',
    );
    await stubProviders(page);
    await page.setViewportSize({width: 320, height: 256});
    await gotoReady(page, '/');
    await showBanner(page);
    await settled(page);
    const box = await banner(page).boundingBox();
    expect(box, 'banner box').not.toBeNull();
    const height = box?.height ?? 0;
    expect(height, 'banner height in a 256 px window').toBeLessThanOrEqual(256);
    for (const name of ['Accept all', 'Reject all', 'Choose']) {
      await expect(
        banner(page).getByRole('button', {name}),
        `${name} is inside the window`,
      ).toBeInViewport({ratio: 1});
    }
    // Part of the page (here: the header) must remain visible above the banner.
    expect(
      256 - height,
      'px of the window left above the banner',
    ).toBeGreaterThanOrEqual(64);
  });

  // WCAG 2.4.7 and 1.4.11 (QA-ANL-2 and its 320 x 256 remainder): the banner's text is a scroll container, which clips
  // whatever lies outside its box, so after Tab the whole ring of the policy link (outline width plus offset on every
  // side, on every line the link wraps to) has to lie inside that box. brand-verification measures this at its own
  // widths; this one names the small windows, including the one where the text really scrolls.
  for (const [width, height] of [
    [1280, 800],
    [360, 800],
    [320, 568],
    [320, 256],
  ]) {
    test(`${width} x ${height} px: after Tab the policy link's whole focus ring is inside the banner's scroll area`, async ({
      page,
    }, info) => {
      test.skip(
        info.project.name.includes('mobile'),
        'The window size is set explicitly, so the desktop project covers it.',
      );
      await stubProviders(page);
      await page.setViewportSize({width, height});
      await gotoReady(page, '/');
      await showBanner(page);
      await settled(page);
      let onLink = false;
      for (let presses = 0; presses < 4 && !onLink; presses += 1) {
        await page.keyboard.press('Tab');
        onLink = await page.evaluate(
          () =>
            document.activeElement?.textContent?.trim() === 'Privacy policy',
        );
      }
      expect(onLink, 'Tab reaches the banner policy link').toBe(true);
      // Let a scroll the focus change caused finish before measuring.
      await settled(page);
      const room = await page.evaluate(() => {
        const link = document.activeElement;
        if (!link) return null;
        const style = getComputedStyle(link);
        const reach =
          parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
        let scroller: Element | null = link.parentElement;
        while (
          scroller &&
          !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowY)
        ) {
          scroller = scroller.parentElement;
        }
        if (!scroller) return null;
        const box = scroller.getBoundingClientRect();
        const rect = link.getBoundingClientRect();
        const round = (value: number) => Math.round(value * 10) / 10;
        return {
          reach,
          left: round(rect.left - reach - box.left),
          right: round(box.right - (rect.right + reach)),
          top: round(rect.top - reach - box.top),
          bottom: round(box.bottom - (rect.bottom + reach)),
        };
      });
      expect(room, 'the link sits inside a scroll container').not.toBeNull();
      expect(room?.reach, 'ring reach in px').toBeGreaterThan(0);
      // Negative: that many px of the ring are cut off on that side.
      for (const side of ['left', 'right', 'top', 'bottom'] as const) {
        expect(
          room?.[side],
          `px of room for the ring on the ${side} (negative = clipped)`,
        ).toBeGreaterThanOrEqual(0);
      }
    });
  }

  test('the bottom scroll padding follows the banner when the window is resized', async ({
    page,
  }, info) => {
    test.skip(
      info.project.name.includes('mobile'),
      'Resizing from 1280 px is a desktop case.',
    );
    await stubProviders(page);
    await page.setViewportSize({width: 1280, height: 800});
    await gotoReady(page, '/');
    await showBanner(page);
    const padding = () =>
      page.evaluate(() => {
        const element = document.querySelector('[data-consent="banner"]');
        return {
          padding: document.documentElement.style.scrollPaddingBottom,
          height: element ? (element as HTMLElement).offsetHeight : -1,
        };
      });
    const wide = await padding();
    expect(wide.padding).toBe(`${wide.height + 16}px`);
    await page.setViewportSize({width: 320, height: 568});
    await expect
      .poll(async () => {
        const now = await padding();
        return (
          now.padding === `${now.height + 16}px` && now.height !== wide.height
        );
      })
      .toBe(true);
  });
});
