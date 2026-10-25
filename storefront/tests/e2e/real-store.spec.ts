import {expect, test, type Page, type TestInfo} from '@playwright/test';
import {
  blockingViolations,
  isBlockedTelemetryRefusal,
  runAxeAudit,
  summariseAudit,
} from './helpers/a11y';
import {gotoReady} from './helpers/catalog';
import {expectFooterContract} from './helpers/footer';

// Real Shopify DEVELOPMENT store smoke: READ and CART paths only (REQ-CART-001, REQ-CHK-001, REQ-COL-001, REQ-PDP-001,
// REQ-SRCH-001, REQ-SEO-001, NFR-003, NFR-008, NFR-010). This is the first spec that runs against a real store; every
// other e2e spec ran on mock.shop, bedding.mock.shop or fixtures.
//
//   Start your own server:   npm run dev -- --port 6100 --env-file .env.demo
//   Run:                     E2E_REAL_STORE=1 E2E_PORT=6100 E2E_ENV_FILE=.env.demo npx playwright test tests/e2e/real-store.spec.ts
//
// The env file is git-ignored and never read here. Nothing below types personal data or payment data: the checkout test
// loads Shopify's hosted page read-only and leaves. The dev store holds ONE product (handle `testing`) and no
// `mattresses` collection yet, so the spec asserts structure and records what it observes (lines prefixed
// `[real-store]` on stdout) instead of asserting catalog content that only exists on this store.

const REAL_STORE = process.env.E2E_REAL_STORE === '1';
const SKIP_REASON =
  'Runs only against a real Shopify development store: set E2E_REAL_STORE=1 and start a server with --env-file .env.demo (see docs/testing/REAL_STORE_FINDINGS.md).';

/** Prints and attaches one observation so the run record has the real values, not just pass or fail. */
function observe(info: TestInfo, key: string, value: unknown) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  // The run record is read from stdout on purpose (observations are real store values, not assertions).
  // eslint-disable-next-line no-console
  console.log(`[real-store] ${info.project.name} | ${key}: ${text}`);
  info.annotations.push({type: `observed ${key}`, description: text});
}

type Seen = {type: string; text: string; url: string};

/**
 * Every console error, warning and uncaught exception, unfiltered. The shared collectors hide the mock-store noise
 * (Customer Privacy, CAD); on a real store that noise is supposed to be gone, so nothing is hidden here. The only
 * classification is Shopify's own blocked telemetry refusal (matched by exact host, DEC-045), which is reported
 * separately instead of dropped.
 */
function watchConsole(page: Page) {
  const seen: Seen[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error' && message.type() !== 'warning') return;
    seen.push({
      type: message.type(),
      text: message.text(),
      url: message.location().url,
    });
  });
  page.on('pageerror', (error) =>
    seen.push({type: 'pageerror', text: error.message, url: ''}),
  );
  return {
    seen,
    errors: () =>
      seen.filter(
        (entry) =>
          entry.type !== 'warning' && !isBlockedTelemetryRefusal(entry.text),
      ),
    warnings: () => seen.filter((entry) => entry.type === 'warning'),
    telemetryRefusals: () =>
      seen.filter((entry) => isBlockedTelemetryRefusal(entry.text)),
  };
}

function reportConsole(
  info: TestInfo,
  console_: ReturnType<typeof watchConsole>,
) {
  const short = (entry: Seen) =>
    `${entry.type}: ${entry.text.slice(0, 200).replace(/\s+/g, ' ')}`;
  if (console_.errors().length > 0)
    observe(info, 'console errors', console_.errors().map(short));
  if (console_.warnings().length > 0)
    observe(info, 'console warnings', console_.warnings().map(short));
  if (console_.telemetryRefusals().length > 0)
    observe(
      info,
      'blocked telemetry refusals (known, DEC-045)',
      console_.telemetryRefusals().length,
    );
}

