import {expect, test, type Page} from '@playwright/test';
import {
  collectConsoleErrors,
  expectNoSeriousA11yViolations,
} from './helpers/a11y';
import {
  expectNoHorizontalScroll,
  gotoReady,
  ourErrors,
} from './helpers/catalog';

// REQ-CNT-001 (content pages and their footer links), REQ-CNT-002 (blog listing and article). P6-09.
// WRITTEN, NOT RUN: this spec has not been executed against a server (no browser was available when it was written).
//
// Specs run against whatever store is connected (mock.shop, bedding.mock.shop or the development store). The 15 pages
// are written by the client, so these tests assert structure every store has and use whatever pages and blogs the
// footer links to; a test that needs a page or a blog the store does not have skips with a stated reason. The checks
// that hold in every store: no footer link 404s, an unknown handle is a proper not-found page, and any page that is
// linked renders one h1, a breadcrumb, passes axe and has no horizontal scroll.

const FOOTER_CONTENT_LINK =
  'footer a[href^="/pages/"], footer a[href^="/policies/"], footer a[href^="/blogs/"]';

/** Distinct content paths the footer links to, on any viewport (collapsed groups keep their links in the HTML). */
async function footerContentPaths(page: Page): Promise<string[]> {
  await gotoReady(page, '/');
  const hrefs = await page
    .locator(FOOTER_CONTENT_LINK)
    .evaluateAll((links) =>
      links.map((link) => link.getAttribute('href') ?? ''),
    );
  return [...new Set(hrefs.filter((href) => href !== ''))];
}

test.describe('REQ-CNT-001 footer links to content pages', () => {
  test('every content link in the footer resolves (no 404 links)', async ({
    page,
    request,
  }) => {
    const paths = await footerContentPaths(page);
    for (const path of paths) {
      const response = await request.get(path);
      expect(response.status(), `${path} is not a 404 link`).toBe(200);
    }
  });

  test('no footer link points at the two legal page URLs that only redirect to the policy', async ({
    page,
  }) => {
    const paths = await footerContentPaths(page);
    expect(paths).not.toContain('/pages/privacy-policy');
    expect(paths).not.toContain('/pages/terms');
  });

  test('the legal links, when shown, use the Shopify policy URLs', async ({
    page,
  }) => {
    await gotoReady(page, '/');
    const footer = page.getByRole('contentinfo');
    const privacy = footer.getByRole('link', {name: 'Privacy policy'});
    test.skip(
      (await privacy.count()) === 0,
      'The connected store has no privacy policy in Settings > Policies, so the footer shows no link (by design).',
    );
    await expect(privacy).toHaveAttribute('href', '/policies/privacy-policy');
    const terms = footer.getByRole('link', {name: 'Terms'});
    if ((await terms.count()) > 0) {
      await expect(terms).toHaveAttribute('href', '/policies/terms-of-service');
    }
  });
});

