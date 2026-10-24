// @vitest-environment jsdom
import {cleanup, render, screen} from '@testing-library/react';
import {createMemoryRouter, RouterProvider} from 'react-router';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {ProductListing} from '~/components/collection/ProductListing';
import {SEARCH_SORT_KEYS} from '~/lib/filters';

// REQ-ANL-001, NFR-013: the listing reports through a chunk fetched with import(). If that fetch fails (offline, a
// deploy replaced the file) the listing still renders and nothing throws.

vi.mock('~/lib/listing-events', () => {
  throw new Error('chunk failed to load');
});

afterEach(cleanup);

describe('a listing whose analytics chunk cannot be loaded', () => {
  it('still renders its products and raises no unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const router = createMemoryRouter(
      [
        {
          path: '/search',
          element: (
            <ProductListing
              products={[]}
              pageInfo={{hasNextPage: false, endCursor: null}}
              filterGroups={[]}
              showFilters={false}
              sortKeys={SEARCH_SORT_KEYS}
              emptyHeading="Nothing here"
            />
          ),
        },
      ],
      {initialEntries: ['/search?q=x']},
    );
    render(<RouterProvider router={router} />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 20));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