/** The `.myshopify.com` host the server was started with, read from the CSP the app builds from PUBLIC_STORE_DOMAIN. */
async function storeHostOf(page: Page): Promise<string> {
  const response = await page.request.get('/');
  const csp = response.headers()['content-security-policy'] ?? '';
  const match = /https:\/\/([a-z0-9-]+\.myshopify\.com)/.exec(csp);
  expect(match, 'the CSP names the store host').not.toBeNull();
  return match?.[1] ?? '';
}

const PRODUCT = '/products/testing';

/** Adds the store's one product from its page and waits for Shopify's answer, so later steps see a real cart. */
async function addTestingProduct(page: Page) {
  await gotoReady(page, PRODUCT);
  const answered = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.startsWith('/cart') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', {name: 'Add to cart'}).click();
  const response = await answered;
  expect(response.status(), 'cart add answered by Shopify').toBe(200);
  const drawer = page.getByRole('dialog', {name: 'Cart'});
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('list', {name: 'Cart items'})).toBeVisible();
  return drawer;
}

/** "$193.00" -> 19300. Read from the page as a shopper sees it; only the test compares, never the app. */
function cents(text: string): number {
  const match = /\$([\d,]+)\.(\d{2})/.exec(text);
  expect(match, `an amount in "${text}"`).not.toBeNull();
  return (
    Number((match?.[1] ?? '0').replace(/,/g, '')) * 100 + Number(match?.[2])
  );
}

async function subtotalText(scope: Page | ReturnType<Page['locator']>) {
  return scope
    .locator('dl')
    .filter({hasText: 'Subtotal'})
    .locator('dd')
    .first()
    .innerText();
}

/**
 * Waits until the subtotal shows an amount (the optimistic cart shows "-" until Shopify's cart arrives) and returns
 * the text with how long the dash was visible, in milliseconds, measured from the call.
 */
async function subtotalWhenReady(
  scope: Page | ReturnType<Page['locator']>,
): Promise<{text: string; dashMs: number}> {
  const started = Date.now();
  await expect
    .poll(async () => /\$[\d,]+\.\d{2}/.test(await subtotalText(scope)), {
      message: 'the subtotal shows an amount, not a dash',
      timeout: 20_000,
    })
    .toBe(true);
  return {text: await subtotalText(scope), dashMs: Date.now() - started};
}

