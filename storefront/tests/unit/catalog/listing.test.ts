import {describe, expect, it} from 'vitest';
import collectionFiltered from '../../fixtures/shopify/collection-filtered.json';
import {emptyFilterState, parseFilterParams} from '~/lib/filters';
import {
  appendUnique,
  buildFilterGroups,
  centsToDollarsInput,
  dollarsInputToCents,
  hrefForPrice,
  hrefForReset,
  hrefForSort,
  hrefForToggle,
  nextPageState,
} from '~/lib/shopify/listing';

// REQ-COL-002 / REQ-SRCH-002: the panel is built from Shopify's own filter response; the URL is the state.

const group = (inputs: {count: number; input: unknown}[]) => ({values: inputs});

describe('buildFilterGroups', () => {
  it('is empty for a store with no filters configured (the recorded mock store)', () => {
    expect(
      buildFilterGroups(
        collectionFiltered.collection.products.filters,
        emptyFilterState(),
      ),
    ).toEqual([]);
  });

  it('shows only the dimensions Shopify returned values for, with Shopify counts', () => {
    const groups = buildFilterGroups(
      [
        group([
          {
            count: 7,
            input: '{"variantOption":{"name":"Size","value":"Queen"}}',
          },
          {count: 3, input: '{"variantOption":{"name":"Size","value":"Twin"}}'},
        ]),
        group([
          {
            count: 4,
            input:
              '{"productMetafield":{"namespace":"custom","key":"comfort_level","value":"Plush"}}',
          },
        ]),
        group([{count: 9, input: '{"tag":"something-we-do-not-model"}'}]),
      ],
      emptyFilterState(),
    );
    expect(groups.map((g) => g.dimension)).toEqual(['size', 'comfortLevel']);
    expect(groups[0].options).toEqual([
      {value: 'Twin', count: 3, selected: false},
      {value: 'Queen', count: 7, selected: false},
    ]);
  });

  it('keeps a selected value visible even when Shopify reports no count for it', () => {
    const state = parseFilterParams(new URLSearchParams('comfort=firm'));
    const groups = buildFilterGroups([], state);
    expect(groups).toEqual([
      {
        dimension: 'comfortLevel',
        label: 'Comfort level',
        options: [{value: 'Firm', count: 0, selected: true}],
      },
    ]);
  });
});

describe('URLs for filter changes (state lives in the URL)', () => {
  const base = parseFilterParams(
    new URLSearchParams('size=queen&sort=price-asc'),
  );

  it('toggles a value on and off and resets pagination', () => {
    const withCursor = parseFilterParams(
      new URLSearchParams('size=queen&cursor=abc123'),
    );
    expect(
      hrefForToggle('/collections/x', withCursor, 'comfortLevel', 'Plush'),
    ).toBe('/collections/x?size=queen&comfort=plush');
    expect(hrefForToggle('/collections/x', base, 'size', 'Queen')).toBe(
      '/collections/x?sort=price-asc',
    );
  });

  it('keeps unrelated parameters such as the search term', () => {
    const state = parseFilterParams(new URLSearchParams('q=linen'));
    expect(
      hrefForToggle(
        '/search',
        state,
        'size',
        'King',
        new URLSearchParams('q=linen'),
      ),
    ).toBe('/search?q=linen&size=king');
  });

  it('changes the sort, keeping filters', () => {
    expect(hrefForSort('/collections/x', base, 'newest')).toBe(
      '/collections/x?size=queen&sort=newest',
    );
    expect(hrefForSort('/collections/x', base, 'featured')).toBe(
      '/collections/x?size=queen',
    );
  });

  it('sets and clears a price range in whole dollars', () => {
    expect(hrefForPrice('/c', emptyFilterState(), '500', '1500')).toBe(
      '/c?price_min=500&price_max=1500',
    );
    expect(hrefForPrice('/c', emptyFilterState(), '', '')).toBe('/c');
    expect(hrefForPrice('/c', emptyFilterState(), 'abc', '$2000')).toBe(
      '/c?price_max=2000',
    );
  });

  it('resets filters but keeps the sort', () => {
    expect(hrefForReset('/c', base)).toBe('/c?sort=price-asc');
  });

  it('builds the next-page state with the cursor and nothing else changed', () => {
    const next = nextPageState(base, 'eyJhIjoxfQ==');
    expect(next.cursor).toBe('eyJhIjoxfQ==');
    expect(next.selected.size).toEqual(['Queen']);
    expect(nextPageState(base, '<script>').cursor).toBeNull();
  });
});

describe('price field helpers', () => {
  it('turns typed dollars into cents and rejects the rest', () => {
    expect(dollarsInputToCents('1200')).toBe(120000);
    expect(dollarsInputToCents(' $50 ')).toBe(5000);
    for (const bad of ['', '0', '-5', '1e3', '12.5', 'abc', '1234567']) {
      expect(dollarsInputToCents(bad)).toBeNull();
    }
    expect(centsToDollarsInput(120000)).toBe('1200');
    expect(centsToDollarsInput(null)).toBe('');
  });
});

describe('appendUnique (Load more)', () => {
  it('appends new products and skips repeats', () => {
    const merged = appendUnique([{id: 'a'}, {id: 'b'}], [{id: 'b'}, {id: 'c'}]);
    expect(merged.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });
});
