import {useEffect, useId, useRef, useState} from 'react';
import {CartActionForm} from '~/components/cart/CartActionForm';
import {ProtectionPlanRow} from '~/components/cart/ProtectionStrip';
import type {CartLayout} from '~/components/CartMain';
import {PoweredByExtend} from '~/components/extend/PlanParts';
import {Badge} from '~/components/ui/Badge';
import {Button} from '~/components/ui/Button';
import {Card} from '~/components/ui/Card';
import {cn} from '~/components/ui/cn';
import {Price} from '~/components/ui/Price';
import {Radio} from '~/components/ui/Radio';
import {
  ADD_ADDON_ACTION,
  ADD_BUNDLE_ACTION,
  ADD_GIFT_ACTION,
} from '~/lib/cart/custom-actions';
import {readCartMessages, isCartActionResult} from '~/lib/cart/messages';
import {formatMoney} from '~/lib/money';
import {PICKER_COPY} from '~/lib/offers-runtime/messages';
import type {
  AddOnView,
  BundleOfferView,
  CartOffersView,
  GiftView,
  ProtectionLineView,
} from '~/lib/offers-runtime/view';

/** Heading for the add-on block (CR-31). The accessible name of its list; the engine's category labels stay on each card. */
const ADD_ONS_HEADING = 'Complete your sleep setup';

/**
 * What the engine offers this cart: gifts (REQ-CART-002), size-matched add-ons (REQ-CART-003) and bundles
 * (REQ-ADD-002), plus Extend protection. Everything shown was already filtered by the server (qualifying line present,
 * variant in stock, every bundle companion in stock). Each button posts ids taken from the view and nothing else: the
 * server proves them against the rules and the cart, derives the lines and quantities and runs the cart gate again, so an
 * offer the shopper should not have simply disappears (REQ-PRE-006). No price is claimed here: a gift or bundle price is
 * Shopify's discount and is shown only as Shopify returns it on the cart line. Wording is placeholder copy until the
 * client approves it (CLR-010, CLR-011).
 *
 * Protection plans are drawn inside the card of the item they cover (ProtectionStrip). `protectionPlacedFor` names the cart
 * lines whose card already shows their offer; any other offer still appears here, so none is lost.
 */
export function CartOffers({
  view,
  onAdded,
  layout = 'page',
  protectionPlacedFor,
  className,
}: {
  view: CartOffersView;
  /** Called once an add succeeded: the picker that held focus is gone by then, so the cart moves focus somewhere that exists. */
  onAdded?: () => void;
  layout?: CartLayout;
  protectionPlacedFor?: ReadonlySet<string>;
  className?: string;
}) {
  const protection = (view.accidentProtection?.lines ?? []).filter(
    (line) => !protectionPlacedFor?.has(line.lineId),
  );
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
      className={cn(
        'flex flex-col gap-5',
        layout === 'aside' && 'border-t border-line pt-5',
        className,
      )}
    >
      {view.gifts.map((gift) => (
        <GiftPicker key={gift.ruleId} gift={gift} onAdded={onAdded} />
      ))}
      {view.bundles.map((bundle) => (
        <BundleOffer
          key={`${bundle.bundleId}:${bundle.anchorLineId}`}
          bundle={bundle}
          onAdded={onAdded}
        />
      ))}
      {view.addOns.length > 0 ? (
        <AddOnList addOns={view.addOns} onAdded={onAdded} layout={layout} />
      ) : null}
      {protection.length > 0 ? <ProtectionOffers lines={protection} /> : null}
    </section>
  );
}

/**
 * Choose-one gift control (P4-04): a radio group when there is a real choice, plain text when there is one gift. The
 * form posts the rule id and the chosen variant id; the server adds exactly one.
 */
