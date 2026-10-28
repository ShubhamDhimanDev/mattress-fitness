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
  midWordBreaks,
  ringProblems,
  samplePaintedContrast,
  settle,
  stopsOverImages,
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
    drawer
      .locator('dl')
      .filter({hasText: 'Estimated total'})
      .locator('dd')
      .first(),
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
        // A skip with a reason, not a silent pass: the dev gallery exists on the dev server only.
        test.skip(
          response?.status() !== 200,
          `/components answered ${response?.status()}: not a dev server, nothing to audit`,
        );
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

  // Guard for the band rule above. The very same yellow ring (1.4 to 1.5 : 1 on the grey and white surfaces around the
  // link) must be reported as failing whenever the band does not do the job, otherwise the band logic would let anything
  // pass. A band counts only when its spread reaches the ring's outer edge (offset 2 + width 3 - 1 = 4 px) and it is
  // opaque; a pale band is judged on its own contrast, a thinner one is not a band at all.
  const BITES: {
    name: string;
    shadow: string;
    band: 'none' | 'present';
  }[] = [
    {
      name: 'without its ink band the yellow ring fails 3:1',
      shadow: 'none',
      band: 'none',
    },
    {
      name: 'a pale band (4 px, rgb 238) does not rescue the yellow ring: below 3:1',
      shadow: '0 0 0 4px rgb(238, 238, 238)',
      band: 'present',
    },
    {
      name: 'a 2 px ink band is too thin to count: no band, ring against the surround, below 3:1',
      shadow: '0 0 0 2px rgb(20, 20, 20)',
      band: 'none',
    },
  ];
  for (const guard of BITES) {
    test(`the skip link contrast check bites: ${guard.name}`, async ({
      page,
    }) => {
      await gotoReady(page, '/');
      await page.addStyleTag({
        content: `a[href="#main-content"]:focus { box-shadow: ${guard.shadow} !important; }`,
      });
      await page.keyboard.press('Tab');
      const ring = await describeRing(page);
      expect(ring?.label).toContain('Skip to main content');
      if (guard.band === 'none')
        expect(ring?.band, 'not read as a band').toBeNull();
      else expect(ring?.band, 'read as a band').not.toBeNull();
      expect(ring?.contrast ?? 99).toBeLessThan(3);
    });
  }

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

  // How many stops of one page may be excused from the CSS colour model because their ring is over an image or gradient.
  const OVER_IMAGE_ALLOWANCE = 2;

  for (const template of TEMPLATES) {
    test(`tab walk: ${template.name}: every stop has a ring of 3:1 or more, is not clipped or covered, focus leaves or wraps to the first stop`, async ({
      page,
    }, info) => {
      const catalog = await catalogOf(page);
      await template.open(page, catalog);
      test.skip(
        template.name.startsWith('dev gallery') &&
          (await page.locator('h1').count()) === 0,
        '/components is not served (not a dev server): no page to walk',
      );
      const walk = await walkRings(page, 300);
      // BV-001 to BV-003 are fixed, so no stop is excused any more: every problem fails the walk.
      const problems = ringProblems(walk.stops);
      // Rings over a photo or gradient cannot be judged from CSS colours; they are judged on the painted pixels
      // (`pixelContrast`) and counted here, so a page that quietly puts many controls over images cannot pass.
      const overImages = stopsOverImages(walk.stops);
      note(info, 'stops', `${walk.stops.length}, completed=${walk.completed}`);
      note(
        info,
        'rings over images or gradients (excused from the colour model)',
        `${overImages.length}${overImages.length > 0 ? ': ' + overImages.map((s) => `#${s.index} ${s.label} painted ${s.pixelContrast ?? 'n/a'}:1`).join(' | ') : ''}`,
      );
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
      // Completed means focus left the document or wrapped to the FIRST stop. A return to any other stop is a trap.
      expect(
        walk.trap,
        'keyboard trap (focus returned to a stop other than the first)',
      ).toBeNull();
      expect(
        walk.completed,
        'focus leaves the page or wraps to the first stop within 300 stops',
      ).toBe(true);
      expect(
        overImages.length,
        `stops excused because the ring sits over an image or gradient (allowance ${OVER_IMAGE_ALLOWANCE})`,
      ).toBeLessThanOrEqual(OVER_IMAGE_ALLOWANCE);
      expect(problems).toEqual([]);
    });
  }

  test('BV-001 the focus ring of a product card title is not clipped by its line clamp', async ({
    page,
  }, info) => {
    await gotoReady(page, '/collections/all');
    const title = page.locator('article h3 a').first();
    test.skip(
      (await title.count()) === 0,
      '/collections/all shows no product card: nothing to measure',
    );
    await page.keyboard.press('Tab');
    await title.focus();
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
    test.skip(
      (await thumb.count()) === 0,
      `${product} has one image (no thumbnails): the strip does not exist, so there is no ring to measure; BV-002 below looks for a product with five or more`,
    );
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
    test.skip(
      response?.status() !== 200,
      `/components answered ${response?.status()}: the dev gallery is served by the dev server only, so Tabs cannot be measured here`,
    );
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
      // "Sleep guide" holds fixed links, so it exists on every store; "Customer support" holds only Shopify page links
      // and is dropped when the store has none of those pages (REQ-CNT-001, P6-09).
      const group = footer.getByRole('button', {
        name: 'Sleep guide',
        exact: true,
      });
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

  // BV-006: the right-hand utility links need about 870 px beside the ZIP control, so they show from
  // 1024 px (where the full navigation replaces the menu button). Below that the bar must stay on ONE line.
  for (const [width, linksShown] of [
    [360, false],
    [768, false],
    [1023, false],
    [1024, true],
    [1280, true],
  ] as const) {
    test(`BV-006 the utility bar is one line at ${width} px and its right-hand links are ${linksShown ? 'shown' : 'in the menu, which has a Menu button'}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({width, height: 900});
      await gotoReady(page, '/');
      const header = banner(page);
      const zip = header.getByRole('button', {name: 'Enter delivery ZIP'});
      await expect(zip).toBeVisible();
      const zipBox = await zip.boundingBox();
      const bar = zip.locator(
        'xpath=ancestor::div[contains(@class,"bg-surface-muted")][1]',
      );
      const barBox = await bar.boundingBox();
      note(
        info,
        `utility bar ${width}`,
        JSON.stringify({zipBox, barHeight: barBox?.height}),
      );
      // One row of 44 px touch targets plus the bar padding; the wrapped bar was 88 px.
      expect(barBox?.height ?? 999, 'utility bar height').toBeLessThanOrEqual(
        56,
      );
      expect(await overflowPx(page), 'horizontal overflow').toBeLessThanOrEqual(
        0,
      );
      const links = header.getByRole('link', {name: 'Track order'});
      const menuButton = header.getByRole('button', {name: 'Menu'});
      if (linksShown) {
        await expect(links).toBeVisible();
        await expect(
          menuButton,
          'the full navigation replaces the Menu button',
        ).toBeHidden();
        return;
      }
      await expect(links).toBeHidden();
      // The links are not lost: the Menu button must be there (768 and 1023 have no full navigation either), and
      // the drawer it opens lists Track order, Contact, Chat and the phone number.
      await expect(
        menuButton,
        'a Menu button is the only way to reach the links below 1024 px',
      ).toBeVisible();
      const menu = page.getByRole('dialog', {name: 'Menu'});
      await openUntilVisible(menuButton, menu);
      const help = menu.getByRole('navigation', {name: 'Help and contact'});
      await expect(help.getByRole('link', {name: 'Track order'})).toBeVisible();
      // "Contact us" shows only when the Shopify contact page exists, and "Chat with us" only when a chat provider is
      // set (none yet, Q-011, P7-03) (REQ-CNT-001, P6-09).
      const contactStatus = (
        await page.request.get('/pages/contact', {maxRedirects: 0})
      ).status();
      if (contactStatus === 404) {
        await expect(help.getByRole('link', {name: 'Contact us'})).toHaveCount(
          0,
        );
      }
      await expect(help.getByRole('link', {name: 'Chat with us'})).toHaveCount(
        0,
      );
      // The dev server shows a labelled placeholder; a store with PUBLIC_SUPPORT_PHONE shows its number (REQ-CNT-001).
      await expect(help.locator('a[href^="tel:"]')).toHaveCount(1);
    });
  }

  // BV-006, content that grows: a saved ZIP replaces the short default text. At 1024 the right-hand links take about 870 px, so this is the tightest bar. The
  // texts are written into the page (a saved ZIP needs a delivery zone this store does not have); only the bar is judged.
  for (const width of [1023, 1024]) {
    test(`BV-006 a saved ZIP keeps the utility bar to one row at ${width} px`, async ({
      page,
    }, info) => {
      await page.setViewportSize({width, height: 900});
      await gotoReady(page, '/');
      const header = banner(page);
      const zip = header.getByRole('button', {name: 'Enter delivery ZIP'});
      await expect(zip).toBeVisible();
      await zip.evaluate((el) => {
        const text = el.querySelector('span');
        if (text) text.textContent = 'Delivering to 15222';
      });
      // The accessible names changed with the texts, so find the same controls by their new names.
      const longZip = header.getByRole('button', {name: /Delivering to 15222/});
      const zipBox = await longZip.boundingBox();
      const barBox = await longZip
        .locator('xpath=ancestor::div[contains(@class,"bg-surface-muted")][1]')
        .boundingBox();
      note(
        info,
        `long texts ${width}`,
        JSON.stringify({zipBox, barHeight: barBox?.height}),
      );
      expect(barBox?.height ?? 999, 'utility bar height').toBeLessThanOrEqual(
        56,
      );
      expect(await overflowPx(page), 'horizontal overflow').toBeLessThanOrEqual(
        0,
      );
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
      // No sale card means nothing was measured: that must show as a skip with its reason, never as a pass.
      test.skip(
        rows.length === 0,
        `no sale product card (a compare-at price) on ${path} at ${width} px: the price-row rule has nothing to measure on this store`,
      );
      for (const r of rows) {
        expect(
          r.rows,
          `price rows of "${r.title}" (card ${r.width} px)`,
        ).toBeLessThanOrEqual(2);
      }
    });
  }

  // BV-002, the end of the strip: the gallery's thumbnail row scrolls once there are about five images, and the LAST
  // thumbnail is the one whose ring used to be cut off at the strip's right edge (scroll padding fix). A store without a
  // product of five or more images (and none with two or more) shows as a skip, not a pass. When the store has a product
  // with two to four images but none with five, the strip is padded to six thumbnails by cloning the last list item:
  // the clipping is decided by the strip's CSS (overflow, padding, scroll padding), not by the picture, so the clones
  // test the same geometry. That case is annotated "synthetic".
  test('BV-002 the focus ring of the LAST thumbnail of a strip of five or more images is not clipped at 360 px', async ({
    page,
  }, info) => {
    await page.setViewportSize({width: 360, height: 900});
    const thumbsOf = (p: Page) =>
      p.getByRole('button', {name: /^Show image \d+ of \d+/});
    let path: string | null = null;
    let synthetic = false;
    for (const [minimum, isSynthetic] of [
      [5, false],
      [2, true],
    ] as const) {
      try {
        path = await findProduct(
          page,
          '/collections/all',
          `a product with ${minimum} or more images`,
          async (p) => (await thumbsOf(p).count()) >= minimum,
        );
        synthetic = isSynthetic;
        break;
      } catch {
        path = null;
      }
    }
    test.skip(
      path === null,
      'no product on /collections/all has two or more images: there is no thumbnail strip on this store, so the end-of-strip ring cannot be measured',
    );
    await gotoReady(page, path ?? '/');
    const thumbs = thumbsOf(page);
    if (synthetic) {
      await thumbs
        .first()
        .locator('xpath=ancestor::ul[1]')
        .evaluate((ul) => {
          const items = Array.from(ul.children);
          const last = items[items.length - 1];
          while (last && ul.children.length < 6)
            ul.appendChild(last.cloneNode(true));
        });
    }
    const count = await thumbs.count();
    note(info, 'strip source', synthetic ? 'synthetic (cloned to 6)' : 'real');
    const strip = thumbs.first().locator('xpath=ancestor::ul[1]');
    const scrolls = await strip.evaluate(
      (el) => el.scrollWidth > el.clientWidth + 1,
    );
    note(
      info,
      'thumbnail strip',
      `${count} thumbnails at 360 px, scrolls=${scrolls}`,
    );
    // A strip of five or more thumbnails (64 px each) is wider than the 328 px column. It must scroll inside its own box
    // and leave the page alone (WCAG 1.4.10); if the column grows instead, the page scrolls sideways (BV-014).
    expect
      .soft(
        await overflowPx(page),
        `${count} thumbnails widen the product column and the page scrolls sideways (BV-014)`,
      )
      .toBeLessThanOrEqual(0);
    expect
      .soft(
        scrolls,
        'the strip scrolls inside its own box at 360 px (otherwise the end of the strip is not tested)',
      )
      .toBe(true);
    await page.keyboard.press('Tab');
    await thumbs.last().focus();
    const ring = await describeRing(page);
    note(info, 'last thumbnail ring', JSON.stringify(ring));
    expect(ring?.indicator).toBe(true);
    expect(
      ring?.clippedBy,
      'what clips the ring of the last thumbnail',
    ).toBeNull();
    // The ring rectangle lies fully inside the strip's box, on the right as well.
    const edge = await strip.evaluate((el) => el.getBoundingClientRect().right);
    expect(
      ring?.box.right ?? 999,
      'ring right edge inside the strip',
    ).toBeLessThanOrEqual(edge + 0.5);
  });

  // 320 px, buttons in flex rows: a label that is squeezed breaks inside a word ("Appl / y"). Measured per word.
  async function cartAt320(page: Page, baseURL: string | undefined) {
    await page.setViewportSize({width: 320, height: 800});
    // Dev-only hook (products.$handle.tsx): lets a flag-on dev server offer protection; a no-op elsewhere.
    await page.context().addCookies([
      {
        name: 'e2e_extend_eligible',
        value: '1',
        url: baseURL ?? 'http://localhost',
      },
    ]);
    const {product} = await catalogOf(page);
    await addToCart(page, product);
    await page.keyboard.press('Escape');
    await gotoReady(page, '/cart');
  }

  test('BV-008 family: the discount "Apply" button does not break inside a word at 320 px', async ({
    page,
    baseURL,
  }, info) => {
    await cartAt320(page, baseURL);
    const discount = page.getByRole('region', {name: 'Discount code'});
    await expect(discount.getByRole('button', {name: 'Apply'})).toBeVisible();
    const apply = discount.getByRole('button', {name: 'Apply'});
    const broken = await midWordBreaks(apply);
    const box = await apply.boundingBox();
    note(info, 'apply button 320', JSON.stringify({box, broken}));
    expect(broken, 'words of "Apply" split across lines').toEqual([]);
    expect(
      (box?.x ?? 0) + (box?.width ?? 999),
      'Apply stays inside the 320 px viewport',
    ).toBeLessThanOrEqual(320);
    expect(await overflowPx(page), 'horizontal overflow').toBeLessThanOrEqual(
      0,
    );
  });

  test('BV-008 family: the cart "Add protection" row does not break inside a word at 320 px', async ({
    page,
    baseURL,
  }, info) => {
    await cartAt320(page, baseURL);
    // The row exists only when Extend is on for the store (flag) and a line can take a plan.
    const addProtection = page.getByRole('button', {
      name: /^Add .+ protection for /,
    });
    const rows = await addProtection.count();
    note(info, 'add protection rows', String(rows));
    test.skip(
      rows === 0,
      'no "Add protection" row in the cart on this server (Extend flag off or no eligible line): nothing to measure; needs the flag-on server (.env.protection)',
    );
    const brokenRows = await midWordBreaks(
      page.getByRole('button', {name: /^Add .+ protection for /}),
    );
    const rowBox = await addProtection.first().boundingBox();
    expect(brokenRows, 'words of "Add protection" split across lines').toEqual(
      [],
    );
    expect(
      (rowBox?.x ?? 0) + (rowBox?.width ?? 999),
      'Add protection stays inside the 320 px viewport',
    ).toBeLessThanOrEqual(320);
    expect(await overflowPx(page), 'horizontal overflow').toBeLessThanOrEqual(
      0,
    );
  });
});

// Guard for the helper that every tab-walk test above relies on (NFR-003, WCAG 2.1.2 no keyboard trap). A "repeat" counts
// as completed only when it is the wrap-around to the FIRST stop; focus returning to any other earlier stop is a trap.
// Minimal pages built in the browser, no server pages involved.
test.describe('BA-10 guard: walkRings tells a closed loop from a keyboard trap (NFR-003, WCAG 2.1.2)', () => {
  const buttons = (script: string) => `
    <button id="a">First</button><button id="b">Second</button><button id="c">Third</button>
    <script>${script}</script>`;
  const lastTabGoesTo = (id: string) =>
    `document.getElementById('c').addEventListener('keydown', (e) => {
       if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); document.getElementById('${id}').focus(); }
     });`;

  test('focus that leaves the document completes the walk', async ({page}) => {
    await page.setContent(buttons(''));
    const walk = await walkRings(page, 20);
    expect(walk.stops.map((s) => s.label)).toEqual([
      expect.stringContaining('First'),
      expect.stringContaining('Second'),
      expect.stringContaining('Third'),
    ]);
    expect(walk.trap).toBeNull();
    expect(walk.completed).toBe(true);
  });

  test('a loop that closes on the FIRST stop (A, B, C, A) completes the walk', async ({
    page,
  }) => {
    await page.setContent(buttons(lastTabGoesTo('a')));
    const walk = await walkRings(page, 20);
    expect(walk.stops).toHaveLength(3);
    expect(walk.trap).toBeNull();
    expect(walk.completed).toBe(true);
  });

  test('a loop that closes on a LATER stop (A, B, C, B) is a trap: not completed, and it says where', async ({
    page,
  }) => {
    await page.setContent(buttons(lastTabGoesTo('b')));
    const walk = await walkRings(page, 20);
    expect(walk.stops).toHaveLength(3);
    expect(walk.completed).toBe(false);
    expect(walk.trap).toContain('Second');
    expect(walk.trap).toContain('not the first');
  });

  // Guard for midWordBreaks (used by the 320 px button checks): it must see a split word and leave a whole one alone.
  test('midWordBreaks reports a word split across two lines and not one that fits', async ({
    page,
  }) => {
    await page.setContent(
      `<style>b{display:inline-block;font:16px monospace}</style>
       <b id="split" style="width:40px;word-break:break-all">Apply</b>
       <b id="whole" style="width:120px">Apply</b>`,
    );
    expect(await midWordBreaks(page.locator('#split'))).toEqual(['Apply']);
    expect(await midWordBreaks(page.locator('#whole'))).toEqual([]);
  });

  // Guard for the painted-pixel sampler used for rings over images: same colour as the backdrop is 1:1, black on yellow is
  // high, and a rectangle outside the viewport gives no answer.
  test('samplePaintedContrast reads what is painted around a ring', async ({
    page,
  }) => {
    await page.setViewportSize({width: 400, height: 300});
    await page.setContent(
      `<body style="margin:0;background:rgb(255,203,71)"><div style="position:absolute;left:150px;top:100px;width:100px;height:40px;background:#fff"></div></body>`,
    );
    const box = {left: 140, top: 90, right: 260, bottom: 150};
    expect(
      await samplePaintedContrast(page, {ring: 'rgb(255,203,71)', box}),
    ).toBeCloseTo(1, 1);
    expect(
      await samplePaintedContrast(page, {ring: 'rgb(0,0,0)', box}),
    ).toBeGreaterThan(10);
    expect(
      await samplePaintedContrast(page, {
        ring: 'rgb(0,0,0)',
        box: {left: 900, top: 900, right: 950, bottom: 950},
      }),
    ).toBeNull();
  });

  test('a walk that never ends within max stops is not completed either', async ({
    page,
  }) => {
    await page.setContent(buttons(''));
    const walk = await walkRings(page, 2);
    expect(walk.stops).toHaveLength(2);
    expect(walk.completed).toBe(false);
    expect(walk.trap).toBeNull();
  });
});
