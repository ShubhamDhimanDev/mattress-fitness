import {useId} from 'react';
import {
  PlanPrice,
  PlanSummary,
  PlanTermsLink,
  PoweredByExtend,
} from '~/components/extend/PlanParts';
import type {ProtectionOffers} from '~/components/extend/useProtectionOffers';
import {Radio} from '~/components/ui/Radio';
import {Skeleton} from '~/components/ui/Skeleton';

/** The panel never collapses below this while it loads or after it answers, so the Add to cart button does not jump (NFR-002). */
const RESERVED = 'min-h-64';

/**
 * Accident protection for the selected size (P5A-05, REQ-ADD-003, REQ-EXT-004). A radio group where "No protection" is
 * the default, then one choice per plan with its price, term and a link to the plan terms, and Extend's branding.
 * Choosing a plan changes only what the Add to cart button sends (a plan key, never a price). With no plans (Extend
 * off, down, product not eligible) nothing renders.
 *
 * The group keeps its place while a size change is being answered: the loading state has the same minimum height as the
 * answer. A product with more than one plan grows the panel a little after load; that is the only shift.
 */
export function ProtectionPanel({
  offers,
  selectedPlanId,
  onSelect,
}: {
  offers: ProtectionOffers;
  /** The chosen plan's id, or null for "No protection". */
  selectedPlanId: string | null;
  onSelect: (planId: string | null) => void;
}) {
  const groupName = useId();
  if (offers.status === 'hidden') return null;

  if (offers.status === 'loading') {
    return (
      <div aria-busy="true" className={`${RESERVED} flex flex-col gap-3`}>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-4 w-28" />
      </div>
    );
  }

  const count = offers.plans.length;
  return (
    <fieldset
      className={`${RESERVED} flex flex-col gap-3 rounded-card border border-line p-4`}
    >
      <legend className="px-1 text-base font-bold">Accident protection</legend>
      <p role="status" className="sr-only">
        {count === 1
          ? '1 protection plan is available for this size.'
          : `${count} protection plans are available for this size.`}
      </p>
      <Radio
        name={groupName}
        value=""
        label="No protection"
        checked={selectedPlanId === null}
        onChange={() => onSelect(null)}
      />
      {offers.plans.map((plan) => (
        <div key={plan.planId} className="flex flex-col">
          <Radio
            name={groupName}
            value={plan.planId}
            checked={selectedPlanId === plan.planId}
            onChange={() => onSelect(plan.planId)}
            label={
              <span className="flex flex-wrap items-baseline justify-between gap-x-4">
                <PlanSummary plan={plan} />
                <PlanPrice plan={plan} />
              </span>
            }
          />
          <PlanTermsLink plan={plan} className="ml-9" />
        </div>
      ))}
      <PoweredByExtend />
    </fieldset>
  );
}
