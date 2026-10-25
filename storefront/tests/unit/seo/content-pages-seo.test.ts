import {describe, expect, it} from 'vitest';
import {
  buildArticleDocument,
  buildBlogDocument,
} from '~/lib/pages/content-pages-article';
import {
  buildArticleJsonLd,
  buildFaqPageJsonLd,
  buildSeo,
  cleanTags,
  seoText,
  type MetaTag,
} from '~/lib/pages/content-pages-seo';
import {buildContentDocument} from '~/lib/pages/content-pages-view';

// REQ-CNT-001, REQ-CNT-002: page and article metadata, canonical, robots and JSON-LD built from Shopify fields.

const ORIGIN = 'https://www.example.com';

function find(tags: readonly MetaTag[], key: string, value: string) {
  return tags.find((tag) => key in tag && Reflect.get(tag, key) === value);
}

function content(tags: readonly MetaTag[], key: string, value: string) {
  const tag = find(tags, key, value);
  return tag && 'content' in tag ? tag.content : undefined;
}

const BASE = {
  title: 'Delivery and shipping',
  canonical: `${ORIGIN}/pages/delivery-and-shipping`,
  indexable: true,
  type: 'website',
  siteName: 'Example Sleep',
} as const;

describe('REQ-CNT-001 seoText', () => {
  it.each([
    ['plain', 'Hello world', 'Hello world'],
    ['tags removed', '<script>alert(1)</script><b>Bold</b> text', 'Bold text'],
    ['whitespace', '  a \n\n  b\t c ', 'a b c'],
    ['control characters', 'a\u0000\u001fb', 'a b'],
    ['entities', 'Tom &amp; Jerry', 'Tom & Jerry'],
  ])('%s', (_name, input, expected) => {
    expect(seoText(input, 200)).toBe(expected);
  });

  it('gives an empty string for anything that is not text', () => {
    for (const value of [null, undefined, 42, {}, ['x']]) {
      expect(seoText(value, 50)).toBe('');
    }
  });

  it('caps the length', () => {
    expect(seoText('word '.repeat(100), 40).length).toBeLessThanOrEqual(40);
  });
});

