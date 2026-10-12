# Phase 3A: Shopify connectivity, data model and catalog import

## Objective

Connect the storefront to a real Shopify store, define the catalog and content data model once as code, and load the client's products, brands and stores through a validated, repeatable import. (This is the first half of the original Phase 3, split because the catalog data and import tool are a distinct, client-dependent deliverable that everything in 3B reads.) **Business outcome:** the client's real catalog exists in Shopify, structured so filters, the quiz and offers work without code changes for new products.

## Scope

In: store connection, metafield and metaobject definitions as scripts, product sheet template, validator, idempotent import, image upload, drafted copy, brand and store data, rule-based collections, filter configuration, delivery-zone data-model decision.
Out: storefront pages (3B), offer rules (4), Extend products (5A).

## Prerequisites

G-1 (store access); decisions Q-002 and Q-003 for the sales channel (Hydrogen channel versus Headless channel); CLR-014 (sheet, images), CLR-015 (stores), CLR-009 (zip list) in at least sample form; Phase 0 verifications V-04, V-05, V-07.

## Requirement IDs

REQ-LOC-002, REQ-CAT-001, REQ-CAT-002, REQ-CAT-003, REQ-CAT-004, REQ-CAT-005, REQ-CAT-006, REQ-CAT-009

## Architecture and design decisions

- Data model in [SHOPIFY_DATA_MODEL](../../docs/architecture/SHOPIFY_DATA_MODEL.md): one product per model with a variant per size; attributes stored as product metafields; brands, stores, FAQs, homepage sections, promo tiles, quiz and offer rules as metaobjects, all with Storefront API read access enabled.
- Definitions are created by a script from a JSON spec so the same model is applied to the development store and later to the client's store, never by hand in two places.
- The import tool is idempotent (stable handle and SKU keys), validates before writing, supports dry run, and is the same tool handed to the client (REQ-CAT-009). It uses Admin API access from a least-privilege custom app token read from the environment.
- Only approved copy is published (CLR-017); drafts carry an approval flag.
- Delivery-zone single source of truth is decided here (P3A-10) so Phase 5B implements, not debates.

## Tasks

| ID | Task | Owner | Depends on | Output and expected files |
|---|---|---|---|---|
| P3A-01 | Connect the storefront to the development store (link, env, channel per Q-003); document the env vars | shopify-hydrogen-developer | G-1, Q-003 | `storefront/.env` (ignored), `.env.example`, docs |
| P3A-02 | Finalise the data model and write the definitions-as-code script; apply to the development store | solution-architect | P3A-01, V-05 | `scripts/shopify/definitions.json`, `scripts/shopify/apply-definitions.mjs` |
| P3A-03 | Product sheet template and schema (model, brand, sizes, SKUs, prices, sale prices, specifications, delivery type, attributes, image names) | shopify-hydrogen-developer | P3A-02 | `scripts/catalog/template/*` |
| P3A-04 | Validator and validation report (missing, invalid, duplicate SKUs, unknown attribute values, image mismatches) | shopify-hydrogen-developer | P3A-03 | `scripts/catalog/validate.mjs` and unit tests |
| P3A-05 | Idempotent importer (dry run, upsert products, variants, metafields, prices, compare-at) | shopify-hydrogen-developer | P3A-04 | `scripts/catalog/import.mjs`, integration tests on the development store |
| P3A-06 | Image upload, ordering and alt text | shopify-hydrogen-developer | P3A-05 | importer module and report |
| P3A-07 | Brands and stores data import (store to Shopify location mapping) | shopify-hydrogen-developer | P3A-02, CLR-015 | `scripts/catalog/import-stores.mjs` |
| P3A-08 | Rule-based collections and filter configuration (Search and Discovery) per the approved category structure | shopify-hydrogen-developer | P3A-05, V-04 | collection rules spec, admin checklist |
| P3A-09 | Draft descriptions, bullets, SEO titles and meta descriptions from client facts; approval workflow | technical-writer | P3A-05 | drafts in the sheet, approval log |
| P3A-10 | Decide the delivery-zone source of truth and zip-list format (Q-008, V-06); accept the ADR | solution-architect | P0-07 | ADR |
| P3A-11 | Dry run and full run with the client's sheet; sampled field-by-field comparison; counts report | qa-engineer | P3A-05, CLR-014 | `progress/TEST_RESULTS.md` entry |
| P3A-12 | Phase gate review | project-manager | all | gate record |

## Dependencies and blockers

CLR-014 and CLR-015 gate P3A-11; sample data allows everything up to it. Q-008 gates P3A-10.

## Security considerations

Admin API token: custom app, minimum scopes (products, inventory read, metaobjects), stored only in environment variables and never printed; scripts refuse to run against a store whose domain is not in an explicit allow list; dry run is the default; production runs need explicit approval. Treat client spreadsheets as untrusted input (formula injection, oversized fields, HTML in descriptions: sanitise or reject).

## Testing

Unit: validator rules, mappers, price and compare-at logic. Integration: import to the development store twice (second run changes nothing), update run changes only edited rows. Manual: sampled comparison against the sheet; confirm a new product with the right attributes appears in the right collections and filters (REQ-CAT-005).

## Acceptance criteria

REQ-CAT-001 to REQ-CAT-006, REQ-CAT-009 and REQ-LOC-002 acceptance criteria met on the development store, then on the client's store once access is granted (a run on the live store requires explicit approval).

## Definition of done

Gates G1 to G8 ([MASTER_PLAN](../MASTER_PLAN.md#phase-gates)) plus: the data model document matches what is in the store; the validation report for the client's final sheet has zero errors.

## Review and sign-off

`code-reviewer` reviews the scripts; `security-engineer` reviews token handling and input sanitising; client approves category structure and drafted copy (CLR-017).

## Rollback and recovery

Import writes a run manifest (handles and IDs created or changed) so a run can be reverted by the same tool; take a Shopify product export before any live run. Never delete products in bulk without the manifest and approval.
