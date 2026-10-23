import {describe, expect, it} from 'vitest';
import {
  MAX_GROUPS_PER_ITEM,
  MAX_LABEL_LENGTH,
  MAX_LINKS_PER_GROUP,
  MAX_TOP_ITEMS,
  buildMainNav,
  cleanMenuLabel,
  mainNavWithQuizCta,
  ownHostsFrom,
  resolveMenuHandle,
  resolveMenuLink,
} from '~/lib/nav-menu';
import {MAIN_NAV, SLEEP_QUIZ_LINK, type MainNavItem} from '~/lib/navigation';

// REQ-NAV-002 (P3B-02): the Shopify admin menu becomes our navigation. The menu is untrusted content.

const SHOP = 'https://example-shop.myshopify.com';
const OPTIONS = {ownHosts: ['example-shop.myshopify.com', 'shop.example.com']};

type Node = {
  title?: unknown;
  type?: unknown;
  url?: unknown;
  items?: unknown;
};

const collection = (
  title: string,
  handle: string,
  items: unknown[] = [],
): Node => ({
  title,
  type: 'COLLECTION',
  url: `${SHOP}/collections/${handle}`,
  items,
});

function menu(...items: Node[]) {
  return {items};
}

function menuItems(...items: Node[]): MainNavItem[] {
  return buildMainNav(menu(...items), OPTIONS).items;
}

describe('resolveMenuLink: Shopify resource types become our routes', () => {
  it.each([
    [
      'COLLECTION',
      `${SHOP}/collections/king-mattresses`,
      '/collections/king-mattresses',
    ],
    [
      'COLLECTION',
      `${SHOP}/collections/king-mattresses/firm+cooling`,
      '/collections/king-mattresses',
    ],
    ['COLLECTION', '/collections/all', '/collections/all'],
    ['PRODUCT', `${SHOP}/products/cloud-queen`, '/products/cloud-queen'],
    [
      'PRODUCT',
      `${SHOP}/collections/beds/products/cloud-queen`,
      '/products/cloud-queen',
    ],
    ['PAGE', `${SHOP}/pages/size-guide`, '/pages/size-guide'],
    ['BLOG', `${SHOP}/blogs/journal`, '/blogs/journal'],
    [
      'ARTICLE',
      `${SHOP}/blogs/journal/sleep-tips`,
      '/blogs/journal/sleep-tips',
    ],
    [
      'SHOP_POLICY',
      `${SHOP}/policies/refund-policy`,
      '/policies/refund-policy',
    ],
  ])('%s %s -> %s', (type, url, expected) => {
    expect(resolveMenuLink({type, url}, OPTIONS)).toEqual({
      to: expected,
      external: false,
    });
  });

  it('ignores the host Shopify put in a resource URL (a primary domain we do not know)', () => {
    expect(
      resolveMenuLink({
        type: 'PAGE',
        url: 'https://www.some-other-primary-domain.com/pages/about',
      }),
    ).toEqual({to: '/pages/about', external: false});
  });

  it.each([
    ['FRONTPAGE', '/'],
    ['COLLECTIONS', '/collections'],
    ['CATALOG', '/collections/all'],
    ['SEARCH', '/search'],
    ['CUSTOMER_ACCOUNT_PAGE', '/account'],
  ])('%s needs no URL and goes to %s', (type, expected) => {
    expect(resolveMenuLink({type, url: null})).toEqual({
      to: expected,
      external: false,
    });
  });

  it.each([
    ['METAOBJECT', `${SHOP}/pages/anything`],
    ['SOMETHING_NEW', `${SHOP}/pages/anything`],
    [null, `${SHOP}/pages/anything`],
    ['PAGE', null],
    ['PAGE', ''],
    ['PAGE', `${SHOP}/collections/wrong-kind`],
    ['PAGE', `${SHOP}/pages/`],
    ['COLLECTION', `${SHOP}/collections/%2e%2e`],
    ['COLLECTION', `${SHOP}/collections/a%2Fb`],
    ['COLLECTION', `${SHOP}/collections/bad%zz`],
    ['COLLECTION', `${SHOP}/collections/has space`],
    ['PRODUCT', `${SHOP}/products/`],
    ['ARTICLE', `${SHOP}/blogs/journal`],
    ['COLLECTION', 'javascript:alert(1)'],
    ['COLLECTION', 'data:text/html,hi'],
    ['COLLECTION', `${SHOP}/collections/x\u0000y`],
  ])('%s with %j leads nowhere', (type, url) => {
    expect(resolveMenuLink({type, url}, OPTIONS)).toBeNull();
  });
});

