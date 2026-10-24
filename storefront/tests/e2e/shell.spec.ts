import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import {
  collectConsoleErrors,
  expectNoSeriousA11yViolations,
  isBlockedTelemetryRefusal,
} from './helpers/a11y';
import {
  checkFooterContract,
  contentHrefs,
  expectFooterContract,
  footerGroupSizes,
  footerLinks,
  revealFooterLink,
} from './helpers/footer';

// P2-05 / P2-07: the responsive shell. Covers REQ-NAV-001 (header, menu, drawer and footer keyboard-operable,
// no horizontal scroll at 360/768/1280), NFR-001 (mobile first at 360, 768, 1024, 1280, 1536 px),
// NFR-003 (axe, skip link, landmarks, focus management) and the ZIP entry UI of REQ-NAV-003.
// The desktop project runs the desktop-only tests, the mobile project the mobile-only ones.

/** Navigates and waits until the page has hydrated (no pending requests), so clicks reach React handlers. */
async function gotoReady(page: Page, url = '/') {
  const response = await page.goto(url);
  await page.waitForLoadState('networkidle');
  return response;
}

/**
 * Clicks `trigger` until `target` is visible. Guards against a click that lands in the short window before
 * hydration; it never clicks again once the target is showing, so it cannot toggle something closed.
 */
async function openUntilVisible(trigger: Locator, target: Locator) {
  await expect(async () => {
    if (!(await target.isVisible())) await trigger.click({timeout: 2_000});
    await expect(target).toBeVisible({timeout: 2_000});
  }).toPass({timeout: 15_000});
}

/**
 * mock.shop has no consent-management API, so Shopify's consent script logs one error that has nothing to do
 * with our code. It disappears when the development store is connected (P3A); any other error still fails.
 */
function unexpectedErrors(errors: string[]): string[] {
  return errors.filter(
    (message) =>
      !message.includes('Shopify Customer Privacy') &&
      // Shopify's own performance telemetry is refused by our CSP in development, intermittently; not our code
      // (same exclusion as ourErrors in helpers/catalog.ts: the blocked URL's host must be exactly that host).
      !isBlockedTelemetryRefusal(message),
  );
}

const mainNav = (page: Page) => page.getByRole('navigation', {name: 'Main'});

test.describe('REQ-NAV-001 shell: landmarks, skip link and title', () => {
  test('has one banner, one main, one contentinfo and exactly one h1', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    const response = await gotoReady(page);
    expect(response?.status()).toBe(200);

    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('contentinfo')).toHaveCount(1);
    await expect(page.getByRole('heading', {level: 1})).toHaveCount(1);
    await expect(page.getByRole('navigation', {name: 'Footer'})).toBeVisible();
    expect(unexpectedErrors(errors), 'console errors on the home page').toEqual(
      [],
    );
  });

  test('the first Tab stop is the skip link and it moves focus to main', async ({
    page,
  }) => {
    await gotoReady(page);
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', {name: 'Skip to main content'});
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();

    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();
    await expect(page).toHaveURL(/#main-content$/);
  });

  test('the home page has the descriptive site title', async ({page}) => {
    await gotoReady(page);
    await expect(page).toHaveTitle(
      'Mattress Fitness | Mattresses, bases and bedding',
    );
  });

  test('the header shows the client logo as the home link, with no layout shift', async ({
    page,
  }) => {
    await gotoReady(page, '/collections');
    const home = page
      .getByRole('banner')
      .getByRole('link', {name: 'Mattress Fitness home'});
    await expect(home).toHaveAttribute('href', '/');
    const logo = home.getByRole('img', {name: 'Mattress Fitness'});
    await expect(logo).toBeVisible();
    await expect(logo).toHaveAttribute('width', '56');
    await expect(logo).toHaveAttribute('height', '56');
    await expect(logo).toHaveAttribute('fetchpriority', 'high');
    // The image decoded (the file exists and is the small one, not the 543 kB original).
    expect(
      await logo.evaluate((img: HTMLImageElement) => img.naturalWidth),
    ).toBeGreaterThan(0);
    expect(
      await logo.evaluate((img: HTMLImageElement) => img.currentSrc),
    ).toMatch(/\/brand\/mattress-fitness-logo-(96|180)\.png$/);
    // Nothing is announced twice: the one image alt in the header is the logo's.
    await expect(
      page.getByRole('banner').getByRole('img', {name: 'Mattress Fitness'}),
    ).toHaveCount(1);
  });

  test('the footer shows the logo and the tagline as plain text', async ({
    page,
  }) => {
    await gotoReady(page);
    const footer = page.getByRole('contentinfo');
    await expect(
      footer.getByRole('img', {name: 'Mattress Fitness'}),
    ).toHaveCount(1);
    await expect(footer.getByText('Rest. Recover. Perform.')).toBeVisible();
  });

  test('the head carries the favicon, the touch icon and the theme colour', async ({
    page,
  }) => {
    await gotoReady(page);
    await expect(page.locator('head link[rel="icon"]')).toHaveAttribute(
      'href',
      '/brand/mattress-fitness-logo-48.png',
    );
    await expect(page.locator('head link[rel="icon"]')).toHaveAttribute(
      'sizes',
      '48x48',
    );
    await expect(
      page.locator('head link[rel="apple-touch-icon"]'),
    ).toHaveAttribute('href', '/brand/mattress-fitness-logo-180.png');
    await expect(page.locator('head meta[name="theme-color"]')).toHaveAttribute(
      'content',
      '#DE0510',
    );
  });
});

