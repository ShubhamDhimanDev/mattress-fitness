import {useId} from 'react';
import {
  PlanPrice,
  PlanSummary,
  PlanTermsLink,
  PoweredByExtend,
} from '~/components/extend/PlanParts';
import type {ProtectionOffers} from '~/components/extend/useProtectionOffers';
import type {ProtectionPlanView} from '~/lib/offers-runtime/view';
import {Radio} from '~/components/ui/Radio';
import {Skeleton} from '~/components/ui/Skeleton';

/**
 * Held only when the product is known to have an Extend category (the loader's 'eligible' mode), so the Add to cart
 * button does not jump while the plans load or arrive (NFR-002).
 */
const RESERVED = 'min-h-64';

/**
 * Accident protection for the selected size (P5A-05, REQ-ADD-003, REQ-EXT-004). A radio group where "No protection" is
 * the default, then one choice per plan with its price, term and a link to the plan terms, and Extend's branding.
 * Choosing a plan changes only what the Add to cart button sends (a plan key, never a price). With no plans (Extend
 * off, down, product not eligible) nothing visible renders.
 *
 * `reserveSpace` is for a product the server knows has an Extend category: the loading state and the answer share one
 * minimum height. Without it there is no skeleton at all, and the panel appears in place only if plans arrive (the page
 * then puts it below the button, so nothing it does can move that button). The count announcement lives in a live
 * region that is mounted before it has text, so screen readers announce the change (WCAG 4.1.3).
 */
export function ProtectionPanel({
  offers,
  selectedPlanId,
  onSelect,
  reserveSpace = false,
}: {
  offers: ProtectionOffers;
  /** The chosen plan's id, or null for "No protection". */
  selectedPlanId: string | null;
  onSelect: (planId: string | null) => void;
  reserveSpace?: boolean;
}) {
  const groupName = useId();
  const count = offers.status === 'plans' ? offers.plans.length : 0;
  const announcement =
    count === 0
      ? ''
      : count === 1
        ? '1 protection plan is available for this size.'
        : `${count} protection plans are available for this size.`;

  return (
    <>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {offers.status === 'loading' && reserveSpace ? (
        <div aria-busy="true" className={`${RESERVED} flex flex-col gap-3`}>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-4 w-28" />
        </div>
      ) : null}
      {offers.status !== 'loading' &&
      offers.status !== 'plans' &&
      reserveSpace ? (
        // An eligible product whose answer is "no plan" (Extend down, no plan for this size) keeps its box so the Add to cart
        // button does not jump when the answer arrives (NFR-002).
        <div aria-hidden="true" className={RESERVED} />
      ) : null}
      {offers.status === 'plans' ? (
        <PlanGroup
          plans={offers.plans}
          groupName={groupName}
          reserveSpace={reserveSpace}
          selectedPlanId={selectedPlanId}
          onSelect={onSelect}
        />
      ) : null}
    </>
  );
}

function PlanGroup({
  plans,
  groupName,
  reserveSpace,
  selectedPlanId,
  onSelect,
}: {
  plans: readonly ProtectionPlanView[];
  groupName: string;
  reserveSpace: boolean;
  selectedPlanId: string | null;
  onSelect: (planId: string | null) => void;
}) {
  return (
    <fieldset
      className={`${reserveSpace ? `${RESERVED} ` : ''}flex flex-col gap-3 rounded-card border border-line p-4`}
    >
      <legend className="px-1 text-base font-bold">Accident protection</legend>
      <Radio
        name={groupName}
        value=""
        label="No protection"
        checked={selectedPlanId === null}
        onChange={() => onSelect(null)}
      />
      {plans.map((plan) => (
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
