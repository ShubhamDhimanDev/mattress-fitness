import {expect, test, type Locator, type Page} from '@playwright/test';
import {
  collectConsoleErrors,
  expectNoSeriousA11yViolations,
} from './helpers/a11y';

// P2-06 / P2-07: the dev-only component gallery at /components (file app/routes/_dev.components.tsx; the
// leading underscore makes `_dev` a pathless layout segment). Proves the shared components are keyboard
// operable and accessible in every state (REQ-NAV-001, NFR-001, NFR-003). Production 404 is unit-tested in
// tests/unit/ui/galleryRoute.test.ts because the dev server cannot run in production mode.

async function gotoGallery(page: Page) {
  const response = await page.goto('/components');
  await page.waitForLoadState('networkidle');
  return response;
}

/** Click until the target shows; see shell.spec.ts. Only retries while the target is hidden. */
async function openUntilVisible(trigger: Locator, target: Locator) {
  await expect(async () => {
    if (!(await target.isVisible())) await trigger.click({timeout: 2_000});
    await expect(target).toBeVisible({timeout: 2_000});
  }).toPass({timeout: 15_000});
}

test.describe('component gallery: page', () => {
  test('renders in development, is not indexable and has no console errors', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    const response = await gotoGallery(page);
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole('heading', {level: 1, name: 'Component gallery'}),
    ).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex',
    );
    expect(errors).toEqual([]);
  });

  test('shows every component group', async ({page}) => {
    await gotoGallery(page);
    for (const title of [
      'Design tokens',
      'Typography (Plus Jakarta Sans)',
      'Buttons',
      'Form controls',
      'Display',
      'Cards and progress',
      'Selectors, accordion and tabs',
      'Dialog and drawers',
      'Toast notifications',
    ]) {
      await expect(
        page.getByRole('heading', {level: 2, name: title}),
      ).toBeVisible();
    }
  });

  test('has no serious or critical axe violations (every component and state)', async ({
    page,
  }) => {
    await gotoGallery(page);
    await expectNoSeriousA11yViolations(page);
  });
});

test.describe('component gallery: accordion keyboard', () => {
  test('Enter and Space toggle, arrows move between headers, single mode keeps one open', async ({
    page,
  }) => {
    await gotoGallery(page);
    const delivery = page.getByRole('button', {name: 'Delivery and shipping'});
    const warranty = page.getByRole('button', {name: 'Warranty', exact: true});
    const brand = page.getByRole('button', {name: 'About the brand'});

    await expect(delivery).toHaveAttribute('aria-expanded', 'true');
    await delivery.focus();
    await page.keyboard.press('Enter');
    await expect(delivery).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Space');
    await expect(delivery).toHaveAttribute('aria-expanded', 'true');
    await expect(
      page.getByText('Placeholder text about delivery options.'),
    ).toBeVisible();

    await page.keyboard.press('ArrowDown');
    await expect(warranty).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(warranty).toHaveAttribute('aria-expanded', 'true');
    await expect(delivery).toHaveAttribute('aria-expanded', 'false'); // single mode

    await page.keyboard.press('ArrowDown');
    await expect(brand).toBeFocused();
    // The disabled header is skipped: ArrowDown wraps to the first one.
    await page.keyboard.press('ArrowDown');
    await expect(delivery).toBeFocused();
    await page.keyboard.press('End');
    await expect(brand).toBeFocused();
    await page.keyboard.press('Home');
    await expect(delivery).toBeFocused();
  });

  test('multiple mode keeps several panels open', async ({page}) => {
    await gotoGallery(page);
    const first = page.getByRole('button', {name: 'First', exact: true});
    const second = page.getByRole('button', {name: 'Second', exact: true});
    const third = page.getByRole('button', {name: 'Third', exact: true});
    await expect(first).toHaveAttribute('aria-expanded', 'true');
    await expect(second).toHaveAttribute('aria-expanded', 'true');
    await third.focus();
    await page.keyboard.press('Enter');
    await expect(third).toHaveAttribute('aria-expanded', 'true');
    await expect(first).toHaveAttribute('aria-expanded', 'true');
  });

  test('a disabled header cannot be opened', async ({page}) => {
    await gotoGallery(page);
    await expect(
      page.getByRole('button', {name: 'Disabled section'}),
    ).toBeDisabled();
  });
});

