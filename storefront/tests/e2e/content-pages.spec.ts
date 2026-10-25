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
// Run history: progress/TEST_RESULTS.md (V-E219 onwards).
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

  // The legal links follow one rule (content-pages.ts, owner decision 2026-10-25): the Shopify policy when the store
  // returns it, else a Page with the fallback handle when that page has text, else no link. A page URL in the footer
  // is therefore correct only when the policy is absent AND the page answers 200 itself (never a redirecting link).
  // These two tests were written as if a policy always existed (latent fault found in V-E225, fixed in V-E227).
  const LEGAL = [
    {
      label: 'Privacy policy',
      policy: '/policies/privacy-policy',
      fallbackPage: '/pages/privacy-policy',
    },
    {
      label: 'Terms',
      policy: '/policies/terms-of-service',
      fallbackPage: '/pages/terms',
    },
  ] as const;

  test('a footer link to a legal page URL appears only as the fallback: no policy and the page answers 200 itself', async ({
    page,
    request,
  }) => {
    const paths = await footerContentPaths(page);
    for (const legal of LEGAL) {
      if (!paths.includes(legal.fallbackPage)) continue;
      const policy = await request.get(legal.policy, {maxRedirects: 0});
      expect(
        policy.status(),
        `${legal.label}: the footer must link the policy when the store has one`,
      ).not.toBe(200);
      const fallback = await request.get(legal.fallbackPage, {
        maxRedirects: 0,
      });
      expect(
        fallback.status(),
        `${legal.label}: the fallback page link must not redirect or 404`,
      ).toBe(200);
    }
  });

  for (const legal of LEGAL) {
    test(`the "${legal.label}" footer link goes to the Shopify policy, else to the fallback page, else it is absent`, async ({
      page,
      request,
    }) => {
      await gotoReady(page, '/');
      const links = (await footerLinksByText(page, legal.label)).filter(
        (link) => link.text === legal.label,
      );
      test.skip(
        links.length === 0,
        `The connected store has neither a ${legal.label.toLowerCase()} in Settings > Policies nor a ${legal.fallbackPage} page with text, so the footer shows no link (by design).`,
      );
      const policy = await request.get(legal.policy, {maxRedirects: 0});
      // Every link with this text (the legal row, and the signup form's privacy link when one is shown) agrees.
      const expected =
        policy.status() === 200 ? legal.policy : legal.fallbackPage;
      for (const link of links) expect(link.href).toBe(expected);
    });
  }
});

/** Footer anchors whose text contains `text`, with their href and normalised text. */
async function footerLinksByText(page: Page, text: string) {
  const all = await page.locator('footer a[href]').evaluateAll((anchors) =>
    anchors.map((anchor) => ({
      href: anchor.getAttribute('href') ?? '',
      text: (anchor.textContent ?? '').replace(/\s+/g, ' ').trim(),
    })),
  );
  return all.filter((link) => link.text.includes(text));
}

const CONTENT_HREF = /^\/(pages|policies|blogs)\//;

/** Hrefs of the Shopify-content links inside a locator's scope. */
async function contentHrefs(scope: ReturnType<Page['locator']>) {
  const hrefs = await scope
    .locator('a[href]')
    .evaluateAll((links) =>
      links.map((link) => link.getAttribute('href') ?? ''),
    );
  return [...new Set(hrefs.filter((href) => CONTENT_HREF.test(href)))];
}

test.describe('REQ-CNT-001 header and menu links never 404', () => {
  test('every page, policy and blog link in the header and the desktop menu resolves', async ({
    page,
    request,
  }) => {
    await gotoReady(page, '/');
    const hrefs = await contentHrefs(page.getByRole('banner'));
    for (const href of hrefs) {
      const response = await request.get(href);
      expect(response.status(), `${href} is not a 404 link`).toBe(200);
    }
  });

  test('the utility bar has no "Chat with us" link while no chat provider exists', async ({
    page,
  }) => {
    await gotoReady(page, '/');
    await expect(page.getByRole('link', {name: 'Chat with us'})).toHaveCount(0);
  });

  test('every page, policy and blog link in the mobile menu resolves', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({width: 360, height: 800});
    await gotoReady(page, '/');
    await page.getByRole('banner').getByRole('button', {name: 'Menu'}).click();
    const drawer = page.getByRole('dialog', {name: 'Menu'});
    await expect(drawer).toBeVisible();
    // The drawer's navigation is a lazy chunk: wait for the help links it ends with.
    await expect(drawer.getByRole('link', {name: 'Track order'})).toBeVisible();
    // Accordion sections are collapsed; their links are in the DOM, which is all the check needs.
    const hrefs = await contentHrefs(drawer);
    for (const href of hrefs) {
      const response = await request.get(href);
      expect(response.status(), `${href} is not a 404 link`).toBe(200);
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
      // 302 to the policy when the store has the policy and no page with text has that handle (a temporary redirect
      // that no cache may keep: the answer follows data the client edits; changed from 301 on 2026-10-25, V-E214),
      // 200 when a page with text has that handle, 404 when neither exists; never anything else.
      expect([200, 302, 404], path).toContain(status);
      if (status === 302) {
        expect(
          new URL(response.headers().location ?? '', 'http://x').pathname,
        ).toBe(policy);
        expect(
          response.headers()['cache-control'],
          `${path} is not cacheable`,
        ).toContain('no-store');
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
    // count() answers at once; getAttribute() on a missing link would wait out the whole test timeout (V-E214: the
    // index of a store with no blog is a 200 page with no blog link, and the test hit its 30 s limit instead of skipping).
    const first = page.locator('main a[href^="/blogs/"]').first();
    if ((await first.count()) === 0) return null;
    return first.getAttribute('href');
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
