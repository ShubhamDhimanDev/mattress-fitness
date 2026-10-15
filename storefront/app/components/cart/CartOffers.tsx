import {useId, useState} from 'react';
import {CartActionForm} from '~/components/cart/CartActionForm';
import {useCartSubmit} from '~/components/cart/useCartSubmit';
import {
  PlanPrice,
  PlanSummary,
  PlanTermsLink,
  PoweredByExtend,
} from '~/components/extend/PlanParts';
import {Badge} from '~/components/ui/Badge';
import {Button} from '~/components/ui/Button';
import {Price} from '~/components/ui/Price';
import {Radio} from '~/components/ui/Radio';
import {
  ADD_ADDON_ACTION,
  ADD_BUNDLE_ACTION,
  ADD_GIFT_ACTION,
  ADD_PROTECTION_ACTION,
} from '~/lib/cart/custom-actions';
import {formatMoney} from '~/lib/money';
import {PICKER_COPY} from '~/lib/offers-runtime/messages';
import type {
  AddOnView,
  BundleOfferView,
  CartOffersView,
  GiftView,
  ProtectionLineView,
  ProtectionPlanView,
} from '~/lib/offers-runtime/view';

/**
 * What the engine offers this cart: gifts (REQ-CART-002), size-matched add-ons (REQ-CART-003) and bundles
 * (REQ-ADD-002), plus Extend protection. Everything shown was already filtered by the server (qualifying line present,
 * variant in stock, every bundle companion in stock). Each button posts ids taken from the view and nothing else: the
 * server proves them against the rules and the cart, derives the lines and quantities and runs the cart gate again, so an
 * offer the shopper should not have simply disappears (REQ-PRE-006). No price is claimed here: a gift or bundle price is
 * Shopify's discount and is shown only as Shopify returns it on the cart line. Wording is placeholder copy until the
 * client approves it (CLR-010, CLR-011).
 */
export function CartOffers({view}: {view: CartOffersView}) {
  const protection = view.accidentProtection?.lines ?? [];
  if (
    view.gifts.length === 0 &&
    view.addOns.length === 0 &&
    view.bundles.length === 0 &&
    protection.length === 0
  ) {
    return null;
  }

  return (
    <section
      aria-label={PICKER_COPY.region}
      className="mt-6 flex flex-col gap-6 border-t border-line pt-6"
    >
      {view.gifts.map((gift) => (
        <GiftPicker key={gift.ruleId} gift={gift} />
      ))}
      {view.bundles.map((bundle) => (
        <BundleOffer
          key={`${bundle.bundleId}:${bundle.anchorLineId}`}
          bundle={bundle}
        />
      ))}
      {view.addOns.length > 0 ? <AddOnList addOns={view.addOns} /> : null}
      {protection.length > 0 ? <ProtectionOffers lines={protection} /> : null}
    </section>
  );
}

/**
 * Choose-one gift control (P4-04): a radio group when there is a real choice, plain text when there is one gift. The
 * form posts the rule id and the chosen variant id; the server adds exactly one.
 */
function GiftPicker({gift}: {gift: GiftView}) {
  const headingId = useId();
  const groupName = useId();
  const [chosen, setChosen] = useState(gift.sizes[0]?.variant.variantId ?? '');
  // Derived each render, so a choice that disappeared after a refresh falls back to the first.
  const selected =
    gift.sizes.find((entry) => entry.variant.variantId === chosen) ??
    gift.sizes[0];
  if (!selected) return null;
  const label = (entry: GiftView['sizes'][number]) =>
    `${entry.variant.productTitle} (${entry.size})`;

  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-card border border-line p-3"
    >
      <h3
        id={headingId}
        className="flex flex-wrap items-center gap-2 text-base font-bold"
      >
        <Badge variant="gift">{PICKER_COPY.gift.badge}</Badge>
        {gift.name}
      </h3>
      <p className="text-sm text-fg-muted">{PICKER_COPY.gift.help}</p>
      <CartActionForm
        route="/cart"
        action={ADD_GIFT_ACTION}
        inputs={{ruleId: gift.ruleId, variantId: selected.variant.variantId}}
      >
        {(fetcher) => (
          <div className="flex flex-col gap-3">
            {gift.sizes.length > 1 ? (
              <fieldset className="flex flex-col">
                <legend className="mb-1 text-sm font-bold">
                  {PICKER_COPY.gift.legend}
                </legend>
                {gift.sizes.map((entry) => (
                  <Radio
                    key={entry.variant.variantId}
                    name={groupName}
                    value={entry.variant.variantId}
                    checked={
                      entry.variant.variantId === selected.variant.variantId
                    }
                    onChange={() => setChosen(entry.variant.variantId)}
                    label={label(entry)}
                  />
                ))}
              </fieldset>
            ) : (
              <p className="text-sm">{label(selected)}</p>
            )}
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              className="self-start"
              loading={fetcher.state !== 'idle'}
              loadingLabel={PICKER_COPY.gift.adding}
              aria-label={`${PICKER_COPY.gift.add}: ${label(selected)}`}
            >
              {PICKER_COPY.gift.add}
            </Button>
          </div>
        )}
      </CartActionForm>
    </div>
  );
}

function AddOnList({addOns}: {addOns: readonly AddOnView[]}) {
  const headingId = useId();
  return (
    <div className="flex flex-col gap-3">
      <h3 id={headingId} className="text-base font-bold">
        {PICKER_COPY.addOns.heading}
      </h3>
      <ul aria-labelledby={headingId} className="flex flex-col gap-3">
        {addOns.map((addOn) => (
          <AddOnRow
            key={`${addOn.category}:${addOn.variant.variantId}`}
            addOn={addOn}
          />
        ))}
      </ul>
    </div>
  );
}

