// Pure view rules for the search page.

/**
 * Show the product listing (sidebar, chips, Reset) when there are products or when filters are active.
 * A filtered search with no matches must keep the controls that undo the filters; otherwise the shopper
 * sees "no products found" with no way back except editing the URL.
 */
export function shouldShowListing(
  productCount: number,
  activeFilters: number,
): boolean {
  return productCount > 0 || activeFilters > 0;
}
