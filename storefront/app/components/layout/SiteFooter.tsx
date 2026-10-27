import {lazy, Suspense, useId, useState, type ComponentType} from 'react';
import {Link} from 'react-router';
import {PrivacyChoicesButton} from '~/components/consent/PrivacyChoicesButton';
import {FooterLogo} from '~/components/layout/BrandLogo';
import type {SignupFormProps} from '~/components/signup/SignupForm';
import {cn} from '~/components/ui/cn';
import {BRAND_TAGLINE} from '~/lib/brand';
import type {SignupPublicConfig} from '~/lib/signup/shared';
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
            <h2 className="hidden pb-2 text-base font-extrabold text-white md:block">
              {group.heading}
            </h2>
            <h2 className="md:hidden">
              <button
                type="button"
                aria-expanded={open}
                aria-controls={listId}
                onClick={() => toggle(group.id)}
                className="group flex min-h-14 w-full items-center justify-between text-left text-base font-extrabold text-white"
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
            className="inline-flex min-h-touch items-center text-base font-bold text-white hover:underline"
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
  signup = null,
}: {
  /** The client's number; without one no phone link is rendered. */
  supportPhone?: SupportPhone | null;
  /** The links that depend on Shopify content, built by the root loader (P6-09); none shows none of them. */
  links?: FooterLinks;
  /** The email signup (P7-02), or null when it is not configured: then nothing is rendered and no code is requested. */
  signup?: SignupPublicConfig | null;
}) {
  return (
    // Ink band with the round logo, the client's tagline, the link groups and the legal row (CR-31). No social icons: the
    // providers, wording and URLs do not exist yet (REQ-CNT-001, B-15). The signup block exists only when configured.
    <footer className="on-dark mt-auto bg-surface-inverse text-white">
      <div className="mx-auto grid max-w-page gap-10 px-4 pt-12 pb-8 md:px-10 md:pt-16 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,3fr)] lg:gap-12">
        <div className="flex flex-col items-start gap-4">
          <FooterLogo />
          {/* The client's own tagline, plain text; the logo's alt is the name only, so nothing is read twice. */}
          <p className="text-base font-bold text-white">{BRAND_TAGLINE}</p>
          {supportPhone ? (
            <a href={supportPhone.href} className={cn(LINK_CLASSES, 'gap-2')}>
              <PhoneIcon className="size-4" />
              <span className="sr-only">Call us: </span>
              {supportPhone.display}
            </a>
          ) : null}
          {signup ? (
            // The form is built for a light surface, so it sits on a white card inside the ink band.
            <div className="on-light w-full max-w-xl rounded-card bg-surface p-5 text-fg">
              <Suspense fallback={<div aria-hidden="true" className="h-72" />}>
                <SignupForm config={signup} surface="footer" />
              </Suspense>
            </div>
          ) : null}
        </div>
        <nav aria-label="Footer" className="flex flex-col gap-8">
          <div className="flex flex-col gap-x-8 border-b border-ink-700 pb-6 md:flex-row md:items-center md:justify-between empty:hidden">
            <QuickLinks links={links.quickStart} />
            <QuickLinks links={links.quickEnd} />
          </div>
          <FooterGroups
            groups={links.supportGroups}
            className="grid gap-0 empty:hidden md:grid-cols-3 md:gap-8"
          />
          <FooterGroups
            groups={FOOTER_SHOP_GROUPS}
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
            {links.legal.map((link) => (
              <li key={link.to}>
                <Link to={link.to} className={LINK_CLASSES}>
                  {link.label}
                </Link>
              </li>
            ))}
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
