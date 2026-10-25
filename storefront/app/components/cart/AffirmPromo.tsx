import {useEffect, useSyncExternalStore} from 'react';
import {consentHandle} from '~/lib/analytics/gate';
import {loadAffirm, refreshAffirm} from '~/lib/financing/affirm';

export type AffirmPlacement = 'product' | 'cart';

export type AffirmPromoProps = {
  publicKey: string;
  sandbox: boolean;
  requiresConsent: boolean;
  placement: AffirmPlacement;
  /** The Shopify amount in USD cents. */
  amountCents: number;
};

/**
 * Affirm's "as low as" element (P4-08, REQ-CART-005). This is the lazy chunk: it is requested only when the store has set
 * PUBLIC_FINANCING_PROVIDER=affirm and a public key. The monthly figure is drawn by Affirm.js from the Shopify amount we
 * pass in cents; nothing is calculated here (SD-11). With consent required (the default) nothing renders and no script
 * is requested until the shopper has allowed the `analytics` category, the chat's rule. Withdrawing consent hides the
 * element at once; Affirm.js, once loaded, stays in the page until the next full load.
 */
export function AffirmPromo({
  publicKey,
  sandbox,
  requiresConsent,
  placement,
  amountCents,
}: AffirmPromoProps) {
  useSyncExternalStore(
    consentHandle.subscribe,
    consentHandle.getVersion,
    consentHandle.getServerVersion,
  );
  const allowed =
    !requiresConsent ||
    consentHandle.getStore()?.getSnapshot().choice.analytics === true;

  useEffect(() => {
    if (allowed) loadAffirm({publicKey, sandbox});
  }, [allowed, publicKey, sandbox]);

  useEffect(() => {
    if (allowed) refreshAffirm();
  }, [allowed, amountCents]);

  if (!allowed) return null;
  return (
    <p
      className="affirm-as-low-as text-sm text-fg"
      data-page-type={placement}
      data-amount={amountCents}
    />
  );
}