describe('REQ-CNT-001 buildSeo', () => {
  it('uses the Shopify SEO title and description, and sets canonical, robots and social tags', () => {
    const seo = buildSeo({
      ...BASE,
      seoTitle: 'Delivery | Example',
      seoDescription: 'How delivery works.',
    });
    expect(seo.title).toBe('Delivery | Example');
    expect(content(seo.tags, 'name', 'description')).toBe(
      'How delivery works.',
    );
    expect(content(seo.tags, 'name', 'robots')).toBe('index,follow');
    expect(find(seo.tags, 'rel', 'canonical')).toEqual({
      tagName: 'link',
      rel: 'canonical',
      href: BASE.canonical,
    });
    expect(content(seo.tags, 'property', 'og:title')).toBe(
      'Delivery | Example',
    );
    expect(content(seo.tags, 'property', 'og:description')).toBe(
      'How delivery works.',
    );
    expect(content(seo.tags, 'property', 'og:url')).toBe(BASE.canonical);
    expect(content(seo.tags, 'property', 'og:type')).toBe('website');
    expect(content(seo.tags, 'property', 'og:site_name')).toBe('Example Sleep');
    expect(content(seo.tags, 'name', 'twitter:card')).toBe('summary');
  });

  it('falls back to the page title and to the start of the visible text', () => {
    const seo = buildSeo({
      ...BASE,
      seoTitle: ' ',
      seoDescription: null,
      bodyText: 'word '.repeat(100),
    });
    expect(seo.title).toBe('Delivery and shipping');
    const description = content(seo.tags, 'name', 'description') ?? '';
    expect(description.length).toBeGreaterThan(0);
    expect(description.length).toBeLessThanOrEqual(160);
  });

  it('emits no description at all when there is nothing to describe (nothing invented)', () => {
    const seo = buildSeo({...BASE, bodyText: ''});
    expect(find(seo.tags, 'name', 'description')).toBeUndefined();
    expect(find(seo.tags, 'property', 'og:description')).toBeUndefined();
  });

  it('marks an empty page noindex,follow', () => {
    const seo = buildSeo({...BASE, indexable: false});
    expect(content(seo.tags, 'name', 'robots')).toBe('noindex,follow');
  });

  it('leaves out canonical and og:url without a site origin', () => {
    const seo = buildSeo({...BASE, canonical: null});
    expect(find(seo.tags, 'rel', 'canonical')).toBeUndefined();
    expect(find(seo.tags, 'property', 'og:url')).toBeUndefined();
  });

  it('cleans and caps hostile SEO fields', () => {
    const seo = buildSeo({
      ...BASE,
      seoTitle: `<img src=x onerror=alert(1)>${'T'.repeat(400)}`,
      seoDescription: `<script>x</script>${'d '.repeat(400)}`,
    });
    expect(seo.title.length).toBeLessThanOrEqual(120);
    expect(seo.title).not.toContain('<');
    const description = content(seo.tags, 'name', 'description') ?? '';
    expect(description.length).toBeLessThanOrEqual(300);
    expect(description).not.toContain('<');
  });

  it('adds the image tags only for an https image', () => {
    const withImage = buildSeo({
      ...BASE,
      image: {
        url: 'https://cdn.shopify.com/a.jpg',
        width: 1200,
        height: 800,
        altText: 'A bed',
      },
    });
    expect(content(withImage.tags, 'property', 'og:image')).toBe(
      'https://cdn.shopify.com/a.jpg',
    );
    expect(content(withImage.tags, 'property', 'og:image:width')).toBe('1200');
    expect(content(withImage.tags, 'property', 'og:image:alt')).toBe('A bed');
    expect(content(withImage.tags, 'name', 'twitter:card')).toBe(
      'summary_large_image',
    );
    for (const url of [
      'http://cdn.example/a.jpg',
      'javascript:alert(1)',
      '//x/a.jpg',
    ]) {
      const bad = buildSeo({...BASE, image: {url}});
      expect(find(bad.tags, 'property', 'og:image'), url).toBeUndefined();
      expect(content(bad.tags, 'name', 'twitter:card')).toBe('summary');
    }
  });

  it('adds published time, section and tags for an article only', () => {
    const article = buildSeo({
      ...BASE,
      type: 'article',
      publishedAt: '2026-10-05T10:00:00Z',
      section: 'Journal',
      tags: ['sleep', 'sleep', ' ', 'bases'],
    });
    expect(content(article.tags, 'property', 'og:type')).toBe('article');
    expect(content(article.tags, 'property', 'article:published_time')).toBe(
      '2026-10-05T10:00:00Z',
    );
    expect(content(article.tags, 'property', 'article:section')).toBe(
      'Journal',
    );
    expect(
      article.tags.filter(
        (tag) => 'property' in tag && tag.property === 'article:tag',
      ),
    ).toHaveLength(2);

    const page = buildSeo({
      ...BASE,
      publishedAt: '2026-10-05T10:00:00Z',
      tags: ['sleep'],
    });
    expect(
      find(page.tags, 'property', 'article:published_time'),
    ).toBeUndefined();
    expect(find(page.tags, 'property', 'article:tag')).toBeUndefined();
  });

  it('ignores a published time that is not a date', () => {
    const article = buildSeo({...BASE, type: 'article', publishedAt: 'soon'});
    expect(
      find(article.tags, 'property', 'article:published_time'),
    ).toBeUndefined();
  });

  it('limits and tidies article tags', () => {
    const many = Array.from({length: 30}, (_, i) => `tag ${i}`);
    expect(cleanTags(many)).toHaveLength(10);
    expect(cleanTags(['<b>x</b>', 'x'])).toEqual(['x']);
    expect(cleanTags(undefined)).toEqual([]);
  });
});

