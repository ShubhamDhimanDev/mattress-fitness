// Money helpers. US dollars only (NFR-008): no locale or currency switching.
// Shopify returns prices as decimal strings ("1999.0") in MoneyV2; arithmetic is done in integer cents.

export type MoneyV2Like = {amount: string; currencyCode: string};

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});
const usdWhole = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** "1999.00" -> 199900. Rejects anything that is not a plain non-negative decimal with at most 2 places. */
export function toCents(amount: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!match) throw new Error(`Invalid money amount: "${amount}"`);
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  return whole * 100 + fraction;
}

export function fromCents(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0)
    throw new Error(`Invalid cents: ${cents}`);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/** Formats cents as US dollars. Whole-dollar amounts drop the ".00" when `compact` is set. */
export function formatCents(
  cents: number,
  options: {compact?: boolean} = {},
): string {
  const dollars = cents / 100;
  return options.compact && cents % 100 === 0
    ? usdWhole.format(dollars)
    : usd.format(dollars);
}

export function formatMoney(
  money: MoneyV2Like,
  options: {compact?: boolean} = {},
): string {
  if (money.currencyCode !== 'USD') {
    throw new Error(`Only USD is supported, got ${money.currencyCode}`);
  }
  return formatCents(toCents(money.amount), options);
}
