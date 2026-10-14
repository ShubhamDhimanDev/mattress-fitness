import {useNavigate} from 'react-router';
import {AddToCartButton} from '~/components/AddToCartButton';
import {useAside} from '~/components/Aside';
import {CartMessages} from '~/components/cart/CartMessages';
import {CompareToggle} from '~/components/compare/CompareToggle';
import {DeliveryCheck} from '~/components/delivery/DeliveryCheck';
import {Badge} from '~/components/ui/Badge';
import {Price} from '~/components/ui/Price';
import {SizeSelector} from '~/components/ui/SizeSelector';
import {SIZE_OPTION_NAME, toSlug} from '~/lib/catalog/attributes';
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
 */
export function ProductBuyBox({
  product,
  variant,
}: {
  product: ProductPageView;
  variant: VariantView;
}) {
  const navigate = useNavigate();
  const {open} = useAside();
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

  return (
    <div className="flex flex-col gap-4">
      <div>
        {product.vendor ? (
          <p className="text-sm font-bold tracking-wide text-fg-muted uppercase">
            {product.vendor}
          </p>
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
      <CartMessages />
      <CompareToggle handle={product.handle} title={product.title} />

      {/* Delivery promise for the saved ZIP (P5B-03, REQ-DEL-002). Read after load so this page carries no ZIP. */}
      {/* TODO(P5B-03): hide it for products that never ship in-home once the catalog says which (Q-008, CLR-009). */}
      <DeliveryCheck />

      {/* Extension slots, each filled by its own task; they render nothing today. */}
      {/* TODO(P3B-10): store pickup availability and "try in store" (REQ-PDP-003, REQ-PDP-004). */}
      {/* TODO(P4-03): size-matched foundations, bases and frames (REQ-ADD-001). */}
      {/* TODO(P5A-05): accident-protection offer for the selected size (REQ-EXT-001). */}
    </div>
  );
}
