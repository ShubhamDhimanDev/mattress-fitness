import {describe, expect, it} from 'vitest';
import {parseFilterParams, serializeFilterParams} from '~/lib/filters';
import {brandOffersPath, withLeadSort} from '~/lib/shopify/brand-path';
import {leadFirst, leadSortForMenu} from '~/lib/shopify/lead-sort';
import {buildMainNav} from '~/lib/nav-menu';

const products = [
  {id: 'pillow', productType: 'Pillow'},
  {id: 'mattress-a', productType: 'Mattress'},
  {id: 'base', productType: 'Adjustable Base'},
  {id: 'mattress-b', productType: ' mattress '},
  {id: 'box', productType: 'Foundation'},
];

describe('lead group first in listings', () => {
  it('puts mattresses first and keeps each part in its own order', () => {
    expect(leadFirst(products, 'mattress-first').map((p) => p.id)).toEqual([
      'mattress-a',
      'mattress-b',
      'pillow',
      'base',
      'box',
    ]);
  });

  it('puts bases and box springs first for the foundations menu', () => {
    expect(leadFirst(products, 'foundations-first').map((p) => p.id)).toEqual([
      'base',
      'box',
      'pillow',
      'mattress-a',
      'mattress-b',
    ]);
  });

  it('survives the URL round trip and ignores an unknown sort', () => {
    const state = parseFilterParams(
      new URLSearchParams('sort=foundations-first'),
    );
    expect(state.sort).toBe('foundations-first');
    expect(serializeFilterParams(state).get('sort')).toBe('foundations-first');
    expect(parseFilterParams(new URLSearchParams('sort=nope')).sort).toBe(
      'featured',
    );
  });

  it('chooses the sort from the header menu', () => {
    expect(leadSortForMenu('Mattresses', '/collections/mattresses')).toBe(
      'mattress-first',
    );
    expect(leadSortForMenu('Box Springs & Adjustable Beds', undefined)).toBe(
      'foundations-first',
    );
    expect(leadSortForMenu('Beds & Furniture', undefined)).toBe(
      'furniture-first',
    );
    expect(leadSortForMenu('Bedding', undefined)).toBe('bedding-first');
    expect(leadSortForMenu('Sale', undefined)).toBe('mattress-first');
  });

  it('adds the sort to brand links only', () => {
    expect(brandOffersPath('serta')).toBe('/brands/serta?sort=mattress-first');
    expect(withLeadSort('/brands/sealy', 'bedding-first')).toBe(
      '/brands/sealy?sort=bedding-first',
    );
    expect(withLeadSort('/collections/pillows', 'bedding-first')).toBe(
      '/collections/pillows',
    );
    expect(withLeadSort('/brands', 'bedding-first')).toBe('/brands');
  });

  it("applies each header menu's sort to the brand links under it", () => {
    const link = (title: string, url: string) => ({
      title,
      type: 'HTTP',
      url,
      items: [],
    });
    const {items} = buildMainNav({
      items: [
        {
          title: 'Mattresses',
          type: 'HTTP',
          url: '/collections/mattresses',
          items: [link('Sealy', '/brands/sealy')],
        },
        {
          title: 'Box Springs & Adjustable Beds',
          type: 'HTTP',
          url: '/collections/foundations-and-bases',
          items: [
            link('Tempur', '/brands/tempur-pedic'),
            link('Pillows', '/collections/pillows'),
          ],
        },
      ],
    });
    const tos = items.flatMap((item) =>
      item.kind === 'menu'
        ? item.groups.flatMap((g) => g.links.map((l) => l.to))
        : [],
    );
    expect(tos).toEqual([
      '/brands/sealy?sort=mattress-first',
      '/brands/tempur-pedic?sort=foundations-first',
      '/collections/pillows',
    ]);
  });
});
