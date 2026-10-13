import {expect, test, type Page} from '@playwright/test';
import {
  collectConsoleErrors,
  expectNoSeriousA11yViolations,
} from './helpers/a11y';

// P6-05 / P6-11: product comparison. REQ-CMP-001 (select up to four, the six attributes, mobile layout,
// selection kept), NFR-001 (no page-level horizontal scroll at 360 px), NFR-003 (axe, labelled scroll region).
// The data is the preview fixtures (all one product type, so the "different category" rule is covered by the
// unit tests in tests/unit/pages/compare-view.test.ts).

const A = 'wrenfield-solace-plush-memory-foam';
const B = 'wrenfield-solace-medium-memory-foam';
const C = 'larkmoor-cedar-medium-hybrid';
const D = 'larkmoor-cedar-plush-hybrid';

async function gotoReady(page: Page, url: string) {
  const response = await page.goto(url);
  await page.waitForLoadState('networkidle');
  return response;
}

const picker = (page: Page) =>
  page.getByRole('group', {name: 'Choose products to compare'});
const box = (page: Page, title: RegExp) =>
  picker(page).getByRole('checkbox', {name: title});

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, 'page-level horizontal overflow in px').toBeLessThanOrEqual(
    0,
  );
}

test.describe('REQ-CMP-001 empty state', () => {
  test('explains what to do, lists products, is accessible and quiet', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    const response = await gotoReady(page, '/compare');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', {level: 1})).toHaveCount(1);
    await expect(
      page.getByText('You have not chosen any products yet.'),
    ).toBeVisible();
    await expect(picker(page).getByRole('checkbox')).not.toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
    expect(errors, 'console errors').toEqual([]);
  });
});

