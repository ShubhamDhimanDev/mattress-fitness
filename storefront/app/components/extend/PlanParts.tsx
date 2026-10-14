import {cn} from '~/components/ui/cn';
import {formatCents} from '~/lib/money';
import {formatCoverageTerm} from '~/lib/offers-runtime/client';
import type {ProtectionPlanView} from '~/lib/offers-runtime/view';

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

/** Extend's branding rule (REQ-EXT-004). Text only until the client supplies Extend's approved logo asset. */
export function PoweredByExtend({className}: {className?: string}) {
  return (
    <p className={cn('text-xs text-fg-muted', className)}>Powered by Extend</p>
  );
}
