import {describe, expect, it} from 'vitest';
import type {BrandSummary} from '~/lib/shopify/brand-data';
import {resolveBrandLink} from '~/lib/shopify/brand-link';

// REQ-COL-005 / REQ-PDP-002: the product page links its brand or vendor to /brands/<handle> only when a brand
// entry stands behind the name; otherwise it shows plain text.

const INDEX: readonly BrandSummary[] = [
  {
    handle: 'acme-sleep',
    name: 'Acme Sleep',
    logo: null,
    to: '/brands/acme-sleep',
  },
  {handle: 'zen-rest', name: 'Zen Rest', logo: null, to: '/brands/zen-rest'},
];

describe('resolveBrandLink', () => {
  it("uses the product's own brand entry by its metaobject handle", () => {
    expect(
      resolveBrandLink({
        vendor: 'Something else',
        brand: {name: 'Acme Sleep', handle: 'acme-sleep', slug: 'other'},
        index: [],
      }),
    ).toEqual({name: 'Acme Sleep', to: '/brands/acme-sleep'});
  });

  it('falls back to the brand entry slug when the handle is absent or unusable', () => {
    expect(
      resolveBrandLink({
        vendor: null,
        brand: {name: 'Acme Sleep', handle: null, slug: ' Acme-Sleep '},
        index: [],
      }),
    ).toEqual({name: 'Acme Sleep', to: '/brands/acme-sleep'});
  });

  it('matches the vendor to the brand list, ignoring case and spacing', () => {
    expect(
      resolveBrandLink({vendor: '  zen   REST ', brand: null, index: INDEX}),
    ).toEqual({name: 'Zen Rest', to: '/brands/zen-rest'});
  });

  it('matches the vendor when the brand entry exists but has no usable handle', () => {
    expect(
      resolveBrandLink({
        vendor: 'Acme Sleep',
        brand: {name: 'Acme Sleep', handle: null, slug: 'Not A Handle!'},
        index: INDEX,
      }),
    ).toEqual({name: 'Acme Sleep', to: '/brands/acme-sleep'});
  });

  it.each([
    ['an unknown vendor', 'Nobody Beds'],
    ['an empty vendor', ''],
    ['a vendor containing a brand name', 'Acme Sleep Outlet'],
    ['no vendor', null],
  ])('is plain text for %s', (_label, vendor) => {
    expect(resolveBrandLink({vendor, brand: null, index: INDEX})).toBeNull();
  });

  it('is plain text when there is no brand list at all (a store without brands, or a failed read)', () => {
    expect(
      resolveBrandLink({vendor: 'Acme Sleep', brand: null, index: []}),
    ).toBeNull();
  });
});
