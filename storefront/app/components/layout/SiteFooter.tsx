import {lazy, Suspense, useId, useState, type ComponentType} from 'react';
import {Link} from 'react-router';
import {PrivacyChoicesButton} from '~/components/consent/PrivacyChoicesButton';
import {FooterLogo} from '~/components/layout/BrandLogo';
import type {SignupFormProps} from '~/components/signup/SignupForm';
import {cn} from '~/components/ui/cn';
import {BRAND_TAGLINE} from '~/lib/brand';
import {BUSINESS_ADDRESS, SOCIAL_LINKS} from '~/lib/business';
import type {SignupPublicConfig} from '~/lib/signup/shared';
import {
  ChevronDownIcon,
  FacebookIcon,
  InstagramIcon,
  PhoneIcon,
} from '~/components/ui/Icons';
import {
  FOOTER_SHOP_GROUPS,
  NO_FOOTER_LINKS,
  SITE_NAME,
  type FooterGroup,
  type FooterLinks,
  type FooterQuickLink,
  type SupportPhone,
} from '~/lib/navigation';

// The signup form is a lazy chunk requested only where a form renders, which is nowhere when the signup is off: this
// file names a dynamic import and nothing else about it (bundle budget, scripts/perf; review m7). A chunk that cannot be
// downloaded hides the form and nothing else (NFR-013).
const NoSignup: ComponentType<SignupFormProps> = () => null;
const SignupForm = lazy(
  (): Promise<{default: ComponentType<SignupFormProps>}> =>
    import('~/components/signup/SignupForm').then(
      (module) => ({default: module.SignupForm}),
      () => ({default: NoSignup}),
    ),
);

// The footer is an ink band (CR-31): links are ink-300 (10.5 : 1 on ink-900) and turn white; the band carries `on-dark`
// so the focus ring is yellow.
const LINK_CLASSES =
  'inline-flex min-h-touch items-center text-sm text-ink-300 hover:text-white hover:underline';

/** A footer column: a group, and optionally a second group stacked under it (see `FooterGroups`). */
type FooterColumn = FooterGroup & {readonly below?: FooterGroup | undefined};

/**
 * Footer link groups. Below 768 px each group is a collapsible section (a button inside a heading); from
 * 768 px every group is open and its heading is plain text. The links are always in the HTML, so crawlers
 * and assistive technology see them whether or not a section is collapsed. Headings are plain bold type, not
 * `type-display` (too tight at 16 px).
 */
