// The summary the detective report script prints and the tests check (P5B-05). Pure: results in, counts and a list of
// the orders that need a person out. Ids and codes only (T-05).

import type {
  DetectiveResult,
  OrderViolation,
  UnjudgedReason,
  ViolationCode,
} from '~/lib/detective/types';

export type DetectiveFinding = {
  readonly orderId: string;
  readonly status: 'violations' | 'unjudgeable';
  readonly violations: readonly OrderViolation[];
  readonly unjudged: readonly UnjudgedReason[];
};

export type DetectiveReport = {
  readonly checkedOrders: number;
  readonly counts: {
    readonly clean: number;
    readonly violations: number;
    readonly unjudgeable: number;
  };
  /** Orders per violation code (an order with two codes counts once under each); codes with no order are left out. */
  readonly byCode: readonly {
    readonly code: ViolationCode;
    readonly orders: number;
  }[];
  /** Orders per unjudged reason; reasons with no order are left out. */
  readonly unjudgedByReason: readonly {
    readonly reason: UnjudgedReason;
    readonly orders: number;
  }[];
  /** Only the orders that need a person, in the order they were checked. */
  readonly findings: readonly DetectiveFinding[];
  /** True only when every checked order was judged and none had a violation. Unjudged is never clean. */
  readonly clean: boolean;
};

export function summarizeResults(
  results: readonly DetectiveResult[],
): DetectiveReport {
  const byCode = new Map<ViolationCode, number>();
  const unjudgedByReason = new Map<UnjudgedReason, number>();
  const counts = {clean: 0, violations: 0, unjudgeable: 0};
  const findings: DetectiveFinding[] = [];

  for (const result of results) {
    if (result.status === 'clean') {
      counts.clean += 1;
      continue;
    }
    if (result.status === 'violations') counts.violations += 1;
    else counts.unjudgeable += 1;
    for (const violation of result.violations) {
      byCode.set(violation.code, (byCode.get(violation.code) ?? 0) + 1);
    }
    for (const reason of result.unjudged) {
      unjudgedByReason.set(reason, (unjudgedByReason.get(reason) ?? 0) + 1);
    }
    findings.push({
      orderId: result.orderId,
      status: result.status,
      violations: result.violations,
      unjudged: result.unjudged,
    });
  }
  return {
    checkedOrders: results.length,
    counts,
    byCode: [...byCode].map(([code, orders]) => ({code, orders})),
    unjudgedByReason: [...unjudgedByReason].map(([reason, orders]) => ({
      reason,
      orders,
    })),
    findings,
    clean: findings.length === 0,
  };
}
