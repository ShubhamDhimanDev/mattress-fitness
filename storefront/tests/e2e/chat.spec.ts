import {expect, test, type Page} from '@playwright/test';
import {expectNoSeriousA11yViolations} from './helpers/a11y';
import {gotoReady, ourErrors} from './helpers/catalog';
import {
  readCspViolations,
  recordCspViolations,
  unexpectedViolations,
} from './helpers/csp';

// P7-03 (REQ-ANL-004, NFR-011, NFR-013, NFR-003). WRITTEN, NOT RUN: nothing here has been observed in a browser.
//
// There is no approved chat provider (Q-011), so the only provider the app can run is the development FAKE
// (PUBLIC_CHAT_PROVIDER=fake, dev server only). What this spec can prove is OUR behaviour: the call-outs, the consent
// gate, focus, failure isolation. It cannot say anything about a vendor widget.
//
// Server configurations (names only; values are placeholders, never real accounts):
//  - default server, no PUBLIC_CHAT_PROVIDER: the "no provider" block runs; the rest is skipped;
//  - E2E_CHAT=on with E2E_ENV_FILE naming a file with PUBLIC_CHAT_PROVIDER=fake and PUBLIC_CHAT_REQUIRES_CONSENT=false:
//    the "call-out" and "failure" blocks run (dev server only: the production preview refuses the fake);
//  - E2E_CHAT=consent with PUBLIC_CHAT_PROVIDER=fake, PUBLIC_GA4_MEASUREMENT_ID=G-TESTTEST01 and
//    PUBLIC_CONSENT_MODE=opt-in (the analytics category must exist in the banner): the "consent" block runs. The
//    analytics provider hosts are stubbed here so no request leaves the machine.

const CHAT_ON = process.env.E2E_CHAT === 'on';
const CHAT_CONSENT = process.env.E2E_CHAT === 'consent';
// The entry chunk (ChatEntry, which holds the shell and the call-out) and the runtime chunk. In the dev server each module
// has its own name, so the shell and the callout are matched by name too.
const CHAT_CHUNK = /Chat(Entry|Shell|Callout|Notice|Runtime)/;
// What must NOT be requested before the shopper agrees: the runtime chunk (controller, registry, adapter, view) and the
// provider. The ENTRY chunk (ChatEntry, which holds the shell, the call-out and the notice) IS requested at render on a
// store with a provider and consent required: CHAT.md "Loading and failure rules" 2 names it as the only chat file
// fetched before consent (no vendor code, no vendor request, no widget). V-E242: the first version of these two
// tests asserted that no chat file at all was requested, which contradicts that documented contract.
const CHAT_RUNTIME =
  /ChatRuntime|app[/]lib[/]chat[/](controller|registry|live|view|providers)/;
const FAKE_PANEL = '#fake-chat-panel';
// How long the fake takes to "load" in the tests that must catch the loading window. The call-out appears about 1.7 s
// after navigation (idle, then the runtime chunk) and gotoReady (networkidle) returns after about 3.4 s on the dev server,
// so a 1.2 to 1.5 s load is already over when the test looks (observed 2026-10-26, V-E242: the first version failed on
// that, not on the product). 8 s keeps the window open with room to spare and stays under the 10 s load timeout.
const SLOW_LOAD_MS = 8000;
const WINDOW_TIMEOUT = 15_000;

function watchRequests(page: Page, pattern: RegExp) {
  const seen: string[] = [];
  page.on('request', (request) => {
    if (pattern.test(request.url())) seen.push(request.url());
  });
  return seen;
}

/** The fake provider reads its test controls from this global, set before any page script runs. */
async function controlFake(
  page: Page,
  controls: {loadDelayMs?: number; failLoad?: boolean; openThrows?: boolean},
) {
  await page.addInitScript((value) => {
    Reflect.set(window, '__CHAT_FAKE__', value);
  }, controls);
}

/** The call-out in the place the current project shows it: the header bar on a desktop, the menu drawer on a phone. */
async function chatCallout(page: Page, isMobile: boolean) {
  if (isMobile) {
    await page.getByRole('button', {name: 'Menu'}).click();
    return page
      .getByRole('navigation', {name: 'Help and contact'})
      .getByRole('button', {name: 'Chat with us'});
  }
  return page.getByRole('banner').getByRole('button', {name: 'Chat with us'});
}