describe('REQ-CNT-001 FAQPage JSON-LD', () => {
  const pair = (n: number) => ({question: `Q${n}?`, answer: `A${n}`});

  it('is emitted for two or more pairs', () => {
    expect(buildFaqPageJsonLd([pair(1), pair(2)])).toEqual({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Q1?',
          acceptedAnswer: {'@type': 'Answer', text: 'A1'},
        },
        {
          '@type': 'Question',
          name: 'Q2?',
          acceptedAnswer: {'@type': 'Answer', text: 'A2'},
        },
      ],
    });
  });

  it('is not emitted for fewer than two pairs', () => {
    expect(buildFaqPageJsonLd([])).toBeNull();
    expect(buildFaqPageJsonLd([pair(1)])).toBeNull();
  });
});

describe('REQ-CNT-002 Article JSON-LD', () => {
  const input = {
    headline: 'Choosing a mattress',
    description: 'A short guide.',
    canonical: `${ORIGIN}/blogs/journal/choosing`,
    imageUrl: 'https://cdn.shopify.com/a.jpg',
    publishedAt: '2026-10-05T10:00:00Z',
    authorName: 'Sam Sleeper',
    tags: ['sleep', 'beds'],
  };

  it('carries headline, published date, image, author, keywords and the page it describes', () => {
    expect(buildArticleJsonLd(input)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: 'Choosing a mattress',
      datePublished: '2026-10-05T10:00:00Z',
      description: 'A short guide.',
      image: ['https://cdn.shopify.com/a.jpg'],
      author: {'@type': 'Person', name: 'Sam Sleeper'},
      keywords: 'sleep, beds',
      mainEntityOfPage: {'@type': 'WebPage', '@id': input.canonical},
    });
  });

  it('claims nothing it does not have: no modified date, publisher, rating or empty fields', () => {
    const json = buildArticleJsonLd({
      ...input,
      description: '',
      imageUrl: null,
      authorName: null,
      tags: [],
      canonical: null,
    });
    expect(json).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: 'Choosing a mattress',
      datePublished: '2026-10-05T10:00:00Z',
    });
    expect(json).not.toHaveProperty('dateModified');
    expect(json).not.toHaveProperty('publisher');
    expect(json).not.toHaveProperty('aggregateRating');
  });

  it.each([undefined, null, '', 'not a date'])(
    'is not emitted without a valid published date (%j)',
    (publishedAt) => {
      expect(buildArticleJsonLd({...input, publishedAt})).toBeNull();
    },
  );

  it('drops a non-https image and an empty headline', () => {
    expect(
      buildArticleJsonLd({...input, imageUrl: 'http://x/a.jpg'}),
    ).not.toHaveProperty('image');
    expect(buildArticleJsonLd({...input, headline: '  '})).toBeNull();
  });
});