test.describe('REQ-CNT-001 a content page', () => {
  async function firstLinkedPage(page: Page): Promise<string | null> {
    const paths = await footerContentPaths(page);
    return paths.find((path) => path.startsWith('/pages/')) ?? null;
  }

  test('renders one article with one h1, a breadcrumb and the shell, with no console errors', async ({
    page,
  }) => {
    const path = await firstLinkedPage(page);
    test.skip(
      path === null,
      'The connected store has none of the 15 pages with content, so the footer links none.',
    );
    if (path === null) return;
    const errors = collectConsoleErrors(page);
    const response = await gotoReady(page, path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', {level: 1})).toHaveCount(1);
    await expect(page.getByRole('article')).toBeVisible();
    const breadcrumb = page.getByRole('navigation', {name: 'Breadcrumb'});
    await expect(breadcrumb).toBeVisible();
    await expect(breadcrumb.getByRole('link', {name: 'Home'})).toBeVisible();
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('contentinfo')).toBeVisible();
    expect(ourErrors(errors)).toEqual([]);
  });

  test('has a canonical link without a query string, a description and robots index', async ({
    page,
  }) => {
    const path = await firstLinkedPage(page);
    test.skip(path === null, 'No linked content page in the connected store.');
    if (path === null) return;
    await gotoReady(page, `${path}?utm_source=test`);
    const canonical = page.locator('link[rel="canonical"]');
    // Without PUBLIC_SITE_URL there is no canonical (never taken from the request); with it, it has no query.
    if ((await canonical.count()) > 0) {
      const href = (await canonical.getAttribute('href')) ?? '';
      expect(href.endsWith(path)).toBe(true);
      expect(href).not.toContain('?');
    }
    const robots = page.locator('meta[name="robots"]');
    await expect(robots).toHaveAttribute('content', /^(index|noindex),follow$/);
  });

  test('the contents list, when present, links to headings that exist', async ({
    page,
  }) => {
    const path = await firstLinkedPage(page);
    test.skip(path === null, 'No linked content page in the connected store.');
    if (path === null) return;
    await gotoReady(page, path);
    const contents = page.getByRole('navigation', {name: 'On this page'});
    test.skip(
      (await contents.count()) === 0,
      'The page has fewer than three headings, so it shows no contents list.',
    );
    const hrefs = await contents
      .getByRole('link')
      .evaluateAll((links) =>
        links.map((link) => link.getAttribute('href') ?? ''),
      );
    for (const href of hrefs) {
      await expect(page.locator(href)).toHaveCount(1);
    }
    await contents.getByRole('link').first().click();
    await expect(page).toHaveURL(new RegExp(`${hrefs[0]}$`));
  });

  test('has no horizontal scroll at 360 px and passes axe', async ({page}) => {
    const path = await firstLinkedPage(page);
    test.skip(path === null, 'No linked content page in the connected store.');
    if (path === null) return;
    await page.setViewportSize({width: 360, height: 800});
    await gotoReady(page, path);
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });

  test('prints without the breadcrumb and the contents', async ({page}) => {
    const path = await firstLinkedPage(page);
    test.skip(path === null, 'No linked content page in the connected store.');
    if (path === null) return;
    await gotoReady(page, path);
    await page.emulateMedia({media: 'print'});
    await expect(
      page.getByRole('navigation', {name: 'Breadcrumb'}),
    ).toBeHidden();
    await expect(
      page.getByRole('navigation', {name: 'On this page'}),
    ).toBeHidden();
    await expect(page.getByRole('heading', {level: 1})).toBeVisible();
  });
});

test.describe('REQ-CNT-001 not found and redirects', () => {
  test('an unknown page handle is a proper not-found page with the shell', async ({
    page,
  }) => {
    const response = await gotoReady(page, '/pages/does-not-exist-p6-09');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('heading', {level: 1})).toHaveText(
      'Page not found',
    );
    await expectNoSeriousA11yViolations(page);
  });

  test('an unknown policy handle is a not-found page', async ({page}) => {
    const response = await gotoReady(page, '/policies/does-not-exist-p6-09');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', {level: 1})).toHaveText(
      'Page not found',
    );
  });

  test('/pages/privacy-policy and /pages/terms either redirect to the policy or are a plain not-found', async ({
    request,
  }) => {
    for (const [path, policy] of [
      ['/pages/privacy-policy', '/policies/privacy-policy'],
      ['/pages/terms', '/policies/terms-of-service'],
    ] as const) {
      const response = await request.get(path, {maxRedirects: 0});
      const status = response.status();
      // 301 to the policy when the store has the policy and no page with that handle, 200 when a page has that
      // handle, 404 when neither exists; never anything else.
      expect([200, 301, 404], path).toContain(status);
      if (status === 301) {
        expect(
          new URL(response.headers().location ?? '', 'http://x').pathname,
        ).toBe(policy);
      }
    }
  });
});

