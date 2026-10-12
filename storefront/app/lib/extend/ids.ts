// Identifier helpers. Shopify returns global ids ("gid://shopify/Product/123") from GraphQL and bare numbers
// from webhooks. Extend sees one stable form (the numeric tail), and every comparison in this folder goes
// through the same normaliser so a GID and a bare number compare equal.

const GID = /^gid:\/\/shopify\/[A-Za-z]+\/(\d{1,20})$/;
const NUMERIC = /^\d{1,20}$/;

/** "gid://shopify/Product/123" or "123" -> "123". Anything else (including attacker-controlled text) -> null. */
export function normalizeShopifyId(
  value: string | number | null | undefined,
): string | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const gid = GID.exec(trimmed);
  if (gid) return gid[1] ?? null;
  return NUMERIC.test(trimmed) ? trimmed : null;
}

/** Plan ids are opaque tokens from Extend (for example "EXT-ELEC-3Y"); reject anything that is not a plain token. */
export function isPlausiblePlanId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(value)
  );
}
