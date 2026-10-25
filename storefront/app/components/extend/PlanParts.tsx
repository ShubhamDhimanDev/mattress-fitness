import {useRouteLoaderData} from 'react-router';
import {cn} from '~/components/ui/cn';
import {formatCents} from '~/lib/money';
import {formatCoverageTerm} from '~/lib/offers-runtime/client';
import type {ProtectionPlanView} from '~/lib/offers-runtime/view';
import type {RootLoader} from '~/root';

// Presentational pieces shared by every Extend offer surface (product page, cart, pre-checkout step). Extend requires its
// branding, an accurate price and a link to the plan details and terms on each of them (REQ-EXT-004). Wording is
// placeholder copy until the client approves it (Q-005). Plan text comes from Extend through our server and is rendered
// as plain text only.

/** Plan title and, when Extend states one, its term. */
export function PlanSummary({plan}: {plan: ProtectionPlanView}) {
  const term = formatCoverageTerm(plan.termMonths);
  return (
    <span className="flex flex-col">
      <span className="font-bold">{plan.title}</span>
      {term ? <span className="text-sm text-fg-muted">{term}</span> : null}
    </span>
  );
}

/** The price Extend quoted, which equals a real Shopify price-point variant (ADR-0009), so it is what the cart charges. */
export function PlanPrice({
  plan,
  className,
}: {
  plan: ProtectionPlanView;
  className?: string;
}) {
  return (
    <span className={cn('font-bold', className)}>
      {formatCents(plan.priceCents)}
    </span>
  );
}

/** Link to the plan details and terms. Opens a new tab, which is said in text, not only by the icon (WCAG 3.2.5). */
export function PlanTermsLink({
  plan,
  className,
}: {
  plan: ProtectionPlanView;
  className?: string;
}) {
  return (
    <a
      href={plan.termsUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex min-h-touch items-center text-sm text-primary-700 underline underline-offset-2',
        className,
      )}
    >
      Plan details and terms
      <span className="sr-only"> for {plan.title} (opens in a new tab)</span>
    </a>
  );
}

/**
 * Extend's branding rule (REQ-EXT-004): "Powered by Extend", Extend's logo and a link to the coverage terms on every
 * offer surface. The logo and the terms link are slots filled from PUBLIC_EXTEND_LOGO_URL and PUBLIC_EXTEND_TERMS_URL
 * (https only, validated on the server); with neither set this is the text alone. The requirement stays Blocked until
 * Extend's written approval is on file (Q-005, B-15), so the slots are ready but nothing here is approved branding.
 */
export function PoweredByExtend({className}: {className?: string}) {
  const branding = useRouteLoaderData<RootLoader>('root')?.extendBranding;
  return (
    <p
      className={cn(
        'flex flex-wrap items-center gap-x-2 text-xs text-fg-muted',
        className,
      )}
    >
      <span>Powered by Extend</span>
      {branding?.logoUrl ? (
        // Decorative: the words beside it already name Extend. Fixed height keeps the line from shifting when it loads.
        <img
          src={branding.logoUrl}
          alt=""
          height={16}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="h-4 w-auto"
        />
      ) : null}
      {branding?.termsUrl ? (
        <a
          href={branding.termsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-touch items-center text-primary-700 underline underline-offset-2"
        >
          Extend protection plan terms
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ) : null}
    </p>
  );
}
