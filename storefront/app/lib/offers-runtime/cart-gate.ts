// SERVER ONLY. The cart gate as the routes call it: `revalidateCartOffers` (server.ts) plus what needs Shopify's
// PRICES on the cart (P4-04 to P4-06):
//  - a gift line that Shopify does not price at 0 pauses checkout (REQ-PROMO-001, T-02), because the promotion that
//    makes it a gift is not applying and the shopper would pay for it;
//  - bundle offers for the anchors in the cart, with the saving READ from the discount allocations Shopify put on the
//    cart lines. Nothing is computed from the rule or from the browser, and a complete bundle with no reported
//    saving is not shown (V-03: whether a discount exists on the store is unverified).
// The picker actions (picker-steps.ts) use this same function, so what is offered and what is accepted agree.

import type {CartApiQueryFragment} from 'storefrontapi.generated';
import {toCents} from '~/lib/money';
import {bundleCompletions} from '~/lib/offers/bundles';
import {giftLinesNotFree, type LineTotals} from '~/lib/offers/gift-price';
import type {CartLike, OfferRules} from '~/lib/offers/types';
import {toCartLike} from '~/lib/shopify/cart-mapper';
import {giftPickerEnabled, offerRulesOf} from './config';
import {loadOfferedVariants} from './facts';
import {giftNotFreeReason} from './messages';
import {
  revalidateCartOffers,
  type OfferRuntime,
  type OffersResult,
} from './server';
import type {BundleOfferView} from './view';

/** The gate's answer plus the rules it judged by. `rules` stays on the server: routes return only `view`. */
export type GateResult = OffersResult & {readonly rules: OfferRules};

type CartNode = CartApiQueryFragment['lines']['nodes'][number];

function centsOf(amount: string | undefined): number | null {
  if (amount === undefined) return null;
  try {
    return toCents(amount);
  } catch {
    return null;
  }
}

/** What Shopify charges per line after line-level discounts. A line whose cost cannot be read has no entry. */
export function lineTotalsOf(cart: CartApiQueryFragment): LineTotals {
  const totals = new Map<string, number>();
  for (const node of cart.lines.nodes) {
    const cents = centsOf(node.cost?.totalAmount?.amount);
    if (cents !== null) totals.set(node.id, cents);
  }
  return totals;
}

function sameTitle(a: string, b: string): boolean {
  const normal = (text: string) =>
    text.trim().replace(/\s+/g, ' ').toLowerCase();
  return normal(a) === normal(b);
}

/**
 * What Shopify's AUTOMATIC discount with this title took off one line. A code discount and an automatic discount with
 * another title are somebody else's saving (a sitewide sale, a code the shopper typed) and never count as the bundle's.
 */
function lineSavingsOf(node: CartNode, discountTitle: string): number {
  let total = 0;
  for (const allocation of node.discountAllocations ?? []) {
    // Only an automatic discount carries a title; a code allocation carries a code and is never the bundle's.
    if (
      !('title' in allocation) ||
      allocation.targetType !== 'LINE_ITEM' ||
      !sameTitle(allocation.title, discountTitle)
    ) {
      continue;
    }
    const cents = centsOf(allocation.discountedAmount.amount);
    if (cents !== null) total += cents;
  }
  return total;
}

/**
 * Shopify's saving on the lines of one bundle (REQ-PROMO-002): the anchor line and every line holding a companion
 * variant, counting only the automatic discount the rule names (`discountTitle`). No title, no figure. A line already
 * in `counted` (a companion shared by two anchors of the same bundle) is not counted again; the caller passes one set
 * per bundle rule.
 */
export function bundleSavingsCents(
  cart: CartApiQueryFragment,
  anchorLineId: string,
  memberVariantIds: readonly string[],
  discountTitle: string | undefined,
  counted: Set<string>,
): number {
  if (discountTitle === undefined) return 0;
  const members = new Set(memberVariantIds);
  let total = 0;
  for (const node of cart.lines.nodes) {
    const variantId = node.merchandise?.id;
    const inBundle =
      node.id === anchorLineId || (variantId && members.has(variantId));
    if (!inBundle || counted.has(node.id)) continue;
    counted.add(node.id);
    total += lineSavingsOf(node, discountTitle);
  }
  return total;
}