test.describe('real development store: pages render from real data (READ paths)', () => {
  test.skip(!REAL_STORE, SKIP_REASON);

  const PAGES: ReadonlyArray<{path: string; heading: RegExp | null}> = [
    {path: '/', heading: /./},
    {path: '/collections/all', heading: /^All products$/},
    {path: '/collections/frontpage', heading: /./},
    {path: PRODUCT, heading: /^testing$/},
    {path: '/search?q=testing', heading: /./},
    {path: '/cart', heading: /^Your cart$/},
    {path: '/policies', heading: /^Policies$/},
  ];

  for (const {path, heading} of PAGES) {
    test(`${path} answers 200 with a heading and no console errors`, async ({
      page,
    }, info) => {
      const console_ = watchConsole(page);
      const response = await page.goto(path);
      await page.waitForLoadState('networkidle');
      expect(response?.status()).toBe(200);
      if (heading) {
        await expect(page.getByRole('heading', {level: 1}).first()).toHaveText(
          heading,
        );
      }
      reportConsole(info, console_);
      expect(console_.errors()).toEqual([]);
    });
  }

  test('the product page shows the real title, a USD price and availability; Price logs nothing about currency (NFR-008)', async ({
    page,
  }, info) => {
    const console_ = watchConsole(page);
    await gotoReady(page, PRODUCT);
    await expect(
      page.getByRole('heading', {level: 1, name: 'testing'}),
    ).toBeVisible();
    const price = await page
      .locator('main')
      .getByText(/^\$[\d,]+\.\d{2}$/)
      .first()
      .innerText();
    observe(info, 'product price shown', price);
    expect(price).toMatch(/^\$[\d,]+\.\d{2}$/);
    await expect(page.getByText('In stock')).toBeVisible();
    await expect(page.getByRole('button', {name: 'Add to cart'})).toBeEnabled();
    // A non-USD store would make Price log "Only USD is supported, got XXX": the store must be USD (NFR-008).
    const currencyLogs = console_.seen.filter((entry) =>
      entry.text.includes('Only USD is supported'),
    );
    observe(info, 'Only-USD log lines', currencyLogs.length);
    expect(currencyLogs).toEqual([]);
    // The product has no `custom.*` metafields and no image: both must degrade to fixed, quiet states.
    observe(
      info,
      'product image placeholders (no image uploaded)',
      await page.getByRole('img', {name: /No image available/}).count(),
    );
    reportConsole(info, console_);
    expect(console_.errors()).toEqual([]);
  });

  test('a search for the product finds it; a search for nonsense shows no product card', async ({
    page,
  }, info) => {
    await gotoReady(page, '/search?q=testing');
    await expect(
      page.locator('article a[href="/products/testing"]').first(),
    ).toBeVisible();
    await gotoReady(page, '/search?q=zzqxjvk-no-such-thing');
    await expect(page.locator('article a[href^="/products/"]')).toHaveCount(0);
    await expect(page.getByRole('heading', {level: 1}).first()).toBeVisible();
    observe(
      info,
      'empty search main text',
      (await page.locator('main').innerText())
        .slice(0, 160)
        .replace(/\s+/g, ' '),
    );
  });

  test('an unknown URL is a 404 page, not a 500', async ({page}, info) => {
    const console_ = watchConsole(page);
    const response = await page.goto('/this-page-does-not-exist-qa-2026');
    await page.waitForLoadState('networkidle');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', {level: 1}).first()).toBeVisible();
    await expect(page.locator('main')).not.toContainText(/stack|at .*\.tsx/i);
    // The browser logs its own "Failed to load resource" line for a 404 document in some cases; report, do not hide.
    reportConsole(info, console_);
    expect(
      console_
        .errors()
        .filter((entry) => !/Failed to load resource.*404/.test(entry.text)),
    ).toEqual([]);
  });

  test('sitemap.xml and its children are well formed and list the real product; robots.txt names the sitemap', async ({
    request,
  }, info) => {
    const index = await request.get('/sitemap.xml');
    expect(index.status()).toBe(200);
    expect(index.headers()['content-type']).toContain('xml');
    const indexXml = await index.text();
    expect(indexXml).toContain('<sitemapindex');
    const children = [
      ...indexXml.matchAll(/<loc>[^<]*?(\/sitemap\/[^<]+)<\/loc>/g),
    ].map((m) => m[1] ?? '');
    observe(info, 'sitemap children', children);
    expect(children.length).toBeGreaterThan(0);
    const statuses: Record<string, number> = {};
    let productsXml = '';
    for (const child of children) {
      const response = await request.get(child);
      statuses[child] = response.status();
      if (child.includes('/products/')) productsXml = await response.text();
    }
    observe(info, 'sitemap child statuses', statuses);
    for (const [child, status] of Object.entries(statuses))
      expect(status, child).toBe(200);
    expect(productsXml).toContain('/products/testing');
    const robots = await request.get('/robots.txt');
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toMatch(
      /Sitemap: https?:\/\/[^\s]+\/sitemap\.xml/,
    );
  });

  test('pages that read metaobjects or sample data that the store does not have yet degrade to fixed states (V-05)', async ({
    page,
  }, info) => {
    // Definitions (brand, homepage_section, promo_tile, site_settings, store, quiz_*) do not exist on the dev store yet.
    // Each page must answer 200 with a heading and no console error; nothing may become a 500.
    const paths = [
      '/',
      '/brands',
      '/brands/mattressfitness',
      '/stores',
      '/compare',
      '/quiz',
      '/blogs',
      '/pages/contact',
      '/pages/about',
      '/pages/faq',
    ];
    const statuses: Record<string, number> = {};
    for (const path of paths) {
      const console_ = watchConsole(page);
      const response = await page.goto(path);
      await page.waitForLoadState('networkidle');
      const status = response?.status() ?? 0;
      statuses[path] = status;
      expect(status, `${path} is not a server error`).toBeLessThan(500);
      if (status === 200) {
        await expect(
          page.getByRole('heading', {level: 1}).first(),
        ).toBeVisible();
      }
      // REQ-CNT-001 (P6-09): a content page that answers 404 must have no footer link (a 404 link is the defect),
      // and the footer must be there to say so. The page may be 404 today and 200 once the owner writes it.
      if (status === 404 && path.startsWith('/pages/')) {
        await expect(
          page.getByRole('contentinfo'),
          `${path} shell`,
        ).toBeVisible();
        await expect(
          page.locator(`footer a[href="${path}"]`),
          `${path} answers 404: the footer must not link to it`,
        ).toHaveCount(0);
      }
      // A 404 document makes the browser log one "Failed to load resource" line for that very URL: expected, matched by
      // status and URL, and still reported. Any other console error fails.
      expect(
        console_
          .errors()
          .filter(
            (entry) =>
              !(
                status === 404 &&
                entry.url.endsWith(path) &&
                /^Failed to load resource.*404/.test(entry.text)
              ),
          ),
        `${path} console`,
      ).toEqual([]);
      page.removeAllListeners('console');
      page.removeAllListeners('pageerror');
    }
    observe(info, 'degrading page statuses', statuses);
  });

  test('the footer links only content that resolves on this store: pages, policies and the journal blog (REQ-CNT-001, P6-09)', async ({
    page,
    request,
  }, info) => {
    await gotoReady(page, '/');
    const report = await expectFooterContract(page, request);
    observe(info, 'footer content links shown', report.linked);
    observe(info, 'registry pages with no footer link', report.notLinked);
    observe(info, 'content path statuses', report.statuses);
  });

  test('a missing collection (`mattresses` is not on the store yet) is a clean 404', async ({
    page,
  }, info) => {
    const response = await page.goto('/collections/mattresses');
    const status = response?.status() ?? 0;
    observe(info, '/collections/mattresses status', status);
    // 404 today; 200 once the store owner adds the collection. A 5xx is a defect either way.
    expect([200, 404]).toContain(status);
    await expect(page.getByRole('heading', {level: 1}).first()).toBeVisible();
  });

  test('/collections/frontpage (a real collection) returns what filters? (V-04)', async ({
    page,
  }, info) => {
    await gotoReady(page, '/collections/frontpage');
    const filterButton = page.getByRole('button', {name: /filter/i});
    const filterRegion = page.getByRole('group', {
      name: /filter|size|brand|price/i,
    });
    observe(info, 'filter buttons', await filterButton.count());
    observe(info, 'filter groups in DOM', await filterRegion.count());
    observe(
      info,
      'minimum-price inputs (price filter shown without Search & Discovery)',
      await page.getByLabel('Minimum price in dollars').count(),
    );
    await expect(page.getByRole('combobox', {name: 'Sort by'})).toBeVisible();
    // The page must stay usable whatever the store returns.
    await expect(
      page.locator('article a[href="/products/testing"]'),
    ).toBeVisible();
  });

  test('the price filter is applied by the real store: the $193.00 product is kept by a range around it and dropped by a range above it (V-04)', async ({
    page,
  }, info) => {
    const card = 'article a[href="/products/testing"]';
    await gotoReady(page, '/collections/frontpage?price_min=100&price_max=300');
    const kept = await page.locator(card).count();
    await gotoReady(page, '/collections/frontpage?price_min=400&price_max=900');
    const dropped = await page.locator(card).count();
    observe(info, 'price 100-300 keeps the product', kept === 1);
    observe(info, 'price 400-900 drops the product', dropped === 0);
    expect(kept).toBe(1);
    expect(dropped).toBe(0);
    await expect(
      page.getByRole('heading', {name: 'No products match these filters'}),
    ).toBeVisible();
  });
});

