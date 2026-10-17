// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {createMemoryRouter, RouterProvider} from 'react-router';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Aside} from '~/components/Aside';
import {HeaderSearch} from '~/components/layout/HeaderSearch';
import {SUGGESTIONS_UNAVAILABLE_ANNOUNCEMENT} from '~/components/layout/searchCombobox';

// The suggestions chunk is made to fail: the real module is replaced by a panel whose download always rejects.
vi.mock('~/components/layout/lazyPanels', async () => {
  const {createLazyPanel} = await import('~/components/layout/LazyPanel');
  return {
    suggestionsPanel: createLazyPanel(() =>
      Promise.reject(new Error('chunk 404')),
    ),
  };
});

// jsdom has no ResizeObserver; the panel uses one to see whether it scrolls.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    disconnect() {}
    unobserve() {}
  },
);

Element.prototype.scrollIntoView = () => undefined;

afterEach(() => {
  cleanup();
  window.removeEventListener('error', swallow);
});

// REQ-SRCH-001 / QA-P7-L2: when the suggestions chunk cannot be downloaded the combobox keeps its contract: the
// closing "view all results" option is still in the listbox (plain data), Enter still searches, and the status
// region says so once.

const swallow = (event: ErrorEvent) => event.preventDefault();

function renderSearch() {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  // React reports the render error to the window as well; jsdom would print it.
  window.addEventListener('error', swallow);
  const router = createMemoryRouter(
    [
      {path: '/', element: <HeaderSearch />},
      {path: '/search', element: <p>results page</p>},
    ],
    {initialEntries: ['/']},
  );
  render(
    <Aside.Provider>
      <RouterProvider router={router} />
    </Aside.Provider>,
  );
  return router;
}

describe('<HeaderSearch> with the suggestions chunk unavailable (QA-P7-L2)', () => {
  it('keeps the "view all results" option in the listbox and announces that suggestions are unavailable', async () => {
    renderSearch();
    const field = screen.getByRole('combobox', {
      name: 'Search products and pages',
    });
    fireEvent.focus(field);
    fireEvent.change(field, {target: {value: 'bed'}});

    const listbox = await screen.findByRole('listbox', {
      name: 'Search suggestions',
    });
    const option = await screen.findByRole('option', {
      name: /View all results for/,
    });
    expect(listbox).toContainElement(option);
    expect(option).toHaveAttribute('href', '/search?q=bed');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent(
      SUGGESTIONS_UNAVAILABLE_ANNOUNCEMENT,
    );
    expect(SUGGESTIONS_UNAVAILABLE_ANNOUNCEMENT).toBe(
      'Suggestions are unavailable. Press Enter to search.',
    );
    // The listbox is not left empty and nothing claims there are no suggestions for the term.
    expect(screen.queryByText(/No suggestions for/)).not.toBeInTheDocument();
  });

  it('lets the arrow keys reach the option, and Enter on it opens the results page', async () => {
    const router = renderSearch();
    const field = screen.getByRole('combobox', {
      name: 'Search products and pages',
    });
    fireEvent.change(field, {target: {value: 'bed'}});
    const option = await screen.findByRole('option', {
      name: /View all results for/,
    });
    fireEvent.keyDown(field, {key: 'ArrowDown'});
    expect(field).toHaveAttribute('aria-activedescendant', option.id);
    expect(option).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(field, {key: 'Enter'});
    await screen.findByText('results page');
    expect(router.state.location.pathname).toBe('/search');
    expect(router.state.location.search).toBe('?q=bed');
  });
});
