# Shopify data model (proposed)

Status: **proposal, 2026-10-11.** Names, types and limits must be verified on a development store in Phase 0 (V-04, V-05) and finalised in P3A-02. The definitions are created by `scripts/shopify/apply-definitions.mjs` from one JSON spec so the development and client stores are identical. All metafield and metaobject definitions that the storefront reads must have **Storefront API access** enabled *(verify)*.

Principles: one product per mattress model with one variant per size (SOW §8); store attributes once, on the product; let rules and filters read them so new products behave correctly without code; keep client-editable text in Shopify admin.

## Product

| Item | Where | Type | Used for |
|---|---|---|---|
| Size | variant option `Size` | option | size selector, add-on matching |
| Dimensions | variant metafield `custom.dimensions` | text | size selector, comparison |
| Comfort level | product metafield `custom.comfort_level` | single value from a list | filter, quiz, comparison, badges |
| Mattress type | `custom.mattress_type` | single value from a list | filter, quiz, comparison |
| Sleep positions | `custom.sleep_positions` | list of values | filter, quiz |
| Benefits | `custom.benefits` | list of values (cooling, pressure relief, back support, motion separation ...) | filter, quiz, comparison |
| Product line | `custom.product_line` | single value | filter |
| Height (inches) | `custom.height_inches` | number | comparison |
| Delivery type | `custom.delivery_type` | white-glove, parcel, both | delivery rules, haul-away eligibility |
| Specifications | `custom.specifications` | JSON or list of label and value | product page |
| Feature bullets | `custom.features` | list of text | product page |
| Brand | `custom.brand` | reference to `brand` metaobject (vendor kept for filters) | brand sections |
| Related add-ons | `custom.related_foundations`, `custom.related_protectors`, `custom.related_bedding` | list of product references | size-matched add-ons (REQ-ADD-001, REQ-CART-003) |
| Compare group | `custom.compare_group` | text | "similar products" in comparison |
| Extend eligibility | `custom.extend_category` | text (Extend category) | REQ-EXT-005 (shape confirmed by Q-005); coverage itself is not a product field: see the price-point products below |
| FAQs | `custom.faqs` | list of references to `faq` | product page |

Sale pricing uses the variant's compare-at price. Gift-with-purchase and bundle membership are expressed by Shopify discounts and offer rules (below), not by product fields.

## Metaobjects

| Definition | Fields (key: type) | Used for |
|---|---|---|
| `brand` | name, slug (required; lowercase, hyphenated, must equal the metaobject handle so the product importer can find the brand), logo (file, image), about (rich text), warranty_terms (rich text) | brand pages and product sections |
| `store` | name, slug, address lines, city, state, postal_code, latitude, longitude, phone, hours (JSON or list), photo, pickup_enabled, location_handle (maps to a Shopify location) | locator, my store, pickup availability |
| `faq` | question, answer (rich text), scope | collection and product FAQs |
| `homepage_section` | `type` (required; one of the eight values below), heading, body, image, link, `link_label` (optional), order (required whole number), enabled | homepage; editable and orderable (REQ-HOME-001) |
| `promo_tile` | collection (reference, required), position (required whole number, minimum 1), image, heading (required), link, enabled | collection grid tiles (REQ-COL-003) |
| `quiz_question` | order, text, help text, multi (boolean), options (list of `quiz_option`) | REQ-QZ-001, REQ-QZ-004 |
| `quiz_option` | label, scoring rules (list of attribute, value, weight, or filter, exclude flag) | REQ-QZ-003 |
| `offer_rule` | name, type (comfort_protector, haul_away, matching_protector, pillow, bedding, gift, bundle), trigger (collection or product), products (list of product references: the offered items, gift choices or bundle members), max_quantity (gift quantity or bundle member quantity; **not** the haul-away maximum), price_source, enabled | REQ-CAT-007, REQ-CAT-008, REQ-PRE-002/003 |
| `site_settings` | promo_bar text and link, **`haul_away_max`** (the single source of the haul-away maximum; the same number is set by hand in the Shopify Flow condition, and a reconciliation report compares them), financing copy, `extend_enabled` mirror (non-secret) | REQ-NAV-001, REQ-PRE-003 |
| `delivery_zone` | name, `postal_codes` (**text**, comma-and-space or line separated, up to 3,000 characters, the same format as Shopify Local delivery, `*` prefixes allowed), fee text, **`free_over`** (the single source of the free-delivery threshold: delivery quote, cart progress message and the Local delivery price rule), promise text per delivery type. **One entry for now** (owner decision, ADR-0007) | REQ-DEL-001/002, REQ-CART-004, REQ-PRE-003 |

