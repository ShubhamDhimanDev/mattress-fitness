import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {useFetcher, useLocation, useNavigate} from 'react-router';
import {SearchIcon} from '~/components/ui/Icons';
import {LazyBoundary, usePanelStatus} from '~/components/layout/LazyPanel';
import {suggestionsPanel} from '~/components/layout/lazyPanels';
import {SearchFormPredictive} from '~/components/SearchFormPredictive';
import {SuggestionsUnavailable} from '~/components/layout/SuggestionsUnavailable';
import {
  buildSuggestionGroups,
  flattenOptions,
  moveActive,
  optionDomId,
  suggestionAnnouncement,
  suggestionCount,
  type SuggestionOption,
} from '~/components/layout/searchCombobox';
import {getEmptyPredictiveSearchResult} from '~/lib/search';
import type {PredictiveSearchReturn} from '~/lib/search';
import {MIN_PREDICTIVE_TERM_LENGTH} from '~/lib/shopify/config';

const SuggestionGroupsPanel = suggestionsPanel.Panel;

/**
 * The header search field with predictive suggestions (REQ-SRCH-001), built as the WAI-ARIA combobox with a
 * listbox popup: focus stays in the text field, `aria-activedescendant` names the highlighted option, and
 * the arrow keys, Enter and Escape drive it. One instance serves every breakpoint; the header grid decides
 * where it sits. Submitting without a highlighted option goes to the search results page.
 *
 * Suggestions are an enhancement: below two characters or after any API failure the panel only offers the
 * plain "view all results" option, so the field never blocks a search (REQ-SRCH-001, NFR-013).
 */
