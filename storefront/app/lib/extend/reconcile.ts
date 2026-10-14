// Reconciliation of Shopify orders against what Extend holds (REQ-EXT-003, T-03, T-06). Pure: the caller (the
// reconcile script) supplies both sides; this module only compares them and reports mismatches for staff.
//
// ASSUMPTION(V-11): Extend documents no way to read orders back. The Extend side is whatever the caller can
// obtain: the mock's state today, a Merchant Portal export or an API read once Extend confirms one exists.

import {normalizeShopifyId} from '~/lib/extend/ids';
import {
  buildOrderSnapshot,
  type ExtendContractLine,
  type ExtendLineItem,
  type ExtendOrderSnapshot,
  type FlagReason,
  type ShopifyOrderLike,
} from '~/lib/extend/orders';
import type {PlanQuote} from '~/lib/extend/types';

export type ExtendStoredOrder = {
  /** The order as Extend holds it (the last full snapshot it accepted). */
  snapshot: ExtendOrderSnapshot;
  /** Contracts Extend has issued for the order's lines. */
  contracts: ReadonlyArray<{lineItemTransactionId: string; contractId: string}>;
};

export type ReconcileKind =
  | 'missing_sync'
  | 'unexpected_extend_order'
  | 'orphan_coverage'
  | 'price_mismatch'
  | 'quantity_mismatch'
  | 'status_mismatch'
  | 'contract_missing'
  | 'flagged_coverage'
  | 'invalid_order';

const KINDS: readonly ReconcileKind[] = [
  'missing_sync',
  'unexpected_extend_order',
  'orphan_coverage',
  'price_mismatch',
  'quantity_mismatch',
  'status_mismatch',
  'contract_missing',
  'flagged_coverage',
  'invalid_order',
];

/** Ids and short reasons only: reports are shared with staff and must carry no personal data (T-05). */
export type ReconcileIssue = {
  kind: ReconcileKind;
  orderId: string;
  lineId?: string;
  planId?: string;
  detail: string;
};

export type ReconcileReport = {
  checkedOrders: number;
  issues: ReconcileIssue[];
  summary: Record<ReconcileKind, number>;
  clean: boolean;
};

export type ReconcileOptions = {
  storeId: string;
  /** Verified quotes for one order, keyed by coverage line id (see listQuoteQueries in orders.ts). */
  quotesForOrder: (
    order: ShopifyOrderLike,
  ) => ReadonlyMap<string, PlanQuote | null>;
};

function isContractLine(line: ExtendLineItem): line is ExtendContractLine {
  return 'type' in line && line.type === 'category_contract';
}

function coveredQuantity(line: ExtendContractLine): number {
  return line.coveredProducts.reduce((sum, item) => sum + item.quantity, 0);
}

function coverageLineId(contractTransactionId: string): string {
  return contractTransactionId.replace(/-contract$/, '');
}

function kindForFlag(reason: FlagReason): ReconcileKind {
  switch (reason) {
    case 'covered_product_missing':
    case 'covered_product_mismatch':
    case 'covered_product_ambiguous':
    case 'covered_product_ineligible':
      return 'orphan_coverage';
    case 'price_mismatch':
      return 'price_mismatch';
    case 'invalid_plan_id':
    case 'invalid_covered_product_id':
    case 'duplicate_coverage':
    case 'unknown_plan':
      return 'flagged_coverage';
    default: {
      const unreachable: never = reason;
      return unreachable;
    }
  }
}