### Homepage sections and promo tiles (as encoded in `scripts/shopify/definitions.json`)

`homepage_section.type` is a single-line text field limited to a fixed list of choices. The storefront code lists the same values (`HOMEPAGE_SECTION_TYPES`) and a test keeps the two in step.

| `type` value | Content it uses | Behaviour |
|---|---|---|
| `hero`, `promo-banner`, `financing` | heading, body, image, link and `link_label` | Shows the content entered in admin |
| `shop-by-size`, `featured`, `brands`, `categories` | heading, order and enabled only | Fills itself from the catalog; body, image and link are not used |
| `signup` | none yet | Reserved for the email and text-message signup (P7-02); shows nothing until it exists |

- `link_label` is optional text for the button. Left empty, the heading itself becomes the link. It exists so a link never needs generic wording such as "Learn more" (added in P3B-13).
- `order`: smaller numbers appear first; entries without a whole number go last. A section shows only when `enabled` is on.
- `link` (here and on `promo_tile`, and `site_settings.promo_bar_link`) is plain text, a relative path or an https URL, because Shopify's `url` type rejects relative paths. The storefront validates it against an allow-list (T-08).
- `promo_tile.position`: 1 puts the tile first; 4 makes it the fourth cell, counting products and tiles together. A tile whose position is beyond the products shown is held back until "Load more" brings enough products. The tile's heading is shown on the tile and used as the link text; without a valid link the tile is shown but is not clickable.
- `brand.slug` must equal the metaobject handle (see the table above). `custom.brand` on a product is a reference to a `brand` metaobject, and `vendor` is kept for filters.

Status: these facts are copied from `definitions.json`, which is checked against the Admin GraphQL 2026-10 reference but not yet applied to a development store (V-05).

The exact schema for `quiz_option` scoring and `offer_rule` triggers is finalised in P3A-02 after V-05; keep rules declarative (data), not code.

## Collections and filters

Rule-based collections by product type, brand, size availability and metafield values so new products sort themselves (REQ-CAT-005). Storefront filters (size, brand, product type, comfort, type, benefits, sleep position, product line, price) depend on which attributes are configured as filters in Shopify Search and Discovery *(verify V-04)*; the configuration is part of the import checklist.

## Menus, pages, blog

Shopify navigation menus drive the mega menu; Shopify pages hold the 15 content pages; the Shopify blog feeds the blog layouts.

## Service and add-on products

On the **Basic** plan (ADR-0006, ADR-0009): the Extend coverage products are **price-point variants** named `Extend-Protection-Plan-<price>` (at most 250), published to the headless channel and kept out of collections and search; the haul-away product ("Recycle and disposal service") is a single variant whose quantity is the number of pieces; gift products are normal variants made free by automatic discounts.


Haul-away ("Recycle and disposal service"), comfort-guarantee protectors per size, matching protectors, pillows, bedding, and the Extend coverage products (modelling per Q-005) are ordinary Shopify products, excluded from collections and search where appropriate, so they appear on orders as normal lines (SOW §5).

## Customer data

Quiz results saved to the account need a customer metafield writable through the Customer Account API *(verify V-08)*; if not possible, record the limitation and keep results device-only.

## Constraints to verify

Metaobject and metafield counts, field-type support in the Storefront API, rich-text rendering, list lengths, and filter limits (R-19, V-04, V-05).
