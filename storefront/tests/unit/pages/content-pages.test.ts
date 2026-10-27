import {describe, expect, it} from 'vitest';
import {
  FOOTER_SUPPORT_GROUPS,
  MAIN_NAV,
  buildFooterLinks,
  buildUtilityLinks,
  existingContentPaths,
  buildFallbackNav,
  pruneMainNav,
  type MainNavItem,
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
import {cursorPaginationVariables} from '~/lib/pages/cursor-pagination';
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

describe('REQ-CNT-001 header links to Shopify content', () => {
  const existing = (...paths: string[]) => new Set(paths);

  it('shows only "Track order" when no page exists, and never the chat stand-in', () => {
    expect(buildUtilityLinks(existing()).map((link) => link.id)).toEqual([
      'track',
    ]);
    // Even with the contact page there is no chat link: no chat provider is configured (P7-03).
    expect(
      buildUtilityLinks(existing('/pages/contact')).map((link) => link.id),
    ).toEqual(['track', 'contact']);
  });

  it('adds the chat link only when a chat provider is switched on', () => {
    expect(
      buildUtilityLinks(existing('/pages/contact'), {chat: true}).map(
        (link) => link.id,
      ),
    ).toEqual(['track', 'contact', 'chat']);
  });

  it('derives the existing paths from the footer page links', () => {
    expect(
      existingContentPaths(
        footerPageLinks(available({pages: ['contact'], blogs: ['journal']})),
      ),
    ).toEqual(new Set(['/pages/contact', '/blogs/journal']));
  });

  const paths = (items: ReturnType<typeof pruneMainNav>) =>
    items.flatMap((item) =>
      item.kind === 'menu'
        ? [item.to, ...item.groups.flatMap((g) => g.links.map((l) => l.to))]
        : [item.to],
    );

  it('removes every fixed link to a missing page or blog, and keeps the rest', () => {
    const pruned = buildFallbackNav(new Set());
    const left = paths(pruned);
    expect(left.filter((to) => /^\/(pages|blogs)\//.test(to ?? ''))).toEqual(
      [],
    );
    expect(left).toContain('/collections/mattresses');
    expect(left).toContain('/quiz');
    expect(left).toContain('/compare');
  });

  it('keeps exactly the guide and journal links whose page exists', () => {
    const pruned = buildFallbackNav(
      new Set(['/pages/size-guide', '/blogs/journal']),
    );
    const left = paths(pruned).filter((to) =>
      /^\/(pages|blogs)\//.test(to ?? ''),
    );
    expect(left).toEqual(['/pages/size-guide', '/blogs/journal']);
  });

  it('drops a menu left with no groups, and a group left with no links', () => {
    const items: MainNavItem[] = [
      {
        kind: 'menu',
        id: 'only-pages',
        label: 'Only pages',
        to: '/pages/x',
        groups: [
          {id: 'g', heading: 'G', links: [{label: 'X', to: '/pages/x'}]},
        ],
      },
      {
        kind: 'menu',
        id: 'mixed',
        label: 'Mixed',
        to: '/pages/y',
        groups: [
          {id: 'a', heading: 'A', links: [{label: 'Y', to: '/pages/y'}]},
          {id: 'b', heading: 'B', links: [{label: 'S', to: '/stores'}]},
        ],
      },
      {kind: 'link', id: 'faq', label: 'FAQ', to: '/pages/faq'},
    ];
    const pruned = pruneMainNav(items, new Set());
    expect(pruned.map((item) => item.id)).toEqual(['mixed']);
    const [mixed] = pruned;
    expect(mixed?.kind === 'menu' ? mixed.groups.map((g) => g.id) : []).toEqual(
      ['b'],
    );
    // The menu's own link to the missing page goes too.
    expect(mixed?.to).toBeUndefined();
  });

  it('does not change the fixed navigation it is given', () => {
    const before = JSON.stringify(MAIN_NAV);
    buildFallbackNav(new Set());
    pruneMainNav(MAIN_NAV, new Set());
    expect(JSON.stringify(MAIN_NAV)).toBe(before);
  });
});

describe('REQ-CNT-002 blog pagination variables (cursor and direction are validated)', () => {
  const vars = (query: string) =>
    cursorPaginationVariables(new URLSearchParams(query), 12);

  it('serves the first page without a cursor', () => {
    expect(vars('')).toEqual({first: 12, endCursor: null});
    expect(vars('direction=next')).toEqual({first: 12, endCursor: null});
  });

  it('passes a well-formed cursor forward or back', () => {
    expect(vars('cursor=eyJsYXN0X2lkIjoxfQ==')).toEqual({
      first: 12,
      endCursor: 'eyJsYXN0X2lkIjoxfQ==',
    });
    expect(vars('cursor=abc123&direction=next')).toEqual({
      first: 12,
      endCursor: 'abc123',
    });
    expect(vars('cursor=abc123&direction=previous')).toEqual({
      last: 12,
      startCursor: 'abc123',
    });
  });

  it.each([
    ['a quote', "cursor=a'b"],
    ['a space', 'cursor=a%20b'],
    ['markup', 'cursor=%3Cscript%3E'],
    ['a graphql fragment', 'cursor=a%22%2C%20first%3A%20250'],
    ['a newline', 'cursor=a%0Ab'],
    ['too long', `cursor=${'a'.repeat(513)}`],
    ['empty', 'cursor='],
    ['an unknown direction', 'cursor=abc&direction=sideways'],
    ['an empty direction', 'cursor=abc&direction='],
    ['a hostile direction', 'cursor=abc&direction=next%27%20OR%201'],
  ])('drops %s and serves the first page', (_name, query) => {
    expect(vars(query)).toEqual({first: 12, endCursor: null});
  });
});

describe('REQ-CNT-001 the shell default navigation links nothing that could 404', () => {
  it('holds no link to a Shopify page or blog in MAIN_NAV, which is what the header uses without availability data', () => {
    const everyLink = MAIN_NAV.flatMap((item) =>
      item.kind === 'menu'
        ? [item.to, ...item.groups.flatMap((g) => g.links.map((l) => l.to))]
        : [item.to],
    );
    expect(
      everyLink.filter((to) => /^\/(pages|blogs)\//.test(to ?? '')),
    ).toEqual([]);
  });

  it('adds the buying guides and the journal back, in place, when they exist', () => {
    const full = buildFallbackNav(
      new Set([
        '/pages/size-guide',
        '/pages/comfort-guide',
        '/pages/mattress-types-guide',
        '/pages/adjustable-base-guide',
        '/blogs/journal',
      ]),
    );
    const guides = full.find((item) => item.id === 'guides');
    expect(
      guides?.kind === 'menu' ? guides.groups.map((g) => g.id) : [],
    ).toEqual(['guides-buying', 'guides-help']);
    expect(
      guides?.kind === 'menu'
        ? guides.groups.flatMap((g) => g.links.map((l) => l.to))
        : [],
    ).toEqual([
      '/pages/size-guide',
      '/pages/comfort-guide',
      '/pages/mattress-types-guide',
      '/pages/adjustable-base-guide',
      '/quiz',
      '/compare',
      `/blogs/${JOURNAL_BLOG_HANDLE}`,
    ]);
  });

  const everyPath = (items: ReturnType<typeof buildFallbackNav>) =>
    items.flatMap((item) =>
      item.kind === 'menu'
        ? [item.to, ...item.groups.flatMap((g) => g.links.map((l) => l.to))]
        : [item.to],
    );

  it('points every "Shop by" link at a filtered view of the mattresses collection, not at a collection of its own', () => {
    const mattresses = MAIN_NAV.find((item) => item.id === 'mattresses');
    const shopBy =
      mattresses?.kind === 'menu'
        ? mattresses.groups
            .filter((group) => group.id !== 'mattresses-brand')
            .flatMap((group) => group.links.map((link) => link.to))
        : [];
    expect(shopBy.length).toBeGreaterThan(0);
    for (const to of shopBy) {
      expect(to).toMatch(/^\/collections\/mattresses\?/);
    }
  });

  it('drops links to collections that do not exist, keeps the built-in all-products route and every other path', () => {
    const pruned = buildFallbackNav(new Set(), new Set(['mattresses']));
    const paths = everyPath(pruned);
    expect(paths).toContain('/collections/mattresses');
    expect(paths).toContain('/brands');
    expect(paths).not.toContain('/collections/sale');
    expect(paths).not.toContain('/collections/box-springs');
    expect(
      paths.some((to) => to?.startsWith('/collections/mattresses?size=')),
    ).toBe(true);
  });

  it('keeps every link when the collection read failed (null), so a shop outage never empties the menu', () => {
    const paths = everyPath(buildFallbackNav(new Set(), null));
    expect(paths).toContain('/collections/sale');
    expect(paths).toContain('/collections/box-springs');
  });

  it('drops the whole Mattresses filter set when the mattresses collection itself is missing', () => {
    const paths = everyPath(buildFallbackNav(new Set(), new Set(['sale'])));
    expect(paths.some((to) => to?.startsWith('/collections/mattresses'))).toBe(
      false,
    );
    expect(paths).toContain('/collections/sale');
  });
});
