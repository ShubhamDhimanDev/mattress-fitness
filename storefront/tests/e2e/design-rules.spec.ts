import {expect, test, type Locator, type Page} from '@playwright/test';

// P2-07 / NFR-001 / NFR-003: two design rules that unit tests cannot see because jsdom has no layout or media
// queries: touch targets of at least 44 px, and no motion when the shopper asks for reduced motion. Both run on
// the dev-only component gallery (/components), which shows every shared component in each state.

async function gotoGallery(page: Page) {
  await page.goto('/components');
  await page.waitForLoadState('networkidle');
}

/** Click until the target shows; see shell.spec.ts. Only retries while the target is hidden. */
async function openUntilVisible(trigger: Locator, target: Locator) {
  await expect(async () => {
    if (!(await target.isVisible())) await trigger.click({timeout: 2_000});
    await expect(target).toBeVisible({timeout: 2_000});
  }).toPass({timeout: 15_000});
}

type Undersized = {name: string; width: number; height: number};

/**
 * Interactive elements inside <main> whose tappable box is under 44 px. Rules applied (documented in
 * app/styles/tailwind.css, `--spacing-touch`):
 *  - every control is at least 44 px high;
 *  - it is also at least 44 px wide, except a text link, whose width follows its words (WCAG 2.5.8 allows it and
 *    the 44 px height keeps stacked links easy to hit);
 *  - a checkbox or radio is measured by its label row, which is the clickable area (the size selector hides the
 *    native radio and draws the label as the button).
 */
async function undersizedTargets(page: Page): Promise<Undersized[]> {
  return page.getByRole('main').evaluate((main) => {
    const MIN = 44;
    const TOLERANCE = 0.5; // sub-pixel rounding
    const selector =
      'a[href], button, input:not([type="hidden"]), select, textarea, summary';
    const found: Array<{name: string; width: number; height: number}> = [];

    for (const element of Array.from(
      main.querySelectorAll<HTMLElement>(selector),
    )) {
      if (!element.checkVisibility({checkVisibilityCSS: true})) continue;

      let box: HTMLElement = element;
      if (
        element instanceof HTMLInputElement &&
        (element.type === 'checkbox' || element.type === 'radio')
      ) {
        const label = element.labels?.[0];
        if (label) box = label;
      }
      const rect = box.getBoundingClientRect();
      const isTextLink =
        element.tagName === 'A' && (element.textContent ?? '').trim() !== '';

      const tooShort = rect.height < MIN - TOLERANCE;
      const tooNarrow = !isTextLink && rect.width < MIN - TOLERANCE;
      if (tooShort || tooNarrow) {
        found.push({
          name: (
            element.getAttribute('aria-label') ??
            element.textContent ??
            element.tagName
          )
            .trim()
            .slice(0, 40),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }
    }
    return found;
  });
}

test.describe('P2-07 touch targets (NFR-001)', () => {
  test.skip(
    ({isMobile}) => !isMobile,
    'Touch targets matter on the phone profile; the width is set to 360 px below.',
  );

  test('every interactive element of the gallery is at least 44 px at 360 px', async ({
    page,
  }) => {
    await page.setViewportSize({width: 360, height: 800});
    await gotoGallery(page);
    expect(await undersizedTargets(page), 'targets under 44 px').toEqual([]);
  });

  test('a toast and its dismiss button are touch sized', async ({page}) => {
    await page.setViewportSize({width: 360, height: 800});
    await gotoGallery(page);
    const dismiss = page
      .locator('[data-toast-region="alert"]')
      .getByRole('button', {name: 'Dismiss notification'});
    await openUntilVisible(
      page.getByRole('button', {name: 'Show error toast'}),
      dismiss,
    );
    const box = await dismiss.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(43.5);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5);
    expect(await undersizedTargets(page), 'targets under 44 px').toEqual([]);
  });
});

/** Elements whose animation or transition would still last 1 ms or longer, as short descriptions. */
async function movingElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    // Computed durations are lists in seconds ("0.15s, 0.15s"; "1e-05s" once reduced motion shortens them).
    const seconds = (list: string) =>
      list.split(',').map((part) => Number.parseFloat(part));
    const moving: string[] = [];
    const scope = document.querySelectorAll('main *, [data-overlay-host] *');
    for (const element of Array.from(scope)) {
      const style = getComputedStyle(element);
      const animates =
        style.animationName !== 'none' &&
        seconds(style.animationDuration).some((value) => value >= 0.001);
      const transitions =
        style.transitionProperty !== 'none' &&
        seconds(style.transitionDuration).some((value) => value >= 0.001);
      if (animates || transitions) {
        moving.push(
          `${element.tagName.toLowerCase()} ${String(element.className).slice(0, 70)}`,
        );
      }
    }
    return moving;
  });
}

test.describe('P2-07 reduced motion (NFR-003, WCAG 2.3.3)', () => {
  test('control: with no preference the gallery does animate and transition (so the check below can fail)', async ({
    page,
  }) => {
    await page.emulateMedia({reducedMotion: 'no-preference'});
    await gotoGallery(page);
    const skeleton = page.locator('main [class*="animate-pulse"]').first();
    await expect(skeleton).toHaveCSS('animation-name', 'pulse');
    expect((await movingElements(page)).length).toBeGreaterThan(0);
  });

  test('with reduced motion nothing in the gallery animates or transitions', async ({
    page,
  }) => {
    await page.emulateMedia({reducedMotion: 'reduce'});
    await gotoGallery(page);
    await expect(
      page.locator('main [class*="animate-pulse"]').first(),
    ).toHaveCSS('animation-name', 'none');
    expect(await movingElements(page), 'moving elements').toEqual([]);
  });

  test('with reduced motion an opened dialog, drawer and toast do not animate', async ({
    page,
  }) => {
    await page.emulateMedia({reducedMotion: 'reduce'});
    await gotoGallery(page);

    const dialog = page.getByRole('dialog', {name: 'Sample dialog'});
    await openUntilVisible(
      page.getByRole('button', {name: 'Open dialog'}),
      dialog,
    );
    expect(await movingElements(page), 'dialog open').toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    const drawer = page.getByRole('dialog', {name: 'Right drawer'});
    await openUntilVisible(
      page.getByRole('button', {name: 'Open right drawer'}),
      drawer,
    );
    expect(await movingElements(page), 'drawer open').toEqual([]);
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();

    await openUntilVisible(
      page.getByRole('button', {name: 'Show warning toast'}),
      page.locator('[data-toast-region="status"]').getByText('Only 2 left'),
    );
    expect(await movingElements(page), 'toast showing').toEqual([]);
  });
});