describe('resolveMenuLink: plain URLs (HTTP type)', () => {
  it('opens a path on our own host or a relative path as an internal link', () => {
    expect(
      resolveMenuLink({type: 'HTTP', url: `${SHOP}/pages/faq`}, OPTIONS),
    ).toEqual({to: '/pages/faq', external: false});
    expect(
      resolveMenuLink(
        {
          type: 'HTTP',
          url: 'https://SHOP.example.com/collections/sale?sort_by=price',
        },
        OPTIONS,
      ),
    ).toEqual({to: '/collections/sale?sort_by=price', external: false});
    expect(resolveMenuLink({type: 'HTTP', url: '/stores'}, OPTIONS)).toEqual({
      to: '/stores',
      external: false,
    });
  });

  it('marks another site as external, https only', () => {
    expect(
      resolveMenuLink(
        {type: 'HTTP', url: 'https://partner.example.org/offer'},
        OPTIONS,
      ),
    ).toEqual({to: 'https://partner.example.org/offer', external: true});
    expect(
      resolveMenuLink(
        {type: 'HTTP', url: 'http://partner.example.org/offer'},
        OPTIONS,
      ),
    ).toBeNull();
  });

  it('treats a host as external when no own hosts are known', () => {
    expect(resolveMenuLink({type: 'HTTP', url: `${SHOP}/pages/faq`})).toEqual({
      to: `${SHOP}/pages/faq`,
      external: true,
    });
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'mailto:sales@example.com',
    'tel:+13125550142',
    '//evil.example.org/x',
    '/\\evil.example.org',
    'https://user:pass@partner.example.org/x',
    '/api/cart',
    '/pages/../api/cart',
    '/pages/%2e%2e/api',
    '/account/orders',
    `${SHOP}/admin`,
    'https://partner.example.org/a b',
    `/pages/${'x'.repeat(600)}`,
    'not a url',
  ])('rejects %j', (url) => {
    expect(resolveMenuLink({type: 'HTTP', url}, OPTIONS)).toBeNull();
  });
});

describe('ownHostsFrom', () => {
  it('accepts hosts and URLs, lower-cases, and skips junk', () => {
    expect(
      ownHostsFrom([
        'Example-Shop.myshopify.com',
        'https://Shop.Example.com/some/path',
        undefined,
        '',
        42,
        'http://[bad',
      ]),
    ).toEqual(['example-shop.myshopify.com', 'shop.example.com']);
  });
});

describe('cleanMenuLabel', () => {
  it('reduces a title to plain text', () => {
    expect(cleanMenuLabel('  Sale <b>now</b>\n on  ')).toBe('Sale now on');
    expect(cleanMenuLabel('<script>alert(1)</script>Beds')).toBe(
      'alert(1)Beds',
    );
    expect(cleanMenuLabel('Mat​tress‮')).toBe('Mattress');
  });

  it('gives nothing for empty or tag-only titles', () => {
    expect(cleanMenuLabel(null)).toBeNull();
    expect(cleanMenuLabel('   ')).toBeNull();
    expect(cleanMenuLabel('<br><img src=x>')).toBeNull();
  });

  it('shortens by code points without cutting an emoji', () => {
    const label = cleanMenuLabel(
      `${'a'.repeat(MAX_LABEL_LENGTH - 1)}\u{1F6CF}\u{1F6CF}`,
    );
    expect(Array.from(label ?? '')).toHaveLength(MAX_LABEL_LENGTH);
    expect(label?.endsWith('\u{1F6CF}')).toBe(true);
  });
});

