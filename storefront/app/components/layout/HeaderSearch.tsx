import {useEffect, useId, useState} from 'react';
import {Link, useLocation} from 'react-router';
import {SearchIcon} from '~/components/ui/Icons';
import {
  SEARCH_ENDPOINT,
  SearchFormPredictive,
} from '~/components/SearchFormPredictive';
import {SearchResultsPredictive} from '~/components/SearchResultsPredictive';

/**
 * The header search field with predictive suggestions below it (REQ-NAV-001). One instance serves every
 * breakpoint; the header grid decides where it sits. Submitting goes to the search results page.
 */
export function HeaderSearch() {
  const inputId = useId();
  const panelId = useId();
  const queriesDatalistId = useId();
  const [expanded, setExpanded] = useState(false);
  const location = useLocation();

  // Navigating anywhere (a suggestion, a menu link) closes the suggestions.
  useEffect(() => {
    setExpanded(false);
  }, [location.pathname, location.search]);

  return (
    <div
      className="lg:relative"
      onBlur={(event) => {
        // Only a move of focus to somewhere outside this field closes the panel (not a click on padding).
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          setExpanded(false);
        }
      }}
    >
      <SearchFormPredictive
        role="search"
        aria-label="Site search"
        className="flex w-full items-stretch"
      >
        {({fetchResults, goToSearch, inputRef}) => (
          <>
            <label htmlFor={inputId} className="sr-only">
              Search products and pages
            </label>
            <input
              id={inputId}
              ref={inputRef}
              name="q"
              type="search"
              autoComplete="off"
              placeholder="Search"
              list={queriesDatalistId}
              onChange={(event) => {
                fetchResults(event);
                setExpanded(true);
              }}
              onFocus={(event) => {
                fetchResults(event);
                setExpanded(true);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setExpanded(false);
              }}
              className="min-h-touch min-w-0 flex-1 rounded-l-pill border-2 border-r-0 border-line-strong bg-surface pl-4 text-base text-fg"
            />
            <button
              type="submit"
              onClick={goToSearch}
              aria-label="Search"
              className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-r-pill border-2 border-primary-700 bg-primary-700 text-white hover:border-primary-800 hover:bg-primary-800"
            >
              <SearchIcon />
            </button>
          </>
        )}
      </SearchFormPredictive>

      {expanded ? (
        <SearchResultsPredictive>
          {({items, total, term, state, closeSearch}) => {
            if (!term.current) return null;
            const {articles, collections, pages, products, queries} = items;

            return (
              <div
                id={panelId}
                className="absolute inset-x-0 top-full z-40 mt-1 flex max-h-[70dvh] flex-col gap-4 overflow-y-auto rounded-card border border-line bg-surface p-4 shadow-lg"
              >
                <p role="status" className="sr-only">
                  {state === 'loading' ? 'Searching' : `${total} suggestions`}
                </p>
                {state === 'loading' && !total ? (
                  <p className="text-base text-fg-muted">Searching…</p>
                ) : !total ? (
                  <SearchResultsPredictive.Empty term={term} />
                ) : (
                  <>
                    <SearchResultsPredictive.Queries
                      queries={queries}
                      queriesDatalistId={queriesDatalistId}
                    />
                    <SearchResultsPredictive.Products
                      products={products}
                      closeSearch={closeSearch}
                      term={term}
                    />
                    <SearchResultsPredictive.Collections
                      collections={collections}
                      closeSearch={closeSearch}
                      term={term}
                    />
                    <SearchResultsPredictive.Pages
                      pages={pages}
                      closeSearch={closeSearch}
                      term={term}
                    />
                    <SearchResultsPredictive.Articles
                      articles={articles}
                      closeSearch={closeSearch}
                      term={term}
                    />
                    <Link
                      onClick={closeSearch}
                      to={`${SEARCH_ENDPOINT}?${new URLSearchParams({q: term.current}).toString()}`}
                      className="inline-flex min-h-touch items-center font-bold text-primary-700 hover:underline"
                    >
                      View all results for “{term.current}”
                    </Link>
                  </>
                )}
              </div>
            );
          }}
        </SearchResultsPredictive>
      ) : null}
    </div>
  );
}
