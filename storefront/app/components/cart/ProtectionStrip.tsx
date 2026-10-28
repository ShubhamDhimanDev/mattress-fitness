import type {CartLine} from '~/components/CartLineItem';
import {coverageTermMonths} from '~/components/cart/cart-view';
import {RemoveButton} from '~/components/cart/LineActions';
import {useCartSubmit} from '~/components/cart/useCartSubmit';
import {
  PlanPrice,
  PlanSummary,
  PlanTermsLink,
  PoweredByExtend,
} from '~/components/extend/PlanParts';
import {Button} from '~/components/ui/Button';
import {Chip} from '~/components/ui/Chip';
import {cn} from '~/components/ui/cn';
import {ShieldCheckIcon} from '~/components/ui/Icons';
import {Price} from '~/components/ui/Price';
import {ADD_PROTECTION_ACTION} from '~/lib/cart/custom-actions';
import {formatCoverageTerm} from '~/lib/offers-runtime/client';
import type {
  ProtectionLineView,
  ProtectionPlanView,
} from '~/lib/offers-runtime/view';

// The protection plan lives inside the card of the item it covers (REQ-EXT-002, REQ-PRE-004). A covered plan is a nested
// cart line the server linked to its parent; an offer is the server's quote for an uncovered unit. Neither shows a price that
// did not come from Shopify (the line's cost) or from the server's Extend quote (which equals a real price-point variant,
// ADR-0009). Wording of the plan itself comes from the Extend parts; only the frame is written here. Not purchasable alone:
// there is no way to add a plan except from the card of an item.

type StripProps = {
  /** Coverage lines nested under the item. */
  covering: readonly CartLine[];
  /** The server's quotes for the units that have no plan yet; absent when none or Extend is off. */
  offer?: ProtectionLineView | undefined;
  /** The covered line is waiting for Shopify: plans cannot be added or removed meanwhile. */
  pending: boolean;
  onRemove: () => void;
  /** The drawer shows one line per plan instead of the spacious card strip. */
  compact?: boolean;
};

export function ProtectionStrip({
  covering,
  offer,
  pending,
  onRemove,
  compact = false,
}: StripProps) {
  if (covering.length === 0 && !offer) return null;
  return (
    <div
      className={cn(
        'flex flex-col divide-y divide-line bg-paper',
        // Page: a full-width strip at the foot of the card. Drawer: a rounded one-line row under the item.
        compact
          ? 'mt-3 overflow-hidden rounded-choice'
          : 'border-t border-line',
      )}
    >
      {covering.map((line) => (
        <CoveredPlan
          key={line.id}
          line={line}
          compact={compact}
          onRemove={onRemove}
        />
      ))}
      {offer ? (
        <PlanOffer
          offer={offer}
          pending={pending}
          compact={compact}
          hasCovered={covering.length > 0}
        />
      ) : null}
    </div>
  );
}

function ShieldBadge({compact}: {compact: boolean}) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center bg-surface text-primary-500',
        compact ? 'size-9 rounded-sm' : 'size-11 rounded-choice',
      )}
    >
      <ShieldCheckIcon className={compact ? 'size-5' : 'size-6'} />
    </span>
  );
}

function CoveredPlan({
  line,
  compact,
  onRemove,
}: {
  line: CartLine;
  compact: boolean;
  onRemove: () => void;
}) {
  const title = line.merchandise.product.title;
  const term = formatCoverageTerm(coverageTermMonths(line));
  const pending = Boolean(line.isOptimistic);
  return (
    <div
      aria-busy={pending || undefined}
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1',
        compact ? 'px-3 py-2' : 'px-4 py-4 md:px-6',
      )}
    >
      <ShieldBadge compact={compact} />
      <div className="min-w-0 flex-1 basis-40">
        <p
          className={cn(
            'flex flex-wrap items-center gap-x-2 gap-y-1 font-bold text-fg',
            compact && 'text-sm',
          )}
        >
          Protection plan added
          {/* Linked, never alone: the server removes it with the item and keeps its quantity equal to the item's. */}
          <Chip tone="success">Covers this item only</Chip>
        </p>
        <p className="text-sm text-fg-muted">
          {title}
          {term ? ` · ${term}` : ''}
        </p>
      </div>
      <Price
        price={line.cost?.totalAmount ?? line.merchandise.price}
        size="sm"
        stale={pending}
      />
      <RemoveButton
        lineId={line.id}
        title={title}
        disabled={pending}
        onRemove={onRemove}
      />
    </div>
  );
}

function PlanOffer({
  offer,
  pending,
  compact,
  hasCovered,
}: {
  offer: ProtectionLineView;
  pending: boolean;
  compact: boolean;
  hasCovered: boolean;
}) {
  const heading = hasCovered
    ? 'Protect the remaining items'
    : 'Protect this item';
  return (
    <div
      className={cn(
        'flex flex-col gap-3',
        compact ? 'px-3 py-3' : 'px-4 py-4 md:px-6',
      )}
    >
      <div className="flex items-center gap-3">
        <ShieldBadge compact={compact} />
        <p className={cn('font-bold text-fg', compact && 'text-sm')}>
          {heading}
          {offer.uncoveredQuantity > 1
            ? ` (${offer.uncoveredQuantity} items)`
            : ''}
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {offer.plans.map((plan) => (
          <ProtectionPlanRow
            key={plan.planId}
            line={offer}
            plan={plan}
            disabled={pending}
          />
        ))}
      </ul>
      <PoweredByExtend />
    </div>
  );
}

/**
 * One quoted plan with its terms link and an Add button. Adding sends the line id and the plan key only; the server re-derives
 * the plan, the coverage variant, the quantity and the nested link (P5A-07).
 */
export function ProtectionPlanRow({
  line,
  plan,
  disabled = false,
}: {
  line: ProtectionLineView;
  plan: ProtectionPlanView;
  disabled?: boolean;
}) {
  const {submit, pending} = useCartSubmit(
    `cart-protection-${line.lineId}-${plan.planId}`,
  );
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <span className="flex min-w-0 flex-col">
        <PlanSummary plan={plan} />
        <PlanTermsLink plan={plan} />
      </span>
      <span className="flex items-center gap-3">
        <PlanPrice plan={plan} />
        <Button
          type="button"
          variant="dark"
          size="sm"
          // Flex item: shrink-0 and no wrapping keep the label whole beside the price (BV-008).
          className="shrink-0 whitespace-nowrap"
          disabled={disabled}
          loading={pending}
          loadingLabel="Adding"
          aria-label={`Add ${plan.title} protection for ${line.productTitle}`}
          onClick={() =>
            submit(ADD_PROTECTION_ACTION, {
              lineId: line.lineId,
              planKey: plan.planId,
            })
          }
        >
          Add protection
        </Button>
      </span>
    </li>
  );
}
