import {expect, test, type Page} from '@playwright/test';
import {blockingViolations, runAxeAudit} from './helpers/a11y';
import {expectNoHorizontalScroll, gotoReady} from './helpers/catalog';

// NFR-003 / REQ-CNT-001 / REQ-CNT-002: axe on every content template the connected store serves, at 360 and 1280 px.
//
// a11y-audit.spec.ts cannot run on a development store with one product (its catalogue lookup needs a product sold
// in two sizes) and, on a mock store, its content routes render the not-found template. This spec needs no catalogue:
// it opens every content address the registry knows (the 15 pages, the policies, the blogs, the first article it
// finds) and audits whatever the store answers there. Each test records the status it got, so a run says which
// templates were real (200: page, policy, blog list, article, or the "no content yet" page) and which were the
// not-found page. Evidence from this spec is evidence about the store connected to the server, nothing more.

const PAGE_HANDLES = [
  'delivery-and-shipping',
  'financing',
  'comfort-guarantee',
  'price-guarantee',
  'warranty-and-returns',
  'faq',
  'about',
  'contact',
  'size-guide',
  'comfort-guide',
  'mattress-types-guide',
  'adjustable-base-guide',
  'privacy-policy',
  'terms',
  'accessibility',
];

const PATHS = [
  '/policies',
  '/policies/privacy-policy',
  '/policies/terms-of-service',
  '/policies/shipping-policy',
  '/policies/refund-policy',
  ...PAGE_HANDLES.map((handle) => `/pages/${handle}`),
  '/blogs',
  '/blogs/journal',
];

async function firstArticlePath(page: Page): Promise<string | null> {
  const response = await page.request.get('/blogs/journal');
  if (response.status() !== 200) return null;
  await gotoReady(page, '/blogs/journal');
  const first = page.locator('main a[href^="/blogs/journal/"]').first();
  if ((await first.count()) === 0) return null;
  return first.getAttribute('href');
}

test.describe('NFR-003 axe on the content templates the store serves (REQ-CNT-001, REQ-CNT-002)', () => {
  test.describe.configure({timeout: 120_000});

  for (const path of PATHS) {
    test(`${path}: no serious or critical violation at 360 and 1280 px, one main, no horizontal scroll`, async ({
      page,
    }, info) => {
      test.skip(
        info.project.name.includes('mobile'),
        'The widths are set by the test, so the desktop project covers both.',
      );
      const seen: string[] = [];
      for (const width of [360, 1280]) {
        await page.setViewportSize({width, height: 800});
        const response = await gotoReady(page, path);
        const status = response?.status() ?? 0;
        await expect(page.getByRole('main')).toHaveCount(1);
        await expect(page.getByRole('heading', {level: 1})).toHaveCount(1);
        await expectNoHorizontalScroll(page);
        const violations = await runAxeAudit(page);
        expect(blockingViolations(violations), `${path} @${width}`).toEqual([]);
        seen.push(`@${width} status=${status} axe=${violations.length}`);
      }
      info.annotations.push({
        type: 'template',
        description: `${path} ${seen.join(' ')}`,
      });
    });
  }

  test('the first journal article (when the blog has one): no serious or critical violation at 360 and 1280 px', async ({
    page,
  }, info) => {
    test.skip(
      info.project.name.includes('mobile'),
      'The widths are set by the test, so the desktop project covers both.',
    );
    const article = await firstArticlePath(page);
    test.skip(
      article === null,
      'The connected store has no journal blog with an article, so there is no article template to audit.',
    );
    if (article === null) return;
    for (const width of [360, 1280]) {
      await page.setViewportSize({width, height: 800});
      await gotoReady(page, article);
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.getByRole('heading', {level: 1})).toHaveCount(1);
      await expectNoHorizontalScroll(page);
      expect(
        blockingViolations(await runAxeAudit(page)),
        `${article} @${width}`,
      ).toEqual([]);
    }
  });
});
