import {Suspense, lazy, type ComponentType} from 'react';
import {useRouteLoaderData} from 'react-router';
import type {AffirmPlacement} from '~/components/cart/AffirmPromo';
import type {MoneyV2Like} from '~/lib/format';
import type {RootLoader} from '~/root';

type ContentProps = Parameters<
  typeof import('~/components/cart/FinancingContent').FinancingContent
>[0];

// A chunk that fails to download hides the message and nothing else (NFR-013).
const Nothing: ComponentType<ContentProps> = () => null;
const FinancingContent = lazy(
  (): Promise<{default: ComponentType<ContentProps>}> =>
    import('~/components/cart/FinancingContent').then(
      (module) => ({default: module.FinancingContent}),
      () => ({default: Nothing}),
    ),
);

/**
 * The financing message slot (P4-08, REQ-CART-005): the cart drawer, the cart page and the product page's price area.
 * It renders NOTHING unless the store has switched a provider on (PUBLIC_FINANCING_PROVIDER, exact match), so a store
 * whose financing is not activated (CLR-007, CLR-008, Q-016) shows no promise about it, requests no code and no script.
 * This is only the shell, kept tiny because the cart and product routes carry it; the wording and the Affirm element
 * are lazy chunks (`FinancingContent`, `AffirmPromo`). No monthly figure is computed anywhere (SD-11). Wording is
 * placeholder copy until the client approves it (docs/integrations/FINANCING.md).
 */
export function FinancingMessage({
  placement,
  amount,
  className,
}: {
  placement: AffirmPlacement;
  /** The Shopify price this message sits beside (product price or cart subtotal). Used only by Affirm, as cents. */
  amount?: MoneyV2Like | null | undefined;
  className?: string;
}) {
  const config = useRouteLoaderData<RootLoader>('root')?.financing ?? null;
  if (config === null) return null;
  return (
    <Suspense fallback={null}>
      <FinancingContent
        config={config}
        placement={placement}
        amount={amount}
        className={className}
      />
    </Suspense>
  );
}
