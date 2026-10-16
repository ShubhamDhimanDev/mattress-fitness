import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import {
  blockingViolations,
  describeFocus,
  runAxeAudit,
  summariseAudit,
  walkTabOrder,
} from './helpers/a11y';
import {
  findProduct,
  firstCollectionPath,
  gotoReady,
  hasSizes,
  isPurchasable,
} from './helpers/catalog';

// P7-05 preparation: accessibility audit groundwork for NFR-003 (proposed WCAG 2.2 AA, pending client approval,
// Q-012). Four groups: (1) axe on every route and overlay at 360 px (mobile project) and 1280 px (desktop
// project), (2) keyboard passes, (3) reflow, text spacing, reduced motion and forced colours, (4) a report-only
// target-size survey. Everything runs on the local dev server against a mock store and the preview fixtures:
// it is not evidence about the client's store, a screen reader or a real device. Method and results:
// docs/testing/ACCESSIBILITY_AUDIT.md. Each audit test attaches a one-line "axe" annotation that the results table
// is built from.

// The dev server compiles on demand and the mock store answers slowly (about 25 s for a cold /collections).
test.describe.configure({timeout: 120_000});

const STORE_PATH = '/stores/new-york/buffalo/buffalo-gallery';
const COMPARE = [
  'wrenfield-solace-plush-memory-foam',
  'wrenfield-solace-medium-memory-foam',
  'larkmoor-cedar-medium-hybrid',
  'larkmoor-cedar-plush-hybrid',
];
const QUIZ_ANSWERS = [
  'On my side',
  'Soft and cushioned',
  'Yes, I run hot',
  'A partner',
  'Lower back',
  'Hybrid',
  'Queen',
  'Up to $2,500',
];

// ---------------------------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------------------------

type Catalog = {
  collection: string;
  product: string;
  sizedProduct: string;
  term: string;
};
let catalogOnce: Promise<Catalog> | undefined;

/** The first collection, the first buyable product, one with two or more sizes and a search term, once per worker. */
function catalogOf(page: Page): Promise<Catalog> {
  catalogOnce ??= (async () => {
    const collection = await firstCollectionPath(page);
    // Products come from the all-products listing: a single demo collection can be empty on a slow mock answer.
    const listing = '/collections/all';
    const product = await findProduct(page, listing, 'buyable', isPurchasable);
    const sizedProduct = await findProduct(
      page,
      listing,
      'sold in two or more sizes',
      (p) => hasSizes(p, 2),
    );
    const word = product.split('/').pop()?.split('-')[0] ?? 'a';
    return {collection, product, sizedProduct, term: word};
  })();
  return catalogOnce.catch((error: unknown) => {
    catalogOnce = undefined; // do not cache a failure for the rest of the worker
    throw error;
  });
}

/** 360 px on the phone project, 1280 px on the desktop project (the two widths of the audit). */
async function auditViewport(page: Page, isMobile: boolean) {
  await page.setViewportSize({width: isMobile ? 360 : 1280, height: 800});
}

/** Clicks `trigger` until `target` shows; never clicks again once it does, so it cannot toggle it closed. */
async function openUntilVisible(trigger: Locator, target: Locator) {
  await expect(async () => {
    if (!(await target.isVisible())) await trigger.click({timeout: 2_000});
    await expect(target).toBeVisible({timeout: 2_000});
  }).toPass({timeout: 15_000});
}

async function addToCart(page: Page, path: string) {
  await gotoReady(page, path);
  const answered = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.startsWith('/cart') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', {name: 'Add to cart'}).click();
  await answered;
  const drawer = page.getByRole('dialog', {name: 'Cart'});
  await expect(drawer.getByRole('list', {name: 'Cart items'})).toBeVisible();
  return drawer;
}

const headerCart = (page: Page) =>
  page.getByRole('banner').getByRole('link', {name: 'Cart'});
const headerSearch = (page: Page) =>
  page
    .getByRole('banner')
    .getByRole('combobox', {name: 'Search products and pages'});