export function FooterGroups({
  groups,
  className,
}: {
  groups: readonly FooterColumn[];
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
      {groups.map((group) => (
        <div key={group.id} className="md:flex md:flex-col md:gap-6">
          <GroupBlock
            group={group}
            baseId={baseId}
            open={openIds.includes(group.id)}
            onToggle={toggle}
          />
          {/* A second block in the same column, with its own heading (the Policies list under the Sleep guide). It is its own
              section on a phone, and on a wide screen it starts where the first block ends. */}
          {group.below ? (
            <GroupBlock
              group={group.below}
              baseId={baseId}
              open={openIds.includes(group.below.id)}
              onToggle={toggle}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** One heading and its list: a collapsible section below 768 px, plain open text from there. */
function GroupBlock({
  group,
  baseId,
  open,
  onToggle,
}: {
  group: FooterGroup;
  baseId: string;
  open: boolean;
  onToggle: (id: string) => void;
}) {
  const listId = `${baseId}-${group.id}`;
  return (
    <div className="border-b border-ink-700 md:border-b-0">
      <h2 className="hidden pb-2 text-base font-extrabold text-white md:block">
        {group.heading}
      </h2>
      <h2 className="md:hidden">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => onToggle(group.id)}
          className="group flex min-h-14 w-full items-center justify-between text-left text-base font-extrabold text-white"
        >
          {group.heading}
          <ChevronDownIcon className="size-5 motion-safe:transition-transform group-aria-expanded:rotate-180" />
        </button>
      </h2>
      <ul id={listId} className={cn('pb-2 md:pb-0', !open && 'max-md:hidden')}>
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
            className="inline-flex min-h-touch items-center text-base font-bold text-white hover:underline"
          >
            {link.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The Sleep guide group takes the place of "Shop by brand" in the shop-by row (the brands are in the main menu and on
 * /brands); the support row keeps the rest. Without a Sleep guide group the brand column is simply dropped. The Policies
 * list (one link per policy page that exists) goes under the Sleep guide, which is the shortest column and leaves the space
 * (owner request 2026-11-06); with no Sleep guide it becomes a column of its own.
 */
function splitFooterGroups(
  supportGroups: readonly FooterGroup[],
  policies: FooterGroup | null,
): {
  support: readonly FooterGroup[];
  shop: readonly FooterColumn[];
} {
  const sleepGuide = supportGroups.find((group) => group.id === 'sleep-guide');
  const shop: FooterColumn[] = FOOTER_SHOP_GROUPS.flatMap((group) =>
    group.id === 'mattresses-brand'
      ? sleepGuide
        ? [{...sleepGuide, below: policies ?? undefined}]
        : []
      : [group],
  );
  return {
    support: supportGroups.filter((group) => group.id !== 'sleep-guide'),
    shop: sleepGuide || policies === null ? shop : [...shop, policies],
  };
}

export function SiteFooter({
  supportPhone = null,
  links = NO_FOOTER_LINKS,
  signup = null,
}: {
  /** The client's number; without one no phone link is rendered. */
  supportPhone?: SupportPhone | null;
  /** The links that depend on Shopify content, built by the root loader (P6-09); none shows none of them. */
  links?: FooterLinks;
  /** The email signup (P7-02), or null when it is not configured: then nothing is rendered and no code is requested. */
  signup?: SignupPublicConfig | null;
}) {
  // Every policy page that exists, one link each: the legal links the root loader built (privacy, refund, terms, website
  // accessibility, submission policy). They are listed here, under the Sleep guide, and not in the bottom row.
  const policies: FooterGroup | null =
    links.legal.length > 0
      ? {id: 'policies', heading: 'Policies', links: [...links.legal]}
      : null;
  const groups = splitFooterGroups(links.supportGroups, policies);
  return (
    // Ink band with the round logo, the client's tagline, the link groups and the legal row (CR-31). The social icons link
    // to the owner's Instagram and Facebook pages (lib/business.ts). The signup row exists only when configured.
    <footer className="on-dark mt-auto bg-surface-inverse text-white">
      {signup ? (
        // The signup is its own full-width row above the links (it was squeezed under the address in the narrow left
        // column): the words on the ink band on the left, the form on a white card on the right, as on the home page.
        <div className="border-b border-ink-700">
          <div className="mx-auto max-w-page px-4 py-10 md:px-10 md:py-12">
            <Suspense
              fallback={<div aria-hidden="true" className="h-64 md:h-56" />}
            >
              <SignupForm config={signup} surface="footer" layout="band" />
            </Suspense>
          </div>
        </div>
      ) : null}
      <div className="mx-auto grid max-w-page gap-10 px-4 pt-12 pb-8 md:px-10 md:pt-16 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,3fr)] lg:gap-12">
        <div className="flex flex-col items-start gap-4">
          <FooterLogo />
          {/* The client's own tagline, plain text; the logo's alt is the name only, so nothing is read twice. */}
          <p className="text-base font-bold text-white">{BRAND_TAGLINE}</p>
          {/* The store's address and phone (lib/business.ts), under the logo. The map is on the home page. */}
          <address className="flex flex-col text-sm text-ink-300 not-italic">
            {BUSINESS_ADDRESS.lines.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </address>
          {supportPhone ? (
            <a href={supportPhone.href} className={cn(LINK_CLASSES, 'gap-2')}>
              <PhoneIcon className="size-4" />
              <span className="sr-only">Call us: </span>
              {supportPhone.display}
            </a>
          ) : null}
          <ul className="flex items-center gap-1">
            {SOCIAL_LINKS.map((link) => (
              <li key={link.id}>
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${link.label} (opens in a new tab)`}
                  className="inline-flex size-touch items-center justify-center rounded-choice text-white hover:bg-ink-700"
                >
                  {link.id === 'instagram' ? (
                    <InstagramIcon />
                  ) : (
                    <FacebookIcon />
                  )}
                </a>
              </li>
            ))}
          </ul>
        </div>
        <nav aria-label="Footer" className="flex flex-col gap-8">
          <div className="flex flex-col gap-x-8 border-b border-ink-700 pb-6 md:flex-row md:items-center md:justify-between empty:hidden">
            <QuickLinks links={links.quickStart} />
            <QuickLinks links={links.quickEnd} />
          </div>
          <FooterGroups
            groups={groups.support}
            className="grid gap-0 empty:hidden md:grid-cols-3 md:gap-8"
          />
          <FooterGroups
            groups={groups.shop}
            className="grid gap-0 border-t-0 md:grid-cols-3 md:gap-8 md:border-t md:border-ink-700 md:pt-8 xl:grid-cols-5"
          />
        </nav>
      </div>
      <div className="border-t border-ink-700">
        <div className="mx-auto flex max-w-page flex-col gap-2 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-10">
          <p className="text-sm text-ink-300">
            &copy; {new Date().getFullYear()} {SITE_NAME}. All rights reserved.
          </p>
          <ul className="flex flex-wrap items-center gap-x-6">
            {/* Withdrawal of consent must be as easy as giving it (NFR-011). The button renders nothing while no analytics id is set and until the consent chunk has loaded (its store comes from `useSyncExternalStore` with a server snapshot, so the server HTML and the hydrating render agree), so `empty:hidden` removes its list item and leaves no stray gap. The button's own colours are for a light surface; the important modifiers re-colour it for the ink band. */}
            <li className="empty:hidden">
              <PrivacyChoicesButton className="text-ink-300! hover:text-white!" />
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