test.describe('real development store: security headers on documents (NFR-010, REQ-SEO-001)', () => {
  test.skip(!REAL_STORE, SKIP_REASON);

  for (const path of [
    '/',
    '/collections/all',
    PRODUCT,
    '/cart',
    '/search?q=a',
    '/no-such-page-qa',
  ]) {
    test(`${path} carries the host-independent headers and a CSP`, async ({
      request,
    }, info) => {
      const response = await request.get(path);
      const headers = response.headers();
      observe(info, `${path} status`, response.status());
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['referrer-policy']).toBe(
        'strict-origin-when-cross-origin',
      );
      expect(headers['x-frame-options']).toBe('DENY');
      expect(headers['permissions-policy']).toContain('camera=()');
      expect(headers['cross-origin-opener-policy']).toBe(
        'same-origin-allow-popups',
      );
      expect(headers['content-security-policy']).toContain(
        "frame-ancestors 'none'",
      );
      expect(headers['content-security-policy-report-only']).toContain(
        "object-src 'none'",
      );
      // The server header names the platform; record it, it is a (minor) disclosure.
      observe(info, `${path} powered-by`, headers['powered-by'] ?? 'absent');
      if (path === '/cart') {
        expect(headers['cache-control']).toBe('private, no-store');
      }
    });
  }

  test('the store host is allowed in connect-src and form-action, the CSP names no unexpected host', async ({
    request,
  }, info) => {
    const response = await request.get('/');
    const csp = response.headers()['content-security-policy'] ?? '';
    const reportOnly =
      response.headers()['content-security-policy-report-only'] ?? '';
    const hosts = new Set(
      [...`${csp} ${reportOnly}`.matchAll(/https:\/\/([a-z0-9.*-]+)/g)].map(
        (match) => match[1] ?? '',
      ),
    );
    observe(info, 'https hosts in the CSPs', [...hosts].sort());
    // Only Shopify hosts: no Extend, Klaviyo, Google, Meta, Affirm or maps host in the demo configuration.
    for (const host of hosts) {
      expect(host, 'a Shopify host').toMatch(
        /(^|\.)(shopify\.com|shopifysvc\.com|myshopify\.com|shop\.app)$/,
      );
    }
  });
});