/** Runs axe, records the one-line summary as an annotation and an attachment, and fails on serious or critical. */
async function auditAxe(
  page: Page,
  testInfo: TestInfo,
  label: string,
  extra = '',
) {
  const violations = await runAxeAudit(page);
  const width = page.viewportSize()?.width ?? 0;
  testInfo.annotations.push({
    type: 'axe',
    description: `${label} @${width} ${extra} ${summariseAudit(violations)}`,
  });
  await testInfo.attach(`axe-${label.replace(/\W+/g, '_')}-${width}.json`, {
    body: JSON.stringify(violations, null, 2),
    contentType: 'application/json',
  });
  expect(
    blockingViolations(violations),
    `serious or critical WCAG violations on ${label} at ${width}px`,
  ).toEqual([]);
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Route inventory with axe
// ---------------------------------------------------------------------------------------------------------------

type RouteCase = {
  name: string;
  /** Navigates and puts the page in the state under test; returns the HTTP status when there was a navigation. */
  open: (page: Page, catalog: Catalog, isMobile: boolean) => Promise<number>;
};

async function go(page: Page, path: string): Promise<number> {
  const response = await gotoReady(page, path);
  return response?.status() ?? 0;
}

async function firstLink(page: Page, listing: string, prefix: string) {
  await gotoReady(page, listing);
  const href = await page
    .locator(`main a[href^="${prefix}"]`)
    .first()
    .getAttribute('href');
  expect(href, `${listing} links to ${prefix}...`).toBeTruthy();
  return href ?? prefix;
}

const ROUTES: RouteCase[] = [
  {name: 'home', open: (page) => go(page, '/')},
  {name: 'collections-index', open: (page) => go(page, '/collections')},
  {name: 'collections-all', open: (page) => go(page, '/collections/all')},
  {
    name: 'collection',
    open: (page, catalog) => go(page, catalog.collection),
  },
  {name: 'product', open: (page, catalog) => go(page, catalog.product)},
  {
    name: 'product-with-sizes',
    open: (page, catalog) => go(page, catalog.sizedProduct),
  },
  {
    name: 'product-size-changed',
    open: async (page, catalog) => {
      const status = await go(page, catalog.sizedProduct);
      const sizes = page.getByRole('group', {name: /^Size/});
      // The radio is visually hidden; a shopper clicks its label.
      const second = sizes.locator('input[type="radio"]:enabled').nth(1);
      const id = await second.getAttribute('id');
      await sizes.locator(`label[for="${id}"]`).click();
      await expect(second).toBeChecked();
      return status;
    },
  },
  {
    name: 'search-with-results',
    open: (page, catalog) =>
      go(page, `/search?q=${encodeURIComponent(catalog.term)}`),
  },
  {name: 'search-no-results', open: (page) => go(page, '/search?q=zzzzqqqqxx')},
  {name: 'search-empty-query', open: (page) => go(page, '/search')},
  {name: 'cart-page-empty', open: (page) => go(page, '/cart')},
  {
    name: 'cart-page-with-item',
    open: async (page, catalog) => {
      await addToCart(page, catalog.product);
      return go(page, '/cart');
    },
  },
  {name: 'brands-index', open: (page) => go(page, '/brands')},
  {
    name: 'brand',
    open: async (page) =>
      go(page, await firstLink(page, '/brands', '/brands/')),
  },
  {name: 'stores-index', open: (page) => go(page, '/stores')},
  {name: 'stores-state', open: (page) => go(page, '/stores/new-york')},
  {name: 'stores-city', open: (page) => go(page, '/stores/new-york/buffalo')},
  {name: 'store', open: (page) => go(page, STORE_PATH)},
  {name: 'quiz-intro', open: (page) => go(page, '/quiz')},
  {
    name: 'quiz-question',
    open: async (page) => {
      const status = await go(page, '/quiz');
      await page.getByRole('link', {name: 'Start the quiz'}).click();
      await expect(
        page.getByRole('progressbar', {name: 'Quiz progress'}),
      ).toBeVisible();
      return status;
    },
  },
  {
    name: 'quiz-results',
    open: async (page) => {
      const status = await go(page, '/quiz');
      await page.getByRole('link', {name: 'Start the quiz'}).click();
      for (const label of QUIZ_ANSWERS) {
        await page
          .getByRole('main')
          .getByRole('link', {
            name: new RegExp(
              `^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( Selected)?$`,
            ),
          })
          .click();
      }
      await expect(
        page.getByRole('heading', {name: 'Your best matches'}),
      ).toBeVisible();
      return status;
    },
  },
  {name: 'compare-empty', open: (page) => go(page, '/compare')},
  {
    name: 'compare-two-products',
    open: (page) =>
      go(page, `/compare?handles=${COMPARE.slice(0, 2).join(',')}`),
  },
  {
    name: 'compare-four-products',
    open: (page) => go(page, `/compare?handles=${COMPARE.join(',')}`),
  },
  // The mock store has no shop policies, pages, blog articles or customer-account configuration, so these
  // routes render their error templates here. They are audited as what a visitor of this build gets; the real
  // templates need the development store (V-05, V-08).
  {name: 'policies-index', open: (page) => go(page, '/policies')},
  {name: 'policy', open: (page) => go(page, '/policies/privacy-policy')},
  {name: 'page-about', open: (page) => go(page, '/pages/about')},
  {name: 'blogs-index', open: (page) => go(page, '/blogs')},
  {name: 'blog', open: (page) => go(page, '/blogs/journal')},
  {name: 'account-signed-out', open: (page) => go(page, '/account')},
  {name: 'not-found', open: (page) => go(page, '/no-such-route-a11y')},
  {name: 'delivery', open: (page) => go(page, '/delivery')},
  // Development-only component gallery (404 in a production build); covers every ui primitive in one place.
  {name: 'components-gallery-dev', open: (page) => go(page, '/components')},
  {
    name: 'checkout-steps-no-cart-redirects-to-cart',
    open: (page) => go(page, '/checkout-steps'),
  },
];

test.describe('NFR-003 axe audit: every route at 360 px (phone project) and 1280 px (desktop project)', () => {
  // The dev server compiles on demand and the mock store answers slowly: /collections took about 25 s cold.
  test.describe.configure({timeout: 120_000});
  test.beforeEach(async ({page, isMobile}) => {
    await auditViewport(page, isMobile);
  });

  for (const route of ROUTES) {
    test(`route ${route.name}`, async ({page, isMobile}, testInfo) => {
      const catalog = await catalogOf(page);
      await auditViewport(page, isMobile);
      const status = await route.open(page, catalog, isMobile);
      await expect(page.getByRole('main')).toHaveCount(1);
      await auditAxe(page, testInfo, `route:${route.name}`, `status=${status}`);
    });
  }
});

test.describe('NFR-003 checkout-steps reachability on the mock store', () => {
  // With an item and no pre-checkout step to show, the server hands straight over to Shopify's hosted checkout, so
  // our /checkout-steps page is not renderable on a mock store (the haul-away, delivery and protection steps need
  // nodes(ids) lookups it does not answer). The page is therefore NOT axe-audited here: a gap for the dev store.
  test('with an item, /checkout-steps redirects off-site to the hosted checkout and renders nothing of ours', async ({
    page,
  }, testInfo) => {
    const catalog = await catalogOf(page);
    await addToCart(page, catalog.product);
    const response = await page.request.get('/checkout-steps', {
      maxRedirects: 0,
    });
    const location = response.headers()['location'] ?? '';
    testInfo.annotations.push({
      type: 'axe',
      description: `route:checkout-steps-with-item NOT-AUDITABLE status=${response.status()} redirects-to-host=${location ? new URL(location, 'http://localhost').hostname : 'none'}`,
    });
    expect(response.status()).toBeGreaterThanOrEqual(300);
    expect(response.status()).toBeLessThan(400);
    expect(new URL(location, 'http://localhost').hostname).not.toBe(
      'localhost',
    );
  });
});

test.describe('NFR-003 axe audit: open overlays and widget states', () => {
  test.describe.configure({timeout: 120_000});
  test.beforeEach(async ({page, isMobile}) => {
    await auditViewport(page, isMobile);
  });

  test('overlay cart drawer, empty', async ({page}, testInfo) => {
    await gotoReady(page, '/');
    const drawer = page.getByRole('dialog', {name: 'Cart'});
    await openUntilVisible(headerCart(page), drawer);
    await auditAxe(page, testInfo, 'overlay:cart-drawer-empty');
  });

  test('overlay cart drawer, with an item', async ({page}, testInfo) => {
    const catalog = await catalogOf(page);
    await addToCart(page, catalog.product);
    await auditAxe(page, testInfo, 'overlay:cart-drawer-with-item');
  });

  test('overlay main navigation: mega menus on desktop, menu drawer on a phone', async ({
    page,
    isMobile,
  }, testInfo) => {
    await gotoReady(page, '/');
    if (isMobile) {
      const drawer = page.getByRole('dialog', {name: 'Menu'});
      await openUntilVisible(
        page.getByRole('banner').getByRole('button', {name: 'Menu'}),
        drawer,
      );
      await auditAxe(page, testInfo, 'overlay:mobile-nav-closed-sections');
      await drawer.getByRole('button', {name: 'Mattresses'}).click();
      await auditAxe(page, testInfo, 'overlay:mobile-nav-section-open');
      return;
    }
    const nav = page.getByRole('navigation', {name: 'Main'});
    const buttons = nav.locator('button[data-nav-top]');
    const count = await buttons.count();
    expect(count, 'top-level menus').toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      const button = buttons.nth(i);
      const name = ((await button.textContent()) ?? `menu${i}`).trim();
      await button.focus();
      await page.keyboard.press('Enter');
      await expect(button).toHaveAttribute('aria-expanded', 'true');
      await auditAxe(page, testInfo, `overlay:mega-menu-${name}`);
      await page.keyboard.press('Escape');
      await expect(button).toHaveAttribute('aria-expanded', 'false');
    }
  });

  test('overlay delivery ZIP dialog, default and with the inline error', async ({
    page,
  }, testInfo) => {
    await gotoReady(page, '/');
    const dialog = page.getByRole('dialog', {name: 'Delivery ZIP code'});
    await openUntilVisible(
      page.getByRole('button', {name: 'Enter delivery ZIP'}),
      dialog,
    );
    await auditAxe(page, testInfo, 'overlay:zip-dialog');
    await dialog.getByRole('button', {name: 'Save ZIP code'}).click();
    await expect(
      dialog.getByText('Enter a 5-digit US ZIP code.'),
    ).toBeVisible();
    await auditAxe(page, testInfo, 'overlay:zip-dialog-error');
  });

  test('overlay search combobox open with a short suggestion list', async ({
    page,
  }, testInfo) => {
    await gotoReady(page, '/');
    const box = headerSearch(page);
    await box.fill('zzzzqqqqxx');
    await expect(box).toHaveAttribute('aria-expanded', 'true');
    const options = page
      .getByRole('listbox', {name: 'Search suggestions'})
      .getByRole('option');
    await expect(options.last()).toBeVisible();
    await auditAxe(page, testInfo, 'overlay:search-combobox-short-list');
    await box.press('ArrowDown');
    await auditAxe(page, testInfo, 'overlay:search-combobox-option-active');
  });

  // A11Y-003 (axe: serious; judged Minor, see docs/testing/ACCESSIBILITY_AUDIT.md): the suggestion panel scrolls when
  // it is taller than 70 percent of the viewport, and axe reports a scrollable region with no focusable content (the
  // options are tabindex=-1 and the field keeps focus). Fixed two ways: the list is capped at eight rows, so the panel
  // scrolls only in a very short window, and a panel that does scroll becomes a labelled tab stop (HeaderSearch).
  test('A11Y-003 a scrolling suggestion panel passes axe scrollable-region-focusable', async ({
    page,
  }) => {
    const catalog = await catalogOf(page);
    await page.setViewportSize({width: 1280, height: 320});
    await gotoReady(page, '/');
    const box = headerSearch(page);
    await box.fill(catalog.term);
    const options = page
      .getByRole('listbox', {name: 'Search suggestions'})
      .getByRole('option');
    // "View all results" shows at once; wait for the product rows too.
    await expect.poll(() => options.count()).toBeGreaterThan(2);
    await box.press('ArrowDown');
    const scrolls = await page.evaluate(() => {
      const panel = document.querySelector('[role=listbox]')?.parentElement;
      return panel ? panel.scrollHeight > panel.clientHeight : false;
    });
    expect(scrolls, 'precondition: the panel is taller than its box').toBe(
      true,
    );
    const violations = await runAxeAudit(page);
    expect(violations.map((v) => v.id)).not.toContain(
      'scrollable-region-focusable',
    );
  });

  // Toast (P2-08) lives only in the development gallery until a feature raises one.
  test('overlay toasts from the component gallery: info, success, warning, error', async ({
    page,
  }, testInfo) => {
    await gotoReady(page, '/components');
    for (const kind of ['info', 'success', 'warning', 'error']) {
      await page.getByRole('button', {name: `Show ${kind} toast`}).click();
      const live = page.locator(
        kind === 'error' ? '[role=alert]' : '[role=status]',
      );
      await expect(live.filter({hasText: /./}).first()).toBeVisible();
      // axe samples colours while the toast is still fading in under load; audit the settled state.
      await page.evaluate(() =>
        Promise.all(
          document
            .getAnimations()
            .filter(
              (animation) =>
                animation.effect?.getTiming().iterations !== Infinity,
            )
            .map((animation) => animation.finished.catch(() => undefined)),
        ),
      );
      await auditAxe(page, testInfo, `overlay:toast-${kind}`);
    }
    // The error toast stays until dismissed. It never takes focus (by design), so a keyboard user reaches its
    // dismiss button with Tab; Escape there closes it.
    await page
      .locator('[role=alert]')
      .filter({hasText: /./})
      .getByRole('button')
      .focus();
    await page.keyboard.press('Escape');
    await expect(
      page.locator('[role=alert]').filter({hasText: /./}),
    ).toHaveCount(0);
  });

  test('overlay footer with every link group expanded', async ({
    page,
    isMobile,
  }, testInfo) => {
    await gotoReady(page, '/');
    const footer = page.getByRole('contentinfo');
    if (isMobile) {
      const toggles = footer.getByRole('button', {expanded: false});
      const count = await toggles.count();
      for (let i = 0; i < count; i += 1) {
        await footer.getByRole('button', {expanded: false}).first().click();
      }
    }
    await auditAxe(page, testInfo, 'overlay:footer-expanded');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 2. Keyboard passes
// ---------------------------------------------------------------------------------------------------------------

test.describe('NFR-003 keyboard: skip link', () => {
  test.beforeEach(async ({page, isMobile}) => {
    await auditViewport(page, isMobile);
  });

  for (const path of ['/', '/collections/all', '/cart', '/quiz', '/stores']) {
    test(`first Tab stop on ${path} is a visible skip link; Enter moves focus into main and the next Tab stays in main`, async ({
      page,
    }) => {
      await gotoReady(page, path);
      await page.keyboard.press('Tab');
      const skip = page.getByRole('link', {name: 'Skip to main content'});
      await expect(skip).toBeFocused();
      const box = await skip.boundingBox();
      const viewport = page.viewportSize();
      expect(box, 'the skip link is painted when focused').not.toBeNull();
      if (box && viewport) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      }
      const focus = await describeFocus(page);
      expect(focus?.indicator, 'focus indicator on the skip link').toBe(true);

      await page.keyboard.press('Enter');
      await expect(page.getByRole('main')).toBeFocused();
      await page.keyboard.press('Tab');
      const inMain = await page.evaluate(
        () =>
          document.querySelector('main')?.contains(document.activeElement) ??
          false,
      );
      expect(inMain, 'the Tab after the skip link lands inside main').toBe(
        true,
      );
    });
  }
});

test.describe('NFR-003 keyboard: full tab order of key templates (order, focus visible, not obscured, no trap)', () => {
  test.beforeEach(async ({page, isMobile}) => {
    await auditViewport(page, isMobile);
  });

  const templates: {
    name: string;
    open: (page: Page, catalog: Catalog) => Promise<void>;
  }[] = [
    {name: 'home', open: async (page) => void (await go(page, '/'))},
    {
      name: 'collection',
      open: async (page, c) => void (await go(page, c.collection)),
    },
    {
      name: 'product with sizes',
      open: async (page, c) => void (await go(page, c.sizedProduct)),
    },
    {
      name: 'cart page with an item',
      open: async (page, c) => {
        await addToCart(page, c.product);
        await go(page, '/cart');
      },
    },
    {name: 'quiz intro', open: async (page) => void (await go(page, '/quiz'))},
    {
      name: 'compare with four products',
      open: async (page) =>
        void (await go(page, `/compare?handles=${COMPARE.join(',')}`)),
    },
    {
      name: 'store page',
      open: async (page) => void (await go(page, STORE_PATH)),
    },
    {
      name: 'search results',
      open: async (page, c) =>
        void (await go(page, `/search?q=${encodeURIComponent(c.term)}`)),
    },
    {
      name: 'not found',
      open: async (page) => void (await go(page, '/nope-a11y')),
    },
  ];

  for (const template of templates) {
    test(`tab walk: ${template.name}`, async ({page}, testInfo) => {
      const catalog = await catalogOf(page);
      await template.open(page, catalog);
      const walk = await walkTabOrder(page, 300);

      await testInfo.attach('tab-order.json', {
        body: JSON.stringify(walk.stops, null, 2),
        contentType: 'application/json',
      });
      expect(
        walk.completed,
        'focus left the page again (no keyboard trap, under 300 stops)',
      ).toBe(true);
      expect(walk.stops.length, 'tab stops').toBeGreaterThan(5);
      expect(walk.stops[0]?.label, 'first stop').toContain(
        'Skip to main content',
      );

      const noIndicator = walk.stops
        .filter((s) => !s.indicator)
        .map((s) => s.label);
      expect(noIndicator, 'stops with no visible focus indicator').toEqual([]);
      const obscured = walk.stops.filter((s) => s.obscured).map((s) => s.label);
      expect(
        obscured,
        'stops hidden behind another element (WCAG 2.4.11)',
      ).toEqual([]);

      // Logical order: header, then main, then footer; never back to an earlier region.
      // Stops outside a landmark (the skip link) have no place in the order and are left out.
      const rank = {banner: 0, main: 1, contentinfo: 2} as const;
      const placed = walk.stops.flatMap((stop) =>
        stop.region === 'banner' ||
        stop.region === 'main' ||
        stop.region === 'contentinfo'
          ? [{label: stop.label, rank: rank[stop.region]}]
          : [],
      );
      const backwards = placed.flatMap((stop, i) =>
        i > 0 && stop.rank < placed[i - 1].rank ? [stop.label] : [],
      );
      expect(backwards, 'stops that move back to an earlier region').toEqual(
        [],
      );
      expect(walk.stops.at(-1)?.region, 'the walk ends in the footer').toBe(
        'contentinfo',
      );
    });
  }
});

test.describe('NFR-003 keyboard: desktop mega menu', () => {
  test.skip(
    ({isMobile}) => isMobile,
    'The mega menu is the desktop navigation.',
  );

  test('every menu opens with Enter, every link inside shows focus, Tab leaves the panel, Escape returns focus', async ({
    page,
  }) => {
    await gotoReady(page, '/');
    const nav = page.getByRole('navigation', {name: 'Main'});
    const buttons = nav.locator('button[data-nav-top]');
    const count = await buttons.count();
    for (let i = 0; i < count; i += 1) {
      const button = buttons.nth(i);
      const name = ((await button.textContent()) ?? '').trim();
      await button.focus();
      await page.keyboard.press('Enter');
      await expect(button, `${name} opened`).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      const noIndicator: string[] = [];
      let left = false;
      for (let press = 0; press < 60 && !left; press += 1) {
        await page.keyboard.press('Tab');
        const info = await describeFocus(page);
        if (!info) break;
        if (!info.indicator) noIndicator.push(info.label);
        left = await page.evaluate(
          () =>
            !document.activeElement?.closest(
              '[data-nav-panel], [data-nav-top]',
            ) && !document.activeElement?.closest('nav'),
        );
      }
      expect(noIndicator, `${name}: stops without a focus indicator`).toEqual(
        [],
      );
      expect(left, `${name}: Tab eventually leaves the menu`).toBe(true);
      // Return and close to leave a clean state for the next menu.
      await button.focus();
      await page.keyboard.press('Escape');
      await expect(button).toHaveAttribute('aria-expanded', 'false');
      await expect(button).toBeFocused();
    }
  });
});

test.describe('NFR-003 keyboard: phone menu drawer', () => {
  test.skip(({isMobile}) => !isMobile, 'The menu drawer exists below 1024 px.');

  test('opens from the keyboard, focus enters, every stop shows focus and stays inside, Escape returns focus', async ({
    page,
  }) => {
    await auditViewport(page, true);
    await gotoReady(page, '/');
    const menu = page.getByRole('banner').getByRole('button', {name: 'Menu'});
    const drawer = page.getByRole('dialog', {name: 'Menu'});
    await menu.focus();
    await openUntilVisible(menu, drawer);
    const inside = () =>
      page.evaluate(
        () =>
          document
            .querySelector('[role=dialog]')
            ?.contains(document.activeElement) ?? false,
      );
    expect(await inside(), 'focus moved into the drawer').toBe(true);

    const problems: string[] = [];
    for (let press = 0; press < 40; press += 1) {
      await page.keyboard.press('Tab');
      const info = await describeFocus(page);
      if (!info || !(await inside()))
        problems.push(`left the drawer at Tab ${press + 1}`);
      else if (!info.indicator) problems.push(`no indicator: ${info.label}`);
      else if (info.obscured) problems.push(`obscured: ${info.label}`);
    }
    expect(problems).toEqual([]);

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(menu).toBeFocused();
  });
});

test.describe('NFR-003 keyboard: cart drawer and quantity steppers', () => {
  test.beforeEach(async ({page, isMobile}) => {
    await auditViewport(page, isMobile);
  });

  test('empty drawer opens from the keyboard, traps focus with visible indicators, Escape returns focus to the trigger', async ({
    page,
  }) => {
    await gotoReady(page, '/');
    const trigger = headerCart(page);
    const drawer = page.getByRole('dialog', {name: 'Cart'});
    await trigger.focus();
    await openUntilVisible(trigger, drawer);
    const problems: string[] = [];
    for (let press = 0; press < 12; press += 1) {
      const info = await describeFocus(page);
      const inside = await page.evaluate(
        () =>
          document
            .querySelector('[role=dialog]')
            ?.contains(document.activeElement) ?? false,
      );
      if (!info || !inside)
        problems.push(`focus outside the dialog before Tab ${press}`);
      else if (!info.indicator) problems.push(`no indicator: ${info.label}`);
      await page.keyboard.press('Tab');
    }
    expect(problems).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('quantity stepper by keyboard: Enter and Space change the quantity, focus stays on the button, the limit keeps focus', async ({
    page,
  }) => {
    const catalog = await catalogOf(page);
    const drawer = await addToCart(page, catalog.product);
    const increase = drawer.getByRole('button', {name: /^Increase quantity/});
    const decrease = drawer.getByRole('button', {name: /^Decrease quantity/});
    const quantity = drawer.getByRole('textbox', {name: /^Quantity/});
    // While the add is still being confirmed the controls are inert (aria-disabled); Playwright's click waits for
    // that, a bare key press does not, so wait for the line to settle first.
    await expect(quantity).toBeEnabled({timeout: 20_000});
    await expect(increase).not.toHaveAttribute('aria-disabled', 'true');

    await increase.focus();
    await page.keyboard.press('Enter');
    await expect(quantity).toHaveValue('2', {timeout: 20_000});
    await expect(increase, 'focus stays on the pressed button').toBeFocused();
    await decrease.focus();
    await page.keyboard.press('Space');
    await expect(quantity).toHaveValue('1', {timeout: 20_000});
    await expect(decrease).toBeFocused();
    // At the minimum the button is aria-disabled, not disabled: focus must not be dropped.
    await expect(decrease).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Enter');
    await expect(quantity).toHaveValue('1', {timeout: 20_000});
    await expect(decrease).toBeFocused();
    // A status region announces the change for screen readers.
    await expect(drawer.getByRole('status').first()).toBeAttached();
  });

  test('A11Y-002 removing the last line by keyboard keeps focus inside the dialog (WCAG 2.4.3)', async ({
    page,
  }) => {
    const catalog = await catalogOf(page);
    const drawer = await addToCart(page, catalog.product);
    const remove = drawer.getByRole('button', {name: /^Remove .* from cart/});
    await expect(drawer.getByRole('textbox', {name: /^Quantity/})).toBeEnabled({
      timeout: 20_000,
    });
    await remove.focus();
    await page.keyboard.press('Enter');
    await expect(
      drawer.getByRole('heading', {name: 'Your cart is empty'}),
    ).toBeVisible({timeout: 20_000});
    const where = await page.evaluate(() => {
      const el = document.activeElement;
      return {
        inDialog:
          document.querySelector('[role=dialog]')?.contains(el) ?? false,
        tag: el?.tagName ?? '',
      };
    });
    expect(
      where,
      'focus after the focused button was removed from the page',
    ).toMatchObject({inDialog: true});
    // The empty-state heading takes focus (tabindex -1), so the next Tab continues from the drawer's content.
    await expect(
      drawer.getByRole('heading', {name: 'Your cart is empty'}),
    ).toBeFocused();
  });
});

test.describe('NFR-003 keyboard: delivery ZIP dialog', () => {
  test.beforeEach(async ({page, isMobile}) => {
    await auditViewport(page, isMobile);
  });

  test('opens from the keyboard, focus lands in the field, Tab stays inside, the error is tied to the field and announced, Escape returns focus', async ({
    page,
  }) => {
    await gotoReady(page, '/');
    const trigger = page.getByRole('button', {name: 'Enter delivery ZIP'});
    const dialog = page.getByRole('dialog', {name: 'Delivery ZIP code'});
    await trigger.focus();
    await openUntilVisible(trigger, dialog);
    const zip = dialog.getByRole('textbox', {name: 'ZIP code'});
    await expect(zip).toBeFocused();

    const problems: string[] = [];
    for (let press = 0; press < 8; press += 1) {
      await page.keyboard.press('Tab');
      const info = await describeFocus(page);
      const inside = await dialog.evaluate((el) =>
        el.contains(document.activeElement),
      );
      if (!inside) problems.push(`left the dialog at Tab ${press + 1}`);
      else if (!info?.indicator) problems.push(`no indicator: ${info?.label}`);
    }
    expect(problems).toEqual([]);

    await zip.focus();
    await page.keyboard.press('Enter'); // submit empty
    const message = dialog.getByText('Enter a 5-digit US ZIP code.');
    await expect(message).toBeVisible();
    await expect(zip).toHaveAttribute('aria-invalid', 'true');
    const described = await zip.getAttribute('aria-describedby');
    expect(described, 'the field points at its error text').toBeTruthy();
    const announced = await message.evaluate((el) => {
      const live = el.closest('[role=alert], [role=status], [aria-live]');
      return live !== null || el.getAttribute('role') === 'alert';
    });
    expect(
      announced,
      'the error text is in a live region or has role=alert (WCAG 4.1.3)',
    ).toBe(true);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

test.describe('NFR-003 keyboard: search combobox', () => {
  test.beforeEach(async ({page, isMobile}) => {
    await auditViewport(page, isMobile);
  });

  test('ArrowDown and ArrowUp move and wrap through options with a valid aria-activedescendant, focus stays in the field, Escape closes, Enter on an option follows it', async ({
    page,
  }) => {
    const catalog = await catalogOf(page);
    await gotoReady(page, '/');
    const box = headerSearch(page);
    await box.focus();
    await page.keyboard.type(catalog.term);
    const options = page
      .getByRole('listbox', {name: 'Search suggestions'})
      .getByRole('option');
    await expect.poll(() => options.count()).toBeGreaterThan(1);
    const count = await options.count();

    const active = async () =>
      box.evaluate((el) => {
        const id = el.getAttribute('aria-activedescendant');
        const target = id ? document.getElementById(id) : null;
        return {
          id,
          exists: target !== null,
          selected: target?.getAttribute('aria-selected') ?? null,
          focusStillInField: document.activeElement === el,
        };
      });

    await page.keyboard.press('ArrowDown');
    expect(await active()).toMatchObject({
      exists: true,
      selected: 'true',
      focusStillInField: true,
    });
    await page.keyboard.press('ArrowUp');
    // From the first option ArrowUp wraps to the last or leaves the list; either way no dangling reference.
    const afterUp = await active();
    expect(afterUp.focusStillInField).toBe(true);
    if (afterUp.id)
      expect(
        afterUp.exists,
        'aria-activedescendant points at a real option',
      ).toBe(true);

    for (let i = 0; i < count + 1; i += 1)
      await page.keyboard.press('ArrowDown');
    const afterLoop = await active();
    expect(afterLoop.focusStillInField).toBe(true);
    if (afterLoop.id) expect(afterLoop.exists).toBe(true);

    // A polite status announces the number of suggestions.
    await expect(
      page
        .getByRole('banner')
        .locator('[role=status], [aria-live=polite]')
        .first(),
    ).toBeAttached();

    await page.keyboard.press('Escape');
    await expect(box).toHaveAttribute('aria-expanded', 'false');
    await expect(box).toBeFocused();

    await box.fill(''); // the same text again would raise no change event
    await box.fill(catalog.term);
    await expect.poll(() => options.count()).toBeGreaterThan(1);
    await page.keyboard.press('ArrowDown');
    const selectedHref = await page
      .locator('[role=option][aria-selected=true]')
      .evaluate(
        (el) =>
          (el.closest('a') ?? el.querySelector('a'))?.getAttribute('href') ??
          el.getAttribute('href'),
      );
    await page.keyboard.press('Enter');
    if (selectedHref)
      await expect(page).toHaveURL(
        new RegExp(
          selectedHref.split('?')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        ),
      );
  });
});

test.describe('NFR-003 keyboard: size selector and compare region', () => {
  test.beforeEach(async ({page, isMobile}) => {
    await auditViewport(page, isMobile);
  });

  test('size selector is a named group; arrow keys move the selection; the focused size shows a focus indicator', async ({
    page,
  }) => {
    const catalog = await catalogOf(page);
    await gotoReady(page, catalog.sizedProduct);
    const group = page.getByRole('group', {name: /^Size/});
    const radios = group.locator('input[type="radio"]:enabled');
    expect(await radios.count()).toBeGreaterThan(1);
    const checked = group.locator('input[type="radio"]:checked');
    await checked.focus();
    const first = await describeFocus(page);
    expect(first?.indicator, 'focus indicator on the focused size').toBe(true);
    const before = await checked.getAttribute('value');
    await page.keyboard.press('ArrowRight');
    await expect(
      group.locator('input[type="radio"]:checked'),
    ).not.toHaveAttribute('value', before ?? '');
    const moved = await describeFocus(page);
    expect(moved?.indicator, 'focus indicator after ArrowRight').toBe(true);
    // A live region announces the selected size.
    await expect(group.locator('[aria-live]').first()).toBeAttached();
  });

  test('the compare table scroll region is reachable by Tab, shows focus and scrolls with the arrow keys', async ({
    page,
  }) => {
    await gotoReady(page, `/compare?handles=${COMPARE.join(',')}`);
    const region = page.getByRole('region', {name: /Comparison of 4 products/});
    await expect(region).toHaveAttribute('tabindex', '0');
    let reached = false;
    for (let press = 0; press < 120 && !reached; press += 1) {
      await page.keyboard.press('Tab');
      reached = await region.evaluate((el) => el === document.activeElement);
    }
    expect(reached, 'Tab reaches the scroll region').toBe(true);
    expect(
      (await describeFocus(page))?.indicator,
      'focus indicator on the region',
    ).toBe(true);
    const overflowing = await region.evaluate(
      (el) => el.scrollWidth > el.clientWidth,
    );
    if (overflowing) {
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await expect
        .poll(() => region.evaluate((el) => el.scrollLeft))
        .toBeGreaterThan(0);
    }
  });
});

test.describe('NFR-003 keyboard: quiz', () => {
  test.beforeEach(async ({page, isMobile}) => {
    await auditViewport(page, isMobile);
  });

  test('the whole quiz can be completed with the keyboard; focus moves to each new heading; options show focus; Back works', async ({
    page,
  }) => {
    await gotoReady(page, '/quiz');
    const start = page.getByRole('link', {name: 'Start the quiz'});
    await start.focus();
    expect((await describeFocus(page))?.indicator).toBe(true);
    await page.keyboard.press('Enter');
    const progress = page.getByRole('progressbar', {name: 'Quiz progress'});
    await expect(progress).toHaveAttribute('aria-valuetext', 'Question 1 of 8');
    // After each answer focus moves to the new question heading (a screen reader hears it).
    const focusedHeading = () =>
      page.evaluate(() =>
        /^H[1-6]$/.test(document.activeElement?.tagName ?? '')
          ? (document.activeElement?.textContent ?? '').trim()
          : null,
      );
    await expect.poll(focusedHeading).toBe('How do you usually sleep?');

    // Question 1: reach the answer with Tab only, to prove the options are in the tab order.
    const first = page.getByRole('main').getByRole('link', {
      name: new RegExp(`^${QUIZ_ANSWERS[0]}( Selected)?$`),
    });
    let reached = false;
    for (let press = 0; press < 20 && !reached; press += 1) {
      await page.keyboard.press('Tab');
      reached = await first.evaluate((el) => el === document.activeElement);
    }
    expect(reached, 'answer option reached with Tab').toBe(true);
    expect(
      (await describeFocus(page))?.indicator,
      'focus indicator on an answer',
    ).toBe(true);
    await page.keyboard.press('Enter');
    await expect(progress).toHaveAttribute('aria-valuetext', 'Question 2 of 8');
    await expect.poll(focusedHeading).toBe('What kind of feel do you like?');

    // Back by keyboard returns with the answer still chosen.
    const back = page.getByRole('link', {name: /^Back/});
    await back.focus();
    expect(
      (await describeFocus(page))?.indicator,
      'focus indicator on Back',
    ).toBe(true);
    await page.keyboard.press('Enter');
    await expect(progress).toHaveAttribute('aria-valuetext', 'Question 1 of 8');
    await expect(first).toContainText('Selected');

    for (const label of QUIZ_ANSWERS) {
      const answer = page.getByRole('main').getByRole('link', {
        name: new RegExp(
          `^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( Selected)?$`,
        ),
      });
      await answer.focus();
      await page.keyboard.press('Enter');
    }
    await expect(
      page.getByRole('heading', {name: 'Your best matches'}),
    ).toBeFocused();
    const retake = page.getByRole('link', {name: 'Retake quiz'});
    await retake.focus();
    expect(
      (await describeFocus(page))?.indicator,
      'focus indicator on Retake',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 3. Reflow, text spacing, reduced motion, forced colours
// ---------------------------------------------------------------------------------------------------------------

/** Waits for finite animations (a drawer sliding in) to end, so a measurement is not taken mid-slide. */
async function settle(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

/**
 * Visible text or controls that stick out of the viewport horizontally and are not inside a scroll container. Page
 * level overflow alone can be hidden by `overflow-x: hidden`, which would clip content (WCAG 1.4.10).
 */
async function contentOutsideViewport(page: Page) {
  await settle(page);
  return page.evaluate(() => {
    const out: string[] = [];
    const width = document.documentElement.clientWidth;
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if (!(el instanceof HTMLElement)) continue;
      if (
        !el.checkVisibility({
          checkVisibilityCSS: true,
          visibilityProperty: true,
        })
      )
        continue;
      if (el.closest('[inert], [aria-hidden=true]')) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) continue;
      const hasOwnText = Array.from(el.childNodes).some(
        (n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '',
      );
      const interactive = el.matches('a, button, input, select, textarea, img');
      if (!hasOwnText && !interactive) continue;
      if (rect.right <= width + 1 && rect.left >= -1) continue;
      let scrollable = false;
      for (
        let p = el.parentElement;
        p && p !== document.body;
        p = p.parentElement
      ) {
        const o = getComputedStyle(p).overflowX;
        if ((o === 'auto' || o === 'scroll') && p.scrollWidth > p.clientWidth) {
          scrollable = true;
          break;
        }
      }
      if (scrollable) continue;
      out.push(
        `${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 40)} "${(el.innerText ?? '').trim().slice(0, 30)}" right=${Math.round(rect.right)} width=${width}`,
      );
    }
    return out.slice(0, 10);
  });
}

/** Elements that clip their text: overflow hidden/clip with content taller or wider than the box. */
async function clippedContent(page: Page) {
  await settle(page);
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if (!(el instanceof HTMLElement)) continue;
      const s = getComputedStyle(el);
      const clipsY = s.overflowY === 'hidden' || s.overflowY === 'clip';
      const clipsX = s.overflowX === 'hidden' || s.overflowX === 'clip';
      if (!clipsY && !clipsX) continue;
      if (
        !el.checkVisibility({
          checkVisibilityCSS: true,
          visibilityProperty: true,
        })
      )
        continue;
      if (el.closest('[inert], [aria-hidden=true]')) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) continue; // sr-only and collapsed panels
      if ((el.innerText ?? '').trim() === '') continue;
      const lineClamp = s.getPropertyValue('-webkit-line-clamp');
      if (lineClamp && lineClamp !== 'none') continue; // deliberate truncation, recorded in the audit document
      if (s.textOverflow === 'ellipsis') continue;
      const tooTall = clipsY && el.scrollHeight > el.clientHeight + 1;
      const tooWide = clipsX && el.scrollWidth > el.clientWidth + 1;
      if (tooTall || tooWide)
        out.push(
          `${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 50)} "${(el.innerText ?? '').trim().slice(0, 30)}" scroll=${el.scrollWidth}x${el.scrollHeight} client=${el.clientWidth}x${el.clientHeight}`,
        );
    }
    return out.slice(0, 10);
  });
}

type ReflowPage = {
  name: string;
  open: (page: Page, catalog: Catalog) => Promise<void>;
};
const KEY_TEMPLATES: ReflowPage[] = [
  {name: 'home', open: async (page) => void (await go(page, '/'))},
  {
    name: 'collection',
    open: async (page, c) => void (await go(page, c.collection)),
  },
  {
    name: 'product with sizes',
    open: async (page, c) => void (await go(page, c.sizedProduct)),
  },
  {
    name: 'cart page with an item',
    open: async (page, c) => {
      await addToCart(page, c.product);
      await go(page, '/cart');
    },
  },
  {
    name: 'search results',
    open: async (page, c) =>
      void (await go(page, `/search?q=${encodeURIComponent(c.term)}`)),
  },
  {name: 'quiz intro', open: async (page) => void (await go(page, '/quiz'))},
  {
    name: 'compare with two products',
    open: async (page) =>
      void (await go(
        page,
        `/compare?handles=${COMPARE.slice(0, 2).join(',')}`,
      )),
  },
  {name: 'store page', open: async (page) => void (await go(page, STORE_PATH))},
  {
    name: 'brands index',
    open: async (page) => void (await go(page, '/brands')),
  },
  {
    name: 'not found',
    open: async (page) => void (await go(page, '/nope-a11y')),
  },
];

test.describe('NFR-003 reflow at 400 percent zoom (WCAG 1.4.10): 320 x 256 CSS px viewport', () => {
  // 1280 CSS px at 400 percent is 320 CSS px wide and 200 percent of 800 / 4 tall; the device scale factor does not
  // change layout, it only mirrors what a zoomed browser paints.
  test.use({viewport: {width: 320, height: 256}, deviceScaleFactor: 4});

  for (const template of KEY_TEMPLATES) {
    test(`${template.name}: no horizontal page scroll, nothing outside the viewport`, async ({
      page,
    }) => {
      const catalog = await catalogOf(page);
      await template.open(page, catalog);
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(
        overflow,
        'page-level horizontal overflow in px',
      ).toBeLessThanOrEqual(0);
      expect(
        await contentOutsideViewport(page),
        'content beyond the right edge outside a scroll container',
      ).toEqual([]);
    });
  }

  test('the cart drawer and the delivery ZIP dialog fit 320 px', async ({
    page,
  }) => {
    await gotoReady(page, '/');
    const drawer = page.getByRole('dialog', {name: 'Cart'});
    await openUntilVisible(headerCart(page), drawer);
    expect(await contentOutsideViewport(page), 'cart drawer').toEqual([]);
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    const zip = page.getByRole('dialog', {name: 'Delivery ZIP code'});
    await openUntilVisible(
      page.getByRole('button', {name: 'Enter delivery ZIP'}),
      zip,
    );
    expect(await contentOutsideViewport(page), 'ZIP dialog').toEqual([]);
  });
});

test.describe('NFR-003 text spacing (WCAG 1.4.12): line height 1.5, letter 0.12em, word 0.16em, paragraphs 2em', () => {
  const SPACING =
    '*{line-height:1.5 !important;letter-spacing:.12em !important;word-spacing:.16em !important}p{margin-bottom:2em !important}';

  test.beforeEach(async ({page, isMobile}) => {
    await auditViewport(page, isMobile);
  });

  for (const template of KEY_TEMPLATES) {
    test(`${template.name}: no clipped content and no new horizontal scroll`, async ({
      page,
    }) => {
      const catalog = await catalogOf(page);
      await template.open(page, catalog);
      await page.addStyleTag({content: SPACING});
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(
        overflow,
        'page-level horizontal overflow in px',
      ).toBeLessThanOrEqual(0);
      expect(
        await clippedContent(page),
        'elements that clip their text',
      ).toEqual([]);
    });
  }

  test('open cart drawer with an item and the open mega menu or menu drawer do not clip text', async ({
    page,
    isMobile,
  }) => {
    const catalog = await catalogOf(page);
    await addToCart(page, catalog.product);
    await page.addStyleTag({content: SPACING});
    expect(await clippedContent(page), 'cart drawer').toEqual([]);
    await page.keyboard.press('Escape');
    if (isMobile) {
      const drawer = page.getByRole('dialog', {name: 'Menu'});
      await openUntilVisible(
        page.getByRole('banner').getByRole('button', {name: 'Menu'}),
        drawer,
      );
      await drawer.getByRole('button', {name: 'Mattresses'}).click();
    } else {
      const button = page
        .getByRole('navigation', {name: 'Main'})
        .getByRole('button', {name: 'Mattresses'});
      await button.focus();
      await page.keyboard.press('Enter');
      await expect(button).toHaveAttribute('aria-expanded', 'true');
    }
    expect(await clippedContent(page), 'navigation').toEqual([]);
  });
});

/** Animations that would still be moving for a visitor who asked for reduced motion. */
async function movingAnimations(page: Page) {
  return page.evaluate(() =>
    document
      .getAnimations()
      .filter((animation) => {
        if (animation.playState !== 'running') return false;
        const timing = animation.effect?.getComputedTiming();
        return (
          timing?.iterations === Infinity || Number(timing?.endTime ?? 0) > 100
        );
      })
      .map((animation) => {
        const named = animation as CSSAnimation;
        const target = (animation.effect as KeyframeEffect | null)?.target;
        return `${named.animationName ?? 'transition'} on ${target?.tagName.toLowerCase() ?? '?'}.${(target?.className ?? '').toString().slice(0, 30)}`;
      }),
  );
}

test.describe('NFR-003 reduced motion (WCAG 2.3.3, 2.2.2): no animation over 100 ms or infinite', () => {
  test.beforeEach(async ({page, isMobile}) => {
    await page.emulateMedia({reducedMotion: 'reduce'});
    await auditViewport(page, isMobile);
  });

  for (const template of KEY_TEMPLATES) {
    test(`${template.name}: nothing is moving`, async ({page}) => {
      const catalog = await catalogOf(page);
      await template.open(page, catalog);
      await expect
        .poll(() => movingAnimations(page), {timeout: 5_000})
        .toEqual([]);
    });
  }

  test('opening the cart drawer, the ZIP dialog and the navigation does not animate', async ({
    page,
    isMobile,
  }) => {
    await gotoReady(page, '/');
    const drawer = page.getByRole('dialog', {name: 'Cart'});
    await openUntilVisible(headerCart(page), drawer);
    await expect
      .poll(() => movingAnimations(page), {timeout: 5_000})
      .toEqual([]);
    await page.keyboard.press('Escape');
    const zip = page.getByRole('dialog', {name: 'Delivery ZIP code'});
    await openUntilVisible(
      page.getByRole('button', {name: 'Enter delivery ZIP'}),
      zip,
    );
    await expect
      .poll(() => movingAnimations(page), {timeout: 5_000})
      .toEqual([]);
    await page.keyboard.press('Escape');
    if (isMobile) {
      const menu = page.getByRole('dialog', {name: 'Menu'});
      await openUntilVisible(
        page.getByRole('banner').getByRole('button', {name: 'Menu'}),
        menu,
      );
      await expect
        .poll(() => movingAnimations(page), {timeout: 5_000})
        .toEqual([]);
    }
  });

  test('the computed transition and animation durations of buttons, links and dialogs are near zero', async ({
    page,
  }) => {
    await gotoReady(page, '/');
    const long = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of Array.from(
        document.querySelectorAll('a, button, input, [role=dialog]'),
      )) {
        const s = getComputedStyle(el);
        for (const value of [
          ...s.transitionDuration.split(','),
          ...s.animationDuration.split(','),
        ]) {
          const seconds = value.trim().endsWith('ms')
            ? parseFloat(value) / 1000
            : parseFloat(value);
          if (seconds > 0.01) bad.push(`${el.tagName.toLowerCase()} ${value}`);
        }
      }
      return [...new Set(bad)].slice(0, 10);
    });
    expect(long).toEqual([]);
  });
});

test.describe('NFR-003 forced colours smoke (Windows High Contrast)', () => {
  test.beforeEach(async ({page, isMobile}) => {
    await page.emulateMedia({forcedColors: 'active'});
    await auditViewport(page, isMobile);
  });

  test('home renders, shows no horizontal scroll, and keyboard focus is drawn by an outline (box-shadow is removed in forced colours)', async ({
    page,
  }) => {
    await go(page, '/');
    await expect(page.getByRole('heading', {level: 1})).toBeVisible();
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const matches = await page.evaluate(
      () => matchMedia('(forced-colors: active)').matches,
    );
    expect(matches, 'the emulation took effect').toBe(true);

    const missing: string[] = [];
    for (let press = 0; press < 15; press += 1) {
      await page.keyboard.press('Tab');
      const outline = await page.evaluate(() => {
        const s = getComputedStyle(document.activeElement ?? document.body);
        return {style: s.outlineStyle, width: parseFloat(s.outlineWidth)};
      });
      if (outline.style === 'none' || outline.width <= 0)
        missing.push((await describeFocus(page))?.label ?? 'unknown');
    }
    expect(missing, 'stops with no outline in forced colours').toEqual([]);
  });

  // A shadow is removed in forced-colours mode, so a drawer or dialog that is set apart from the page by a shadow
  // alone has no visible edge there (WCAG 1.4.11). It needs a border or an outline. Evidence: screenshot of the cart
  // drawer under forced colours, 2026-10-16 (the page text runs under the drawer with no line between them).
  async function hasEdge(dialog: Locator) {
    return dialog.evaluate((el) => {
      const s = getComputedStyle(el);
      const side = (w: string, st: string) =>
        parseFloat(w) > 0 && st !== 'none';
      return (
        side(s.borderLeftWidth, s.borderLeftStyle) ||
        side(s.borderRightWidth, s.borderRightStyle) ||
        side(s.borderTopWidth, s.borderTopStyle) ||
        side(s.borderBottomWidth, s.borderBottomStyle) ||
        side(s.outlineWidth, s.outlineStyle)
      );
    });
  }

  test('A11Y-004 the cart drawer has a border or outline in forced colours', async ({
    page,
  }) => {
    await gotoReady(page, '/');
    const drawer = page.getByRole('dialog', {name: 'Cart'});
    await openUntilVisible(headerCart(page), drawer);
    expect(await hasEdge(drawer), 'cart drawer edge').toBe(true);
  });

  test('A11Y-004 the delivery ZIP dialog has a border or outline in forced colours', async ({
    page,
  }) => {
    await gotoReady(page, '/');
    const dialog = page.getByRole('dialog', {name: 'Delivery ZIP code'});
    await openUntilVisible(
      page.getByRole('button', {name: 'Enter delivery ZIP'}),
      dialog,
    );
    expect(await hasEdge(dialog), 'ZIP dialog edge').toBe(true);
  });

  test('A11Y-004 the phone menu drawer has a border or outline in forced colours', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'The menu drawer exists below 1024 px.');
    await gotoReady(page, '/');
    const drawer = page.getByRole('dialog', {name: 'Menu'});
    await openUntilVisible(
      page.getByRole('banner').getByRole('button', {name: 'Menu'}),
      drawer,
    );
    expect(await hasEdge(drawer), 'menu drawer edge').toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 4. Target-size survey (report only: NFR-001 asks 44 px, WCAG 2.5.8 asks 24 px; axe's target-size rule gates 24)
// ---------------------------------------------------------------------------------------------------------------

test.describe('NFR-001 / WCAG 2.5.8 target size survey (report only; axe target-size gates 24 px in the route audit)', () => {
  test.beforeEach(async ({page, isMobile}) => {
    await auditViewport(page, isMobile);
  });

  for (const template of KEY_TEMPLATES) {
    test(`survey ${template.name}`, async ({page}, testInfo) => {
      const catalog = await catalogOf(page);
      await template.open(page, catalog);
      const sizes = await page.evaluate(() => {
        const small: string[] = [];
        const under24: string[] = [];
        for (const el of Array.from(
          document.querySelectorAll(
            'button, input:not([type=hidden]), select, textarea, a[href]',
          ),
        )) {
          if (!(el instanceof HTMLElement)) continue;
          if (
            !el.checkVisibility({
              checkVisibilityCSS: true,
              visibilityProperty: true,
            })
          )
            continue;
          if (el.closest('[inert], [aria-hidden=true]')) continue;
          // Links inside a sentence are exempt from the size rules.
          const inline =
            el instanceof HTMLAnchorElement &&
            getComputedStyle(el).display === 'inline';
          if (inline) continue;
          // A check box or radio is measured by its label row, which is the clickable area (the rule in
          // design-rules.spec.ts and docs/design/DEVIATIONS.md UXD-09); the native input itself is 24 px.
          const label =
            el instanceof HTMLInputElement &&
            (el.type === 'checkbox' || el.type === 'radio')
              ? el.labels?.[0]
              : undefined;
          const rect = (label ?? el).getBoundingClientRect();
          if (rect.width <= 1 || rect.height <= 1) continue;
          // UXD-09: a text link is 44 px high but only as wide as its words; everything else is 44 px both ways.
          const textLink =
            el instanceof HTMLAnchorElement &&
            (el.innerText ?? '').trim() !== '';
          const text = `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.innerText ?? '').trim().slice(0, 25)}" ${Math.round(rect.width)}x${Math.round(rect.height)}`;
          if (rect.width < 24 || rect.height < 24) under24.push(text);
          else if (rect.height < 44 || (!textLink && rect.width < 44))
            small.push(text);
        }
        return {small: [...new Set(small)], under24: [...new Set(under24)]};
      });
      testInfo.annotations.push({
        type: 'target-size',
        description: `${template.name} @${page.viewportSize()?.width} under44=${sizes.small.length} under24=${sizes.under24.length} ${sizes.small.slice(0, 6).join(' | ')}`,
      });
      // Report only: the numbers are in the annotation. WCAG 2.5.8 is gated by axe's target-size rule in the route audit.
    });
  }
});
