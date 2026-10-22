# Running the storefront against a mock store (until the development store exists)

> Quick way: `node scripts/setup/demo-env.mjs --mock` writes `.env.demo` with generated secrets for the mock store (or your own demo store with `--store`), and [DEMO_STORE_SETUP](../docs/deployment/DEMO_STORE_SETUP.md) explains it step by step with every third-party service off. The manual steps below do the same by hand.
>
> Update 2026-10-22: a development store now exists (`mattressfitness-1iakxuvz.myshopify.com`, one product, USD, Online Store password on) and the read and cart paths have run against it; see the `.env.demo` row in the table below and `docs/testing/REAL_STORE_FINDINGS.md`. The "Needs the development store" list further down is still mostly open (checkout totals, filters other than price, metafields and metaobjects, nested lines).

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
   - `SESSION_SECRET` is needed because the replacement file has to supply every variable; this value only signs a local cookie. In a production build or preview it must be at least 32 characters (shorter is refused with a 500, DEC-032), so use a 32+ character placeholder there.
   - `DELIVERY_COOKIE_SECRET` (32+ characters, different from `SESSION_SECRET`) is needed for anything that saves a delivery ZIP. Without it the ZIP cannot be saved and the delivery e2e tests that save one (the shell ZIP entry tests) fail; that is the intended fail-closed behaviour. Add a local placeholder value to the env file when you run them.

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

The ZIP check needs a delivery zone, which the server reads from the non-secret `OFFER_CONFIG_JSON` setting (`zone` key; the metaobject reader replaces it later, P4-12; the `delivery_zone` metaobject is not read today). With no zone the product page and cart say nothing about delivery, by design, and `tests/e2e/delivery.spec.ts` skips with that reason.

1. Create `storefront/.env.delivery` (git-ignored by the `.env.*` pattern) with the four variables from `.env.bedding`, a `DELIVERY_COOKIE_SECRET` (32 or more characters, so a ZIP can be saved) and one more line (placeholder zone and wording, not client data):

   ```
   OFFER_CONFIG_JSON={"zone":{"name":"Test metro","postalCodes":"606*, 60007","feeCents":14900,"freeOverCents":99900,"promise":{"inHome":"Free in-home delivery and setup for your area.","parcel":"","pickup":""}}}
   ```

2. `npm run dev -- --port 3700 --env-file .env.delivery`, then `E2E_PORT=3700 npx playwright test tests/e2e/delivery.spec.ts`.

The haul-away and delivery-choice steps cannot be exercised here: they need Storefront `nodes(ids)` lookups of the service variant, which the mock stores do not answer. They are covered by `tests/unit/routes/delivery-routes.test.ts` and need the development store (a real `haulAway` rule with a variant id) for a live run.

## Environment files at a glance (checked against the code 2026-10-15)

