# Local development against the dev store: what was run, step by step

Written 2026-10-26 from a real run against the owner's development store (`mattressfitness-1iakxuvz.myshopify.com`). Every command below was run; where the output matters it is quoted. No secret appears here. Development only: no deployment is covered (see [DEPLOYMENT](DEPLOYMENT.md), [DEMO_STORE_SETUP](DEMO_STORE_SETUP.md)).

All commands run in **Git Bash** from the repository root unless a step says otherwise. Git Bash loads Node 22 through fnm; if `node -v` is not v22, run `eval "$(fnm env --shell bash)" && fnm use 22` first.

## 0. What goes where

| Value | Where it lives | Used by |
|---|---|---|
| `PUBLIC_STORE_DOMAIN`, `PUBLIC_CHECKOUT_DOMAIN`, `PUBLIC_STOREFRONT_API_TOKEN`, `SESSION_SECRET`, `DELIVERY_COOKIE_SECRET` | `storefront/.env.demo` (git-ignored) | the storefront (`--mode demo`) |
| Dev Dashboard app client id and secret | the shell, or `storefront/.env.demo` as `ADMIN_CLIENT_ID` and `ADMIN_CLIENT_SECRET` (a local-only convenience; rotate them after, see section 9) | `scripts/setup/with-admin-token.sh` |
| Admin API token (24 hours) | the process environment only, made by the helper in step 3 | `scripts/shopify/*`, `scripts/catalog/*`, `scripts/setup/demo-collection.mjs` |

The root `.env.example` is a list of names only; nothing reads it.

## 1. Store and app prerequisites (browser, once)

1. Online Store password: a development store cannot remove it, so keep it and enter it when the browser reaches the store's `/password` page (section 7b). A store that allows removal: admin, Online Store > Preferences.
2. Hydrogen (or Headless) channel installed; its storefront gives the public Storefront token.
3. Dev Dashboard (dev.shopify.com) > Create app: App URL `https://shopify.dev/apps/default-app-home`, untick "Embed app in Shopify admin", no redirect URLs. Scopes:
   `read_products,write_products,read_metaobjects,read_metaobject_definitions,write_metaobject_definitions,write_publications,write_files`. Create, **release a version**, **install** on the store (same organisation as the store).
4. Copy the Client ID and Client Secret from the app's Settings.

## 2. Start the storefront

```bash
cd storefront
npm run dev -- --port 3400 --mode demo
```

Open http://localhost:3400. `--mode demo` makes Vite read `storefront/.env.demo`. Hydrogen caches store reads (including a "not found") in memory, so **restart the dev server after you change store data**; otherwise a page requested before a product was published keeps answering 404.

## 3. Get an Admin token for the scripts

```bash
bash scripts/setup/with-admin-token.sh <command> [args...]
```

It exchanges the client id and secret for a 24-hour token (client credentials grant, `POST https://<store>/admin/oauth/access_token`), exports `SHOPIFY_ADMIN_API_ACCESS_TOKEN` and `SHOPIFY_ALLOWED_STORES` for the command it runs, prints only `token ok (length 38); scopes: ...`, and writes nothing. Typical failures: `application_cannot_be_found` (app not installed on this store, or wrong client id), `shop_not_permitted` (app and store are in different organisations).

Git Bash quirk found on this machine: piping into `node -e` inside `$(...)` prints "stdin/stdout is not a tty" and returns nothing; the helper therefore parses with `sed`.

## 4. Create the data model

```bash
bash scripts/setup/with-admin-token.sh node scripts/shopify/apply-definitions.mjs --store mattressfitness-1iakxuvz.myshopify.com          # dry run
bash scripts/setup/with-admin-token.sh node scripts/shopify/apply-definitions.mjs --store mattressfitness-1iakxuvz.myshopify.com --live   # applies
```