describe('buildMainNav: structure', () => {
  it('a top-level item without children is a link', () => {
    expect(menuItems(collection('Sale', 'sale'))).toEqual([
      {kind: 'link', id: 'menu-0', label: 'Sale', to: '/collections/sale'},
    ]);
  });

  it('a top-level item with children is a menu; a child with children is a group, its title the heading', () => {
    const [item] = menuItems(
      collection('Mattresses', 'mattresses', [
        collection('Shop by size', 'by-size', [
          collection('Queen', 'queen'),
          collection('King', 'king'),
        ]),
        collection('Shop by comfort', 'by-comfort', [
          collection('Firm', 'firm'),
        ]),
      ]),
    );
    expect(item).toEqual({
      kind: 'menu',
      id: 'menu-0',
      label: 'Mattresses',
      to: '/collections/mattresses',
      groups: [
        {
          id: 'menu-0-g0',
          heading: 'Shop by size',
          headingTo: '/collections/by-size',
          links: [
            {label: 'Queen', to: '/collections/queen'},
            {label: 'King', to: '/collections/king'},
          ],
        },
        {
          id: 'menu-0-g1',
          heading: 'Shop by comfort',
          headingTo: '/collections/by-comfort',
          links: [{label: 'Firm', to: '/collections/firm'}],
        },
      ],
    });
  });

  it("children with no children of their own share one heading-less group at the first one's position", () => {
    const [item] = menuItems(
      collection('Bedding', 'bedding', [
        collection('Pillows', 'pillows'),
        collection('Care', 'care', [collection('Protectors', 'protectors')]),
        collection('Sheets', 'sheets'),
      ]),
    );
    expect(item?.kind).toBe('menu');
    if (item?.kind !== 'menu') return;
    expect(item.groups.map((group) => group.heading)).toEqual([null, 'Care']);
    expect(item.groups[0]?.links.map((link) => link.label)).toEqual([
      'Pillows',
      'Sheets',
    ]);
  });

  it('a group heading with no link of its own has no headingTo', () => {
    const [item] = menuItems(
      collection('Guides', 'guides', [
        {
          title: 'Buying',
          type: 'HTTP',
          url: null,
          items: [collection('Sizes', 'sizes')],
        },
      ]),
    );
    if (item?.kind !== 'menu') throw new Error('expected a menu');
    expect(item.groups[0]).toEqual({
      id: 'menu-0-g0',
      heading: 'Buying',
      links: [{label: 'Sizes', to: '/collections/sizes'}],
    });
  });

  it('a top-level item with children but no link of its own is a menu without "to"', () => {
    const [item] = menuItems({
      title: 'Shop',
      type: 'HTTP',
      url: null,
      items: [collection('Beds', 'beds')],
    });
    if (item?.kind !== 'menu') throw new Error('expected a menu');
    expect(item.to).toBeUndefined();
    expect(item.groups[0]?.links).toEqual([
      {label: 'Beds', to: '/collections/beds'},
    ]);
  });

  it('a top-level item whose children are all unusable falls back to its own link, or is dropped', () => {
    const broken = {title: 'x', type: 'METAOBJECT', url: SHOP};
    expect(menuItems(collection('Sale', 'sale', [broken]))).toEqual([
      {kind: 'link', id: 'menu-0', label: 'Sale', to: '/collections/sale'},
    ]);
    expect(
      menuItems({title: 'Nothing', type: 'HTTP', url: null, items: [broken]}),
    ).toEqual([]);
  });

  it('marks external links at every level', () => {
    const external = {
      title: 'Partner',
      type: 'HTTP',
      url: 'https://partner.example.org/',
    };
    const [top, group] = menuItems(
      {...external, title: 'Top'},
      {
        title: 'More',
        type: 'HTTP',
        url: 'https://partner.example.org/more',
        items: [{...external, title: 'Heading', items: [external]}],
      },
    );
    expect(top).toEqual({
      kind: 'link',
      id: 'menu-0',
      label: 'Top',
      to: 'https://partner.example.org/',
      external: true,
    });
    if (group?.kind !== 'menu') throw new Error('expected a menu');
    expect(group.external).toBe(true);
    expect(group.groups[0]).toMatchObject({
      headingExternal: true,
      links: [{to: 'https://partner.example.org/', external: true}],
    });
  });

  it('reads only three levels: deeper items are ignored', () => {
    const deep = collection('L1', 'l1', [
      collection('L2', 'l2', [
        collection('L3', 'l3', [
          collection('L4', 'l4', [collection('L5', 'l5')]),
        ]),
      ]),
    ]);
    const [item] = menuItems(deep);
    if (item?.kind !== 'menu') throw new Error('expected a menu');
    expect(item.groups).toHaveLength(1);
    expect(item.groups[0]?.links).toEqual([
      {label: 'L3', to: '/collections/l3'},
    ]);
    expect(JSON.stringify(item)).not.toContain('l4');
  });
});