describe('REQ-CNT-001 content document (pages and policies)', () => {
  const base = {
    title: 'Delivery and shipping',
    path: '/pages/delivery-and-shipping',
    origin: ORIGIN,
    canonical: `${ORIGIN}/pages/delivery-and-shipping`,
    siteName: 'Example Sleep',
  };
  const longBody =
    '<h2>Zones</h2><p>Text.</p><h2>Times</h2><p>Text.</p><h3>Same day</h3><p>Text.</p>';

  it('builds the contents list, anchors, breadcrumb, last-updated line and head tags', () => {
    const view = buildContentDocument({
      ...base,
      body: longBody,
      updatedAt: '2026-10-05T10:00:00Z',
      seoDescription: 'Delivery details.',
    });
    expect(view.empty).toBe(false);
    expect(view.toc.map((entry) => entry.text)).toEqual([
      'Zones',
      'Times',
      'Same day',
    ]);
    expect(view.anchors).toHaveLength(3);
    expect(view.updated).toEqual({
      iso: '2026-10-05T10:00:00Z',
      text: 'October 5, 2026',
    });
    expect(view.breadcrumb).toEqual([
      {label: 'Home', to: '/'},
      {label: 'Delivery and shipping'},
    ]);
    expect(content(view.tags, 'name', 'robots')).toBe('index,follow');
    expect(content(view.tags, 'name', 'description')).toBe('Delivery details.');
    expect(view.jsonLd).toHaveLength(1);
    expect(view.jsonLd[0]).toMatchObject({'@type': 'BreadcrumbList'});
  });

  it('shows no contents list for fewer than three headings', () => {
    const view = buildContentDocument({
      ...base,
      body: '<h2>One</h2><p>x</p><h2>Two</h2><p>y</p>',
    });
    expect(view.toc).toEqual([]);
    expect(view.anchors).toHaveLength(2);
  });

  it('marks an empty page noindex and says so, with no description', () => {
    for (const body of [null, '', '<p> </p>', '<script>alert(1)</script>']) {
      const view = buildContentDocument({...base, body});
      expect(view.empty, String(body)).toBe(true);
      expect(content(view.tags, 'name', 'robots')).toBe('noindex,follow');
      expect(find(view.tags, 'name', 'description')).toBeUndefined();
    }
  });

  it('falls back to the registry title when Shopify gives an empty one', () => {
    const view = buildContentDocument({
      ...base,
      title: '  ',
      fallbackTitle: 'Delivery and shipping',
      body: '<p>x</p>',
    });
    expect(view.title).toBe('Delivery and shipping');
  });

  it('has no last-updated line without a date (policies) or with a bad one', () => {
    expect(
      buildContentDocument({...base, body: '<p>x</p>'}).updated,
    ).toBeNull();
    expect(
      buildContentDocument({...base, body: '<p>x</p>', updatedAt: 'nope'})
        .updated,
    ).toBeNull();
  });

  it('puts a policy under Policies in the breadcrumb and its markup', () => {
    const view = buildContentDocument({
      ...base,
      title: 'Privacy policy',
      path: '/policies/privacy-policy',
      canonical: `${ORIGIN}/policies/privacy-policy`,
      body: '<p>x</p>',
      parents: [{name: 'Policies', path: '/policies'}],
    });
    expect(view.breadcrumb).toEqual([
      {label: 'Home', to: '/'},
      {label: 'Policies', to: '/policies'},
      {label: 'Privacy policy'},
    ]);
    expect(JSON.stringify(view.jsonLd)).toContain(
      `${ORIGIN}/policies/privacy-policy`,
    );
  });

  it('emits no breadcrumb markup and no canonical without a site origin (relative URLs are invalid)', () => {
    const view = buildContentDocument({
      ...base,
      origin: null,
      canonical: null,
      body: '<p>x</p>',
    });
    expect(view.jsonLd).toEqual([]);
    expect(find(view.tags, 'rel', 'canonical')).toBeUndefined();
  });

  describe('FAQPage markup', () => {
    const faqBody =
      '<h2>How long?</h2><p>Two days.</p><h2>Can I return it?</h2><p>Yes.</p>';

    it('is emitted only for the FAQ page and only with two or more detectable pairs', () => {
      const faq = buildContentDocument({...base, faq: true, body: faqBody});
      expect(faq.jsonLd.map((entry) => entry['@type'])).toEqual([
        'BreadcrumbList',
        'FAQPage',
      ]);

      const notFaqPage = buildContentDocument({...base, body: faqBody});
      expect(notFaqPage.jsonLd.map((entry) => entry['@type'])).toEqual([
        'BreadcrumbList',
      ]);

      const onePair = buildContentDocument({
        ...base,
        faq: true,
        body: '<h2>How long?</h2><p>Two days.</p><h2>Delivery</h2><p>Text</p>',
      });
      expect(onePair.jsonLd.map((entry) => entry['@type'])).toEqual([
        'BreadcrumbList',
      ]);

      const prose = buildContentDocument({
        ...base,
        faq: true,
        body: '<p>Call us with any question.</p>',
      });
      expect(prose.jsonLd.map((entry) => entry['@type'])).toEqual([
        'BreadcrumbList',
      ]);
    });

    it('describes the visible text only, with markup and scripts removed', () => {
      const view = buildContentDocument({
        ...base,
        faq: true,
        body: '<h2>Safe?</h2><p>Yes<script>alert(1)</script></p><h2>Really?</h2><p><b>Yes</b></p>',
      });
      const faq = view.jsonLd.find((entry) => entry['@type'] === 'FAQPage');
      expect(JSON.stringify(faq)).not.toContain('script');
      expect(JSON.stringify(faq)).not.toContain('<');
    });
  });
});

