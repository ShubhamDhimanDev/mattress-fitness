import {Suspense, lazy, useSyncExternalStore, type ComponentType} from 'react';
import type {
  AffirmPlacement,
  AffirmPromoProps,
} from '~/components/cart/AffirmPromo';
import {cn} from '~/components/ui/cn';
import {
  SHOP_PAY_INSTALLMENTS_COPY,
  type PublicFinancingConfig,
} from '~/lib/financing/config';
import {toCents, type MoneyV2Like} from '~/lib/format';

// A chunk that fails to download hides the message and nothing else (NFR-013).
const Nothing: ComponentType<AffirmPromoProps> = () => null;
const AffirmPromo = lazy(
  (): Promise<{default: ComponentType<AffirmPromoProps>}> =>
    import('~/components/cart/AffirmPromo').then(
      (module) => ({default: module.AffirmPromo}),
      () => ({default: Nothing}),
    ),
);

const never = () => () => {};

/** Shopify's decimal amount in USD cents, or null when it is missing, not USD or not a plain amount. */
function usdCents(amount: MoneyV2Like | null | undefined): number | null {
  if (!amount || amount.currencyCode !== 'USD') return null;
  try {
    return toCents(amount.amount);
  } catch {
    return null;
  }
}

/**
 * What the financing slot shows for a configured provider (P4-08, REQ-CART-005). A lazy chunk of its own, requested only
 * when the store has switched a provider on, so the cart and product routes carry just the small shell
 * (`FinancingMessage`). Shop Pay Installments and the store card are plain wording; Affirm draws its own figure.
 */
export function FinancingContent({
  config,
  placement,
  amount,
  className,
}: {
  config: PublicFinancingConfig;
  placement: AffirmPlacement;
  amount?: MoneyV2Like | null | undefined;
  className?: string | undefined;
}) {
  // Affirm's element is client-only: the server render has no consent answer and no script.
  const onClient = useSyncExternalStore(
    never,
    () => true,
    () => false,
  );

  switch (config.provider) {
    case 'shop-pay-installments':
      return (
        <p className={cn('text-sm text-fg-muted', className)}>
          {SHOP_PAY_INSTALLMENTS_COPY}
        </p>
      );
    case 'store-card':
      return (
        <p className={cn('text-sm text-fg-muted', className)}>{config.text}</p>
      );
    case 'affirm': {
      const cents = usdCents(amount);
      if (!onClient || cents === null || cents <= 0) return null;
      return (
        <div className={className}>
          <Suspense fallback={null}>
            <AffirmPromo
              publicKey={config.publicKey}
              sandbox={config.sandbox}
              requiresConsent={config.requiresConsent}
              placement={placement}
              amountCents={cents}
            />
          </Suspense>
        </div>
      );
    }
    default: {
      const unreachable: never = config;
      return unreachable;
    }
  }
}
