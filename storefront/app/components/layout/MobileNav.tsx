import {Suspense, lazy, type ComponentType} from 'react';
import {Link} from 'react-router';
import {NavAnchor} from '~/components/layout/NavAnchor';
import {Accordion, type AccordionItem} from '~/components/ui/Accordion';
import type {ChatEntryProps} from '~/components/chat/chat-types';
import {PhoneIcon} from '~/components/ui/Icons';
import {cn} from '~/components/ui/cn';
import {fitsDisplayType} from '~/lib/display-type';
import {
  UTILITY_LINKS,
  type MainNavItem,
  type NavMenuItem,
  type SupportPhone,
  type UtilityLink,
} from '~/lib/navigation';

export type MobileNavProps = {
  items: readonly MainNavItem[];
  /** Called when any link is followed, so the drawer can close. */
  onNavigate: () => void;
  /** The client's number; without one no phone link is rendered. */
  supportPhone?: SupportPhone | null;
  /** The help links to show; the root loader leaves out those whose page does not exist (P6-09). */
  utilityLinks?: readonly UtilityLink[];
};

// The chat entry's lazy chunk, requested only when the links hold a chat entry (a provider is configured, P7-03); a failed
// download hides the call-out only. Declared here, not taken from lazyPanels (which imports this panel), so this panel adds no shared chunk.
const ChatEntry = lazy((): Promise<{default: ComponentType<ChatEntryProps>}> =>
  import('~/components/chat/ChatEntry').then(
    (module) => ({default: module.ChatEntry}),
    () => ({default: () => null}),
  ),
);

const LINK_CLASSES =
  'inline-flex min-h-touch items-center gap-2 text-base text-fg hover:text-primary-700 hover:underline';

function MenuSection({
  item,
  onNavigate,
}: {
  item: NavMenuItem;
  onNavigate: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {item.groups.map((group) => {
        const headingId = `mobile-nav-${item.id}-${group.id}`;
        return (
          <div key={group.id}>
            {group.heading === null ? null : (
              <p
                id={headingId}
                className={cn(
                  'text-caption font-extrabold text-primary-700',
                  fitsDisplayType(group.heading) && 'tracking-wide uppercase',
                )}
              >
                {group.headingTo ? (
                  <NavAnchor
                    to={group.headingTo}
                    external={group.headingExternal}
                    onClick={onNavigate}
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
              aria-labelledby={group.heading === null ? undefined : headingId}
              aria-label={group.heading === null ? item.label : undefined}
            >
              {group.links.map((link) => (
                <li key={link.to}>
                  <NavAnchor
                    to={link.to}
                    external={link.external}
                    onClick={onNavigate}
                    className={LINK_CLASSES}
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
        <NavAnchor
          to={item.to}
          external={item.external}
          onClick={onNavigate}
          className="inline-flex min-h-touch items-center text-base font-bold text-primary-700 hover:underline"
        >
          View all {item.label.toLowerCase()}
        </NavAnchor>
      ) : null}
    </div>
  );
}

/** Mobile navigation inside the menu drawer: an accordion of the same items the desktop menu has. */
export function MobileNav({
  items,
  onNavigate,
  supportPhone = null,
  utilityLinks = UTILITY_LINKS,
}: MobileNavProps) {
  const accordionItems: AccordionItem[] = items.map((item) =>
    item.kind === 'link'
      ? {
          id: item.id,
          title: item.label,
          to: item.to,
          external: item.external,
          onNavigate,
        }
      : {
          id: item.id,
          title: item.label,
          content: <MenuSection item={item} onNavigate={onNavigate} />,
        },
  );

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Mobile">
        <Accordion
          items={accordionItems}
          type="single"
          headingLevel={3}
          variant="menu"
        />
      </nav>
      {/* The help links sit on a paper card, like the trust strip: quiet, but 44 px targets. */}
      <nav
        aria-label="Help and contact"
        className="rounded-card bg-paper px-4 py-2"
      >
        <ul>
          {utilityLinks.map((link) =>
            link.id === 'chat' ? (
              // The drawer closes, then the widget opens (P7-03).
              <Suspense key={link.id} fallback={null}>
                <ChatEntry
                  className={LINK_CLASSES}
                  links={utilityLinks}
                  onActivate={onNavigate}
                />
              </Suspense>
            ) : (
              <li key={link.id}>
                <Link
                  to={link.to}
                  onClick={onNavigate}
                  className={LINK_CLASSES}
                >
                  {link.label}
                </Link>
              </li>
            ),
          )}
          {supportPhone ? (
            <li>
              <a href={supportPhone.href} className={LINK_CLASSES}>
                <PhoneIcon className="size-5" />
                <span className="sr-only">Call us: </span>
                {supportPhone.display}
              </a>
            </li>
          ) : null}
        </ul>
      </nav>
    </div>
  );
}
