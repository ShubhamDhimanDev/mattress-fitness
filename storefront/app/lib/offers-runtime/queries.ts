// Storefront API documents the cart offers need (P4-04, P4-09). Request only what is rendered or checked.
// Operation names are unique project-wide because codegen merges every document.

/** Display details and availability of the variants the engine wants to offer (REQ-ADD-001: never offer a sold-out variant). */
export const OFFER_VARIANTS_QUERY = `#graphql
  query CartOfferVariants($ids: [ID!]!, $country: CountryCode, $language: LanguageCode)
  @inContext(country: $country, language: $language) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        title
        availableForSale
        price {
          amount
          currencyCode
        }
        product {
          id
          title
          handle
        }
      }
    }
  }
` as const;

/** Sizes and collections of the products in the cart: size swaps (REQ-CART-001) and collection-qualified gifts (REQ-CART-002). */
export const OFFER_PRODUCTS_QUERY = `#graphql
  query CartOfferProducts(
    $ids: [ID!]!
    $withCollections: Boolean!
    $country: CountryCode
    $language: LanguageCode
  ) @inContext(country: $country, language: $language) {
    nodes(ids: $ids) {
      ... on Product {
        id
        variants(first: 50) {
          nodes {
            id
            title
            availableForSale
            selectedOptions {
              name
              value
            }
          }
        }
        collections(first: 20) @include(if: $withCollections) {
          nodes {
            id
          }
        }
      }
    }
  }
` as const;

/** One variant, to prove a size swap stays inside the line's own product. */
export const OFFER_SWAP_TARGET_QUERY = `#graphql
  query CartOfferSwapTarget($id: ID!, $country: CountryCode, $language: LanguageCode)
  @inContext(country: $country, language: $language) {
    node(id: $id) {
      ... on ProductVariant {
        id
        availableForSale
        product {
          id
        }
        selectedOptions {
          name
          value
        }
      }
    }
  }
` as const;
