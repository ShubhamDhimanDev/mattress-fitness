// Cart to the offer engine's input (P4-01). `toCartLike` flattens Shopify's cart into the plain `CartLike`
// the pure offer engine reads. Prices are never read here except Shopify's own subtotal: the engine
// decides which lines should exist, Shopify prices them. `role` is left unset on purpose; the server sets
// roles from Shopify data (product type, tags) and the Extend adapter sets 'coverage' (types.ts).

import {SIZE_OPTION_NAME, toSlug} from '~/lib/catalog/attributes';
import {toCents} from '~/lib/money';
import type {CartLike, CartLineLike} from '~/lib/offers/types';

type AttributeSource = {
  readonly key: string;
  readonly value?: string | null;
};

type LineSource = {
  readonly id: string;
  readonly quantity: number;
  readonly attributes?: readonly AttributeSource[] | null;
  readonly merchandise?: {
    readonly id?: string;
    readonly selectedOptions?: readonly {
      readonly name: string;
      readonly value: string;
    }[];
    readonly product?: {readonly id: string};
  } | null;
  readonly parentRelationship?: {
    readonly parent: {readonly id: string};
  } | null;
};

export type CartSource = {
  readonly lines: {readonly nodes: readonly LineSource[]};
  readonly attributes?: readonly AttributeSource[] | null;
  readonly cost?: {
    readonly subtotalAmount?: {readonly amount: string} | null;
  } | null;
};

export function attributesToRecord(
  attributes: readonly AttributeSource[] | null | undefined,
): Record<string, string> {
  const record: Record<string, string> = {};
  for (const attribute of attributes ?? []) {
    if (attribute.value !== null && attribute.value !== undefined) {
      record[attribute.key] = attribute.value;
    }
  }
  return record;
}

function sizeOf(line: LineSource): string | null {
  const option = line.merchandise?.selectedOptions?.find(
    (candidate) => toSlug(candidate.name) === toSlug(SIZE_OPTION_NAME),
  );
  return option ? option.value : null;
}

function mapLine(line: LineSource): CartLineLike | null {
  const variantId = line.merchandise?.id;
  const productId = line.merchandise?.product?.id;
  if (!variantId || !productId) return null;
  return {
    id: line.id,
    variantId,
    productId,
    quantity: line.quantity,
    attributes: attributesToRecord(line.attributes),
    size: sizeOf(line),
    parentLineId: line.parentRelationship?.parent.id ?? null,
  };
}

function subtotalCents(cart: CartSource): number {
  const amount = cart.cost?.subtotalAmount?.amount;
  if (!amount) return 0;
  try {
    return toCents(amount);
  } catch {
    return 0;
  }
}

export function toCartLike(cart: CartSource | null | undefined): CartLike {
  if (!cart) return {lines: [], attributes: {}, subtotalCents: 0};
  return {
    lines: cart.lines.nodes.flatMap((line) => {
      const mapped = mapLine(line);
      return mapped ? [mapped] : [];
    }),
    attributes: attributesToRecord(cart.attributes),
    subtotalCents: subtotalCents(cart),
  };
}