First dry run: 8 to create, 22 already present (an earlier attempt had created part of it). The first live run **failed on 8 of 8** and exposed three real defects, fixed on 2026-10-26 (tests in `scripts/shopify/apply-definitions.test.mjs`):

1. **Descriptions over 255 characters** (`store.time_zone`, `store.location_handle`, `homepage_section.type`, the customer `quiz_result` metafield): shortened in `definitions.json`; `validateSpec` now rejects any description over 255.
2. **References by type are not accepted.** Shopify wants `metaobject_definition_id` (a gid) in the validation. `resolveReferences` in `apply-definitions.mjs` now swaps each `metaobject_definition_type` for the id of the existing or just-created definition, in spec order; a reference to a type that does not exist is reported, not sent.
3. **The customer metafield `custom.quiz_result` is refused**: `Access denied for metafieldDefinitionCreate ... API client to have access to the namespace and the resource type`. The app needs a customer scope (`read_customers,write_customers`; not yet tried). Add it in the Dev Dashboard, release a new version, approve it on the store, then re-run `--live`. Until then only the account quiz save (REQ-QZ-005) is affected.

Second live run: 7 created. A re-check shows `Plan: 1 to create, 29 already in sync` (the customer field). After the owner added `write_customers` to the app and released a new version (the token's scopes then listed `write_customers`; no extra approval step was needed on this store), a third `--live` run created the last definition: `Created 1 definition(s)`, and a re-check shows `Plan: 0 to create, 30 already in sync`. So the store accepts a customer-account READ_WRITE metafield in namespace `custom` (part of V-08; sign-in itself is still untested).

## 5. Add the sample products

Placeholder images (the sample sheet names files that are not in the repository; these are labelled "DEMO PLACEHOLDER", for a dev store only):

```bash
python scripts/setup/make-demo-images.py scripts/catalog/sample/images.txt <folder outside the repo>
```

Find the sales channel's publication id (the storefront shows only products published to it). On this store the channel is named after the Hydrogen storefront (`mattress fitness 1`, `gid://shopify/Publication/211954434119`):

```bash
bash scripts/setup/with-admin-token.sh bash -c 'curl -s "https://$STORE/admin/api/2026-10/graphql.json" -H "Content-Type: application/json" -H "X-Shopify-Access-Token: $SHOPIFY_ADMIN_API_ACCESS_TOKEN" -d "{\"query\":\"{ publications(first: 20) { nodes { id name } } }\"}"'
```

Validate, plan (reads the store, writes nothing), import one product, then the rest:

```bash
node scripts/catalog/validate.mjs scripts/catalog/sample/mattresses.csv                       # PASSED: 80 rows, 14 models
bash scripts/setup/with-admin-token.sh node scripts/catalog/import.mjs scripts/catalog/sample/mattresses.csv --store mattressfitness-1iakxuvz.myshopify.com
export IMG=<images folder> PUB=gid://shopify/Publication/211954434119
bash scripts/setup/with-admin-token.sh bash -c 'node scripts/catalog/import.mjs scripts/catalog/sample/mattresses.csv --store "$STORE" --images "$IMG" --publication "$PUB" --live --only cloudmere-firm'
bash scripts/setup/with-admin-token.sh bash -c 'node scripts/catalog/import.mjs scripts/catalog/sample/mattresses.csv --store "$STORE" --images "$IMG" --publication "$PUB" --live'
```

Results: first live import without `--publication` created the product (`Done: 1 created`) but the storefront answered 404 (not on the channel); with `--publication` it updated (`1: publication`) and, after a dev-server restart, the page answered 200. The full run created 13 more (`Done: 13 created, 0 failed`). The importer writes a run manifest to `scripts/catalog/.runs/` (git-ignored). Notes it printed and that are expected: brand links skipped (no brand metaobject entries yet, P3A-07), related foundation, protector and pillow products not found (not in the sheet). Five products have unapproved copy and import as drafts.

## 6. The `mattresses` collection

```bash
export PUB=gid://shopify/Publication/211954434119
bash scripts/setup/with-admin-token.sh node scripts/setup/demo-collection.mjs
```

Output: `collection 351161876551: 14 products, published`. Idempotent. Not done: Search & Discovery filters (a manual step in admin, V-04).

## 7. Check the storefront

Restart the dev server first (section 2), then:

```bash
for p in "" collections/mattresses collections/all products/cloudmere-firm products/ashgrove-spring "search?q=queen" compare quiz stores delivery brands policies/privacy-policy; do
  echo "/$p -> $(curl -s -o /dev/null -w '%{http_code}' "http://localhost:3400/$p")"; done
```

Result on 2026-10-26: all 12 answered 200; the home, both collections, both product pages, search and compare contain the product names (the real store's data); quiz, stores, delivery and the privacy page render without store data (those read built-in sample data or content the store does not have yet). Checked by status code and page text only; **not looked at in a browser**, so layout, images, add-to-cart and checkout are still to be seen by a person (open http://localhost:3400).

### 7b. Add to cart and hosted checkout, in a browser (Playwright MCP, 2026-10-26)

The store's Online Store password cannot be removed on a development store, so it stays on (this replaces "remove the password" in section 1 for this store; B-25). The owner gave the password in chat; it is not recorded in any file. What was done, by hand in a browser:

1. Open http://localhost:3400/products/cloudmere-firm: the page shows the real product (brand, firm, hybrid, back support, $949.00, "In stock", SKU, Twin XL to California King, specifications from the metafields, two images).
2. Click **Add to cart** (default size Twin XL): the drawer opens with the line, a size selector, a quantity stepper, a discount code box and a subtotal of $949.00.
3. Click **Checkout**: the browser leaves for `https://<store>.myshopify.com/password` (the store password page, not our code).
4. Type the store password and press Enter. Shopify then sends the browser to the store's front page, not to the checkout.
5. Open http://localhost:3400/checkout-steps again: it hands off to Shopify's hosted checkout (`/checkouts/cn/...`). The order lines show Cloudmere Firm, Twin XL, quantity 1, $949.00; Subtotal $949.00; Total USD $949.00. **Cart subtotal equals checkout total for this one product with no delivery, which is only a first data point** for the cart-equals-checkout check (shipping, tax and offers are not in play). Nothing was entered in the payment fields and no order was placed.

Not working or not checked: clicking the size radio with Playwright timed out because the radio input is visually hidden (`sr-only`) behind its label, so a test must click the label; the browser console shows one dev-only React warning ("Extra attributes from the server: nonce") on every page, which does not appear in a production build and was not investigated.

## 7c. Offer products and the offer configuration (P4-12 interim, placeholder rules)

```bash
SP=<scratch folder>
python scripts/setup/make-demo-images.py scripts/catalog/sample/offer-images.txt $SP/offer-img
node scripts/catalog/validate.mjs scripts/catalog/sample/offer-products.csv --images $SP/offer-img      # PASSED: 32 rows, 7 models
export IMG=$SP/offer-img PUB=gid://shopify/Publication/211954434119
bash scripts/setup/with-admin-token.sh bash -c 'node scripts/catalog/import.mjs scripts/catalog/sample/offer-products.csv --store "$STORE" --images "$IMG" --publication "$PUB" --live'
bash scripts/setup/with-admin-token.sh node scripts/setup/demo-offers.mjs
```

The import created 7 products (`Done: 7 created, 0 failed`). `demo-offers.mjs` tagged `sample-protector` and `sample-gift-pillow` `offer-only`, created and published the "Recycle and disposal service" product ($49.00, tag `offer-only`), and wrote `storefront/.offer-config.local.json` (git-ignored): `offer-config.example.json` with every placeholder id replaced by the real one (49 ids, 0 left as placeholders). The rules themselves are still the made-up placeholders (DEC-082).

Run a second dev server with the offers on port 3800 (`.env.offers` is git-ignored and holds the same base variables as `.env.demo`, without the admin client id and secret, plus the one-line `OFFER_CONFIG_JSON`; build it without printing the values):

```bash
cd storefront
grep -v -E "^(ADMIN_CLIENT_ID|ADMIN_CLIENT_SECRET|OFFER_CONFIG_JSON)=" .env.demo > .env.offers
node -e "const fs=require('node:fs');fs.appendFileSync('.env.offers','OFFER_CONFIG_JSON='+JSON.stringify(JSON.parse(fs.readFileSync('.offer-config.local.json','utf8')))+'\n')"
npm run dev -- --port 3800 --mode offers
```

Seen in a browser on http://localhost:3800 (2026-10-26, Playwright MCP, desktop):

1. `/products/luxe-hybrid?Size=Queen`: sale price $1,799.00 against $1,899.00, "Save $100 (5%)"; the add-ons panel loads "Quillmoor Sample Foundation, Queen, $279.00" with an "Add with mattress" button. The value comes from the real store, so the add-ons route works on real data for the first time.
2. **Add to cart**: the cart drawer shows the mattress, a "Complete your set" bundle with the real protector ($119.00) and pillow ($59.00), and add-ons: foundation $279.00, pillow $59.00, sheets $139.00.
3. **Add missing items** (the bundle): 3 lines, subtotal $1,977.00 (1,799 + 119 + 59).
4. `/checkout-steps`: the browser goes to the store's password page, then (password entered) to hosted checkout. Checkout lists the pillow, the protector and the mattress; **Subtotal 3 items, Total USD $1,977.00, the same as the cart.** The offer lines arrive as ordinary order lines (ADR-0003).

**Not done, needs an owner action:** the discounts. No automatic discount exists, so the bundle shows no saving and the gift is not offered (the gift picker stays off, `PUBLIC_GIFT_PICKER_ENABLED` unset). Create them in admin by hand (OFFER_SETUP_DEVSTORE section 4.1 gift, 4.2 bundle) or add the `write_discounts` scope to the app and tell me; then V-03 (do the two automatic discounts show up in a Storefront API cart and combine?) can run. Also still manual: Local delivery for the ZIP list (section 4.3), which the delivery step and the haul-away step depend on (no ZIP was saved in this run, so those steps were skipped).

## 7d. Discounts, delivery and haul-away on the dev store (2026-10-26, after the owner created the discounts by hand)

Set `PUBLIC_GIFT_PICKER_ENABLED=true` in `storefront/.env.offers` and restart the 3800 server (`npm run dev -- --port 3800 --mode offers`). The app has no `read_discounts` scope, so the discounts could not be listed by script; they were judged only through the cart.

Browser run (Playwright MCP, desktop, `luxe-hybrid` Queen):

1. **Gift alone (V-03, part).** Add to cart: the gift picker appears ("Free pillow with a queen or larger mattress (placeholder)", Queen and King pillows). "Add gift to cart": the gift line is **$0.00** with the allocation title and amount in the Storefront API cart (`Free pillow ... (placeholder): -$59.00`).
2. **Bundle (V-03, part).** "Add missing items" adds the real protector and pillow: all three members carry `Sleep set 10% off (placeholder)` with the exact amounts (pillow $59.00 to $53.10, protector $119.00 to $107.10, mattress $1,799.00 to $1,619.10), shown on the cart lines, with "Savings on these items: $197.70".
3. **The two automatic discounts do NOT combine as configured.** With the bundle applied the gift line went back to **$59.00**. The project's gate worked as designed: the cart showed "Checkout is on hold: a gift in your cart is not showing its promotion price right now" and blocked the hand-off. To fix: in admin, on both automatic discounts (the gift "Buy X get Y" and the bundle "Amount off products") open Combinations and tick **Product discounts**, then run steps 1 to 3 again. Not yet retested.
4. **Delivery.** `/delivery`, ZIP 60601: "In-home delivery is available to 60601" (the `zone` in the offer configuration). `/checkout-steps` then shows the delivery choice (In-home delivery or Store pickup) and the haul-away step with the **real** service product: "Recycle and disposal service, $49.00 per piece, up to 2 pieces", "Add to my order" / "No thanks".
5. **Hosted checkout** (after the store password page): lines Recycle and disposal service $49.00, pillow $53.10, protector $107.10, mattress $1,619.10, each with the discount code title and amount; **Total USD $1,828.30, equal to the cart** (49.00 + 53.10 + 107.10 + 1,619.10). The shipping fee was not checked (no address was entered), so whether Local delivery for these postal codes prices and frees delivery as the placeholder rules say is still open. No payment was entered and no order was placed.

**Retest after the owner ticked "Product discounts" under Combinations on both discounts (same day): still not combined.** Probed three ways, all with the same result:

- the app (gift picker then "Add missing items", and again with the gift removed and re-added after the bundle): the gift line stays at $59.00 and checkout stays on hold;
- the Storefront API directly (a throwaway script creating carts: mattress + gift = total 1,799.00 with the gift at $0.00; mattress + protector + pillow = 1,779.30 with `Sleep set 10% off (placeholder)` on all three; all four lines = 1,838.30, the gift at $59.00 with **no** discount allocation);
- **Shopify's hosted checkout for that same four-line cart**: gift pillow $59.00 with no discount, the three bundle lines discounted, total USD $1,838.30. So the Storefront API cart and checkout agree, and the cart gate is right to pause.

Reading: the mattress is both the "customer buys" item of the gift discount (it shows the gift's allocation at $0 when alone) and a discounted item of the bundle, and Shopify lets only one discount win on that line ("One per product, best value wins"), which here also drops the gift. Ticking the combination boxes does not change that. The placeholder gift rule and the placeholder bundle rule therefore cannot both apply to the same mattress as built. Options for the owner to choose (the rules are made up, DEC-082, so this is a placeholder design question, but the client's real gift and bundle offers may hit the same limit, so it matters): (a) make the gift an "Amount off products" 100% discount on the gift pillow only, with a minimum purchase amount of $999 (every queen-or-larger sample mattress costs more), so the two discounts touch different lines; (b) exclude the mattress from the bundle discount; (c) accept that a cart gets the gift or the bundle, not both, and have the gift picker hide itself when a bundle is complete. (a) is the least change. Record the outcome in `docs/research/BASIC_PLAN_WORKAROUNDS.md` and `OFFER_SETUP_DEVSTORE.md` section 4 once decided.

**Resolved the same day (V-03, gift and bundle together).** Two attempts to rebuild the gift discount failed first, and both are worth knowing: (1) an "Amount off products" 100% discount whose "Applies to" was the mattresses put the mattress at $0.00; (2) one whose "Applies to" was the normal pillow (`sample-pillow`) with a $999 minimum purchase never applied, because the dollar minimum of an amount-off-products discount counts **only the selected products** ("Applies only to selected products"), so a $59 pillow can never reach $999. **Working setup:** the gift is an automatic "Amount off products" discount, 100% off, "Applies to" only the **Quillmoor Gift Pillow** (`sample-gift-pillow`), **no minimum requirements**, All customers, Combinations: Product discounts; the bundle is the 10% discount on the three mattresses, the protector and the sample pillow with a minimum quantity of 3 and Combinations: Product discounts (unchanged). Results: Storefront API carts: mattress + gift = 1,799.00 with the gift at $0.00 and the discount title on it; all four lines = 1,779.30 with the gift at $0.00 and the bundle on the other three. App: the gift line $0.00 (`-$59.00`), the bundle lines discounted, "Savings on these items: $197.70", **no checkout hold**. Hosted checkout: gift pillow "Free" with the gift discount code title, the three bundle lines at 10% off, **Total USD $1,779.30, equal to the cart**. Cost of this setup: Shopify no longer requires a mattress for the gift (the first buy-X-get-Y did); the storefront still does (the picker shows only with a qualifying mattress and the gift leaves with it), and a cart built directly through Shopify's API could carry the gift pillow free without a mattress, which is the detective-only case of ADR-0006 (the post-order check should flag it). Questions left for the client's real rules: whether the gift must depend on a specific mattress, which this setup cannot express. Not tested here: that the gift leaves when the mattress is removed, and the order check on a placed order.

Notes: the haul-away click takes about 5 seconds before the browser leaves for checkout (dev server, not measured further). The store password page appears again in each new browser session.

## 7e. Orphan rule, the comfort step, decline recording and delivery prices at checkout (2026-10-26, Playwright MCP, desktop)

1. **A gift leaves with its mattress.** Queen Luxe Hybrid + gift in the cart, then "Remove Halden Luxe Hybrid from cart": the cart emptied (the gift went with it). Passes on the real store.
2. **Comfort-guarantee step.** With a mattress and no protector, `/checkout-steps` opens "Protect your comfort guarantee" with the real protector in the mattress's size (Queen, $119.00) and "Add to my order" / "No thanks".
3. **Decline recording.** After "No thanks" on the comfort step, "In-home delivery" on the delivery choice and "No thanks" on haul-away, a second visit to `/checkout-steps` went straight to the hosted checkout without repeating any step, so the decisions are remembered in the cart (the cart attribute write, P4-10, works on a real cart; whether the attribute is on the order in admin was not looked at).
4. **Shipping options in Shopify's checkout for ZIP 60601** (fake buyer details: `test.buyer@example.com`, "Test Buyer", "100 Test Street", Chicago, Illinois; no payment, no order). Cart $1,799.00: **Standard Free, Local delivery Free, Express $15.00**, shipping line Free, total USD $1,799.00. Cart $949.00 (Cloudmere Firm Twin XL): **Standard Free and Express $15.00 only; no Local delivery option at all.** So the owner's Local delivery works at or above the free threshold ($999) but nothing offers the placeholder $149 fee below it: either the rate is configured only for orders of $999 or more (Local delivery has a minimum order price) or the fee rule is not set. Not resolved here; check admin Settings > Shipping and delivery > Local delivery (price $149, minimum order price). Also note the store's general shipping profile offers Standard (Free) and Express to every ZIP, in the zone and out of it, so the single delivery zone (ADR-0007) is not enforced by Shopify; that is the open checkout-zone configuration (B-17, B-18).
5. The checkout offers "Cash on Delivery (COD)" as the payment method on this dev store, so a test order is possible without a card when the owner wants one (acceptance needs a test order per delivery method); none was placed.

## 7f. Sample metaobject entries and a homepage fix (2026-10-26)

Looking at the home page on the real store (full-page screenshot, desktop width): real products with prices, the red hero, size tiles, brand tiles and the footer render. One defect: the "Shop by category" tiles listed Shopify's built-in **Home page** collection (`frontpage`). Fixed in `app/lib/shopify/home-data.ts` (the handle is skipped), with a unit test; typecheck and lint clean, the two catalog test files pass (109 tests before the new one, 34 in the changed file after).

`scripts/setup/seed-entries.mjs` seeds 15 sample entries (4 brands, 4 FAQs, 2 Chicago-area stores, 4 homepage sections, site settings) by upsert, dry run by default. The first live run was refused for every entry ("Not authorized to modify entries of type brand") because the app lacked `write_metaobjects`. After the owner added the scope and released the app, the same command wrote **all 15 entries** ("15 of 15 entries written"). Then both product sheets were imported again with `--live`: 14 and 7 products updated, 0 failed (each product now has `custom.brand`; the related foundation, protector and pillow links were set on the first sheet too). Both dev servers were restarted (Hydrogen caches reads).

Seen on http://localhost:3800 after the restart: the red promo bar shows the site setting text; `/brands` and `/brands/quillmoor-sleep` render with the brand entries; `/stores` lists Illinois with 2 stores and `/stores/illinois` shows both stores grouped by city with address, phone, an open or closed badge computed in the store's own time zone ("Closed, opens today at 10:00 AM"), today's hours, Directions and Set as my store; product pages carry the brand. The locator route uses the state's long name (`/stores/illinois`, not `il`). This is the first time the metaobject readers (brand, store, homepage section, site settings) ran on real entries. Not seeded: the quiz (it still uses the built-in default questions), promo tiles, offer rules, the delivery zone entry.

## 7g. The real-store spec, and a regression from the Hydrogen 2026.10 migration (2026-10-26)

`E2E_REAL_STORE=1 E2E_PORT=3400 E2E_ENV_FILE=.env.demo npx playwright test tests/e2e/real-store.spec.ts --project=desktop-chromium --workers=1` (against the running demo server; the spec is Chromium desktop here) first ran with **11 failed, 32 passed, 1 skipped**. Every failure was the same console error on every page: `Warning: Extra attributes from the server: nonce` on the stylesheet `<link>` elements. It is a hydration warning from the P1-12 migration (React Router 7.18 puts the server nonce on `<Links>`; the migration had never been run in a browser, see P1-12 in the backlog). It exists only in development builds, but the spec rightly counts console errors. Passing the real nonce on the client changed it to `Prop nonce did not match. Server: "" Client: ...` because browsers blank the attribute once parsed. Fix in `app/root.tsx`: `<Links nonce={typeof document === "undefined" ? nonce : ""} />` (server keeps the nonce, the client renders the empty value hydration reads back; the stylesheets are same-origin and the enforced policy allows them through 'self'). After it: console clean in dev (checked in a browser) and in a production build served with `vite preview --mode demo` under the enforced policy (no console entries on a product page), and the spec: **43 passed, 1 skipped, 0 failed** (the skip is the checkout-amount-equals-subtotal test, skipped because of the store password). The same run includes axe at 360 and 1280 px on `/`, `/collections/all`, `/collections/frontpage`, `/products/testing` and `/cart`: no serious or critical violation with real data. typecheck and lint clean; unit tests under `tests/unit/lib` and the catalog home tests pass. The long production-preview spec (`lazy-panels-production.spec.ts`) was started and timed out at 280 seconds; not re-run.

## 7h. The older mock-store specs after the migration (2026-10-26, Chromium desktop, bedding.mock.shop, one worker)

The first browser run of these specs since P1-12 (`E2E_ENV_FILE=.env.bedding npx playwright test <specs> --project=desktop-chromium --workers=1`; `.env.bedding` is the test file for the public bedding mock store):

| Specs | Result |
|---|---|
| smoke, shell, home | 57 passed, 8 skipped, **1 failed** |
| catalog, cart, search | 47 passed, 1 skipped, 0 failed |
| compare, quiz, stores, brands | 48 passed, **1 failed** (passed when re-run alone), 0 other |

- **shell.spec, "shows My store: <name> for a valid cookie and never prints the cookie value"** fails: the page HTML now contains the cookie text `new-york.buffalo.buffalo-gallery` once, as the store's `key` in the serialized loader data (`"key":"new-york.buffalo.buffalo-gallery"`, next to the store name and path). The text is the key of a known store, not the arbitrary cookie text (the tampered-cookie test, which checks that an unknown value is not echoed, passes). Most likely the test predates the `key` field that "set as my store" added. **Not changed**: the test guards a security property, so weakening it is the owner's or the security engineer's decision (either stop serializing `key` in the header store or narrow the test to unknown values).
- **compare.spec, "a bare /compare restores the last selection from this device"** failed once in a group run and passed alone: a race between writing the device copy after the click and the next navigation. Flaky; needs an owner and a date under the testing rules.
- **The default `storefront/.env` (mock.shop) answers 500 on `/`** (an unhandled error with no message in the log, which is redacted by design), so `npm run dev` without a mode and a Playwright run without `E2E_ENV_FILE` never start (Playwright waited 240 s and gave up). That file is off limits for me; not investigated. Use `--mode demo` or `E2E_ENV_FILE=.env.bedding` until it is looked at.
- A background run (`nohup ... &` in this Git Bash) died with no output; foreground runs of about 4 minutes each worked.

## 7i. The brand catalog (Puffy, Molecule, Beautyrest, Serta), 2026-10-26

Source facts, method and the open points are in [scripts/catalog/brand-catalog/README.md](../../scripts/catalog/brand-catalog/README.md). In short: public product data only (the Puffy and Molecule `products.json` feeds; the schema.org product data of the Beautyrest and Serta pages), one request every 10 seconds, no descriptions or images copied, **3Z Brands has no product list or prices on its site and is not included**. The result is 58 mattress models and 310 size rows.

```bash
node scripts/catalog/validate.mjs scripts/catalog/brand-catalog/brand-mattresses.csv --images <placeholder folder>     # PASSED: 310 rows, 58 models, 0 errors, 38 warnings
node scripts/catalog/to-shopify-csv.mjs scripts/catalog/brand-catalog/brand-mattresses.csv out.csv                   # the Shopify export layout of the owner's attached file
bash scripts/setup/with-admin-token.sh node scripts/setup/seed-entries.mjs --live                                     # adds the four brand entries (19 entries in all)
bash scripts/setup/with-admin-token.sh bash -c 'node scripts/catalog/import.mjs <dev-store copy of the sheet> --store "$STORE" --images <folder> --publication "$PUB" --live'
bash scripts/setup/with-admin-token.sh node scripts/setup/demo-collection.mjs                                         # the mattresses collection: 74 mattresses
```

Run on the dev store: **58 created, 0 updated, 0 failed**; the `mattresses` collection now holds 74 mattresses (these 58, the 14 sample ones and 2 offer mattresses; the collection script now takes only products of type Mattress, pages through the store and removes strays). Two choices for the dev store only: the 116 images are labelled placeholder pictures made by `make-demo-images.py`, and the import used a copy of the sheet with `copy_approved` set to `yes` so the products are published and visible (the committed sheet keeps `no`, so on the client's store they would be created as drafts until the client approves the text). On http://localhost:3400: `/collections/mattresses`, `/brands/serta`, `/brands/puffy`, two product pages and search all answer 200; the collection shows "12 products shown" per page and only the price filter, because Search and Discovery is not set up (manual).

Also added: `scripts/catalog/to-shopify-csv.mjs` (+ 4 tests; with the shopify and catalog suites 180 script tests pass) and `storefront/.env.example` (names only; what a local start needs and what is optional).

## 8. Checks that were run on the code

In `storefront/`: `npm run typecheck`, `npm run lint`, `npx vitest run` (6366 tests), `npm run build`, `npm run perf:bundle`: all passed (2026-10-26). In `scripts/shopify/`: `node --test scripts/shopify/apply-definitions.test.mjs`: 35 passing after the fixes above.

## 9. After this session

- **Rotate the Dev Dashboard client secret** (and let the token that was pasted into a chat expire, or uninstall and reinstall the app). The secret was written into `.env.demo` for convenience; the project rule is "Admin credentials in the shell only", so remove `ADMIN_CLIENT_ID` and `ADMIN_CLIENT_SECRET` from the file once you no longer need the helper, or export them in the shell instead.
- Tokens expire after 24 hours: the helper fetches a new one on every call. A long-lived token (the guest order lookup, the Extend sync on a server) needs a different design and is a decision for the hosting step.
- Open items on this store: customer scope for `custom.quiz_result` (section 4), Search & Discovery filters, brand and store metaobject entries, offer rules and the add-on, gift and haul-away products (P4-12), Customer Account API variables for sign-in.
