import {Link} from 'react-router';
import {Accordion, type AccordionItem} from '~/components/ui/Accordion';
import {ChatIcon, PhoneIcon} from '~/components/ui/Icons';
import {
  UTILITY_LINKS,
  type MainNavItem,
  type NavMenuItem,
  type SupportPhone,
} from '~/lib/navigation';

export type MobileNavProps = {
  items: readonly MainNavItem[];
  /** Called when any link is followed, so the drawer can close. */
  onNavigate: () => void;
  /** The client's number; without one no phone link is rendered. */
  supportPhone?: SupportPhone | null;
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
            <p
              id={headingId}
              className="text-xs font-bold tracking-wide text-fg-muted uppercase"
            >
              {group.heading}
            </p>
            <ul aria-labelledby={headingId}>
              {group.links.map((link) => (
                <li key={link.to}>
                  <Link
                    to={link.to}
                    onClick={onNavigate}
                    className={LINK_CLASSES}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <Link
        to={item.to}
        onClick={onNavigate}
        className="inline-flex min-h-touch items-center text-base font-bold text-primary-700 hover:underline"
      >
        View all {item.label.toLowerCase()}
      </Link>
    </div>
  );
}

/** Mobile navigation inside the menu drawer: an accordion of the same items the desktop menu has. */
export function MobileNav({
  items,
  onNavigate,
  supportPhone = null,
}: MobileNavProps) {
  const accordionItems: AccordionItem[] = items.map((item) =>
    item.kind === 'link'
      ? {id: item.id, title: item.label, to: item.to, onNavigate}
      : {
          id: item.id,
          title: item.label,
          content: <MenuSection item={item} onNavigate={onNavigate} />,
        },
  );

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Mobile">
        <Accordion items={accordionItems} type="single" headingLevel={3} />
      </nav>
      <nav aria-label="Help and contact">
        <ul>
          {UTILITY_LINKS.map((link) => (
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
