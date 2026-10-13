import {describe, expect, it} from 'vitest';
import type {
  CatalogProductAvailabilityQuery,
  CatalogProductQuery,
} from 'storefrontapi.generated';
import productJson from '../../fixtures/shopify/product.json';
import availabilityJson from '../../fixtures/shopify/product-availability.json';
import {recorded} from './recorded';
import {
  mapProductPage,
  type AvailabilitySource,
  type ProductSource,
} from '~/lib/shopify/product';
import {
  buildBreadcrumbJsonLd,
  buildFaqJsonLd,
  buildProductJsonLd,
} from '~/lib/shopify/jsonld';

// REQ-PDP-001 / REQ-PDP-002: the product view model and its JSON-LD, from a response recorded on
// bedding.mock.shop (no metafields exist there, so metafield cases are edited copies).

function source(
  edit: (product: ProductSource) => void = () => {},
): ProductSource {
  const product = recorded<NonNullable<CatalogProductQuery['product']>>(
    productJson.product,
  );
  edit(product);
  return product;
}

function fresh(
  edit: (product: AvailabilitySource) => void = () => {},
): AvailabilitySource {
  const product = recorded<
    NonNullable<CatalogProductAvailabilityQuery['product']>
  >(availabilityJson.product);
  edit(product);
  return product;
}

describe('mapProductPage (REQ-PDP-001)', () => {
  it('maps the recorded product', () => {
    const view = mapProductPage(source(), fresh());
    expect(view.handle).toBe('linen-pillowcase-pair-in-warm-clay');
    expect(view.options.map((o) => o.name)).toEqual(['Size', 'Color']);
    expect(view.options[0].values).toEqual(['Twin', 'Full', 'Queen', 'King']);
    expect(view.variants).toHaveLength(12);
    expect(view.images.length).toBeGreaterThan(0);
    expect(view.comfortLevel).toBeNull();
    expect(view.specifications).toEqual([]);
    expect(view.features).toEqual([]);
    expect(view.brand).toBeNull();
    expect(view.faqs).toEqual([]);
  });

  it('turns the description into plain paragraphs', () => {
    const view = mapProductPage(
      source((p) => {
        p.description = 'First <b>line</b>.\n\n<script>x()</script>Second.';
      }),
      null,
    );
    expect(view.description).toEqual(['First line.', 'x()Second.']);
  });

  it('lets the short-cached read win for price and availability', () => {
    const base = source();
    const id = base.variants.nodes[0].id;
    const view = mapProductPage(
      base,
      fresh((p) => {
        const v = p.variants.nodes.find((n) => n.id === id);
        if (v) {
          v.availableForSale = false;
          v.price = {amount: '70.0', currencyCode: 'USD'};
          v.compareAtPrice = {amount: '90.0', currencyCode: 'USD'};
        }
      }),
    );
    const variant = view.variants.find((v) => v.id === id);
    expect(variant?.available).toBe(false);
    expect(variant?.price.amount).toBe('70.0');
    expect(variant?.compareAt?.amount).toBe('90.0');
  });

  it('keeps the content values when the availability read is missing', () => {
    const view = mapProductPage(source(), null);
    expect(view.variants[0].price.amount).toBe('75.0');
    expect(view.variants[0].available).toBe(true);
  });

  it.each([
    ['above price', '90.0', '90.0'],
    ['equal to price', '75.0', null],
    ['below price', '10.0', null],
    ['malformed', 'abc', null],
  ])('compare-at %s', (_name, compareAt, expected) => {
    const view = mapProductPage(
      source((p) => {
        p.variants.nodes[0].compareAtPrice = {
          amount: compareAt,
          currencyCode: 'USD',
        };
      }),
      null,
    );
    expect(view.variants[0].compareAt?.amount ?? null).toBe(expected);
  });

  it('skips variants with a malformed price instead of failing the page', () => {
    const view = mapProductPage(
      source((p) => {
        p.variants.nodes[0].price = {amount: '1,299.00', currencyCode: 'USD'};
      }),
      null,
    );
    expect(view.variants).toHaveLength(11);
  });

  it('reads dimensions from the variant metafield', () => {
    const view = mapProductPage(
      source((p) => {
        p.variants.nodes[0].dimensions = {value: '38" x 75"'};
      }),
      null,
    );
    expect(view.variants[0].dimensions).toBe('38" x 75"');
    expect(view.variants[1].dimensions).toBeNull();
  });

  it('handles a single-variant product', () => {
    const view = mapProductPage(
      source((p) => {
        p.options = [{name: 'Title', optionValues: [{name: 'Default Title'}]}];
        p.variants.nodes = [
          {
            ...p.variants.nodes[0],
            title: 'Default Title',
            sku: '',
            selectedOptions: [{name: 'Title', value: 'Default Title'}],
          },
        ];
      }),
      null,
    );
    expect(view.variants).toHaveLength(1);
    expect(view.variants[0].sku).toBeNull();
  });

  it('falls back to the featured image when the product has no gallery', () => {
    const view = mapProductPage(
      source((p) => {
        p.images.nodes = [];
      }),
      null,
    );
    expect(view.images).toHaveLength(1);
  });
});

