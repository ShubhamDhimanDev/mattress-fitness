import {useId, useState} from 'react';
import {Link} from 'react-router';
import {cn} from '~/components/ui/cn';
import {ChevronDownIcon, PhoneIcon} from '~/components/ui/Icons';
import {
  FOOTER_LEGAL_LINKS,
  FOOTER_SHOP_GROUPS,
  FOOTER_SUPPORT_GROUPS,
  SITE_NAME,
  type FooterGroup,
  type SupportPhone,
} from '~/lib/navigation';

const LINK_CLASSES =
  'inline-flex min-h-touch items-center text-sm text-ink-300 hover:text-white hover:underline';

/**
 * Footer link groups. Below 768 px each group is a collapsible section (a button inside a heading); from
 * 768 px every group is open and its heading is plain text. The links are always in the HTML, so crawlers
 * and assistive technology see them whether or not a section is collapsed.
 */
function FooterGroups({
  groups,
  className,
}: {
  groups: readonly FooterGroup[];
  className: string;
}) {
  const baseId = useId();
  const [openIds, setOpenIds] = useState<readonly string[]>([]);

  function toggle(id: string) {
    setOpenIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  }

  return (
    <div className={className}>
      {groups.map((group) => {
        const open = openIds.includes(group.id);
        const listId = `${baseId}-${group.id}`;
        return (
          <div key={group.id} className="border-b border-ink-700 md:border-b-0">
            <h2 className="hidden pb-2 text-sm font-bold tracking-wide text-white uppercase md:block">
              {group.heading}
            </h2>
            <h2 className="md:hidden">
              <button
                type="button"
                aria-expanded={open}
                aria-controls={listId}
                onClick={() => toggle(group.id)}
                className="group flex min-h-touch w-full items-center justify-between text-left text-sm font-bold tracking-wide text-white uppercase"
              >
                {group.heading}
                <ChevronDownIcon className="size-5 motion-safe:transition-transform group-aria-expanded:rotate-180" />
              </button>
            </h2>
            <ul
              id={listId}
              className={cn('pb-2 md:pb-0', !open && 'max-md:hidden')}
            >
              {group.links.map((link) => (
                <li key={link.to}>
                  <Link to={link.to} className={LINK_CLASSES}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export function SiteFooter({
  supportPhone = null,
}: {
  /** The client's number; without one no phone link is rendered. */
  supportPhone?: SupportPhone | null;
}) {
  return (
    <footer className="on-dark mt-auto bg-surface-inverse text-fg-inverse">
      <nav
        aria-label="Footer"
        className="mx-auto flex max-w-page flex-col gap-8 px-4 py-8 md:px-6 md:py-12"
      >
        <FooterGroups
          groups={FOOTER_SUPPORT_GROUPS}
          className="grid gap-0 md:grid-cols-3 md:gap-8"
        />
        <FooterGroups
          groups={FOOTER_SHOP_GROUPS}
          className="grid gap-0 border-t-0 md:grid-cols-3 md:gap-8 md:border-t md:border-ink-700 md:pt-8 lg:grid-cols-5"
        />
      </nav>
      <div className="border-t border-ink-700">
        <div className="mx-auto flex max-w-page flex-col gap-2 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-6">
          <p className="text-sm text-ink-300">
            &copy; {new Date().getFullYear()} {SITE_NAME}. All rights reserved.
          </p>
          <ul className="flex flex-wrap items-center gap-x-4">
            {FOOTER_LEGAL_LINKS.map((link) => (
              <li key={link.to}>
                <Link to={link.to} className={LINK_CLASSES}>
                  {link.label}
                </Link>
              </li>
            ))}
            {supportPhone ? (
              <li>
                <a
                  href={supportPhone.href}
                  className={cn(LINK_CLASSES, 'gap-1')}
                >
                  <PhoneIcon className="size-4" />
                  <span className="sr-only">Call us: </span>
                  {supportPhone.display}
                </a>
              </li>
            ) : null}
          </ul>
        </div>
      </div>
    </footer>
  );
}
