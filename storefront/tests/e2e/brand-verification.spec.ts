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
} from './helpers/a11y';
import {
  findProduct,
  firstCollectionPath,
  gotoReady,
  hasSizes,
  isPurchasable,
} from './helpers/catalog';
import {
  clippedContent,
  contentOutsideViewport,
  describeRing,
  lineClamped,
  ringProblems,
  settle,
  uppercaseOverflow,
  walkRings,
} from './helpers/ring';

// BA-10 verification of the brand restyle (docs/design/BRAND_APPLICATION_SPEC.md sections 5 and 6; NFR-001, NFR-003,
// NFR-007, REQ-NAV-001, REQ-HOME-001, REQ-COL-001, REQ-PDP-001, REQ-CART-001). Store-agnostic: it finds its pages
// (first buyable product, first collection) at run time, so the same file runs on bedding.mock.shop and on the client's
// development store. Steps that need data a store lacks (a sized product, filters) record "not applicable" in the
// annotations instead of skipping silently. Results and defects: docs/testing/BRAND_VERIFICATION.md.
//
//   E2E_PORT=6700 E2E_ENV_FILE=.env.demo npx playwright test tests/e2e/brand-verification.spec.ts --project=desktop-chromium

test.describe.configure({timeout: 180_000});

function note(info: TestInfo, type: string, description: string) {
  info.annotations.push({type, description});
  // The run record is read from stdout on purpose.
  // eslint-disable-next-line no-console
  console.log(`[brand] ${info.project.name} | ${type}: ${description}`);
}

type Catalog = {collection: string; product: string; sized: string | null};
let catalogOnce: Promise<Catalog> | undefined;

/** First collection, first buyable product, and a product with two or more sizes when the store has one. */
function catalogOf(page: Page): Promise<Catalog> {
  catalogOnce ??= (async () => {
    const collection = await firstCollectionPath(page);
    const product = await findProduct(
      page,
      '/collections/all',
      'buyable',
      isPurchasable,
    );
    let sized: string | null = null;
    try {
      sized = await findProduct(
        page,
        '/collections/all',
        'sold in two or more sizes',
        (p) => hasSizes(p, 2),
      );
    } catch {
      sized = null;
    }
    return {collection, product, sized};
  })();
  return catalogOnce.catch((error: unknown) => {
    catalogOnce = undefined;
    throw error;
  });
}

async function addToCart(page: Page, path: string) {
  await gotoReady(page, path);
  const answered = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname.startsWith('/cart') &&
      r.request().method() === 'POST',
  );
  await page.getByRole('button', {name: 'Add to cart'}).click();
  await answered;
  const drawer = page.getByRole('dialog', {name: 'Cart'});
  await expect(drawer.getByRole('list', {name: 'Cart items'})).toBeVisible();
  // Settle: the optimistic subtotal ("Updating price") must give way to the amount before a measurement.
  await expect(
    drawer.locator('dl').filter({hasText: 'Subtotal'}).locator('dd').first(),
  ).toHaveText(/\$[\d,]+\.\d{2}/, {timeout: 30_000});
  return drawer;
}

async function openUntilVisible(trigger: Locator, target: Locator) {
  await expect(async () => {
    if (!(await target.isVisible())) await trigger.click({timeout: 2_000});
    await expect(target).toBeVisible({timeout: 2_000});
  }).toPass({timeout: 15_000});
}

const banner = (page: Page) => page.getByRole('banner');
const headerCart = (page: Page) =>
  banner(page).getByRole('link', {name: 'Cart'});

async function overflowPx(page: Page) {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}

// ---------------------------------------------------------------------------------------------------------------
// 1. axe on the restyled states at 360 and 1280 (desktop project only: the test sets the width)
// ---------------------------------------------------------------------------------------------------------------

