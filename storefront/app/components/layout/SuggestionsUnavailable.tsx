import {useLayoutEffect} from 'react';
import {Link} from 'react-router';
import {
  optionDomId,
  type SuggestionGroup,
  type SuggestionOption,
} from '~/components/layout/searchCombobox';

export const SUGGESTION_OPTION_CLASSES =
  'flex min-h-touch items-center gap-3 rounded-choice p-1 text-base text-fg hover:bg-surface-muted aria-selected:bg-surface-muted aria-selected:outline-2 aria-selected:outline-offset-[-2px] aria-selected:outline-primary-700';

type SuggestionsUnavailableProps = {
  groups: readonly SuggestionGroup[];
  activeIndex: number;
  optionPrefix: string;
  onChoose: (option: SuggestionOption) => void;
  /**
   * Set when this message stands in for a panel that threw while rendering: told true when it appears and false when
   * it goes. Left out when the message is shown because the chunk's status is "failed", which the combobox reads itself.
   */
  onUnavailableChange?: (unavailable: boolean) => void;
};

/**
 * What the search listbox shows when the suggestions chunk could not be downloaded (QA-P7-L2): only the closing
 * "View all results" option, which is plain data and needs no chunk, so Enter, the arrow keys and a click still
 * reach the results page. A static module on purpose: it must exist when the lazy one does not. When the chunk failed,
 * the combobox knows from the panel's status (`usePanelStatus`) in the very render that draws this, so there is no
 * interim state. The next time the listbox opens, the suggestions are requested again.
 */
export function SuggestionsUnavailable({
  groups,
  activeIndex,
  optionPrefix,
  onChoose,
  onUnavailableChange,
}: SuggestionsUnavailableProps) {
  // A layout effect, so the combobox's live text is corrected before the browser can show or announce the interim one.
  useLayoutEffect(() => {
    onUnavailableChange?.(true);
    return () => onUnavailableChange?.(false);
  }, [onUnavailableChange]);

  const viewAll = groups
    .flatMap((group) => group.options)
    .filter((option) => option.kind === 'all');
  return (
    <>
      {viewAll.map((option) => (
        <div key={option.index} role="group" aria-label="More results">
          <Link
            id={optionDomId(optionPrefix, option.index)}
            role="option"
            aria-selected={option.index === activeIndex}
            tabIndex={-1}
            to={option.href}
            onClick={() => onChoose(option)}
            className={`${SUGGESTION_OPTION_CLASSES} font-bold text-primary-700`}
          >
            <span className="min-w-0">
              <span className="block truncate">{option.label}</span>
            </span>
          </Link>
        </div>
      ))}
    </>
  );
}
