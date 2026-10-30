import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {fakeStorefront, type RecordedCall} from '../catalog/fake-storefront';
import {resetContentPagesLogMemory} from '~/lib/shopify/content-pages-data';
import {resetMenuLogMemory} from '~/lib/shopify/menu-data';
import {loader} from '~/root';

// REQ-CNT-001 / REQ-NAV-001: what the root loader hands the shell from the content existence read: the footer
// links, the utility links, the fixed navigation (only when no admin menu is used) and the consent banner's
// privacy target. Three situations: admin menu present, read failure, read success.

const SITE = 'https://www.example.com';

type Pages = Record<string, string>;

function contentAnswer(pages: Pages, policies: string[] = []) {
  const handles = [
    'contact',
    'delivery-and-shipping',
    'financing',
    'warranty-and-returns',
    'faq',
    'size-guide',
    'comfort-guide',
    'mattress-types-guide',
    'adjustable-base-guide',
    'about',
    'comfort-guarantee',
    'price-guarantee',
    'privacy-policy',
    'terms',
    'accessibility',
  ];
  const data: Record<string, unknown> = {
    blog0: null,
    shop: {
      privacyPolicy: policies.includes('privacyPolicy') ? {id: 'p'} : null,
      termsOfService: policies.includes('termsOfService') ? {id: 't'} : null,
    },
  };
  handles.forEach((handle, index) => {
    const body = pages[handle];
    data[`page${index}`] = body === undefined ? null : {body};
  });
  return data;
}

function run(
  respond: (call: RecordedCall) => unknown,
  env: Record<string, string> = {},
) {
  const {storefront} = fakeStorefront(respond);
  const context = {
    storefront: Object.assign(storefront, {
      i18n: {country: 'US', language: 'EN'},
    }),
    env: {
      PUBLIC_SITE_URL: SITE,
      PUBLIC_STORE_DOMAIN: 'example-shop.myshopify.com',
      ...env,
    },
    cart: {get: async () => null},
    customerAccount: {isLoggedIn: async () => false},
  };
  return loader({
    request: new Request(`${SITE}/`),
    params: {},
    context,
  } as never);
}

// What Hydrogen's analytics helper reads from the shop query (it fails the page's deferred data, not the loader, when absent).
const SHOP = {
  shop: {id: 'gid://shopify/Shop/1'},
  localization: {
    country: {currency: {isoCode: 'USD'}},
    language: {isoCode: 'EN'},
  },
};

const isContent = (call: RecordedCall) =>
  call.query.includes('query ContentPages');

function respondWith(
  content: () => unknown,
  extra: Record<string, unknown> = {},
) {
  return (call: RecordedCall) =>
    isContent(call) ? content() : {...SHOP, ...extra};
}

function linkTargets(
  nav: ReadonlyArray<{
    to?: string;
    groups?: ReadonlyArray<{links: ReadonlyArray<{to: string}>}>;
  }> | null,
) {
  return (nav ?? []).flatMap((item) => [
    item.to,
    ...(item.groups ?? []).flatMap((group) =>
      group.links.map((link) => link.to),
    ),
  ]);
}

beforeEach(() => {
  resetContentPagesLogMemory();
  resetMenuLogMemory();
});
afterEach(() => vi.restoreAllMocks());

describe('root loader: content links', () => {
  it('read success without an admin menu: links for the pages that exist, a pruned fixed navigation, the privacy target', async () => {
    const data = await run(
      respondWith(() =>
        contentAnswer(
          {
            contact: '<p>Call</p>',
            'size-guide': '<p>Sizes</p>',
            faq: '<p>Q</p>',
          },
          ['privacyPolicy'],
        ),
      ),
    );
    expect(data.mainNav).toBeNull();
    expect(data.utilityLinks.map((link) => link.id)).toEqual([
      'track',
      'contact',
    ]);
    expect(data.fallbackNav).not.toBeNull();
    const guides = linkTargets(data.fallbackNav).filter((to) =>
      /^\/(pages|blogs)\//.test(to ?? ''),
    );
    expect(guides).toEqual([]);
    expect(data.footerLinks.legal.map((link) => link.to)).toEqual([
      '/policies/privacy-policy',
    ]);
    expect(data.privacyPath).toBe('/policies/privacy-policy');
  });

  it('privacy page without a policy: the banner links the page', async () => {
    const data = await run(
      respondWith(() =>
        contentAnswer({'privacy-policy': '<p>We keep little.</p>'}),
      ),
    );
    expect(data.privacyPath).toBe('/pages/privacy-policy');
  });

  it('with an admin menu the fixed navigation is not sent at all', async () => {
    const menu = {
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
    };
    const data = await run(
      (call) =>
        isContent(call)
          ? contentAnswer({contact: '<p>Call</p>'})
          : call.query.includes('query MainMenu')
            ? menu
            : SHOP,
      {PUBLIC_NAV_MENU_HANDLE: 'main-menu'},
    );
    expect(data.mainNav).not.toBeNull();
    expect(data.fallbackNav).toBeNull();
    // The utility links still follow the content data.
    expect(data.utilityLinks.map((link) => link.id)).toEqual([
      'track',
      'contact',
    ]);
  });

  it('read failure: only Track order, no content link anywhere, no privacy target', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const data = await run(
      respondWith(() => {
        throw new Error('down');
      }),
    );
    expect(data.utilityLinks.map((link) => link.id)).toEqual(['track']);
    expect(data.footerLinks.legal).toEqual([]);
    expect(
      data.footerLinks.supportGroups.flatMap((group) =>
        group.links.map((link) => link.to),
      ),
    ).not.toContainEqual(expect.stringMatching(/^\/(pages|policies)\//));
    const remaining = linkTargets(data.fallbackNav).filter((to) =>
      /^\/(pages|blogs)\//.test(to ?? ''),
    );
    expect(remaining).toEqual([]);
    expect(data.privacyPath).toBeNull();
  });

  it('does not let a failed read stop the page: the loader still resolves', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      run(
        respondWith(() => {
          throw new Error('down');
        }),
      ),
    ).resolves.toBeDefined();
  });
});
