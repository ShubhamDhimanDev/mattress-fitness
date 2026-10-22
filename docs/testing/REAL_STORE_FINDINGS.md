# Real development store: first findings (2026-10-22)

First evidence from a **real Shopify development store** (`mattressfitness-1iakxuvz.myshopify.com`, Hydrogen channel installed, one product `testing`, no `mattresses` collection). Everything before this ran on mock.shop, bedding.mock.shop, fixtures or fakes. **Evidence scope: READ paths and cart paths only.** Nothing here is evidence for Extend, offers, delivery, customer accounts, orders, webhooks or a real checkout total. No requirement is marked PASSING by this page.

## What was run

- **Build:** `git archive c758620 storefront` into a scratch copy outside the repository (other agents were restyling `app/` during the session, which changed the live tree and made it serve a mixed state; the scratch copy removed that). The scratch copy differs from the commit only by a `server.fs.allow` line in its `vite.config.ts` (needed because its `node_modules` is a junction to the real one). Brand and header work committed or uncommitted after `c758620` was **not** under test.
- **Server:** `npm run dev -- --port 6100 --disable-version-check --env-file .env.demo` (own server, stopped afterwards). The env file was never read; it holds the store domain, the public token and two generated secrets (no OFFER_CONFIG_JSON, so offers are off).
- **Spec:** `storefront/tests/e2e/real-store.spec.ts`, skipped with a stated reason unless `E2E_REAL_STORE=1` (verified: 43 skipped without it).
  `E2E_REAL_STORE=1 E2E_PORT=6100 E2E_ENV_FILE=.env.demo npx playwright test tests/e2e/real-store.spec.ts`
  Observations print as `[real-store] ...` lines.
- **Existing suites** (store-agnostic ones) on the same server: `E2E_PORT=6100 E2E_ENV_FILE=.env.demo npx playwright test <specs> --project=desktop-chromium --workers=4`.
- Chromium only (desktop 1280, mobile Pixel 7). WebKit and Firefox not run.

## Results

| Run | Result |
|---|---|
| `real-store.spec.ts`, desktop and mobile Chromium, after the last edit | **74 passed, 12 skipped, 0 failed.** The 12 skips: 10 are the axe viewport tests that run once (desktop project only, by design), 2 are the checkout-total comparison, **BLOCKED** (below) |
| Store-agnostic suites (catalog, cart, search, home, shell, compare, stores, quiz, brands, smoke), desktop Chromium | **146 passed, 7 skipped, 3 failed** (classified below) |
| `a11y-audit.spec.ts` route audit (home, not-found, policies, empty cart) | **4 of 4 failed before any axe run**: the audit's `catalogOf` needs a product sold in two sizes ("needs richer data") |

### What the real store answered

