// Storefront API documents for the catalog experience (P3B-01). Each constant carries the `#graphql` tag so
// `npm run codegen` types it. Request only what the page renders. Metafield identifiers follow
// SHOPIFY_DATA_MODEL ("Product"); a store that has not defined them returns null entries, never an error.
//
// Fragment names are unique across the whole project because codegen merges every document.

/** A product as shown on a card: image, sale and availability inputs, and the attributes used as badges. */
export const PRODUCT_CARD_FRAGMENT = `#graphql
  fragment CatalogProductCard on Product {
    id
    handle
    title
    vendor
    productType
    availableForSale
    featuredImage {
      id
      url
      altText
      width
      height
    }
    # The literal must equal MAX_PRODUCT_VARIANTS (100, Shopify's per-product limit): the "From $" price and
    # the sizes shown on a card come from every variant, so a cap below the real count would show a wrong
    # price. Codegen cannot read an interpolated number; queries.test.ts keeps the two in step.
    variants(first: 100) {
      nodes {
        id
        availableForSale
        price {
          amount
          currencyCode
        }
        compareAtPrice {
          amount
          currencyCode
        }
        selectedOptions {
          name
          value
        }
      }
    }
    metafields(
      identifiers: [
        {namespace: "custom", key: "comfort_level"}
        {namespace: "custom", key: "mattress_type"}
        {namespace: "custom", key: "benefits"}
        {namespace: "custom", key: "product_line"}
      ]
    ) {
      key
      value
    }
  }
` as const;

export const COLLECTION_QUERY = `#graphql
  query CatalogCollection(
    $handle: String!
    $first: Int!
    $after: String
    $sortKey: ProductCollectionSortKeys
    $reverse: Boolean
    $filters: [ProductFilter!]
    $country: CountryCode
    $language: LanguageCode
  ) @inContext(country: $country, language: $language) {
    collection(handle: $handle) {
      id
      handle
      title
      description
      seo {
        title
        description
      }
      faqs: metafield(namespace: "custom", key: "faqs") {
        references(first: 20) {
          nodes {
            ... on Metaobject {
              id
              fields {
                key
                value
              }
            }
          }
        }
      }
      products(
        first: $first
        after: $after
        sortKey: $sortKey
        reverse: $reverse
        filters: $filters
      ) {
        nodes {
          ...CatalogProductCard
        }
        filters {
          id
          label
          type
          values {
            id
            label
            count
            input
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
  ${PRODUCT_CARD_FRAGMENT}
` as const;

export const ALL_PRODUCTS_QUERY = `#graphql
  query CatalogAllProducts(
    $first: Int!
    $after: String
    $sortKey: ProductSortKeys
    $reverse: Boolean
    $country: CountryCode
    $language: LanguageCode
  ) @inContext(country: $country, language: $language) {
    products(first: $first, after: $after, sortKey: $sortKey, reverse: $reverse) {
      nodes {
        ...CatalogProductCard
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
  ${PRODUCT_CARD_FRAGMENT}
` as const;

export const COLLECTIONS_LIST_QUERY = `#graphql
  query CatalogCollectionsList(
    $first: Int!
    $after: String
    $country: CountryCode
    $language: LanguageCode
  ) @inContext(country: $country, language: $language) {
    collections(first: $first, after: $after) {
      nodes {
        id
        handle
        title
        image {
          id
          url
          altText
          width
          height
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
` as const;

export const HOME_QUERY = `#graphql
  query CatalogHome(
    $primaryHandle: String!
    $country: CountryCode
    $language: LanguageCode
  ) @inContext(country: $country, language: $language) {
    collections(first: 12) {
      nodes {
        id
        handle
        title
        image {
          id
          url
          altText
          width
          height
        }
      }
    }
    primary: collection(handle: $primaryHandle) {
      id
      handle
      title
      products(first: 8) {
        nodes {
          ...CatalogProductCard
        }
      }
    }
    fallbackProducts: products(first: 8, sortKey: BEST_SELLING) {
      nodes {
        ...CatalogProductCard
      }
    }
    brands: metaobjects(type: "brand", first: 24) {
      nodes {
        id
        fields {
          key
          value
          reference {
            ... on MediaImage {
              image {
                url
                altText
                width
                height
              }
            }
          }
        }
      }
    }
  }
  ${PRODUCT_CARD_FRAGMENT}
` as const;