describe('buildMainNav: untrusted and malformed content', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'menu'],
    ['a number', 7],
    ['no items', {}],
    ['items not an array', {items: 'x'}],
    ['an array', [collection('Sale', 'sale')]],
    ['empty items', {items: []}],
  ])('%s gives an empty result without throwing', (_name, input) => {
    expect(buildMainNav(input, OPTIONS).items).toEqual([]);
  });

  it('skips junk entries and keeps the good ones', () => {
    const result = buildMainNav(
      {
        items: [
          null,
          7,
          'x',
          {title: 42, type: 'COLLECTION', url: `${SHOP}/collections/a`},
          {title: 'No link', type: 'PAGE'},
          {title: '   ', type: 'PAGE', url: `${SHOP}/pages/blank-title`},
          {title: 'Bad scheme', type: 'HTTP', url: 'javascript:alert(1)'},
          {
            title: 'Items not array',
            type: 'COLLECTION',
            url: `${SHOP}/collections/ok`,
            items: {},
          },
          collection('Good', 'good', [null, 5, collection('Child', 'child')]),
        ],
      },
      OPTIONS,
    );
    expect(result.items.map((item) => item.label)).toEqual([
      'Items not array',
      'Good',
    ]);
    expect(result.dropped).toBeGreaterThanOrEqual(7);
  });

  it('sanitises titles and never lets markup reach a label', () => {
    const [item] = menuItems(
      collection('<img src=x onerror=alert(1)>Sale​ <b>now</b>', 'sale'),
    );
    expect(item?.label).toBe('Sale now');
  });

  it('drops duplicates: same label and target at the top, same target inside a group', () => {
    const items = menuItems(
      collection('Sale', 'sale'),
      collection('SALE', 'sale'),
      collection('Sale items', 'sale'),
      collection('Group', 'group', [
        collection('Queen', 'queen', []),
        collection('Queen again', 'queen', []),
        collection('King', 'king', []),
      ]),
    );
    expect(items.map((item) => item.label)).toEqual([
      'Sale',
      'Sale items',
      'Group',
    ]);
    const group = items[2];
    if (group?.kind !== 'menu') throw new Error('expected a menu');
    expect(group.groups[0]?.links.map((link) => link.label)).toEqual([
      'Queen',
      'King',
    ]);
  });

  it('gives every item and group a unique, position-based id', () => {
    const items = menuItems(
      collection('A', 'a', [collection('A1', 'a1', [collection('X', 'x')])]),
      collection('B', 'b', [collection('B1', 'b1', [collection('Y', 'y')])]),
    );
    const ids = items.flatMap((item) =>
      item.kind === 'menu'
        ? [item.id, ...item.groups.map((group) => group.id)]
        : [item.id],
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['menu-0', 'menu-0-g0', 'menu-1', 'menu-1-g0']);
  });

  it('is deterministic (server and browser build the same ids)', () => {
    const input = menu(collection('A', 'a', [collection('A1', 'a1')]));
    expect(buildMainNav(input, OPTIONS)).toEqual(buildMainNav(input, OPTIONS));
  });
});

