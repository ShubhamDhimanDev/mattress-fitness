import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import home from '../../fixtures/shopify/home.json';
import {fakeStorefront} from './fake-storefront';
import {recorded} from './recorded';
import type {
  CatalogHomeQuery,
  CatalogHomeSectionsQuery,
} from 'storefrontapi.generated';
import {
  HOMEPAGE_SECTION_TYPES,
  PLACEHOLDER_HOME_SECTIONS,
  mapHomeSections,
} from '~/lib/shopify/home-sections';
import {
  HOME_SECTIONS_QUERY,
  buildHomeData,
  loadHome,
} from '~/lib/shopify/home-data';
import {parseAdminLink} from '~/lib/shopify/admin-link';

// REQ-HOME-001 / P3B-13: homepage sections from Shopify admin.

function node(
  id: string,
  fields: Record<string, string>,
  imageUrl?: string,
): CatalogHomeSectionsQuery['sections']['nodes'][number] {
  return {
    id,
    fields: [
      ...Object.entries(fields).map(([key, value]) => ({
        key,
        value,
        reference: null,
      })),
      ...(imageUrl
        ? [
            {
              key: 'image',
              value: 'gid://shopify/MediaImage/1',
              reference: {
                image: {url: imageUrl, altText: 'Alt', width: 10, height: 10},
              },
            },
          ]
        : []),
    ],
  };
}

const ON = {enabled: 'true'};

