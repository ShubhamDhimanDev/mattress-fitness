import {describe, expect, it} from 'vitest';
import {
  FOOTER_SUPPORT_GROUPS,
  buildFooterLinks,
  footerGroupLinks,
  visibleQuickLinks,
  FOOTER_QUICK_LINKS_END_DRAFT,
  FOOTER_QUICK_LINKS_START_DRAFT,
  type FooterPageLink,
} from '~/lib/navigation';
import {
  CONTENT_BLOGS,
  CONTENT_PAGES,
  JOURNAL_BLOG_HANDLE,
  NO_CONTENT,
  contentPageByHandle,
  contentPageTarget,
  footerPageLinks,
  policyRedirectFor,
  type ContentAvailability,
} from '~/lib/pages/content-pages';
import {
  articleNeighbours,
  articlePath,
  blogPath,
  formatLongDate,
} from '~/lib/pages/content-pages-blog';

// REQ-CNT-001: the 15 pages, one stable URL each, linked only when the Shopify page exists with content.
// REQ-CNT-002: blog helpers (dates, neighbours, paths).

function available(
  partial: Partial<{
    pages: string[];
    policies: Array<'privacyPolicy' | 'termsOfService'>;
    blogs: string[];
  }>,
): ContentAvailability {
  return {
    pages: new Set(partial.pages ?? []),
    policies: new Set(partial.policies ?? []),
    blogs: new Set(partial.blogs ?? []),
  };
}

function registered(handle: string) {
  const page = contentPageByHandle(handle);
  if (!page) throw new Error(`not in the registry: ${handle}`);
  return page;
}

const ALL_HANDLES = CONTENT_PAGES.map((page) => page.handle);

