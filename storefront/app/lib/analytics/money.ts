// Providers want decimal dollars; Shopify and this code base use integer cents. This is the one conversion, and it
// goes through the shared helper (`~/lib/format`) so there is no float arithmetic on money: the cents are turned
// into the exact two-decimal string first and only that string is parsed (1999.99, never 1999.9899999).

import {fromCents} from '~/lib/format';

/** Cents to dollars for a provider payload; undefined when the amount is not a non-negative whole number of cents. */
export function dollarsFromCents(cents: number): number | undefined {
  try {
    return Number(fromCents(cents));
  } catch {
    return undefined;
  }
}