describe('buildMainNav: caps', () => {
  it(`keeps at most ${MAX_TOP_ITEMS} top-level items and counts the rest as dropped`, () => {
    const many = Array.from({length: MAX_TOP_ITEMS + 5}, (_, index) =>
      collection(`Item ${index}`, `item-${index}`),
    );
    const result = buildMainNav(menu(...many), OPTIONS);
    expect(result.items).toHaveLength(MAX_TOP_ITEMS);
    expect(result.items.at(-1)?.label).toBe(`Item ${MAX_TOP_ITEMS - 1}`);
    expect(result.dropped).toBe(5);
  });

  it(`keeps at most ${MAX_GROUPS_PER_ITEM} groups per item and ${MAX_LINKS_PER_GROUP} links per group`, () => {
    const groups = Array.from({length: MAX_GROUPS_PER_ITEM + 3}, (_, g) =>
      collection(`Group ${g}`, `group-${g}`, [
        collection(`Link ${g}`, `link-${g}`),
      ]),
    );
    const links = Array.from({length: MAX_LINKS_PER_GROUP + 4}, (_, l) =>
      collection(`Leaf ${l}`, `leaf-${l}`),
    );
    const [wide, long] = menuItems(
      collection('Wide', 'wide', groups),
      collection('Long', 'long', [collection('Only group', 'only', links)]),
    );
    if (wide?.kind !== 'menu' || long?.kind !== 'menu') {
      throw new Error('expected menus');
    }
    expect(wide.groups).toHaveLength(MAX_GROUPS_PER_ITEM);
    expect(long.groups[0]?.links).toHaveLength(MAX_LINKS_PER_GROUP);
  });

  it('caps the heading-less group too', () => {
    const [item] = menuItems(
      collection(
        'Many',
        'many',
        Array.from({length: MAX_LINKS_PER_GROUP + 2}, (_, index) =>
          collection(`Leaf ${index}`, `leaf-${index}`),
        ),
      ),
    );
    if (item?.kind !== 'menu') throw new Error('expected a menu');
    expect(item.groups).toHaveLength(1);
    expect(item.groups[0]?.links).toHaveLength(MAX_LINKS_PER_GROUP);
  });
});

describe('mainNavWithQuizCta', () => {
  const menuItemsList: MainNavItem[] = [
    {kind: 'link', id: 'menu-0', label: 'Sale', to: '/collections/sale'},
  ];

  it('shows the menu followed by the quiz call to action', () => {
    expect(mainNavWithQuizCta(menuItemsList, MAIN_NAV)).toEqual([
      ...menuItemsList,
      SLEEP_QUIZ_LINK,
    ]);
  });

  it.each([null, []])('falls back to the fixed navigation for %j', (value) => {
    expect(mainNavWithQuizCta(value, MAIN_NAV)).toEqual([
      ...MAIN_NAV,
      SLEEP_QUIZ_LINK,
    ]);
  });

  it('does not repeat the quiz when the menu already links to it', () => {
    const withQuiz: MainNavItem[] = [
      {kind: 'link', id: 'menu-0', label: 'Find a bed', to: '/quiz'},
    ];
    expect(mainNavWithQuizCta(withQuiz, MAIN_NAV)).toEqual(withQuiz);
  });
});

describe('resolveMenuHandle (PUBLIC_NAV_MENU_HANDLE is opt-in)', () => {
  it.each([
    [undefined, null],
    [null, null],
    ['', null],
    ['  ', null],
    ['main-menu', 'main-menu'],
    [' Mega-Menu ', 'mega-menu'],
    ['none', null],
    ['NONE', null],
    ['../admin', null],
    ['has space', null],
    ['-leading', null],
    ['a'.repeat(65), null],
    [42, null],
    [{}, null],
  ])('%j -> %j', (raw, expected) => {
    expect(resolveMenuHandle(raw)).toBe(expected);
  });
});
