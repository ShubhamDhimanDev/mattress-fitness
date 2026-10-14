// Messages from cart mutations (REQ-CART-001: "failures show a recoverable message"). Hydrogen's cart
// handler returns `userErrors` as `errors` and Shopify `warnings` next to the cart; the UI must show
// them, because a partial failure (a line that could not be added) otherwise looks like success.

import {cleanText} from '~/lib/catalog/text';

export type CartMessage = {
  readonly kind: 'error' | 'warning';
  readonly text: string;
};

const MAX_MESSAGE_LENGTH = 240;
const MAX_MESSAGES = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textsOf(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.message !== 'string') return [];
    const text = cleanText(entry.message).slice(0, MAX_MESSAGE_LENGTH);
    return text === '' ? [] : [text];
  });
}

/** Whether a fetcher's data is the result of the cart action (so unrelated fetchers are ignored). */
export function isCartActionResult(
  data: unknown,
): data is Record<string, unknown> {
  return isRecord(data) && isRecord(data.analytics) && 'cart' in data;
}

/** Errors first, then warnings; duplicates removed and the list bounded. */
export function readCartMessages(data: unknown): CartMessage[] {
  if (!isCartActionResult(data)) return [];
  const messages: CartMessage[] = [
    ...textsOf(data.errors).map((text) => ({kind: 'error' as const, text})),
    ...textsOf(data.warnings).map((text) => ({kind: 'warning' as const, text})),
  ];
  const seen = new Set<string>();
  return messages
    .filter((message) => {
      const key = `${message.kind}:${message.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_MESSAGES);
}