export function HeaderSearch() {
  const inputId = useId();
  const listboxId = useId();
  const statusId = useId();
  const optionPrefix = useId();
  const [value, setValue] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const location = useLocation();
  const navigate = useNavigate();
  // Same key as the form's own fetcher inside SearchFormPredictive, so both see one request and one result.
  const fetcher = useFetcher<PredictiveSearchReturn>({key: 'search'});
  const panelRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [panelScrolls, setPanelScrolls] = useState(false);
  // The suggestions chunk's download status. It is read from the panel itself, in the same render that draws the
  // listbox, so the live text never says "N suggestions" or "No suggestions" for a moment before it says that
  // suggestions are unavailable (QA-P7-L2). Failed means: the listbox offers only "view all".
  const chunk = usePanelStatus(suggestionsPanel);
  // The other way to end up with only "view all": the chunk arrived but the panel threw while rendering. Only the
  // boundary knows that, so its failure message reports it (and withdraws the report when it goes away).
  const [renderFailed, setRenderFailed] = useState(false);
  const unavailable = chunk === 'failed' || renderFailed;

  const term = value.trim();
  const ready = term.length >= MIN_PREDICTIVE_TERM_LENGTH;
  const visible = expanded && ready;
  const loading = fetcher.state !== 'idle';

  const groups = useMemo(() => {
    const items = (fetcher.data ?? {result: getEmptyPredictiveSearchResult()})
      .result.items;
    // Results for a shorter, older term would mislead; below the floor only the "view all" option shows.
    // Without the chunk the real options cannot be drawn, so none is offered: the keyboard must never land on an option
    // that is not on screen.
    return buildSuggestionGroups(
      ready && !unavailable ? items : getEmptyPredictiveSearchResult().items,
      term,
    );
  }, [fetcher.data, ready, term, unavailable]);
  const options = useMemo(() => flattenOptions(groups), [groups]);
  const count = suggestionCount(groups);
  const activeOption = options[activeIndex] ?? null;

  // Navigating anywhere (a suggestion, a menu link) closes the suggestions.
  useEffect(() => {
    setExpanded(false);
    setActiveIndex(-1);
  }, [location.pathname, location.search]);

  // Opening the listbox asks for the chunk too (a no-op once it is loaded, and at most one request per retry delay
  // after a failure), so reopening it is how a shopper whose first download failed gets suggestions back.
  useEffect(() => {
    if (visible) void suggestionsPanel.preload();
  }, [visible]);

  // A new result set, or the options changing to or from the "view all" fallback, starts again from the text field,
  // not from a position in the old list (aria-activedescendant must name an option that is on screen).
  useEffect(() => {
    setActiveIndex(-1);
  }, [fetcher.data, unavailable]);

  // A tap or click on anything outside the field closes the suggestions. Blur alone is not enough: pressing a
  // non-focusable area (page background, a heading) gives the blur event no related target, so the panel
  // would stay open over the page. Pointer events cover mouse, touch and pen; the listener exists only while
  // the panel is open.
  useEffect(() => {
    if (!expanded) return;
    function onPointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        rootRef.current?.contains(event.target)
      ) {
        return;
      }
      setExpanded(false);
      setActiveIndex(-1);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [expanded]);

  // Even capped at eight rows, the panel can outgrow a short window and scroll. A scroll area with nothing tabbable in
  // it cannot be scrolled from the keyboard (WCAG 2.1.1, axe scrollable-region-focusable), so only then it becomes a
  // tab stop, where the arrow keys scroll it (A11Y-003). The arrow keys in the field already scroll the active option
  // into view; this is the second route.
  useEffect(() => {
    const panel = panelRef.current;
    if (!visible || !panel) {
      setPanelScrolls(false);
      return;
    }
    const measure = () =>
      setPanelScrolls(panel.scrollHeight > panel.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    // The options arrive in a lazy chunk and change the list's height without changing the capped panel's.
    const list = panel.querySelector('[role="listbox"]');
    if (list) observer.observe(list);
    return () => observer.disconnect();
  }, [visible, groups]);

  // Keep the highlighted option in view inside the scrolling panel.
  useEffect(() => {
    if (!activeOption) return;
    panelRef.current
      ?.querySelector(`[id="${optionDomId(optionPrefix, activeOption.index)}"]`)
      ?.scrollIntoView({block: 'nearest'});
  }, [activeOption, optionPrefix]);

  function choose(option: SuggestionOption) {
    setExpanded(false);
    setActiveIndex(-1);
    // A product or page choice ends the search; "view all" and a suggested query keep the text visible.
    if (option.kind !== 'all' && option.kind !== 'query') setValue('');
    else if (option.kind === 'query') setValue(option.label);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // A const, so the narrowing by the switch also holds inside the state updaters below.
    const key = event.key;
    switch (key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        if (!ready) return;
        event.preventDefault();
        if (!expanded) {
          setExpanded(true);
          return;
        }
        setActiveIndex((current) => moveActive(current, options.length, key));
        return;
      }
      case 'Home':
      case 'End': {
        // Only while an option is highlighted; otherwise the keys move the caret in the text as usual.
        if (!visible || activeOption === null) return;
        event.preventDefault();
        setActiveIndex((current) => moveActive(current, options.length, key));
        return;
      }
      case 'Enter': {
        if (visible && activeOption) {
          // Without this the form would submit as well and go to the results page instead.
          event.preventDefault();
          choose(activeOption);
          void navigate(activeOption.href);
        }
        return;
      }
      case 'Escape': {
        if (visible) {
          event.preventDefault();
          setExpanded(false);
          setActiveIndex(-1);
        }
        return;
      }
      default:
    }
  }

  return (
    <div
      ref={rootRef}
      className="lg:relative"
      onBlur={(event) => {
        // Only a move of focus to somewhere outside this field closes the panel (not a click on padding).
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          setExpanded(false);
          setActiveIndex(-1);
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
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={visible}
              aria-controls={visible ? listboxId : undefined}
              aria-activedescendant={
                visible && activeOption
                  ? optionDomId(optionPrefix, activeOption.index)
                  : undefined
              }
              aria-describedby={statusId}
              autoComplete="off"
              enterKeyHint="search"
              maxLength={100}
              placeholder="Search"
              value={value}
              onChange={(event) => {
                void suggestionsPanel.preload();
                setValue(event.target.value);
                setActiveIndex(-1);
                fetchResults(event);
                setExpanded(true);
              }}
              onFocus={(event) => {
                void suggestionsPanel.preload();
                fetchResults(event);
                setExpanded(true);
              }}
              onKeyDown={onKeyDown}
              className="min-h-touch min-w-0 flex-1 rounded-l-choice border-2 border-r-0 border-line-strong bg-surface pl-4 text-base text-fg"
            />
            <button
              type="submit"
              onClick={goToSearch}
              aria-label="Search"
              className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-r-choice border-2 border-primary-500 bg-primary-500 text-white hover:border-primary-600 hover:bg-primary-600"
            >
              <SearchIcon />
            </button>
          </>
        )}
      </SearchFormPredictive>

      {/* Always in the DOM: a live region that appears together with its text is often not announced. */}
      <p id={statusId} role="status" aria-live="polite" className="sr-only">
        {visible
          ? suggestionAnnouncement({
              count,
              // Options that are not on screen yet are not announced; the text follows once the chunk has arrived.
              loading: loading || chunk === 'pending',
              unavailable,
            })
          : ''}
      </p>

      {visible ? (
        // The lint rule cannot see the role through the spread; the panel is presentation or a labelled scroll group.
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        <div
          ref={panelRef}
          {...(panelScrolls
            ? {
                role: 'group',
                'aria-label': 'Scrollable suggestions',
                tabIndex: 0,
              }
            : {role: 'presentation'})}
          className="absolute inset-x-0 top-full z-40 mt-1 max-h-[70dvh] overflow-y-auto rounded-card border border-line bg-surface p-4 shadow-lg"
          // Keep focus in the text field when the panel is pressed (a click would otherwise blur it first).
          onMouseDown={(event) => event.preventDefault()}
        >
          {unavailable ? (
            <p aria-hidden="true" className="mb-2 text-base text-fg-muted">
              Suggestions are unavailable.
            </p>
          ) : null}
          {!unavailable && loading && count === 0 ? (
            <p aria-hidden="true" className="mb-2 text-base text-fg-muted">
              Searching…
            </p>
          ) : null}
          {!unavailable && !loading && count === 0 ? (
            <p aria-hidden="true" className="mb-2 text-base text-fg">
              No suggestions for <q>{term}</q>
            </p>
          ) : null}
          <div
            id={listboxId}
            role="listbox"
            aria-label="Search suggestions"
            className="flex flex-col gap-4"
          >
            {/* The options arrive as a lazy chunk; the field's focus handler has already started the download. While the
                download is failed the boundary is not mounted at all: the "view all" option is drawn directly, in the same
                commit that the status changes, and stays while a later attempt downloads. When that attempt succeeds the
                boundary mounts again with the chunk in hand. */}
            {chunk === 'failed' ? (
              <SuggestionsUnavailable
                groups={groups}
                activeIndex={activeIndex}
                optionPrefix={optionPrefix}
                onChoose={choose}
              />
            ) : (
              <LazyBoundary
                loading={null}
                failed={
                  <SuggestionsUnavailable
                    groups={groups}
                    activeIndex={activeIndex}
                    optionPrefix={optionPrefix}
                    onChoose={choose}
                    onUnavailableChange={setRenderFailed}
                  />
                }
              >
                <SuggestionGroupsPanel
                  groups={groups}
                  activeIndex={activeIndex}
                  optionPrefix={optionPrefix}
                  onChoose={choose}
                />
              </LazyBoundary>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