function formatAmount(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

async function bundleViews(
  runtime: OfferRuntime,
  cart: CartApiQueryFragment,
  mapped: CartLike,
  rules: OfferRules,
): Promise<BundleOfferView[]> {
  if (rules.bundles.length === 0) return [];
  const completions = rules.bundles.flatMap((bundle) =>
    bundleCompletions(bundle, mapped, rules),
  );
  const missingIds = completions.flatMap((completion) =>
    completion.state === 'incomplete'
      ? completion.missing.map((line) => line.variantId)
      : [],
  );
  const variants = await loadOfferedVariants(runtime.storefront, missingIds);

  const views: BundleOfferView[] = [];
  const countedByBundle = new Map<string, Set<string>>();
  for (const completion of completions) {
    const bundle = rules.bundles.find(({id}) => id === completion.bundleId);
    const anchor = cart.lines.nodes.find(
      (node) => node.id === completion.anchorLineId,
    );
    if (!bundle || !anchor) continue;
    const base = {
      bundleId: bundle.id,
      name: bundle.name,
      anchorLineId: anchor.id,
      anchorTitle: anchor.merchandise?.product?.title ?? bundle.name,
    };
    if (completion.state === 'incomplete') {
      const missing = completion.missing.flatMap((line) => {
        const variant = variants.get(line.variantId);
        return variant ? [{variant, quantity: line.quantity}] : [];
      });
      // All or nothing: a set with one companion sold out would not earn the saving.
      if (missing.length === completion.missing.length) {
        views.push({...base, status: 'incomplete', missing, savings: null});
      }
    } else if (completion.state === 'complete') {
      const counted = countedByBundle.get(bundle.id) ?? new Set<string>();
      countedByBundle.set(bundle.id, counted);
      const cents = bundleSavingsCents(
        cart,
        completion.anchorLineId,
        completion.memberVariantIds,
        bundle.discountTitle,
        counted,
      );
      if (cents > 0) {
        views.push({
          ...base,
          status: 'complete',
          missing: [],
          savings: {amount: formatAmount(cents), currencyCode: 'USD'},
        });
      }
    }
  }
  return views;
}

export type GateOptions = {
  /**
   * False skips the bundle offers and their extra Storefront lookup. The gift and add-on accept actions judge the cart
   * first and have no use for bundles (K-L8: fewer reads per POST).
   */
  readonly bundles?: boolean;
};

export async function revalidateCartGate(
  runtime: OfferRuntime,
  current: CartApiQueryFragment | null,
  options: GateOptions = {},
): Promise<GateResult> {
  const offers = await revalidateCartOffers(runtime, current);
  const rules = offerRulesOf(runtime.env);
  const {cart, check, view} = offers;
  // No cart, or one that could not be judged (no repairs, no offers, checkout already withheld): nothing to add.
  if (!cart || !check || !view) return {...offers, rules};

  const mapped = toCartLike(cart);
  const notFree = giftLinesNotFree(mapped, rules, lineTotalsOf(cart));
  const blocked =
    notFree.length > 0
      ? [...check.blocked, giftNotFreeReason(notFree)]
      : check.blocked;
  const bundles =
    options.bundles === false
      ? []
      : await bundleViews(runtime, cart, mapped, rules);
  // The gift picker waits for V-03 (config.ts giftPickerEnabled). The price check above still judges any gift line that
  // is already in the cart, so a gift added some other way is never waved through.
  const gifts = giftPickerEnabled(runtime.env) ? view.gifts : [];
  return {
    ...offers,
    rules,
    check: notFree.length > 0 ? {...check, status: 'blocked', blocked} : check,
    view: {...view, blocked, bundles, gifts},
  };
}
