import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import {NavLink, useLocation} from 'react-router';
import {NavAnchor} from '~/components/layout/NavAnchor';
import {cn} from '~/components/ui/cn';
import {ChevronDownIcon} from '~/components/ui/Icons';
import {displayHeadingClass, fitsDisplayType} from '~/lib/display-type';
import type {MainNavItem, NavMenuItem} from '~/lib/navigation';

type MainNavProps = {
  items: readonly MainNavItem[];
};

// Heavy uppercase display type echoes the logo's blocky wordmark (BA-04). The height is set per item below: a
// 56 px row for the plain items, 44 px for the pill, so the pill does not grow into a tall slab.
// Labels come from the navigation data and can be long, so each is judged on its length (lib/display-type.ts).
const topClasses = (label: string) =>
  cn(
    'inline-flex items-center gap-1 px-1.5 text-sm max-xl:tracking-normal whitespace-nowrap text-fg hover:text-primary-700 xl:px-3',
    displayHeadingClass(label),
  );

/**
 * Desktop navigation using the WAI-ARIA disclosure pattern: a top-level item with sub-links is a button
 * (aria-expanded, aria-controls); the others are plain links.
 *  - Enter or Space on a button opens or closes its panel (native button behaviour).
 *  - Arrow Right/Left, Home and End move between top-level items; Arrow Down opens a panel and focuses
 *    its first link; Arrow Up/Down, Home and End move inside a panel.
 *  - Escape closes the open panel and returns focus to its button. Tabbing out or clicking away closes it.
 *  - A mouse opens a panel on hover; the panel is a child of the item, so moving onto it keeps it open.
 */