function AddOnRow({addOn}: {addOn: AddOnView}) {
  const {variant} = addOn;
  return (
    <li className="rounded-card border border-line p-3">
      <CartActionForm
        route="/cart"
        action={ADD_ADDON_ACTION}
        inputs={{variantId: variant.variantId}}
      >
        {(fetcher) => (
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 flex-col">
              <span className="text-xs font-bold uppercase text-fg-muted">
                {PICKER_COPY.addOns.categories[addOn.category]}
                {addOn.size ? ` for your ${addOn.size} mattress` : ''}
              </span>
              <span className="font-bold">{variant.productTitle}</span>
              {variant.variantTitle ? (
                <span className="text-sm text-fg-muted">
                  {variant.variantTitle}
                </span>
              ) : null}
              <Price price={variant.price} size="sm" />
            </span>
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              loading={fetcher.state !== 'idle'}
              loadingLabel={PICKER_COPY.addOns.adding}
              aria-label={`Add ${variant.productTitle} to cart`}
            >
              {PICKER_COPY.addOns.add}
            </Button>
          </div>
        )}
      </CartActionForm>
    </li>
  );
}

/**
 * A bundle the cart is part of (P4-06). Incomplete: what is missing and one button that adds it all. Complete: only
 * shown when Shopify reported a saving on the lines, and the number is Shopify's, never ours.
 */
function BundleOffer({bundle}: {bundle: BundleOfferView}) {
  const headingId = useId();
  const savings = bundle.savings;
  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-card border border-line p-3"
    >
      <h3 id={headingId} className="text-base font-bold">
        {bundle.status === 'complete'
          ? PICKER_COPY.bundle.completeHeading
          : PICKER_COPY.bundle.heading}
        : {bundle.name}
      </h3>
      {bundle.status === 'complete' && savings ? (
        <p className="text-sm">
          Savings on these items: {formatMoney(savings)}
        </p>
      ) : null}
      {bundle.status === 'incomplete' ? (
        <>
          <p className="text-sm text-fg-muted">
            With your {bundle.anchorTitle}. {PICKER_COPY.bundle.help}
          </p>
          <ul className="flex flex-col gap-2">
            {bundle.missing.map(({variant, quantity}) => (
              <li
                key={variant.variantId}
                className="flex items-baseline justify-between gap-3 text-sm"
              >
                <span>
                  {quantity > 1 ? `${quantity} x ` : ''}
                  {variant.productTitle}
                  {variant.variantTitle ? `, ${variant.variantTitle}` : ''}
                </span>
                <Price price={variant.price} size="sm" />
              </li>
            ))}
          </ul>
          <CartActionForm
            route="/cart"
            action={ADD_BUNDLE_ACTION}
            inputs={{
              bundleId: bundle.bundleId,
              anchorLineId: bundle.anchorLineId,
            }}
          >
            {(fetcher) => (
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                loading={fetcher.state !== 'idle'}
                loadingLabel={PICKER_COPY.bundle.adding}
                aria-label={`${PICKER_COPY.bundle.add} to complete ${bundle.name}`}
              >
                {PICKER_COPY.bundle.add}
              </Button>
            )}
          </CartActionForm>
        </>
      ) : null}
    </div>
  );
}

/**
 * Extend accident protection for each eligible item that has none yet (P5A-07, REQ-PRE-004, REQ-EXT-004). Plans, prices
 * and terms were read by the server (never the browser) and filtered to plans that match a real price-point variant.
 * Adding sends the line id and the plan key only; the server re-derives the plan, the coverage variant, the quantity (the
 * uncovered units) and the nested link, then the cart gate checks the result. Shown only with the Extend flag on and
 * only for items Extend quoted. Wording is placeholder copy until the client approves it (Q-005).
 */
function ProtectionOffers({lines}: {lines: readonly ProtectionLineView[]}) {
  const headingId = useId();
  return (
    <div className="flex flex-col gap-3">
      <h3 id={headingId} className="text-base font-bold">
        Protect your purchase
      </h3>
      <ul aria-labelledby={headingId} className="flex flex-col gap-4">
        {lines.map((line) => (
          <li
            key={line.lineId}
            className="flex flex-col gap-2 rounded-card border border-line p-3"
          >
            <span className="font-bold">
              {line.productTitle}
              {line.variantTitle ? `, ${line.variantTitle}` : ''}
              {line.uncoveredQuantity > 1
                ? ` (${line.uncoveredQuantity} items)`
                : ''}
            </span>
            <ul className="flex flex-col gap-3">
              {line.plans.map((plan) => (
                <ProtectionPlanRow key={plan.planId} line={line} plan={plan} />
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <PoweredByExtend />
    </div>
  );
}

function ProtectionPlanRow({
  line,
  plan,
}: {
  line: ProtectionLineView;
  plan: ProtectionPlanView;
}) {
  const {submit, pending} = useCartSubmit(
    `cart-protection-${line.lineId}-${plan.planId}`,
  );
  return (
    <li className="flex flex-wrap items-center justify-between gap-3">
      <span className="flex min-w-0 flex-col">
        <PlanSummary plan={plan} />
        <PlanTermsLink plan={plan} />
      </span>
      <span className="flex items-center gap-3">
        <PlanPrice plan={plan} />
        <Button
          type="button"
          variant="secondary"
          size="sm"
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
