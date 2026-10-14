# Running the storefront against a mock store (until the development store exists)

The app reads its store from `PUBLIC_STORE_DOMAIN`. The default `.env` points at `mock.shop` (apparel). For mattress-like browsing use `bedding.mock.shop` (CloudHaven Linens): real Storefront API, products with a `Size` option (Twin, Full, Queen, King) and a `Color` option, collections, cart. No mattress metafields exist there, so comfort level, mattress type, benefits, specifications and FAQs are simply not shown (by design, see `app/lib/shopify/metafields.ts`). Filters other than price and size need Shopify Search and Discovery on a real store; the mock store returns no filter groups and ignores the price filter.

## What works (verified 2026-10-13)

`shopify hydrogen dev` has an `--env-file` flag. It replaces the default `.env`, so no committed file is touched and `.env` is never read or edited.

1. Create `storefront/.env.bedding` (the `.env.*` pattern is git-ignored; never commit it):

   ```
   PUBLIC_STORE_DOMAIN=bedding.mock.shop
   PUBLIC_CHECKOUT_DOMAIN=bedding.mock.shop
   PUBLIC_STOREFRONT_API_TOKEN=00000000000000000000000000000000
   SESSION_SECRET=local-dev-only-not-a-secret
   ```

   - The token is a 32-character placeholder: bedding.mock.shop does not check it, but Hydrogen's consent code logs an error unless the token is exactly 32 characters (it rejects anything else as "private"). `PUBLIC_CHECKOUT_DOMAIN` is required by the same code.
   - `SESSION_SECRET` is needed because the replacement file has to supply every variable; this value only signs a local cookie.

2. Start the dev server: `npm run dev -- --port 3400 --env-file .env.bedding`

3. Run the e2e specs against it: `E2E_PORT=3400 npx playwright test tests/e2e/catalog.spec.ts tests/e2e/cart.spec.ts tests/e2e/search.spec.ts tests/e2e/home.spec.ts`

## What does not work

- The environment variable `SHOPIFY_HYDROGEN_FLAG_ENV_FILE` is ignored by `npm run dev` (tried; the server kept using `.env`).
- `playwright.config.ts` starts its own server with `npm run dev -- --port N` and no `--env-file`, so Playwright cannot pick the mock store by itself. Start the server yourself as in step 2; Playwright reuses a server that is already listening on `E2E_PORT` (`reuseExistingServer`, off in CI). The specs find their data at run time (first collection, first product), so they pass on any store that has at least one collection with a product.

## Known differences from a real store

- Console: `[Shopify Customer Privacy] ... consentManagement` (mock.shop has no consent API; ignored by `KNOWN_MOCK_SHOP_ERRORS`) and `Price: could not display an amount: Only USD is supported, got CAD` (the demo stores price in CAD; the only message `ourErrors` ignores). Any other console error fails the specs.
- mock.shop ignores `price` filters and returns every product.
- `checkoutUrl` points to `bedding.hydrogen.mock.shop/checkout`, not a real checkout.

## Needs the development store (not verifiable here)

Filter counts matching Shopify admin (V-04), metafield-driven badges, specifications, FAQs and brand sections (V-05), the `brand` and `homepage_section` metaobjects, compare-at (sale) pricing and sold-out sizes on real data, nested cart lines (V-02), a checkout total that equals the cart total, and the cache TTL decision.

## Delivery ZIP and the product-page promise (P3B-11, P5B-03)

The ZIP check needs a delivery zone, which the server reads from the non-secret `OFFER_CONFIG_JSON` setting (`zone` key; the metaobject reader replaces it later). With no zone the product page and cart say nothing about delivery, by design, and `tests/e2e/delivery.spec.ts` skips with that reason.

1. Create `storefront/.env.delivery` (git-ignored by the `.env.*` pattern) with the four variables from `.env.bedding` plus one line (placeholder zone and wording, not client data):

   ```
   OFFER_CONFIG_JSON={"zone":{"name":"Test metro","postalCodes":"606*, 60007","feeCents":14900,"freeOverCents":99900,"promise":{"inHome":"Free in-home delivery and setup for your area.","parcel":"","pickup":""}}}
   ```

2. `npm run dev -- --port 3700 --env-file .env.delivery`, then `E2E_PORT=3700 npx playwright test tests/e2e/delivery.spec.ts`.

The haul-away and delivery-choice steps cannot be exercised here: they need Storefront `nodes(ids)` lookups of the service variant, which the mock stores do not answer. They are covered by `tests/unit/routes/delivery-routes.test.ts` and need the development store (a real `haulAway` rule with a variant id) for a live run.
