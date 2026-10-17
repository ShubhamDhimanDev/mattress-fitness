// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type {ComponentType} from 'react';
import {createMemoryRouter, RouterProvider} from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Aside} from '~/components/Aside';
import {HeaderSearch} from '~/components/layout/HeaderSearch';
import {
  createLazyPanel,
  RETRY_AFTER_FAILURE_MS,
  type LazyPanel,
} from '~/components/layout/LazyPanel';
import type {SuggestionGroupsProps} from '~/components/layout/SuggestionGroups';
import {SUGGESTIONS_UNAVAILABLE_ANNOUNCEMENT} from '~/components/layout/searchCombobox';
import {getEmptyPredictiveSearchResult} from '~/lib/search';

// The suggestions chunk is made to fail: the real module is replaced by a panel whose download the test controls.
// HeaderSearch keeps one reference to the panel, so the mock hands out a delegate and each test installs a fresh
// real panel behind it (a loaded panel stays loaded for good, which would leak from one test to the next).
const chunk = vi.hoisted(() => ({
  current: null as LazyPanel<SuggestionGroupsProps> | null,
}));

vi.mock('~/components/layout/lazyPanels', async () => {
  const {createElement} = await import('react');
  const now = () => {
    if (!chunk.current) throw new Error('test did not install a panel');
    return chunk.current;
  };
  return {
    suggestionsPanel: {
      Panel: (props: SuggestionGroupsProps) =>
        createElement(now().Panel, props),
      preload: () => now().preload(),
      subscribe: (listener: () => void) => now().subscribe(listener),
      getStatus: () => now().getStatus(),
    },
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

const swallow = (event: ErrorEvent) => event.preventDefault();

/** What the next download of the suggestions chunk does; a test changes it between attempts. */
let behaviour: 'fail' | 'work' | 'hold';
let downloads: number;
let settleHeld: (outcome: 'fail' | 'work') => void;
/** Predictive-search requests the field has sent (the route below answers them with no results). */
let searches: number;

/** When true the downloaded panel throws while rendering (the chunk is fine, the component is not). */
let panelThrows: boolean;

/** The real suggestions component, which throws on demand. */
async function realGroups(): Promise<ComponentType<SuggestionGroupsProps>> {
  const {SuggestionGroups} =
    await import('~/components/layout/SuggestionGroups');
  return function MaybeThrowing(props: SuggestionGroupsProps) {
    if (panelThrows) throw new Error('render error');
    return <SuggestionGroups {...props} />;
  };
}

function installPanel() {
  downloads = 0;
  chunk.current = createLazyPanel<SuggestionGroupsProps>(() => {
    downloads += 1;
    if (behaviour === 'fail') return Promise.reject(new Error('chunk 404'));
    if (behaviour === 'work') return realGroups();
    return new Promise((resolve, reject) => {
      settleHeld = (outcome) => {
        if (outcome === 'fail') reject(new Error('chunk 404'));
        else void realGroups().then(resolve);
      };
    });
  });
}

beforeEach(() => {
  behaviour = 'fail';
  panelThrows = false;
  installPanel();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  // React reports the render error to the window as well; jsdom would print it.
  window.addEventListener('error', swallow);
});

afterEach(() => {
  cleanup();
  window.removeEventListener('error', swallow);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// REQ-SRCH-001 / QA-P7-L2: when the suggestions chunk cannot be downloaded the combobox keeps its contract: the
// closing "view all results" option is still in the listbox (plain data), Enter still searches, and the status
// region says so once.

function renderSearch() {
  searches = 0;
  // One object for every answer: the field resets its highlight when the result set changes, and a test about the
  // other reasons to reset it must not be rescued by a fresh object each time.
  const answer = {
    type: 'predictive' as const,
    term: 'bed',
    result: getEmptyPredictiveSearchResult(),
  };
  const router = createMemoryRouter(
    [
      {path: '/', element: <HeaderSearch />},
      {
        path: '/search',
        loader: () => {
          searches += 1;
          return answer;
        },
        element: <p>results page</p>,
      },
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

/**
 * Waits until the field's first predictive-search request has been answered and its result applied. A new result set
 * resets the highlight by itself, so a test about the other reasons to reset it must let that happen first.
 */
async function settleSearchRequest() {
  await waitFor(() => expect(searches).toBeGreaterThan(0));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

const searchField = () =>
  screen.getByRole('combobox', {name: 'Search products and pages'});

const UNAVAILABLE_VISIBLE = 'Suggestions are unavailable.';

describe('<HeaderSearch> with the suggestions chunk unavailable (QA-P7-L2)', () => {
  it('keeps the "view all results" option in the listbox and announces that suggestions are unavailable', async () => {
    renderSearch();
    const field = searchField();
    fireEvent.focus(field);
    fireEvent.change(field, {target: {value: 'bed'}});

    // The status is the last thing to settle, so wait for it instead of reading it at once; the option element is
    // looked up after that because the failure message replaces the one shown while the download was running.
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        SUGGESTIONS_UNAVAILABLE_ANNOUNCEMENT,
      ),
    );
    const listbox = screen.getByRole('listbox', {name: 'Search suggestions'});
    const option = screen.getByRole('option', {name: /View all results for/});
    expect(listbox).toContainElement(option);
    expect(option).toHaveAttribute('href', '/search?q=bed');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(SUGGESTIONS_UNAVAILABLE_ANNOUNCEMENT).toBe(
      'Suggestions are unavailable. Press Enter to search.',
    );
    // The listbox is not left empty and nothing claims there are no suggestions for the term.
    expect(screen.queryByText(/No suggestions for/)).not.toBeInTheDocument();
  });

  it('lets the arrow keys reach the option, and Enter on it opens the results page', async () => {
    const router = renderSearch();
    const field = searchField();
    fireEvent.change(field, {target: {value: 'bed'}});
    await screen.findByText(UNAVAILABLE_VISIBLE);
    const option = screen.getByRole('option', {name: /View all results for/});
    fireEvent.keyDown(field, {key: 'ArrowDown'});
    expect(field).toHaveAttribute('aria-activedescendant', option.id);
    expect(option).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(field, {key: 'Enter'});
    await screen.findByText('results page');
    expect(router.state.location.pathname).toBe('/search');
    expect(router.state.location.search).toBe('?q=bed');
  });

  // QA-P7-L2 follow-up: the flag used to be set from an effect one commit after the failure message rendered, so a
  // screen reader could hear "No suggestions" (or "N suggestions available") and then "Suggestions are unavailable".
  // Every text the live region has ever held is recorded from the first commit on.
  it('never puts any text in the live region before the "unavailable" text (the interim text is never committed)', async () => {
    behaviour = 'hold';
    renderSearch();
    const status = screen.getByRole('status');
    const committed: string[] = [];
    const record = (records: MutationRecord[]) => {
      for (const entry of records) {
        if (entry.type === 'characterData') {
          committed.push(entry.oldValue ?? '', entry.target.textContent ?? '');
        } else {
          for (const node of [...entry.addedNodes, ...entry.removedNodes]) {
            committed.push(node.textContent ?? '');
          }
        }
      }
    };
    const observer = new MutationObserver(record);
    observer.observe(status, {
      childList: true,
      characterData: true,
      characterDataOldValue: true,
      subtree: true,
    });
    try {
      const field = searchField();
      fireEvent.focus(field);
      fireEvent.change(field, {target: {value: 'bed'}});
      // The search request has answered (no results) while the chunk is still on its way: the panel says "No
      // suggestions for" on screen, but the live region stays silent, because the options are not shown yet.
      await waitFor(() => expect(searches).toBe(1));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      await screen.findByText(/No suggestions for/);
      expect(status).toHaveTextContent('');
      expect(downloads).toBe(1);

      await act(async () => {
        settleHeld('fail');
      });
      await waitFor(() =>
        expect(status).toHaveTextContent(SUGGESTIONS_UNAVAILABLE_ANNOUNCEMENT),
      );
      record(observer.takeRecords());
    } finally {
      observer.disconnect();
    }
    const spoken = committed.filter((text) => text.trim() !== '');
    expect(spoken.length).toBeGreaterThan(0);
    expect(new Set(spoken)).toEqual(
      new Set([SUGGESTIONS_UNAVAILABLE_ANNOUNCEMENT]),
    );
  });

  it('keeps the "view all" option on screen, not an empty list, while a later attempt is downloading', async () => {
    vi.useFakeTimers({toFake: ['Date']});
    renderSearch();
    const field = searchField();
    fireEvent.change(field, {target: {value: 'bed'}});
    await screen.findByText(UNAVAILABLE_VISIBLE);

    // Close and reopen the listbox after the retry delay: a new attempt starts and is held.
    behaviour = 'hold';
    vi.setSystemTime(Date.now() + RETRY_AFTER_FAILURE_MS);
    fireEvent.keyDown(field, {key: 'Escape'});
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.keyDown(field, {key: 'ArrowDown'});
    await waitFor(() => expect(downloads).toBe(2));
    expect(
      screen.getByRole('option', {name: /View all results for/}),
    ).toBeInTheDocument();
    expect(screen.getByText(UNAVAILABLE_VISIBLE)).toBeInTheDocument();
    await act(async () => {
      settleHeld('fail');
    });
    expect(
      screen.getByRole('option', {name: /View all results for/}),
    ).toBeInTheDocument();
  });
});

// Reopening the listbox asks for the chunk again, at most once per retry delay. The "unavailable" mark must not
// outlive the failure message that set it.
describe('<HeaderSearch> reopening the listbox after a failure', () => {
  it('asks again after the retry delay, and with the network back shows the suggestions without the unavailable text', async () => {
    vi.useFakeTimers({toFake: ['Date']});
    renderSearch();
    const field = searchField();
    fireEvent.change(field, {target: {value: 'bed'}});
    await screen.findByText(UNAVAILABLE_VISIBLE);
    expect(downloads).toBe(1);

    behaviour = 'work';
    vi.setSystemTime(Date.now() + RETRY_AFTER_FAILURE_MS);
    fireEvent.keyDown(field, {key: 'Escape'});
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.keyDown(field, {key: 'ArrowDown'});

    await waitFor(() =>
      expect(screen.queryByText(UNAVAILABLE_VISIBLE)).not.toBeInTheDocument(),
    );
    expect(downloads).toBe(2);
    await waitFor(() =>
      expect(screen.getByRole('status')).not.toHaveTextContent(/unavailable/i),
    );
    expect(
      screen.getByRole('option', {name: /View all results for/}),
    ).toBeInTheDocument();
  });

  it('does not ask again when it is reopened within the retry delay', async () => {
    renderSearch();
    const field = searchField();
    fireEvent.change(field, {target: {value: 'bed'}});
    await screen.findByText(UNAVAILABLE_VISIBLE);

    behaviour = 'work';
    fireEvent.keyDown(field, {key: 'Escape'});
    fireEvent.keyDown(field, {key: 'ArrowDown'});
    expect(await screen.findByText(UNAVAILABLE_VISIBLE)).toBeInTheDocument();
    expect(downloads).toBe(1);
    expect(screen.getByRole('status')).toHaveTextContent(
      SUGGESTIONS_UNAVAILABLE_ANNOUNCEMENT,
    );
  });

  it('fails again with the same message when the network is still down', async () => {
    vi.useFakeTimers({toFake: ['Date']});
    renderSearch();
    const field = searchField();
    fireEvent.change(field, {target: {value: 'bed'}});
    await screen.findByText(UNAVAILABLE_VISIBLE);

    vi.setSystemTime(Date.now() + RETRY_AFTER_FAILURE_MS);
    fireEvent.keyDown(field, {key: 'Escape'});
    fireEvent.keyDown(field, {key: 'ArrowDown'});
    await waitFor(() => expect(downloads).toBe(2));
    expect(await screen.findByText(UNAVAILABLE_VISIBLE)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      SUGGESTIONS_UNAVAILABLE_ANNOUNCEMENT,
    );
  });
});

// The chunk can arrive and the panel still throw while rendering. Then the boundary's message reports "unavailable"
// (the combobox cannot know otherwise) and withdraws the report when it goes away, which is the next time the listbox
// opens: the shopper is not left with a stale "unavailable" after the cause is gone.
describe('<HeaderSearch> when the suggestions panel throws while rendering', () => {
  it('offers only "view all" and says so, and the next opening starts clean', async () => {
    behaviour = 'work';
    panelThrows = true;
    renderSearch();
    const field = searchField();
    fireEvent.change(field, {target: {value: 'bed'}});
    await screen.findByText(UNAVAILABLE_VISIBLE);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        SUGGESTIONS_UNAVAILABLE_ANNOUNCEMENT,
      ),
    );
    expect(screen.getAllByRole('option')).toHaveLength(1);

    panelThrows = false;
    fireEvent.keyDown(field, {key: 'Escape'});
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.keyDown(field, {key: 'ArrowDown'});
    await waitFor(() =>
      expect(screen.queryByText(UNAVAILABLE_VISIBLE)).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByRole('status')).not.toHaveTextContent(/unavailable/i),
    );
    expect(
      screen.getByRole('option', {name: /View all results for/}),
    ).toBeInTheDocument();
  });
});

// The highlight is an index into the option list. When the list changes under it (the chunk comes back after a
// failure and the options are rebuilt) the index must go back to "none", so aria-activedescendant always names an
// option the shopper has actually moved to.
describe('<HeaderSearch> highlight when the options change', () => {
  it('clears aria-activedescendant when the suggestions come back after a failure', async () => {
    vi.useFakeTimers({toFake: ['Date']});
    renderSearch();
    const field = searchField();
    fireEvent.change(field, {target: {value: 'bed'}});
    await screen.findByText(UNAVAILABLE_VISIBLE);
    await settleSearchRequest();
    const option = screen.getByRole('option', {name: /View all results for/});
    fireEvent.keyDown(field, {key: 'ArrowDown'});
    expect(field).toHaveAttribute('aria-activedescendant', option.id);

    // Focusing the field again, after the retry delay, preloads: this time the download works.
    behaviour = 'work';
    vi.setSystemTime(Date.now() + RETRY_AFTER_FAILURE_MS);
    fireEvent.focus(field);
    await waitFor(() =>
      expect(screen.queryByText(UNAVAILABLE_VISIBLE)).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(field).not.toHaveAttribute('aria-activedescendant'),
    );
    expect(
      screen.getByRole('option', {name: /View all results for/}),
    ).toHaveAttribute('aria-selected', 'false');
  });
});

// QA-P7-L3: while the chunk is down the field must not send a download per keystroke, and the failure message must
// give way once a later download works.
describe('<HeaderSearch> typing while the suggestions chunk is down (QA-P7-L3)', () => {
  it('makes one request for a burst of keystrokes, and one more after the retry delay; the options then replace the message', async () => {
    vi.useFakeTimers({toFake: ['Date']});
    renderSearch();
    const field = searchField();
    fireEvent.focus(field);
    fireEvent.change(field, {target: {value: 'b'}});
    fireEvent.change(field, {target: {value: 'be'}});
    await screen.findByText(UNAVAILABLE_VISIBLE);
    expect(downloads).toBe(1);

    for (const text of ['bed', 'bed ', 'bed m', 'bed ma', 'bed mat']) {
      fireEvent.change(field, {target: {value: text}});
    }
    expect(downloads).toBe(1);
    // Still failing, still offering "view all".
    expect(screen.getByText(UNAVAILABLE_VISIBLE)).toBeInTheDocument();

    behaviour = 'work';
    vi.setSystemTime(Date.now() + RETRY_AFTER_FAILURE_MS);
    fireEvent.change(field, {target: {value: 'bed matt'}});
    await waitFor(() =>
      expect(screen.queryByText(UNAVAILABLE_VISIBLE)).not.toBeInTheDocument(),
    );
    expect(downloads).toBe(2);
    await waitFor(() =>
      expect(screen.getByRole('status')).not.toHaveTextContent(/unavailable/i),
    );
    // More typing after the success downloads nothing.
    fireEvent.change(field, {target: {value: 'bed mattress'}});
    expect(downloads).toBe(2);
  });
});
