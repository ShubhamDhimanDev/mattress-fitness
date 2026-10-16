// The address of a brand page, as a pure function with no Shopify client behind it, so the product mapper and the
// product page can use it without pulling in the brand listing queries (REQ-COL-005).

const HANDLE_LIKE = /^[a-z0-9][a-z0-9-]{0,99}$/;

/** The handle of a brand's page, or null when the stored slug cannot be used in a URL. */
export function normalizeBrandSlug(
  raw: string | null | undefined,
): string | null {
  const slug = (raw ?? '').trim().toLowerCase();
  return HANDLE_LIKE.test(slug) ? slug : null;
}

export function brandPath(handle: string): string {
  return `/brands/${encodeURIComponent(handle)}`;
}
