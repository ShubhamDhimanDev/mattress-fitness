import {
  useFetcher,
  useNavigate,
  type FormProps,
  type Fetcher,
} from 'react-router';
import React, {useRef, useEffect} from 'react';
import type {PredictiveSearchReturn} from '~/lib/search';
import {MIN_PREDICTIVE_TERM_LENGTH} from '~/lib/shopify/config';
import {useAside} from './Aside';

type SearchFormPredictiveChildren = (args: {
  fetchResults: (event: React.ChangeEvent<HTMLInputElement>) => void;
  goToSearch: () => void;
  inputRef: React.MutableRefObject<HTMLInputElement | null>;
  fetcher: Fetcher<PredictiveSearchReturn>;
}) => React.ReactNode;

type SearchFormPredictiveProps = Omit<FormProps, 'children'> & {
  children: SearchFormPredictiveChildren | null;
};

export const SEARCH_ENDPOINT = '/search';
const PREDICTIVE_DEBOUNCE_MS = 250;

/**
 *  Search form component that sends search requests to the `/search` route
 **/
export function SearchFormPredictive({
  children,
  className = 'predictive-search-form',
  ...props
}: SearchFormPredictiveProps) {
  const fetcher = useFetcher<PredictiveSearchReturn>({key: 'search'});
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();
  const aside = useAside();

  /** Reset the input value and blur the input */
  function resetInput(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (inputRef?.current?.value) {
      inputRef.current.blur();
    }
  }

  /** Navigate to the search page with the current input value */
  function goToSearch() {
    const term = inputRef?.current?.value;
    // URLSearchParams encodes the term; a raw `?q=${term}` would let "&" or "#" in the text change the URL.
    const query = term ? `?${new URLSearchParams({q: term}).toString()}` : '';
    void navigate(SEARCH_ENDPOINT + query);
    aside.close();
  }

  /**
   * Fetch suggestions as the shopper types (REQ-SRCH-001): nothing is sent below two characters, and a
   * burst of keystrokes becomes one request after a short pause.
   */
  function fetchResults(event: React.ChangeEvent<HTMLInputElement>) {
    const term = event.target.value.trim();
    if (pending.current) clearTimeout(pending.current);
    if (term.length < MIN_PREDICTIVE_TERM_LENGTH) return;
    pending.current = setTimeout(() => {
      void fetcher.submit(
        {q: term, limit: 5, predictive: true},
        {method: 'GET', action: SEARCH_ENDPOINT},
      );
    }, PREDICTIVE_DEBOUNCE_MS);
  }

  // ensure the passed input has a type of search, because SearchResults
  // will select the element based on the input
  useEffect(() => {
    inputRef?.current?.setAttribute('type', 'search');
  }, []);

  if (typeof children !== 'function') {
    return null;
  }

  return (
    <fetcher.Form {...props} className={className} onSubmit={resetInput}>
      {children({inputRef, fetcher, fetchResults, goToSearch})}
    </fetcher.Form>
  );
}