test.describe('component gallery: dialog and drawers keyboard', () => {
  test('dialog: focus moves in, Tab is trapped, Escape closes and focus returns', async ({
    page,
  }) => {
    await gotoGallery(page);
    const trigger = page.getByRole('button', {name: 'Open dialog'});
    const dialog = page.getByRole('dialog', {name: 'Sample dialog'});
    await openUntilVisible(trigger, dialog);
    await expect(dialog).toHaveAccessibleDescription(
      'A short task in a centred panel.',
    );

    const close = dialog.getByRole('button', {name: 'Close'});
    const name = dialog.getByRole('textbox', {name: 'Your name'});
    const save = dialog.getByRole('button', {name: 'Save'});
    await expect(close).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(name).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(save).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused(); // wrapped, not escaped to the page behind
    await page.keyboard.press('Shift+Tab');
    await expect(save).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('dialog: the Save button closes it and focus returns', async ({
    page,
  }) => {
    await gotoGallery(page);
    const trigger = page.getByRole('button', {name: 'Open dialog'});
    const dialog = page.getByRole('dialog', {name: 'Sample dialog'});
    await openUntilVisible(trigger, dialog);
    await dialog.getByRole('button', {name: 'Save'}).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('dialog: pressing the backdrop closes it, pressing inside does not', async ({
    page,
  }) => {
    await gotoGallery(page);
    const trigger = page.getByRole('button', {name: 'Open dialog'});
    const dialog = page.getByRole('dialog', {name: 'Sample dialog'});
    await openUntilVisible(trigger, dialog);
    await dialog.getByRole('heading', {name: 'Sample dialog'}).click();
    await expect(dialog).toBeVisible();
    await page.mouse.click(4, 4); // top-left corner is backdrop
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  for (const side of ['right', 'left'] as const) {
    test(`${side} drawer: focus trap, Escape and focus return`, async ({
      page,
    }) => {
      await gotoGallery(page);
      const trigger = page.getByRole('button', {name: `Open ${side} drawer`});
      const drawer = page.getByRole('dialog', {
        name: `${side === 'left' ? 'Left' : 'Right'} drawer`,
      });
      await openUntilVisible(trigger, drawer);

      await expect(drawer.getByRole('button', {name: 'Close'})).toBeFocused();
      for (let press = 0; press < 6; press += 1) {
        await page.keyboard.press('Tab');
        expect(
          await drawer.evaluate((element) =>
            element.contains(document.activeElement),
          ),
          `focus inside the ${side} drawer after Tab ${press + 1}`,
        ).toBe(true);
      }
      expect(await page.evaluate(() => document.body.style.overflow)).toBe(
        'hidden',
      );

      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();
      await expect(trigger).toBeFocused();
      expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    });
  }

  test('the page behind an open dialog is not reachable', async ({page}) => {
    await gotoGallery(page);
    const trigger = page.getByRole('button', {name: 'Open dialog'});
    const dialog = page.getByRole('dialog', {name: 'Sample dialog'});
    await openUntilVisible(trigger, dialog);
    // The gallery content is inert while the dialog is open, so nothing behind it is tabbable or clickable.
    const inertCount = await page.evaluate(
      () => document.querySelectorAll('body > [inert]').length,
    );
    expect(inertCount).toBeGreaterThan(0);
  });

  test('has no serious or critical axe violations with the dialog open', async ({
    page,
  }) => {
    await gotoGallery(page);
    const dialog = page.getByRole('dialog', {name: 'Sample dialog'});
    await openUntilVisible(
      page.getByRole('button', {name: 'Open dialog'}),
      dialog,
    );
    await expectNoSeriousA11yViolations(page);
  });

  test('has no serious or critical axe violations with a drawer open', async ({
    page,
  }) => {
    await gotoGallery(page);
    const drawer = page.getByRole('dialog', {name: 'Right drawer'});
    await openUntilVisible(
      page.getByRole('button', {name: 'Open right drawer'}),
      drawer,
    );
    await expectNoSeriousA11yViolations(page);
  });
});

// P2-03: the toast component. Timing rules (default, minimum, pause on hover and focus) are unit-tested with fake
// timers in tests/unit/ui/Toast.test.tsx; here the browser proves the live regions, the dismiss paths and axe.
test.describe('component gallery: toast notifications', () => {
  const politeRegion = (page: Page) =>
    page.locator('[data-toast-region="status"]');
  const assertiveRegion = (page: Page) =>
    page.locator('[data-toast-region="alert"]');

  test('both live regions are in the page before any toast, with the right politeness', async ({
    page,
  }) => {
    await gotoGallery(page);
    await expect(politeRegion(page)).toHaveAttribute('role', 'status');
    await expect(politeRegion(page)).toHaveAttribute('aria-live', 'polite');
    await expect(assertiveRegion(page)).toHaveAttribute('role', 'alert');
    await expect(assertiveRegion(page)).toHaveAttribute(
      'aria-live',
      'assertive',
    );
    await expect(politeRegion(page)).toBeEmpty();
    await expect(assertiveRegion(page)).toBeEmpty();
  });

  test('a success toast appears in the polite region and the dismiss button closes it', async ({
    page,
  }) => {
    await gotoGallery(page);
    const toast = politeRegion(page).getByText('Queen mattress');
    await openUntilVisible(
      page.getByRole('button', {name: 'Show success toast'}),
      toast,
    );
    await expect(politeRegion(page).getByText('Added to cart')).toBeVisible();
    await expect(assertiveRegion(page)).toBeEmpty();

    await politeRegion(page)
      .getByRole('button', {name: 'Dismiss notification'})
      .click();
    await expect(toast).toBeHidden();
  });

  test('an error toast appears in the assertive region, stays, and Escape on its button closes it', async ({
    page,
  }) => {
    await gotoGallery(page);
    const toast = assertiveRegion(page).getByText('Please try again.');
    await openUntilVisible(
      page.getByRole('button', {name: 'Show error toast'}),
      toast,
    );
    await expect(politeRegion(page)).toBeEmpty();

    const dismiss = assertiveRegion(page).getByRole('button', {
      name: 'Dismiss notification',
    });
    await dismiss.focus();
    await page.keyboard.press('Escape');
    await expect(toast).toBeHidden();
  });

  test('an info toast is not red: its frame differs from the error toast and is neutral', async ({
    page,
  }) => {
    await gotoGallery(page);
    const info = politeRegion(page).getByText('Your choice was saved.');
    const error = assertiveRegion(page).getByText('Please try again.');
    await openUntilVisible(
      page.getByRole('button', {name: 'Show info toast'}),
      info,
    );
    await openUntilVisible(
      page.getByRole('button', {name: 'Show error toast'}),
      error,
    );
    const border = (text: typeof info) =>
      text
        .locator('xpath=ancestor::*[@data-toast-variant][1]')
        .evaluate((node) => getComputedStyle(node).borderTopColor);
    const infoBorder = await border(info);
    const errorBorder = await border(error);
    expect(infoBorder).not.toBe(errorBorder);
    // Neutral: the red channel does not dominate (ink-900 is 20, 20, 20; the error frame is clearly red).
    const [r = 0, g = 0, b = 0] = (infoBorder.match(/d+/g) ?? []).map(Number);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(10);
  });

  test('a toast closes by itself after a few seconds', async ({page}) => {
    await gotoGallery(page);
    const toast = politeRegion(page).getByText('Your choice was saved.');
    await openUntilVisible(
      page.getByRole('button', {name: 'Show info toast'}),
      toast,
    );
    await expect(toast).toBeHidden({timeout: 10_000}); // default 6 s
  });

  test('has no serious or critical axe violations with all four variants showing', async ({
    page,
  }) => {
    await gotoGallery(page);
    const lastToast = assertiveRegion(page).getByText('Please try again.');
    await openUntilVisible(
      page.getByRole('button', {name: 'Show info toast'}),
      politeRegion(page).getByText('Your choice was saved.'),
    );
    for (const name of [
      'Show success toast',
      'Show warning toast',
      'Show error toast',
    ]) {
      await page.getByRole('button', {name}).click();
    }
    await expect(lastToast).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });
});

test.describe('component gallery: selectors, stepper and tabs keyboard', () => {
  test('size selector: arrow keys move the selection and skip sold-out sizes; dimensions follow', async ({
    page,
  }) => {
    await gotoGallery(page);
    // The legend carries the selected size, so match either name: it changes as the selection moves.
    const group = page.getByRole('group', {name: /^Size: (Queen|Twin)$/});
    await expect(group.getByText('60" x 80"')).toBeVisible();

    const queen = group.getByRole('radio', {name: 'Queen'});
    await queen.focus();
    // King and Cal King are disabled, so the next enabled size after Queen is Twin (wraps).
    await page.keyboard.press('ArrowRight');
    await expect(
      group.getByRole('radio', {name: 'Twin', exact: true}),
    ).toBeChecked();
    await expect(group.getByText('38" x 75"')).toBeVisible();
    await expect(group).toHaveAccessibleName('Size: Twin');
  });

  test('size selector: sold-out sizes are disabled and say why', async ({
    page,
  }) => {
    await gotoGallery(page);
    const group = page.getByRole('group', {name: /^Size: Queen$/});
    await expect(
      group.getByRole('radio', {name: 'King Sold out'}),
    ).toBeDisabled();
    await expect(
      group.getByRole('radio', {name: 'Cal King Out of stock'}),
    ).toBeDisabled();
  });

  test('size selector: with nothing selected no radio is checked and the error is announced', async ({
    page,
  }) => {
    await gotoGallery(page);
    const group = page.getByRole('group', {name: /^Size \(nothing selected/});
    await expect(group.getByRole('radio', {checked: true})).toHaveCount(0);
    await expect(group.getByText('Choose a size to continue.')).toBeVisible();
    await expect(group).toHaveAccessibleDescription(
      'Choose a size to continue.',
    );
  });

  test('quantity stepper: buttons and arrow keys change the value within limits', async ({
    page,
  }) => {
    await gotoGallery(page);
    const input = page.getByRole('textbox', {
      name: 'Quantity of Queen mattress',
    });
    await expect(input).toHaveValue('2');
    await page
      .getByRole('button', {name: 'Increase quantity of Queen mattress'})
      .click();
    await expect(input).toHaveValue('3');
    await input.press('ArrowDown');
    await input.press('ArrowDown');
    await input.press('ArrowDown');
    await expect(input).toHaveValue('1'); // not below the minimum
    await input.fill('500');
    await input.press('Enter');
    await expect(input).toHaveValue('99'); // clamped to the UI maximum (the server holds the real limit)
  });

  test('tabs: arrows, Home and End move and select; only the selected tab is in the tab order', async ({
    page,
  }) => {
    await gotoGallery(page);
    const overview = page.getByRole('tab', {name: 'Overview'});
    const specs = page.getByRole('tab', {name: 'Specifications'});
    const reviews = page.getByRole('tab', {name: 'Reviews'});

    await overview.focus();
    await expect(overview).toHaveAttribute('aria-selected', 'true');
    await expect(specs).toHaveAttribute('tabindex', '-1');
    await page.keyboard.press('ArrowRight');
    await expect(specs).toBeFocused();
    await expect(specs).toHaveAttribute('aria-selected', 'true');
    await expect(
      page.getByRole('tabpanel', {name: 'Specifications'}),
    ).toContainText('Specs text.');
    await page.keyboard.press('End');
    await expect(reviews).toBeFocused();
    await page.keyboard.press('ArrowRight'); // wraps
    await expect(overview).toBeFocused();
    await page.keyboard.press('ArrowLeft'); // wraps back
    await expect(reviews).toBeFocused();
  });

  test('buttons: loading ignores clicks but stays focusable; disabled is not focusable', async ({
    page,
  }) => {
    await gotoGallery(page);
    const loading = page.getByRole('button', {name: /Add to cart/}).first();
    await expect(loading).toHaveAttribute('aria-busy', 'true');
    await expect(loading).toHaveAttribute('aria-disabled', 'true');
    await loading.focus();
    await expect(loading).toBeFocused();
    await expect(
      page.getByRole('button', {name: 'Primary', exact: true}).first(),
    ).toBeEnabled();
    await expect(
      page.getByRole('button', {name: 'Primary', exact: true}).nth(1),
    ).toBeDisabled();
  });

  test('buttons: a link-style button renders an anchor with the href', async ({
    page,
  }) => {
    await gotoGallery(page);
    await expect(page.getByRole('link', {name: 'Router link'})).toHaveAttribute(
      'href',
      '/collections/mattresses',
    );
    await expect(
      page.getByRole('link', {name: 'Plain anchor'}),
    ).toHaveAttribute('href', 'tel:+18005550100');
  });
});

// BA-01 / BA-03: the brand palette applied to the shared primitives. Colours are asserted as computed values (the
// logo red is rgb(222, 5, 16); contrast of every pair is checked by tests/unit/ui/contrast.test.ts), because a class
// name alone would not catch a token that resolves to the wrong value.
test.describe('component gallery: brand states (BA-03)', () => {
  const RED = 'rgb(222, 5, 16)';
  const RED_HOVER = 'rgb(196, 4, 14)';
  const RED_PRESSED = 'rgb(168, 3, 12)';
  const FOCUS_BLUE = 'rgb(31, 79, 216)';
  const FOCUS_YELLOW = 'rgb(255, 203, 71)';

  test('the primary button is the logo red, heavier on hover and again when pressed', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'Hover and press are pointer states.');
    await gotoGallery(page);
    const primary = page
      .getByRole('button', {name: 'Primary', exact: true})
      .first();
    await expect(primary).toHaveCSS('background-color', RED);
    await expect(primary).toHaveCSS('color', 'rgb(255, 255, 255)');
    // CR-31: bold sentence-case labels, 48 px high, 12 px radius.
    await expect(primary).toHaveCSS('text-transform', 'none');
    await expect(primary).toHaveCSS('font-weight', '700');
    await expect(primary).toHaveCSS('border-top-left-radius', '12px');
    expect((await primary.boundingBox())?.height).toBeGreaterThanOrEqual(47.5);

    await primary.hover();
    await expect(primary).toHaveCSS('background-color', RED_HOVER);
    await page.mouse.down();
    await expect(primary).toHaveCSS('background-color', RED_PRESSED);
    await page.mouse.up();
  });

  test('the secondary button hovers to a red tint and keeps red text', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'Hover is a pointer state.');
    await gotoGallery(page);
    const secondary = page
      .getByRole('button', {name: 'Secondary', exact: true})
      .first();
    await expect(secondary).toHaveCSS('color', 'rgb(168, 3, 12)');
    await secondary.hover();
    await expect(secondary).toHaveCSS('background-color', 'rgb(255, 241, 241)');
  });

  test('a disabled button is dimmed and not focusable', async ({page}) => {
    await gotoGallery(page);
    const disabled = page
      .getByRole('button', {name: 'Accent', exact: true})
      .nth(2);
    await expect(disabled).toBeDisabled();
    await expect(disabled).toHaveCSS('opacity', '0.6');
  });

  test('focus-visible: a blue ring on white, a yellow ring on the red band', async ({
    page,
  }) => {
    await gotoGallery(page);
    const onWhite = page
      .getByRole('button', {name: 'Primary', exact: true})
      .first();
    await onWhite.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(onWhite).toBeFocused();
    await expect(onWhite).toHaveCSS('outline-color', FOCUS_BLUE);
    await expect(onWhite).toHaveCSS('outline-style', 'solid');

    const band = page.getByRole('group', {name: 'Buttons on a red band'});
    const inverse = band.getByRole('button', {name: 'Inverse', exact: true});
    await inverse.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(inverse).toBeFocused();
    await expect(inverse).toHaveCSS('outline-color', FOCUS_YELLOW);
  });

  test('inverse buttons: white fill with red text; the outline variant is white on red and inverts on hover', async ({
    page,
    isMobile,
  }) => {
    await gotoGallery(page);
    const band = page.getByRole('group', {name: 'Buttons on a red band'});
    await expect(band).toHaveCSS('background-color', RED);
    const inverse = band.getByRole('button', {name: 'Inverse', exact: true});
    await expect(inverse).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(inverse).toHaveCSS('color', 'rgb(168, 3, 12)');

    const outline = band.getByRole('button', {
      name: 'Inverse outline',
      exact: true,
    });
    await expect(outline).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(outline).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    if (!isMobile) {
      await outline.hover();
      await expect(outline).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(outline).toHaveCSS('color', 'rgb(168, 3, 12)');
    }
  });

  test('the cart count bubble is brand red with white text', async ({page}) => {
    await gotoGallery(page);
    const bubble = page
      .getByRole('button', {name: 'Cart, 3 items'})
      .getByText('3', {exact: true});
    await expect(bubble).toHaveCSS('background-color', RED);
    await expect(bubble).toHaveCSS('color', 'rgb(255, 255, 255)');
  });

  test('the sale badge is amber with near-black text; the sale price is burnt orange, not red', async ({
    page,
  }) => {
    await gotoGallery(page);
    const badge = page.getByText('Save $200', {exact: true});
    await expect(badge).toHaveCSS('background-color', 'rgb(246, 180, 20)');
    await expect(badge).toHaveCSS('color', 'rgb(20, 20, 20)');
    const salePrice = page.locator('span.text-sale-fg').first();
    await expect(salePrice).toHaveCSS('color', 'rgb(161, 64, 0)');
  });

  test('size selector: the selected size is red with a check icon; two columns at 320 px, three at 360 px', async ({
    page,
  }) => {
    await page.setViewportSize({width: 320, height: 800});
    await gotoGallery(page);
    const group = page.getByRole('group', {name: /^Size: Queen$/});
    const queen = group.locator('label', {hasText: 'Queen'});
    await expect(queen).toHaveCSS('background-color', RED);
    await expect(queen).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(queen.locator('svg')).toHaveCount(1);
    await expect(
      group.locator('label', {hasText: 'Twin'}).locator('svg'),
    ).toHaveCount(0);

    const columns = () =>
      group
        .locator('div.grid')
        .evaluate(
          (grid) =>
            getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        );
    expect(await columns()).toBe(2);
    await page.setViewportSize({width: 360, height: 800});
    await expect.poll(columns).toBe(3);
  });
});

// CR-31 R1/R2: the redesign tokens and primitives as the browser computes them (the class contracts are unit-tested in
// tests/unit/ui/redesignPrimitives.test.tsx and fontAndTypeTokens.test.ts; computed values catch a token that resolves
// to the wrong thing).
test.describe('component gallery: redesign foundation (CR-31)', () => {
  test('the self-hosted Plus Jakarta Sans loads and is the body font; no third-party font request is made', async ({
    page,
  }) => {
    const fontRequests: string[] = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'font') fontRequests.push(request.url());
    });
    await gotoGallery(page);
    await expect(page.locator('body')).toHaveCSS(
      'font-family',
      /Plus Jakarta Sans/,
    );
    const loaded = await page.evaluate(async () => {
      await document.fonts.ready;
      return document.fonts.check("800 16px 'Plus Jakarta Sans'");
    });
    expect(loaded).toBe(true);
    expect(fontRequests.length).toBeGreaterThan(0);
    for (const url of fontRequests) {
      expect(new URL(url).origin).toBe(new URL(page.url()).origin);
    }
  });

  test('type-display is heavy, tight and not upper-cased; the eyebrow is capitals; the mark is red with white text', async ({
    page,
  }) => {
    await gotoGallery(page);
    const display = page.locator('p.type-display', {
      hasText: 'Shop by size (heading, 40)',
    });
    await expect(display).toHaveCSS('font-weight', '800');
    await expect(display).toHaveCSS('text-transform', 'none');
    await expect(display).toHaveCSS('font-size', '40px');
    const eyebrow = page.locator('p.type-eyebrow', {
      hasText: 'Sleep better, shop smarter',
    });
    await expect(eyebrow).toHaveCSS('text-transform', 'uppercase');
    await expect(eyebrow).toHaveCSS('font-size', '13px');
    await expect(eyebrow).toHaveCSS('color', 'rgb(168, 3, 12)');
    const mark = page.locator('span.type-mark').first();
    await expect(mark).toHaveCSS('background-color', 'rgb(222, 5, 16)');
    await expect(mark).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(mark).toHaveCSS('border-top-left-radius', '10px');
  });

  test('an eyebrow on a dark band can be recoloured with a text utility', async ({
    page,
  }) => {
    await gotoGallery(page);
    const onDark = page.locator('p.type-eyebrow', {
      hasText: 'Eyebrow on a dark band',
    });
    await expect(onDark).toHaveCSS('color', 'rgb(255, 134, 138)');
  });

  test('tokens resolve: paper, hairline, radii, lift shadow and the 1400 px page width', async ({
    page,
  }) => {
    await gotoGallery(page);
    const swatch = (name: string) =>
      page.locator('li', {hasText: new RegExp(`^${name}`)}).first();
    await expect(swatch('paper \\(surface-muted\\)')).toHaveCSS(
      'background-color',
      'rgb(247, 244, 239)',
    );
    await expect(swatch('paper-line')).toHaveCSS(
      'background-color',
      'rgb(230, 226, 220)',
    );
    const radii = {
      'rounded-sm': '8px',
      'rounded-choice': '12px',
      'rounded-card': '18px',
      'rounded-panel': '24px',
      'rounded-hero': '28px',
    };
    for (const [name, px] of Object.entries(radii)) {
      await expect(
        page.getByRole('listitem').filter({hasText: new RegExp(`^${name}$`)}),
      ).toHaveCSS('border-top-left-radius', px);
    }
    const lift = page
      .getByRole('listitem')
      .filter({hasText: 'shadow-lift (raised card)'});
    await expect(lift).toHaveCSS(
      'box-shadow',
      /rgba\(20, 20, 20, 0\.18\) 0px 12px 40px -12px$/,
    );
    const pageWidth = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.className = 'max-w-page';
      document.body.append(probe);
      const width = getComputedStyle(probe).maxWidth;
      probe.remove();
      return width;
    });
    expect(pageWidth).toBe('1400px');
  });

  test('the large button is 56 px, fields are 52 px, the stepper buttons are 46 px', async ({
    page,
    isMobile,
  }) => {
    test.skip(
      isMobile,
      'Sizes are the same on both profiles; one run is enough.',
    );
    await gotoGallery(page);
    const large = page.getByRole('button', {name: 'Checkout securely'}).first();
    expect((await large.boundingBox())?.height).toBeCloseTo(56, 0);
    const email = page.getByRole('textbox', {name: 'Email'});
    expect((await email.boundingBox())?.height).toBeCloseTo(52, 0);
    await expect(email).toHaveCSS('border-top-width', '2px');
    await expect(email).toHaveCSS('border-top-color', 'rgb(140, 140, 140)');
    const plus = page.getByRole('button', {
      name: 'Increase quantity of Queen mattress',
    });
    const box = await plus.boundingBox();
    expect(box?.width).toBeCloseTo(46, 0);
    expect(box?.height).toBeCloseTo(46, 0);
  });

  test('the progress bar exposes its value and the fill widens to match', async ({
    page,
  }) => {
    await gotoGallery(page);
    const bar = page.getByRole('progressbar', {
      name: 'Progress to free delivery',
      exact: true,
    });
    await expect(bar).toHaveAttribute('aria-valuenow', '70');
    await expect(bar).toHaveAttribute('aria-valuemin', '0');
    await expect(bar).toHaveAttribute('aria-valuemax', '100');
    const widths = await bar.evaluate((element) => {
      const fill = element.firstElementChild;
      return fill
        ? [
            fill.getBoundingClientRect().width,
            element.getBoundingClientRect().width,
          ]
        : [0, 1];
    });
    const [fill = 0, track = 1] = widths;
    expect(fill / track).toBeCloseTo(0.7, 1);
    await expect(bar).toHaveCSS('height', '10px');
  });

  test('cards: the gift card has a dashed amber border; a tab shows the 4 px red bar', async ({
    page,
  }) => {
    await gotoGallery(page);
    const gift = page.locator('section[aria-labelledby="g-card-gift"]');
    await expect(gift).toHaveCSS('border-top-style', 'dashed');
    await expect(gift).toHaveCSS('border-top-color', 'rgb(246, 180, 20)');
    await expect(gift).toHaveCSS('border-top-left-radius', '18px');
    const tab = page.getByRole('tab', {name: 'Overview'});
    await expect(tab).toHaveCSS('border-bottom-width', '4px');
    await expect(tab).toHaveCSS('border-bottom-color', 'rgb(222, 5, 16)');
  });

  test('the drawer is 440 px wide, has the count chip and keeps its footer in view', async ({
    page,
  }) => {
    await page.setViewportSize({width: 1280, height: 800});
    await gotoGallery(page);
    const drawer = page.getByRole('dialog', {name: 'Right drawer'});
    await openUntilVisible(
      page.getByRole('button', {name: 'Open right drawer'}),
      drawer,
    );
    await expect(drawer).toContainText('3 items');
    const box = await drawer.boundingBox();
    expect(box?.width).toBeCloseTo(440, 0);
    await expect(
      drawer.getByRole('button', {name: 'Checkout securely'}),
    ).toBeInViewport();
    const close = drawer.getByRole('button', {name: 'Close'});
    await expect(close).toHaveCSS('border-top-left-radius', '9999px');
    const closeBox = await close.boundingBox();
    expect(closeBox?.width).toBeCloseTo(44, 0);
    expect(closeBox?.height).toBeCloseTo(44, 0);
  });
});
