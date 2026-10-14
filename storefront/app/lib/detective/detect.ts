// The detective order check (P5B-05, ADR-0006 decision 3). Pure: an order that already exists in, rules and the zone in,
// a list of rule violations out. No I/O, no clock, no node:* imports, no personal data in the result.
//
// Why it exists: the cart gate (offers/, offers-runtime/) cannot see a cart built by calling Shopify's public Storefront
// API directly, and it cannot see the delivery address typed inside Shopify's hosted checkout (security review E-M3).
// The same offer engine therefore judges the order after the fact, so "the gate said yes" and "the order complies" use
// one definition of each rule. Corrections the engine would have made become violations here.
//
// Fail closed: an order or a part of it that cannot be judged is reported as unjudged, never as clean.

import type {DeliveryZone} from '~/lib/delivery/zone';
import type {
  DetectiveConfig,
  DetectiveOrder,
  DetectiveResult,
  OrderViolation,
  UnjudgedReason,
  ViolationCode,
} from '~/lib/detective/types';
import {VIOLATION_CODES} from '~/lib/detective/types';
import {normalizeShopifyId} from '~/lib/extend/ids';
import {
  crossCheckCoverage,
  isCoverageOrderLine,
  listQuoteQueries,
  type FlagReason,
} from '~/lib/extend/orders';
import type {PlanQuote} from '~/lib/extend/types';
import {parseOfferAttributes} from '~/lib/offers/attributes';
import {evaluateOffers} from '~/lib/offers/evaluate';
import {limitOrZero} from '~/lib/offers/helpers';
import {prepareCart} from '~/lib/offers/lines';
import type {
  CartLike,
  CartLineLike,
  Correction,
  OfferRules,
  Violation,
} from '~/lib/offers/types';

/** Same bound as the Extend snapshot builder (orders.ts MAX_LINES); a bigger order is refused, not sampled. */
const MAX_LINES = 500;

/**
 * Handed to the zone check when the shipping address is outside the US or has no country. `parseZip` rejects it, so a
 * German postcode such as 60645 can never be mistaken for a Chicago ZIP in the zone.
 */
const UNUSABLE_ZIP = 'not-a-us-zip';

type Findings = {
  readonly found: Map<ViolationCode, string[]>;
  readonly unjudged: Set<UnjudgedReason>;
};

function newFindings(): Findings {
  return {found: new Map(), unjudged: new Set()};
}

