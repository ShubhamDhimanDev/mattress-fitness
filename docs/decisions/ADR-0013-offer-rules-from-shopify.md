# ADR-0013: Offer rules are read from Shopify, not from environment variables

- Status: Accepted by the owner (2026-11-06). Not yet verified against a Shopify store (V-03, V-05 and the new V-30).
- Supersedes: the `OFFER_CONFIG_JSON` seam described in ADR-0003 section "rules" and `app/lib/offers-runtime/config.ts` (P4-12 interim).
- Related: ADR-0003 (offers before checkout), ADR-0006 (Basic plan, detective enforcement), ADR-0007 (one delivery zone), `docs/integrations/OFFER_SETUP_DEVSTORE.md`.

## Context

Offer rules (which products unlock a gift, which add-ons fit which mattress, the haul-away service, the delivery zone) lived in three environment variables: `OFFER_CONFIG_JSON` (one line of JSON), `OFFERS_ENABLED` (the off switch) and `PUBLIC_GIFT_PICKER_ENABLED`. Staff could not change a rule without a developer editing the host environment and redeploying. The owner asked that offers be made directly in Shopify, through discounts, with no offer variables.

Facts that shape the answer (to be re-checked on the store, V-30):

- The Storefront API cannot read discount definitions. The Admin API can (`discountNodes`, scope `read_discounts`).
- The project already holds a server-only, read-only Admin token (`SHOPIFY_ADMIN_API_ACCESS_TOKEN`) for the order sync and the detective check.
- A Buy X get Y automatic discount already carries what a gift rule needs: the qualifying products or collections, the gift product, the quantity and 100% off.
- Bundles, add-ons, haul-away and the delivery zone are not expressed by any discount; they need data. The `offer_rule` and `delivery_zone` metaobjects were already defined for that (P3A-02).

## Decision

1. **Gifts come from active automatic discounts, in two shapes.** (a) An "Amount off products" discount at 100% off specific products with no minimum requirement makes those products gifts offered with any purchase (owner, 2026-11-06: "if a product is 100% off or free, it should show as a gift"); the cap is one per order. Other percentages, fixed amounts, collections and minimum requirements are not gifts (a minimum requirement is skipped with a warning). (b) A Buy X get Y discount, below.

   Buy X get Y: One gift rule per discount: `customerBuys` (a minimum quantity of 1 of specific products or collections) qualifies, `customerGets` (a fixed quantity of specific products, 100% off) is the gift, its variants are keyed by the `Size` option (a product without sizes uses its variant title, "Default Title" reads as "Standard"). `maxQuantity` is the get quantity times "maximum uses per order" (1 when unset), which is never more than Shopify discounts. A discount the engine cannot honour is skipped with a value-free warning rather than offered and then charged: a spend condition, a buy quantity above 1, less than 100% off, or "all products". The gift picker is no longer behind a flag.
2. **Everything else comes from metaobjects.** `offer_rule` entries (types `foundation`, `matching_protector`, `pillow`, `bedding`, `comfort_protector`, `haul_away`, `bundle`; trigger product or collection; offered products; maximum quantity; `discount_title` for bundles) and one `delivery_zone` entry (postal codes, `fee`, `free_over`, promises). Variants are matched per `Size` from the products' variants. The free-delivery threshold is `delivery_zone.free_over` (one source). Type `gift` in `offer_rule` is ignored with a warning.
3. **One reader, server side, with the existing Admin token** (scopes `read_discounts`, `read_metaobjects`, `read_products`): `app/lib/offers-runtime/shopify-rules.ts` (I/O, cache) and `shopify-rules-map.ts` (pure mapping). The mapped JSON still goes through `parseOfferConfig`, so every id and count is validated and a malformed rule is dropped. Answers are cached per store for 60 seconds, shared by concurrent requests; a failed refresh keeps the last good rules and retries after 10 seconds.
4. **Fail open (owner choice, 2026-11-06).** Without an Admin token, or when Shopify cannot be read and nothing good was ever loaded, there are no offers and no delivery zone; the cart and checkout keep working. This replaces the earlier "production pauses checkout when the rules are missing" rule. The problem is logged once by name (`offers.config_problem`, an error in production). The detective check still reports orders as "not judged" when no rules were available.
5. **Turning an offer off** is done in Shopify: end or deactivate the discount (gifts), or set `enabled` to false or delete the entry (other offers). There is no environment switch.
6. **Removed:** `OFFER_CONFIG_JSON`, `OFFERS_ENABLED`, `PUBLIC_GIFT_PICKER_ENABLED`, the `--no-offers` option of `scripts/setup/demo-env.mjs`, and the `.offer-config.local.json` flow.

## Consequences

- Staff create a gift by creating the discount; no developer, no redeploy, no variant ids to copy. Changes reach shoppers within about a minute.
- The cart and product pages now wait on a cached Shopify read. A cold isolate adds one to four Admin calls (about 150 ms to 1 s) to its first request; the 4-second timeout bounds an outage.
- Fail open means that during a Shopify read outage on a fresh isolate a gift, protector or service line looks like an ordinary line to the engine until the rules load. The detective check and the 'gift not free' gate remain as the safety net; the owner accepted this.
- The Admin token gains three read scopes; it stays read-only and server-only. A dev server on mock.shop has no token, so it shows no offers (as before).
- A gift whose Shopify discount is mis-set up (for example 90% off) is not offered at all. The reason is in the log, not on the page.
- The scope of discounts the reader recognises is deliberately narrow. Wider forms (spend thresholds, quantity tiers, Functions) are change requests, not code in the storefront.
- UNVERIFIED until run on a store: the `discountNodes` search filter (`status:active method:automatic type:bxgy`), the field names of the 2026-10 Admin schema used in the queries, and the metaobject field value formats (V-30).
