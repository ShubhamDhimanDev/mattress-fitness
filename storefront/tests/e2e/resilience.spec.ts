import {expect, test, type Page} from '@playwright/test';
import {expectNoSeriousA11yViolations} from './helpers/a11y';
import {
  findProduct,
  firstCollectionPath,
  gotoReady,
  hasSizes,
  isPurchasable,
} from './helpers/catalog';
import {
  collectConsoleErrorsWithUrls,
  unexpectedErrors,
} from './helpers/console';

// NFR-013 / P5A-11 (also REQ-EXT-001, REQ-ADD-003, REQ-CART-001, REQ-CHK-001): when Extend fails, is slow or answers
// nonsense, shopping and the checkout hand-off still work and nothing from our code breaks.
//
// What is injected, and where. The browser asks OUR route `/api/extend/offers` (never Extend), so every failure here is
// injected at the network layer in front of that route: an error status, an HTML error page, malformed or wrong-shaped
// JSON, a refused connection, and an answer that never arrives (the 8 s request timeout in useProtectionOffers fires on a
// fake clock). It proves what the BROWSER does with a bad answer. What the SERVER does when Extend itself misbehaves
// (timeouts, retries, circuit breaker, malformed upstream JSON) is covered by tests/integration/extend/resilience.test.ts
// and app/lib/extend/*.test.ts against the local mock; neither layer has run against Extend's demo host (V-11, V-16).
// Not covered here: reviews, maps, chat and analytics failures (those providers are not built yet), and the Storefront
// API offer-picker failures (out of scope for this task).
//
// Needs the flag-on dev server (DEV_DATA.md "Extend protection panel") and E2E_PROTECTION_FLAG=on. Without the flag no
// panel can appear and these tests would pass for the wrong reason, so they are skipped with that reason instead.

const FLAG_ON = process.env.E2E_PROTECTION_FLAG === 'on';
const OFFERS_ROUTE = '**/api/extend/offers**';
const PANEL_TIMEOUT_MS = 20_000;
// useProtectionOffers: 250 ms debounce plus an 8 s request timeout. Fast-forwarded on the fake clock, never slept.
const PAST_THE_OFFERS_TIMEOUT_MS = 10_000;

const PLAN = {
  planId: 'E2E-PLAN-3Y',
  title: 'Accident plan 3 years',
  priceCents: 7999,
  termMonths: 36,
  termsUrl: 'https://extend.example/terms',
  imageUrl: null,
  recommended: true,
};

const goodAnswer = (variantId: string) => ({
  status: 'ok',
  poweredBy: 'Extend',
  items: [{variantId, quantity: 1, plans: [PLAN]}],
});

type Failure = {
  name: string;
  answer: Parameters<Page['route']>[1];
};

const variantOf = (url: string) =>
  new URL(url).searchParams.get('variantId') ?? '';

// Each entry is one way the offers answer can be wrong. All must end the same way: no panel, nothing blocked.
const FAILURES: readonly Failure[] = [
  {
    name: 'a 500 with a JSON body',
    answer: (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{"status":"error"}',
      }),
  },
  {
    name: 'a 503 HTML error page from the host in front of the route',
    answer: (route) =>
      route.fulfill({
        status: 503,
        contentType: 'text/html',
        body: '<html><body><h1>Service Unavailable</h1></body></html>',
      }),
  },
  {
    name: 'a 400 invalid answer',
    answer: (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: '{"status":"invalid"}',
      }),
  },
  {
    name: 'malformed JSON with a 200',
    answer: (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"status":"ok","items":[{"variantId":',
      }),
  },
  {
    name: 'an empty 200 body',
    answer: (route) =>
      route.fulfill({status: 200, contentType: 'application/json', body: ''}),
  },
  {
    name: 'a 200 that is not JSON at all',
    answer: (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/plain',
        body: 'upstream connect error',
      }),
  },
  {
    name: 'valid JSON of the wrong shape (items is a string)',
    answer: (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"status":"ok","poweredBy":"Extend","items":"nope"}',
      }),
  },
  {
    name: 'JSON null',
    answer: (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: 'null',
      }),
  },
  {
    name: 'plans with a hostile terms link and a negative price (every plan invalid)',
    answer: (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          goodAnswerWith(variantOf(route.request().url()), [
            {...PLAN, termsUrl: 'javascript:alert(1)'},
            {...PLAN, planId: 'E2E-PLAN-NEG', priceCents: -100},
          ]),
        ),
      }),
  },
  {
    name: 'a refused connection',
    answer: (route) => route.abort('connectionrefused'),
  },
  {
    name: 'a connection that drops mid-request',
    answer: (route) => route.abort('connectionreset'),
  },
];