test.describe('REQ-CMP-001 selecting and removing', () => {
  test('choosing two products shows the table with all six attributes', async ({
    page,
  }) => {
    await gotoReady(page, '/compare');
    await box(page, /Solace Plush Memory Foam/).click();
    await box(page, /Cedar Medium Hybrid/).click();
    await expect(page).toHaveURL(new RegExp(`handles=${A},${C}`));

    const table = page.getByRole('table');
    await expect(
      table.getByRole('columnheader', {name: /Solace Plush Memory Foam/}),
    ).toBeVisible();
    for (const row of [
      'Rating',
      'Price',
      'Comfort level',
      'Mattress type',
      'Height',
      'Benefits',
    ]) {
      await expect(table.getByRole('rowheader', {name: row})).toBeVisible();
    }
    // Cells are tied to their row and column headers for screen readers.
    await expect(
      table
        .getByRole('row', {name: /Comfort level/})
        .getByRole('cell')
        .first(),
    ).toHaveText('Plush');
    await expect(
      table.getByRole('cell').filter({hasText: 'Hybrid'}),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('Remove takes a product out and the last removal returns to the empty state', async ({
    page,
  }) => {
    await gotoReady(page, `/compare?handles=${A},${B}`);
    await expect(page.getByRole('columnheader')).toHaveCount(3);
    await page
      .getByRole('link', {name: /Remove Wrenfield Solace Plush/})
      .click();
    await expect(page).toHaveURL(new RegExp(`handles=${B}$`));
    await expect(page.getByRole('columnheader')).toHaveCount(2);
    await expect(
      page.getByRole('heading', {name: 'Your comparison'}),
    ).toBeFocused();
    await expect(
      page.getByText('Add at least one more product to compare.'),
    ).toBeVisible();

    await page
      .getByRole('link', {name: /Remove Wrenfield Solace Medium/})
      .click();
    await expect(
      page.getByText('You have not chosen any products yet.'),
    ).toBeVisible();
  });

  test('the fifth product is refused with a reason and the list stays at four', async ({
    page,
  }) => {
    await gotoReady(page, `/compare?handles=${A},${B},${C},${D}`);
    await expect(page.getByText('4 of 4 selected.')).toBeVisible();
    const fifth = box(page, /Tidewell Harbor Medium Foam/);
    await fifth.click();
    await expect(
      page.getByText(/was not added\. You can compare up to 4 products/),
    ).toBeVisible();
    await expect(fifth).not.toBeChecked();
    await expect(page).toHaveURL(new RegExp(`handles=${A},${B},${C},${D}$`));
    await expect(page.getByRole('columnheader')).toHaveCount(5);
  });

  test('a URL with more than four, bad or unknown handles is cleaned up', async ({
    page,
  }) => {
    const response = await page.goto(
      `/compare?handles=${A},${B},${C},${D},tidewell-harbor-medium-foam,not-a-product,%3Cscript%3E`,
    );
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('columnheader')).toHaveCount(5);
    await expect(
      page.getByText(/was not added\. You can compare up to 4 products/),
    ).toBeVisible();
  });
});

test.describe('REQ-CMP-001 kept for the session and device', () => {
  test('a reload keeps the selection', async ({page}) => {
    await gotoReady(page, '/compare');
    await box(page, /Solace Plush Memory Foam/).click();
    await expect(page).toHaveURL(new RegExp(`handles=${A}`));
    await page.reload();
    await expect(box(page, /Solace Plush Memory Foam/)).toBeChecked();
  });

  test('a bare /compare restores the last selection from this device', async ({
    page,
  }) => {
    await gotoReady(page, '/compare');
    await box(page, /Solace Plush Memory Foam/).click();
    await box(page, /Solace Medium Memory Foam/).click();
    await expect(page).toHaveURL(new RegExp(`handles=${A},${B}`));
    await gotoReady(page, '/compare');
    await expect(page).toHaveURL(new RegExp(`handles=${A},${B}`));
    await expect(page.getByRole('columnheader')).toHaveCount(3);
  });

  test('removing everything also clears the device copy', async ({page}) => {
    await gotoReady(page, `/compare?handles=${A}`);
    await page
      .getByRole('link', {name: /Remove Wrenfield Solace Plush/})
      .click();
    await gotoReady(page, '/compare');
    await expect(
      page.getByText('You have not chosen any products yet.'),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/compare$/);
  });
});

test.describe('REQ-CMP-001 size and similar products', () => {
  test('choosing a size shows each price in that size', async ({page}) => {
    await gotoReady(page, `/compare?handles=${A},${C}`);
    await expect(
      page.getByRole('cell').filter({hasText: 'From'}).first(),
    ).toBeVisible();
    await page.getByLabel('Show prices for size').selectOption('King');
    await expect(page).toHaveURL(/size=King/);
    const priceRow = page.getByRole('row', {name: /^Price/});
    await expect(priceRow).not.toContainText('From');
    await expect(priceRow).toContainText('$');
  });

  test('similar products can be added to the comparison', async ({page}) => {
    await gotoReady(page, `/compare?handles=${A}`);
    const similar = page.getByRole('region', {name: 'Similar products'}).or(
      page.locator('section', {
        has: page.getByRole('heading', {name: 'Similar products'}),
      }),
    );
    await expect(similar.first()).toBeVisible();
    await similar
      .first()
      .getByRole('link', {name: /^Add .* to comparison$/})
      .first()
      .click();
    await expect(page.getByRole('columnheader')).toHaveCount(3);
  });
});

test.describe('REQ-CMP-001 mobile layout (NFR-001)', () => {
  test('four products scroll inside a labelled region, the first column stays put, the page does not scroll sideways', async ({
    page,
  }) => {
    await page.setViewportSize({width: 360, height: 740});
    await gotoReady(page, `/compare?handles=${A},${B},${C},${D}`);

    await noHorizontalScroll(page);
    const region = page.getByRole('region', {name: /Comparison of 4 products/});
    await expect(region).toBeVisible();
    await expect(region).toHaveAttribute('tabindex', '0');

    const metrics = await region.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);

    const rowHeader = page.getByRole('rowheader', {name: 'Comfort level'});
    const before = await rowHeader.boundingBox();
    await region.evaluate((el) => {
      el.scrollLeft = 200;
    });
    await expect
      .poll(async () => (await rowHeader.boundingBox())?.x)
      .toBe(before?.x);
    await noHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });

  test('the picker and the empty state fit 360 px', async ({page}) => {
    await page.setViewportSize({width: 360, height: 740});
    await gotoReady(page, '/compare');
    await noHorizontalScroll(page);
    const heights = await picker(page)
      .getByRole('checkbox')
      .evaluateAll((nodes) =>
        nodes.map(
          (node) => node.closest('label')?.getBoundingClientRect().height ?? 0,
        ),
      );
    for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
  });
});
