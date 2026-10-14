// Coverage-line linking rules (REQ-EXT-002, T-06, ADR-0009 decision 2). Pure functions over a minimal cart shape.
//
// A coverage line is a nested child of the covered line. Shopify removes the child when the parent is removed
// (F-26) but does not promise that the child quantity follows the parent, and a direct Storefront API call can add
// a coverage variant alone or attach any attributes. So after every cart change the server asks this module what
// must be done to make the cart valid, applies the operations, and revalidates before hand-off to checkout.
// The module only decides; it never touches Shopify.

import {isPlausiblePlanId, normalizeShopifyId} from '~/lib/extend/ids';
import type {PlanQuote} from '~/lib/extend/types';

/** Our own line-attribute keys (Extend's documentation does not name any; EXTEND.md section 3, item 2). */
export const EXTEND_LINE_ATTRIBUTES = {
  planId: '_extend_plan_id',
  coveredProductId: '_extend_covered_product_id',
  term: '_extend_term',
} as const;

export type CartLineLike = {
  id: string;
  variantId: string;
  productId: string;
  quantity: number;
  parentLineId: string | null;
  attributes: Readonly<Record<string, string>>;
  /** Shopify's unit price for the line. Optional: only used to flag a price that differs from the quoted plan. */
  unitPriceCents?: number;
};

export type RemoveReason =
  | 'no_parent'
  | 'parent_missing'
  | 'parent_is_coverage'
  | 'invalid_parent_quantity'
  | 'invalid_plan_id'
  | 'covered_product_mismatch'
  | 'duplicate_coverage';

export type LinkOperation =
  | {type: 'setQuantity'; lineId: string; quantity: number}
  | {type: 'remove'; lineId: string; reason: RemoveReason};

/** Findings that need a decision but not an automatic cart edit. */
export type LinkFlag = {
  lineId: string;
  reason: 'price_mismatch' | 'plan_unverified' | 'unexpected_extend_attributes';
};

export type LinkingInput = {
  lines: readonly CartLineLike[];
  /** Variant ids of the price-point coverage variants (from the catalog). Only these lines are treated as coverage. */
  coverageVariantIds: ReadonlySet<string>;
  /**
   * Plan id -> quoted price from a fresh Offers response. When given, a coverage line whose Shopify price differs
   * from its plan's quote is flagged. Omit it when no fresh quotes are available (for example Extend is down).
   */
  quotes?: ReadonlyMap<string, PlanQuote>;
};

export type LinkingResult = {
  operations: LinkOperation[];
  flags: LinkFlag[];
};

export type LinkContext = {
  byId: ReadonlyMap<string, CartLineLike>;
  coverageVariantIds: ReadonlySet<string>;
};

export type CoverageValidation =
  {valid: true} | {valid: false; reason: RemoveReason};

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * Structural validity of one coverage line against its parent. Quantity and duplicates are handled by
 * `computeLinkOperations` because they involve other lines.
 */
export function validateCoverageLine(
  line: CartLineLike,
  context: LinkContext,
): CoverageValidation {
  if (line.parentLineId === null) return {valid: false, reason: 'no_parent'};
  const parent = context.byId.get(line.parentLineId);
  if (parent === undefined) return {valid: false, reason: 'parent_missing'};
  if (context.coverageVariantIds.has(parent.variantId)) {
    return {valid: false, reason: 'parent_is_coverage'};
  }
  if (!isPositiveInteger(parent.quantity)) {
    return {valid: false, reason: 'invalid_parent_quantity'};
  }
  const planId = line.attributes[EXTEND_LINE_ATTRIBUTES.planId];
  if (!isPlausiblePlanId(planId))
    return {valid: false, reason: 'invalid_plan_id'};

  // Both sides go through the same normaliser, so "gid://shopify/Product/1" and "1" are the same product, and
  // anything unparseable (empty, injected text) can never match.
  const covered = normalizeShopifyId(
    line.attributes[EXTEND_LINE_ATTRIBUTES.coveredProductId],
  );
  const parentProduct = normalizeShopifyId(parent.productId);
  if (covered === null || parentProduct === null || covered !== parentProduct) {
    return {valid: false, reason: 'covered_product_mismatch'};
  }
  return {valid: true};
}

export function computeLinkOperations(input: LinkingInput): LinkingResult {
  const byId = new Map(input.lines.map((line) => [line.id, line]));
  const context: LinkContext = {
    byId,
    coverageVariantIds: input.coverageVariantIds,
  };
  const operations: LinkOperation[] = [];
  const flags: LinkFlag[] = [];
  const keptByParent = new Map<string, CartLineLike>();

  // Cart order decides which duplicate is kept, so the result is deterministic.
  for (const line of input.lines) {
    const isCoverage = input.coverageVariantIds.has(line.variantId);
    if (!isCoverage) {
      const hasExtendAttribute = Object.keys(line.attributes).some((key) =>
        key.startsWith('_extend_'),
      );
      // Never auto-remove a non-coverage line: it may be the customer's mattress.
      if (hasExtendAttribute) {
        flags.push({lineId: line.id, reason: 'unexpected_extend_attributes'});
      }
      continue;
    }

    const validation = validateCoverageLine(line, context);
    if (!validation.valid) {
      operations.push({
        type: 'remove',
        lineId: line.id,
        reason: validation.reason,
      });
      continue;
    }

    // validateCoverageLine guarantees a parent id that resolves to a line.
    const parentId = line.parentLineId;
    const parent = parentId === null ? undefined : byId.get(parentId);
    if (parentId === null || parent === undefined) continue;

    if (keptByParent.has(parentId)) {
      operations.push({
        type: 'remove',
        lineId: line.id,
        reason: 'duplicate_coverage',
      });
      continue;
    }
    keptByParent.set(parentId, line);

    if (line.quantity !== parent.quantity) {
      operations.push({
        type: 'setQuantity',
        lineId: line.id,
        quantity: parent.quantity,
      });
    }

    const flag = priceFlag(line, input.quotes);
    if (flag !== null) flags.push(flag);
  }

  return {operations, flags};
}

function priceFlag(
  line: CartLineLike,
  quotes: ReadonlyMap<string, PlanQuote> | undefined,
): LinkFlag | null {
  if (quotes === undefined || line.unitPriceCents === undefined) return null;
  const planId = line.attributes[EXTEND_LINE_ATTRIBUTES.planId];
  const quote = planId === undefined ? undefined : quotes.get(planId);
  if (quote === undefined) return {lineId: line.id, reason: 'plan_unverified'};
  return quote.priceCents === line.unitPriceCents
    ? null
    : {lineId: line.id, reason: 'price_mismatch'};
}

/** True when the cart needs no edits and nothing is flagged: safe to hand off to checkout. */
export function isCartLinkingClean(result: LinkingResult): boolean {
  return result.operations.length === 0 && result.flags.length === 0;
}