test.describe('BA-10 axe on the restyled pages and states at 360 and 1280 px (NFR-003)', () => {
  for (const width of [360, 1280]) {
    const audit = async (page: Page, info: TestInfo, label: string) => {
      // A drawer that is still fading in is blended with the page behind it, which axe reads as a colour-contrast
      // failure (seen: white on #e7464e, 3.9:1, for the "Show results" button 100 ms after the drawer opened).
      // Measure the settled state, which is what a user sees.
      await settle(page);
      const violations = await runAxeAudit(page);
      note(info, 'axe', `${label} @${width} ${summariseAudit(violations)}`);
      await info.attach(`axe-${label.replace(/\W+/g, '_')}-${width}.json`, {
        body: JSON.stringify(violations, null, 2),
        contentType: 'application/json',
      });
      expect(
        blockingViolations(violations),
        `serious or critical on ${label} @${width}: ${violations.map((v) => `${v.id}: ${v.detail}`).join(' || ')}`,
      ).toEqual([]);
      // Any colour-contrast finding at any impact is a restyle regression: the palette was built to pass it.
      expect(
        violations
          .filter((v) => v.id === 'color-contrast')
          .map((v) => v.detail),
        `colour-contrast findings on ${label} @${width}`,
      ).toEqual([]);
    };

    test.describe(`at ${width} px`, () => {
      test.beforeEach(async ({page}, info) => {
        test.skip(
          info.project.name !== 'desktop-chromium',
          'The viewport is set by the test, so each width runs once, in the desktop project.',
        );
        await page.setViewportSize({width, height: 800});
      });

      test(`home`, async ({page}, info) => {
        await gotoReady(page, '/');
        await audit(page, info, 'home');
        expect(
          await overflowPx(page),
          'horizontal overflow',
        ).toBeLessThanOrEqual(0);
      });

      test(`/collections/all`, async ({page}, info) => {
        await gotoReady(page, '/collections/all');
        await audit(page, info, 'collections-all');
        expect(
          await overflowPx(page),
          'horizontal overflow',
        ).toBeLessThanOrEqual(0);
      });

      test(`a collection, with the filters open when the store has any`, async ({
        page,
      }, info) => {
        const {collection} = await catalogOf(page);
        await gotoReady(page, collection);
        await audit(page, info, 'collection');
        const filters = page.getByRole('button', {name: /^Filters/});
        if (width < 1024 && (await filters.count()) > 0) {
          await filters.first().click();
          await expect(
            page.getByRole('dialog', {name: 'Filters'}),
          ).toBeVisible();
          await audit(page, info, 'collection-filters-drawer');
        } else if (
          width >= 1024 &&
          (await page.getByRole('heading', {name: 'Filters'}).count()) > 0
        ) {
          for (const summary of await page
            .locator('aside details > summary')
            .all())
            await summary.click();
          await audit(page, info, 'collection-filters-sidebar-open');
        } else {
          note(
            info,
            'not applicable',
            `${collection} has no filters on this store`,
          );
        }
      });

      test(`product page`, async ({page}, info) => {
        const {product} = await catalogOf(page);
        await gotoReady(page, product);
        await audit(page, info, 'product');
        expect(
          await overflowPx(page),
          'horizontal overflow',
        ).toBeLessThanOrEqual(0);
      });

      test(`product with sizes, after choosing another size`, async ({
        page,
      }, info) => {
        const {sized} = await catalogOf(page);
        if (!sized) {
          note(
            info,
            'not applicable',
            'no product with two or more sizes on this store',
          );
          return;
        }
        await gotoReady(page, sized);
        const group = page.getByRole('group', {name: /^Size/});
        const checked = group.locator('input[type="radio"]:checked');
        await checked.focus();
        const before = await checked.getAttribute('value');
        await page.keyboard.press('ArrowRight');
        await expect(
          group.locator('input[type="radio"]:checked'),
        ).not.toHaveAttribute('value', before ?? '');
        await audit(page, info, 'product-sized-second-selected');
      });

      test(`cart page with an item`, async ({page}, info) => {
        const {product} = await catalogOf(page);
        await addToCart(page, product);
        await page.keyboard.press('Escape');
        await gotoReady(page, '/cart');
        await expect(
          page
            .locator('main')
            .locator('dl')
            .filter({hasText: 'Subtotal'})
            .locator('dd')
            .first(),
        ).toHaveText(/\$[\d,]+\.\d{2}/, {timeout: 30_000});
        await audit(page, info, 'cart-page-item');
        expect(
          await overflowPx(page),
          'horizontal overflow',
        ).toBeLessThanOrEqual(0);
      });

      test(`cart page, empty`, async ({page}, info) => {
        await gotoReady(page, '/cart');
        await expect(
          page.getByRole('heading', {name: /empty/i}).first(),
        ).toBeVisible();
        await audit(page, info, 'cart-page-empty');
        expect(
          await overflowPx(page),
          'horizontal overflow',
        ).toBeLessThanOrEqual(0);
      });

      test(`cart drawer with an item, and empty`, async ({page}, info) => {
        await gotoReady(page, '/');
        const drawer = page.getByRole('dialog', {name: 'Cart'});
        await openUntilVisible(headerCart(page), drawer);
        await audit(page, info, 'cart-drawer-empty');
        await page.keyboard.press('Escape');
        const {product} = await catalogOf(page);
        await addToCart(page, product);
        await audit(page, info, 'cart-drawer-item');
      });

      test(
        width < 1024
          ? 'menu drawer, closed and with a section open'
          : 'mega menu open',
        async ({page}, info) => {
          await gotoReady(page, '/');
          if (width < 1024) {
            const menu = page.getByRole('dialog', {name: 'Menu'});
            await openUntilVisible(
              banner(page).getByRole('button', {name: 'Menu'}),
              menu,
            );
            await audit(page, info, 'menu-drawer');
            await menu.getByRole('button', {name: 'Mattresses'}).click();
            await audit(page, info, 'menu-drawer-section-open');
          } else {
            const button = page
              .getByRole('navigation', {name: 'Main'})
              .getByRole('button', {name: 'Mattresses'});
            await button.focus();
            await page.keyboard.press('Enter');
            await expect(button).toHaveAttribute('aria-expanded', 'true');
            await audit(page, info, 'mega-menu-mattresses');
          }
        },
      );

      test(`search results and the open suggestions`, async ({page}, info) => {
        const {product} = await catalogOf(page);
        const word = product.split('/').pop()?.split('-')[0] ?? 'a';
        await gotoReady(page, `/search?q=${encodeURIComponent(word)}`);
        await audit(page, info, 'search-results');
      });

      test(`dev gallery: promo bar and red hero band (dev server only)`, async ({
        page,
      }, info) => {
        const response = await gotoReady(page, '/components');
        if (response?.status() !== 200) {
          note(
            info,
            'not applicable',
            `/components answered ${response?.status()}`,
          );
          return;
        }
        await audit(page, info, 'dev-gallery');
      });
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------
// 2. Keyboard-only journey (both projects: desktop 1280, phone 360)
// ---------------------------------------------------------------------------------------------------------------

test.describe('BA-10 keyboard-only journey on the restyled site (NFR-003, WCAG 2.1.1, 2.4.3, 2.4.7, 2.4.11, 1.4.11)', () => {
  test.beforeEach(async ({page, isMobile}) => {
    await page.setViewportSize({width: isMobile ? 360 : 1280, height: 800});
  });

  test('the skip link is the first stop, shows a ring, and moves focus to main', async ({
    page,
  }, info) => {
    await gotoReady(page, '/');
    await page.keyboard.press('Tab');
    const ring = await describeRing(page);
    expect(ring?.label).toContain('Skip to main content');
    note(info, 'skip link', JSON.stringify(ring));
    expect(ring?.indicator).toBe(true);
    expect(ring?.offscreen, 'skip link is on screen when focused').toBe(false);
    // Black pill, ink band (4 px box-shadow) under the inner 2 px of the 3 px yellow ring: judged as a two-colour
    // indicator, so ring vs band and band vs what is painted around it must each be 3:1 (helpers/ring.ts).
    expect(ring?.contrast ?? 0).toBeGreaterThanOrEqual(3);
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
  });

  // Guard for the band rule above: take the ink band away and the very same yellow ring (1.4 to 1.5 : 1 on the grey
  // and white surfaces around the link) must be reported as failing, otherwise the band logic would let anything pass.
  test('the skip link contrast check bites: without its ink band the yellow ring fails 3:1', async ({
    page,
  }) => {
    await gotoReady(page, '/');
    await page.addStyleTag({
      content: 'a[href="#main-content"]:focus { box-shadow: none !important; }',
    });
    await page.keyboard.press('Tab');
    const ring = await describeRing(page);
    expect(ring?.label).toContain('Skip to main content');
    expect(ring?.band, 'no band once the shadow is removed').toBeNull();
    expect(ring?.contrast ?? 99).toBeLessThan(3);
  });

  const TEMPLATES: {
    name: string;
    open: (page: Page, c: Catalog) => Promise<void>;
  }[] = [
    {
      name: 'home (red hero band, size tiles, product cards, category tiles, footer)',
      open: async (p) => void (await gotoReady(p, '/')),
    },
    {
      name: 'collection (cards, load more, filters)',
      open: async (p, c) => void (await gotoReady(p, c.collection)),
    },
    {
      name: 'all products',
      open: async (p) => void (await gotoReady(p, '/collections/all')),
    },
    {
      name: 'product (gallery, size selector, add to cart)',
      open: async (p, c) => void (await gotoReady(p, c.sized ?? c.product)),
    },
    {
      name: 'cart page with an item',
      open: async (p, c) => {
        await addToCart(p, c.product);
        await p.keyboard.press('Escape');
        await gotoReady(p, '/cart');
      },
    },
    {
      name: 'dev gallery (promo bar, inverse buttons, accent button on black)',
      open: async (p) => void (await gotoReady(p, '/components')),
    },
  ];

  for (const template of TEMPLATES) {
    test(`tab walk: ${template.name}: every stop has a ring of 3:1 or more, is not clipped or covered, no trap`, async ({
      page,
    }, info) => {
      const catalog = await catalogOf(page);
      await template.open(page, catalog);
      if (
        template.name.startsWith('dev gallery') &&
        (await page.locator('h1').count()) === 0
      ) {
        note(
          info,
          'not applicable',
          '/components is not served (not a dev server)',
        );
        return;
      }
      const walk = await walkRings(page, 300);
      // BV-001 to BV-003 are fixed, so no stop is excused any more: every problem fails the walk.
      const problems = ringProblems(walk.stops);
      note(info, 'stops', `${walk.stops.length}, completed=${walk.completed}`);
      const byRegion: Record<string, number> = {};
      for (const s of walk.stops)
        byRegion[s.region] = (byRegion[s.region] ?? 0) + 1;
      note(info, 'regions', JSON.stringify(byRegion));
      const rings = new Map<string, number>();
      for (const s of walk.stops) {
        const key = `${s.ring} on ${s.surround}`;
        rings.set(key, Math.min(rings.get(key) ?? 99, s.contrast));
      }
      note(info, 'ring colours (min contrast)', JSON.stringify([...rings]));
      await info.attach('stops.json', {
        body: JSON.stringify(walk.stops, null, 1),
        contentType: 'application/json',
      });
      if (problems.length > 0)
        note(info, 'problems', problems.slice(0, 12).join(' || '));
      expect(walk.stops.length, 'the walk reached real stops').toBeGreaterThan(
        10,
      );
      expect(walk.completed, 'focus leaves the page (no keyboard trap)').toBe(
        true,
      );
      expect(problems).toEqual([]);
    });
  }

  test('BV-001 the focus ring of a product card title is not clipped by its line clamp', async ({
    page,
  }, info) => {
    await gotoReady(page, '/collections/all');
    await page.keyboard.press('Tab');
    await page.locator('article h3 a').first().focus();
    const ring = await describeRing(page);
    note(info, 'card title ring', JSON.stringify(ring));
    expect(ring?.indicator).toBe(true);
    expect(ring?.clippedBy, 'what clips the ring').toBeNull();
  });

  test('BV-002 the focus ring of a gallery thumbnail is not clipped by the scroll strip', async ({
    page,
  }, info) => {
    const {product} = await catalogOf(page);
    await gotoReady(page, product);
    const thumb = page.getByRole('button', {name: /^Show image 1 of/});
    if ((await thumb.count()) === 0) {
      note(info, 'not applicable', 'the product has one image (no thumbnails)');
      return;
    }
    await page.keyboard.press('Tab');
    await thumb.focus();
    const ring = await describeRing(page);
    note(info, 'thumbnail ring', JSON.stringify(ring));
    expect(ring?.clippedBy, 'what clips the ring').toBeNull();
  });

  test('BV-003 the focus ring of a Tabs tab (ui primitive, dev gallery only today) is not clipped', async ({
    page,
  }, info) => {
    const response = await gotoReady(page, '/components');
    if (response?.status() !== 200) {
      note(info, 'not applicable', '/components is not served');
      return;
    }
    await page.keyboard.press('Tab');
    await page.getByRole('tab', {name: 'Overview'}).focus();
    const ring = await describeRing(page);
    note(info, 'tab ring', JSON.stringify(ring));
    expect(ring?.clippedBy, 'what clips the ring').toBeNull();
  });

  test('header: search combobox by keyboard; the navigation opens, closes and returns focus', async ({
    page,
    isMobile,
  }) => {
    const {product} = await catalogOf(page);
    await gotoReady(page, '/');
    const search = banner(page).getByRole('combobox', {
      name: 'Search products and pages',
    });
    await search.focus();
    const word = product.split('/').pop()?.split('-')[0] ?? 'a';
    await page.keyboard.type(word.slice(0, 4));
    const option = page.getByRole('option').first();
    await expect(option).toBeVisible({timeout: 20_000});
    await page.keyboard.press('ArrowDown');
    await expect(search).toHaveAttribute('aria-activedescendant', /.+/);
    expect(
      (await describeRing(page))?.indicator,
      'ring on the field while an option is active',
    ).toBe(true);
    await page.keyboard.press('Escape');
    await expect(search).toBeFocused();
    await expect(page.getByRole('option')).toHaveCount(0);

    if (isMobile) {
      const trigger = banner(page).getByRole('button', {name: 'Menu'});
      const menu = page.getByRole('dialog', {name: 'Menu'});
      await trigger.focus();
      await page.keyboard.press('Enter');
      await expect(menu).toBeVisible();
      for (let i = 0; i < 25; i += 1) {
        await page.keyboard.press('Tab');
        const inside = await page.evaluate(
          () =>
            document
              .querySelector('[role=dialog]')
              ?.contains(document.activeElement) ?? false,
        );
        expect(inside, `focus inside the menu dialog after Tab ${i + 1}`).toBe(
          true,
        );
        expect(
          (await describeRing(page))?.indicator,
          `ring on stop ${i + 1}`,
        ).toBe(true);
      }
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(trigger).toBeFocused();
    } else {
      const nav = page.getByRole('navigation', {name: 'Main'});
      const button = nav.getByRole('button', {name: 'Mattresses'});
      await button.focus();
      await page.keyboard.press('Enter');
      await expect(button).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('Tab');
      const first = await describeRing(page);
      expect(
        first?.indicator,
        `ring on the first panel link (${first?.label})`,
      ).toBe(true);
      await page.keyboard.press('Escape');
      await expect(button).toHaveAttribute('aria-expanded', 'false');
      await expect(button).toBeFocused();
    }
  });

  test('journey: collection card, product, size by arrow keys, add to cart, drawer quantity, checkout link, Escape returns', async ({
    page,
  }, info) => {
    const catalog = await catalogOf(page);
    await gotoReady(page, '/collections/all');
    // Reach the first product card link by Tab only.
    const firstCard = page.locator('article a[href^="/products/"]').first();
    let reached = false;
    for (let press = 0; press < 120 && !reached; press += 1) {
      await page.keyboard.press('Tab');
      reached = await firstCard.evaluate((el) => el === document.activeElement);
    }
    expect(reached, 'Tab reaches the first product card link').toBe(true);
    const cardRing = await describeRing(page);
    note(info, 'card link ring', JSON.stringify(cardRing));
    expect(cardRing?.indicator).toBe(true);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', {level: 1})).toBeVisible();
    await page.waitForLoadState('networkidle');

    // Product page: go to the sized one when the store has it.
    if (catalog.sized) await gotoReady(page, catalog.sized);
    const group = page.getByRole('group', {name: /^Size/});
    if ((await group.count()) > 0 && catalog.sized) {
      const checked = group.locator('input[type="radio"]:checked');
      await checked.focus();
      const before = await checked.getAttribute('value');
      const ring = await describeRing(page);
      note(info, 'size ring', JSON.stringify(ring));
      expect(ring?.indicator, 'ring on the focused size').toBe(true);
      expect(ring?.contrast ?? 0, 'size ring contrast').toBeGreaterThanOrEqual(
        3,
      );
      await page.keyboard.press('ArrowRight');
      await expect(
        group.locator('input[type="radio"]:checked'),
      ).not.toHaveAttribute('value', before ?? '');
      expect(
        (await describeRing(page))?.indicator,
        'ring after ArrowRight',
      ).toBe(true);
    } else {
      note(
        info,
        'not applicable',
        'no sized product on this store; size selector keys not exercised',
      );
    }
    const add = page.getByRole('button', {name: 'Add to cart'});
    await add.focus();
    const addRing = await describeRing(page);
    note(info, 'add to cart ring', JSON.stringify(addRing));
    expect(addRing?.indicator).toBe(true);
    expect(
      addRing?.contrast ?? 0,
      'red button ring vs page',
    ).toBeGreaterThanOrEqual(3);
    await page.keyboard.press('Enter');
    const drawer = page.getByRole('dialog', {name: 'Cart'});
    await expect(drawer.getByRole('list', {name: 'Cart items'})).toBeVisible({
      timeout: 30_000,
    });
    const quantity = drawer.getByRole('textbox', {name: /^Quantity/});
    await expect(quantity).toBeEnabled({timeout: 30_000});
    const inDrawer = await page.evaluate(
      () =>
        document
          .querySelector('[role=dialog]')
          ?.contains(document.activeElement) ?? false,
    );
    expect(inDrawer, 'focus moved into the drawer').toBe(true);
    const increase = drawer.getByRole('button', {name: /^Increase quantity/});
    await expect(increase).not.toHaveAttribute('aria-disabled', 'true');
    await increase.focus();
    await page.keyboard.press('Enter');
    await expect(quantity).toHaveValue('2', {timeout: 30_000});
    await expect(increase).toBeFocused();
    // Walk the drawer: every stop in the dialog, rings visible and not clipped by the drawer.
    const stops: string[] = [];
    for (let i = 0; i < 14; i += 1) {
      await page.keyboard.press('Tab');
      const ring = await describeRing(page);
      const inside = await page.evaluate(
        () =>
          document
            .querySelector('[role=dialog]')
            ?.contains(document.activeElement) ?? false,
      );
      expect(inside, `focus stays in the drawer after Tab ${i + 1}`).toBe(true);
      if (ring)
        stops.push(
          `${ring.label} ring ${ring.contrast}:1${ring.clippedBy ? ' CLIPPED ' + ring.clippedBy : ''}`,
        );
      expect(ring?.indicator, `ring: ${ring?.label}`).toBe(true);
      expect(
        ring?.clippedBy,
        `drawer clips the ring of ${ring?.label}`,
      ).toBeNull();
      expect(
        ring?.contrast ?? 0,
        `ring contrast of ${ring?.label}`,
      ).toBeGreaterThanOrEqual(3);
    }
    note(info, 'drawer stops', stops.join(' | '));
    const checkout = drawer.getByRole('link', {name: 'Checkout'});
    await expect(checkout).toHaveAttribute('href', '/checkout-steps');
    await checkout.focus();
    const checkoutRing = await describeRing(page);
    note(info, 'checkout ring', JSON.stringify(checkoutRing));
    expect(checkoutRing?.indicator).toBe(true);
    // Not pressed: the hosted checkout is not part of this check.
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    const activeAfter = await describeFocus(page);
    note(info, 'focus after Escape', activeAfter?.label ?? 'none');
    expect(
      activeAfter,
      'focus is on a control after closing the drawer',
    ).not.toBeNull();
    await expect(
      add,
      'focus returns to the control that opened the drawer',
    ).toBeFocused();
  });

  test('footer: End then Shift+Tab reaches the last link; on a phone the groups open from the keyboard', async ({
    page,
    isMobile,
  }, info) => {
    await gotoReady(page, '/');
    await page.keyboard.press('End');
    const footer = page.getByRole('contentinfo');
    if (isMobile) {
      const group = footer.getByRole('button', {name: 'Customer support'});
      await group.focus();
      expect(
        (await describeRing(page))?.indicator,
        'ring on the footer group button',
      ).toBe(true);
      await expect(group).toHaveAttribute('aria-expanded', 'false');
      await page.keyboard.press('Enter');
      await expect(group).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('Tab');
      const link = await describeRing(page);
      note(info, 'first link in the opened group', JSON.stringify(link));
      expect(link?.region).toBe('contentinfo');
      expect(link?.indicator).toBe(true);
      expect(link?.contrast ?? 0).toBeGreaterThanOrEqual(3);
    } else {
      const last = footer.getByRole('link').last();
      await last.focus();
      const ring = await describeRing(page);
      note(info, 'last footer link ring', JSON.stringify(ring));
      expect(ring?.indicator).toBe(true);
      expect(
        ring?.contrast ?? 0,
        'ring on the grey footer',
      ).toBeGreaterThanOrEqual(3);
      // Footer links sit on ink-100: measure a middle link too.
      const mid = footer.getByRole('link', {name: 'Sleep quiz'});
      if ((await mid.count()) > 0) {
        await mid.focus();
        expect(
          (await describeRing(page))?.contrast ?? 0,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 3. Reflow (WCAG 1.4.10) at 320 px, text spacing (1.4.12), long uppercase words
// ---------------------------------------------------------------------------------------------------------------

test.describe('BA-10 reflow at 320 px, text spacing and uppercase display type (WCAG 1.4.10, 1.4.12, NFR-001)', () => {
  const SPACING =
    '*{line-height:1.5 !important;letter-spacing:.12em !important;word-spacing:.16em !important}p{margin-bottom:2em !important}';

  const pages: {
    name: string;
    open: (page: Page, c: Catalog) => Promise<void>;
  }[] = [
    {name: 'home', open: async (p) => void (await gotoReady(p, '/'))},
    {
      name: 'collection (cards)',
      open: async (p) => void (await gotoReady(p, '/collections/all')),
    },
    {
      name: 'product',
      open: async (p, c) => void (await gotoReady(p, c.sized ?? c.product)),
    },
    {
      name: 'cart page with an item',
      open: async (p, c) => {
        await addToCart(p, c.product);
        await p.keyboard.press('Escape');
        await gotoReady(p, '/cart');
      },
    },
    {
      name: 'cart page, empty',
      open: async (p) => void (await gotoReady(p, '/cart')),
    },
  ];

  test.describe('320 x 256 CSS px (400 percent of 1280 x 1024)', () => {
    test.use({viewport: {width: 320, height: 256}});
    for (const template of pages) {
      test(`${template.name}: no page scroll, nothing outside the viewport, uppercase text fits its box`, async ({
        page,
      }, info) => {
        await template.open(page, await catalogOf(page));
        const overflow = await overflowPx(page);
        const outside = await contentOutsideViewport(page);
        const upper = await uppercaseOverflow(page);
        const clamped = await lineClamped(page);
        note(info, 'overflow px', String(overflow));
        if (clamped.length > 0)
          note(
            info,
            'text hidden by line clamps (report only)',
            clamped.join(' || '),
          );
        expect(overflow, 'page-level horizontal overflow').toBeLessThanOrEqual(
          0,
        );
        expect(outside, 'content beyond the right edge').toEqual([]);
        expect(upper, 'uppercase text wider than its box').toEqual([]);
      });
    }

    test('header, open menu drawer and cart drawer fit 320 px', async ({
      page,
    }, info) => {
      await gotoReady(page, '/');
      expect(await contentOutsideViewport(page), 'header').toEqual([]);
      const menu = page.getByRole('dialog', {name: 'Menu'});
      await openUntilVisible(
        banner(page).getByRole('button', {name: 'Menu'}),
        menu,
      );
      await menu.getByRole('button', {name: 'Mattresses'}).click();
      expect(await contentOutsideViewport(page), 'menu drawer').toEqual([]);
      expect(await uppercaseOverflow(page), 'menu uppercase').toEqual([]);
      await page.keyboard.press('Escape');
      const {product} = await catalogOf(page);
      await addToCart(page, product);
      expect(await contentOutsideViewport(page), 'cart drawer').toEqual([]);
      expect(await uppercaseOverflow(page), 'cart drawer uppercase').toEqual(
        [],
      );
      note(
        info,
        'checked',
        'header, menu drawer with a section open, cart drawer with an item',
      );
    });
  });

  test.describe('text spacing override at 360 and 1280', () => {
    for (const width of [360, 1280]) {
      for (const template of pages) {
        test(`${template.name} @${width}: no clipped text and no new horizontal scroll`, async ({
          page,
        }, info) => {
          test.skip(
            info.project.name !== 'desktop-chromium',
            'width set by the test; runs once, in the desktop project',
          );
          await page.setViewportSize({width, height: 800});
          await template.open(page, await catalogOf(page));
          await page.addStyleTag({content: SPACING});
          const clipped = await clippedContent(page);
          const upper = await uppercaseOverflow(page);
          note(info, 'overflow px', String(await overflowPx(page)));
          expect(
            await overflowPx(page),
            'page-level horizontal overflow',
          ).toBeLessThanOrEqual(0);
          expect(clipped, 'elements that clip their text').toEqual([]);
          expect(upper, 'uppercase text wider than its box').toEqual([]);
        });
      }
    }

    test('320 px with the spacing override: header, cards and product page', async ({
      page,
    }, info) => {
      test.skip(
        info.project.name !== 'desktop-chromium',
        'width set by the test; runs once, in the desktop project',
      );
      await page.setViewportSize({width: 320, height: 800});
      const catalog = await catalogOf(page);
      const failures: string[] = [];
      for (const template of pages.slice(0, 3)) {
        await template.open(page, catalog);
        await page.addStyleTag({content: SPACING});
        const overflow = await overflowPx(page);
        const outside = await contentOutsideViewport(page);
        const clipped = await clippedContent(page);
        const upper = await uppercaseOverflow(page);
        note(
          info,
          template.name,
          `overflow=${overflow} outside=${outside.length} clipped=${clipped.length} upper=${upper.length}`,
        );
        if (overflow > 0)
          failures.push(
            `${template.name}: page scrolls sideways by ${overflow}px`,
          );
        for (const line of [...outside, ...clipped, ...upper])
          failures.push(`${template.name}: ${line}`);
      }
      expect(failures).toEqual([]);
    });
  });

  test.describe('long words in uppercase display type at 320 px', () => {
    test.use({viewport: {width: 320, height: 800}});
    // Realistic admin titles: a collection or hero headline can be one long word.
    const REALISTIC = ['HYPOALLERGENIC', 'ORTHOPAEDIC-RECOMMENDED'];

    /** Replaces the text of the first match of `selector`, then measures page scroll and uppercase fit. */
    async function inject(
      page: Page,
      path: string,
      selector: string,
      text: string,
    ) {
      await gotoReady(page, path);
      const found = await page.evaluate(
        ([sel, value]) => {
          const el = document.querySelector(sel ?? '');
          if (!el) return false;
          (el.querySelector('span') ?? el).textContent = value ?? '';
          return true;
        },
        [selector, text],
      );
      expect(found, `${selector} exists on ${path}`).toBe(true);
      return {
        overflow: await overflowPx(page),
        outside: await contentOutsideViewport(page),
        upper: await uppercaseOverflow(page),
      };
    }

    for (const word of REALISTIC) {
      test(`BV-004 home hero headline "${word}" stays inside the red frame and the page does not scroll sideways`, async ({
        page,
      }, info) => {
        const m = await inject(page, '/', 'main h1', word);
        note(info, `hero ${word}`, JSON.stringify(m));
        expect(
          m.overflow,
          'page-level horizontal overflow',
        ).toBeLessThanOrEqual(0);
        expect(m.upper, 'headline wider than its frame').toEqual([]);
      });

      test(`collection page title "${word}" does not make the page scroll sideways`, async ({
        page,
      }, info) => {
        const m = await inject(page, '/collections/all', 'main h1', word);
        note(info, `collection h1 ${word}`, JSON.stringify(m));
        expect(m.overflow).toBeLessThanOrEqual(0);
        expect(m.outside).toEqual([]);
      });

      test(`home section heading "${word}" (shop by size, best sellers) fits`, async ({
        page,
      }, info) => {
        const m = await inject(page, '/', 'main section h2, main h2', word);
        note(info, `home h2 ${word}`, JSON.stringify(m));
        expect(m.overflow).toBeLessThanOrEqual(0);
        expect(m.outside).toEqual([]);
      });

      test(`footer group heading "${word}" fits`, async ({page}, info) => {
        const m = await inject(page, '/', 'footer h2, footer button', word);
        note(info, `footer ${word}`, JSON.stringify(m));
        expect(m.overflow).toBeLessThanOrEqual(0);
        expect(m.outside).toEqual([]);
      });
    }

    test('a long button label on the red hero band wraps or fits (BV-004 family)', async ({
      page,
    }, info) => {
      const label = 'SHOP ADJUSTABLE BASES AND FOUNDATIONS TODAY';
      const m = await inject(page, '/', 'main a[href]', label);
      note(info, 'hero button label', JSON.stringify(m));
      expect(m.overflow).toBeLessThanOrEqual(0);
      expect(m.outside).toEqual([]);
    });

    test('stress, report only: a 34-letter word in the hero headline, a section heading and the collection title', async ({
      page,
    }, info) => {
      const word = 'SUPERCALIFRAGILISTICEXPIALIDOCIOUS';
      const hero = await inject(page, '/', 'main h1', word);
      const col = await inject(page, '/collections/all', 'main h1', word);
      note(
        info,
        'stress',
        `hero overflow=${hero.overflow}px; collection title overflow=${col.overflow}px`,
      );
      expect(
        hero.overflow + col.overflow,
        'recorded, not gated',
      ).toBeGreaterThan(-1000);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 5. Layout fixes found by BA-10 (BV-006, BV-007, BV-008). They set their own widths, so the desktop project runs them.
// ---------------------------------------------------------------------------------------------------------------

test.describe('BA-10 layout fixes: utility bar breakpoint, cart page spacing, narrow product cards (BV-006, BV-007, BV-008, NFR-001)', () => {
  test.skip(
    ({isMobile}) => isMobile,
    'The width is set explicitly here, so the desktop project covers every width.',
  );

  // BV-006: the right-hand utility links need about 870 px beside the ZIP and store controls, so they show from
  // 1024 px (where the full navigation replaces the menu button). Below that the bar must stay on ONE line.
  for (const [width, linksShown] of [
    [360, false],
    [768, false],
    [1023, false],
    [1024, true],
    [1280, true],
  ] as const) {
    test(`BV-006 the utility bar is one line at ${width} px and its right-hand links are ${linksShown ? 'shown' : 'in the menu only'}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({width, height: 900});
      await gotoReady(page, '/');
      const header = banner(page);
      const zip = header.getByRole('button', {name: 'Enter delivery ZIP'});
      const store = header.getByRole('link', {name: 'Select your store'});
      await expect(zip).toBeVisible();
      await expect(store).toBeVisible();
      const [zipBox, storeBox] = await Promise.all([
        zip.boundingBox(),
        store.boundingBox(),
      ]);
      const bar = zip.locator(
        'xpath=ancestor::div[contains(@class,"bg-surface-muted")][1]',
      );
      const barBox = await bar.boundingBox();
      note(
        info,
        `utility bar ${width}`,
        JSON.stringify({zipBox, storeBox, barHeight: barBox?.height}),
      );
      // The same row: the two controls start at the same height (a wrapped bar stacks them).
      expect(
        Math.abs((zipBox?.y ?? 0) - (storeBox?.y ?? 99)),
        'ZIP and store sit on one row',
      ).toBeLessThanOrEqual(2);
      // One row of 44 px touch targets plus the bar padding; the wrapped bar was 88 px.
      expect(barBox?.height ?? 999, 'utility bar height').toBeLessThanOrEqual(
        56,
      );
      expect(await overflowPx(page), 'horizontal overflow').toBeLessThanOrEqual(
        0,
      );
      const links = header.getByRole('link', {name: 'Track order'});
      if (linksShown) await expect(links).toBeVisible();
      else await expect(links).toBeHidden();
    });
  }

  // BV-007: the page title has a rule under it, so the first line item and the summary card need room below it.
  test('BV-007 the first cart line does not touch the rule under the page title (cart page, 360 and 1280)', async ({
    page,
  }, info) => {
    const {product} = await catalogOf(page);
    await addToCart(page, product);
    await page.keyboard.press('Escape');
    for (const width of [360, 1280]) {
      await page.setViewportSize({width, height: 900});
      await gotoReady(page, '/cart');
      const title = page.getByRole('heading', {level: 1, name: 'Your cart'});
      const list = page.getByRole('list', {name: 'Cart items'});
      await expect(list).toBeVisible();
      const [titleBox, listBox] = await Promise.all([
        title.boundingBox(),
        list.boundingBox(),
      ]);
      const gap =
        (listBox?.y ?? 0) - ((titleBox?.y ?? 0) + (titleBox?.height ?? 0));
      note(info, `cart gap ${width}`, `${gap}px`);
      expect(
        gap,
        `space under the title at ${width} px`,
      ).toBeGreaterThanOrEqual(12);
    }
  });

  // BV-008: in a two-column listing the price block of a sale card wrapped to three lines. The price parts are a
  // wrapping row now; it must take two rows at most. A store with no sale product has no card to measure, so the
  // number of sale cards found is recorded in the annotations (zero means the test proved nothing there).
  for (const [width, path] of [
    [360, '/'],
    [360, '/collections/all'],
    [768, '/'],
    [768, '/collections/all'],
  ] as const) {
    test(`BV-008 a sale price takes two rows at most in a product card at ${width} px on ${path}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({width, height: 900});
      await gotoReady(page, path);
      const rows = await page.evaluate(() => {
        const out: {title: string; rows: number; width: number}[] = [];
        for (const card of Array.from(document.querySelectorAll('article'))) {
          const compare = card.querySelector('s');
          const block = compare?.parentElement;
          if (!compare || !block) continue;
          // Parts are baseline-aligned, so one row has different tops and bottoms: a part starts a new row when it
          // begins below the bottom of the row so far.
          const boxes = Array.from(block.children)
            .map((child) => child.getBoundingClientRect())
            .filter((r) => r.height > 0)
            .sort((a, b) => a.top - b.top);
          let count = 0;
          let rowBottom = -Infinity;
          for (const r of boxes) {
            if (r.top >= rowBottom - 2) {
              count += 1;
              rowBottom = r.bottom;
            } else {
              rowBottom = Math.max(rowBottom, r.bottom);
            }
          }
          out.push({
            title: (card.querySelector('h3')?.textContent ?? '')
              .trim()
              .slice(0, 30),
            rows: count,
            width: Math.round(card.getBoundingClientRect().width),
          });
        }
        return out;
      });
      note(
        info,
        `sale cards ${width} ${path}`,
        `${rows.length} found: ${JSON.stringify(rows)}`,
      );
      for (const r of rows) {
        expect(
          r.rows,
          `price rows of "${r.title}" (card ${r.width} px)`,
        ).toBeLessThanOrEqual(2);
      }
    });
  }
});
