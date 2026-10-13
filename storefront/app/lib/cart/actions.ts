// Validation of what the browser may send to the cart action (T-01). The cart form posts JSON inputs; this
// module turns them into the only shapes the Hydrogen cart handler is given. Anything that is not a known
// variant or line id, a quantity from 1 to 99, a plain discount code or a bounded line property is
// rejected, and every other key (price, selling plan, parent, optimistic variant data) is dropped:
// Shopify prices the lines, and linking lines (Extend, add-ons) is decided on the server (P4, P5A).

import {cleanText} from '~/lib/catalog/text';
import {
  MAX_LINE_QUANTITY,
  MIN_LINE_QUANTITY,
  parseDiscountCode,
} from '~/lib/cart/input';

const VARIANT_ID = /^gid:\/\/shopify\/ProductVariant\/[1-9]\d{0,19}$/;
// Real ids look like gid://shopify/CartLine/<token>?cart=<cart token>.
const LINE_ID =
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

export type ValidUpdateLine = {
  id: string;
  quantity: number;
  attributes?: LineProperty[];
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
    const properties = propertiesOf(entry.attributes);
    if (
      typeof entry.id !== 'string' ||
      !LINE_ID.test(entry.id) ||
      quantity === null ||
      properties === null
    ) {
      return {status: 'invalid', reason: 'Invalid line or quantity.'};
    }
    lines.push({
      id: entry.id,
      quantity,
      ...(entry.attributes !== undefined ? {attributes: properties} : {}),
    });
  }
  return {status: 'ok', value: lines};
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