export function reconcile(
  shopifyOrders: readonly ShopifyOrderLike[],
  extendOrders: readonly ExtendStoredOrder[],
  options: ReconcileOptions,
): ReconcileReport {
  const issues: ReconcileIssue[] = [];
  const stored = new Map(
    extendOrders.map((record) => [record.snapshot.transactionId, record]),
  );
  const matched = new Set<string>();

  for (const order of shopifyOrders) {
    const built = buildOrderSnapshot(order, {
      storeId: options.storeId,
      quotesByLineId: options.quotesForOrder(order),
    });
    if (built.status === 'error') {
      const invalidId = normalizeShopifyId(order.id);
      // Reported once as invalid; do not also report Extend's copy as unexpected.
      if (invalidId !== null) matched.add(invalidId);
      issues.push({
        kind: 'invalid_order',
        orderId: invalidId ?? 'unknown',
        detail: built.detail,
      });
      continue;
    }

    const orderId = built.snapshot.transactionId;
    for (const flag of built.flagged) {
      issues.push({
        kind: kindForFlag(flag.reason),
        orderId,
        lineId: flag.lineId,
        detail: `coverage line flagged: ${flag.reason}`,
      });
    }
    for (const warning of built.warnings) {
      issues.push({
        kind: 'quantity_mismatch',
        orderId,
        lineId: warning.lineId,
        detail: 'coverage quantity differs from covered item quantity',
      });
    }

    const record = stored.get(orderId);
    const expectedContracts = built.snapshot.lineItems.filter(isContractLine);
    if (record === undefined) {
      if (expectedContracts.length > 0) {
        issues.push({
          kind: 'missing_sync',
          orderId,
          detail: `Shopify order has ${expectedContracts.length} coverage line(s) but Extend has no order`,
        });
      }
      continue;
    }
    matched.add(orderId);

    const expectedStatus = built.snapshot.status ?? null;
    const storedStatus = record.snapshot.status ?? null;
    if (expectedStatus !== storedStatus) {
      issues.push({
        kind: 'status_mismatch',
        orderId,
        detail: `Shopify says ${expectedStatus ?? 'active'}, Extend says ${storedStatus ?? 'active'}`,
      });
    }

    const storedContracts = new Map(
      record.snapshot.lineItems
        .filter(isContractLine)
        .map((line) => [line.lineItemTransactionId, line]),
    );
    const issued = new Set(
      record.contracts.map((contract) => contract.lineItemTransactionId),
    );

    for (const expected of expectedContracts) {
      const lineId = coverageLineId(expected.lineItemTransactionId);
      const actual = storedContracts.get(expected.lineItemTransactionId);
      if (actual === undefined) {
        issues.push({
          kind: 'missing_sync',
          orderId,
          lineId,
          planId: expected.plan.id,
          detail: "coverage line is not in Extend's copy of the order",
        });
        continue;
      }
      if (
        actual.plan.id !== expected.plan.id ||
        actual.plan.purchasePrice !== expected.plan.purchasePrice
      ) {
        issues.push({
          kind: 'price_mismatch',
          orderId,
          lineId,
          planId: expected.plan.id,
          detail: `Shopify ${expected.plan.id} at ${expected.plan.purchasePrice}, Extend ${actual.plan.id} at ${actual.plan.purchasePrice}`,
        });
      }
      if (coveredQuantity(actual) !== coveredQuantity(expected)) {
        issues.push({
          kind: 'quantity_mismatch',
          orderId,
          lineId,
          planId: expected.plan.id,
          detail: `Shopify covers ${coveredQuantity(expected)}, Extend covers ${coveredQuantity(actual)}`,
        });
      }
      // A refunded order has its contracts refunded, not issued, so the missing-contract check does not apply.
      if (
        expected.fulfilledQuantity > 0 &&
        expectedStatus !== 'refunded' &&
        !issued.has(expected.lineItemTransactionId)
      ) {
        issues.push({
          kind: 'contract_missing',
          orderId,
          lineId,
          planId: expected.plan.id,
          detail:
            'covered item is fulfilled in Shopify but Extend issued no contract',
        });
      }
    }

    const expectedIds = new Set(
      expectedContracts.map((line) => line.lineItemTransactionId),
    );
    for (const [id, actual] of storedContracts) {
      if (!expectedIds.has(id)) {
        issues.push({
          kind: 'orphan_coverage',
          orderId,
          lineId: coverageLineId(id),
          planId: actual.plan.id,
          detail: 'Extend holds a coverage line that Shopify does not report',
        });
      }
    }
  }

  for (const [orderId] of stored) {
    if (!matched.has(orderId)) {
      issues.push({
        kind: 'unexpected_extend_order',
        orderId,
        detail:
          'Extend has an order that is not among the Shopify orders checked',
      });
    }
  }

  issues.sort(
    (a, b) =>
      a.orderId.localeCompare(b.orderId) ||
      KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) ||
      (a.lineId ?? '').localeCompare(b.lineId ?? ''),
  );
  const count = (kind: ReconcileKind): number =>
    issues.filter((issue) => issue.kind === kind).length;
  const summary: Record<ReconcileKind, number> = {
    missing_sync: count('missing_sync'),
    unexpected_extend_order: count('unexpected_extend_order'),
    orphan_coverage: count('orphan_coverage'),
    price_mismatch: count('price_mismatch'),
    quantity_mismatch: count('quantity_mismatch'),
    status_mismatch: count('status_mismatch'),
    contract_missing: count('contract_missing'),
    flagged_coverage: count('flagged_coverage'),
    invalid_order: count('invalid_order'),
  };
  return {
    checkedOrders: shopifyOrders.length,
    issues,
    summary,
    clean: issues.length === 0,
  };
}
