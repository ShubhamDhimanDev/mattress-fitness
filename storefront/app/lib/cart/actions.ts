// Validation of what the browser may send to the cart action (T-01). The cart form posts JSON inputs; this
// module turns them into the only shapes the Hydrogen cart handler is given. Anything that is not a known
// variant or line id, a quantity from 1 to 99, a plain discount code or a bounded line property is
// rejected, and every other key (price, selling plan, parent, optimistic variant data) is dropped:
// Shopify prices the lines, and linking lines (Extend, add-ons) is decided on the server (P4, P5A).

import {cleanText} from '~/lib/catalog/text';
import {isPlausiblePlanId} from '~/lib/extend/ids';
import {
  MAX_LINE_QUANTITY,
  MIN_LINE_QUANTITY,
  parseDiscountCode,
} from '~/lib/cart/input';

const VARIANT_ID = /^gid:\/\/shopify\/ProductVariant\/[1-9]\d{0,19}$/;
// Real ids look like gid://shopify/CartLine/<token>?cart=<cart token>.
export const LINE_ID =
  /^gid:\/\/shopify\/CartLine\/[A-Za-z0-9_-]{1,64}(\?cart=[A-Za-z0-9_-]{1,80})?$/;
const PROPERTY_KEY = /^[A-Za-z0-9][A-Za-z0-9 .:-]{0,59}$/;
const MAX_LINES_PER_REQUEST = 20;
const MAX_PROPERTIES = 10;
const MAX_PROPERTY_VALUE = 255;
const MAX_DISCOUNT_CODES = 5;

export type LineProperty = {key: string; value: string};

export type ValidAddLine = {
  merchandiseId: string;
  quantity: number;
  attributes?: LineProperty[];
};

/**
 * A quantity change only. Line properties are not accepted on update: an update carrying an empty
 * attribute list would erase the hidden underscore properties the server set (Extend links, security
 * review P-L1).
 */
export type ValidUpdateLine = {
  id: string;
  quantity: number;
};

export type Validated<T> =
  | {readonly status: 'ok'; readonly value: T}
  | {readonly status: 'invalid'; readonly reason: string};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function quantityOf(value: unknown, min: number): number | null {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= min &&
    value <= MAX_LINE_QUANTITY
    ? value
    : null;
}

function propertiesOf(value: unknown): LineProperty[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_PROPERTIES) return null;
  const properties: LineProperty[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    const {key, value: text} = entry;
    // Underscore keys are the hidden properties we set on the server; the browser may not write them.
    if (typeof key !== 'string' || !PROPERTY_KEY.test(key)) return null;
    if (typeof text !== 'string' || text.length > MAX_PROPERTY_VALUE)
      return null;
    properties.push({key, value: cleanText(text)});
  }
  return properties;
}

function lineList(raw: unknown): unknown[] | null {
  return Array.isArray(raw) &&
    raw.length > 0 &&
    raw.length <= MAX_LINES_PER_REQUEST
    ? raw
    : null;
}

export function validateAddLines(raw: unknown): Validated<ValidAddLine[]> {
  const list = lineList(raw);
  if (!list) return {status: 'invalid', reason: 'No items to add.'};
  const lines: ValidAddLine[] = [];
  for (const entry of list) {
    if (!isRecord(entry)) return {status: 'invalid', reason: 'Invalid item.'};
    const quantity = quantityOf(entry.quantity, MIN_LINE_QUANTITY);
    const properties = propertiesOf(entry.attributes);
    if (
      typeof entry.merchandiseId !== 'string' ||
      !VARIANT_ID.test(entry.merchandiseId) ||
      quantity === null ||
      properties === null
    ) {
      return {status: 'invalid', reason: 'Invalid item or quantity.'};
    }
    lines.push({
      merchandiseId: entry.merchandiseId,
      quantity,
      ...(properties.length > 0 ? {attributes: properties} : {}),
    });
  }
  return {status: 'ok', value: lines};
}

