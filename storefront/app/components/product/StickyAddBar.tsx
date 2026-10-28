import {Button} from '~/components/ui/Button';
import {Price} from '~/components/ui/Price';
import type {MoneyV2Like} from '~/lib/format';

/**
 * The phone's bottom bar with the price and an Add to cart button, shown only while the main button is out of view (the
 * parent decides, see useStickyAddBar). It owns no cart logic: pressing it calls `onPress`, which the buy box wires to a click
 * on the main button, so the same form, validation, size, protection choice and drawer behaviour apply. Mounted only while
 * shown, so a hidden bar is never in the tab order. `lg:hidden`: from 1024 px the buy box sits beside the gallery.
 * Motion: none. The bar appears and disappears without animation, which is also the reduced-motion behaviour.
 */
export function StickyAddBar({
  productTitle,
  price,
  compareAt,
  label,
  disabled,
  onPress,
}: {
  productTitle: string;
  price: MoneyV2Like;
  compareAt: MoneyV2Like | null;
  /** The same wording as the main button ("Add to cart", "Add with protection", "Sold out"). */
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <div
      role="region"
      aria-label={`Quick add to cart for ${productTitle}`}
      className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-line bg-surface px-4 py-3 shadow-lift lg:hidden"
    >
      <Price
        price={price}
        compareAt={compareAt}
        size="md"
        className="min-w-0"
      />
      <Button
        type="button"
        size="md"
        className="shrink-0"
        disabled={disabled}
        onClick={onPress}
      >
        {label}
      </Button>
    </div>
  );
}