/** Content, options and variants. Price and availability are re-read by PRODUCT_AVAILABILITY_QUERY. */
export const PRODUCT_QUERY = `#graphql
  query CatalogProduct(
    $handle: String!
    $country: CountryCode
    $language: LanguageCode
  ) @inContext(country: $country, language: $language) {
    product(handle: $handle) {
      id
      handle
      title
      vendor
      productType
      description
      seo {
        title
        description
      }
      featuredImage {
        id
        url
        altText
        width
        height
      }
      images(first: 20) {
        nodes {
          id
          url
          altText
          width
          height
        }
      }
      options {
        name
        optionValues {
          name
        }
      }
      variants(first: 100) {
        nodes {
          id
          title
          sku
          availableForSale
          price {
            amount
            currencyCode
          }
          compareAtPrice {
            amount
            currencyCode
          }
          selectedOptions {
            name
            value
          }
          image {
            id
            url
            altText
            width
            height
          }
          dimensions: metafield(namespace: "custom", key: "dimensions") {
            value
          }
        }
      }
      metafields(
        identifiers: [
          {namespace: "custom", key: "comfort_level"}
          {namespace: "custom", key: "mattress_type"}
          {namespace: "custom", key: "sleep_positions"}
          {namespace: "custom", key: "benefits"}
          {namespace: "custom", key: "product_line"}
          {namespace: "custom", key: "height_inches"}
          {namespace: "custom", key: "specifications"}
          {namespace: "custom", key: "features"}
        ]
      ) {
        key
        value
      }
      brand: metafield(namespace: "custom", key: "brand") {
        reference {
          ... on Metaobject {
            id
            fields {
              key
              value
              reference {
                ... on MediaImage {
                  image {
                    url
                    altText
                    width
                    height
                  }
                }
              }
            }
          }
        }
      }
      faqs: metafield(namespace: "custom", key: "faqs") {
        references(first: 20) {
          nodes {
            ... on Metaobject {
              id
              fields {
                key
                value
              }
            }
          }
        }
      }
    }
  }
` as const;

/** Short-cached read of what changes quickly: variant price, compare-at and availability. */
export const PRODUCT_AVAILABILITY_QUERY = `#graphql
  query CatalogProductAvailability(
    $handle: String!
    $country: CountryCode
    $language: LanguageCode
  ) @inContext(country: $country, language: $language) {
    product(handle: $handle) {
      id
      variants(first: 100) {
        nodes {
          id
          availableForSale
          price {
            amount
            currencyCode
          }
          compareAtPrice {
            amount
            currencyCode
          }
        }
      }
    }
  }
` as const;

export const SEARCH_PRODUCTS_QUERY = `#graphql
  query CatalogSearch(
    $term: String!
    $first: Int!
    $after: String
    $sortKey: SearchSortKeys
    $reverse: Boolean
    $productFilters: [ProductFilter!]
    $country: CountryCode
    $language: LanguageCode
  ) @inContext(country: $country, language: $language) {
    products: search(
      query: $term
      types: [PRODUCT]
      first: $first
      after: $after
      sortKey: $sortKey
      reverse: $reverse
      productFilters: $productFilters
      unavailableProducts: HIDE
    ) {
      totalCount
      nodes {
        ... on Product {
          ...CatalogProductCard
        }
      }
      productFilters {
        id
          label
          type
          values {
            id
            label
            count
            input
          }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
  ${PRODUCT_CARD_FRAGMENT}
` as const;

export const SEARCH_CONTENT_QUERY = `#graphql
  query CatalogSearchContent(
    $term: String!
    $country: CountryCode
    $language: LanguageCode
  ) @inContext(country: $country, language: $language) {
    pages: search(query: $term, types: [PAGE], first: 5) {
      nodes {
        ... on Page {
          id
          handle
          title
        }
      }
    }
    articles: search(query: $term, types: [ARTICLE], first: 5) {
      nodes {
        ... on Article {
          id
          handle
          title
          blog {
            handle
          }
        }
      }
    }
    collections(first: 4) {
      nodes {
        id
        handle
        title
      }
    }
  }
` as const;
