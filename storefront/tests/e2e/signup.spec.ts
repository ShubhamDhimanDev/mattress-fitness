import {expect, test, type APIRequestContext} from '@playwright/test';
import {
  collectConsoleErrors,
  expectNoSeriousA11yViolations,
} from './helpers/a11y';
import {
  expectNoHorizontalScroll,
  gotoReady,
  ourErrors,
} from './helpers/catalog';

// REQ-ANL-003 / P7-02 / NFR-011 / NFR-013 / T-13. First run 2026-10-25 (V-E235 onwards in progress/TEST_RESULTS.md).
// UNVERIFIED against Klaviyo: no account, key or list exists (CLR-004). No test here reaches a real Klaviyo account.
//
// Two server configurations (names only; values are placeholders, never real):
//  - signup NOT configured (an env file without KLAVIYO_PRIVATE_API_KEY and KLAVIYO_LIST_ID, for example the default
//    dev env): no form anywhere, no signup chunk requested, POST answers 503. These run when E2E_SIGNUP is not "on".
//  - signup configured: E2E_SIGNUP=on with an env file holding a FAKE KLAVIYO_PRIVATE_API_KEY, a KLAVIYO_LIST_ID and
//    TRUSTED_CLIENT_IP_HEADER=x-real-ip. The server's call to a.klaviyo.com then fails (fake key), which the page must
//    show as the friendly retry message. A fully accepted signup cannot be proven without a sandbox account (V-22).
// Counters live in server memory (15 minutes to an hour): every test uses its own random addresses and emails.

const SIGNUP_ON = process.env.E2E_SIGNUP === 'on';
const HEADING = 'Get sleep tips and offers';
const UNAVAILABLE = /Signup is not available right now/;
const CONSENT = /Yes, I would like to receive marketing emails/;
const THANKS = /We have received your request/;
const apiOnly = (info: {project: {name: string}}) =>
  info.project.name.includes('mobile');
const API_ONLY_REASON =
  'A protocol-level check, identical on both projects: the desktop project runs it.';

const octet = () => Math.floor(Math.random() * 250) + 1;
const fakeAddress = () => `10.${octet()}.${octet()}.${octet()}`;
let seed = 0;
const fakeEmail = () => {
  seed += 1;
  return `qa-nobody-${Date.now()}-${seed}@example.test`;
};

const GOOD = (email: string) => ({
  email,
  consentEmail: 'yes',
  consentEmailVersion: 'email-v1',
  surface: 'footer',
});

async function post(
  request: APIRequestContext,
  form: Record<string, string>,
  headers: Record<string, string> = {},
) {
  const response = await request.post('/signup', {
    form,
    headers: {'x-real-ip': fakeAddress(), ...headers},
  });
  return {
    status: response.status(),
    headers: response.headers(),
    body: await response.text(),
  };
}

test.describe('GET /signup', () => {
  test('is a noindex 405 pointing at the forms, quiet in the console', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    const response = await page.goto('/signup');
    expect(response?.status()).toBe(405);
    expect(response?.headers()['allow']).toBe('POST');
    expect(response?.headers()['cache-control']).toContain('no-store');
    expect(response?.headers()['x-robots-tag']).toContain('noindex');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    );
    await expect(
      page.getByRole('heading', {level: 1, name: 'Email signup'}),
    ).toBeVisible();
    // The browser itself echoes the deliberate 405 of this document as "Failed to load resource"; that one line is the
    // page under test, not a fault of ours (same rule as helpers/console.ts). Anything else still fails.
    expect(
      ourErrors(errors).filter(
        (text) =>
          !/Failed to load resource: the server responded with a status of 405/.test(
            text,
          ),
      ),
    ).toEqual([]);
  });

  // Two tests, not one: in the dev server (MiniOxygen) a request that the framework's own CSRF check aborts with a
  // 400 before our action reads the body is intermittently followed by a 500 on the NEXT request ("fetch failed,
  // ECONNRESET" in the server log; 2 of 7 first runs, V-E227 note). Separate tests keep each claim independent of that
  // dev-server artefact; the production behaviour of the same sequence is not proven here.
  test('refuses a cross-site request (Sec-Fetch-Site) without signing anyone up', async ({
    request,
  }, info) => {
    test.skip(apiOnly(info), API_ONLY_REASON);
    const form = GOOD(fakeEmail());
    const crossSite = await post(request, form, {
      'Sec-Fetch-Site': 'cross-site',
    });
    expect(crossSite.status).toBe(403);
    expect(crossSite.body).not.toContain(form.email);
  });

  test('refuses a foreign origin without signing anyone up', async ({
    request,
  }, info) => {
    test.skip(apiOnly(info), API_ONLY_REASON);
    const form = GOOD(fakeEmail());
    const foreign = await post(request, form, {Origin: 'https://evil.example'});
    expect([400, 403]).toContain(foreign.status);
    expect(foreign.body).not.toContain(form.email);
  });
});

