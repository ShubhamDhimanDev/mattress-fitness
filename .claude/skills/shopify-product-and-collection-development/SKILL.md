---
name: shopify-product-and-collection-development
description: "Builds product, collection, filter, search and homepage features on the Shopify Storefront API in Hydrogen: typed queries, caching, variant and size selection from URL state, From pricing, badges, filters, structured data and tests. Use for any task that reads catalog or content data from Shopify, in phases 3A and 3B and for quiz, comparison and store data."
---

# Shopify product and collection development

## When to use

Implementing or changing product pages, collections, filters, search, brand pages, homepage sections, store data reads, or the catalog queries behind the quiz and comparison.

## Steps

1. **Confirm the data.** Read `docs/architecture/SHOPIFY_DATA_MODEL.md` and the task's requirements. Check that the metafields, metaobjects and filter configuration exist in the store you are developing against and have Storefront API access; if not, stop and raise it (V-04, V-05).
2. **Check current docs.** Verify field names and arguments in the Storefront API reference for the API version in use (do not rely on memory; Hydrogen and the API change quarterly).
3. **Query modules.** Add a typed module under `app/lib/shopify/` with generated types; request only the fields used; handle `null`, missing metafields and unavailable variants; return a typed result.
4. **Loader and caching.** Compose in the route loader; choose the cache strategy deliberately (long for catalog and content, short for availability, none for cart, customer and ZIP-dependent data); never key a cache by personal data.
5. **Variants and prices.** Select the variant from URL state (`?Size=...`) validated against known options; price, compare-at, savings, SKU and availability all come from the selected variant. `From $` is the lowest *available* variant price. A sale badge requires compare-at greater than price. Never trust a client-supplied price.
6. **Filters and sort.** Keep state in the URL through the shared codec; map to Shopify filters; show counts from Shopify; empty state with reset; keyboard-operable controls. Load-more uses the cursor and appends.
7. **Content.** Render rich text and metaobject content through the sanitising renderer. Omit empty sections. Emit JSON-LD (Product, Breadcrumb, FAQ) from the same data as the visible content.
8. **Tests.** Unit: filter codec, variant selection, price and badge logic, mappers. Integration: query modules against recorded responses. E2E and accessibility for the journey. Update `docs/requirements/TRACEABILITY.md`.

## Outputs

Typed queries, loaders, components wired to data, tests, updated traceability, and notes on any Shopify configuration the client's store needs (added to the import or admin checklist).

## Validation

Lint, type check and tests pass; filter counts and results match Shopify admin for a sampled set; changing a size updates price and availability without a full reload; sold-out and missing-data states render; no private token or unsanitised HTML reaches the client; Lighthouse baseline recorded for the template.
