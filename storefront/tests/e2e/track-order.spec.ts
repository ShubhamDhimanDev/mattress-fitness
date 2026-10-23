import {expect, test} from '@playwright/test';
import {
  collectConsoleErrors,
  expectNoSeriousA11yViolations,
} from './helpers/a11y';
import {
  expectNoHorizontalScroll,
  gotoReady,
  ourErrors,
} from './helpers/catalog';

// REQ-ACC-003 / P6-08 / T-09. WRITTEN, NOT RUN (no browser in the authoring session). UNVERIFIED against a real store
// (V-09, V-20). Without SHOPIFY_ADMIN_API_ACCESS_TOKEN the page must show the "not available" notice and no form; the
// form tests skip with a stated reason in that case. No test here sends a real order number or email: the values are
// invented, and against a configured store they can only produce the generic answer.

const GENERIC = /couldn't find an order with those details/i;
const UNAVAILABLE = 'Order lookup is not available right now';

async function formAvailable(page: import('@playwright/test').Page) {
  return page.getByRole('form', {name: 'Find your order'}).isVisible();
}

test.describe('guest order tracking page (REQ-ACC-003)', () => {
  test('the page is private, not indexable and quiet in the console', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    const response = await gotoReady(page, '/track-order');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['cache-control']).toContain('no-store');
    expect(response?.headers()['x-robots-tag']).toContain('noindex');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    );
    await expect(
      page.getByRole('heading', {level: 1, name: 'Track your order'}),
    ).toBeVisible();
    expect(ourErrors(errors)).toEqual([]);
  });

  test('either the form or the unavailable notice is shown, never a fake result', async ({
    page,
  }) => {
    await gotoReady(page, '/track-order');
    const hasForm = await formAvailable(page);
    if (!hasForm) {
      await expect(page.getByText(UNAVAILABLE).first()).toBeVisible();
      await expect(page.getByLabel(/Order number/)).toHaveCount(0);
    }
    await expect(page.getByText(/Order #\d/)).toHaveCount(0);
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
  });

  test('has no serious accessibility violation and no horizontal scroll at 360 px', async ({
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

  test('refuses a GET lookup and a cross-origin POST', async ({
    page,
    request,
  }) => {
    await gotoReady(page, '/track-order');
    const put = await request.put('/track-order', {
      form: {orderNumber: '1001', email: 'shopper@example.com'},
    });
    // The framework answers a method the route does not handle; whatever the status, no order data is in it.
    expect(put.status()).toBeGreaterThanOrEqual(400);
    const cross = await request.post('/track-order', {
      form: {orderNumber: '1001', email: 'shopper@example.com'},
      headers: {Origin: 'https://evil.example'},
    });
    expect([403, 404, 405]).toContain(cross.status());
    expect(await cross.text()).not.toMatch(/Order #\d/);
  });
});

test.describe('guest order tracking form (needs the Admin token; invented values)', () => {
  test('an unknown order and a malformed pair give the same message, which names no field', async ({
    page,
  }) => {
    await gotoReady(page, '/track-order');
    test.skip(
      !(await formAvailable(page)),
      'Order lookup is not configured here (no Admin token, V-20): the form is not shown.',
    );
    const submit = async (number: string, email: string) => {
      await page.getByLabel(/Order number/).fill(number);
      await page.getByLabel(/Email address/).fill(email);
      await page.getByRole('button', {name: 'Find my order'}).click();
      const message = page.getByText(GENERIC);
      await expect(message).toBeVisible();
      return message.innerText();
    };
    const unknown = await submit('#987654321', 'nobody@example.com');
    const malformed = await submit('not an order!', 'nobody@example.com');
    expect(malformed).toBe(unknown);
    expect(unknown).toContain('60 days');
    expect(unknown.toLowerCase()).not.toMatch(
      /email is|number is|wrong|invalid/,
    );
    await expect(
      page.getByRole('link', {name: 'Sign in to your account'}),
    ).toHaveAttribute('href', '/account/login');
    // Nothing typed is echoed back.
    await expect(page.getByText('987654321')).toHaveCount(0);
  });

  test('repeated attempts end in the wait notice', async ({page}) => {
    await gotoReady(page, '/track-order');
    test.skip(
      !(await formAvailable(page)),
      'Order lookup is not configured here (no Admin token, V-20): the form is not shown.',
    );
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await page.getByLabel(/Order number/).fill('#987654321');
      await page
        .getByLabel(/Email address/)
        .fill(`nobody${attempt}@example.com`);
      await page.getByRole('button', {name: 'Find my order'}).click();
      await expect(
        page.getByText(GENERIC).or(page.getByText(/Too many attempts/)),
      ).toBeVisible();
    }
    await expect(page.getByText(/Too many attempts/)).toBeVisible();
  });
});
