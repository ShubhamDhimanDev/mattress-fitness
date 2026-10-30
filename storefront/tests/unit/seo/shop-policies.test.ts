import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe, expect, it, vi} from 'vitest';
import type {ShopPolicyHandlesQuery} from 'storefrontapi.generated';
import {extraSitemapEntries, renderUrlset} from '~/lib/seo/sitemap';
import {
  POLICY_URL_HANDLES,
  SHOP_POLICY_HANDLES_QUERY,
  loadPolicyPaths,
  policyPathsFrom,
} from '~/lib/shopify/shop-policies';
import {fakeStorefront} from '../catalog/fake-storefront';

// REQ-SEO-001 (P7-04): shop policy pages are listed in the extras sitemap only when the shop has written them.

const ORIGIN = 'https://www.example.com';
const policy = (handle: string) => ({handle});

describe('policyPathsFrom', () => {
  it('lists the policies that exist, in a fixed order, under the routed handles', () => {
    const data: ShopPolicyHandlesQuery = {
      shop: {
        privacyPolicy: policy('privacy-policy'),
        shippingPolicy: null,
        termsOfService: policy('terms-of-service'),
        refundPolicy: policy('refund-policy'),
      },
    };
    expect(policyPathsFrom(data)).toEqual([
      '/policies/privacy-policy',
      '/policies/terms-of-service',
      '/policies/refund-policy',
    ]);
  });

  it('never takes the URL from the handle Shopify returns', () => {
    const data: ShopPolicyHandlesQuery = {
      shop: {
        privacyPolicy: policy('../../account'),
        shippingPolicy: policy('<script>'),
        termsOfService: null,
        refundPolicy: null,
      },
    };
    expect(policyPathsFrom(data)).toEqual([
      '/policies/privacy-policy',
      '/policies/shipping-policy',
    ]);
  });

  it('lists nothing for a missing answer', () => {
    expect(policyPathsFrom(null)).toEqual([]);
    expect(policyPathsFrom(undefined)).toEqual([]);
    expect(policyPathsFrom({shop: null} as never)).toEqual([]);
  });

  it('lists nothing when no policy is written', () => {
    expect(
      policyPathsFrom({
        shop: {
          privacyPolicy: null,
          shippingPolicy: null,
          termsOfService: null,
          refundPolicy: null,
        },
      }),
    ).toEqual([]);
  });

  it('does not query the subscription policy, which has no page, or any body', () => {
    expect(SHOP_POLICY_HANDLES_QUERY).not.toContain('subscriptionPolicy');
    expect(SHOP_POLICY_HANDLES_QUERY).not.toMatch(/\bbody\b/);
  });

  it('uses the same handles as the policy route', () => {
    const source = readFileSync(
      fileURLToPath(
        new URL('../../../app/routes/policies.$handle.tsx', import.meta.url),
      ),
      'utf8',
    );
    const routed = [...source.matchAll(/'([a-z-]+)': '([A-Za-z]+)'/g)].map(
      ([, handle, field]) => [field, handle],
    );
    expect(Object.fromEntries(routed)).toEqual(POLICY_URL_HANDLES);
  });
});

describe('loadPolicyPaths', () => {
  it('reads long-cached, without variables or personal data', async () => {
    const {storefront, calls} = fakeStorefront(() => ({
      shop: {
        privacyPolicy: policy('privacy-policy'),
        shippingPolicy: null,
        termsOfService: null,
        refundPolicy: null,
      },
    }));
    expect(await loadPolicyPaths(storefront)).toEqual([
      '/policies/privacy-policy',
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.cache).toEqual({mode: 'long'});
    expect(calls[0]?.variables).toEqual({});
  });

  it('lists none and does not throw when the read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const {storefront} = fakeStorefront(() => {
      throw new Error('down');
    });
    expect(await loadPolicyPaths(storefront)).toEqual([]);
  });
});

describe('extra sitemap entries with policies', () => {
  const locs = (policyPaths?: readonly string[]) =>
    extraSitemapEntries({
      origin: ORIGIN,
      brandPaths: [],
      ...(policyPaths ? {policyPaths} : {}),
    }).map((entry) => entry.loc);

  it('adds only the policies that exist, and none by default', () => {
    expect(locs()).toEqual([`${ORIGIN}/`, `${ORIGIN}/collections`]);
    expect(locs([])).toEqual([`${ORIGIN}/`, `${ORIGIN}/collections`]);
    expect(locs(['/policies/refund-policy'])).toEqual([
      `${ORIGIN}/`,
      `${ORIGIN}/collections`,
      `${ORIGIN}/policies/refund-policy`,
    ]);
  });

  it('renders policy pages as plain urls with no lastmod (Shopify gives none)', () => {
    const xml = renderUrlset(
      extraSitemapEntries({
        origin: ORIGIN,
        brandPaths: [],
        policyPaths: ['/policies/privacy-policy'],
      }),
    );
    expect(xml).toContain(
      `<url><loc>${ORIGIN}/policies/privacy-policy</loc></url>`,
    );
  });
});