| Question | Answer (real store) |
|---|---|
| Currency | **USD.** Price shows `$193.00`; no "Only USD is supported" log (0 lines); cart `currencyCode` USD. The mock-store CAD noise and the "Shopify Customer Privacy" error are **gone**: with nothing hidden, the only console message class left is Shopify's own blocked telemetry refusal (matched by exact host, DEC-045) |
| Pages | `/`, `/collections/all`, `/collections/frontpage`, `/products/testing`, `/search`, `/cart`, `/policies`, `/brands`, `/stores`, `/compare`, `/quiz`, `/blogs`, `/pages/contact` answer 200 with an h1 and no console error. `/collections/mattresses`, `/pages/about`, `/pages/faq`, `/brands/mattressfitness` and unknown URLs are clean 404 pages (no 500, no stack text). Empty search shows "No products found" |
| sitemap, robots | `/sitemap.xml` index with 5 children, all 200; the products child lists `/products/testing`. `robots.txt` 200 and names the sitemap |
| Security headers | Present on `/`, `/collections/all`, product, `/cart`, search and the 404 page: nosniff, referrer-policy, X-Frame-Options DENY, permissions-policy, COOP, enforced CSP and report-only CSP. CSP names only Shopify hosts (cdn.shopify.com, shopify.com, shopifysvc.com, the store host): **no Extend, Klaviyo, Google, Meta, Affirm or maps host**. `/cart` is `private, no-store` |
| Accessibility with real data | axe at 360 and 1280 px on `/`, `/collections/all`, `/collections/frontpage`, product, and the cart page with an item: **0 violations of any impact** (0 critical, 0 serious, 0 moderate, 0 minor, 0 best-practice), no horizontal overflow. State at build `c758620` only |
| Product with no image, no metafields | Page renders with the "No image available" placeholder, no comfort or spec section, no error |
| Cart on a real Shopify cart | Add opens the drawer; quantity 1 to 2 to 1 and removal work and the subtotal follows Shopify (`$193.00`, `$386.00`); empty state shows; cart page and drawer agree and survive a reload |
| Stock limit (V-16, cart line update) | Asking for 99 makes Shopify cap the line at **50** with warning `MERCHANDISE_NOT_ENOUGH_STOCK`; the shopper sees "Only 50 items were added to your cart due to availability." and the subtotal is 50 x $193.00 = $9,650.00. The browser never sends a quantity above 99 (typed 100000 was clamped to 99); the server refuses 100 and 1000 with 400 |
| Fake discount code | Shopify returns it as not applicable; the page shows "This code does not apply to your cart", subtotal unchanged, removable (no GraphQL error) |
| Tampered and cross-site cart posts, unknown variant id | Tampered price/quantity 400; cross-site Origin 400; a well-formed unknown variant id answers below 500 and leaves the cart empty |
| Checkout hand-off | `/checkout-steps` with an item answers **302** to `https://mattressfitness-1iakxuvz.myshopify.com/cart/c/...` (the cart `checkoutUrl` host is the `.myshopify.com` store domain), `private, no-store`; with an empty cart it redirects to `/cart`. Browser chain: `302 localhost/checkout-steps`, `302 store/cart/c`, `200 store/checkouts/cn`, then `200 store/password` |
| `nodes(ids)` | The cart view calls `nodes(ids:)` for the cart's products on every load (even with offers off). **No `offers.facts_read_failed` in the server log across all runs and no error**, so the real store accepts the query. **Not proven:** that it returns useful data, because the one product has one variant (no size choices to show). Variant lookups for gifts and add-ons (`OFFER_VARIANTS_QUERY`) did not run (offers off) |
| Metaobjects `brand`, `homepage_section`, `promo_tile`, `site_settings` (V-05) | Not defined on the store. Home shows its fixed hero, shop-by-size tiles (links go to `/collections/frontpage?size=...`), "Shop by brand" built from the product vendor, no error, no 500, no log line. **Reading real definitions is still unverified** (needs `apply-definitions` and an entry) |
| `custom.*` metafields | Absent: product and cards show no comfort, type, benefits; no error |
| Filters (V-04) | `/collections/all` offers sort only, by design (root `products` takes no filters). `/collections/frontpage` returns **no filter groups** that map to our dimensions (`filterGroups: []`), but the **price filter works on the real store**: `price_min=100&price_max=300` keeps the $193.00 product, `price_min=400&price_max=900` drops it and shows "No products match these filters". Size, brand, comfort filters unverified (no data, Search and Discovery not configured) |
| Storefront API through our `/api/2026-04/graphql.json` proxy route | Answers `Online Store channel is locked` to a tokenless request: the store has its **Online Store password on**. The token path used by the app is fine |

### The checkout total comparison is BLOCKED

Shopify sends the shopper from `/checkouts/cn/...` to the store's **`/password`** page, so the hosted checkout's totals were not readable. Nothing was typed into that page (the password is not ours to use) and no payment or personal data was entered. "Cart total equals checkout total" is **not verified**. The spec test for it skips at run time with that reason (reported as skipped, not passing). It needs the store's Online Store password removed or a store without one, or a decision by the owner to give the QA run the password through a secret, never a file in the repository.

## Defects and observations

No Blocker or Major found. Everything below is Minor or an observation.

