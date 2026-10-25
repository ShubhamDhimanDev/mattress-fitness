import {useState} from 'react';
import {useNavigate} from 'react-router';
import {AddToCartButton} from '~/components/AddToCartButton';
import {useAside} from '~/components/Aside';
import {CartMessages} from '~/components/cart/CartMessages';
import {FinancingMessage} from '~/components/cart/FinancingMessage';
import {CompareToggle} from '~/components/compare/CompareToggle';
import {DeliveryCheck} from '~/components/delivery/DeliveryCheck';
import {AddWithProtectionButton} from '~/components/extend/AddWithProtectionButton';
import {ProtectionPanel} from '~/components/extend/ProtectionPanel';
import {PickupSlot} from '~/components/product/PickupSlot';
import {ProductAddOns} from '~/components/product/ProductAddOns';
import {VendorName} from '~/components/product/VendorName';
import {useProtectionOffers} from '~/components/extend/useProtectionOffers';
import {Badge} from '~/components/ui/Badge';
import {Price} from '~/components/ui/Price';
import {Rating} from '~/components/ui/Rating';
import {SizeSelector} from '~/components/ui/SizeSelector';
import {SIZE_OPTION_NAME, toSlug} from '~/lib/catalog/attributes';
import {sizeOf} from '~/lib/offers-runtime/sizes';
import type {ReviewsAggregate} from '~/lib/reviews/provider';
import type {BrandLink} from '~/lib/shopify/brand-link';
import type {ProtectionMode} from '~/lib/shopify/protection-mode';
import {savingsLabel} from '~/lib/shopify/pricing';
import type {ProductPageView, VariantView} from '~/lib/shopify/types';
import {
  dimensionsForValue,
  isOptionValueAvailable,
  selectVariant,
  selectionOf,
  selectionToSearch,
} from '~/lib/shopify/variant-selection';

/**
 * Title, price, option selectors and Add to cart (REQ-PDP-001). Choosing a size updates the URL
 * (`?Size=Queen`) and everything below from the variants already on the page, with no full reload. Price,
 * savings, SKU and availability all come from the selected variant, which came from Shopify.
 *
 * `protection` is decided by the loader from the server's Extend flag and the product's Extend category (P5A-05,
 * REQ-ADD-003, NFR-002): 'off' renders nothing Extend-related from the first paint and makes no request; 'eligible'
 * shows the accident-protection panel above the button and holds its height while it loads; 'unknown' (the category
 * could not be read) shows it BELOW the button with no reserved space, so its answer cannot move Add to cart. A chosen
 * plan turns the button into an add-with-protection submission.
 */