describe('definitions.json and the code agree on section types', () => {
  it('lists exactly HOMEPAGE_SECTION_TYPES as the choices of homepage_section.type', () => {
    const spec = JSON.parse(
      readFileSync(
        new URL(
          '../../../../scripts/shopify/definitions.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as {
      metaobjectDefinitions: {
        type: string;
        fieldDefinitions: {
          key: string;
          validations?: {name: string; value: unknown}[];
        }[];
      }[];
    };
    const field = spec.metaobjectDefinitions
      .find((d) => d.type === 'homepage_section')
      ?.fieldDefinitions.find((f) => f.key === 'type');
    expect(field?.validations).toEqual([
      {name: 'choices', value: [...HOMEPAGE_SECTION_TYPES]},
    ]);
  });
});

describe('mapHomeSections', () => {
  it('orders by the admin order number, then by the order Shopify returned', () => {
    const sections = mapHomeSections([
      node('a', {...ON, type: 'brands', order: '30'}),
      node('b', {...ON, type: 'hero', heading: 'Hello', order: '10'}),
      node('c', {...ON, type: 'categories', order: '20'}),
      node('d', {...ON, type: 'featured', order: '20'}),
    ]);
    expect(
      sections.map((s) => (s.kind === 'banner' ? s.type : s.kind)),
    ).toEqual(['hero', 'catalog', 'catalog', 'catalog']);
    expect(
      sections.flatMap((s) => (s.kind === 'catalog' ? [s.type] : [])),
    ).toEqual(['categories', 'featured', 'brands']);
  });

  it('sends entries without a usable order number last', () => {
    const sections = mapHomeSections([
      node('a', {...ON, type: 'brands', order: 'soon'}),
      node('b', {...ON, type: 'featured', order: '5'}),
    ]);
    expect(
      sections.flatMap((s) => (s.kind === 'catalog' ? [s.type] : [])),
    ).toEqual(['featured', 'brands']);
  });

  it('shows a section only when enabled is exactly true', () => {
    const sections = mapHomeSections([
      node('a', {type: 'featured', order: '1'}),
      node('b', {type: 'brands', order: '2', enabled: 'false'}),
      node('c', {type: 'categories', order: '3', enabled: 'TRUE'}),
    ]);
    expect(sections).toHaveLength(1);
  });

  it('drops unknown types, hostile types and empty banners', () => {
    const sections = mapHomeSections([
      node('a', {...ON, type: 'carousel', order: '1'}),
      node('b', {...ON, type: '<script>', order: '2'}),
      node('c', {...ON, type: 'promo-banner', order: '3'}),
      node('d', {...ON, type: 'hero', order: '4', heading: '   '}),
    ]);
    expect(sections).toEqual([]);
  });

  it('keeps only the first block of each catalog type but allows several banners', () => {
    const sections = mapHomeSections([
      node('a', {...ON, type: 'featured', order: '1', heading: 'First'}),
      node('b', {...ON, type: 'featured', order: '2', heading: 'Second'}),
      node('c', {...ON, type: 'promo-banner', order: '3', heading: 'One'}),
      node('d', {...ON, type: 'promo-banner', order: '4', heading: 'Two'}),
    ]);
    expect(sections).toHaveLength(3);
    expect(sections[0]).toMatchObject({kind: 'catalog', heading: 'First'});
  });

  it('builds a banner from admin text, link and image only', () => {
    const [banner] = mapHomeSections([
      node(
        'a',
        {
          ...ON,
          type: 'financing',
          order: '1',
          heading: 'Pay over time',
          body: 'First paragraph\n\nSecond paragraph',
          link: '/pages/financing',
          link_label: 'See options',
        },
        'https://cdn.shopify.com/x.jpg',
      ),
    ]);
    expect(banner).toMatchObject({
      kind: 'banner',
      type: 'financing',
      heading: 'Pay over time',
      body: ['First paragraph', 'Second paragraph'],
      link: {href: '/pages/financing', external: false},
      linkLabel: 'See options',
      image: {url: 'https://cdn.shopify.com/x.jpg'},
    });
  });

  it('drops a non-https image and an unsafe link instead of rendering them', () => {
    const [banner] = mapHomeSections([
      node(
        'a',
        {
          ...ON,
          type: 'hero',
          order: '1',
          heading: 'H',
          link: 'javascript:alert(1)',
        },
        'http://evil.test/x.jpg',
      ),
    ]);
    expect(banner).toMatchObject({kind: 'banner', link: null, image: null});
  });

  it('strips markup-like characters out of headings (text is escaped again on render)', () => {
    const [banner] = mapHomeSections([
      node('a', {...ON, type: 'hero', order: '1', heading: 'Big​ sale'}),
    ]);
    expect(banner).toMatchObject({heading: 'Big sale'});
  });

  it('reads at most 30 entries and tolerates null input', () => {
    const many = Array.from({length: 40}, (_, i) =>
      node(`n${i}`, {
        ...ON,
        type: 'promo-banner',
        order: String(i),
        heading: `H${i}`,
      }),
    );
    expect(mapHomeSections(many)).toHaveLength(30);
    expect(mapHomeSections(null)).toEqual([]);
    expect(mapHomeSections(undefined)).toEqual([]);
  });

  it('keeps the signup type as a reserved block', () => {
    expect(
      mapHomeSections([node('a', {...ON, type: 'signup', order: '1'})]),
    ).toEqual([{kind: 'signup', id: 'home-section-0'}]);
  });
});

describe('home data sections', () => {
  const typed = recorded<CatalogHomeQuery>(home);

  it('uses the placeholder layout when the store has no usable entries', () => {
    const data = buildHomeData(typed, []);
    expect(data.sectionsSource).toBe('placeholder');
    expect(data.sections).toEqual(PLACEHOLDER_HOME_SECTIONS);
    expect(data.sections[0]).toEqual({
      kind: 'placeholder-hero',
      id: 'home-placeholder-hero',
    });
  });

  it('uses the admin layout when entries exist', () => {
    const data = buildHomeData(typed, [
      node('a', {...ON, type: 'shop-by-size', order: '1', heading: 'Sizes'}),
    ]);
    expect(data.sectionsSource).toBe('admin');
    expect(data.sections).toHaveLength(1);
  });

  it('reads the sections with the long cache and survives a failed read', async () => {
    const ok = fakeStorefront((call) =>
      call.query === HOME_SECTIONS_QUERY
        ? {
            sections: {
              nodes: [node('a', {...ON, type: 'brands', order: '1'})],
            },
          }
        : home,
    );
    const data = await loadHome(ok.storefront);
    const sectionsCall = ok.calls.find((c) => c.query === HOME_SECTIONS_QUERY);
    expect(sectionsCall?.cache).toEqual({mode: 'long'});
    expect(data.sectionsSource).toBe('admin');

    const failing = fakeStorefront((call) => {
      if (call.query === HOME_SECTIONS_QUERY) throw new Error('boom');
      return home;
    });
    expect((await loadHome(failing.storefront)).sectionsSource).toBe(
      'placeholder',
    );
  });
});

describe('parseAdminLink (T-08)', () => {
  it.each([
    ['/collections/sale', {href: '/collections/sale', external: false}],
    ['  /pages/a?x=1  ', {href: '/pages/a?x=1', external: false}],
    ['https://example.com/a', {href: 'https://example.com/a', external: true}],
  ])('accepts %s', (raw, expected) => {
    expect(parseAdminLink(raw)).toEqual(expected);
  });

  it.each([
    '',
    '   ',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,hi',
    'http://example.com',
    '//evil.test/x',
    '/\\evil.test',
    '/a b',
    '/&#47;evil.test',
    'mailto:a@b.c',
    'collections/sale',
    '/x\u0000y',
    `/${'a'.repeat(600)}`,
  ])('rejects %j', (raw) => {
    expect(parseAdminLink(raw)).toBeNull();
  });

  it('returns null for missing input', () => {
    expect(parseAdminLink(null)).toBeNull();
    expect(parseAdminLink(undefined)).toBeNull();
  });
});
