import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import {
  collectConsoleErrors,
  expectNoSeriousA11yViolations,
} from './helpers/a11y';
import {
  expectNoHorizontalScroll,
  gotoReady,
  ourErrors,
} from './helpers/catalog';

// REQ-ACC-003 / P6-08 / SD-05 / T-09 / R-27. First run: V-E164 onwards in progress/TEST_RESULTS.md.
// UNVERIFIED against a real order: no Admin lookup has ever matched an order here (V-09, V-20). Every value typed in
// these tests is invented and can only produce the generic answer; no test sends a real order number or email.
//
// Two server configurations (names only, values are placeholders; the Admin token is a fake string):
//  - lookup NOT configured (any env without SHOPIFY_ADMIN_API_ACCESS_TOKEN, for example .env.beddingqa): the page shows
//    the "not available" notice and POST answers 503. These tests run when E2E_TRACK_LOOKUP is not "on".
//  - lookup configured: E2E_TRACK_LOOKUP=on with E2E_ENV_FILE=.env.trackqa, which holds a <shop>.myshopify.com store
//    domain (the Admin client refuses mock.shop domains by design), a fake SHOPIFY_ADMIN_API_ACCESS_TOKEN and
//    TRUSTED_CLIENT_IP_HEADER=x-real-ip. The Admin call is then made with the fake token and fails, which the app must
//    answer exactly like "no such order". The form and rate-limit tests run when it is "on".
// Counters live in the server's memory for 15 minutes, so every test uses its own random addresses and order numbers.

const LOOKUP_ON = process.env.E2E_TRACK_LOOKUP === 'on';
const GENERIC = /couldn't find an order with those details/i;
const UNAVAILABLE = 'Order lookup is not available right now';
const RATE_LIMITED = /Too many attempts/;
// The timing floor of the handler (GUEST_LOOKUP_MIN_DURATION_MS = 800); a little under it for timer granularity.
const FLOOR_MS = 750;
// The per-address limit (10 per 15 minutes) and the per-order-and-address limit (3).
const ADDRESS_LIMIT = 10;
const ORDER_ADDRESS_LIMIT = 3;
const ORDER_LIMIT = 10;
const EMAIL_LIMIT = 5;

function randomOctet() {
  return Math.floor(Math.random() * 250) + 1;
}

/** A syntactically valid, made-up client address for one test (10.x.x.x is never routed to a real shopper). */
function fakeAddress() {
  return `10.${randomOctet()}.${randomOctet()}.${randomOctet()}`;
}

