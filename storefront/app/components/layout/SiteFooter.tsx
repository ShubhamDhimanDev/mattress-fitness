import {useId, useState} from 'react';
import {Link} from 'react-router';
import {PrivacyChoicesButton} from '~/components/consent/PrivacyChoicesButton';
import {FooterLogo} from '~/components/layout/BrandLogo';
import {cn} from '~/components/ui/cn';
import {BRAND_TAGLINE} from '~/lib/brand';
import {displayHeadingClass} from '~/lib/display-type';
import {ChevronDownIcon, PhoneIcon} from '~/components/ui/Icons';
import {
  FOOTER_SHOP_GROUPS,
  NO_FOOTER_LINKS,
  SITE_NAME,
  type FooterGroup,
  type FooterLinks,
  type FooterQuickLink,
  type SupportPhone,
} from '~/lib/navigation';

const LINK_CLASSES =
  'inline-flex min-h-touch items-center text-sm text-ink-700 hover:text-primary-700 hover:underline';

/**
 * Footer link groups. Below 768 px each group is a collapsible section (a button inside a heading); from
 * 768 px every group is open and its heading is plain text. The links are always in the HTML, so crawlers
 * and assistive technology see them whether or not a section is collapsed.
 */
export function FooterGroups({
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
          <div key={group.id} className="border-b border-ink-300 md:border-b-0">
            <h2
              className={cn(
                'hidden pb-2 text-sm text-fg md:block',
                displayHeadingClass(group.heading),
              )}
            >
              {group.heading}
            </h2>
            <h2 className="md:hidden">
              <button
                type="button"
                aria-expanded={open}
                aria-controls={listId}
                onClick={() => toggle(group.id)}
                className={cn(
                  'group flex min-h-touch w-full items-center justify-between text-left text-sm text-fg',
                  displayHeadingClass(group.heading),
                )}
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

/** One side of the quick-links row: bold links, 44 px high, wrapping on a narrow screen. */
function QuickLinks({links}: {links: readonly FooterQuickLink[]}) {
  if (links.length === 0) return null;
  return (
    <ul className="flex flex-wrap items-center gap-x-6">
      {links.map((link) => (
        <li key={link.id}>
          <Link
            to={link.to}
            className="inline-flex min-h-touch items-center text-base font-bold text-fg hover:text-primary-700 hover:underline"
          >
            {link.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function SiteFooter({
  supportPhone = null,
  links = NO_FOOTER_LINKS,
}: {
  /** The client's number; without one no phone link is rendered. */
  supportPhone?: SupportPhone | null;
  /** The links that depend on Shopify content, built by the root loader (P6-09); none shows none of them. */
  links?: FooterLinks;
}) {
  return (
    // Light grey with one red rule on top, the only brand accent in the footer (BA-05). No signup band and no
    // social icons: the providers, wording and URLs do not exist yet (REQ-CNT-001, B-15, P7-02).
    <footer className="mt-auto border-t-4 border-primary-500 bg-surface-muted text-fg">
      <div className="mx-auto flex max-w-page items-center gap-4 px-4 pt-8 md:px-6 md:pt-12">
        <FooterLogo />
        {/* The client's own tagline, plain text; the logo's alt is the name only, so nothing is read twice. */}
        <p className="text-base font-bold text-fg">{BRAND_TAGLINE}</p>
      </div>
      <nav
        aria-label="Footer"
        className="mx-auto flex max-w-page flex-col gap-8 px-4 pt-2 pb-8 md:px-6 md:pt-4 md:pb-12"
      >
        <div className="flex flex-col gap-x-8 border-b border-ink-300 pb-6 md:flex-row md:items-center md:justify-between">
          <QuickLinks links={links.quickStart} />
          <QuickLinks links={links.quickEnd} />
        </div>
        <FooterGroups
          groups={links.supportGroups}
          className="grid gap-0 md:grid-cols-3 md:gap-8"
        />
        <FooterGroups
          groups={FOOTER_SHOP_GROUPS}
          className="grid gap-0 border-t-0 md:grid-cols-3 md:gap-8 md:border-t md:border-ink-300 md:pt-8 lg:grid-cols-5"
        />
      </nav>
      <div className="border-t border-ink-300">
        <div className="mx-auto flex max-w-page flex-col gap-2 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-6">
          <p className="text-sm text-ink-700">
            &copy; {new Date().getFullYear()} {SITE_NAME}. All rights reserved.
          </p>
          <ul className="flex flex-wrap items-center gap-x-4">
            {links.legal.map((link) => (
              <li key={link.to}>
                <Link to={link.to} className={LINK_CLASSES}>
                  {link.label}
                </Link>
              </li>
            ))}
            {/* Withdrawal of consent must be as easy as giving it (NFR-011). The button renders nothing while no analytics id is set and until the consent chunk has loaded (its store comes from `useSyncExternalStore` with a server snapshot, so the server HTML and the hydrating render agree), so `empty:hidden` removes its list item and leaves no stray gap. */}
            <li className="empty:hidden">
              <PrivacyChoicesButton />
            </li>
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
