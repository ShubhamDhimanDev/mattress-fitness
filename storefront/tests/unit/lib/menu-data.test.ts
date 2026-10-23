import type {Storefront} from '@shopify/hydrogen';
import {describe, expect, it, vi} from 'vitest';
import {loadMainNav, MAIN_MENU_QUERY} from '~/lib/shopify/menu-data';

// REQ-NAV-002: a missing, empty or failing menu read must give null (the layout keeps the fixed navigation),
// never an exception, and must use the long catalog cache (a menu has no price or shopper data).

const LONG_CACHE = {mode: 'public', maxAge: 3600};

function fakeStorefront(query: ReturnType<typeof vi.fn>): Storefront {
  // Only the members the module touches are provided.
  return {query, CacheLong: () => LONG_CACHE} as unknown as Storefront;
}

// The Shopify menu is opt-in: a deployment names the handle (PUBLIC_NAV_MENU_HANDLE).
const ENV = {
  PUBLIC_STORE_DOMAIN: 'example-shop.myshopify.com',
  PUBLIC_NAV_MENU_HANDLE: 'main-menu',
};

describe('loadMainNav', () => {
  it('queries main-menu with the long cache and maps the result', async () => {
    const query = vi.fn().mockResolvedValue({
      menu: {
        items: [
          {
            title: 'Sale',
            type: 'COLLECTION',
            url: 'https://example-shop.myshopify.com/collections/sale',
            items: [],
          },
        ],
      },
    });
    const items = await loadMainNav(fakeStorefront(query), ENV);
    expect(items).toEqual([
      {kind: 'link', id: 'menu-0', label: 'Sale', to: '/collections/sale'},
    ]);
    expect(query).toHaveBeenCalledWith(MAIN_MENU_QUERY, {
      cache: LONG_CACHE,
      variables: {handle: 'main-menu'},
    });
  });

  it('reads the menu named by PUBLIC_NAV_MENU_HANDLE', async () => {
    const query = vi.fn().mockResolvedValue({menu: null});
    await loadMainNav(fakeStorefront(query), {
      PUBLIC_NAV_MENU_HANDLE: 'mega-menu',
    });
    expect(query.mock.calls[0]?.[1]).toMatchObject({
      variables: {handle: 'mega-menu'},
    });
  });

  it.each([undefined, '', '  ', 'none', '../x', 'bad handle'])(
    'reads nothing, with no Storefront call, and keeps the fixed navigation for PUBLIC_NAV_MENU_HANDLE=%j',
    async (value) => {
      const query = vi.fn();
      expect(
        await loadMainNav(fakeStorefront(query), {
          PUBLIC_NAV_MENU_HANDLE: value,
        }),
      ).toBeNull();
      expect(query).not.toHaveBeenCalled();
    },
  );

  it('treats the store domain as our own host for plain URLs', async () => {
    const query = vi.fn().mockResolvedValue({
      menu: {
        items: [
          {
            title: 'FAQ',
            type: 'HTTP',
            url: 'https://example-shop.myshopify.com/pages/faq',
            items: [],
          },
        ],
      },
    });
    const items = await loadMainNav(fakeStorefront(query), ENV);
    expect(items?.[0]).toMatchObject({to: '/pages/faq'});
    expect(items?.[0]).not.toHaveProperty('external');
  });

  it.each([
    ['an absent menu', {menu: null}],
    ['an empty menu', {menu: {items: []}}],
    [
      'a menu with nothing usable',
      {menu: {items: [{title: 'x', type: 'METAOBJECT', url: null, items: []}]}},
    ],
  ])('gives null for %s', async (_name, response) => {
    const query = vi.fn().mockResolvedValue(response);
    expect(await loadMainNav(fakeStorefront(query), ENV)).toBeNull();
  });

  it('gives null, and logs only the error class, when the read fails', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const query = vi
      .fn()
      .mockRejectedValue(new TypeError('secret token abc in message'));
    expect(await loadMainNav(fakeStorefront(query), ENV)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain('nav.menu_read_failed');
    expect(line).toContain('TypeError');
    expect(line).not.toContain('secret');
  });

  it('requests three levels of only the fields the mapper reads', () => {
    expect(MAIN_MENU_QUERY.match(/items \{/g)).toHaveLength(3);
    expect(MAIN_MENU_QUERY).not.toMatch(/\b(resourceId|tags)\b/);
  });
});