/** Digits unique to this call, so no two tests share an order counter. */
function fakeOrderNumber() {
  return `#${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
}

let emailSeed = 0;
function fakeEmail() {
  emailSeed += 1;
  return `qa-nobody-${Date.now()}-${emailSeed}@example.test`;
}

type Answer = {
  status: number;
  headers: Record<string, string>;
  body: string;
  ms: number;
};

async function post(
  request: APIRequestContext,
  form: Record<string, string>,
  headers: Record<string, string> = {},
): Promise<Answer> {
  const started = Date.now();
  const response = await request.post('/track-order', {form, headers});
  const body = await response.text();
  return {
    status: response.status(),
    headers: response.headers(),
    body,
    ms: Date.now() - started,
  };
}

/** The document minus what legitimately differs between two responses (the CSP nonce). */
function comparable(body: string) {
  return body
    .replace(/nonce="[^"]*"/g, 'nonce=""')
    .replace(/nonce-[\w+/=-]+/g, 'nonce-');
}

/** The visible message of a document, from the page's own text, so a comparison is about what a shopper reads. */
function visibleText(body: string) {
  const main = /<main[\s\S]*?<\/main>/.exec(body)?.[0] ?? body;
  return main
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Makes the browser's own /track-order requests (document, form post and data fetch) carry a client address. */
async function withClientAddress(page: Page, address: string) {
  await page.route('**/track-order*', (route) =>
    route.continue({
      headers: {...route.request().headers(), 'x-real-ip': address},
    }),
  );
}

async function formAvailable(page: Page) {
  return page.getByRole('form', {name: 'Find your order'}).isVisible();
}

async function submitForm(page: Page, number: string, email: string) {
  await page.getByLabel(/Order number/).fill(number);
  await page.getByLabel(/Email address/).fill(email);
  await page.getByRole('button', {name: 'Find my order'}).click();
}

const apiOnly = (info: {project: {name: string}}) =>
  info.project.name.includes('mobile');
const API_ONLY_REASON =
  'A protocol-level check, identical on both projects: the desktop project runs it.';

test.describe('guest order tracking page (REQ-ACC-003)', () => {
  test('the page is private, not indexable and quiet in the console', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    const response = await gotoReady(page, '/track-order');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['cache-control']).toContain('no-store');
    expect(response?.headers()['cache-control']).toContain('private');
    expect(response?.headers()['x-robots-tag']).toContain('noindex');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    );
    await expect(
      page.getByRole('heading', {level: 1, name: 'Track your order'}),
    ).toBeVisible();
    // Never a fake result.
    await expect(page.getByText(/Order #\d/)).toHaveCount(0);
    expect(ourErrors(errors)).toEqual([]);
  });

  test('a query string never starts a lookup or fills the form', async ({
    page,
  }) => {
    await gotoReady(
      page,
      '/track-order?orderNumber=1001&email=shopper%40example.com',
    );
    await expect(page.getByText(GENERIC)).toHaveCount(0);
    if (await formAvailable(page)) {
      await expect(page.getByLabel(/Order number/)).toHaveValue('');
      await expect(page.getByLabel(/Email address/)).toHaveValue('');
    }
    expect(await page.content()).not.toContain('shopper@example.com');
  });

  test('refuses a cross-origin POST and a method other than POST, with no order data in the answer', async ({
    request,
  }, info) => {
    test.skip(apiOnly(info), API_ONLY_REASON);
    const form = {orderNumber: fakeOrderNumber(), email: fakeEmail()};
    const put = await request.put('/track-order', {
      form,
      headers: {'x-real-ip': fakeAddress()},
    });
    expect(put.status()).toBe(405);
    expect(put.headers().allow).toBe('POST');
    // The framework answers a foreign Origin with 400 before the route runs; the route answers a cross-site fetch
    // metadata header with 403. Either way nothing is looked up and nothing is counted.
    const foreign = await request.post('/track-order', {
      form,
      headers: {Origin: 'https://evil.example', 'x-real-ip': fakeAddress()},
    });
    expect([400, 403]).toContain(foreign.status());
    expect(await foreign.text()).not.toMatch(/Order #\d|couldn't find/);
    const crossSite = await request.post('/track-order', {
      form,
      headers: {'Sec-Fetch-Site': 'cross-site', 'x-real-ip': fakeAddress()},
    });
    expect(crossSite.status()).toBe(403);
    const nullOrigin = await request.post('/track-order', {
      form,
      headers: {Origin: 'null', 'x-real-ip': fakeAddress()},
    });
    expect([400, 403]).toContain(nullOrigin.status());
  });
});

test.describe('lookup not configured: the page fails closed (REQ-ACC-003)', () => {
  test.skip(LOOKUP_ON, 'this server has the lookup configured');

  test('only the "not available" notice is shown: no form, no input, a sign-in link', async ({
    page,
  }) => {
    await gotoReady(page, '/track-order');
    await expect(page.getByText(UNAVAILABLE).first()).toBeVisible();
    await expect(page.getByRole('form', {name: 'Find your order'})).toHaveCount(
      0,
    );
    await expect(page.getByLabel(/Order number/)).toHaveCount(0);
    await expect(page.getByLabel(/Email address/)).toHaveCount(0);
    await expect(
      page.getByRole('link', {name: 'Sign in to your account'}),
    ).toHaveAttribute('href', '/account/login');
  });

  test('a POST with invented data answers 503 with the same notice, nothing echoed, private headers', async ({
    request,
  }, info) => {
    test.skip(apiOnly(info), API_ONLY_REASON);
    const number = fakeOrderNumber();
    const email = fakeEmail();
    const answer = await post(
      request,
      {orderNumber: number, email},
      {'x-real-ip': fakeAddress()},
    );
    expect(answer.status).toBe(503);
    expect(visibleText(answer.body)).toContain(UNAVAILABLE);
    expect(answer.body).not.toContain(email);
    expect(answer.body).not.toContain(number.slice(1));
    expect(answer.body).not.toMatch(/Order #\d/);
    expect(answer.headers['cache-control']).toContain('no-store');
    expect(answer.headers['x-robots-tag']).toContain('noindex');
    // Malformed input gets the very same answer: the configuration, not the input, decides.
    const malformed = await post(
      request,
      {orderNumber: 'not an order!', email: 'nobody'},
      {'x-real-ip': fakeAddress()},
    );
    expect(malformed.status).toBe(503);
    expect(visibleText(malformed.body)).toBe(visibleText(answer.body));
  });

  test('the notice has no serious accessibility violation and no horizontal scroll at 360 px', async ({
    page,
  }, info) => {
    test.skip(
      info.project.name.includes('mobile'),
      'The width is set explicitly, so the desktop project covers it.',
    );
    await page.setViewportSize({width: 360, height: 800});
    await gotoReady(page, '/track-order');
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });
});

test.describe('lookup configured, invented values (REQ-ACC-003, T-09, R-27)', () => {
  test.skip(
    !LOOKUP_ON,
    'needs E2E_TRACK_LOOKUP=on and an env file with a fake Admin token (.env.trackqa)',
  );

  test('the form renders with labels, hints, limits and no pre-filled value', async ({
    page,
  }) => {
    await gotoReady(page, '/track-order');
    const form = page.getByRole('form', {name: 'Find your order'});
    await expect(form).toBeVisible();
    const number = page.getByLabel(/Order number/);
    const email = page.getByLabel(/Email address/);
    await expect(number).toBeVisible();
    await expect(number).toHaveAttribute('required', '');
    await expect(number).toHaveAttribute('maxlength', '60');
    await expect(number).toHaveAttribute('autocomplete', 'off');
    await expect(email).toHaveAttribute('type', 'email');
    await expect(email).toHaveAttribute('required', '');
    await expect(email).toHaveAttribute('maxlength', '254');
    await expect(email).toHaveAttribute('autocomplete', 'email');
    await expect(number).toHaveValue('');
    await expect(email).toHaveValue('');
    await expect(page.getByText(/for example #1001/)).toBeVisible();
    await expect(
      page.getByRole('button', {name: 'Find my order'}),
    ).toBeVisible();
    await expect(page.getByText(UNAVAILABLE)).toHaveCount(0);
  });

  test('an unknown order, a malformed pair and a missing field give the same message in the browser, which names no field and is announced', async ({
    page,
  }) => {
    await withClientAddress(page, fakeAddress());
    await gotoReady(page, '/track-order');
    const results: string[] = [];
    const message = page.getByText(GENERIC);
    for (const [number, email] of [
      [fakeOrderNumber(), fakeEmail()],
      ['not an order!', fakeEmail()],
      [fakeOrderNumber(), 'nobody@example.test'],
    ]) {
      await submitForm(page, number ?? '', email ?? '');
      await expect(message).toBeVisible();
      results.push(await message.innerText());
      await expect(
        page.getByRole('heading', {name: 'We could not find an order'}),
      ).toBeVisible();
      // Focus moves to the answer so a keyboard or screen reader user lands on it, not on the form above.
      await expect(
        page.locator('main [aria-live="polite"][tabindex="-1"]'),
      ).toBeFocused();
    }
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toContain('60 days');
    expect((results[0] ?? '').toLowerCase()).not.toMatch(
      /email is|number is|wrong|invalid|incorrect|does not match/,
    );
    await expect(
      page.getByRole('link', {name: 'Sign in to your account'}),
    ).toHaveAttribute('href', '/account/login');
    // Nothing typed is echoed into the page (the inputs keep what was typed; the markup does not).
    expect(await page.content()).not.toContain('nobody@example.test');
  });

  test('the form is usable from the keyboard alone', async ({page}) => {
    await withClientAddress(page, fakeAddress());
    await gotoReady(page, '/track-order');
    await page.getByLabel(/Order number/).focus();
    await page.keyboard.type(fakeOrderNumber());
    await page.keyboard.press('Tab');
    await expect(page.getByLabel(/Email address/)).toBeFocused();
    await page.keyboard.type(fakeEmail());
    await page.keyboard.press('Enter');
    await expect(page.getByText(GENERIC)).toBeVisible();
  });

  test('without JavaScript the form still works as a plain POST and shows the same generic answer', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      baseURL,
    });
    try {
      const page = await context.newPage();
      await withClientAddress(page, fakeAddress());
      await page.goto('/track-order');
      await page.getByLabel(/Order number/).fill(fakeOrderNumber());
      await page.getByLabel(/Email address/).fill(fakeEmail());
      await page.getByRole('button', {name: 'Find my order'}).click();
      await expect(page.getByText(GENERIC)).toBeVisible();
      await expect(page.getByText(/Order #\d/)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('every outcome that depends on the input gives one answer: same status, same text, same private headers, none faster than the floor', async ({
    request,
  }, info) => {
    test.skip(apiOnly(info), API_ONLY_REASON);
    test.setTimeout(90_000);
    const bigBody = 'x'.repeat(6000);
    const cases: [string, Record<string, string>][] = [
      [
        'well-formed unknown order',
        {orderNumber: fakeOrderNumber(), email: fakeEmail()},
      ],
      [
        'another well-formed unknown order',
        {orderNumber: fakeOrderNumber(), email: fakeEmail()},
      ],
      [
        'split-order suffix',
        {orderNumber: `${fakeOrderNumber()}-A`, email: fakeEmail()},
      ],
      [
        'malformed order number',
        {orderNumber: 'not an order!', email: fakeEmail()},
      ],
      ['malformed email', {orderNumber: fakeOrderNumber(), email: 'nobody'}],
      ['missing order number', {email: fakeEmail()}],
      ['missing email', {orderNumber: fakeOrderNumber()}],
      ['empty values', {orderNumber: '', email: ''}],
      [
        'query-injection looking order number',
        {orderNumber: `${fakeOrderNumber()} OR name:*`, email: fakeEmail()},
      ],
      [
        'over-long values',
        {
          orderNumber: '9'.repeat(200),
          email: `${'a'.repeat(300)}@example.test`,
        },
      ],
      [
        'body over the 4 KB cap',
        {orderNumber: fakeOrderNumber(), email: fakeEmail(), filler: bigBody},
      ],
    ];
    const answers: {label: string; answer: Answer}[] = [];
    for (const [label, form] of cases) {
      answers.push({
        label,
        answer: await post(request, form, {'x-real-ip': fakeAddress()}),
      });
    }
    const reference = answers[0]?.answer;
    expect(reference?.status).toBe(200);
    expect(visibleText(reference?.body ?? '')).toMatch(GENERIC);
    for (const {label, answer} of answers) {
      expect(answer.status, `${label}: status`).toBe(200);
      expect(visibleText(answer.body), `${label}: text`).toBe(
        visibleText(reference?.body ?? ''),
      );
      expect(comparable(answer.body), `${label}: whole document`).toBe(
        comparable(reference?.body ?? ''),
      );
      expect(answer.headers['cache-control'], `${label}: cache`).toContain(
        'no-store',
      );
      expect(answer.headers['x-robots-tag'], `${label}: robots`).toContain(
        'noindex',
      );
      expect(
        answer.headers['retry-after'],
        `${label}: retry-after`,
      ).toBeUndefined();
      // A request that skipped the Admin API (malformed input) is held to the same floor as one that used it.
      expect(answer.ms, `${label}: duration`).toBeGreaterThanOrEqual(FLOOR_MS);
    }
  });

  test('rate limit per address: the 11th attempt from one address is answered 429 with Retry-After and a fixed message; another address is unaffected', async ({
    request,
  }, info) => {
    test.skip(apiOnly(info), API_ONLY_REASON);
    test.setTimeout(120_000);
    const address = fakeAddress();
    const statuses: number[] = [];
    // Malformed input counts against the address and overall counters only, so this isolates the address counter.
    for (let attempt = 0; attempt <= ADDRESS_LIMIT; attempt += 1) {
      const answer = await post(
        request,
        {orderNumber: `junk ${attempt} ${Math.random()}`, email: fakeEmail()},
        {'x-real-ip': address},
      );
      statuses.push(answer.status);
      if (answer.status === 429) {
        expect(visibleText(answer.body)).toMatch(RATE_LIMITED);
        expect(Number(answer.headers['retry-after'])).toBeGreaterThanOrEqual(1);
        expect(answer.headers['cache-control']).toContain('no-store');
        expect(answer.headers['x-robots-tag']).toContain('noindex');
      }
    }
    expect(statuses.slice(0, ADDRESS_LIMIT)).toEqual(
      Array.from({length: ADDRESS_LIMIT}, () => 200),
    );
    expect(statuses[ADDRESS_LIMIT]).toBe(429);
    // A different address is not limited by this one.
    const other = await post(
      request,
      {orderNumber: 'junk other', email: fakeEmail()},
      {'x-real-ip': fakeAddress()},
    );
    expect(other.status).toBe(200);
  });

  test('a client-sent address header the deployment did not name is ignored: rotating it does not dodge the limit, copying a blocked one does not block another caller', async ({
    request,
  }, info) => {
    test.skip(apiOnly(info), API_ONLY_REASON);
    test.setTimeout(120_000);
    const address = fakeAddress();
    let limitedAt = -1;
    for (let attempt = 0; attempt <= ADDRESS_LIMIT; attempt += 1) {
      const answer = await post(
        request,
        {orderNumber: `junk ${attempt} ${Math.random()}`, email: fakeEmail()},
        {
          'x-real-ip': address,
          // Four other names a client may send, each different on every request.
          'oxygen-buyer-ip': fakeAddress(),
          'cf-connecting-ip': fakeAddress(),
          'true-client-ip': fakeAddress(),
          'x-forwarded-for': `${fakeAddress()}, ${fakeAddress()}`,
        },
      );
      if (answer.status === 429 && limitedAt < 0) limitedAt = attempt;
    }
    expect(limitedAt, 'the attempt that was refused').toBe(ADDRESS_LIMIT);
    // The blocked address copied into every other header, from a caller with a different x-real-ip: not blocked.
    const bystander = await post(
      request,
      {orderNumber: 'junk bystander', email: fakeEmail()},
      {
        'x-real-ip': fakeAddress(),
        'oxygen-buyer-ip': address,
        'cf-connecting-ip': address,
        'true-client-ip': address,
        'x-forwarded-for': address,
      },
    );
    expect(bystander.status).toBe(200);
  });

  test('rate limit per order and address: the 4th guess at one order from one address is refused', async ({
    request,
  }, info) => {
    test.skip(apiOnly(info), API_ONLY_REASON);
    test.setTimeout(60_000);
    const address = fakeAddress();
    const number = fakeOrderNumber();
    const statuses: number[] = [];
    for (let attempt = 0; attempt <= ORDER_ADDRESS_LIMIT; attempt += 1) {
      statuses.push(
        (
          await post(
            request,
            {orderNumber: number, email: fakeEmail()},
            {'x-real-ip': address},
          )
        ).status,
      );
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  test('rate limit per order from anywhere: ten addresses guessing one order, the 11th is refused whatever the address or email', async ({
    request,
  }, info) => {
    test.skip(apiOnly(info), API_ONLY_REASON);
    test.setTimeout(120_000);
    const number = fakeOrderNumber();
    const statuses: number[] = [];
    for (let attempt = 0; attempt <= ORDER_LIMIT; attempt += 1) {
      statuses.push(
        (
          await post(
            request,
            {orderNumber: number, email: fakeEmail()},
            {'x-real-ip': fakeAddress()},
          )
        ).status,
      );
    }
    expect(
      statuses.slice(0, ORDER_LIMIT).every((status) => status === 200),
    ).toBe(true);
    expect(statuses[ORDER_LIMIT]).toBe(429);
  });

  test('rate limit per email from anywhere: one email tried against six orders from six addresses, the 6th is refused', async ({
    request,
  }, info) => {
    test.skip(apiOnly(info), API_ONLY_REASON);
    test.setTimeout(90_000);
    const email = fakeEmail();
    const statuses: number[] = [];
    for (let attempt = 0; attempt <= EMAIL_LIMIT; attempt += 1) {
      statuses.push(
        (
          await post(
            request,
            {orderNumber: fakeOrderNumber(), email},
            {'x-real-ip': fakeAddress()},
          )
        ).status,
      );
    }
    expect(
      statuses.slice(0, EMAIL_LIMIT).every((status) => status === 200),
    ).toBe(true);
    expect(statuses[EMAIL_LIMIT]).toBe(429);
  });

  test('in the browser repeated attempts end in the wait notice, which keeps the sign-in route and has no serious axe finding', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await withClientAddress(page, fakeAddress());
    await gotoReady(page, '/track-order');
    const number = fakeOrderNumber();
    for (let attempt = 0; attempt <= ORDER_ADDRESS_LIMIT; attempt += 1) {
      await submitForm(page, number, fakeEmail());
      await expect(
        page.getByText(GENERIC).or(page.getByText(RATE_LIMITED)),
      ).toBeVisible();
    }
    await expect(page.getByText(RATE_LIMITED)).toBeVisible();
    await expect(
      page.getByRole('heading', {name: 'Please wait before trying again'}),
    ).toBeVisible();
    await expect(
      page.getByRole('link', {name: 'Sign in to your account'}),
    ).toHaveAttribute('href', '/account/login');
    await expect(
      page.locator('main [aria-live="polite"][tabindex="-1"]'),
    ).toBeFocused();
    await expectNoSeriousA11yViolations(page);
  });

  for (const width of [360, 320]) {
    test(`form and answer have no serious axe finding and no horizontal scroll at ${width} px`, async ({
      page,
    }) => {
      await withClientAddress(page, fakeAddress());
      await page.setViewportSize({width, height: 800});
      await gotoReady(page, '/track-order');
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
      await submitForm(page, fakeOrderNumber(), fakeEmail());
      await expect(page.getByText(GENERIC)).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
    });
  }
});