describe('mapProductPage content (REQ-PDP-002)', () => {
  it('maps specifications, features, attributes, brand and FAQs when they exist', () => {
    const view = mapProductPage(
      source((p) => {
        p.metafields = [
          {key: 'comfort_level', value: 'Plush'},
          {key: 'mattress_type', value: 'Hybrid'},
          {key: 'sleep_positions', value: '["Side","Back"]'},
          {key: 'benefits', value: '["Cooling"]'},
          {key: 'height_inches', value: '12.5'},
          {
            key: 'specifications',
            value: '[{"label":"Layers","value":"5"},{"label":"","value":"x"}]',
          },
          {key: 'features', value: '["Cooling cover","<b>Edge support</b>"]'},
        ];
        p.brand = {
          reference: {
            id: 'gid://shopify/Metaobject/1',
            fields: [
              {key: 'name', value: 'Acme Sleep', reference: null},
              {
                key: 'about',
                value:
                  '{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","value":"Made well."}]}]}',
                reference: null,
              },
            ],
          },
        };
        p.faqs = {
          references: {
            nodes: [
              {
                id: 'gid://shopify/Metaobject/2',
                fields: [
                  {key: 'question', value: 'Is it firm?'},
                  {key: 'answer', value: 'It is <i>medium</i>.'},
                ],
              },
              {
                id: 'gid://shopify/Metaobject/3',
                fields: [{key: 'question', value: 'No answer'}],
              },
            ],
          },
        };
      }),
      null,
    );
    expect(view.comfortLevel).toBe('Plush');
    expect(view.mattressType).toBe('Hybrid');
    expect(view.sleepPositions).toEqual(['Back', 'Side']);
    expect(view.heightInches).toBe(12.5);
    expect(view.specifications).toEqual([{label: 'Layers', value: '5'}]);
    expect(view.features).toEqual(['Cooling cover', 'Edge support']);
    expect(view.brand?.name).toBe('Acme Sleep');
    expect(view.brand?.about).toEqual(['Made well.']);
    expect(view.faqs).toHaveLength(1);
    expect(view.faqs[0].answer).toEqual(['It is medium.']);
  });

  it('never carries markup from the admin into the view', () => {
    const view = mapProductPage(
      source((p) => {
        p.metafields = [
          {key: 'features', value: '["<img src=x onerror=alert(1)>Soft"]'},
        ];
        p.description = '<img src=x onerror=alert(1)>Soft';
      }),
      null,
    );
    expect(JSON.stringify(view)).not.toContain('<img');
    expect(JSON.stringify(view)).not.toContain('onerror');
  });
});

describe('structured data (REQ-PDP-002, REQ-COL-004)', () => {
  const origin = 'https://shop.example';

  it('builds Product JSON-LD with an aggregate offer from the same data as the page', () => {
    const view = mapProductPage(source(), fresh());
    const ld = buildProductJsonLd(view, origin);
    expect(ld['@type']).toBe('Product');
    expect(ld.name).toBe(view.title);
    const offers = ld.offers as {
      '@type': string;
      lowPrice: string;
      highPrice: string;
      offerCount: number;
      offers: {price: string; availability: string; url: string}[];
    };
    expect(offers['@type']).toBe('AggregateOffer');
    expect(offers.lowPrice).toBe('75.00');
    expect(offers.offerCount).toBe(12);
    expect(offers.offers[0].url).toMatch(
      /^https:\/\/shop\.example\/products\/.+\?Size=Twin&Color=Sand$/,
    );
    expect(JSON.stringify(ld)).not.toContain('aggregateRating');
  });

  it('uses a single Offer for a single variant and marks sold out', () => {
    const view = mapProductPage(
      source((p) => {
        p.variants.nodes = [{...p.variants.nodes[0], availableForSale: false}];
      }),
      null,
    );
    const ld = buildProductJsonLd(view, origin);
    const offer = ld.offers as {'@type': string; availability: string};
    expect(offer['@type']).toBe('Offer');
    expect(offer.availability).toBe('https://schema.org/OutOfStock');
  });

  it('builds a breadcrumb list and FAQPage only when there is data', () => {
    const crumbs = buildBreadcrumbJsonLd(
      [
        {name: 'Home', path: '/'},
        {name: 'Mattresses', path: '/collections/mattresses'},
      ],
      origin,
    );
    expect(JSON.stringify(crumbs)).toContain('"position":2');
    expect(buildFaqJsonLd([])).toBeNull();
    const faq = buildFaqJsonLd([
      {id: '1', question: 'Q?', answer: ['A.', 'B.']},
    ]);
    expect(JSON.stringify(faq)).toContain('"text":"A.\\n\\nB."');
  });
});