test.describe('REQ-NAV-001 header: utility bar, search, account and cart', () => {
  test('shows the ZIP entry, my store, search, account and cart entry points', async ({
    page,
    isMobile,
  }) => {
    await gotoReady(page);
    const header = page.getByRole('banner');

    await expect(
      header.getByRole('button', {name: 'Enter delivery ZIP'}),
    ).toBeVisible();
    await expect(
      header.getByRole('link', {name: 'Select your store'}),
    ).toBeVisible();
    await expect(
      header.getByRole('combobox', {name: 'Search products and pages'}),
    ).toBeVisible();
    await expect(header.getByRole('link', {name: 'Sign in'})).toHaveAttribute(
      'href',
      '/account',
    );
    await expect(header.getByRole('link', {name: 'Cart'})).toHaveAttribute(
      'href',
      '/cart',
    );
    await expect(
      header.getByRole('link', {name: 'Find your mattress'}),
    ).toHaveCount(1); // one per breakpoint: the main row on a phone, the navigation on desktop (the other is display:none)

    if (isMobile) {
      // Right-hand utility links move into the menu drawer below 1024 px (they need about 870 px beside the ZIP and
      // store controls; BV-006: at 768 px they wrapped the bar to two lines). The phone project is 412 px wide.
      await expect(
        header.getByRole('link', {name: 'Track order'}),
      ).toBeHidden();
      await expect(header.getByRole('button', {name: 'Menu'})).toBeVisible();
    } else {
      await expect(
        header.getByRole('link', {name: 'Track order'}),
      ).toBeVisible();
      // "Contact us" needs the Shopify contact page (REQ-CNT-001, P6-09): shown only when /pages/contact answers 200,
      // never as a link that 404s. "Chat with us" has no provider yet (Q-011, P7-03), so it is never shown.
      const contactStatus = (
        await page.request.get('/pages/contact', {maxRedirects: 0})
      ).status();
      const contact = header.getByRole('link', {name: 'Contact us'});
      if (contactStatus === 404) {
        await expect(
          contact,
          '/pages/contact answers 404: no link',
        ).toHaveCount(0);
      } else {
        // 200 with text: the link shows; 200 without text: absent. Either way it is never a dead link.
        expect(contactStatus).toBe(200);
        if ((await contact.count()) > 0)
          await expect(contact).toHaveAttribute('href', '/pages/contact');
      }
      await expect(
        header.getByRole('link', {name: 'Chat with us'}),
        'no chat provider is configured, so there is no chat link',
      ).toHaveCount(0);
      // Development shows a labelled placeholder; a real number needs PUBLIC_SUPPORT_PHONE (REQ-CNT-001).
      await expect(
        header.getByRole('link', {name: /555-0100 \(dev placeholder\)/}),
      ).toBeVisible();
      await expect(
        header.getByRole('link', {name: 'Find a store'}),
      ).toBeVisible();
      await expect(header.getByRole('button', {name: 'Menu'})).toBeHidden();
    }
  });

  // REQ-CNT-001 / B-15: the delivery promise, the comfort guarantee and the price guarantee are placeholder
  // wording the client has not supplied, so the strip is not rendered at all. When the client's pages arrive,
  // drop `awaitingContent` per item in lib/navigation.ts and change this test to expect those items.
  test('the reassurance strip shows nothing the client has not supplied', async ({
    page,
  }) => {
    await gotoReady(page);
    const header = page.getByRole('banner');
    await expect(
      header.getByRole('link', {
        name: /In-home delivery|Comfort guarantee|Price guarantee/,
      }),
    ).toHaveCount(0);
  });

  // The promotion text now comes from the site_settings entry (site-settings.ts, unit tested with a recorded entry).
  // The mock stores have no such entry, so this proves the empty case end to end (nothing invented, B-15); a bar
  // with real admin text needs the development store (V-04 for metaobject access).
  test('no placeholder promotion text is shown', async ({page}) => {
    await gotoReady(page);
    await expect(page.getByText(/Sample promotion text/)).toHaveCount(0);
    await expect(page.getByRole('link', {name: 'Shop the sale'})).toHaveCount(
      0,
    );
  });

  // REQ-CNT-001 / P6-09: a footer link exists only for a Shopify page that exists with content, so the guarantee
  // links appear only once the client has written those pages. The always-present "Find a store" link proves the
  // About group is open; the guarantee links, when shown, must be the registry pages and must resolve.
  test('the footer makes no comfort or price guarantee claim the client has not written', async ({
    page,
    request,
    isMobile,
  }) => {
    await gotoReady(page);
    const footer = page.getByRole('contentinfo');
    if (isMobile) {
      await footer.getByRole('button', {name: 'About', exact: true}).click();
    }
    await expect(
      footer.getByRole('link', {name: 'Find a store'}),
    ).toBeVisible();
    const guarantees = footer.getByRole('link', {
      name: /Comfort guarantee|Price guarantee/,
    });
    const hrefs = await guarantees.evaluateAll((links) =>
      links.map((link) => link.getAttribute('href') ?? ''),
    );
    for (const href of hrefs) {
      expect(
        ['/pages/comfort-guarantee', '/pages/price-guarantee'],
        'a guarantee link goes only to its registry page',
      ).toContain(href);
      const response = await request.get(href);
      expect(response.status(), `${href} is not a 404 link`).toBe(200);
    }
    // With no link (the client has written neither page) the loop above has nothing to check: nothing is promised.
  });

  test('the footer links no financing or warranty page that does not exist', async ({
    page,
    request,
  }) => {
    await gotoReady(page);
    const footer = page.getByRole('contentinfo');
    for (const [path, name] of [
      ['/pages/financing', 'Financing'],
      ['/pages/warranty-and-returns', 'Warranty and returns'],
    ] as const) {
      const status = (await request.get(path, {maxRedirects: 0})).status();
      const byHref = footer.locator(`a[href="${path}"]`);
      const byName = footer.getByRole('link', {name, exact: true});
      if (status === 404) {
        // Missing page: no link under its href or its name (a 404 link is the defect this contract prevents).
        await expect(byHref, `${path} answers 404: no link`).toHaveCount(0);
        await expect(byName, `${path} answers 404: no "${name}"`).toHaveCount(
          0,
        );
      } else {
        // The page exists: a link is allowed (not required: a page with no text is treated as absent).
        expect(status, `${path} is a 404 or a 200 page`).toBe(200);
      }
    }
  });

  // REQ-LOC-003 / P3B-10: the header shows the store from the my_store cookie. The cookie is validated on
  // the server against the store list; only the store name reaches the page.
  test.describe('my store in the header', () => {
    const BUFFALO = 'new-york.buffalo.buffalo-gallery';

    async function setCookie(
      context: BrowserContext,
      baseURL: string | undefined,
      value: string,
    ) {
      await context.addCookies([
        {
          name: 'my_store',
          value: encodeURIComponent(value),
          url: baseURL ?? '',
        },
      ]);
    }

    test('shows My store: <name> for a valid cookie and never prints the cookie value', async ({
      page,
      context,
      baseURL,
    }) => {
      await setCookie(context, baseURL, BUFFALO);
      const response = await gotoReady(page);
      await expect(
        page.getByRole('banner').getByRole('link', {
          name: 'My store: Wrenfield Sleep Gallery Buffalo',
        }),
      ).toBeVisible();
      await expect(
        page.getByRole('banner').getByRole('link', {name: 'Select your store'}),
      ).toHaveCount(0);
      // The page may name the store; the cookie text itself must not be echoed into the HTML.
      expect(await response?.text()).not.toContain(BUFFALO);
    });

    test('a tampered cookie selects nothing and is not echoed', async ({
      page,
      context,
      baseURL,
    }) => {
      const tampered = 'new-york.buffalo.<script>alert(1)</script>';
      await setCookie(context, baseURL, tampered);
      const response = await gotoReady(page);
      await expect(
        page.getByRole('banner').getByRole('link', {name: 'Select your store'}),
      ).toBeVisible();
      const html = (await response?.text()) ?? '';
      expect(html).not.toContain('alert(1)');
    });

    // The document varies by cookie, so it is private; no-cache (not no-store) keeps the back/forward cache.
    test('the page is private and revalidated, but not no-store', async ({
      page,
      context,
      baseURL,
    }) => {
      await setCookie(context, baseURL, BUFFALO);
      const response = await gotoReady(page);
      expect(response?.headers()['cache-control']).toBe('private, no-cache');
      expect(response?.headers()['vary']).toMatch(/cookie/i);
    });
  });

  test('the cart button opens the cart drawer, Escape closes it and focus returns', async ({
    page,
  }) => {
    await gotoReady(page);
    const cartButton = page
      .getByRole('banner')
      .getByRole('link', {name: 'Cart'});
    const drawer = page.getByRole('dialog', {name: 'Cart'});
    await openUntilVisible(cartButton, drawer);
    await expect(page).toHaveURL(/\/$/); // the link did not navigate away
    await expect(drawer.getByText(/added anything yet/)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(cartButton).toBeFocused();
  });

  test('searching from the header goes to the results page with an encoded query', async ({
    page,
  }) => {
    await gotoReady(page);
    const search = page
      .getByRole('banner')
      .getByRole('combobox', {name: 'Search products and pages'});
    await search.fill('queen & firm');
    await search.press('Enter');
    await expect(page).toHaveURL(/\/search\?q=queen\+%26\+firm$/);
  });
});

// REQ-NAV-003 / P3B-11: the header ZIP is the server-side one (signed cookie, /delivery), shared with the
// product-page and cart delivery check. Saving needs a delivery zone in the server configuration
// (OFFER_CONFIG_JSON, see DEV_DATA.md "Delivery ZIP"); without one the server cannot say anything about a ZIP, so
// the header shows none. The two tests below cover each case and skip when the server is configured the other way.
async function zoneIsConfigured(page: Page): Promise<boolean> {
  const response = await page.request.get('/delivery');
  return !(await response.text()).includes(
    'Delivery information is not available right now.',
  );
}

async function openZipDialog(page: Page) {
  await gotoReady(page);
  const trigger = page.getByRole('button', {name: 'Enter delivery ZIP'});
  const dialog = page.getByRole('dialog', {name: 'Delivery ZIP code'});
  await openUntilVisible(trigger, dialog);
  return dialog;
}

test.describe('REQ-NAV-003 delivery ZIP entry', () => {
  test('rejects an invalid ZIP inline with the same wording and check as the server', async ({
    page,
  }) => {
    const dialog = await openZipDialog(page);
    const zip = dialog.getByRole('textbox', {name: 'ZIP code'});
    await expect(zip).toBeFocused();

    await dialog.getByRole('button', {name: 'Save ZIP code'}).click();
    await expect(
      dialog.getByText('Enter a 5-digit US ZIP code.'),
    ).toBeVisible();
    await expect(zip).toHaveAttribute('aria-invalid', 'true');
    await expect(zip).toBeFocused();

    await zip.clear();
    await zip.pressSequentially('12ab34'); // typed like a shopper; non-digits are dropped as you go
    await expect(zip).toHaveValue('1234');
    await expect(dialog.getByText('Enter a 5-digit US ZIP code.')).toBeHidden();
    await dialog.getByRole('button', {name: 'Save ZIP code'}).click();
    await expect(
      dialog.getByText('Enter a 5-digit US ZIP code.'),
    ).toBeVisible();
    // Nothing was sent: the invalid ZIP never reached the server, so no ZIP is saved.
    await expect(dialog).toBeVisible();
  });

  test('with a delivery zone, saves the ZIP on the server, shows it, keeps it across a reload and clears it', async ({
    page,
  }) => {
    test.skip(
      !(await zoneIsConfigured(page)),
      'no delivery zone in the server configuration (OFFER_CONFIG_JSON); see DEV_DATA.md',
    );
    const dialog = await openZipDialog(page);
    const zip = dialog.getByRole('textbox', {name: 'ZIP code'});
    await zip.fill('12345');
    const answered = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.startsWith('/delivery') &&
        response.request().method() === 'POST',
    );
    await zip.press('Enter');
    expect((await answered).status()).toBe(200);
    await expect(dialog).toBeHidden();
    const saved = page.getByRole('button', {name: /Delivering to 12345/});
    await expect(saved).toBeVisible();

    // The server remembers it: a full reload still shows it, and the cookie is not readable by scripts.
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(
      page.getByRole('button', {name: /Delivering to 12345/}),
    ).toBeVisible();
    expect(await page.evaluate(() => document.cookie)).not.toContain('12345');

    // First paint: the server-rendered HTML already carries the state, so there is no "Enter delivery ZIP"
    // flash while a /delivery request is made after hydration.
    const html = (await (await page.request.get('/')).text()).replace(
      /<!--.*?-->/g,
      '',
    );
    expect(html).toMatch(/Delivering to\s*<span[^>]*>12345<\/span>/);
    expect(html).not.toContain('Enter delivery ZIP');

    // It can be edited and cleared.
    await page.getByRole('button', {name: /Delivering to 12345/}).click();
    await expect(
      page
        .getByRole('dialog', {name: 'Delivery ZIP code'})
        .getByRole('textbox', {name: 'ZIP code'}),
    ).toHaveValue('12345');
    await page.getByRole('button', {name: 'Clear ZIP code'}).click();
    await expect(
      page.getByRole('button', {name: 'Enter delivery ZIP'}),
    ).toBeVisible();
  });

  test('without a delivery zone, accepts the ZIP but claims nothing about it', async ({
    page,
  }) => {
    test.skip(
      await zoneIsConfigured(page),
      'a delivery zone is configured; the test above covers this server',
    );
    const dialog = await openZipDialog(page);
    await dialog.getByRole('textbox', {name: 'ZIP code'}).fill('12345');
    await dialog.getByRole('button', {name: 'Save ZIP code'}).click();
    // Saving a ZIP needs DELIVERY_COOKIE_SECRET (32+ characters). A local env file without it makes the server answer with the
    // fixed save-failed text (fail closed, DEC-032, DEV_DATA.md); that is a setup gap, not a defect, so say so and skip. CI's .env.ci sets it.
    const saveFailed = dialog.getByText('We could not save your ZIP code.');
    await expect
      .poll(
        async () => (await dialog.isHidden()) || (await saveFailed.isVisible()),
        {
          timeout: 10_000,
        },
      )
      .toBe(true);
    // Only skip outside CI: the text is the generic save-failed code, so in CI (whose env file sets the secret) it must fail the run.
    if (!process.env.CI && (await saveFailed.isVisible())) {
      test.skip(
        true,
        'DELIVERY_COOKIE_SECRET is not set in this env file, so a ZIP cannot be saved (see DEV_DATA.md)',
      );
    }
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('button', {name: 'Enter delivery ZIP'}),
    ).toBeVisible();
  });

  test('Escape closes the ZIP dialog without saving and returns focus', async ({
    page,
  }) => {
    await gotoReady(page);
    const trigger = page.getByRole('button', {name: 'Enter delivery ZIP'});
    const dialog = page.getByRole('dialog', {name: 'Delivery ZIP code'});
    await openUntilVisible(trigger, dialog);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

test.describe('REQ-NAV-001 / REQ-NAV-002 desktop navigation (keyboard and pointer)', () => {
  test.skip(
    ({isMobile}) => isMobile,
    'The desktop navigation is hidden below 1024 px.',
  );

  test('lists the top-level items from the navigation config in order', async ({
    page,
  }) => {
    await gotoReady(page);
    const nav = mainNav(page);
    const names = await nav
      .locator('[data-nav-top]')
      .evaluateAll((elements) =>
        elements.map((element) => (element.textContent ?? '').trim()),
      );
    expect(names).toEqual([
      'Sale',
      'Mattresses',
      'Foundations & Bases',
      'Furniture',
      'Bedding',
      'Clearance',
      'Guides',
      'Find your mattress',
    ]);
  });

  test('Enter opens a menu, ArrowDown enters it, Escape closes it and returns focus', async ({
    page,
  }) => {
    await gotoReady(page);
    const nav = mainNav(page);
    const mattresses = nav.getByRole('button', {name: 'Mattresses'});
    await mattresses.focus();
    await expect(mattresses).toHaveAttribute('aria-expanded', 'false');

    await page.keyboard.press('Enter');
    await expect(mattresses).toHaveAttribute('aria-expanded', 'true');
    // The five groups the SOW asks for are in the panel.
    for (const heading of [
      'Shop by size',
      'Shop by brand',
      'Shop by comfort',
      'Shop by type',
      'Shop by price',
    ]) {
      await expect(nav.getByText(heading, {exact: true})).toBeVisible();
    }

    await page.keyboard.press('ArrowDown');
    await expect(
      nav.getByRole('link', {name: 'Twin', exact: true}),
    ).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(nav.getByRole('link', {name: 'Twin XL'})).toBeFocused();
    await page.keyboard.press('End');
    await expect(
      nav.getByRole('link', {name: 'View all mattresses'}),
    ).toBeFocused();
    await page.keyboard.press('Home');
    await expect(
      nav.getByRole('link', {name: 'Twin', exact: true}),
    ).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(mattresses).toHaveAttribute('aria-expanded', 'false');
    await expect(mattresses).toBeFocused();
  });

  test('Space also opens a menu', async ({page}) => {
    await gotoReady(page);
    const furniture = mainNav(page).getByRole('button', {name: 'Furniture'});
    await furniture.focus();
    await page.keyboard.press('Space');
    await expect(furniture).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Space');
    await expect(furniture).toHaveAttribute('aria-expanded', 'false');
  });

  test('arrow keys, Home and End move between the top-level items', async ({
    page,
  }) => {
    await gotoReady(page);
    const nav = mainNav(page);
    const mattresses = nav.getByRole('button', {name: 'Mattresses'});
    await mattresses.focus();

    await page.keyboard.press('ArrowRight');
    await expect(
      nav.getByRole('button', {name: 'Foundations & Bases'}),
    ).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(mattresses).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(nav.getByRole('link', {name: 'Sale'})).toBeFocused();
    await page.keyboard.press('End');
    await expect(
      nav.getByRole('link', {name: 'Find your mattress'}),
    ).toBeFocused();
    await page.keyboard.press('Home');
    await expect(nav.getByRole('link', {name: 'Sale'})).toBeFocused();
  });

  test('plain items are links and do not claim to expand', async ({page}) => {
    await gotoReady(page);
    const nav = mainNav(page);
    await expect(nav.getByRole('link', {name: 'Sale'})).toHaveAttribute(
      'href',
      '/collections/sale',
    );
    await expect(
      nav.getByRole('link', {name: 'Clearance'}),
    ).not.toHaveAttribute('aria-expanded');
    await expect(
      nav.getByRole('link', {name: 'Find your mattress'}),
    ).toHaveAttribute('href', '/quiz');
  });

  test('hovering opens a menu, moving onto the panel keeps it open and leaving closes it', async ({
    page,
  }) => {
    await gotoReady(page);
    const nav = mainNav(page);
    const bedding = nav.getByRole('button', {name: 'Bedding'});
    await bedding.hover();
    await expect(bedding).toHaveAttribute('aria-expanded', 'true');

    const pillows = nav.getByRole('link', {name: 'Pillows'});
    await pillows.hover();
    await expect(bedding).toHaveAttribute('aria-expanded', 'true');

    // Leave through the empty margin below the panel: with no reassurance strip (REQ-CNT-001) the page
    // content starts right under the navigation, so the open panel can cover the h1.
    await page.mouse.move(4, 780);
    await expect(bedding).toHaveAttribute('aria-expanded', 'false');
  });

  test('clicking outside closes an open menu', async ({page}) => {
    await gotoReady(page);
    const guides = mainNav(page).getByRole('button', {name: 'Guides'});
    await guides.focus();
    await page.keyboard.press('Enter');
    await expect(guides).toHaveAttribute('aria-expanded', 'true');
    // The open panel covers the page content under the navigation, so click the empty margin below it.
    await page.mouse.click(4, 780);
    await expect(guides).toHaveAttribute('aria-expanded', 'false');
  });

  test('following a link inside a menu navigates and closes the menu', async ({
    page,
  }) => {
    await gotoReady(page);
    const nav = mainNav(page);
    const mattresses = nav.getByRole('button', {name: 'Mattresses'});
    await mattresses.focus();
    await page.keyboard.press('Enter');
    await nav.getByRole('link', {name: 'Hybrid'}).click();
    await expect(page).toHaveURL(/\/collections\/hybrid-mattresses$/);
    await expect(mattresses).toHaveAttribute('aria-expanded', 'false');
  });

  test('has no serious or critical accessibility violations with a menu open', async ({
    page,
  }) => {
    await gotoReady(page);
    const mattresses = mainNav(page).getByRole('button', {name: 'Mattresses'});
    await mattresses.focus();
    await page.keyboard.press('Enter');
    await expect(mattresses).toHaveAttribute('aria-expanded', 'true');
    await expectNoSeriousA11yViolations(page);
  });
});

test.describe('REQ-NAV-001 mobile navigation drawer', () => {
  test.skip(
    ({isMobile}) => !isMobile,
    'The menu drawer is for widths below 1024 px.',
  );

  test('opens as a labelled dialog, traps focus, closes on Escape and returns focus', async ({
    page,
  }) => {
    await gotoReady(page);
    const menuButton = page
      .getByRole('banner')
      .getByRole('button', {name: 'Menu'});
    const drawer = page.getByRole('dialog', {name: 'Menu'});
    await openUntilVisible(menuButton, drawer);

    await expect(drawer.getByRole('button', {name: 'Close'})).toBeFocused();
    expect(
      await page.evaluate(() => document.body.style.overflow),
      'page scroll is locked behind the drawer',
    ).toBe('hidden');

    // Tab never leaves the drawer.
    for (let press = 0; press < 14; press += 1) {
      await page.keyboard.press('Tab');
      expect(
        await drawer.evaluate((element) =>
          element.contains(document.activeElement),
        ),
        `focus inside the drawer after Tab ${press + 1}`,
      ).toBe(true);
    }
    // Shift+Tab from the first control wraps to the last one.
    await drawer.getByRole('button', {name: 'Close'}).focus();
    await page.keyboard.press('Shift+Tab');
    expect(
      await drawer.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
    await expect(drawer.getByRole('button', {name: 'Close'})).not.toBeFocused();

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(menuButton).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  });

  test('the Close button closes it and returns focus', async ({page}) => {
    await gotoReady(page);
    const menuButton = page
      .getByRole('banner')
      .getByRole('button', {name: 'Menu'});
    const drawer = page.getByRole('dialog', {name: 'Menu'});
    await openUntilVisible(menuButton, drawer);
    await drawer.getByRole('button', {name: 'Close'}).click();
    await expect(drawer).toBeHidden();
    await expect(menuButton).toBeFocused();
  });

  test('the navigation is an accordion with the same sections as the desktop menu', async ({
    page,
  }) => {
    await gotoReady(page);
    const menuButton = page
      .getByRole('banner')
      .getByRole('button', {name: 'Menu'});
    const drawer = page.getByRole('dialog', {name: 'Menu'});
    await openUntilVisible(menuButton, drawer);

    const mattresses = drawer.getByRole('button', {name: 'Mattresses'});
    await expect(mattresses).toHaveAttribute('aria-expanded', 'false');
    await expect(
      drawer.getByRole('link', {name: 'Twin', exact: true}),
    ).toBeHidden();

    await mattresses.click();
    await expect(mattresses).toHaveAttribute('aria-expanded', 'true');
    await expect(
      drawer.getByRole('link', {name: 'Twin', exact: true}),
    ).toBeVisible();
    await expect(
      drawer.getByText('Shop by price', {exact: true}),
    ).toBeVisible();

    // Keyboard: ArrowDown moves to the next section header, Enter opens it and closes the previous one.
    await page.keyboard.press('ArrowDown');
    const foundations = drawer.getByRole('button', {
      name: 'Foundations & Bases',
    });
    await expect(foundations).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(foundations).toHaveAttribute('aria-expanded', 'true');
    await expect(mattresses).toHaveAttribute('aria-expanded', 'false');

    // Plain items are links, and the utility links and phone number are here too.
    await expect(drawer.getByRole('link', {name: 'Sale'})).toBeVisible();
    await expect(drawer.getByRole('link', {name: 'Track order'})).toBeVisible();
    await expect(
      drawer.getByRole('link', {name: /555-0100 \(dev placeholder\)/}),
    ).toBeVisible();
  });

  test('following a link closes the drawer and navigates', async ({page}) => {
    await gotoReady(page);
    const menuButton = page
      .getByRole('banner')
      .getByRole('button', {name: 'Menu'});
    const drawer = page.getByRole('dialog', {name: 'Menu'});
    await openUntilVisible(menuButton, drawer);
    await drawer.getByRole('link', {name: 'Sale'}).click();
    await expect(page).toHaveURL(/\/collections\/sale$/);
    await expect(drawer).toBeHidden();
  });

  test('has no serious or critical accessibility violations with the drawer open', async ({
    page,
  }) => {
    await gotoReady(page);
    const menuButton = page
      .getByRole('banner')
      .getByRole('button', {name: 'Menu'});
    const drawer = page.getByRole('dialog', {name: 'Menu'});
    await openUntilVisible(menuButton, drawer);
    await drawer.getByRole('button', {name: 'Mattresses'}).click();
    await expectNoSeriousA11yViolations(page);
  });
});

test.describe('REQ-NAV-001 footer', () => {
  test('has the link groups for support, sleep guide, about and shop by size, brand, comfort, type and price', async ({
    page,
    isMobile,
  }) => {
    await gotoReady(page);
    const footer = page.getByRole('contentinfo');
    // Groups made only of fixed links are always there. "Customer support" holds only Shopify page links (its fixed
    // "Track your order" link waits for content), so it shows when the store has at least one such page and a group
    // with no link is dropped, never an empty heading (REQ-CNT-001, P6-09).
    const groups = [
      'Sleep guide',
      'About',
      'Shop by size',
      'Shop by brand',
      'Shop by comfort',
      'Shop by type',
      'Shop by price',
    ];
    for (const group of groups) {
      if (isMobile) {
        await expect(footer.getByRole('button', {name: group})).toBeVisible();
      } else {
        await expect(
          footer.getByRole('heading', {name: group, exact: true}),
        ).toBeVisible();
      }
    }
    const sizes = await footerGroupSizes(page);
    for (const [heading, count] of Object.entries(sizes)) {
      expect(
        count,
        `footer group "${heading}" has at least one link`,
      ).toBeGreaterThan(0);
    }
    // No support group means no support page link anywhere in the footer.
    if (!('Customer support' in sizes)) {
      const supportTexts = [
        'Contact us',
        'Delivery and shipping',
        'Financing',
        'Warranty and returns',
        'FAQ',
      ];
      expect(
        (await footerLinks(page)).filter((link) =>
          supportTexts.includes(link.text),
        ),
        'no support group, so no support page link',
      ).toEqual([]);
    }
  });

  test('groups collapse on a phone and open with the keyboard; on desktop every link shows', async ({
    page,
    isMobile,
  }) => {
    await gotoReady(page);
    const footer = page.getByRole('contentinfo');
    // "Sleep quiz" is a fixed link, so this holds on every store (the Shopify page links come and go with content).
    const quiz = footer.getByRole('link', {name: 'Sleep quiz'});

    if (!isMobile) {
      await expect(quiz).toBeVisible();
      await expect(footer.getByRole('link', {name: 'Queen'})).toBeVisible();
      return;
    }

    const guide = footer.getByRole('button', {name: 'Sleep guide'});
    await expect(guide).toHaveAttribute('aria-expanded', 'false');
    await expect(quiz).toBeHidden();
    await guide.focus();
    await page.keyboard.press('Enter');
    await expect(guide).toHaveAttribute('aria-expanded', 'true');
    await expect(quiz).toBeVisible();
    await page.keyboard.press('Space');
    await expect(quiz).toBeHidden();
  });

  test('a fixed footer link navigates', async ({page, isMobile}) => {
    await gotoReady(page);
    const footer = page.getByRole('contentinfo');
    if (isMobile) {
      await footer.getByRole('button', {name: 'About', exact: true}).click();
    }
    await footer.getByRole('link', {name: 'Find a store'}).click();
    await expect(page).toHaveURL(/\/stores$/);
    await expect(page.getByRole('contentinfo')).toBeVisible();
  });

  // The link to a Shopify page exists only when the page does, so which one is first depends on the store.
  test('a footer link to a Shopify page navigates to a page that renders', async ({
    page,
  }) => {
    await gotoReady(page);
    const [href] = contentHrefs(await footerLinks(page)).filter((value) =>
      value.startsWith('/pages/'),
    );
    test.skip(
      href === undefined,
      'The connected store has none of the 15 pages with content, so the footer links none (REQ-CNT-001, P6-09); the link-present case is covered by the unit tests (shell-content.test.ts, content-pages.test.ts).',
    );
    if (href === undefined) return;
    const link = page
      .getByRole('contentinfo')
      .locator(`a[href="${href}"]`)
      .first();
    await revealFooterLink(link);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.getByRole('heading', {level: 1})).toHaveCount(1);
    await expect(page.getByRole('heading', {level: 1})).not.toHaveText(
      'Page not found',
    );
    await expect(page.getByRole('contentinfo')).toBeVisible();
  });

  // Replaces the old "About us is always there" expectation. The page read is server-side, so no browser stub can
  // add or remove a page; the rule is proved against the connected store by asking the page routes (helpers/footer.ts).
  test('every Shopify-content footer link resolves, and a page that does not exist has no link', async ({
    page,
    request,
  }, info) => {
    await gotoReady(page);
    const report = await expectFooterContract(page, request);
    info.annotations.push({
      type: 'footer links shown',
      description: JSON.stringify(report.linked),
    });
    info.annotations.push({
      type: 'registry pages with no footer link',
      description: report.notLinked.join(', '),
    });
  });

  test('the legal links follow the policies and pages that exist; the (development placeholder) phone number is present', async ({
    page,
    request,
  }) => {
    await gotoReady(page);
    const footer = page.getByRole('contentinfo');
    const legal = [
      {
        name: 'Privacy policy',
        allowed: ['/policies/privacy-policy', '/pages/privacy-policy'],
      },
      {
        name: 'Terms',
        allowed: ['/policies/terms-of-service', '/pages/terms'],
      },
      {name: 'Accessibility', allowed: ['/pages/accessibility']},
    ];
    for (const {name, allowed} of legal) {
      const link = footer.getByRole('link', {name, exact: true});
      const shown = await link.count();
      const answers = await Promise.all(
        allowed.map(async (path) =>
          (await request.get(path, {maxRedirects: 0})).status(),
        ),
      );
      if (answers.every((status) => status !== 200)) {
        // Neither the policy nor a page exists: no link rather than a link that 404s.
        await expect(link, `${name}: nothing to link to`).toHaveCount(0);
        continue;
      }
      if (shown === 0) continue; // a page with no text is treated as absent
      expect(shown, `${name} is one link`).toBe(1);
      const href = (await link.getAttribute('href')) ?? '';
      expect(allowed, `${name} goes to a policy or page URL`).toContain(href);
      expect(
        (await request.get(href)).status(),
        `${name} (${href}) is not a 404 link`,
      ).toBe(200);
    }
    await expect(
      footer.getByRole('link', {name: /555-0100 \(dev placeholder\)/}),
    ).toBeVisible();
  });
});

// REQ-CNT-001 / REQ-NAV-002 (P6-09): the fixed navigation, the utility links and the footer lead only to Shopify pages and
// blogs that exist. The existence read is server-side (no browser stub), so this checks the rendered links against the
// page routes of the connected store, with the Guides menu open because its links sit in a closed panel.
test.describe('REQ-CNT-001 header, menu and footer never link to a missing Shopify page', () => {
  test('every page, policy and blog link on the home page, with the Guides menu open, answers 200', async ({
    page,
    request,
    isMobile,
  }, info) => {
    await gotoReady(page);
    if (isMobile) {
      const menuButton = page
        .getByRole('banner')
        .getByRole('button', {name: 'Menu'});
      const drawer = page.getByRole('dialog', {name: 'Menu'});
      await openUntilVisible(menuButton, drawer);
      await drawer.getByRole('button', {name: 'Guides'}).click();
    } else {
      const guides = mainNav(page).getByRole('button', {name: 'Guides'});
      await guides.focus();
      await page.keyboard.press('Enter');
      await expect(guides).toHaveAttribute('aria-expanded', 'true');
    }
    const hrefs = await page
      .locator('a[href^="/pages/"], a[href^="/policies/"], a[href^="/blogs/"]')
      .evaluateAll((links) => [
        ...new Set(links.map((link) => link.getAttribute('href') ?? '')),
      ]);
    const statuses: Record<string, number> = {};
    for (const href of hrefs) {
      statuses[href] = (await request.get(href)).status();
    }
    info.annotations.push({
      type: 'content links on the page and their status',
      description: JSON.stringify(statuses),
    });
    expect(
      Object.entries(statuses).filter(([, status]) => status !== 200),
      'content links that do not answer 200',
    ).toEqual([]);
  });
});

// Negative control for the footer contract check above: the page read is server-side, so a missing page cannot be
// staged, but the document can be rewritten in the browser. With scripts off (no hydration to undo the edit), one
// footer link to a page that answers 404 is added; the same check that passes on the real document must now fail.
test.describe('REQ-CNT-001 the footer contract check detects a dead footer link (negative control)', () => {
  test.use({javaScriptEnabled: false});

  test('a footer link to a missing page is reported', async ({
    page,
    request,
  }) => {
    await page.route(
      (url) => url.pathname === '/',
      async (route) => {
        if (route.request().resourceType() !== 'document') {
          await route.fallback();
          return;
        }
        const response = await route.fetch();
        const html = (await response.text()).replace(
          '</footer>',
          '<a href="/pages/qa-dead-link-p6-09">QA dead link</a></footer>',
        );
        await route.fulfill({response, body: html});
      },
    );
    await page.goto('/');
    const report = await checkFooterContract(page, request);
    expect(report.problems).toContain(
      'footer links /pages/qa-dead-link-p6-09 but it answers 404',
    );
  });
});

test.describe('NFR-001 no horizontal scroll', () => {
  test.skip(
    ({isMobile}) => isMobile,
    'Width is set explicitly here, so the desktop project covers every width.',
  );

  const widths = [360, 768, 1024, 1280, 1536];
  const pages = ['/', '/components', '/pages/does-not-exist'];

  for (const width of widths) {
    for (const path of pages) {
      test(`${path} at ${width} px fits the viewport`, async ({page}) => {
        await page.setViewportSize({width, height: 900});
        await gotoReady(page, path);
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        );
        expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(0);
        // Every interactive control in the header is at least 44 x 44 px (NFR-001).
        const small = await page
          .getByRole('banner')
          .locator('a:visible, button:visible')
          .evaluateAll((elements) =>
            elements
              .map((element) => {
                const box = element.getBoundingClientRect();
                return {
                  name: (element.textContent ?? '').trim().slice(0, 30),
                  width: Math.round(box.width),
                  height: Math.round(box.height),
                };
              })
              .filter((item) => item.height < 44 || item.width < 44),
          );
        expect(small, 'header controls under 44 px').toEqual([]);
      });
    }
  }
});

test.describe('NFR-003 accessibility of the shell', () => {
  test('home has no serious or critical axe violations', async ({page}) => {
    await gotoReady(page);
    await expectNoSeriousA11yViolations(page);
  });

  test('a not-found page keeps the shell, has one h1 and passes axe', async ({
    page,
  }) => {
    const response = await gotoReady(page, '/pages/does-not-exist');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('heading', {level: 1})).toHaveText(
      'Page not found',
    );
    await expect(
      page.getByRole('link', {name: 'Back to the home page'}),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('reduced motion removes animation durations', async ({page}) => {
    await page.emulateMedia({reducedMotion: 'reduce'});
    await gotoReady(page);
    const duration = await page.evaluate(() => {
      const link = document.querySelector('a');
      return link ? getComputedStyle(link).transitionDuration : '';
    });
    expect(Number.parseFloat(duration)).toBeLessThan(0.001);
  });
});
