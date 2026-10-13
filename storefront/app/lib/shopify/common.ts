// Small mappers shared by the card, product and home mappers. Pure; they never throw on bad data because
// one malformed record must not take a whole page down (NFR-013). Bad records become null and are skipped.

import {cleanText} from '~/lib/catalog/text';
import {toCents, type MoneyV2Like} from '~/lib/money';
import type {ImageView} from '~/lib/shopify/types';

type ImageSource = {
  readonly id?: string | null;
  readonly url: string;
  readonly altText?: string | null;
  readonly width?: number | null;
  readonly height?: number | null;
};

const MAX_ALT_LENGTH = 200;

/** Images are only used from https URLs (Shopify's CDN); anything else is dropped. */
export function mapImage(
  image: ImageSource | null | undefined,
): ImageView | null {
  if (!image || !image.url.startsWith('https://')) return null;
  const alt = image.altText ? cleanText(image.altText) : '';
  return {
    id: image.id ?? null,
    url: image.url,
    altText: alt === '' ? null : alt.slice(0, MAX_ALT_LENGTH),
    width: image.width ?? null,
    height: image.height ?? null,
  };
}

export function mapMoney(
  money: MoneyV2Like | null | undefined,
): MoneyV2Like | null {
  if (!money) return null;
  try {
    toCents(money.amount);
  } catch {
    return null;
  }
  return {amount: money.amount, currencyCode: money.currencyCode};
}

/** Cents of a money value, or null when the amount is not a valid decimal. */
export function centsOf(money: MoneyV2Like | null | undefined): number | null {
  if (!money) return null;
  try {
    return toCents(money.amount);
  } catch {
    return null;
  }
}

type FieldSource = {
  readonly key: string;
  readonly value?: string | null;
};

/** Metaobject fields as a key to text lookup; empty values are left out. */
export function fieldRecord(
  fields: readonly FieldSource[] | null | undefined,
): Record<string, string> {
  const record: Record<string, string> = {};
  for (const field of fields ?? []) {
    if (field.value && field.value.trim() !== '')
      record[field.key] = field.value;
  }
  return record;
}