describe('REQ-CNT-002 blog and article documents', () => {
  const article = {
    blogHandle: 'journal',
    blogTitle: 'Sleep journal',
    articleHandle: 'choosing',
    title: 'Choosing a mattress',
    contentHtml: '<p>Start with how you sleep.</p>',
    excerpt: 'A short guide.',
    publishedAt: '2026-10-05T10:00:00Z',
    authorName: 'Sam Sleeper',
    topics: ['sleep', 'beds'],
    image: {
      url: 'https://cdn.shopify.com/a.jpg',
      width: 1200,
      height: 800,
      altText: 'A bed',
    },
    origin: ORIGIN,
    canonical: `${ORIGIN}/blogs/journal/choosing`,
    siteName: 'Example Sleep',
  };

  it('carries the social and SEO tags of REQ-CNT-002', () => {
    const view = buildArticleDocument({
      ...article,
      seoTitle: 'Choosing | Journal',
      seoDescription: 'How to choose.',
    });
    expect(view.seoTitle).toBe('Choosing | Journal');
    const tags = view.metaTags;
    expect(content(tags, 'name', 'description')).toBe('How to choose.');
    expect(content(tags, 'property', 'og:type')).toBe('article');
    expect(content(tags, 'property', 'og:title')).toBe('Choosing | Journal');
    expect(content(tags, 'property', 'og:description')).toBe('How to choose.');
    expect(content(tags, 'property', 'og:image')).toBe(
      'https://cdn.shopify.com/a.jpg',
    );
    expect(content(tags, 'property', 'og:url')).toBe(article.canonical);
    expect(content(tags, 'property', 'article:published_time')).toBe(
      article.publishedAt,
    );
    expect(content(tags, 'property', 'article:section')).toBe('Sleep journal');
    expect(
      tags.filter((tag) => 'property' in tag && tag.property === 'article:tag'),
    ).toHaveLength(2);
    expect(find(tags, 'rel', 'canonical')).toBeDefined();
    expect(content(tags, 'name', 'twitter:card')).toBe('summary_large_image');
    expect(view.topics).toEqual(['sleep', 'beds']);
  });

  it('describes the article from its excerpt, then from its text', () => {
    expect(
      content(buildArticleDocument(article).metaTags, 'name', 'description'),
    ).toBe('A short guide.');
    expect(
      content(
        buildArticleDocument({...article, excerpt: ''}).metaTags,
        'name',
        'description',
      ),
    ).toBe('Start with how you sleep.');
  });

  it('emits Article and breadcrumb JSON-LD with the dates and the blog in the trail', () => {
    const view = buildArticleDocument(article);
    expect(view.jsonLd.map((entry) => entry['@type'])).toEqual([
      'Article',
      'BreadcrumbList',
    ]);
    expect(view.jsonLd[0]).toMatchObject({
      datePublished: article.publishedAt,
      headline: 'Choosing a mattress',
    });
    expect(view.breadcrumb.map((crumb) => crumb.label)).toEqual([
      'Home',
      'Blogs',
      'Sleep journal',
      'Choosing a mattress',
    ]);
    expect(view.breadcrumb[2]?.to).toBe('/blogs/journal');
  });

  it('builds the listing document with a plain canonical and breadcrumb', () => {
    const view = buildBlogDocument({
      blogHandle: 'journal',
      blogTitle: 'Sleep journal',
      seoTitle: null,
      seoDescription: 'Tips.',
      origin: ORIGIN,
      canonical: `${ORIGIN}/blogs/journal`,
      siteName: 'Example Sleep',
    });
    expect(view.seoTitle).toBe('Sleep journal');
    expect(content(view.metaTags, 'name', 'description')).toBe('Tips.');
    expect(content(view.metaTags, 'property', 'og:type')).toBe('website');
    expect(view.jsonLd).toHaveLength(1);
  });
});
