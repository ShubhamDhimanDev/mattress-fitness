# Offer setup on the development store (P4-12 interim, PLACEHOLDER rules)

**Status: every step below is UNVERIFIED.** Nothing in this list has been run on a Shopify store; the development store `mattressfitness-1iakxuvz.myshopify.com` has one product and no discount (REAL_STORE_FINDINGS). The Shopify admin screens are described from Shopify's help pages read on 2026-10-23 and the labels may differ; correct this page with what you find.

**The rules are made up.** DEC-082 (owner decision 2026-10-23, still pending the client's real rules, CLR-011, Q-020): the gift is one free pillow of the shopper's choice with a queen-or-larger mattress over $999; the bundle is mattress + protector + pillow with a 10% automatic discount. They exist only for the development store and the tests. Never show them to shoppers as a real promotion, and never copy them to the client's store.

Files this page works with:

| File                                                                                         | What it is                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/catalog/sample/mattresses.csv`                                                      | the older made-up sheet (14 models). It supplies `cloudmere-hybrid`, used here for the add-on, protector and bundle rules only (it is NOT in the gift rule, see 4)               |
| `scripts/catalog/sample/offer-products.csv` and `offer-images.txt`                           | added for this task: 2 queen-or-larger mattresses and the 5 accessory products (7 models, 32 size rows); passes `node scripts/catalog/validate.mjs` with 0 errors and 0 warnings |
| `storefront/offer-config.example.json`                                                       | the example `OFFER_CONFIG_JSON`, with fake ids. The key `_placeholder` and the keys `_idScheme` and `_products` are notes: the parser ignores unknown keys                       |
| `storefront/tests/unit/offers-runtime/sample-config.test.ts`, `sample-config-offers.test.ts` | prove the sheets, the example configuration, the parser and the offer code agree (57 tests)                                                                                      |

## 1. What the sample catalog holds

| Handle                                       | Type               | Sizes (price, sale price where given)                                                 | Tag in admin | Used by                                                                   |
| -------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------- |
| `luxe-hybrid` (Halden Luxe Hybrid)           | Mattress           | Queen 1799, King 2099, California King 2099, Split California King 2499 (sale prices) | none         | gift, bundle, comfort guarantee, add-ons                                  |
| `luxe-foam` (Halden Luxe Foam)               | Mattress           | Queen 1199, King 1449, California King 1449 (sale prices)                             | none         | same                                                                      |
| `cloudmere-hybrid` (from `mattresses.csv`)   | Mattress           | Twin 999 to Split California King 1799                                                | none         | bundle, comfort guarantee, add-ons; no gift                               |
| `sample-foundation`                          | Foundation         | all 7 sizes, 199 to 399                                                               | none         | add-on (foundation), product-page slot                                    |
| `sample-protector`                           | Mattress Protector | all 7 sizes, 79 to 159                                                                | `offer-only` | comfort guarantee, bundle                                                 |
| `sample-pillow`                              | Pillow             | Queen 59, King 69                                                                     | none         | add-on (pillow), bundle (Queen variant)                                   |
| `sample-gift-pillow`                         | Pillow             | Queen 59, King 69                                                                     | `offer-only` | gift only                                                                 |
| `sample-sheets`                              | Bedding            | all 7 sizes, 89 to 189                                                                | none         | add-on (bedding)                                                          |
| `recycle-and-disposal-service` (**by hand**) | service            | one variant, $49.00                                                                   | `offer-only` | haul-away. Not in a sheet: a sheet row needs a Size, the service has none |

The importer does not add `offer-only` (catalog README); add it in admin after the import (admin guide 2.8). The gift pillow and the comfort/bundle protector are tagged because they exist for the cart; the normal pillow is also sold on its own and is not tagged. UNVERIFIED(V-05): the tag search and the sitemap exclusion.

The prices of a queen-or-larger `luxe-*` size are all above $999 whether the sale price or the regular price is taken. A test asserts it, so editing the sheet below $999 fails the build.

## 2. Create the products (UNVERIFIED)

Needs the written go-ahead for the target store and an Admin token in your shell only (catalog README section 5). Agents may not run `--live`.

1. `node scripts/catalog/validate.mjs scripts/catalog/sample/offer-products.csv --images scripts/catalog/sample/offer-images.txt` (expect PASSED, 0 errors, 0 warnings).
2. `node scripts/catalog/import.mjs scripts/catalog/sample/offer-products.csv --offline --images scripts/catalog/sample/offer-images.txt` (plan: 7 to create, 4 images to upload; the offline plan has run).
3. Import the older sheet too if you want `cloudmere-hybrid`: same commands with `mattresses.csv`.
4. Live, one product first: `... --store mattressfitness-1iakxuvz.myshopify.com --live --only sample-gift-pillow`, check it in admin, then the rest. The image files named in the sheets are not included (`--images <folder>` needs real files); create them or add the two mattresses' images by hand.
5. The importer links `related_*` handles only to products that exist (the older sheet names `sample-foundation`, `sample-protector`, `sample-pillow`, which now exist).
6. In admin, make every product Active and available to the Headless/Hydrogen sales channel, add the tag `offer-only` to `sample-protector`, `sample-gift-pillow` and the service, and put the mattresses in a `mattresses` collection (B6).
7. Create the service by hand: product "Recycle and disposal service", one variant, price $49.00, tag `offer-only`, Active, in the channel, no inventory tracking (or stock enough). Admin guide section 4.1 says never to add options to it.
8. Check, for each product, that the option is named exactly **Size** and the size values are the sheet's words (the rules match them).

## 3. Put the real ids into the configuration (UNVERIFIED)

The example holds fake ids in the scheme `gid://shopify/Product/7001` and `gid://shopify/ProductVariant/70014` (product number times 10 plus the size position: Twin 1, Twin XL 2, Full 3, Queen 4, King 5, California King 6, Split California King 7). The fake product numbers are:

| Handle                         | Product              | Handle               | Product |
| ------------------------------ | -------------------- | -------------------- | ------- |
| `luxe-hybrid`                  | 7001                 | `sample-protector`   | 7102    |
| `luxe-foam`                    | 7002                 | `sample-pillow`      | 7103    |
| `cloudmere-hybrid`             | 7003                 | `sample-gift-pillow` | 7104    |
| `sample-foundation`            | 7101                 | `sample-sheets`      | 7105    |
| `recycle-and-disposal-service` | 7106 (variant 71061) |                      |         |

1. Copy `storefront/offer-config.example.json` to a **git-ignored** file, for example `storefront/.offer-config.local.json` (the `.env.*` pattern is ignored; check with `git check-ignore -v <file>` before saving real ids; the ids are not secrets but the file is not part of the repository).
2. For every product and variant look up the real id (admin URL ends with the product number; the variant id is on the variant page) and replace each fake id. Do it with an exact-match search, one id at a time; a variant keeps its id when you edit it, but deleting and re-creating it breaks the rule (admin guide section 1).
3. Keep the notes. Change `_placeholder` only to say which ids are now real.
4. Check: `cd storefront && node -e "const t=require('node:fs').readFileSync('.offer-config.local.json','utf8');JSON.parse(t);console.log('valid json',t.length)"`. The parser drops a rule with a malformed id silently (a log line names the dropped entry), so also start the server and read the `offers.config_problem` log: there should be none.

### Setting `OFFER_CONFIG_JSON` without committing it

The variable holds one line of JSON, at most 100,000 characters (the example is 9,973 characters minified). It is not secret, but keep it out of the repository.

- **Local dev server** (DEV_DATA.md): write a git-ignored env file next to the others, from the file you made in 3, without printing it:
  `node -e "const fs=require('node:fs');const j=JSON.stringify(JSON.parse(fs.readFileSync('.offer-config.local.json','utf8')));fs.appendFileSync('.env.offers','OFFER_CONFIG_JSON='+j+'\n')"`
  then start with `npm run dev -- --port 3800 --env-file .env.offers`. `.env.offers` must also carry the four base variables and `DELIVERY_COOKIE_SECRET` (32 or more characters) as in `.env.demo`, plus `PUBLIC_GIFT_PICKER_ENABLED=true` **only for the V-03 test**.
  The env-file loader's treatment of quotes and of a very long line is UNVERIFIED: if the value does not arrive, the server logs `offers.config_absent`.
- **Production or the VPS**: the single line goes in the host's env file (`deploy/mattressfitness.env.example` shows `OFFER_CONFIG_JSON='<ONE_LINE_JSON>'`). Never commit the filled file. A missing or invalid value pauses checkout in production (DEC-030); `OFFERS_ENABLED=false` is the only "offers off" switch.
- Replace the fake `zone` with the real ZIP list, fee, free-over amount and approved wording when the client supplies them (Q-008, CLR-009). Until then it stays marked placeholder and the promise texts say so.

## 4. Discounts to create in Shopify admin (UNVERIFIED)

Count the active automatic discounts first (the cap of 25 is from secondary sources, F-31). Admin: Discounts, Create discount.

### 4.1 Gift: automatic "Buy X get Y"

Sources: Shopify help "Buy X get Y" (read 2026-10-23).

| Field                  | Value                                                                                                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Method                 | Automatic discount                                                                                                                                                                                                            |
| Title                  | `Free pillow with a queen or larger mattress (placeholder)`. The storefront does not match this title for gifts (it checks that the gift line costs $0), but it is what shoppers see on the line, and it equals the rule name |
| Customer buys          | Minimum quantity of items: 1, any items from Products: `luxe-hybrid`, `luxe-foam`. **Do not add `cloudmere-hybrid`**                                                                                                          |
| Customer gets          | Quantity 1, any items from Products: `sample-gift-pillow` (both sizes), at a discounted value: **Free**                                                                                                                       |
| Maximum uses per order | Set to 1. It must equal `maxQuantity` (1) in the rule: a second unit would be charged in full                                                                                                                                 |
| Combinations           | Allow combining with Product discounts (so the bundle discount can apply to the mattress on the same order). UNVERIFIED how two automatic discounts combine                                                                   |
| Active dates           | Start now, no end                                                                                                                                                                                                             |

Why "over $999" is expressed by the product list and not by a minimum amount: Shopify chooses products or collections, never variants, so "queen or larger" can only be true for a product that has no smaller size. `luxe-hybrid` and `luxe-foam` were made up that way (their cheapest size is $1,199 sale price). `cloudmere-hybrid` also has a Twin at $999 and smaller sizes, so listing it would give the gift on a Twin; a test pins that it is not in the rule. If you want a safety net, add "Minimum purchase amount" $999.01 (it counts only the "buys" products). That is UNVERIFIED.

Shopify does **not** add the free item to the cart (help page). Our server adds it when the shopper picks it, and the cart gate pauses checkout if Shopify prices it above $0. The picker is off until V-03 passes.

### 4.2 Bundle: automatic "Amount off products"

Sources: Shopify help "Amount off products" (read 2026-10-23).

| Field          | Value                                                                                                                                                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Method         | Automatic discount                                                                                                                                                                                                                                   |
| Title          | **exactly** `Sleep set 10% off (placeholder)`. This is `discountTitle` in all three bundle rules. The storefront shows the saving only when an automatic discount allocation with this title is on the lines (capitals and extra spaces are ignored) |
| Discount value | Percentage, 10                                                                                                                                                                                                                                       |
| Applies to     | Specific products: `luxe-hybrid`, `luxe-foam`, `cloudmere-hybrid`, `sample-protector`, `sample-pillow`                                                                                                                                               |
| Minimum        | Minimum quantity of items: 3 (Shopify counts only the selected products)                                                                                                                                                                             |
| Combinations   | as in 4.1                                                                                                                                                                                                                                            |
| Active dates   | Start now, no end                                                                                                                                                                                                                                    |

**Known gap, native discounts cannot close it (not an engine defect):** Shopify cannot require "one of each". Any three units of the five products earn 10% off **all** of them: for example a mattress, two protectors and no pillow, or three pillows. The storefront only shows a saving figure, and only offers Add all, for a cart with the whole set, so what a shopper is told is right; what Shopify charges for a hand-built cart may differ from what the bundle name suggests. Treat it as a placeholder limitation and raise it when the client's real bundle rule arrives (SD / change request if it needs a Function, which Basic cannot run). Also: the protector and pillow share the product with the same items sold on their own, so the 10% applies to them too; the mattress is discounted along with them.

Every size of the mattress gets a protector of the same size, but the bundle's pillow is always the **Queen** pillow variant (`sample-pillow`): a King shopper is offered the Queen pillow in the bundle. Change the rule to `by-size` if that is not wanted; the product has only Queen and King, so a Twin would then have no pillow and the bundle would be "unavailable" for it.

### 4.3 Local delivery for the same ZIP list and the free-over amount

Admin: Settings, Delivery and shipping, Local delivery for the location. Admin guide section 8.2 has the full procedure.

1. Postal codes: `60601, 60602, 60603, 60645` (the same list as `zone.postalCodes`, entries separated by a comma and a space).
2. Delivery price $149.00 (`feeCents` 14900); a price rule making it **free from a minimum order of $999.00** (`freeOverCents` and `freeDelivery.thresholdCents`, 99900). The storefront treats free delivery as starting AT the threshold; whether Shopify's minimum is "at or above" is UNVERIFIED (V-06).
3. Everything in a local-delivery order must come from one location with stock, and Local delivery does not combine with shipped items (F-28, SD-04).
4. Parity: export `zone.postalCodes` as the zone file and copy the Local delivery list into the second file, then `node scripts/shopify/check-delivery-parity.mjs --zone zone-export.json --local local-delivery-export.json` (exit 0 = identical). Samples are in `scripts/shopify/sample/`.

## 5. Verification to run once the owner has an Admin token (all UNVERIFIED)

Each experiment is on the development store only (V-26: a development store is not plan-gated, so a pass proves behaviour, not that Basic allows it). No real payment: stop at Shopify's hosted checkout; the Online Store password must be off to reach it (REAL_STORE_FINDINGS). Record results in `progress/TEST_RESULTS.md`, update `READINESS_CHECKLIST.md` (IR-07, IR-08) and the V rows of `TECH_FEASIBILITY.md`.

### V-03: automatic discounts in a Storefront-API cart (gates the gift picker and the bundle saving; READINESS IR-07)

1. With `PUBLIC_GIFT_PICKER_ENABLED=true` and the real-id config, add a `luxe-hybrid` Queen to the cart. Expect: the gift picker offers the two pillow sizes.
2. Pick one. Expect: a gift line at **$0.00** carrying the discount title, cart subtotal unchanged. If the line is charged, the gate pauses checkout ("a gift is not showing its promotion price"): that proves the safety net and is also the answer "the assumption is wrong" (V-27a).
3. Compare the cart with Shopify's checkout page line by line (admin guide 3.5): same prices, same discount lines, gift still $0.00.
4. Remove the mattress: the gift must leave with it (our orphan rule).
5. Add the whole set via **Add all** on a Queen. Expect the discount allocation title `Sleep set 10% off (placeholder)` on the three lines and the cart showing the saving; remove one item and expect the saving to disappear. Repeat with a discount code on top, then with a differently titled automatic discount, and expect no bundle saving figure.
6. Record: whether the two automatic discounts combine, whether the allocation `title` is exposed in the Storefront API cart, the hand-built "three pillows" case of 4.2, the active automatic discount count and the 25 limit.

### V-27: the assumptions built into the code (the tags the code carries)

(a) the gift's price is a **line-level** automatic discount and its title is readable (step above); (c) `products(query: "tag:offer-only OR tag:extend-coverage")` returns products hidden from search, and the tag or `seo.hidden` keeps them out of the sitemap (`/sitemap.xml` after the import); (e) `delivery_choice` and the `offer_declined_*` attributes reach a test order as custom attributes (V-20); (f) `cartAttributesUpdate` replaces or merges (the code always writes the full list); (g) `Cart.updatedAt` resolution for the picker's compare-then-act re-read: add a gift and an add-on in the same second from two tabs and see whether the second is refused (`cart-changed`).

### V-02 and V-16: nested lines (only the Extend coverage line uses them)

On a coverage-less store this cannot run; the add-on, gift and bundle lines in this checklist are **not** nested. When Extend's mock/sandbox is on: add an item with protection; change the parent's quantity; remove the parent; reload; open the order after a test checkout and see whether the parent relationship and the line properties survive (EXTEND.md items for V-16). Until then these stay BLOCKED (READINESS IR-08).

### Other checks this setup enables

- Add-ons: on a Queen `luxe-hybrid` page the foundation slot shows `sample-foundation` Queen; change size to King and the list follows. In the cart picker the pillow appears once and the sheet set matches the size.
- Comfort guarantee: a Queen `luxe-foam` asks for the Queen protector; after adding, the step is answered; in a bundle cart the protector counts, no second question.
- Haul-away: save ZIP `60645`, choose in-home, expect the service at $49.00 with a 2-piece maximum; ZIP `90210` or pickup offers nothing; a hand-edited quantity 3 is cut to 2 before checkout.
- Free-delivery message: a subtotal under $999 shows the remaining amount; at exactly $999.00 it reads reached. A $999 Twin `cloudmere-hybrid` is exactly on the line.

## 6. What the automated test proves, and what it does not

Proves (mock-green, 57 tests, `storefront/tests/unit/offers-runtime/sample-config*.test.ts`): the example parses with no dropped entry, also as one env line; every fake id points at a real sheet row and size; the keys and the variant sizes agree; the gift qualifies only products whose every size is queen-or-larger and above $999; the gift appears, hides a sold-out choice, is accepted at $0, blocks checkout when charged, is removed without its mattress and is cut to one; the bundle shows the saving only for the titled automatic discount (not for a code or another title), and with no discount nothing; add-ons match the size for every mattress size; haul-away is capped at 2, refused for pickup, no choice, outside the zone and no ZIP; the free-delivery message and its threshold; a mixed cart in production is not blocked or repaired.

Does not prove: any Shopify behaviour. The cart is an in-memory fake, the Storefront answers come from the sheets, the discount allocations are made up in the fixtures, and no discount exists on any store. The sheets' prices and the fake ids carry no meaning for the client.
