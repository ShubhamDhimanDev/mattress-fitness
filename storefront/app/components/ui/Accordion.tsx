import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {Link} from 'react-router';
import {cn} from '~/components/ui/cn';
import {ChevronDownIcon, ChevronRightIcon} from '~/components/ui/Icons';
import {displayHeadingClass} from '~/lib/display-type';

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
  /** An https URL on another site: rendered as a plain anchor. */
  external?: boolean;
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
  /**
   * Collapsed panels get `hidden="until-found"`, so the browser's find-in-page (Ctrl+F) can match their text and
   * opens the section (the `beforematch` event). Without it a collapsed panel is plain `display: none`. Off by
   * default: a navigation menu has no use for it.
   */
  findInPage?: boolean;
  className?: string;
};

const ROW_BASE =
  'flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-fg hover:bg-surface-muted';
const ROW_VARIANT = {
  default: 'min-h-touch text-base font-extrabold',
  menu: 'min-h-14 text-base',
} as const;

// `useLayoutEffect` warns when a component renders on the server, and it runs after the DOM update, which avoids a
// one-frame flash between `display: none` and the find-in-page state; on the server a plain no-op effect is used.
const useBrowserLayoutEffect =
  typeof document === 'undefined' ? useEffect : useLayoutEffect;

type PanelProps = {
  id: string;
  role?: 'region';
  labelledBy?: string;
  open: boolean;
  findInPage: boolean;
  onFound: () => void;
  children: ReactNode;
};

/**
 * One collapsed-or-open panel. React 18 renders the `hidden` prop as the boolean attribute (`hidden=""`, which is
 * `display: none`: no find-in-page, and no `beforematch`), and it cannot write `hidden="until-found"`, so with
 * `findInPage` the attribute is upgraded by hand after every render. The server HTML keeps the plain `hidden`, so
 * nothing is visible before scripts run. Opened by the browser, the `beforematch` event opens the item in state too,
 * so `aria-expanded` and the chevron stay in step with what is shown.
 */
function AccordionPanel({
  id,
  role,
  labelledBy,
  open,
  findInPage,
  onFound,
  children,
}: PanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const onFoundRef = useRef(onFound);
  onFoundRef.current = onFound;

  useBrowserLayoutEffect(() => {
    const panel = ref.current;
    if (!panel || !findInPage) return;
    if (open) panel.removeAttribute('hidden');
    else panel.setAttribute('hidden', 'until-found');
  }, [open, findInPage]);

  useEffect(() => {
    const panel = ref.current;
    if (!panel || !findInPage) return;
    const found = () => onFoundRef.current();
    panel.addEventListener('beforematch', found);
    return () => panel.removeEventListener('beforematch', found);
  }, [findInPage]);

  return (
    <div
      ref={ref}
      id={id}
      role={role}
      aria-labelledby={labelledBy}
      hidden={!open}
      // A panel that is hidden but findable still has a box; without this its padding would show as a blank gap.
      className="px-4 pt-1 pb-4 [&[hidden]]:py-0"
    >
      {children}
    </div>
  );
}

function isLinkItem(item: AccordionItem): item is AccordionLinkItem {
  return 'to' in item;
}

/**
 * WAI-ARIA accordion: each trigger is a button inside a heading with aria-expanded and aria-controls.
 * Enter and Space toggle (native button behaviour); Arrow Up/Down, Home and End move between triggers.
 * Closed panels use the `hidden` attribute, so their content stays in the server HTML for crawlers; with
 * `findInPage` they use `hidden="until-found"` once scripts run, so Ctrl+F finds and opens them.
 */
export function Accordion({
  items,
  type = 'single',
  defaultOpenIds = [],
  headingLevel = 3,
  variant = 'default',
  findInPage = false,
  className,
}: AccordionProps) {
  // Menu rows are heavy uppercase display type while the label is short; a long label from the navigation data keeps
  // the weight but goes back to sentence case (lib/display-type.ts). A title that is not plain text is left as is.
  const rowClassesFor = (title: ReactNode) =>
    cn(
      ROW_BASE,
      ROW_VARIANT[variant],
      variant === 'menu' &&
        (typeof title === 'string'
          ? displayHeadingClass(title)
          : 'type-display'),
    );
  const baseId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [openIds, setOpenIds] = useState<readonly string[]>(defaultOpenIds);
  const Heading = `h${headingLevel}` as const;
  const useRegions = items.length <= 6; // more than six region landmarks is noise (APG)

  function reveal(id: string) {
    setOpenIds((current) => {
      if (current.includes(id)) return current;
      return type === 'single' ? [id] : [...current, id];
    });
  }

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
              {item.external ? (
                <a
                  href={item.to}
                  rel="noopener noreferrer"
                  data-accordion-row=""
                  onClick={item.onNavigate}
                  onKeyDown={onRowKeyDown}
                  className={rowClassesFor(item.title)}
                >
                  <span>{item.title}</span>
                  <ChevronRightIcon className="size-5 text-fg-muted" />
                </a>
              ) : (
                <Link
                  to={item.to}
                  data-accordion-row=""
                  onClick={item.onNavigate}
                  onKeyDown={onRowKeyDown}
                  className={rowClassesFor(item.title)}
                >
                  <span>{item.title}</span>
                  <ChevronRightIcon className="size-5 text-fg-muted" />
                </Link>
              )}
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
                  rowClassesFor(item.title),
                  'group disabled:cursor-not-allowed disabled:text-fg-muted',
                )}
              >
                <span>{item.title}</span>
                <ChevronDownIcon className="size-5 text-fg-muted motion-safe:transition-transform group-aria-expanded:rotate-180" />
              </button>
            </Heading>
            <AccordionPanel
              id={panelId}
              role={useRegions ? 'region' : undefined}
              labelledBy={useRegions ? triggerId : undefined}
              open={open}
              findInPage={findInPage}
              onFound={() => reveal(item.id)}
            >
              {item.content}
            </AccordionPanel>
          </div>
        );
      })}
    </div>
  );
}