function GiftPicker({gift, onAdded}: {gift: GiftView; onAdded?: () => void}) {
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
    <Card
      variant="dashed-amber"
      padding="sm"
      role="group"
      aria-labelledby={headingId}
      className="flex flex-col gap-3"
    >
      <h3
        id={headingId}
        className="flex flex-wrap items-center gap-2 text-base font-extrabold"
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
            <AddedFocus data={fetcher.data} onAdded={onAdded} />
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
              variant="outline"
              size="sm"
              className="self-start"
              loading={fetcher.state !== 'idle'}
              loadingLabel={PICKER_COPY.gift.adding}
              aria-label={`${PICKER_COPY.gift.add}: ${label(selected)}${fetcher.state !== 'idle' ? ', adding' : ''}`}
            >
              {PICKER_COPY.gift.add}
            </Button>
          </div>
        )}
      </CartActionForm>
    </Card>
  );
}

function AddOnList({
  addOns,
  onAdded,
  layout,
}: {
  addOns: readonly AddOnView[];
  onAdded?: () => void;
  layout: CartLayout;
}) {
  const headingId = useId();
  const aside = layout === 'aside';
  const Heading = aside ? 'h3' : 'h2';
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Heading
        id={headingId}
        className={
          aside
            ? 'text-base font-extrabold text-fg'
            : 'type-display text-2xl md:text-3xl'
        }
      >
        {ADD_ONS_HEADING}
      </Heading>
      {/* Phone: a row that scrolls sideways with snap points. From md: three columns. The drawer stacks them. */}
      <ul
        aria-labelledby={headingId}
        className={cn(
          aside
            ? 'flex flex-col gap-3'
            : 'flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 md:grid md:grid-cols-3 md:gap-4 md:overflow-visible md:pb-0',
        )}
      >
        {addOns.map((addOn) => (
          <AddOnCard
            key={`${addOn.category}:${addOn.variant.variantId}`}
            addOn={addOn}
            onAdded={onAdded}
            aside={aside}
          />
        ))}
      </ul>
    </div>
  );
}

// No product photo: the offers view carries the variant's title and price but no image, and nothing is invented to fill the
// space. When the view gains an image the card gets a 4:3 picture above the text.
function AddOnCard({
  addOn,
  onAdded,
  aside,
}: {
  addOn: AddOnView;
  onAdded?: () => void;
  aside: boolean;
}) {
  const {variant} = addOn;
  // Drawer: a plain row (name and price left, the Add button right) instead of a bordered card, one line per offer.
  if (aside) {
    return (
      <li className="border-b border-line pb-3 last:border-b-0 last:pb-0">
        <CartActionForm
          route="/cart"
          action={ADD_ADDON_ACTION}
          inputs={{variantId: variant.variantId}}
        >
          {(fetcher) => (
            <div className="flex items-center justify-between gap-3">
              <AddedFocus data={fetcher.data} onAdded={onAdded} />
              <div className="flex min-w-0 flex-col">
                <span className="text-xs font-semibold text-fg-muted">
                  {PICKER_COPY.addOns.categories[addOn.category]}
                  {addOn.size ? ` for your ${addOn.size} mattress` : ''}
                </span>
                <span className="text-sm font-bold text-fg">
                  {variant.productTitle}
                  {variant.variantTitle ? `, ${variant.variantTitle}` : ''}
                </span>
                <Price price={variant.price} size="sm" />
              </div>
              <Button
                type="submit"
                variant="outline"
                size="sm"
                className="shrink-0"
                loading={fetcher.state !== 'idle'}
                loadingLabel={PICKER_COPY.addOns.adding}
                aria-label={`Add ${variant.productTitle} to cart${fetcher.state !== 'idle' ? ', adding' : ''}`}
              >
                {PICKER_COPY.addOns.add}
              </Button>
            </div>
          )}
        </CartActionForm>
      </li>
    );
  }
  return (
    <Card
      as="li"
      padding="sm"
      className="flex w-44 shrink-0 snap-start flex-col md:w-auto [&>form]:flex [&>form]:flex-1"
    >
      <CartActionForm
        route="/cart"
        action={ADD_ADDON_ACTION}
        inputs={{variantId: variant.variantId}}
      >
        {(fetcher) => (
          <div className="flex flex-1 flex-col gap-2">
            <AddedFocus data={fetcher.data} onAdded={onAdded} />
            <span className="text-caption font-bold text-fg-muted">
              {PICKER_COPY.addOns.categories[addOn.category]}
              {addOn.size ? ` for your ${addOn.size} mattress` : ''}
            </span>
            <span className="text-base font-extrabold text-fg">
              {variant.productTitle}
            </span>
            {variant.variantTitle ? (
              <span className="text-sm text-fg-muted">
                {variant.variantTitle}
              </span>
            ) : null}
            <div className="mt-auto flex items-center justify-between gap-2 pt-1">
              <Price price={variant.price} size="md" />
              <Button
                type="submit"
                variant="outline"
                size="sm"
                loading={fetcher.state !== 'idle'}
                loadingLabel={PICKER_COPY.addOns.adding}
                aria-label={`Add ${variant.productTitle} to cart${fetcher.state !== 'idle' ? ', adding' : ''}`}
              >
                {PICKER_COPY.addOns.add}
              </Button>
            </div>
          </div>
        )}
      </CartActionForm>
    </Card>
  );
}

