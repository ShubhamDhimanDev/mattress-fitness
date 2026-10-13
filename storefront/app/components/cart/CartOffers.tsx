import {CartForm} from '@shopify/hydrogen';
import {useId, useState} from 'react';
import {useCartSubmit} from '~/components/cart/useCartSubmit';
import {Badge} from '~/components/ui/Badge';
import {Button} from '~/components/ui/Button';
import {Price} from '~/components/ui/Price';
import {Select} from '~/components/ui/Select';
import type {AddOnCategory} from '~/lib/offers/types';
import type {
  AddOnView,
  CartOffersView,
  GiftView,
} from '~/lib/offers-runtime/view';

const CATEGORY_LABEL: Record<AddOnCategory, string> = {
  foundation: 'Matching foundation',
  protector: 'Matching protector',
  pillow: 'Matching pillow',
  bedding: 'Matching bedding',
};

/**
 * Offers the engine returned for this cart: gifts (REQ-CART-002) and size-matched add-ons (REQ-CART-003).
 * Everything shown was already filtered by the server (qualifying line present, variant in stock). Adding
 * sends a variant id and quantity only; the server re-runs the rules on the result, so an offer the shopper
 * should not have simply disappears again (REQ-PRE-006).
 *
 * Placeholder (P4-04): these are plain one-click pickers. Richer add-on cards, bundles (P4-05) and gift
 * artwork (P4-06) replace the rows below; the data contract (`CartOffersView`) stays.
 */
export function CartOffers({view}: {view: CartOffersView}) {
  if (view.gifts.length === 0 && view.addOns.length === 0) return null;

  return (
    <section
      aria-label="Offers for your cart"
      className="mt-6 flex flex-col gap-6 border-t border-line pt-6"
    >
      {view.gifts.map((gift) => (
        <GiftPicker key={gift.ruleId} gift={gift} />
      ))}
      {view.addOns.length > 0 ? <AddOnList addOns={view.addOns} /> : null}
    </section>
  );
}

function GiftPicker({gift}: {gift: GiftView}) {
  const headingId = useId();
  const {submit, pending} = useCartSubmit(`cart-gift-${gift.ruleId}`);
  const [chosen, setChosen] = useState(gift.sizes[0]?.variant.variantId ?? '');
  const options = gift.sizes.map(({size, variant}) => ({
    value: variant.variantId,
    label: size,
  }));
  // The choice is derived each render, so a size that disappeared after a refresh falls back to the first.
  const selected =
    gift.sizes.find((entry) => entry.variant.variantId === chosen) ??
    gift.sizes[0];

  return (
    <div
      aria-labelledby={headingId}
      role="group"
      className="flex flex-col gap-3"
    >
      <h3
        id={headingId}
        className="flex items-center gap-2 text-base font-bold"
      >
        <Badge variant="gift">Free gift</Badge>
        {gift.name}
      </h3>
      <p className="text-sm text-fg-muted">
        Choose your gift. It is added at no charge while the qualifying item is
        in your cart.
      </p>
      {selected ? (
        <p className="text-sm">{selected.variant.productTitle}</p>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        {options.length > 1 ? (
          <Select
            label="Gift size"
            options={options}
            value={selected?.variant.variantId}
            onChange={(event) => setChosen(event.target.value)}
          />
        ) : null}
        <Button
          type="button"
          variant="secondary"
          loading={pending}
          loadingLabel="Adding"
          disabled={!selected}
          onClick={() =>
            submit(CartForm.ACTIONS.LinesAdd, {
              lines: [
                {
                  merchandiseId: selected?.variant.variantId ?? '',
                  quantity: 1,
                },
              ],
            })
          }
        >
          Add free gift
        </Button>
      </div>
    </div>
  );
}

function AddOnList({addOns}: {addOns: readonly AddOnView[]}) {
  const headingId = useId();
  return (
    <div className="flex flex-col gap-3">
      <h3 id={headingId} className="text-base font-bold">
        Goes with your mattress
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
  const {submit, pending} = useCartSubmit(
    `cart-addon-${addOn.variant.variantId}`,
  );
  const {variant} = addOn;
  return (
    <li className="flex items-center justify-between gap-3 rounded-card border border-line p-3">
      <span className="flex min-w-0 flex-col">
        <span className="text-xs font-bold uppercase text-fg-muted">
          {CATEGORY_LABEL[addOn.category]}
        </span>
        <span className="font-bold">{variant.productTitle}</span>
        {variant.variantTitle ? (
          <span className="text-sm text-fg-muted">{variant.variantTitle}</span>
        ) : null}
        <Price price={variant.price} size="sm" />
      </span>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        loading={pending}
        loadingLabel="Adding"
        aria-label={`Add ${variant.productTitle} to cart`}
        onClick={() =>
          submit(CartForm.ACTIONS.LinesAdd, {
            lines: [{merchandiseId: variant.variantId, quantity: 1}],
          })
        }
      >
        Add
      </Button>
    </li>
  );
}
