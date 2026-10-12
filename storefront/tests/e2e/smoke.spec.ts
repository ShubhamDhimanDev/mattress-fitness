import {expect, test} from '@playwright/test';
import {
  collectConsoleErrors,
  expectNoSeriousA11yViolations,
} from './helpers/a11y';

// P1-05 harness smoke test: the app starts, renders the shell, and the page is quiet and accessible.
// Requirement coverage proper arrives with the feature specs (see docs/requirements/TRACEABILITY.md).
test.describe('smoke: home page', () => {
  test('renders a landmark layout without console errors', async ({page}) => {
    const errors = collectConsoleErrors(page);
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);

    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('contentinfo')).toBeVisible();
    expect(errors, 'console errors on the home page').toEqual([]);
  });

  test('has no serious or critical accessibility violations', async ({
    page,
  }) => {
    await page.goto('/');
    await expectNoSeriousA11yViolations(page);
  });
});