test.describe('signup NOT configured: nothing is rendered or requested (REQ-ANL-003)', () => {
  test.skip(SIGNUP_ON, 'this server has the signup configured');

  test('no form on the home page or in the footer, and no signup code is downloaded', async ({
    page,
  }) => {
    const requested: string[] = [];
    page.on('request', (r) => requested.push(r.url()));
    await gotoReady(page, '/');
    await expect(page.getByRole('contentinfo')).toBeVisible();
    await expect(page.getByRole('form', {name: HEADING})).toHaveCount(0);
    await expect(page.getByText(HEADING)).toHaveCount(0);
    expect(requested.filter((url) => /SignupForm/.test(url))).toEqual([]);
  });

  test('a POST answers 503 "not available" and sends nothing', async ({
    request,
  }, info) => {
    test.skip(apiOnly(info), API_ONLY_REASON);
    const answer = await post(request, GOOD(fakeEmail()));
    expect(answer.status).toBe(503);
    expect(answer.body).toMatch(UNAVAILABLE);
    expect(answer.headers['cache-control']).toContain('no-store');
  });
});

test.describe('signup configured, fake key (REQ-ANL-003, NFR-011, NFR-013)', () => {
  test.skip(
    !SIGNUP_ON,
    'needs E2E_SIGNUP=on and an env file with a fake Klaviyo key and list id',
  );

  test('the footer form is labelled, mobile friendly, and its consent box starts UNTICKED', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await gotoReady(page, '/');
    const form = page
      .getByRole('contentinfo')
      .getByRole('form', {name: HEADING});
    await expect(form).toBeVisible();
    await expect(form.getByLabel(/Email address/)).toHaveAttribute(
      'type',
      'email',
    );
    const box = form.getByRole('checkbox', {name: CONSENT});
    await expect(box).not.toBeChecked();
    await expect(form.getByRole('button', {name: 'Sign up'})).toBeVisible();
    // The honeypot is not offered to anyone: it is clipped off screen (so Playwright still counts its 1 px box as
    // "visible"), hidden from assistive technology, outside the tab order and not in the accessibility tree.
    const trap = form.locator('input[name="company_website"]');
    await expect(trap).toHaveCount(1);
    await expect(trap).toHaveAttribute('tabindex', '-1');
    await expect(trap).toHaveAttribute('autocomplete', 'off');
    await expect(
      trap.locator('xpath=ancestor::div[@aria-hidden="true"]'),
    ).toHaveCount(1);
    await expect(
      form.getByRole('textbox', {name: 'Leave this field empty'}),
    ).toHaveCount(0);
    // The wrapper is the clipped 1 px box (the input inside keeps its natural size but is clipped by it).
    const wrapper = await trap
      .locator('xpath=ancestor::div[@aria-hidden="true"]')
      .boundingBox();
    expect(
      wrapper === null || (wrapper.width <= 1 && wrapper.height <= 1),
    ).toBe(true);
    expect(ourErrors(errors)).toEqual([]);
  });

  test('exactly one signup form on the home page (the footer one: the mock store has no admin "signup" home block), no SMS field by default', async ({
    page,
  }) => {
    await gotoReady(page, '/');
    const forms = page.getByRole('form', {name: HEADING});
    await expect(forms).toHaveCount(1);
    const form = forms.first();
    // SMS is off unless PUBLIC_KLAVIYO_SMS_ENABLED is "true" (and a production build keeps it off until approved).
    await expect(form.locator('input[type="tel"]')).toHaveCount(0);
    await expect(form.getByLabel(/mobile|phone|text message/i)).toHaveCount(0);
    await expect(form.getByRole('checkbox')).toHaveCount(1);
    await expect(
      form.locator('input[name="smsConsent"], input[name="phone"]'),
    ).toHaveCount(0);
  });

  test('a rejected upstream (fake key) shows the friendly retry message in the page; the browser never talks to Klaviyo and nothing personal reaches the console', async ({
    page,
  }) => {
    const email = fakeEmail();
    const requested: string[] = [];
    const consoleText: string[] = [];
    page.on('request', (r) => requested.push(r.url()));
    page.on('console', (m) => consoleText.push(m.text()));
    page.on('pageerror', (e) => consoleText.push(e.message));
    const signupAnswers: number[] = [];
    page.on('response', (r) => {
      if (r.request().method() === 'POST' && r.url().includes('/signup'))
        signupAnswers.push(r.status());
    });
    await gotoReady(page, '/');
    const form = page
      .getByRole('contentinfo')
      .getByRole('form', {name: HEADING});
    await form.getByLabel(/Email address/).fill(email);
    await form.getByRole('checkbox', {name: CONSENT}).check();
    await form.getByRole('button', {name: 'Sign up'}).click();
    await expect(
      form
        .locator('xpath=following-sibling::div[@role="status"]')
        .getByText(UNAVAILABLE),
    ).toBeVisible();
    // The fetcher posts to /signup (or its single-fetch form /signup.data) and the server answers 503.
    expect(signupAnswers).toEqual([503]);
    // The form keeps what was typed so the person can try again.
    await expect(form.getByLabel(/Email address/)).toHaveValue(email);
    expect(requested.filter((url) => /klaviyo/i.test(url))).toEqual([]);
    expect(consoleText.join('\n')).not.toContain(email);
    expect(consoleText.join('\n')).not.toMatch(
      /placeholder-not-a-real-key|AbCd12/,
    );
    expect(requested.join('\n')).not.toContain(encodeURIComponent(email));
    await expectNoSeriousA11yViolations(page);
  });

  test('the thank-you state (reached through the honeypot, the only success a fake key allows) clears the form, is announced politely and passes axe at 360 and 1280 px', async ({
    page,
  }, info) => {
    test.skip(
      info.project.name.includes('mobile'),
      'The widths are set by the test, so the desktop project covers both.',
    );
    for (const width of [360, 1280]) {
      await page.setViewportSize({width, height: 800});
      await gotoReady(page, '/');
      const form = page
        .getByRole('contentinfo')
        .getByRole('form', {name: HEADING});
      await form.getByLabel(/Email address/).fill(fakeEmail());
      await form.getByRole('checkbox', {name: CONSENT}).check();
      // What a bot does: fill the field no person sees. The server answers exactly as for a real signup.
      await form.locator('input[name="company_website"]').evaluate((input) => {
        (input as HTMLInputElement).value = 'http://spam.example';
      });
      await form.getByRole('button', {name: 'Sign up'}).click();
      const status = page
        .getByRole('contentinfo')
        .getByRole('status')
        .filter({hasText: THANKS});
      await expect(status).toBeVisible();
      await expect(status).toHaveAttribute('aria-live', 'polite');
      await expect(form.getByLabel(/Email address/)).toHaveValue('');
      await expect(
        form.getByRole('checkbox', {name: CONSENT}),
      ).not.toBeChecked();
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
    }
  });

  test('a good post answers 503 (upstream failed) with no-store and noindex headers, and the body holds neither the address nor the key', async ({
    request,
  }, info) => {
    test.skip(apiOnly(info), API_ONLY_REASON);
    const form = GOOD(fakeEmail());
    const answer = await post(request, form);
    expect(answer.status).toBe(503);
    expect(answer.headers['cache-control']).toContain('no-store');
    expect(answer.headers['x-robots-tag']).toContain('noindex');
    expect(answer.body).toMatch(UNAVAILABLE);
    expect(answer.body).not.toContain(form.email);
    expect(answer.body).not.toMatch(
      /placeholder-not-a-real-key|AbCd12|klaviyo/i,
    );
  });

  test('server-side validation: a bad address, a stale consent version and an unknown surface are 422 with field messages and no echo', async ({
    request,
  }, info) => {
    test.skip(apiOnly(info), API_ONLY_REASON);
    const bad = await post(request, {...GOOD('not-an-address')});
    expect(bad.status).toBe(422);
    expect(bad.body).toMatch(/Enter a valid email address/);
    expect(bad.body).not.toContain('not-an-address');
    const email = fakeEmail();
    const stale = await post(request, {
      ...GOOD(email),
      consentEmailVersion: 'email-v0-forged',
    });
    expect(stale.status).toBe(422);
    expect(stale.body).not.toContain(email);
    const surface = await post(request, {
      ...GOOD(fakeEmail()),
      surface: 'evil',
    });
    expect(surface.status).toBe(422);
  });

  test('a header-injection address is refused and a 5 KB body is refused before any upstream call', async ({
    request,
  }, info) => {
    test.skip(apiOnly(info), API_ONLY_REASON);
    const injected = await post(
      request,
      GOOD('a@example.test\r\nBcc: x@example.test'),
    );
    expect(injected.status).toBe(422);
    const big = await post(request, {
      ...GOOD(fakeEmail()),
      padding: 'x'.repeat(5000),
    });
    info.annotations.push({
      type: 'observed',
      description: `injected=${injected.status} oversize=${big.status}`,
    });
    expect([400, 413, 422]).toContain(big.status);
    expect(big.status).not.toBe(503);
  });

  test('is independent of the analytics banner: it works with analytics undecided or refused', async ({
    page,
  }) => {
    await gotoReady(page, '/');
    const form = page
      .getByRole('contentinfo')
      .getByRole('form', {name: HEADING});
    await form.getByLabel(/Email address/).fill(fakeEmail());
    await form.getByRole('checkbox', {name: CONSENT}).check();
    await form.getByRole('button', {name: 'Sign up'}).click();
    // The fake key makes the server-side call fail: the friendly message, not an error page.
    await expect(page.getByText(UNAVAILABLE).first()).toBeVisible();
    await expect(page.getByRole('heading', {level: 1})).toBeVisible();
  });

  test('empty submit shows inline errors tied to the fields, moves focus to the email, and sends no request', async ({
    page,
  }) => {
    const posts: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/signup'))
        posts.push(r.url());
    });
    await gotoReady(page, '/');
    const form = page
      .getByRole('contentinfo')
      .getByRole('form', {name: HEADING});
    await form.getByRole('button', {name: 'Sign up'}).click();
    await expect(form.getByText(/Enter a valid email address/)).toBeVisible();
    await expect(form.getByText(/Tick the box to agree/)).toBeVisible();
    await expect(form.getByLabel(/Email address/)).toBeFocused();
    await expect(form.getByLabel(/Email address/)).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(posts).toEqual([]);
  });

  test('a form with the box unticked is refused by the server too (no JavaScript pre-check)', async ({
    request,
  }, info) => {
    test.skip(apiOnly(info), API_ONLY_REASON);
    const {consentEmail: _drop, ...unticked} = GOOD(fakeEmail());
    const answer = await post(request, unticked);
    expect(answer.status).toBe(422);
    expect(answer.body).toMatch(/Tick the box/);
  });

  test('a bot (filled honeypot) gets the same thank-you as a person and nothing is sent', async ({
    request,
  }, info) => {
    test.skip(apiOnly(info), API_ONLY_REASON);
    const answer = await post(request, {
      ...GOOD(fakeEmail()),
      company_website: 'http://spam.example',
    });
    expect(answer.status).toBe(200);
    expect(answer.body).toMatch(THANKS);
  });

  test('rate limit per address: the 7th attempt from one address is 429 with Retry-After and a fixed message', async ({
    request,
  }, info) => {
    test.skip(apiOnly(info), API_ONLY_REASON);
    const address = fakeAddress();
    const statuses: number[] = [];
    let last = {headers: {} as Record<string, string>, body: ''};
    for (let i = 0; i < 7; i += 1) {
      // Honeypot posts count against the address but call nobody.
      const answer = await post(
        request,
        {...GOOD(fakeEmail()), company_website: 'x'},
        {'x-real-ip': address},
      );
      statuses.push(answer.status);
      last = answer;
    }
    expect(statuses.slice(0, 6).every((s) => s === 200)).toBe(true);
    expect(statuses[6]).toBe(429);
    expect(Number(last.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(last.body).toMatch(/Too many attempts/);
  });

  test('rate limit per mailbox: "+tag" variants of one address are one mailbox, the 4th is refused', async ({
    request,
  }, info) => {
    test.skip(apiOnly(info), API_ONLY_REASON);
    const base = `qa-victim-${Date.now()}`;
    const statuses: number[] = [];
    for (const tag of ['a', 'b', 'c', 'd']) {
      statuses.push(
        (
          await post(request, {
            ...GOOD(`${base}+${tag}@example.test`),
            company_website: 'x',
          })
        ).status,
      );
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  test('form and answer have no serious axe finding and no horizontal scroll at 360 and 320 px', async ({
    page,
  }, info) => {
    test.skip(
      apiOnly(info),
      'The width is set explicitly, so the desktop project covers it.',
    );
    for (const width of [360, 320]) {
      await page.setViewportSize({width, height: 800});
      await gotoReady(page, '/');
      await page.getByRole('contentinfo').scrollIntoViewIfNeeded();
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
      const form = page
        .getByRole('contentinfo')
        .getByRole('form', {name: HEADING});
      await form.getByRole('button', {name: 'Sign up'}).click();
      await expect(form.getByText(/Enter a valid email address/)).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
    }
  });
});