export function ProductBuyBox({
  product,
  variant,
  protection = 'off',
  brandLink = null,
  addOns = false,
  rating = null,
}: {
  product: ProductPageView;
  variant: VariantView;
  protection?: ProtectionMode;
  /** The vendor's brand page, when one exists (resolveBrandLink); otherwise the vendor is plain text. */
  brandLink?: BrandLink | null;
  /**
   * The loader says the rules relate foundations, bases or frames to this product (P4-03, REQ-ADD-001). False renders
   * nothing and asks nothing, which is the case for every product that is not a mattress with add-ons.
   */
  addOns?: boolean;
  /** The product's aggregate rating from the reviews provider, read by the loader; null when reviews are off or empty. */
  rating?: ReviewsAggregate | null;
}) {
  const navigate = useNavigate();
  const {open, type: asideType} = useAside();
  // The choice remembers its variant: switching size forgets it (a plan quoted for one size is never sent for another).
  const [choice, setChoice] = useState<{
    variantId: string;
    planId: string;
  } | null>(null);
  const offers = useProtectionOffers(
    variant.id,
    protection !== 'off' && variant.available,
  );
  const chosenPlan =
    offers.status === 'plans' && choice?.variantId === variant.id
      ? (offers.plans.find((plan) => plan.planId === choice.planId) ?? null)
      : null;
  const selection = selectionOf(variant, product.options);
  const savings = savingsLabel(variant.price, variant.compareAt);
  const attributeBadges = [
    product.comfortLevel,
    product.mattressType,
    ...product.benefits,
  ].flatMap((value) => (value ? [value] : []));

  function choose(optionName: string, value: string) {
    const next = selection.map((choice) =>
      choice.name === optionName ? {name: optionName, value} : choice,
    );
    const resolved = selectVariant(product.variants, next);
    if (!resolved) return;
    void navigate(
      {search: selectionToSearch(selectionOf(resolved, product.options))},
      {replace: true, preventScrollReset: true},
    );
  }

  const panel = (
    <ProtectionPanel
      offers={offers}
      reserveSpace={protection === 'eligible'}
      selectedPlanId={chosenPlan?.planId ?? null}
      onSelect={(planId) =>
        setChoice(planId === null ? null : {variantId: variant.id, planId})
      }
    />
  );

  return (
    // min-w-0: a grid item must be allowed to shrink below its content, or a long unbroken title or option row widens the
    // column and the page scrolls sideways (BV-014).
    <div className="flex min-w-0 flex-col gap-4">
      <div>
        {product.vendor ? (
          <VendorName vendor={product.vendor} brandLink={brandLink} />
        ) : null}
        <h1 className="text-3xl font-bold">{product.title}</h1>
        {/* Only with real reviews from the provider (REQ-PDP-005): nothing renders, and nothing is reserved, otherwise. */}
        {rating ? (
          <Rating
            value={rating.average}
            count={rating.exact ? rating.count : undefined}
            href="#reviews"
            className="mt-1"
          />
        ) : null}
      </div>

      {attributeBadges.length > 0 ? (
        <ul className="flex flex-wrap gap-1">
          {attributeBadges.map((badge) => (
            <li key={badge}>
              <Badge variant="neutral">{badge}</Badge>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Price, saving and stock change together when the size changes, so all three sit in one live region and are
          announced once. The saving is the badge below the price (not Price's own showSavings text), so it is not read twice. */}
      <div aria-live="polite" className="flex flex-col gap-1">
        <Price price={variant.price} compareAt={variant.compareAt} size="lg" />
        {savings ? (
          <div>
            <Badge variant="sale">{savings}</Badge>
          </div>
        ) : null}
        <p className="text-sm text-fg-muted">
          {variant.available ? 'In stock' : 'Sold out'}
          {variant.sku ? ` · SKU ${variant.sku}` : ''}
        </p>
      </div>
      {/* Hidden unless a financing provider is switched on (REQ-CART-005). The amount is the selected variant's Shopify price. */}
      <FinancingMessage placement="product" amount={variant.price} />

      {product.options
        .filter((option) => option.values.length > 1)
        .map((option) => {
          const isSize = toSlug(option.name) === toSlug(SIZE_OPTION_NAME);
          const chosen = selection.find((c) => c.name === option.name);
          return (
            <SizeSelector
              key={option.name}
              legend={option.name}
              name={`option-${toSlug(option.name)}`}
              value={chosen ? toSlug(chosen.value) : null}
              options={option.values.map((value) => ({
                id: toSlug(value),
                label: value,
                dimensions: isSize
                  ? (dimensionsForValue(product.variants, option.name, value) ??
                    undefined)
                  : undefined,
                available: isOptionValueAvailable(
                  product.variants,
                  product.options,
                  selection,
                  option.name,
                  value,
                ),
              }))}
              onChange={(id) => {
                const value = option.values.find((v) => toSlug(v) === id);
                if (value) choose(option.name, value);
              }}
            />
          );
        })}

      {/* Accident protection for the selected size (P5A-05): above the button only when its height is reserved. */}
      {protection === 'eligible' ? panel : null}

      {chosenPlan ? (
        <AddWithProtectionButton
          variantId={variant.id}
          planKey={chosenPlan.planId}
          disabled={!variant.available}
          onClick={() => open('cart')}
        />
      ) : (
        <AddToCartButton
          disabled={!variant.available}
          onClick={() => open('cart')}
          lines={[
            {
              merchandiseId: variant.id,
              quantity: 1,
              selectedVariant: {
                id: variant.id,
                title: variant.title,
                availableForSale: variant.available,
                requiresShipping: true,
                price: variant.price,
                compareAtPrice: variant.compareAt,
                image: variant.image ?? product.images[0] ?? null,
                selectedOptions: [...variant.selectedOptions],
                product: {
                  id: product.id,
                  handle: product.handle,
                  title: product.title,
                  vendor: product.vendor,
                },
              },
            },
          ]}
        >
          {variant.available ? 'Add to cart' : 'Sold out'}
        </AddToCartButton>
      )}
      {protection === 'unknown' ? panel : null}
      {/* Size-matched foundations, bases and frames (P4-03): under the button, above the shared cart messages that report their result. */}
      {addOns ? (
        <ProductAddOns
          productId={product.id}
          mattress={{
            variantId: variant.id,
            size: sizeOf(variant.selectedOptions),
            available: variant.available,
          }}
          onViewCart={() => open('cart')}
        />
      ) : null}
      <CartMessages suppressed={asideType === 'cart'} />
      <CompareToggle handle={product.handle} title={product.title} />

      {/* Delivery promise for the saved ZIP (P5B-03, REQ-DEL-002). Read after load so this page carries no ZIP. */}
      {/* TODO(P5B-03): hide it for products that never ship in-home once the catalog says which (Q-008, CLR-009). */}
      <DeliveryCheck />

      {/* Extension slots, each filled by its own task; they render nothing today. */}
      {/* Store pickup for this size and "my store", and "Try in store" (P3B-10, REQ-PDP-003, REQ-PDP-004). */}
      <PickupSlot variantId={variant.id} productHandle={product.handle} />
    </div>
  );
}
