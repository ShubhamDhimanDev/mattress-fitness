// Catalog constants shared by the query modules, loaders and tests. Nothing here talks to Shopify.

/** Handle of the main mattress collection; the home page and "shop by size" tiles link into it. */
export const PRIMARY_COLLECTION_HANDLE = 'mattresses';

/** Products per page for "Load more" on collections and search. */
export const LISTING_PAGE_SIZE = 12;

/** Longest search term we forward to Shopify (the API accepts more; a hostile URL should not). */
export const MAX_SEARCH_TERM_LENGTH = 100;

/** Predictive search does not call Shopify below this many characters (REQ-SRCH-001). */
export const MIN_PREDICTIVE_TERM_LENGTH = 2;

/** Variants read per product. Mattresses have at most seven sizes; 100 is Shopify's per-product limit. */
export const MAX_PRODUCT_VARIANTS = 100;

/** Shopify metaobject field keys we read from `brand` and `faq` entries (SHOPIFY_DATA_MODEL). */
export const BRAND_FIELDS = {
  name: 'name',
  slug: 'slug',
  logo: 'logo',
  about: 'about',
  warranty: 'warranty_terms',
} as const;

export const FAQ_FIELDS = {question: 'question', answer: 'answer'} as const;