test.describe('real development store: cart on real Shopify carts (REQ-CART-001)', () => {
  test.skip(!REAL_STORE, SKIP_REASON);

  test('add to cart opens the drawer with the line, a USD subtotal and a Checkout link', async ({
    page,
  }, info) => {
    const console_ = watchConsole(page);
    const drawer = await addTestingProduct(page);
    await expect(drawer.getByRole('listitem').first()).toBeVisible();
    await expect(drawer.getByText('Subtotal')).toBeVisible();
    const first = await subtotalText(drawer);
    const {text: subtotal, dashMs} = await subtotalWhenReady(drawer);
    observe(info, 'drawer subtotal when the list first showed', first);
    observe(info, 'ms the drawer showed a dash after add (optimistic)', dashMs);
    observe(info, 'drawer subtotal', subtotal);
    expect(cents(subtotal)).toBeGreaterThan(0);
    await expect(drawer.getByRole('link', {name: 'Checkout'})).toHaveAttribute(
      'href',
      '/checkout-steps',
    );
    reportConsole(info, console_);
    expect(console_.errors()).toEqual([]);
  });

  test('quantity change doubles the subtotal, decrease restores it, removal shows the empty state', async ({
    page,
  }, info) => {
    const drawer = await addTestingProduct(page);
    const one = cents((await subtotalWhenReady(drawer)).text);
    await drawer.getByRole('button', {name: /^Increase quantity/}).click();
    await expect(drawer.getByRole('textbox', {name: /^Quantity/})).toHaveValue(
      '2',
    );
    await expect
      .poll(async () => cents(await subtotalText(drawer)), {
        message: 'subtotal follows Shopify after quantity 2',
      })
      .toBe(one * 2);
    await drawer.getByRole('button', {name: /^Decrease quantity/}).click();
    await expect(drawer.getByRole('textbox', {name: /^Quantity/})).toHaveValue(
      '1',
    );
    await expect.poll(async () => cents(await subtotalText(drawer))).toBe(one);
    await drawer.getByRole('button', {name: /^Remove .* from cart/}).click();
    await expect(
      drawer.getByRole('heading', {name: 'Your cart is empty'}),
    ).toBeVisible();
    observe(info, 'single-unit price (cents)', one);
  });

  test('the cart page shows the same line and total after a reload (cart cookie, Shopify cart)', async ({
    page,
  }) => {
    const drawer = await addTestingProduct(page);
    const inDrawer = (await subtotalWhenReady(drawer)).text;
    await page.keyboard.press('Escape');
    await gotoReady(page, '/cart');
    await expect(page.getByRole('list', {name: 'Cart items'})).toBeVisible();
    expect(await subtotalText(page.locator('main'))).toBe(inDrawer);
    await page.reload();
    await expect(page.getByRole('list', {name: 'Cart items'})).toBeVisible();
    expect(await subtotalText(page.locator('main'))).toBe(inDrawer);
  });

  test('a fake discount code is refused by Shopify and shown as not applying; it can be removed', async ({
    page,
  }, info) => {
    await addTestingProduct(page);
    await page.keyboard.press('Escape');
    await gotoReady(page, '/cart');
    const before = await subtotalText(page.locator('main'));
    const code = 'QA-FAKE-CODE-0000';
    const region = page.getByRole('region', {name: 'Discount code'});
    await region.getByLabel('Discount code').fill(code);
    await region.getByRole('button', {name: 'Apply'}).click();
    await expect(
      page.getByText('This code does not apply to your cart'),
    ).toBeVisible();
    await expect(page.getByText(code)).toBeVisible();
    expect(await subtotalText(page.locator('main'))).toBe(before);
    observe(
      info,
      'fake discount code outcome',
      'listed as not applying, subtotal unchanged',
    );
    await page
      .getByRole('button', {name: `Remove discount code ${code}`})
      .click();
    await expect(page.getByText(code)).toHaveCount(0);
  });

  test('hostile cart input is refused on the real store as on the mock (T-01, T-08)', async ({
    request,
  }) => {
    const tampered = await request.post('/cart', {
      form: {
        cartFormInput: JSON.stringify({
          action: 'LinesAdd',
          inputs: {
            lines: [
              {
                merchandiseId: 'gid://shopify/ProductVariant/1',
                quantity: 500,
                price: '0.01',
              },
            ],
          },
        }),
      },
    });
    expect(tampered.status()).toBe(400);
    const crossSite = await request.post('/cart', {
      headers: {Origin: 'https://evil.example'},
      form: {
        cartFormInput: JSON.stringify({
          action: 'LinesAdd',
          inputs: {
            lines: [
              {merchandiseId: 'gid://shopify/ProductVariant/1', quantity: 1},
            ],
          },
        }),
      },
    });
    expect([400, 403]).toContain(crossSite.status());
  });

  test('a variant id that does not exist on this store is refused without a 500 and leaves no cart line', async ({
    page,
    baseURL,
  }, info) => {
    // Well-formed but unknown to the real store: Shopify answers with userErrors; the app must not crash.
    const response = await page.request.post('/cart', {
      headers: {Origin: new URL(baseURL ?? 'http://localhost').origin},
      form: {
        cartFormInput: JSON.stringify({
          action: 'LinesAdd',
          inputs: {
            lines: [
              {merchandiseId: 'gid://shopify/ProductVariant/1', quantity: 1},
            ],
          },
        }),
      },
      maxRedirects: 0,
    });
    observe(info, 'unknown variant add status', response.status());
    expect(response.status()).toBeLessThan(500);
    await gotoReady(page, '/cart');
    await expect(
      page.getByRole('heading', {name: 'Your cart is empty'}),
    ).toBeVisible();
  });

  test('a quantity above the real stock is capped by Shopify and the shopper is told (V-16, REQ-CART-001)', async ({
    page,
  }, info) => {
    const drawer = await addTestingProduct(page);
    await subtotalWhenReady(drawer);
    const box = drawer.getByRole('textbox', {name: /^Quantity/});
    const answered = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.startsWith('/cart') &&
        response.request().method() === 'POST',
    );
    await box.fill('99');
    await box.press('Enter');
    const response = await answered;
    observe(info, 'LinesUpdate to 99 status', response.status());
    // Wait for the cart to settle on Shopify's answer, then read what the shopper sees.
    await expect
      .poll(async () => Number(await box.inputValue()), {
        message: 'quantity settles',
        timeout: 20_000,
      })
      .not.toBe(99);
    const settled = Number(await box.inputValue());
    const messages = await page
      .locator('[role="alert"], [role="status"]')
      .allInnerTexts();
    observe(info, 'quantity Shopify settled on', settled);
    observe(
      info,
      'alerts and statuses shown',
      messages
        .map((message) => message.replace(/\s+/g, ' ').trim())
        .filter(Boolean),
    );
    // Shopify, not the browser, decides what is available; the subtotal must equal quantity x unit price.
    const subtotal = cents((await subtotalWhenReady(drawer)).text);
    observe(info, 'subtotal at the capped quantity (cents)', subtotal);
    expect(settled).toBeGreaterThan(0);
    expect(settled).toBeLessThan(99);
    expect(subtotal % settled).toBe(0);
  });

  test('a quantity typed far above the limit is clamped in the browser and never sent above 99 (T-01)', async ({
    page,
  }, info) => {
    const drawer = await addTestingProduct(page);
    await subtotalWhenReady(drawer);
    const sent: number[] = [];
    page.on('request', (request) => {
      if (
        request.method() !== 'POST' ||
        !new URL(request.url()).pathname.startsWith('/cart')
      )
        return;
      const body = decodeURIComponent(
        request.postDataBuffer()?.toString('utf8') ?? '',
      );
      for (const match of body.matchAll(/"quantity":(\d+)/g))
        sent.push(Number(match[1]));
    });
    const box = drawer.getByRole('textbox', {name: /^Quantity/});
    const answered = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.startsWith('/cart') &&
        response.request().method() === 'POST',
    );
    await box.fill('100000');
    await box.press('Enter');
    await answered;
    observe(info, 'quantities sent after typing 100000', sent);
    expect(sent.length, 'one cart update was sent').toBeGreaterThan(0);
    expect(Math.max(...sent)).toBeLessThanOrEqual(99);
  });
});

