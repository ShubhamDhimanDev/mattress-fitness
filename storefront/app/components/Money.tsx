import {formatMoney, type MoneyV2Like} from '~/lib/format';

/**
 * A price as text, through the shared USD formatter (NFR-008). Replaces Hydrogen's `<Money>`, which the 2026.10 library
 * no longer ships (ADR-0012). Takes a structural money value, so Storefront and Customer Account money both fit.
 */
export function Money({data}: {data: MoneyV2Like | null | undefined}) {
  if (!data) return null;
  return <span>{formatMoney(data)}</span>;
}