/** Quantity 0 is not accepted here: removing a line is its own action. */
export function validateUpdateLines(
  raw: unknown,
): Validated<ValidUpdateLine[]> {
  const list = lineList(raw);
  if (!list) return {status: 'invalid', reason: 'No lines to update.'};
  const lines: ValidUpdateLine[] = [];
  for (const entry of list) {
    if (!isRecord(entry)) return {status: 'invalid', reason: 'Invalid line.'};
    const quantity = quantityOf(entry.quantity, MIN_LINE_QUANTITY);
    if (
      typeof entry.id !== 'string' ||
      !LINE_ID.test(entry.id) ||
      quantity === null
    ) {
      return {status: 'invalid', reason: 'Invalid line or quantity.'};
    }
    lines.push({id: entry.id, quantity});
  }
  return {status: 'ok', value: lines};
}

export type ValidSizeChange = {lineId: string; merchandiseId: string};

/**
 * A size swap names the line and the new variant, nothing else. The quantity is the cart's own (read on the
 * server) and the new variant must belong to the same product: that check needs Shopify and is done by the
 * action, not here.
 */
export function validateSizeChange(raw: unknown): Validated<ValidSizeChange> {
  if (!isRecord(raw)) return {status: 'invalid', reason: 'Invalid size.'};
  if (
    typeof raw.lineId !== 'string' ||
    !LINE_ID.test(raw.lineId) ||
    typeof raw.merchandiseId !== 'string' ||
    !VARIANT_ID.test(raw.merchandiseId)
  ) {
    return {status: 'invalid', reason: 'Invalid size.'};
  }
  return {
    status: 'ok',
    value: {lineId: raw.lineId, merchandiseId: raw.merchandiseId},
  };
}

export type ValidAddWithProtection = {
  variantId: string;
  quantity: number;
  planKey: string;
};

/**
 * Item plus protection plan (P5A-05). Only these three fields are read: a coverage variant id, a price, a parent, a
 * quantity for the coverage line or attributes in the request are ignored here and never reach Shopify; the server
 * derives all of them from its own quote.
 */
export function validateAddWithProtection(
  raw: unknown,
): Validated<ValidAddWithProtection> {
  if (!isRecord(raw)) return {status: 'invalid', reason: 'Invalid item.'};
  const quantity = quantityOf(raw.quantity, MIN_LINE_QUANTITY);
  if (
    typeof raw.variantId !== 'string' ||
    !VARIANT_ID.test(raw.variantId) ||
    quantity === null ||
    !isPlausiblePlanId(raw.planKey)
  ) {
    return {status: 'invalid', reason: 'Invalid item or protection plan.'};
  }
  return {
    status: 'ok',
    value: {variantId: raw.variantId, quantity, planKey: raw.planKey},
  };
}

export type ValidAddProtection = {lineId: string; planKey: string};

/** Protection for a line in the cart (P5A-07): a line id and a plan key; the quantity is the server's. */
export function validateAddProtection(
  raw: unknown,
): Validated<ValidAddProtection> {
  if (
    !isRecord(raw) ||
    typeof raw.lineId !== 'string' ||
    !LINE_ID.test(raw.lineId) ||
    !isPlausiblePlanId(raw.planKey)
  ) {
    return {status: 'invalid', reason: 'Invalid protection plan.'};
  }
  return {status: 'ok', value: {lineId: raw.lineId, planKey: raw.planKey}};
}

export function validateLineIds(raw: unknown): Validated<string[]> {
  const list = lineList(raw);
  if (!list) return {status: 'invalid', reason: 'No lines to remove.'};
  const ids: string[] = [];
  for (const entry of list) {
    if (typeof entry !== 'string' || !LINE_ID.test(entry)) {
      return {status: 'invalid', reason: 'Invalid line.'};
    }
    ids.push(entry);
  }
  return {status: 'ok', value: ids};
}

/**
 * The full list of codes to keep after the shopper's change: the code they typed (if any) plus the codes
 * already on the cart. Unknown characters reject the typed code; a bad existing code is dropped.
 */
