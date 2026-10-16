import {expect, test, type Locator, type Page} from '@playwright/test';

// P2-06 / NFR-001: the shell (home) and the component gallery at the four design widths, 360, 768, 1280 and
// 1536 px. Two layers:
//
//  1. Layout invariants (always on, any OS): nothing overflows sideways, the landmarks stack in order without
//     overlap, header controls do not overlap each other, and the key controls are visible. These do not depend
//     on fonts, so they are stable on every machine.
//  2. Pixel snapshots (opt in with E2E_VISUAL=1, Chromium desktop only): toHaveScreenshot per gallery section and
//     for the header and footer. They are OFF by default because no baseline images are committed: the shell
//     uses the system font stack (see styles/tailwind.css), so glyph shapes and widths differ between Windows,
//     macOS and the Linux CI image, and a baseline made on one fails on another. Generate baselines on the CI
//     image (`E2E_VISUAL=1 npx playwright test visual.spec.ts --project=desktop-chromium --update-snapshots`),
//     review them by eye (never auto-approve, phase 2 plan) and commit them, then run the same way in CI.

const WIDTHS = [360, 768, 1280, 1536] as const;
const PAGES = [
  {name: 'shell (home)', path: '/'},
  {name: 'component gallery', path: '/components'},
] as const;
const SNAPSHOT_OPTIONS = {
  animations: 'disabled',
  caret: 'hide',
  maxDiffPixelRatio: 0.01,
} as const;

async function gotoReady(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
}

type Rect = {top: number; bottom: number; left: number; right: number};

/** Position in the document (scroll included), so landmarks below the fold compare correctly. */
function documentRect(locator: Locator): Promise<Rect> {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      top: box.top + window.scrollY,
      bottom: box.bottom + window.scrollY,
      left: box.left,
      right: box.right,
    };
  });
}

test.describe('P2-06 layout invariants at the four design widths (NFR-001)', () => {
  test.skip(
    ({isMobile}) => isMobile,
    'The width is set explicitly, so the desktop project covers every width.',
  );

  for (const width of WIDTHS) {
    for (const {name, path} of PAGES) {
      test(`${name} at ${width} px: no sideways overflow, landmarks stack without overlap`, async ({
        page,
      }) => {
        await page.setViewportSize({width, height: 900});
        await gotoReady(page, path);

        const scroll = await page.evaluate(() => {
          const root = document.documentElement;
          // Pictures wider than the viewport are the usual cause of a sideways scrollbar.
          const wideImages = Array.from(document.querySelectorAll('img'))
            .filter(
              (image) =>
                image.getBoundingClientRect().right > root.clientWidth + 1,
            )
            .map((image) => image.currentSrc.slice(-40));
          return {overflow: root.scrollWidth - root.clientWidth, wideImages};
        });
        expect(scroll.overflow, 'overflow px').toBeLessThanOrEqual(0);
        expect(scroll.wideImages, 'wide images').toEqual([]);

        // One pixel of slack for sub-pixel rounding.
        const banner = await documentRect(page.getByRole('banner'));
        const main = await documentRect(page.getByRole('main'));
        const footer = await documentRect(page.getByRole('contentinfo'));
        const mainTop = main.top + 1;
        const footerTop = footer.top + 1;
        expect(banner.bottom, 'header above main').toBeLessThanOrEqual(mainTop);
        expect(main.bottom, 'main above footer').toBeLessThanOrEqual(footerTop);
        const rightLimit = width + 1;
        for (const [label, rect] of [
          ['header', banner],
          ['main', main],
          ['footer', footer],
        ] as const) {
          expect(rect.left, `${label} left`).toBeGreaterThanOrEqual(-1);
          expect(rect.right, `${label} right`).toBeLessThanOrEqual(rightLimit);
        }
      });
    }

    test(`header at ${width} px: key controls visible and none overlapping`, async ({
      page,
    }) => {
      await page.setViewportSize({width, height: 900});
      await gotoReady(page, '/');
      const header = page.getByRole('banner');
      const mainNav = page.getByRole('navigation', {name: 'Main'});

      await expect(
        header.getByRole('combobox', {name: 'Search products and pages'}),
      ).toBeVisible();
      await expect(header.getByRole('link', {name: 'Cart'})).toBeVisible();
      await expect(header.getByRole('link', {name: 'Sign in'})).toBeVisible();
      if (width < 1024) {
        // Below 1024 px the navigation lives in the drawer behind the Menu button.
        await expect(header.getByRole('button', {name: 'Menu'})).toBeVisible();
        await expect(mainNav).toBeHidden();
      } else {
        await expect(header.getByRole('button', {name: 'Menu'})).toBeHidden();
        await expect(mainNav).toBeVisible();
      }

      // Pairwise overlap of visible controls. A control that contains another (a field and its icon) is fine.
      const overlaps = await header.evaluate((root) => {
        const label = (element: HTMLElement) =>
          (element.getAttribute('aria-label') ?? element.textContent ?? '')
            .trim()
            .slice(0, 24);
        const controls = Array.from(
          root.querySelectorAll<HTMLElement>(
            'a[href], button, input:not([type="hidden"]), select',
          ),
        ).filter((element) =>
          element.checkVisibility({checkVisibilityCSS: true}),
        );
        const found: string[] = [];
        controls.forEach((a, index) => {
          const ra = a.getBoundingClientRect();
          for (const b of controls.slice(index + 1)) {
            if (a.contains(b) || b.contains(a)) continue;
            const rb = b.getBoundingClientRect();
            const overlapWidth =
              Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
            const overlapHeight =
              Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
            if (overlapWidth > 2 && overlapHeight > 2) {
              found.push(`${label(a)} / ${label(b)}`);
            }
          }
        });
        return found;
      });
      expect(overlaps, 'overlapping header controls').toEqual([]);
    });
  }
});

test.describe('P2-06 pixel snapshots (opt in: E2E_VISUAL=1, Chromium desktop)', () => {
  test.skip(
    ({browserName, isMobile}) =>
      process.env.E2E_VISUAL !== '1' || browserName !== 'chromium' || isMobile,
    'Off by default: no baselines are committed because the system font stack renders differently per OS. See the comment at the top of this file.',
  );

  for (const width of WIDTHS) {
    test(`gallery sections at ${width} px`, async ({page}) => {
      await page.emulateMedia({reducedMotion: 'reduce'});
      await page.setViewportSize({width, height: 900});
      await gotoReady(page, '/components');
      // Static content only: tokens, buttons, form controls and display components. Overlays and toasts need
      // interaction and are covered by behaviour tests.
      for (const id of ['g-tokens', 'g-buttons', 'g-forms', 'g-display']) {
        await expect(
          page.locator(`section[aria-labelledby="${id}"]`),
        ).toHaveScreenshot(`gallery-${id}-${width}.png`, SNAPSHOT_OPTIONS);
      }
    });

    test(`shell header and footer at ${width} px`, async ({page}) => {
      await page.emulateMedia({reducedMotion: 'reduce'});
      await page.setViewportSize({width, height: 900});
      await gotoReady(page, '/');
      // The header carries the delivery ZIP and store name, which come from cookies and the store list; a fresh
      // browser context has neither, so nothing dynamic is masked. Add a mask here if that ever changes.
      await expect(page.getByRole('banner')).toHaveScreenshot(
        `shell-header-${width}.png`,
        SNAPSHOT_OPTIONS,
      );
      await expect(page.getByRole('contentinfo')).toHaveScreenshot(
        `shell-footer-${width}.png`,
        SNAPSHOT_OPTIONS,
      );
    });
  }
});
