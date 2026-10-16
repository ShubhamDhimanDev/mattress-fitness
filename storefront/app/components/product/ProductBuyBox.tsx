import {useState} from 'react';
import {useNavigate} from 'react-router';
import {AddToCartButton} from '~/components/AddToCartButton';
import {useAside} from '~/components/Aside';
import {CartMessages} from '~/components/cart/CartMessages';
import {CompareToggle} from '~/components/compare/CompareToggle';
import {DeliveryCheck} from '~/components/delivery/DeliveryCheck';
import {AddWithProtectionButton} from '~/components/extend/AddWithProtectionButton';
import {ProtectionPanel} from '~/components/extend/ProtectionPanel';
import {VendorName} from '~/components/product/VendorName';
import {useProtectionOffers} from '~/components/extend/useProtectionOffers';
import {Badge} from '~/components/ui/Badge';
import {Price} from '~/components/ui/Price';
import {SizeSelector} from '~/components/ui/SizeSelector';
import {SIZE_OPTION_NAME, toSlug} from '~/lib/catalog/attributes';
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
}: {
  product: ProductPageView;
  variant: VariantView;
  protection?: ProtectionMode;
  /** The vendor's brand page, when one exists (resolveBrandLink); otherwise the vendor is plain text. */
  brandLink?: BrandLink | null;
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
    <div className="flex flex-col gap-4">
      <div>
        {product.vendor ? (
          <VendorName vendor={product.vendor} brandLink={brandLink} />
        ) : null}
        <h1 className="text-3xl font-bold">{product.title}</h1>
        {/* TODO(P3B-12): star rating and review count render here once a reviews provider is chosen (Q-011). */}
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

      <div aria-live="polite" className="flex flex-col gap-1">
        <Price
          price={variant.price}
          compareAt={variant.compareAt}
          showSavings
          size="lg"
        />
        {savings ? <Badge variant="sale">{savings}</Badge> : null}
        <p className="text-sm text-fg-muted">
          {variant.available ? 'In stock' : 'Sold out'}
          {variant.sku ? ` · SKU ${variant.sku}` : ''}
        </p>
      </div>

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
      <CartMessages suppressed={asideType === 'cart'} />
      <CompareToggle handle={product.handle} title={product.title} />

      {/* Delivery promise for the saved ZIP (P5B-03, REQ-DEL-002). Read after load so this page carries no ZIP. */}
      {/* TODO(P5B-03): hide it for products that never ship in-home once the catalog says which (Q-008, CLR-009). */}
      <DeliveryCheck />

      {/* Extension slots, each filled by its own task; they render nothing today. */}
      {/* TODO(P3B-10): store pickup availability and "try in store" (REQ-PDP-003, REQ-PDP-004). */}
      {/* TODO(P4-03): size-matched foundations, bases and frames (REQ-ADD-001). */}
    </div>
  );
}