export function validateDiscountCodes(
  typed: unknown,
  existing: unknown,
): Validated<string[]> {
  const codes: string[] = [];
  if (typeof typed === 'string' && typed.trim() !== '') {
    const code = parseDiscountCode(typed);
    if (code === null) {
      return {status: 'invalid', reason: 'That discount code is not valid.'};
    }
    codes.push(code);
  }
  if (Array.isArray(existing)) {
    for (const entry of existing) {
      const code = typeof entry === 'string' ? parseDiscountCode(entry) : null;
      if (code !== null && !codes.includes(code)) codes.push(code);
    }
  }
  return {status: 'ok', value: codes.slice(0, MAX_DISCOUNT_CODES)};
}

// Offer ids are the admin's own labels (up to 120 characters, offers-runtime/config.ts), so they are checked for shape
// here and for meaning against the rules on the server; they are never echoed back.
const MAX_OFFER_ID_LENGTH = 120;

function isOfferId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_OFFER_ID_LENGTH &&
    // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

export type ValidAddGift = {ruleId: string; variantId: string};

/** A gift from the cart picker: a rule id and a variant id. A quantity, a price or anything else in the request is dropped. */
export function validateAddGift(raw: unknown): Validated<ValidAddGift> {
  if (
    !isRecord(raw) ||
    !isOfferId(raw.ruleId) ||
    typeof raw.variantId !== 'string' ||
    !VARIANT_ID.test(raw.variantId)
  ) {
    return {status: 'invalid', reason: 'Choose one of the gifts shown.'};
  }
  return {
    status: 'ok',
    value: {ruleId: raw.ruleId, variantId: raw.variantId},
  };
}

export type ValidAddAddOn = {variantId: string; mattressVariantId?: string};

/**
 * An add-on from the cart picker (a variant id) or the product page (also the mattress variant being viewed, P4-03).
 * The quantity is always the server's (one). A mattress id that is present but malformed is refused, not dropped: the
 * request would otherwise quietly turn from "with this mattress" into "for a mattress already in the cart".
 */
export function validateAddAddOn(raw: unknown): Validated<ValidAddAddOn> {
  if (
    !isRecord(raw) ||
    typeof raw.variantId !== 'string' ||
    !VARIANT_ID.test(raw.variantId)
  ) {
    return {status: 'invalid', reason: 'Invalid item.'};
  }
  if (raw.mattressVariantId === undefined) {
    return {status: 'ok', value: {variantId: raw.variantId}};
  }
  if (
    typeof raw.mattressVariantId !== 'string' ||
    !VARIANT_ID.test(raw.mattressVariantId) ||
    raw.mattressVariantId === raw.variantId
  ) {
    return {status: 'invalid', reason: 'Invalid item.'};
  }
  return {
    status: 'ok',
    value: {
      variantId: raw.variantId,
      mattressVariantId: raw.mattressVariantId,
    },
  };
}

export type ValidAddProductBundle = {
  bundleId: string;
  anchorVariantId: string;
};

/**
 * "Add all" from the product page (P4-06): the bundle's id and the anchor variant being viewed. The lines, sizes and
 * quantities are the server's; a quantity, price, discount or list of lines in the request is dropped.
 */
export function validateAddProductBundle(
  raw: unknown,
): Validated<ValidAddProductBundle> {
  if (
    !isRecord(raw) ||
    !isOfferId(raw.bundleId) ||
    typeof raw.anchorVariantId !== 'string' ||
    !VARIANT_ID.test(raw.anchorVariantId)
  ) {
    return {status: 'invalid', reason: 'Invalid set.'};
  }
  return {
    status: 'ok',
    value: {bundleId: raw.bundleId, anchorVariantId: raw.anchorVariantId},
  };
}

export type ValidAddBundle = {bundleId: string; anchorLineId: string};

/** A bundle completion: the bundle's id and the cart line it anchors on. Which lines and how many is the server's. */
export function validateAddBundle(raw: unknown): Validated<ValidAddBundle> {
  if (
    !isRecord(raw) ||
    !isOfferId(raw.bundleId) ||
    typeof raw.anchorLineId !== 'string' ||
    !LINE_ID.test(raw.anchorLineId)
  ) {
    return {status: 'invalid', reason: 'Invalid set.'};
  }
  return {
    status: 'ok',
    value: {bundleId: raw.bundleId, anchorLineId: raw.anchorLineId},
  };
}
