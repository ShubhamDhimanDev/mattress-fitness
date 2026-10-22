import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {cn} from '~/components/ui/cn';

export type TabItem = {id: string; label: string; content: ReactNode};

type TabsProps = {
  tabs: readonly TabItem[];
  /** Accessible name of the tab list. */
  label: string;
  defaultTabId?: string;
  className?: string;
};

/**
 * WAI-ARIA tabs with automatic activation: Arrow Left/Right (and Home, End) move focus and select the tab.
 * Only the selected tab is in the tab order; Tab then moves into its panel. All panels stay in the DOM
 * (hidden) so content is present in the server HTML.
 */
export function Tabs({tabs, label, defaultTabId, className}: TabsProps) {
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [selectedId, setSelectedId] = useState(
    defaultTabId ?? tabs[0]?.id ?? '',
  );

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft')
      next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    const target = tabs[next];
    if (!target) return;

    event.preventDefault();
    setSelectedId(target.id);
    tabRefs.current[next]?.focus();
  }

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={label}
        className="flex overflow-x-auto border-b border-line"
      >
        {tabs.map((tab, index) => {
          const selected = tab.id === selectedId;
          return (
            <button
              key={tab.id}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setSelectedId(tab.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                // The tab list scrolls, so it clips an outside ring; the ring is drawn inside the tab instead (BV-003).
                'min-h-touch shrink-0 -outline-offset-3 border-b-4 px-4 text-base font-bold whitespace-nowrap',
                selected
                  ? 'border-primary-700 text-primary-700'
                  : 'border-transparent text-fg-muted hover:text-fg',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${baseId}-panel-${tab.id}`}
          aria-labelledby={`${baseId}-tab-${tab.id}`}
          hidden={tab.id !== selectedId}
          tabIndex={0}
          className="py-4"
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
