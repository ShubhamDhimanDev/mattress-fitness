# Phase 3B: Catalog experience (navigation, collections, filters, search, product pages, homepage)

## Objective

Let shoppers find and understand a mattress: menu, homepage, collections with filters, search, and rich product pages with live size pricing, pickup availability and the "my store" and ZIP context. (Second half of the original Phase 3.) **Business outcome:** the "clear buying decisions" objective of the SOW is demonstrable end to end on real catalog data.

## Scope

In: Storefront API queries and generated types, caching strategy, mega menu, homepage sections, collection pages, filters, promo tiles, collection FAQs, brand pages, predictive search and results, product pages, "my store" selector and pickup availability, ZIP entry, reviews adapter.
Out: add-ons, bundles and gifts (4), delivery promise (5B), Extend offer (5A), comparison and quiz (6).

## Prerequisites

Phase 2 shell; Phase 3A data on the store; V-04, V-05, V-07 verified; Q-011 (reviews provider) for REQ-PDP-005.

## Requirement IDs

REQ-NAV-002, REQ-NAV-003, REQ-HOME-001, REQ-COL-001, REQ-COL-002, REQ-COL-003, REQ-COL-004, REQ-COL-005, REQ-SRCH-001, REQ-SRCH-002, REQ-PDP-001, REQ-PDP-002, REQ-PDP-003, REQ-PDP-004, REQ-PDP-005, REQ-LOC-003

## Architecture and design decisions

- All reads go through typed query modules in `storefront/app/lib/shopify/` using generated types; route loaders compose them. Components receive plain props.
- Caching per [ARCHITECTURE](../../docs/architecture/ARCHITECTURE.md#7-caching): catalog and menus use a long cache, availability a short one, cart, customer and ZIP-dependent data none. Cache keys never include personal data.
- Filters and sort live in the URL; the filter codec is a pure, unit-tested module shared by collections and search.
- The product page selects variants from URL state (`?Size=...`), server-renders the selected variant, and updates without a full reload.
- Reviews sit behind a `ReviewsProvider` interface so the chosen app (Q-011) is an adapter; with no provider nothing renders and no rating schema is emitted.
- ZIP and "my store" are first-party cookies, validated server-side, never forwarded to third-party scripts (NFR-011).
- Structured data is generated from the same props as the visible content so it cannot drift.

## Tasks

| ID | Task | Owner | Depends on | Output and expected files |
|---|---|---|---|---|
| P3B-01 | Query modules, generated types, caching helpers, error mapping | shopify-hydrogen-developer | P3A-01 | `storefront/app/lib/shopify/*` |
| P3B-02 | Mega menu and mobile accordion from Shopify menus | shopify-hydrogen-developer | P3B-01 | `app/components/layout/MegaMenu.tsx` |
| P3B-03 | Collection page: grid, sort, load more, From $ pricing, sale and gift badges | shopify-hydrogen-developer | P3B-01 | `app/routes/collections.$handle.tsx` |
| P3B-04 | Filters and URL codec; empty and error states | shopify-hydrogen-developer | P3B-03, V-04 | `app/lib/filters.ts`, `app/components/collection/Filters.tsx` |
| P3B-05 | Promo tiles in the grid and collection FAQs with JSON-LD | shopify-hydrogen-developer | P3B-03 | components and tests |
| P3B-06 | Brand collection pages and brand sections | shopify-hydrogen-developer | P3B-03, REQ-CAT-006 | `app/routes/brands.$handle.tsx` |
| P3B-07 | Predictive search and search results page | shopify-hydrogen-developer | P3B-04 | `app/routes/search.tsx`, predictive endpoint |
| P3B-08 | Product page core: gallery, size selector with dimensions, live price, savings, badges, URL state | shopify-hydrogen-developer | P3B-01 | `app/routes/products.$handle.tsx` |
| P3B-09 | Product page content: overview, specifications, features, brand, delivery and warranty sections, FAQs, Product JSON-LD | shopify-hydrogen-developer | P3B-08 | components |
| P3B-10 | "My store" selector, "set as my store", pickup availability and try-in-store link | shopify-hydrogen-developer | P3B-08, REQ-LOC-002 | `app/lib/store-context.ts`, components |
| P3B-11 | ZIP entry in the header: validator, cookie, server-side read | shopify-hydrogen-developer | P3B-01 | `app/lib/zip.ts`, header component |
| P3B-12 | Reviews adapter interface and the chosen provider (blocked until Q-011); ratings on collections and product pages | integration-engineer | Q-011 | `app/lib/reviews/*` |
| P3B-13 | Homepage sections from Shopify, reorderable in admin | shopify-hydrogen-developer | P3B-01 | `app/routes/_index.tsx`, section components |
| P3B-14 | E2E journeys (home to collection to filter to product to size change), accessibility scans, performance baseline | qa-engineer | P3B-03 to P3B-13 | `storefront/tests/e2e/*.spec.ts` |
| P3B-16 | Add the optional `time_zone` field to the `store` metaobject definition (store hours need it) and to the importer | solution-architect | P3A-02 | `scripts/shopify/definitions.json`, `docs/architecture/SHOPIFY_DATA_MODEL.md` |
| P3B-15 | Phase gate review | project-manager | all | gate record |

## Dependencies and blockers

P3B-12 and REQ-PDP-005 are Blocked by Q-011 and CLR-005; the adapter interface and the "no provider" state still ship. Pickup availability needs store-to-location mapping (P3A-07).

## Security considerations

Escape or sanitise all rich text from Shopify (metaobject rich text, descriptions) before rendering; never `dangerouslySetInnerHTML` unsanitised content. Validate `?Size` and filter parameters against known values. Predictive search endpoint is rate-friendly (debounce, length floor) and returns no private data. Cookies are `SameSite=Lax`, `Secure`, no personal data beyond ZIP and store handle.

## Testing

Unit: filter codec, variant selection, price and badge logic, ZIP validator, section mappers. Integration: query modules against recorded responses. E2E and accessibility: collection filtering, load more, search, size change, store selection, keyboard operation of the menu and filters. Performance: baseline LCP on collection and product templates recorded for Phase 7.

## Acceptance criteria

REQ acceptance criteria for every ID above are met on staging with real catalog data; filter counts and results match Shopify admin for a sampled set; Lighthouse baselines recorded.

## Definition of done

Gates G1 to G8 ([MASTER_PLAN](../MASTER_PLAN.md#phase-gates)) plus: client demo of the shopping journey, with feedback captured as one consolidated round for each page type (REQ-ACPT-001).

## Review and sign-off

`qa-engineer` runs the journeys; `code-reviewer` reviews loaders, caching and rendering of external content; `ui-ux-designer` reviews responsive behaviour; client reviews on staging.

## Rollback and recovery

Feature routes are independent; revert the offending commit. Cache-related incidents are fixed by changing the strategy in one helper. Shopify admin data is untouched by this phase.
