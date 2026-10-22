import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {Link} from 'react-router';
import {cn} from '~/components/ui/cn';
import {ChevronDownIcon, ChevronRightIcon} from '~/components/ui/Icons';

export type AccordionPanelItem = {
  id: string;
  title: ReactNode;
  content: ReactNode;
  disabled?: boolean;
};

/** A row that looks like a section header but navigates (a plain link in a mobile menu). */
export type AccordionLinkItem = {
  id: string;
  title: ReactNode;
  to: string;
  onNavigate?: () => void;
};

export type AccordionItem = AccordionPanelItem | AccordionLinkItem;

type HeadingLevel = 2 | 3 | 4 | 5 | 6;

type AccordionProps = {
  items: readonly AccordionItem[];
  /** `single` keeps one section open (opening another closes it); `multiple` lets any number be open. */
  type?: 'single' | 'multiple';
  defaultOpenIds?: readonly string[];
  /** Level of the heading around each trigger; pick the one that fits the page outline. */
  headingLevel?: HeadingLevel;
  /**
   * `default` is a content row (heavy sentence case, 44 px). `menu` is a navigation row in the mobile menu:
   * 56 px, heavy uppercase display type like the desktop navigation items.
   */
  variant?: 'default' | 'menu';
  className?: string;
};

const ROW_BASE =
  'flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-fg hover:bg-surface-muted';
const ROW_VARIANT = {
  default: 'min-h-touch text-base font-extrabold',
  menu: 'min-h-14 type-display text-base',
} as const;

function isLinkItem(item: AccordionItem): item is AccordionLinkItem {
  return 'to' in item;
}

/**
 * WAI-ARIA accordion: each trigger is a button inside a heading with aria-expanded and aria-controls.
 * Enter and Space toggle (native button behaviour); Arrow Up/Down, Home and End move between triggers.
 * Closed panels use the `hidden` attribute, so their content stays in the server HTML for crawlers.
 */
export function Accordion({
  items,
  type = 'single',
  defaultOpenIds = [],
  headingLevel = 3,
  variant = 'default',
  className,
}: AccordionProps) {
  const rowClasses = cn(ROW_BASE, ROW_VARIANT[variant]);
  const baseId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [openIds, setOpenIds] = useState<readonly string[]>(defaultOpenIds);
  const Heading = `h${headingLevel}` as const;
  const useRegions = items.length <= 6; // more than six region landmarks is noise (APG)

  function toggle(id: string) {
    setOpenIds((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      return type === 'single' ? [id] : [...current, id];
    });
  }

  // Attached to each trigger and link row (not the wrapper), so it only runs for focusable controls.
  function onRowKeyDown(event: KeyboardEvent<HTMLElement>) {
    const rows = Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>('[data-accordion-row]') ??
        [],
    ).filter((row) => !row.hasAttribute('disabled'));
    const current = rows.indexOf(event.currentTarget);
    if (current === -1) return;

    let next: number | null = null;
    if (event.key === 'ArrowDown') next = (current + 1) % rows.length;
    else if (event.key === 'ArrowUp')
      next = (current - 1 + rows.length) % rows.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = rows.length - 1;
    if (next === null) return;

    event.preventDefault();
    rows[next]?.focus();
  }

  return (
    <div
      ref={rootRef}
      className={cn('divide-y divide-line border-y border-line', className)}
    >
      {items.map((item) => {
        if (isLinkItem(item)) {
          return (
            <div key={item.id}>
              <Link
                to={item.to}
                data-accordion-row=""
                onClick={item.onNavigate}
                onKeyDown={onRowKeyDown}
                className={rowClasses}
              >
                <span>{item.title}</span>
                <ChevronRightIcon className="size-5 text-fg-muted" />
              </Link>
            </div>
          );
        }

        const open = openIds.includes(item.id);
        const triggerId = `${baseId}-trigger-${item.id}`;
        const panelId = `${baseId}-panel-${item.id}`;
        return (
          <div key={item.id}>
            <Heading>
              <button
                type="button"
                id={triggerId}
                data-accordion-row=""
                aria-expanded={open}
                aria-controls={panelId}
                disabled={item.disabled}
                onClick={() => toggle(item.id)}
                onKeyDown={onRowKeyDown}
                className={cn(
                  rowClasses,
                  'group disabled:cursor-not-allowed disabled:text-fg-muted',
                )}
              >
                <span>{item.title}</span>
                <ChevronDownIcon className="size-5 text-fg-muted motion-safe:transition-transform group-aria-expanded:rotate-180" />
              </button>
            </Heading>
            <div
              id={panelId}
              role={useRegions ? 'region' : undefined}
              aria-labelledby={useRegions ? triggerId : undefined}
              hidden={!open}
              className="px-4 pt-1 pb-4"
            >
              {item.content}
            </div>
          </div>
        );
      })}
    </div>
  );
}
