import AxeBuilder from '@axe-core/playwright';
import {expect, type Page} from '@playwright/test';

/**
 * Runs axe on the current page state and fails on serious or critical violations (NFR-003, proposed WCAG 2.2 AA).
 * `exclude` is for third-party widgets we do not control; every use needs a comment saying why.
 */
export async function expectNoSeriousA11yViolations(
  page: Page,
  options: {exclude?: string[]; disableRules?: string[]} = {},
) {
  let builder = new AxeBuilder({page}).withTags([
    'wcag2a',
    'wcag2aa',
    'wcag21a',
    'wcag21aa',
    'wcag22aa',
  ]);
  for (const selector of options.exclude ?? [])
    builder = builder.exclude(selector);
  if (options.disableRules?.length)
    builder = builder.disableRules(options.disableRules);

  const {violations} = await builder.analyze();
  const blocking = violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    blocking.map(
      (v) => `${v.impact}: ${v.id} (${v.nodes.length} nodes) ${v.helpUrl}`,
    ),
    'serious or critical accessibility violations',
  ).toEqual([]);
}

/** Collects console errors so a spec can assert the page is quiet. */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}