/**
 * A bundle the cart is part of (P4-06). Incomplete: what is missing and one button that adds it all. Complete: only
 * shown when Shopify reported a saving on the lines, and the number is Shopify's, never ours.
 */
function BundleOffer({
  bundle,
  onAdded,
}: {
  bundle: BundleOfferView;
  onAdded?: () => void;
}) {
  const headingId = useId();
  const savings = bundle.savings;
  return (
    <Card
      padding="sm"
      role="group"
      aria-labelledby={headingId}
      className="flex flex-col gap-3"
    >
      <h3 id={headingId} className="text-base font-extrabold">
        {bundle.status === 'complete'
          ? PICKER_COPY.bundle.completeHeading
          : PICKER_COPY.bundle.heading}
        : {bundle.name}
      </h3>
      {bundle.status === 'complete' && savings ? (
        <p className="text-sm font-bold text-sale-fg">
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
                <span className="flex items-baseline gap-1">
                  <Price price={variant.price} size="sm" />
                  {quantity > 1 ? <span>each</span> : null}
                </span>
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
              <>
                <AddedFocus data={fetcher.data} onAdded={onAdded} />
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  loading={fetcher.state !== 'idle'}
                  loadingLabel={PICKER_COPY.bundle.adding}
                  aria-label={`${PICKER_COPY.bundle.add} to complete ${bundle.name}${fetcher.state !== 'idle' ? ', adding' : ''}`}
                >
                  {PICKER_COPY.bundle.add}
                </Button>
              </>
            )}
          </CartActionForm>
        </>
      ) : null}
    </Card>
  );
}

/**
 * Extend accident protection for each eligible item that has none yet and whose card does not show it (P5A-07, REQ-PRE-004,
 * REQ-EXT-004). Plans, prices and terms were read by the server (never the browser) and filtered to plans that match a real
 * price-point variant. Adding sends the line id and the plan key only; the server re-derives the plan, the coverage variant,
 * the quantity (the uncovered units) and the nested link, then the cart gate checks the result. Shown only with the Extend
 * flag on and only for items Extend quoted. Wording is placeholder copy until the client approves it (Q-005).
 */
function ProtectionOffers({lines}: {lines: readonly ProtectionLineView[]}) {
  const headingId = useId();
  return (
    <div className="flex flex-col gap-3">
      <h3 id={headingId} className="type-display text-lg">
        Protect your purchase
      </h3>
      <ul aria-labelledby={headingId} className="flex flex-col gap-4">
        {lines.map((line) => (
          <Card
            as="li"
            key={line.lineId}
            padding="sm"
            className="flex flex-col gap-2"
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
          </Card>
        ))}
      </ul>
      <PoweredByExtend />
    </div>
  );
}

/**
 * Reports a successful add to the cart. The form that was just used unmounts when the offer is used up, which would drop
 * focus to the page body; the cart moves it to its item list instead (WCAG 2.4.3). Refused adds keep focus on the button,
 * where the error is announced next to it.
 */
function AddedFocus({data, onAdded}: {data: unknown; onAdded?: () => void}) {
  const handled = useRef<unknown>(null);
  useEffect(() => {
    if (!onAdded || !isCartActionResult(data) || handled.current === data) {
      return;
    }
    handled.current = data;
    if (readCartMessages(data).every((message) => message.kind !== 'error')) {
      onAdded();
    }
  }, [data, onAdded]);
  return null;
}