export function MainNav({items}: MainNavProps) {
  const navRef = useRef<HTMLElement>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const focusFirstLinkOnOpen = useRef(false);
  const lastPointerType = useRef('mouse');
  const location = useLocation();

  // A page change (including the same item clicked in the panel) always closes the panel.
  useEffect(() => {
    setOpenId(null);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!openId) return;
    function onPointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !navRef.current?.contains(event.target)
      ) {
        setOpenId(null);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [openId]);

  useEffect(() => {
    if (!openId || !focusFirstLinkOnOpen.current) return;
    focusFirstLinkOnOpen.current = false;
    panelLinks(openId)[0]?.focus();
  }, [openId]);

  function topLevelControls(): HTMLElement[] {
    return Array.from(
      navRef.current?.querySelectorAll<HTMLElement>('[data-nav-top]') ?? [],
    );
  }

  function panelLinks(id: string): HTMLElement[] {
    const panel = Array.from(
      navRef.current?.querySelectorAll<HTMLElement>('[data-nav-panel]') ?? [],
    ).find((element) => element.dataset.navPanel === id);
    return Array.from(panel?.querySelectorAll<HTMLElement>('a[href]') ?? []);
  }

  function onTopKeyDown(event: KeyboardEvent<HTMLElement>, item: MainNavItem) {
    const controls = topLevelControls();
    const index = controls.indexOf(event.currentTarget);
    let target: HTMLElement | undefined;

    switch (event.key) {
      case 'ArrowRight':
        target = controls[(index + 1) % controls.length];
        break;
      case 'ArrowLeft':
        target = controls[(index - 1 + controls.length) % controls.length];
        break;
      case 'Home':
        target = controls[0];
        break;
      case 'End':
        target = controls[controls.length - 1];
        break;
      case 'ArrowDown':
        if (item.kind === 'menu') {
          event.preventDefault();
          if (openId === item.id) {
            panelLinks(item.id)[0]?.focus();
          } else {
            // The panel is not rendered visible yet; the effect above focuses its first link once it is.
            focusFirstLinkOnOpen.current = true;
            setOpenId(item.id);
          }
        }
        return;
      case 'Escape':
        if (openId) setOpenId(null);
        return;
      default:
        return;
    }
    event.preventDefault();
    target?.focus();
  }

  function onPanelKeyDown(
    event: KeyboardEvent<HTMLElement>,
    item: NavMenuItem,
  ) {
    const links = panelLinks(item.id);
    const index = links.indexOf(event.currentTarget);
    let target: HTMLElement | undefined;

    switch (event.key) {
      case 'ArrowDown':
        target = links[(index + 1) % links.length];
        break;
      case 'ArrowUp':
        target = links[(index - 1 + links.length) % links.length];
        break;
      case 'Home':
        target = links[0];
        break;
      case 'End':
        target = links[links.length - 1];
        break;
      case 'ArrowRight':
      case 'ArrowLeft': {
        const controls = topLevelControls();
        const own = controls.findIndex(
          (control) => control.dataset.navTop === item.id,
        );
        const step = event.key === 'ArrowRight' ? 1 : -1;
        setOpenId(null);
        target = controls[(own + step + controls.length) % controls.length];
        break;
      }
      case 'Escape': {
        const trigger = topLevelControls().find(
          (control) => control.dataset.navTop === item.id,
        );
        setOpenId(null);
        event.preventDefault();
        trigger?.focus();
        return;
      }
      default:
        return;
    }
    event.preventDefault();
    target?.focus();
  }

  function onItemBlur(event: FocusEvent<HTMLLIElement>, item: MainNavItem) {
    // relatedTarget is null when the window loses focus or a non-focusable area is clicked: keep it open.
    if (
      event.relatedTarget instanceof Node &&
      !event.currentTarget.contains(event.relatedTarget)
    ) {
      setOpenId((current) => (current === item.id ? null : current));
    }
  }

  function onTriggerClick(event: MouseEvent<HTMLButtonElement>, id: string) {
    const fromKeyboard = event.detail === 0;
    // A mouse already opened the panel by hovering; clicking should not immediately close it again.
    if (!fromKeyboard && lastPointerType.current === 'mouse' && openId === id) {
      return;
    }
    setOpenId((current) => (current === id ? null : id));
  }

  return (
    <nav ref={navRef} aria-label="Main">
      <ul className="mx-auto flex max-w-page items-center justify-center px-2 xl:px-6">
        {items.map((item) => {
          if (item.kind === 'link') {
            const linkClasses = cn(
              topClasses(item.label),
              'aria-[current=page]:underline aria-[current=page]:underline-offset-4',
              // On the amber pill the text stays ink: red text on amber is 4.27 : 1, below 4.5.
              item.emphasis
                ? 'min-h-touch rounded-pill bg-accent-400 px-3 text-ink-900 hover:bg-accent-300 hover:text-ink-900 xl:px-5'
                : 'min-h-14 aria-[current=page]:text-primary-700',
            );
            return (
              <li key={item.id} className={item.emphasis ? 'ml-2' : undefined}>
                {item.external ? (
                  <NavAnchor
                    to={item.to}
                    external
                    data-nav-top={item.id}
                    onKeyDown={(event) => onTopKeyDown(event, item)}
                    className={linkClasses}
                  >
                    {item.label}
                  </NavAnchor>
                ) : (
                  <NavLink
                    to={item.to}
                    data-nav-top={item.id}
                    onKeyDown={(event) => onTopKeyDown(event, item)}
                    className={linkClasses}
                  >
                    {item.label}
                  </NavLink>
                )}
              </li>
            );
          }

          const open = openId === item.id;
          const panelId = `main-nav-panel-${item.id}`;
          return (
            <li
              key={item.id}
              onPointerEnter={(event) => {
                if (event.pointerType === 'mouse') setOpenId(item.id);
              }}
              onPointerLeave={(event) => {
                if (event.pointerType === 'mouse') {
                  setOpenId((current) =>
                    current === item.id ? null : current,
                  );
                }
              }}
              onBlur={(event) => onItemBlur(event, item)}
            >
              <button
                type="button"
                data-nav-top={item.id}
                aria-expanded={open}
                aria-controls={panelId}
                onPointerDown={(event) => {
                  lastPointerType.current = event.pointerType;
                }}
                onClick={(event) => onTriggerClick(event, item.id)}
                onKeyDown={(event) => onTopKeyDown(event, item)}
                className={cn(
                  topClasses(item.label),
                  'group min-h-14 aria-expanded:bg-primary-50 aria-expanded:text-primary-700',
                )}
              >
                {item.label}
                <ChevronDownIcon className="size-4 motion-safe:transition-transform group-aria-expanded:rotate-180" />
              </button>
              <div
                id={panelId}
                data-nav-panel={item.id}
                hidden={!open}
                className="absolute inset-x-0 top-full z-40 border-t-4 border-primary-500 bg-surface shadow-md"
              >
                <div className="mx-auto grid max-w-page grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-x-8 gap-y-6 px-6 py-6">
                  {item.groups.map((group) => {
                    const headingId = `${panelId}-${group.id}`;
                    return (
                      <div key={group.id}>
                        {group.heading === null ? null : (
                          <p
                            id={headingId}
                            className={cn(
                              'mb-1 text-xs font-extrabold text-fg',
                              fitsDisplayType(group.heading) &&
                                'tracking-wide uppercase',
                            )}
                          >
                            {group.headingTo ? (
                              <NavAnchor
                                to={group.headingTo}
                                external={group.headingExternal}
                                onKeyDown={(event) =>
                                  onPanelKeyDown(event, item)
                                }
                                className="inline-flex min-h-touch items-center hover:text-primary-700 hover:underline"
                              >
                                {group.heading}
                              </NavAnchor>
                            ) : (
                              group.heading
                            )}
                          </p>
                        )}
                        <ul
                          aria-labelledby={
                            group.heading === null ? undefined : headingId
                          }
                          aria-label={
                            group.heading === null ? item.label : undefined
                          }
                        >
                          {group.links.map((link) => (
                            <li key={link.to}>
                              <NavAnchor
                                to={link.to}
                                external={link.external}
                                onKeyDown={(event) =>
                                  onPanelKeyDown(event, item)
                                }
                                className="inline-flex min-h-touch items-center text-base text-fg hover:text-primary-700 hover:underline"
                              >
                                {link.label}
                              </NavAnchor>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                  {item.to ? (
                    <div className="col-span-full border-t border-line pt-3">
                      <NavAnchor
                        to={item.to}
                        external={item.external}
                        onKeyDown={(event) => onPanelKeyDown(event, item)}
                        className="inline-flex min-h-touch items-center text-base font-bold text-primary-700 hover:underline"
                      >
                        View all {item.label.toLowerCase()}
                      </NavAnchor>
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