test.describe('real development store: checkout hand-off, read-only (REQ-CHK-001, REQ-PRE-006)', () => {
  test.skip(!REAL_STORE, SKIP_REASON);

  test('the gate redirects to the store checkout host over https, uncached; an empty cart goes back to /cart', async ({
    page,
  }, info) => {
    const storeHost = await storeHostOf(page);
    const empty = await page.request.get('/checkout-steps', {maxRedirects: 0});
    expect(empty.status()).toBe(302);
    expect(new URL(empty.headers().location ?? '', 'http://x').pathname).toBe(
      '/cart',
    );

    await addTestingProduct(page);
    const gate = await page.request.get('/checkout-steps', {maxRedirects: 0});
    const target = new URL(gate.headers().location ?? '', 'http://x');
    // Only the host and the first path segments are recorded: the rest carries the cart key.
    observe(info, 'gate status', gate.status());
    observe(info, 'cart checkoutUrl host', target.hostname);
    observe(
      info,
      'cart checkoutUrl path prefix',
      target.pathname.split('/').slice(0, 3).join('/'),
    );
    observe(info, 'our /checkout-steps gate redirected', gate.status() === 302);
    expect(gate.status()).toBe(302);
    expect(target.protocol).toBe('https:');
    expect(target.hostname).toBe(storeHost);
    expect(gate.headers()['cache-control']).toBe('private, no-store');
  });

  /** Adds the product, opens the cart page, clicks Checkout and follows Shopify's redirects to the first page. Reads only. */
  async function goToCheckout(page: Page, info: TestInfo) {
    const storeHost = await storeHostOf(page);
    await addTestingProduct(page);
    await page.keyboard.press('Escape');
    await gotoReady(page, '/cart');
    const cartSubtotal = (await subtotalWhenReady(page.locator('main'))).text;
    const chain: string[] = [];
    page.on('response', (response) => {
      if (!response.request().isNavigationRequest()) return;
      const url = new URL(response.url());
      // Only host and the first path segments: the rest carries the cart key.
      chain.push(
        `${response.status()} ${url.hostname}${url.pathname.split('/').slice(0, 3).join('/')}`,
      );
    });
    await page.locator('main').getByRole('link', {name: 'Checkout'}).click();
    await page.waitForURL((url) => url.hostname !== 'localhost', {
      timeout: 60_000,
    });
    await page.waitForLoadState('domcontentloaded');
    const landed = new URL(page.url());
    observe(info, 'cart page subtotal', cartSubtotal);
    observe(info, 'navigation chain', chain);
    observe(
      info,
      'landed on',
      `${landed.hostname}${landed.pathname.split('/').slice(0, 3).join('/')}`,
    );
    return {storeHost, landed, cartSubtotal};
  }

  test('Checkout from the cart page leaves our site for the https page of the store host; nothing is submitted', async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    const {storeHost, landed} = await goToCheckout(page, info);
    expect(landed.protocol).toBe('https:');
    expect(landed.hostname).toBe(storeHost);
    await page.screenshot({path: info.outputPath('checkout-first-page.png')});
  });

  test('the first checkout page shows an amount equal to the cart subtotal (read-only; cart total equals checkout total)', async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    const {landed, cartSubtotal} = await goToCheckout(page, info);
    // A development store keeps its Online Store password on, and Shopify then sends the visitor to /password before
    // checkout. Nothing is typed into that page (the password is not ours to use), so the comparison cannot be made.
    // The skip carries the reason into the report; this is BLOCKED, not passing.
    test.skip(
      landed.pathname === '/password',
      'BLOCKED: the store sends the shopper from checkout to its /password page (Online Store password is on), so Shopify checkout totals cannot be read without the store password.',
    );
    const body = page.locator('body');
    await expect(body).toContainText(/\$[\d,]+\.\d{2}/, {timeout: 60_000});
    const amounts = [
      ...(await body.innerText()).matchAll(/\$[\d,]+\.\d{2}/g),
    ].map((match) => match[0]);
    observe(info, 'checkout amounts shown', amounts);
    observe(info, 'checkout title', await page.title());
    expect(amounts, 'the cart subtotal appears on the checkout page').toContain(
      cartSubtotal,
    );
  });
});