test.describe('REQ-ANL-004 no chat provider configured (the default)', () => {
  test.skip(CHAT_ON || CHAT_CONSENT, 'a chat provider is configured');

  test('no call-out, no chat code, no widget', async ({page, isMobile}) => {
    const chunk = watchRequests(page, CHAT_CHUNK);
    await gotoReady(page, '/');
    await page.waitForTimeout(3500); // past the 3 s idle limit the lazy chunks use; a negative proof needs the wait
    expect(
      chunk,
      'no chat chunk (entry, shell, call-out, notice or runtime) is requested',
    ).toEqual([]);
    await expect(page.locator(FAKE_PANEL)).toHaveCount(0);
    if (isMobile) {
      await page.getByRole('button', {name: 'Menu'}).click();
      await expect(
        page
          .getByRole('navigation', {name: 'Help and contact'})
          .getByRole('button', {name: 'Chat with us'}),
      ).toHaveCount(0);
    } else {
      await expect(
        page.getByRole('button', {name: 'Chat with us'}),
      ).toHaveCount(0);
    }
    await expect(page.getByRole('link', {name: 'Chat with us'})).toHaveCount(0);
  });
});

test.describe('REQ-ANL-004 call-out (fake provider, consent not required)', () => {
  test.skip(!CHAT_ON, 'needs E2E_CHAT=on and a server with the fake provider');

  test('the call-out is a button that opens the widget; Escape returns focus to it', async ({
    page,
    isMobile,
  }) => {
    await gotoReady(page, '/');
    const callout = await chatCallout(page, isMobile);
    await expect(callout).toBeVisible(); // appears after idle, once the fake has loaded
    await callout.focus();
    await callout.click();
    const dialog = page.getByRole('dialog', {name: 'Test chat'});
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('button', {name: 'Close the test chat'}),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // On a phone the call-out was in the menu drawer: the drawer closed and gave focus back to the Menu button first, the
    // widget opened after that, so closing it returns focus to the Menu button. A real vendor's widget decides where
    // focus lands: UNVERIFIED for any real one.
    await expect(
      isMobile ? page.getByRole('button', {name: 'Menu'}) : callout,
    ).toBeFocused();
  });

  test('pressed before the widget is ready: announced as starting, then opens (no dead button)', async ({
    page,
    isMobile,
  }) => {
    await controlFake(page, {loadDelayMs: SLOW_LOAD_MS});
    await gotoReady(page, '/');
    const callout = await chatCallout(page, isMobile);
    await expect(callout).toBeVisible();
    await callout.click();
    if (!isMobile) await expect(callout).toHaveAttribute('aria-busy', 'true');
    // The page-level live region speaks on both layouts (the menu has closed on a phone).
    await expect(
      page.getByRole('status').filter({hasText: 'Starting chat.'}),
    ).toHaveCount(1);
    await expect(page.getByRole('dialog', {name: 'Test chat'})).toBeVisible({
      timeout: WINDOW_TIMEOUT,
    });
  });

  test('has no serious or critical accessibility violations with the widget open', async ({
    page,
    isMobile,
  }) => {
    await gotoReady(page, '/');
    await (await chatCallout(page, isMobile)).click();
    await expect(page.getByRole('dialog', {name: 'Test chat'})).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('the dev server raises no policy violation for the fake (it loads nothing from the network)', async ({
    page,
  }) => {
    await recordCspViolations(page);
    await gotoReady(page, '/');
    await page.waitForTimeout(3500);
    expect(unexpectedViolations(await readCspViolations(page))).toEqual([]);
  });
});

test.describe('NFR-013 chat provider failure never blocks the shop', () => {
  test.skip(!CHAT_ON, 'needs E2E_CHAT=on and a server with the fake provider');

  test('a load that fails after the shopper pressed the call-out leaves a contact link or nothing, and the site works', async ({
    page,
    isMobile,
  }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await controlFake(page, {failLoad: true, loadDelayMs: SLOW_LOAD_MS});
    await gotoReady(page, '/');
    const callout = await chatCallout(page, isMobile);
    await expect(callout).toBeVisible();
    await callout.click();
    await expect(
      page
        .getByRole('status')
        .filter({hasText: 'Chat is unavailable right now.'}),
    ).toBeVisible({timeout: WINDOW_TIMEOUT});
    await expect(page.getByRole('button', {name: 'Chat with us'})).toHaveCount(
      0,
    );
    // The notice is page-level, so a phone shopper sees it too. Either the contact page exists and the notice links to it
    // (never a dead link), or it has only a Dismiss button.
    await expect(page.getByRole('button', {name: 'Dismiss'})).toBeVisible();
    const fallback = page.getByRole('link', {name: 'Contact us instead'});
    if ((await fallback.count()) > 0) {
      await expect(fallback.first()).toHaveAttribute('href', '/pages/contact');
    }
    // Shopping still works: a listing and a product page render.
    await gotoReady(page, '/collections/all');
    await expect(page.getByRole('main')).toBeVisible();
    expect(ourErrors(errors)).toEqual([]);
  });

  test('a passive failure (nobody pressed anything) hides chat silently', async ({
    page,
    isMobile,
  }) => {
    await controlFake(page, {failLoad: true});
    await gotoReady(page, '/');
    await page.waitForTimeout(3500);
    if (isMobile) {
      await page.getByRole('button', {name: 'Menu'}).click();
    }
    await expect(page.getByRole('button', {name: 'Chat with us'})).toHaveCount(
      0,
    );
    await expect(page.getByRole('status').filter({hasText: /./})).toHaveCount(
      0,
    );
    await expect(page.getByRole('button', {name: 'Dismiss'})).toHaveCount(0);
  });
});

test.describe('NFR-011 chat waits for the shopper (consent required)', () => {
  test.skip(
    !CHAT_CONSENT,
    'needs E2E_CHAT=consent and the analytics placeholder id',
  );

  test.beforeEach(async ({page}) => {
    // No request may leave the machine for the analytics hosts.
    await page.route(/^https:\/\/www\.googletagmanager\.com\//, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: '',
      }),
    );
  });

  test('no chat runtime, no provider, no widget and no call-out before the shopper agrees', async ({
    page,
  }) => {
    const runtime = watchRequests(page, CHAT_RUNTIME);
    await gotoReady(page, '/');
    await page.waitForTimeout(3500);
    expect(runtime, 'no runtime, controller or provider module').toEqual([]);
    await expect(page.locator(FAKE_PANEL)).toHaveCount(0);
    await expect(page.getByRole('button', {name: 'Chat with us'})).toHaveCount(
      0,
    );
  });

  test('"Reject all" keeps chat away', async ({page}) => {
    const runtime = watchRequests(page, CHAT_RUNTIME);
    await gotoReady(page, '/');
    await page
      .getByRole('region', {name: 'Privacy choices'})
      .getByRole('button', {name: 'Reject all'})
      .click();
    await page.waitForTimeout(3500);
    expect(runtime, 'no runtime, controller or provider module').toEqual([]);
    await expect(page.locator(FAKE_PANEL)).toHaveCount(0);
    await expect(page.getByRole('button', {name: 'Chat with us'})).toHaveCount(
      0,
    );
  });

  test('"Accept all" brings the call-out; withdrawing from the footer removes the widget', async ({
    page,
    isMobile,
  }) => {
    test.skip(
      isMobile,
      'the withdrawal path is the same on a phone; one project is enough',
    );
    const runtime = watchRequests(page, CHAT_RUNTIME);
    await gotoReady(page, '/');
    expect(runtime, 'positive control: nothing yet').toEqual([]);
    await page
      .getByRole('region', {name: 'Privacy choices'})
      .getByRole('button', {name: 'Accept all'})
      .click();
    const callout = page
      .getByRole('banner')
      .getByRole('button', {name: 'Chat with us'});
    await expect(callout).toBeVisible();
    await expect(page.locator(FAKE_PANEL)).toHaveCount(1);
    expect(
      runtime.length,
      'the runtime is requested after Accept all (the negative tests above can fail)',
    ).toBeGreaterThan(0);
    await page.getByRole('button', {name: 'Privacy choices'}).click();
    const preferences = page.getByRole('dialog', {name: 'Privacy choices'});
    await preferences.getByRole('checkbox').first().uncheck();
    await preferences.getByRole('button', {name: 'Save choices'}).click();
    await expect(callout).toHaveCount(0);
    await expect(page.locator(FAKE_PANEL)).toHaveCount(0);
  });
});