| ID | Grade | Finding | Repro and proposed fix |
|---|---|---|---|
| RS-01 | Minor | The server logs `{"level":"error","event":"offers.config_problem","status":"none"}` on **every** cart, product and checkout request when `OFFER_CONFIG_JSON` is unset (106 lines in one session). The demo guide says "no offers" is a valid setup, so an error line per request is noise that hides real errors | Start with the demo env file and open `/cart`. Log `status:'none'` once at info level, or not at all when `OFFERS_ENABLED=false` |
| RS-02 | Minor | After "Add to cart" the drawer lists the line while the subtotal still shows `-` for about 1 second (1047 ms and 1017 ms measured, then `$193.00`). A shopper may read it as a missing price | Add to cart, read the drawer Subtotal at once. Show a placeholder or skeleton marked busy, or keep the optimistic subtotal from the line price |
| RS-03 | Minor (observation) | Hydrogen logged `sendShopifyAnalytics request is unsuccessful TypeError: Failed to fetch` to the server terminal four times, in the runs that navigate away straight after a cart event (the checkout tests). Not seen on a plain add; the console-error assertion passed there. Probably an aborted request on page unload; not reproduced in isolation | Add to cart, click Checkout at once |
| RS-04 | Observation | React Router prints a full stack trace at error level (`x-forwarded-host header does not match origin header`) for each expected cross-site POST rejection | Expected hostile-test noise; no action unless production logging is noisy |
| RS-05 | Observation | Start-up warnings: Hydrogen "Using a private storefront token is recommended for server environments" (demo uses the public token only); Vite "`envFile` option is deprecated"; two React Router v8 future-flag warnings. No `config.secret_unusable` line appeared (both secrets are 32+ characters) | Private token for production is a deployment task (DEPLOYMENT.md) |
| RS-06 | Observation | Every document sends `powered-by: Shopify, Hydrogen` | Remove the header if the client wants no platform disclosure |
| RS-07 | Observation | The `/collections` index links (`/collections/mattresses`, `/collections/firm-mattresses`, `adjustable-bases`, and about 30 others) are navigation fallback links; most are **404 on this store**. A shopper clicking them gets a 404 page | Not a code defect: the store lacks those collections. Create them or hide fallback links for collections that do not exist |
| RS-08 | Observation | The Hydrogen root loader sends the **public** storefront token to the browser (by design for consent and analytics). Not a defect; do not paste it into docs or tickets | None |

## Store-agnostic suites against the real store (desktop Chromium, 146 pass, 7 skip, 3 fail)

| Result | Test | Class |
|---|---|---|
| fail | `catalog.spec` "choosing a size updates the URL without a full reload" | **Needs richer data**: no product with two sizes ("lacks data this spec needs") |
| fail | `catalog.spec` "the gallery is keyboard operable" | **Needs richer data**: no product with several images |
| fail (once) | `compare.spec` "a bare /compare restores the last selection from this device" | **Not a real-store defect**: compare uses built-in sample data. Failed under 4 parallel workers on a cold server (second checkbox click did not register in 5 s); **passed 2 of 2 alone on the real store and passed on bedding.mock.shop**. Treat as a load-related flake to watch; not explained further |
| skip | `cart.spec` size swap | Needs richer data (one size) |
| skip | `shell.spec` ZIP with a delivery zone | No `OFFER_CONFIG_JSON` zone in the demo env (stated skip) |
| skip x5 | `shell.spec` mobile drawer tests | By design in the desktop project |
| fail (all) | `a11y-audit.spec` route audit | **Needs richer data** (`catalogOf` wants a two-size product) |

Everything else in catalog, cart, search, home, shell, compare, stores, quiz, brands and smoke **passes on the real store**, including the cart hardening cases and the `/checkout-steps` redirect to an https host. Delivery, protection, resilience, pickers and the production specs were not run (they need an offer config, the Extend flag or a production preview).

## What the store owner must add (then re-run this spec and the failing suites)

1. **Products with a Size option** (Twin, Full, Queen, King) and several images; unblocks size swap, gallery, size filters, `nodes(ids)` data and the a11y audit.
2. **Collection `mattresses`** (handle exactly that) and the other collections the navigation links to, or tell us to remove those links.
3. **Metaobject and metafield definitions** with `scripts/shopify/apply-definitions.mjs` (needs an Admin API token in the shell only), plus a few entries (`brand`, `homepage_section`, `promo_tile`, `site_settings`, `custom.*` on products), then re-check V-05.
4. **Search and Discovery filters** for size, brand, comfort, type (V-04); today only price filtering is proven.
5. **Online Store password**: remove it (or provide a store without it) so checkout totals can be compared with the cart (V-20 "cart total equals checkout total"). Until then that check is BLOCKED.
6. An `OFFER_CONFIG_JSON` (or the metaobject reader) and matching products to exercise gifts, add-ons, haul-away and the `nodes(ids)` variant lookups; nested lines (V-02), gift pricing (V-03) and cart attributes were **not** touched.
7. Shop policies and pages (`about`, `faq`) if the footer should link to real content.

## Not covered by this run

Customer accounts (V-08), nested lines (V-02), automatic discount gift pricing (V-03), order attributes, offers, delivery, Extend, webhooks, a real checkout page content, WebKit and Firefox, Lighthouse, a real device or screen reader. Carts created by the tests are abandoned Storefront carts; **no order was created and no payment or personal data was entered.**
