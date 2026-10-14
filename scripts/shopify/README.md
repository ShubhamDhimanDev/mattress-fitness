# Shopify definitions as code, and the delivery parity check

Two tools that keep the development store and the client's store identical and keep the delivery zone honest (P3A-02, P3A-10; REQ-CAT-005, REQ-LOC-002, REQ-DEL-001, REQ-DEL-002; ADR-0007). Both are tested against a simulated Shopify and have **not** yet run against a real store.

## definitions.json and apply-definitions.mjs

`definitions.json` is the single description of the data model in [SHOPIFY_DATA_MODEL](../../docs/architecture/SHOPIFY_DATA_MODEL.md): ten metaobject definitions (`brand`, `faq`, `store`, `quiz_option`, `quiz_question`, `homepage_section`, `promo_tile`, `offer_rule`, `site_settings`, `delivery_zone`) and seventeen metafield definitions (sixteen on products in namespace `custom`, plus `custom.dimensions` on variants). Every definition has Storefront API read access (`PUBLIC_READ`). Several product attributes are enabled as smart-collection conditions so rule-based collections work without code.

The allowed values (comfort levels, mattress types, delivery types) are the same lists the product sheet uses in `scripts/catalog/schema.mjs`; a test compares the two so they cannot drift apart. Shopify supports the `choices` validation only on single-value text, so `sleep_positions` and `benefits` (lists) are enforced by the sheet validator instead.

```
node scripts/shopify/apply-definitions.mjs --offline                 # plan against an empty store, no network
node scripts/shopify/apply-definitions.mjs --store x.myshopify.com   # dry run: reads the store, shows CREATE / exists / differs
node scripts/shopify/apply-definitions.mjs --store x.myshopify.com --live
```

- **Idempotent.** A definition that exists is left alone. If it differs from the spec (access, type, validations, fields) the difference is printed as `DIFF ...` and the exit code is 1, but the tool never modifies or deletes an existing definition. Change it by hand in admin or write a deliberate migration.
- Dry run is the default; `--live` needs `SHOPIFY_ALLOWED_STORES` to list the store and `SHOPIFY_ADMIN_API_ACCESS_TOKEN` to be set (see `scripts/catalog/README.md`, section 5). Without them it exits with code 3 before sending anything.
- One failing definition does not stop the others; failures are listed and the exit code is 1. Re-running creates only what is missing.
- Not done by this tool, on purpose: **Search and Discovery filter configuration**. The Admin API calls used here do not configure storefront filters; this stays a manual step in the import checklist (V-04).
- Field `type` of `homepage_section`, the shape of `quiz_option.scoring_rules` and the `offer_rule.price_source` values are intentionally open text or JSON until Phases 3B, 4 and 6 fix them; nothing invented.

## check-delivery-parity.mjs

Compares the ZIP codes covered by the `delivery_zone` metaobject with the postal codes in Shopify Local delivery, **wildcard-aware**: `100*` and the hundred explicit codes `10000` to `10099` are the same coverage.

```
node scripts/shopify/check-delivery-parity.mjs --zone zone-export.json --local local-delivery-export.json
```

Exit code 0 when the coverage is identical, 1 on drift or invalid entries, 2 when a file cannot be read. It prints what is only on one side, as ranges, and which entries are not fully covered by the other side. It also checks the 3,000-character limit of Local delivery (F-28) and flags entries that are not a 5-digit ZIP or a `nnn*` prefix (including a four-digit entry, which usually means a spreadsheet dropped a leading zero).

Input is JSON read from files, so it needs no credentials and is safe in CI. It accepts a bare array of codes, a text value, `{ "postal_codes": ... }`, a metaobject node with `fields: [{ key, value }]`, or those nested inside a larger export. The metaobject side must hold exactly one list (one zone, ADR-0007); the Local delivery side may have several zones, which are combined. Examples are in `sample/` (made-up ZIP prefixes): `delivery-zone.json` with `local-delivery.json` has parity, with `local-delivery-drift.json` it does not.

## Facts used and what is still unverified

Sources, read 2026-10-12 against the Admin GraphQL reference, version 2026-10: `metafieldDefinitionCreate`, `MetafieldDefinitionInput`, `MetafieldAccessInput` (storefront `NONE` or `PUBLIC_READ`), `MetafieldCapabilityCreateInput` (`smartCollectionCondition { enabled }`), `metafieldDefinitions`, `metaobjectDefinitionCreate`, `MetaobjectDefinitionCreateInput`, `metaobjectDefinitionByType`, and Shopify's list of validation options (the `choices` value is a JSON-encoded array).

| Item | Status |
|---|---|
| Scopes for the definition mutations and reads | UNVERIFIED(V-20). The reference names `write_metaobject_definitions` and `read_metaobject_definitions`; for metafield definitions it only says the app needs access to the namespace and resource type |
| `file_type_options` value format for file fields | UNVERIFIED(V-05): the validation exists; the exact accepted value (`["Image"]`) is confirmed on the first development-store run |
| `smartCollectionCondition` eligibility per type | UNVERIFIED(V-05): the capability is requested for text and list fields; Shopify may mark some types ineligible |
| Whether `metaobject_definition_type` is accepted instead of the id in `validations` | UNVERIFIED(V-05): the validation-options page documents both names; the diff treats a returned id and a requested type as equivalent |
| Storefront API behaviour of every field type (rich text, file, money, JSON) | UNVERIFIED(V-05) |
| Reading Local delivery postal codes through the Admin API | UNVERIFIED(V-06c): until then the Local delivery side is an export typed or copied from admin |