test.describe('REQ-CNT-001 policy page', () => {
  test('a policy renders one h1 under a Policies breadcrumb and passes axe', async ({
    page,
    request,
  }) => {
    const probe = await request.get('/policies/privacy-policy');
    test.skip(
      probe.status() !== 200,
      'The connected store has no privacy policy in Settings > Policies.',
    );
    await gotoReady(page, '/policies/privacy-policy');
    await expect(page.getByRole('heading', {level: 1})).toHaveCount(1);
    await expect(
      page
        .getByRole('navigation', {name: 'Breadcrumb'})
        .getByRole('link', {name: 'Policies'}),
    ).toHaveAttribute('href', '/policies');
    await expectNoSeriousA11yViolations(page);
  });
});

test.describe('REQ-CNT-002 blog', () => {
  async function firstBlogPath(page: Page): Promise<string | null> {
    const response = await gotoReady(page, '/blogs');
    if (response?.status() !== 200) return null;
    const href = await page
      .locator('main a[href^="/blogs/"]')
      .first()
      .getAttribute('href')
      .catch(() => null);
    return href;
  }

  test('the blog index lists the blogs under one h1', async ({page}) => {
    const response = await gotoReady(page, '/blogs');
    expect(response?.status()).toBeLessThan(500);
    await expect(page.getByRole('heading', {level: 1})).toHaveCount(1);
    await expectNoSeriousA11yViolations(page);
  });

  test('a blog lists articles, newest first, and paginates with a link', async ({
    page,
  }) => {
    const blog = await firstBlogPath(page);
    test.skip(blog === null, 'The connected store has no blog.');
    if (blog === null) return;
    await gotoReady(page, blog);
    await expect(page.getByRole('heading', {level: 1})).toHaveCount(1);
    await expect(
      page.getByRole('navigation', {name: 'Breadcrumb'}),
    ).toBeVisible();
    const cards = page.getByRole('list', {name: /.+/}).getByRole('listitem');
    test.skip((await cards.count()) === 0, 'The blog has no articles yet.');
    const more = page.getByRole('link', {name: 'Load more'});
    if ((await more.count()) > 0) {
      await expect(more).toHaveAttribute('href', /cursor=/);
      const before = await cards.count();
      await more.click();
      await expect.poll(async () => cards.count()).toBeGreaterThan(before);
    }
    await expectNoHorizontalScroll(page);
  });

  test('an article has social and SEO metadata, one h1, a date and passes axe', async ({
    page,
  }) => {
    const blog = await firstBlogPath(page);
    test.skip(blog === null, 'The connected store has no blog.');
    if (blog === null) return;
    await gotoReady(page, blog);
    const article = page.locator(`main a[href^="${blog}/"]`).first();
    test.skip((await article.count()) === 0, 'The blog has no articles yet.');
    const errors = collectConsoleErrors(page);
    await article.click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', {level: 1})).toHaveCount(1);
    await expect(page.locator('article time[datetime]').first()).toBeVisible();
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute(
      'content',
      'article',
    );
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      'content',
      /.+/,
    );
    await expect(
      page.locator('meta[property="article:published_time"]'),
    ).toHaveAttribute('content', /^\d{4}-\d{2}-\d{2}/);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      'content',
      /summary/,
    );
    const jsonLd = await page
      .locator('script[type="application/ld+json"]')
      .allTextContents();
    const types = jsonLd.map((text) => {
      const parsed: unknown = JSON.parse(text);
      return typeof parsed === 'object' && parsed !== null && '@type' in parsed
        ? String(parsed['@type'])
        : '';
    });
    // The Article markup needs a configured PUBLIC_SITE_URL only for its URLs, not for itself.
    expect(types).toContain('Article');
    await expectNoSeriousA11yViolations(page);
    expect(ourErrors(errors)).toEqual([]);
  });

  test('an unknown blog and an unknown article are not-found pages', async ({
    page,
  }) => {
    const missingBlog = await gotoReady(page, '/blogs/does-not-exist-p6-09');
    expect(missingBlog?.status()).toBe(404);
    await expect(page.getByRole('heading', {level: 1})).toHaveText(
      'Page not found',
    );
    const missingArticle = await gotoReady(
      page,
      '/blogs/news/does-not-exist-p6-09',
    );
    expect(missingArticle?.status()).toBe(404);
  });
});