test.describe('real development store: accessibility with real data at 360 and 1280 px (NFR-003)', () => {
  test.skip(!REAL_STORE, SKIP_REASON);

  const routes: ReadonlyArray<{path: string; withItem: boolean}> = [
    {path: '/', withItem: false},
    {path: '/collections/all', withItem: false},
    {path: '/collections/frontpage', withItem: false},
    {path: PRODUCT, withItem: false},
    {path: '/cart', withItem: true},
  ];

  for (const {path, withItem} of routes) {
    for (const width of [360, 1280]) {
      test(`axe on ${path}${withItem ? ' (one item in the cart)' : ''} at ${width} px: no serious or critical violation`, async ({
        page,
      }, info) => {
        test.skip(
          info.project.name !== 'desktop-chromium',
          'The viewport is set by the test, so the 360 and 1280 pair runs once, in the desktop project.',
        );
        await page.setViewportSize({width, height: 800});
        if (withItem) {
          await addTestingProduct(page);
          await page.keyboard.press('Escape');
        }
        await gotoReady(page, path);
        if (withItem) {
          await subtotalWhenReady(page.locator('main'));
        }
        const violations = await runAxeAudit(page);
        observe(
          info,
          `axe ${path}${withItem ? ' +item' : ''} @${width}`,
          summariseAudit(violations),
        );
        expect(blockingViolations(violations)).toEqual([]);
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        );
        expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(0);
      });
    }
  }
});