describe('REQ-CNT-001 the registry', () => {
  it('lists exactly the 15 pages of the scope of work, once each', () => {
    expect(CONTENT_PAGES).toHaveLength(15);
    expect(new Set(ALL_HANDLES).size).toBe(15);
    expect([...ALL_HANDLES].sort()).toEqual(
      [
        'about',
        'accessibility',
        'adjustable-base-guide',
        'comfort-guarantee',
        'comfort-guide',
        'contact',
        'delivery-and-shipping',
        'faq',
        'financing',
        'mattress-types-guide',
        'price-guarantee',
        'privacy-policy',
        'size-guide',
        'terms',
        'warranty-and-returns',
      ].sort(),
    );
  });

  it.each(CONTENT_PAGES.map((page) => [page.handle, page] as const))(
    '%s has lower-case url-safe handle, titles and a footer group',
    (_handle, page) => {
      expect(page.handle).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(page.title.trim()).not.toBe('');
      expect(page.label.trim()).not.toBe('');
      expect(['support', 'sleep-guide', 'about', 'legal']).toContain(
        page.group,
      );
    },
  );

  it('keeps the four footer groups the plan names, with the legal ones in Legal', () => {
    const groupOf = (handle: string) => contentPageByHandle(handle)?.group;
    expect(groupOf('privacy-policy')).toBe('legal');
    expect(groupOf('terms')).toBe('legal');
    expect(groupOf('accessibility')).toBe('legal');
    expect(groupOf('faq')).toBe('support');
    expect(groupOf('size-guide')).toBe('sleep-guide');
    expect(groupOf('about')).toBe('about');
  });

  it('gives no two pages of one group the same sort order', () => {
    const seen = new Set<string>();
    for (const page of CONTENT_PAGES) {
      const key = `${page.group}:${page.order}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
  });

  it('marks only privacy and terms as policy-type, with the Shopify policy URL handles', () => {
    const policies = CONTENT_PAGES.filter((page) => page.policy);
    expect(policies.map((page) => page.handle)).toEqual([
      'privacy-policy',
      'terms',
    ]);
    expect(policies.map((page) => page.policy?.urlHandle)).toEqual([
      'privacy-policy',
      'terms-of-service',
    ]);
  });

  it('allows FAQ markup on the FAQ page alone', () => {
    expect(CONTENT_PAGES.filter((p) => p.faq).map((p) => p.handle)).toEqual([
      'faq',
    ]);
  });

  it('looks pages up case-insensitively and rejects non-strings', () => {
    expect(contentPageByHandle('FAQ')?.handle).toBe('faq');
    expect(contentPageByHandle('nope')).toBeNull();
    expect(contentPageByHandle(undefined)).toBeNull();
    expect(contentPageByHandle(42)).toBeNull();
    expect(contentPageByHandle('__proto__')).toBeNull();
  });

  it('names the journal blog by one constant', () => {
    expect(JOURNAL_BLOG_HANDLE).toBe('journal');
    expect(CONTENT_BLOGS.map((blog) => blog.handle)).toEqual(['journal']);
  });
});

describe('REQ-CNT-001 footer link visibility', () => {
  it('shows no registry link when nothing exists or the read failed (no 404 links)', () => {
    expect(footerPageLinks(NO_CONTENT)).toEqual([]);
  });

  it('links a page at /pages/<handle> only when it exists with content', () => {
    const links = footerPageLinks(available({pages: ['faq', 'financing']}));
    expect(links.map((link) => [link.label, link.to])).toEqual([
      ['Financing', '/pages/financing'],
      ['FAQ', '/pages/faq'],
    ]);
  });

  it('shows financing, warranty and the guarantees as soon as their pages exist, with no developer flag', () => {
    const links = footerPageLinks(
      available({
        pages: [
          'financing',
          'warranty-and-returns',
          'comfort-guarantee',
          'price-guarantee',
        ],
      }),
    );
    expect(links.map((link) => link.id).sort()).toEqual([
      'page:comfort-guarantee',
      'page:financing',
      'page:price-guarantee',
      'page:warranty-and-returns',
    ]);
  });

  it('ignores handles that are not in the registry', () => {
    expect(footerPageLinks(available({pages: ['guides', 'secret']}))).toEqual(
      [],
    );
  });

  it('points privacy and terms at the Shopify policy URLs when the policies exist', () => {
    const links = footerPageLinks(
      available({policies: ['privacyPolicy', 'termsOfService']}),
    );
    expect(links.map((link) => [link.label, link.to, link.group])).toEqual([
      ['Privacy policy', '/policies/privacy-policy', 'legal'],
      ['Terms', '/policies/terms-of-service', 'legal'],
    ]);
  });

  it('prefers the policy to a page with the same handle (one copy), and falls back to the page only when no policy exists', () => {
    const both = available({
      pages: ['privacy-policy'],
      policies: ['privacyPolicy'],
    });
    expect(contentPageTarget(registered('privacy-policy'), both)).toBe(
      '/policies/privacy-policy',
    );
    const pageOnly = available({pages: ['privacy-policy']});
    expect(contentPageTarget(registered('privacy-policy'), pageOnly)).toBe(
      '/pages/privacy-policy',
    );
    expect(
      contentPageTarget(registered('privacy-policy'), NO_CONTENT),
    ).toBeNull();
  });

  it('does not link terms because only the privacy policy exists', () => {
    const links = footerPageLinks(available({policies: ['privacyPolicy']}));
    expect(links.map((link) => link.label)).toEqual(['Privacy policy']);
  });

  it('links the journal blog only when a blog with that handle exists', () => {
    expect(footerPageLinks(available({blogs: ['news']}))).toEqual([]);
    expect(footerPageLinks(available({blogs: ['journal']}))).toEqual([
      {
        id: 'blog:journal',
        label: 'Sleep journal',
        to: '/blogs/journal',
        group: 'sleep-guide',
        order: 70,
      },
    ]);
  });
});

describe('REQ-CNT-001 policy URLs for the two legal pages', () => {
  it('redirects /pages/privacy-policy and /pages/terms to the policy when the policy exists', () => {
    const both = available({policies: ['privacyPolicy', 'termsOfService']});
    expect(policyRedirectFor('privacy-policy', both)).toBe(
      '/policies/privacy-policy',
    );
    expect(policyRedirectFor('terms', both)).toBe('/policies/terms-of-service');
    expect(policyRedirectFor('TERMS', both)).toBe('/policies/terms-of-service');
  });

  it('does not redirect when the policy is missing, or for any other handle', () => {
    expect(policyRedirectFor('terms', NO_CONTENT)).toBeNull();
    expect(
      policyRedirectFor('terms', available({policies: ['privacyPolicy']})),
    ).toBeNull();
    expect(
      policyRedirectFor(
        'faq',
        available({policies: ['privacyPolicy', 'termsOfService']}),
      ),
    ).toBeNull();
    expect(
      policyRedirectFor(
        // a hostile value is not a registry handle, so it can never become a redirect target
        'https://evil.example',
        available({policies: ['privacyPolicy', 'termsOfService']}),
      ),
    ).toBeNull();
  });
});

describe('REQ-CNT-001 merging page links into the footer groups', () => {
  const page = (
    id: string,
    group: FooterPageLink['group'],
    order: number,
  ): FooterPageLink => ({id, label: id, to: `/pages/${id}`, group, order});

  it('sorts fixed and page links by order, fixed first on a tie', () => {
    const fixed = [
      {label: 'Quiz', to: '/quiz', order: 10},
      {label: 'Compare', to: '/compare', order: 20},
    ];
    const links = footerGroupLinks('sleep-guide', fixed, [
      page('b', 'sleep-guide', 40),
      page('a', 'sleep-guide', 30),
      page('c', 'sleep-guide', 20),
      page('other', 'support', 1),
    ]);
    expect(links.map((link) => link.label)).toEqual([
      'Quiz',
      'Compare',
      'c',
      'a',
      'b',
    ]);
  });

  it('leaves the fixed groups with their fixed links only when no page exists', () => {
    const merged = FOOTER_SUPPORT_GROUPS.map((group) => ({
      id: group.id,
      labels: footerGroupLinks(group.id, group.links, []).map((l) => l.label),
    }));
    expect(merged).toEqual([
      {id: 'support', labels: []},
      {id: 'sleep-guide', labels: ['Sleep quiz', 'Compare mattresses']},
      {id: 'about', labels: ['Find a store']},
    ]);
  });

  it('builds the legal row from the legal pages alone, none when none exist', () => {
    expect(footerGroupLinks('legal', [], [])).toEqual([]);
    const links = footerGroupLinks(
      'legal',
      [],
      footerPageLinks(
        available({
          policies: ['privacyPolicy', 'termsOfService'],
          pages: ['accessibility'],
        }),
      ),
    );
    expect(links.map((link) => link.to)).toEqual([
      '/policies/privacy-policy',
      '/policies/terms-of-service',
      '/pages/accessibility',
    ]);
  });

  it('shows the delivery and contact quick links only with their page, at the page path', () => {
    const draft = [
      ...FOOTER_QUICK_LINKS_START_DRAFT,
      ...FOOTER_QUICK_LINKS_END_DRAFT,
    ];
    expect(visibleQuickLinks(draft, []).map((l) => l.id)).toEqual([
      'account',
      'stores',
    ]);
    const shown = visibleQuickLinks(
      draft,
      footerPageLinks(available({pages: ['delivery-and-shipping', 'contact']})),
    );
    expect(shown.map((l) => [l.id, l.to])).toEqual([
      ['delivery', '/pages/delivery-and-shipping'],
      ['account', '/account'],
      ['stores', '/stores'],
      ['contact', '/pages/contact'],
    ]);
  });
});

describe('REQ-CNT-002 blog helpers', () => {
  it('formats a long US date in UTC, and nothing for a bad value', () => {
    expect(formatLongDate('2026-10-05T23:30:00Z')).toBe('October 5, 2026');
    expect(formatLongDate('2026-10-05T00:00:00-05:00')).toBe('October 5, 2026');
    expect(formatLongDate('not a date')).toBe('');
    expect(formatLongDate(null)).toBe('');
    expect(formatLongDate(undefined)).toBe('');
  });

  const list = [
    {handle: 'c', title: 'C'},
    {handle: 'b', title: 'B'},
    {handle: 'a', title: 'A'},
  ];

  it('finds the newer and older neighbours in a newest-first list', () => {
    expect(articleNeighbours(list, 'b')).toEqual({
      newer: list[0],
      older: list[2],
    });
    expect(articleNeighbours(list, 'c')).toEqual({newer: null, older: list[1]});
    expect(articleNeighbours(list, 'a')).toEqual({newer: list[1], older: null});
  });

  it('gives no neighbours for an article outside the list', () => {
    expect(articleNeighbours(list, 'missing')).toEqual({
      newer: null,
      older: null,
    });
    expect(articleNeighbours([], 'a')).toEqual({newer: null, older: null});
  });

  it('encodes handles in blog and article paths', () => {
    expect(blogPath('journal')).toBe('/blogs/journal');
    expect(articlePath('journal', 'a b/../c')).toBe(
      '/blogs/journal/a%20b%2F..%2Fc',
    );
  });
});

describe('REQ-CNT-001 the footer link model built by the root loader', () => {
  it('has only the fixed links when no page exists, and drops the groups left empty', () => {
    const links = buildFooterLinks([]);
    expect(links.supportGroups.map((group) => group.id)).toEqual([
      'sleep-guide',
      'about',
    ]);
    expect(links.legal).toEqual([]);
    expect(links.quickStart.map((link) => link.id)).toEqual(['account']);
    expect(links.quickEnd.map((link) => link.id)).toEqual(['stores']);
  });

  it('adds every existing page to its group, the legal row and the quick links', () => {
    const links = buildFooterLinks(
      footerPageLinks(
        available({
          pages: ['faq', 'contact', 'delivery-and-shipping', 'about'],
          policies: ['privacyPolicy'],
          blogs: ['journal'],
        }),
      ),
    );
    const byGroup = Object.fromEntries(
      links.supportGroups.map((group) => [
        group.id,
        group.links.map((link) => link.label),
      ]),
    );
    expect(byGroup).toEqual({
      support: ['Contact us', 'Delivery and shipping', 'FAQ'],
      'sleep-guide': ['Sleep quiz', 'Compare mattresses', 'Sleep journal'],
      about: ['About us', 'Find a store'],
    });
    expect(links.legal.map((link) => link.to)).toEqual([
      '/policies/privacy-policy',
    ]);
    expect(links.quickStart.map((link) => link.id)).toEqual([
      'delivery',
      'account',
    ]);
    expect(links.quickEnd.map((link) => link.id)).toEqual([
      'stores',
      'contact',
    ]);
  });
});