function note(
  findings: Findings,
  code: ViolationCode,
  lineIds: readonly string[],
): void {
  const existing = findings.found.get(code) ?? [];
  for (const id of lineIds) if (!existing.includes(id)) existing.push(id);
  findings.found.set(code, existing);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function assemble(orderId: string, findings: Findings): DetectiveResult {
  // Fixed code order, so the same order always yields the same result (stable logs and report diffs).
  const violations: OrderViolation[] = VIOLATION_CODES.flatMap((code) => {
    const lineIds = findings.found.get(code);
    return lineIds === undefined ? [] : [{code, lineIds}];
  });
  const unjudged = [...findings.unjudged];
  if (violations.length > 0) {
    return {status: 'violations', orderId, violations, unjudged};
  }
  if (unjudged.length > 0) {
    return {status: 'unjudgeable', orderId, violations: [], unjudged};
  }
  return {status: 'clean', orderId, violations: [], unjudged: []};
}

/** An order that could not even be read: counted by the report, never "ok". */
export function unreadableOrderResult(orderId: string): DetectiveResult {
  return {
    status: 'unjudgeable',
    orderId: normalizeShopifyId(orderId) ?? 'unknown',
    violations: [],
    unjudged: ['order_unreadable'],
  };
}

// ---------------------------------------------------------------------------------------------------
// Cart view of the order (the shape the offer engine reads)
// ---------------------------------------------------------------------------------------------------

function isTerminal(input: DetectiveOrder): boolean {
  const {order} = input;
  return (
    order.refundState === 'full' ||
    (order.cancelledAt !== null && order.cancelledAt !== '')
  );
}

function buildCart(input: DetectiveOrder, findings: Findings): CartLike {
  const {order, facts} = input;
  const terminal = isTerminal(input);
  const lines: CartLineLike[] = [];
  for (const line of order.lineItems) {
    const id = normalizeShopifyId(line.id);
    if (
      id === null ||
      !isCount(line.quantity) ||
      !isCount(line.refundedQuantity)
    ) {
      findings.unjudged.add('malformed_lines');
      continue;
    }
    // Coverage is judged by the Extend cross-check (orders.ts), which knows price points and the covered item. An order
    // line has no nested parent, so the cart engine would call every coverage line an orphan.
    if (isCoverageOrderLine(line)) continue;
    // A line refunded or removed after the order no longer stands; a cancelled or fully refunded order keeps its
    // original quantities (same reading as the Extend snapshot builder).
    const quantity = terminal
      ? line.quantity
      : Math.max(0, line.quantity - line.refundedQuantity);
    if (quantity < 1) continue;
    lines.push({
      id,
      variantId: line.variantId ?? '',
      productId: line.productId ?? '',
      quantity,
      attributes: line.attributes,
      size: facts.sizeByLineId.get(line.id) ?? null,
      parentLineId: null,
    });
  }
  return {
    lines,
    attributes: facts.attributes,
    subtotalCents: order.totalCents,
  };
}

/**
 * The ZIP handed to the zone check. The shipping address is what Shopify will deliver to, so it is the authority;
 * the ZIP the shopper typed on our site is only what the cart gate could see (E-M3).
 */
function shippingZipFor(input: DetectiveOrder): {
  zip: string | null;
  foreign: boolean;
} {
  const address = input.order.customer.shippingAddress;
  if (address === null) return {zip: null, foreign: false};
  const country = address.countryCode?.trim().toUpperCase() ?? null;
  if (country === 'US') return {zip: address.postalCode, foreign: false};
  return {zip: UNUSABLE_ZIP, foreign: country !== null};
}

// ---------------------------------------------------------------------------------------------------
// Mapping engine output to violation codes (exhaustive on purpose: a new engine reason must be decided here)
// ---------------------------------------------------------------------------------------------------

type Mapped =
  | {kind: 'code'; code: ViolationCode}
  | {kind: 'ignore'}
  | {kind: 'unjudged'; reason: UnjudgedReason};

const INTERNAL: Mapped = {kind: 'unjudged', reason: 'internal_error'};

function mapCorrection(correction: Correction): Mapped {
  const code = (value: ViolationCode): Mapped => ({kind: 'code', code: value});
  const reason = correction.reason;
  switch (reason) {
    case 'haul-away-over-max':
      return code('haul-away-over-max');
    case 'orphan-gift':
      return code('gift-without-qualifier');
    case 'duplicate-gift':
    case 'gift-over-limit':
      return code('gift-over-allowance');
    case 'protector-without-mattress':
      return code('protector-without-mattress');
    case 'wrong-size-protector':
      return code('wrong-size-protector');
    case 'protector-exceeds-mattresses':
      return code('protector-exceeds-mattresses');
    // The haul-away offer is switched off now; an old line is not a violation of the rules at order time.
    case 'haul-away-disabled':
      return {kind: 'ignore'};
    // Gift lines are recognised by variant id from the rules, so every gift line is "offered"; coverage lines are never
    // handed to the cart engine. If one of these appears, the mapping above is out of step with the engine.
    case 'gift-not-offered':
    case 'orphan-coverage':
    case 'coverage-exceeds-item':
    case 'coverage-price-mismatch':
      return INTERNAL;
    default: {
      const unreachable: never = reason;
      return unreachable;
    }
  }
}

function applyZoneViolation(
  violation: Extract<Violation, {code: 'haul-away-not-eligible'}>,
  foreign: boolean,
  findings: Findings,
): void {
  const ids = violation.lineIds;
  switch (violation.reason) {
    // Both are about the delivery METHOD and are judged separately from the attribute (see judgeHaulAwayMethod).
    case 'delivery-not-chosen':
    case 'pickup-selected':
      return;
    case 'zone-unavailable':
      findings.unjudged.add('zone_unavailable');
      return;
    case 'zip-missing':
      note(findings, 'haul-away-no-shipping-zip', ids);
      return;
    case 'zip-invalid':
      note(
        findings,
        foreign ? 'haul-away-outside-zone' : 'haul-away-zip-invalid',
        ids,
      );
      return;
    case 'outside-zone':
      note(findings, 'haul-away-outside-zone', ids);
      return;
    default: {
      const unreachable: never = violation.reason;
      return unreachable;
    }
  }
}

function applyEngineViolation(
  violation: Violation,
  foreign: boolean,
  findings: Findings,
): void {
  switch (violation.code) {
    case 'invalid-quantity':
    case 'duplicate-line-id':
      findings.unjudged.add('malformed_lines');
      return;
    case 'haul-away-not-eligible':
      applyZoneViolation(violation, foreign, findings);
      return;
    default: {
      const unreachable: never = violation;
      return unreachable;
    }
  }
}

/** True when a gift's qualifying rule works by collection, which an order line does not carry. */
function giftQualifiesByCollection(
  rules: OfferRules,
  variantId: string,
): boolean {
  return rules.gifts.some(
    (rule) =>
      rule.qualifyingCollectionIds.length > 0 &&
      Object.values(rule.giftVariantIdsBySize).includes(variantId),
  );
}

function hasUnsizedQualifyingMattress(
  rules: OfferRules,
  cart: CartLike,
  regularIds: ReadonlySet<string>,
): boolean {
  const comfort = rules.comfortGuarantee;
  if (comfort === null) return false;
  return cart.lines.some(
    (line) =>
      regularIds.has(line.id) &&
      comfort.qualifyingProductIds.includes(line.productId) &&
      line.size === null,
  );
}

// ---------------------------------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------------------------------

/**
 * Delivery method and quantity are judged here, independently of the ZIP. The engine reports only the FIRST reason an
 * offer is ineligible; if it stopped at a missing `delivery_choice` attribute it would hide an out-of-zone address,
 * and the attribute is something a shopper can write (a claim, not a fact).
 */
function judgeHaulAway(
  input: DetectiveOrder,
  cart: CartLike,
  rules: OfferRules,
  findings: Findings,
): void {
  const prepared = prepareCart(cart, rules);
  const haulLines = prepared.lines.filter(({kind}) => kind === 'haul-away');
  if (haulLines.length === 0 || rules.haulAway === null) return;
  const ids = haulLines.map(({line}) => line.id);

  const choice = parseOfferAttributes(input.facts.attributes).deliveryChoice;
  if (choice === 'pickup') note(findings, 'haul-away-pickup', ids);
  else if (choice === null) {
    note(findings, 'haul-away-delivery-not-recorded', ids);
  }

  const max = limitOrZero(rules.haulAway.maxPieces);
  const total = haulLines.reduce((sum, {line}) => sum + line.quantity, 0);
  if (max >= 1 && total > max) note(findings, 'haul-away-over-max', ids);
}

function judgeWithEngine(
  input: DetectiveOrder,
  cart: CartLike,
  rules: OfferRules,
  zone: DeliveryZone | null,
  findings: Findings,
): void {
  const {zip, foreign} = shippingZipFor(input);
  const evaluation = evaluateOffers(cart, rules, {
    zip,
    // The method gate is judged on its own in judgeHaulAway, so the engine goes on to the ZIP and the zone.
    deliveryChoice: 'in-home',
    zone,
    protectionEligibleLineIds: [],
  });

  const lineById = new Map(cart.lines.map((line) => [line.id, line]));
  const prepared = prepareCart(cart, rules);
  const regularIds = new Set(
    prepared.lines
      .filter(({kind}) => kind === 'regular')
      .map(({line}) => line.id),
  );
  const unsized = hasUnsizedQualifyingMattress(rules, cart, regularIds);

  for (const violation of evaluation.violations) {
    applyEngineViolation(violation, foreign, findings);
  }
  for (const correction of evaluation.corrections) {
    const mapped = mapCorrection(correction);
    if (mapped.kind === 'ignore') continue;
    if (mapped.kind === 'unjudged') {
      findings.unjudged.add(mapped.reason);
      continue;
    }
    const lineIds = [correction.lineId];
    if (mapped.code === 'gift-without-qualifier') {
      const variantId = lineById.get(correction.lineId)?.variantId ?? '';
      if (giftQualifiesByCollection(rules, variantId)) {
        findings.unjudged.add('gift_collection_qualifier');
        continue;
      }
    }
    if (
      unsized &&
      (mapped.code === 'wrong-size-protector' ||
        mapped.code === 'protector-exceeds-mattresses')
    ) {
      findings.unjudged.add('mattress_size_unreadable');
      continue;
    }
    note(findings, mapped.code, lineIds);
  }
}

function coverageCode(reason: FlagReason): Mapped {
  const code = (value: ViolationCode): Mapped => ({kind: 'code', code: value});
  switch (reason) {
    case 'invalid_plan_id':
    case 'invalid_covered_product_id':
      return code('coverage-unlinked');
    case 'covered_product_missing':
    case 'covered_product_mismatch':
      return code('coverage-without-covered-item');
    case 'covered_product_ineligible':
      return code('coverage-on-ineligible-item');
    case 'duplicate_coverage':
      return code('coverage-duplicate');
    // The link is unknowable, which is "unjudged", not a violation.
    case 'covered_product_ambiguous':
      return {kind: 'unjudged', reason: 'coverage_link_ambiguous'};
    // The detective hands the cross-check quotes that match the line, so plan and price are never judged here (that is
    // the Extend sync's and the reconcile script's job). Seeing either means this wiring is out of step.
    case 'unknown_plan':
    case 'price_mismatch':
      return INTERNAL;
    default: {
      const unreachable: never = reason;
      return unreachable;
    }
  }
}

/**
 * Protection without its covered item reuses the Extend cross-check (orders.ts) instead of a second implementation.
 * That check also verifies plan id and price against a quote from Extend, which needs the network and Extend's
 * credentials; the detective runs offline, so each line is handed a quote equal to itself. What remains is the
 * structural part only: a valid plan id and covered product id, the covered product on the same order and eligible, one
 * coverage per item, and coverage quantity not above the item's.
 */
function judgeCoverage(input: DetectiveOrder, findings: Findings): void {
  const {order} = input;
  const byKey = new Map(
    order.lineItems.map((line) => [normalizeShopifyId(line.id), line]),
  );
  const quotes = new Map<string, PlanQuote | null>();
  for (const {lineId, query} of listQuoteQueries(order)) {
    const line = byKey.get(lineId);
    if (line !== undefined) {
      quotes.set(lineId, {
        planId: query.planId,
        priceCents: line.unitPriceCents,
      });
    }
  }

  const check = crossCheckCoverage(order, quotes);
  if ('invalidOrder' in check) {
    findings.unjudged.add('invalid_order');
    return;
  }
  for (const warning of check.warnings) {
    note(findings, 'coverage-quantity-mismatch', [warning.lineId]);
  }
  if (check.ok) return;
  for (const flag of check.flagged) {
    const mapped = coverageCode(flag.reason);
    if (mapped.kind === 'code') note(findings, mapped.code, [flag.lineId]);
    else if (mapped.kind === 'unjudged') findings.unjudged.add(mapped.reason);
  }
}

function judge(
  input: DetectiveOrder,
  rules: OfferRules,
  zone: DeliveryZone | null,
): DetectiveResult {
  const orderId = normalizeShopifyId(input.order.id);
  if (
    orderId === null ||
    !Array.isArray(input.order.lineItems) ||
    input.order.lineItems.length > MAX_LINES
  ) {
    return unjudgeableWith('unknown', 'invalid_order');
  }
  const findings = newFindings();
  const cart = buildCart(input, findings);

  judgeHaulAway(input, cart, rules, findings);
  judgeWithEngine(input, cart, rules, zone, findings);
  judgeCoverage(input, findings);
  return assemble(orderId, findings);
}

function unjudgeableWith(
  orderId: string,
  reason: UnjudgedReason,
): DetectiveResult {
  return {
    status: 'unjudgeable',
    orderId,
    violations: [],
    unjudged: [reason],
  };
}

/**
 * Judges one order against the offer rules and the delivery zone. Never throws: any failure inside is an unjudgeable
 * result, because an exception must not read as "no violations".
 */
export function detectOrderViolations(
  input: DetectiveOrder,
  rules: OfferRules,
  zone: DeliveryZone | null,
): DetectiveResult {
  try {
    return judge(input, rules, zone);
  } catch {
    const id = safeOrderId(input);
    return unjudgeableWith(id, 'internal_error');
  }
}

function safeOrderId(input: DetectiveOrder): string {
  try {
    return normalizeShopifyId(input.order.id) ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * The entry point for callers that hold the configuration as the cart gate loads it. Without rules nothing can be
 * recognised (a gift, a protector and a haul-away line all look like ordinary lines), so the order is reported as
 * unjudgeable rather than clean.
 */
export function detectWithConfig(
  input: DetectiveOrder,
  config: DetectiveConfig,
): DetectiveResult {
  if (config.status !== 'ready') {
    return unjudgeableWith(safeOrderId(input), 'rules_unavailable');
  }
  return detectOrderViolations(input, config.rules, config.zone);
}
