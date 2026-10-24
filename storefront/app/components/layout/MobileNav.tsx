import {Link} from 'react-router';
import {NavAnchor} from '~/components/layout/NavAnchor';
import {Accordion, type AccordionItem} from '~/components/ui/Accordion';
import {ChatIcon, PhoneIcon} from '~/components/ui/Icons';
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
                  'text-xs font-extrabold text-fg',
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
    <div className="flex flex-col gap-6">
      <nav aria-label="Mobile">
        <Accordion
          items={accordionItems}
          type="single"
          headingLevel={3}
          variant="menu"
        />
      </nav>
      <nav aria-label="Help and contact">
        <ul>
          {utilityLinks.map((link) => (
            <li key={link.id}>
              <Link to={link.to} onClick={onNavigate} className={LINK_CLASSES}>
                {link.id === 'chat' ? <ChatIcon className="size-5" /> : null}
                {link.label}
              </Link>
            </li>
          ))}
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