function goodAnswerWith(variantId: string, plans: unknown[]) {
  return {
    status: 'ok',
    poweredBy: 'Extend',
    items: [{variantId, quantity: 1, plans}],
  };
}

// The mock stores have no `custom.extend_category` metafield; the loader honours this cookie in development only to
// treat a page as eligible, so the panel (and its loading state) is in play at all. See protection.spec.ts.
async function markEligible(page: Page) {
  await page
    .context()
    .addCookies([
      {name: 'e2e_extend_eligible', value: '1', domain: 'localhost', path: '/'},
    ]);
}

async function openBuyableProduct(page: Page) {
  const listing = await firstCollectionPath(page);
  return findProduct(page, listing, 'buyable', isPurchasable);
}

// Not gotoReady (networkidle): a delayed or never-answered offers request would hold the network open.
async function visit(page: Page, path: string) {
  await page.goto(path, {waitUntil: 'domcontentloaded'});
}

function cartPost(page: Page) {
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.startsWith('/cart') &&
      response.request().method() === 'POST',
  );
}

/** No protection panel, no loading skeleton, and no message shown to the shopper on the product page. */
async function expectNothingBlocking(page: Page) {
  await expect(
    page.getByRole('group', {name: 'Accident protection'}),
  ).toHaveCount(0);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  // The alert regions are always mounted (empty); only one WITH text would be an error shown to the shopper.
  await expect(page.getByRole('alert').filter({hasText: /\S/})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Add to cart'})).toBeEnabled();
}

/** Add without protection, then check the cart and the hand-off to Shopify's checkout (stops before it). */
async function addAndHandOff(page: Page) {
  const answered = cartPost(page);
  await page.getByRole('button', {name: 'Add to cart'}).click();
  expect((await answered).status()).toBe(200);

  const drawer = page.getByRole('dialog', {name: 'Cart'});
  await expect(drawer.getByRole('list', {name: 'Cart items'})).toBeVisible();
  // Plain item, no coverage line, no error.
  await expect(drawer.getByText(/protection/i)).toHaveCount(0);
  await expect(drawer.getByRole('alert').filter({hasText: /\S/})).toHaveCount(
    0,
  );
  await expect(drawer.getByRole('link', {name: 'Checkout'})).toHaveAttribute(
    'href',
    '/checkout-steps',
  );

  // The server gate sends the cart to Shopify's hosted https checkout; it never takes the payment itself (ADR-0003).
  const gate = await page.request.get('/checkout-steps', {maxRedirects: 0});
  expect(gate.status()).toBe(302);
  expect(gate.headers().location ?? '').toMatch(/^https:\/\//);
  expect(gate.headers()['cache-control']).toBe('private, no-store');

  // The cart page agrees with the drawer.
  await page.keyboard.press('Escape');
  await gotoReady(page, '/cart');
  await expect(page.getByRole('list', {name: 'Cart items'})).toBeVisible();
}

test.describe('Extend failures never block shopping or checkout (NFR-013, P5A-11)', () => {
  test.skip(
    !FLAG_ON,
    'needs the flag-on dev server (PUBLIC_EXTEND_ENABLED=true) and E2E_PROTECTION_FLAG=on; without the flag no panel can appear and these checks would pass vacuously; see DEV_DATA.md',
  );
  // Each test visits a listing, several product pages, the cart and the gate on a live mock store through a dev server
  // that compiles on first use; the default 30 s timed out on a cold server. This is a budget, not a sleep.
  test.setTimeout(120_000);

  for (const failure of FAILURES) {
    test(`offers answer is ${failure.name}: the panel stays away, the item is added and the hand-off works`, async ({
      page,
    }) => {
      const errors = collectConsoleErrorsWithUrls(page);
      let asked = 0;
      await page.route(OFFERS_ROUTE, (route) => {
        asked += 1;
        return failure.answer(route, route.request());
      });
      await markEligible(page);
      const product = await openBuyableProduct(page);
      await visit(page, product);

      // The page asked (so the failure was really exercised), and the shopper sees nothing wrong.
      await expect
        .poll(() => asked, {timeout: PANEL_TIMEOUT_MS})
        .toBeGreaterThan(0);
      await expectNothingBlocking(page);
      await expectNoSeriousA11yViolations(page);

      await addAndHandOff(page);
      expect(unexpectedErrors(errors, '/api/extend/offers')).toEqual([]);
    });
  }

  test('an offers answer that never arrives: the 8 s timeout hides the panel, and adding to cart never waited for it', async ({
    page,
  }) => {
    const errors = collectConsoleErrorsWithUrls(page);
    // Held open until the end of the test: a real hang, not a slow answer.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let asked = 0;
    await page.route(OFFERS_ROUTE, async (route) => {
      asked += 1;
      await gate;
      await route.abort('timedout').catch(() => undefined);
    });
    await page.clock.install();
    await markEligible(page);
    const product = await openBuyableProduct(page);
    await visit(page, product);

    // While the request hangs the page holds the panel's space as a loading skeleton, and Add to cart works NOW.
    await expect(page.locator('[aria-busy="true"]')).toBeVisible({
      timeout: PANEL_TIMEOUT_MS,
    });
    await expect.poll(() => asked).toBeGreaterThan(0);
    const add = page.getByRole('button', {name: 'Add to cart'});
    await expect(add).toBeEnabled();
    const answered = cartPost(page);
    await add.click();
    expect((await answered).status()).toBe(200);
    await expect(
      page
        .getByRole('dialog', {name: 'Cart'})
        .getByRole('list', {name: 'Cart items'}),
    ).toBeVisible();
    await page.keyboard.press('Escape');

    // Past the request timeout the request is aborted by the page and the skeleton goes away without a message.
    await page.clock.runFor(PAST_THE_OFFERS_TIMEOUT_MS);
    await expectNothingBlocking(page);
    release();
    expect(unexpectedErrors(errors, '/api/extend/offers')).toEqual([]);
  });

  test('a slow answer does not hold Add to cart, and the plans still appear when it arrives', async ({
    page,
  }) => {
    const errors = collectConsoleErrorsWithUrls(page);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let asked = 0;
    await page.route(OFFERS_ROUTE, async (route) => {
      asked += 1;
      await gate;
      await route
        .fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(goodAnswer(variantOf(route.request().url()))),
        })
        .catch(() => undefined);
    });
    await markEligible(page);
    const product = await openBuyableProduct(page);
    await visit(page, product);
    await expect(page.locator('[aria-busy="true"]')).toBeVisible({
      timeout: PANEL_TIMEOUT_MS,
    });
    await expect.poll(() => asked).toBeGreaterThan(0);

    // Not yet answered: the plain Add to cart is usable and works.
    const answered = cartPost(page);
    await page.getByRole('button', {name: 'Add to cart'}).click();
    expect((await answered).status()).toBe(200);
    await page.keyboard.press('Escape');

    release();
    await expect(
      page.getByRole('group', {name: 'Accident protection'}),
    ).toBeVisible({timeout: PANEL_TIMEOUT_MS});
    expect(unexpectedErrors(errors, '/api/extend/offers')).toEqual([]);
  });

  test('a failed answer is not remembered as "no plans": choosing another size and coming back asks again and shows the plans', async ({
    page,
  }) => {
    const listing = await firstCollectionPath(page);
    const product = await findProduct(page, listing, 'sold in two sizes', (p) =>
      hasSizes(p, 2),
    );
    const errors = collectConsoleErrorsWithUrls(page);
    const asked: string[] = [];
    await page.route(OFFERS_ROUTE, (route) => {
      asked.push(variantOf(route.request().url()));
      if (asked.length === 1) {
        return route.fulfill({status: 500, body: '{}'});
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(goodAnswer(variantOf(route.request().url()))),
      });
    });
    await markEligible(page);
    await visit(page, product);
    const sizes = page.getByRole('group', {name: /^Size/});
    // The first request fails: no panel, the item can be added (checked by the table above).
    await expect.poll(() => asked.length, {timeout: PANEL_TIMEOUT_MS}).toBe(1);
    await expectNothingBlocking(page);

    // Another size: a new request, answered; the plans appear. (The radio is visually hidden; its label is clicked.)
    await sizes.locator('input:enabled + label').nth(1).click();
    const panel = page.getByRole('group', {name: 'Accident protection'});
    await expect(panel).toBeVisible({timeout: PANEL_TIMEOUT_MS});

    // Back to the size whose request failed: asked again (the failure was not kept), and answered.
    await sizes.locator('input:enabled + label').nth(0).click();
    await expect.poll(() => asked.length).toBe(3);
    expect(new Set(asked).size).toBe(2);
    expect(asked[2]).toBe(asked[0]);
    await expect(panel).toBeVisible({timeout: PANEL_TIMEOUT_MS});
    expect(unexpectedErrors(errors, '/api/extend/offers')).toEqual([]);
  });
});