A fresh checkout has no `.env` (all `.env*` except the root `.env.example` are git-ignored), and the app refuses to serve without `SESSION_SECRET`, so create one before `npm run dev`. Complete variable list: [DEPLOYMENT](../docs/deployment/DEPLOYMENT.md#environment-variables).

The four base variables are `PUBLIC_STORE_DOMAIN`, `PUBLIC_CHECKOUT_DOMAIN`, `PUBLIC_STOREFRONT_API_TOKEN` and `SESSION_SECRET` (the file shown in step 1 of "What works").

| File               | Variables beyond the four base variables                                                                                      | Port used above | Spec                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------- |
| `.env.bedding`     | none for catalog, cart, search and home; add `DELIVERY_COOKIE_SECRET` (32 or more characters) for the `shell` ZIP entry tests | 3400            | catalog, cart, search, home, shell                |
| `.env.delivery`    | `DELIVERY_COOKIE_SECRET` (32 or more characters) and `OFFER_CONFIG_JSON` with a `zone`                                        | 3700            | delivery                                          |
| `.env.protection`  | `PUBLIC_EXTEND_ENABLED=true`, `EXTEND_API_HOST`, `EXTEND_STORE_ID`, `EXTEND_ACCESS_TOKEN` (local mock values)                 | 3900            | protection, resilience (`E2E_PROTECTION_FLAG=on`) |
| `.env.prodpreview` | none, but `SESSION_SECRET` must be 32 or more characters (a production build refuses a shorter one)                           | 4400            | b20-production (`E2E_PROD_PREVIEW=1`)             |
| `.env.demo`        | written by `node scripts/setup/demo-env.mjs`: the four base variables plus `DELIVERY_COOKIE_SECRET`; for a real development store the token is its 32-character public Storefront token (see DEMO_STORE_SETUP); no `OFFER_CONFIG_JSON`, so offers are off | 6100, 6700 (any free port) | real-store (`E2E_REAL_STORE=1`), brand-verification, and the store-agnostic suites (catalog, cart, search, home, shell, compare, stores, quiz, brands, smoke) |

Real-store run (names only; the values stay in the git-ignored `.env.demo` and are never copied into a document, a ticket or a test): create the file with `node scripts/setup/demo-env.mjs --store <the .myshopify.com domain> --token <the public Storefront token>`, start `npm run dev -- --port 6100 --disable-version-check --env-file .env.demo`, then run `E2E_REAL_STORE=1 E2E_PORT=6100 E2E_ENV_FILE=.env.demo npx playwright test tests/e2e/real-store.spec.ts`. Without `E2E_REAL_STORE=1` the spec skips with a stated reason. What it proves and does not: `docs/testing/REAL_STORE_FINDINGS.md`. Agent runs follow the browser rule in `docs/testing/PLAYWRIGHT_WORKFLOW.md` (`--workers=1`, one browser user at a time).

Other switches: `PUBLIC_GIFT_PICKER_ENABLED=true` turns the gift picker on (off by default; the e2e `pickers.spec` success paths are skipped on mock stores). `OFFERS_ENABLED=false` removes all offers. In a production build (`npm run build` then preview) `EXTEND_API_HOST=http://127.0.0.1:4010` is refused, so Extend reads as disabled there. The local Extend mock is started with `node scripts/mocks/extend-mock.mjs --port 4010`.

## CI (GitHub Actions)

`.github/workflows/ci.yml` cannot use your local `.env.*` files (git-ignored), so its `e2e-chromium` job writes three placeholder files on the runner and starts one Playwright run per server configuration (the `e2e-crossbrowser` job writes only `.env.ci`; the `storefront` job runs no browser tests). `playwright.config.ts` reads `E2E_ENV_FILE` (a file name relative to this folder; letters, digits, `_ . / -` only, not starting with `-`, no `..` segment, otherwise it throws) and adds `--env-file <it>` to the server it starts; with `E2E_PROD_PREVIEW=1` it starts `shopify hydrogen preview` on the built bundle instead of the dev server. `E2E_RUN_NAME` (letters, digits, `_ -`) sends one invocation's HTML report to `playwright-report/<name>` and its results to `test-results/<name>`; without it the plain `playwright-report` and `test-results` folders are used and each run empties them first, so give each run its own name when you run several in a row and want to keep failures. `E2E_ALL_BROWSERS=1` adds the WebKit and Firefox projects (set only in the cross-browser job). Locally the same works without starting a server yourself: `E2E_ENV_FILE=.env.bedding E2E_PORT=3400 npx playwright test tests/e2e/catalog.spec.ts` (this supersedes the "Playwright cannot pick the mock store" note above for the file name; it is still not read when you start the server yourself).

| CI file              | Content                                                                                                                                      | Port                             | Specs                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------ |
| `.env.ci`            | the four base variables plus `DELIVERY_COOKIE_SECRET` (five in all), with placeholder secrets of 32 or more characters; no `PUBLIC_SITE_URL` | 3100 (also 4400 for the preview) | everything; `b20-production` with `E2E_PROD_PREVIEW=1` |
| `.env.ci-delivery`   | `.env.ci` plus `OFFER_CONFIG_JSON` with the test zone shown above                                                                            | 3700                             | `delivery`, `shell`                                    |
| `.env.ci-protection` | `.env.ci` plus the four Extend variables of `.env.protection`; the local mock runs on 4010                                                   | 3900                             | `protection`, `resilience` (`E2E_PROTECTION_FLAG=on`)  |

The runs of the `e2e-chromium` job, in order, with their `E2E_RUN_NAME`: `run1-mock-store` (whole suite, `.env.ci`), `run2-delivery` (`delivery` and `shell`, `.env.ci-delivery`), `run3-protection` (`protection` and `resilience`, `.env.ci-protection`, local Extend mock started by the step), `run4-production-preview` (`b20-production`, `.env.ci`, `E2E_PROD_PREVIEW=1`, after `npm run build`). All four use the projects `desktop-chromium` and `mobile-chromium`. The cross-browser job runs the whole suite once as `crossbrowser` in `desktop-webkit`, `mobile-webkit` and `desktop-firefox`, and is not a required check.

Everything these files hold is a published placeholder, not a credential. Skipped in CI on purpose: the `pickers` success paths, the haul-away and delivery-choice steps, and anything that needs the development store (listed in "Needs the development store"). Full run table and what was verified: [DEPLOYMENT](../docs/deployment/DEPLOYMENT.md#pipeline).

## Extend protection panel (P5A-05, P5A-07)

The product-page panel shows only when the server flag is on AND the product has a `custom.extend_category` metafield (the loader reads it; with none, nothing renders and nothing is asked). The mock stores have no such metafield, so the spec sets the cookie `e2e_extend_eligible=1`, which the loader honours in development only (`import.meta.env.DEV`), to treat a page as eligible; the spec's "no Extend category" test deliberately leaves it unset. Create `storefront/.env.protection` (git-ignored) with the four variables from `.env.bedding` plus `PUBLIC_EXTEND_ENABLED=true`, `EXTEND_API_HOST=http://127.0.0.1:4010`, `EXTEND_STORE_ID=mock-store-id`, `EXTEND_ACCESS_TOKEN=mock-access-token` (values of the local mock, not credentials), start `npm run dev -- --port 3900 --env-file .env.protection` and run `E2E_PORT=3900 E2E_PROTECTION_FLAG=on npx playwright test tests/e2e/protection.spec.ts`. The offers answer is stubbed at the network layer; the add-with-protection submit is refused by the real server because bedding.mock.shop answers no variant lookups (that refusal is what the spec asserts). Against a server without the flag, run the spec without `E2E_PROTECTION_FLAG`: the flag-off test runs and the others skip. Needs the development store: the success path (item plus nested coverage line), V-16, V-02.
