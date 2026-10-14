// @vitest-environment jsdom
import {cleanup, render, screen} from '@testing-library/react';
import {createMemoryRouter, RouterProvider} from 'react-router';
import {afterEach, describe, expect, it} from 'vitest';
import {SearchResults} from '~/components/collection/SearchResults';
import {shouldShowListing} from '~/lib/shopify/search-view';

afterEach(cleanup);

// REQ-SRCH-002: a filtered search with no matches keeps the filter controls so the shopper can undo them.

function renderAt(url: string, activeFilters: number) {
  const router = createMemoryRouter(
    [
      {
        path: '/search',
        element: (
          <SearchResults
            term="linen"
            products={[]}
            pageInfo={{hasNextPage: false, endCursor: null}}
            filterGroups={[
              {
                dimension: 'size',
                label: 'Size',
                options: [{value: 'Queen', count: 0, selected: true}],
              },
            ]}
            activeFilters={activeFilters}
            pages={[]}
            articles={[]}
            suggestedCollections={[]}
          />
        ),
      },
    ],
    {initialEntries: [url]},
  );
  return render(<RouterProvider router={router} />);
}

describe('shouldShowListing', () => {
  it.each([
    [3, 0, true],
    [0, 2, true],
    [2, 2, true],
    [0, 0, false],
  ])('%i products, %i filters -> %s', (products, filters, expected) => {
    expect(shouldShowListing(products, filters)).toBe(expected);
  });
});

describe('<SearchResults> with no products (REQ-SRCH-002)', () => {
  it('keeps the sidebar, chips and Reset when a filter is active', () => {
    renderAt('/search?q=linen&size=queen', 1);
    expect(
      screen.getByRole('heading', {name: 'No products match these filters'}),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', {name: 'Reset filters'}),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('complementary', {name: 'Filters'}),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', {name: /Remove filter Size: Queen/}),
    ).toBeInTheDocument();
  });

  it('shows the plain "no products found" state with no filter active', () => {
    renderAt('/search?q=linen', 0);
    expect(
      screen.getByRole('heading', {name: /No products found for/}),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', {name: 'Reset filters'})).toBeNull();
    expect(screen.queryByRole('complementary', {name: 'Filters'})).toBeNull();
  });
});
