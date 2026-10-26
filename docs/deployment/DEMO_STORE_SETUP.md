# Demo store setup, with no third-party services

How to connect the storefront to a demo store and run it, with every third-party service switched off: no Extend, no Klaviyo, no Google Analytics, no Meta pixel, no Affirm, no maps, no Judge.me. Only Shopify is involved.

Status (2026-10-22): the setup script (`scripts/setup/demo-env.mjs`) and **Path A** (the mock demo store) are tested. **Path B** (your own Shopify store) has been **partly** run: the owner created the development store `mattressfitness-1iakxuvz.myshopify.com`, installed the Hydrogen sales channel, connected the storefront with a public Storefront API token (a validated 32-character public token, not a placeholder) and ran the site locally from a `.env.demo` file. It has **not** been run end to end.

What was verified on that store (agent-run Chromium tests, `storefront/tests/e2e/real-store.spec.ts`, details in [REAL_STORE_FINDINGS](../testing/REAL_STORE_FINDINGS.md) and the "Real store state" section of `progress/STATUS.md`):

- B1 to B3 and B8: the store, its token and the env file work; prices show in USD.
- The home page, `/collections/all`, `/collections/frontpage`, the product page, search and the cart (add, change quantity, remove, reload) answer correctly on real Shopify data, with no console error and no axe violation at 360 and 1280 px. The hand-off from the site's `/checkout-steps` to the store's own checkout address works.

What was **not** verified:

- B4 to B7: the data model (`apply-definitions`), the catalog import, the `mattresses` collection and Search & Discovery filters were **not** run. The store has one product named `testing` (one variant, no image, no metafields) and no `mattresses` collection, so every link to `/collections/mattresses` is a 404 page there.
- **Checkout totals.** The store's Online Store password page blocks checkout (the shopper ends on the store's `/password` page), so the cart total could not be compared with the checkout total. That comparison is **BLOCKED**, not passed.
- Offers, delivery, Extend, customer accounts, orders and webhooks were not exercised, and no order was created.

Steps marked _(verify)_ are the ones to confirm the first time you run them; report what you find so this page can be corrected.

## What "no third-party services" means here

You do not have to switch anything off by hand. Each service is off because its variable is simply not set, and the setup script never writes them.

| Service                               | Variables that would turn it on                                         | In the demo                                                                                                             |
| ------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Extend (accident protection)          | `PUBLIC_EXTEND_ENABLED`, `EXTEND_API_HOST`, `EXTEND_STORE_ID`, `EXTEND_ACCESS_TOKEN`, `EXTEND_ORDER_SYNC` | Not set: no protection panel, no offers call, no order sync. A cart that somehow holds a coverage line has it removed. |
| Orders webhook and Admin order read   | `SHOPIFY_APP_CLIENT_SECRET`, `SHOPIFY_ADMIN_API_ACCESS_TOKEN` (storefront side) | Not set: the webhook route answers 503 and does nothing. Nothing else needs it.                                         |
| Google Analytics, Meta pixel, Klaviyo | `PUBLIC_GA4_MEASUREMENT_ID`, `PUBLIC_META_PIXEL_ID`, `PUBLIC_KLAVIYO_COMPANY_ID` | Not set (and not built yet): no tracking script loads.                                                                  |
| Affirm / financing messages           | `PUBLIC_AFFIRM_PUBLIC_KEY`                                              | Not set. (Shop Pay Installments, if you turn it on in Shopify, is Shopify's own and appears in checkout, not here.)    |
| Maps                                  | `PUBLIC_MAPS_API_KEY`                                                   | Not set: store pages show an address block and a link, no map.                                                          |
| Reviews (Judge.me)                    | `JUDGEME_PRIVATE_API_TOKEN`                                             | Not set: no reviews area.                                                                                               |
| Offers engine                         | `OFFER_CONFIG_JSON`, `OFFERS_ENABLED`, `PUBLIC_GIFT_PICKER_ENABLED`     | First-party, not third-party. With none set in development there are no offers. `--no-offers` also writes `OFFERS_ENABLED=false`. |

Checkout, payments and customer accounts are Shopify's own and are not third-party services in this sense.

## Before you start (both paths)

1. Node.js 22 (the project uses fnm; see the root README). In Git Bash, `node --version` should print v22.x. PowerShell may pick Node 25 first, which Hydrogen does not support: use Git Bash.
2. Install dependencies once: `cd storefront && npm install`.

## Path A: the mock demo store (no account, about five minutes)

`bedding.mock.shop` is Shopify's public demo store with bedding products. It needs no account and no password. Prices show in CAD there (the storefront logs one harmless message about it; that message belongs to the mock stores only, your own store is USD), checkout is a placeholder, and mattress-specific facts (comfort level, type, FAQs) are absent.

```
node scripts/setup/demo-env.mjs --mock
cd storefront
npm run dev -- --port 3400 --mode demo
```

Open http://localhost:3400. The script wrote `storefront/.env.demo`: store domain, checkout domain, a placeholder token, and two freshly generated cookie secrets. Git ignores it; do not commit or share it. Add `--no-offers` to the script if you want the cart to skip offers entirely.

## Path B: your own Shopify demo or development store

Use a Partner development store (free) or an existing demo store. Never point this at the client's live store.

**B1. Create or choose the store.** Partner Dashboard, Stores, Add store, development store. Set the currency to USD (the storefront shows USD only; confirmed on `mattressfitness-1iakxuvz.myshopify.com`, where prices and the cart currency are USD).

**B2. Get the public Storefront API token.** In the store admin install the **Headless** sales channel (or **Hydrogen**), create a storefront, and copy the **public access token** (32 letters and digits). In the storefront's API permissions allow the unauthenticated read access to products, collections, tags, inventory and metaobjects, and the cart and checkout access, whatever the channel lists. Verified on the owner's store with the Hydrogen channel: the token was accepted and products, collections, search and the cart can be read and written; metaobject reads were not exercised, and the exact permission names were not recorded _(verify)_. The token is public by design; it still should not be pasted into chat or tickets.

**B3. Write the environment file.**

```
node scripts/setup/demo-env.mjs --store your-demo.myshopify.com --token <the 32-character token>
```

The domain must be the `.myshopify.com` address. The script checks both values before writing and refuses to overwrite an existing `.env.demo` without `--force`.

**B4. Create the data model (optional, recommended).** Without it the site still runs; it just shows no comfort level, brand, FAQ or homepage sections. This step needs an **Admin API token** from a custom app with the metaobject definition scopes (`scripts/shopify/README.md`). Keep that token in your shell only, never in `.env.demo`:

```
export SHOPIFY_ALLOWED_STORES=your-demo.myshopify.com
export SHOPIFY_ADMIN_API_ACCESS_TOKEN=<admin token>
node scripts/shopify/apply-definitions.mjs --store your-demo.myshopify.com          # dry run: shows what would be created
node scripts/shopify/apply-definitions.mjs --store your-demo.myshopify.com --live   # creates the definitions
```

A dry run that still has things to create exits 1 and prints `PENDING CHANGES`; that is expected before the first live run. Created definitions are not altered or deleted by later runs.

**B5. Add products.** Either add a few by hand in admin (each mattress needs a **Size** option with Twin, Full, Queen or King, and the product must be Active and available to the Headless channel) or load the made-up sample sheet:

```
node scripts/catalog/validate.mjs scripts/catalog/sample/mattresses.csv
node scripts/catalog/import.mjs scripts/catalog/sample/mattresses.csv --offline            # plan against an empty store
node scripts/catalog/import.mjs scripts/catalog/sample/mattresses.csv --store your-demo.myshopify.com   # reads the store, writes nothing
node scripts/catalog/import.mjs scripts/catalog/sample/mattresses.csv --store your-demo.myshopify.com --live --only <one handle>
```

Start with one product, look at it in admin, then run the rest. The sample brands and products are invented, and the import has not yet run against a real store _(verify)_. The sheet names image files that are **not** included (a mattress row needs its images, `--images <folder>`), so for a quick demo adding three or four products by hand in admin is usually faster.

**B6. Collections.** Create a collection with the handle `mattresses` (the site's main collection) and add the products. A collection `all` already exists in Shopify. Brand pages use a collection named after the brand handle when one exists.

**B7. Filters.** Collection filters come from Shopify's **Search & Discovery** app: install it and enable filters for price, size and the product attributes _(V-04; manual step, nothing in this repository configures it)_.

**B8. Start the site.**

```
cd storefront
npm run dev -- --port 3400 --mode demo
```

## Check that it works

Open these and expect no error page. On a store with a single product and no `mattresses` collection (the owner's store today) use `/collections/all`; `/collections/mattresses` is a clean 404 page there until the collection exists (B6).

| Page                                           | What to see                                                                      |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `/`                                            | Home with the shop-by-size tiles and featured products                            |
| `/collections/mattresses` (or `/collections/all`) | Product grid, sort, the filter drawer                                          |
| a product page                                 | Gallery, size picker, price, **Add to cart**; no protection panel                 |
| Add to cart, then open the cart                | Drawer with the line, quantity stepper and **Checkout**                           |
| `/search?q=queen`                              | Results                                                                           |
| `/compare`, `/quiz`, `/stores`                 | Work on built-in sample data (they do not read the store yet)                      |

Then, in the browser's network tab, confirm nothing is requested from Extend, Klaviyo, Google, Meta, Affirm or a maps host. Shopify's own consent script may log one blocked telemetry request to `shopifysvc.com`; that is the content policy refusing it on purpose and is not a problem.

## What does not work in a demo

- **Customer sign-in and the account area.** Shopify's customer account login needs the Customer Account API variables and a public tunnel (the Hydrogen CLI's `--customer-account-push` option _(verify)_); leave them unset and the account pages show a fixed error page. Not needed to browse or check out.
- **Delivery ZIP and the delivery promise.** They stay empty until a delivery zone is configured through `OFFER_CONFIG_JSON` (an example is in `storefront/DEV_DATA.md`). Saving a ZIP needs `DELIVERY_COOKIE_SECRET`, which the script already generates.
- **Haul-away, gifts, bundles and add-on offers.** Need the offer rules and, on a real store, matching products and discounts (not covered here).
- **Stores, quiz and compare** use sample data until their Shopify readers exist. Reviews, pickup and analytics are not built.
- **Checkout** is Shopify's hosted checkout. On a development store use Shopify's test payment method; do not enter a real card _(verify the test method on your store)_.

## If something goes wrong

| Symptom                                                              | Cause and fix                                                                                                                     |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 500 error on every page                                              | `SESSION_SECRET` missing or (production build) shorter than 32 characters. Re-run the script with `--force` to regenerate.      |
| Console error about Shopify Customer Privacy                         | Normal on mock.shop (no consent API); ignore.                                                                                      |
| Console message "Only USD is supported, got CAD"                     | Only on mock.shop and bedding.mock.shop (Path A), which price in CAD; ignore it there. A USD store such as `mattressfitness-1iakxuvz.myshopify.com` does not log it (0 lines in the real-store run). If you see it on your own store, its currency is not USD: change it in the store's currency settings (Settings, Store details _(verify the menu name)_). |
| Checkout shows a password page, or the checkout total cannot be read | The store's Online Store password is on, which blocks the hosted checkout as well as the storefront channel. Remove it in admin under Online Store > Preferences (Password protection), or use a development store without one. Never type the password into an automated test or put it in a file. |
| Empty home page or "no products"                                     | The token is wrong, the products are not Active or not available to the Headless channel, or the store domain has a typo.          |
| Token rejected by the script                                         | It must be exactly 32 letters and digits (the public token), not the private token and not an Admin API token.                     |
| Filters show only price or nothing                                   | Search & Discovery is not installed or filters are not enabled (B7). The mock store returns no filter groups at all.              |
| ZIP will not save ("We could not save your ZIP code")                | `DELIVERY_COOKIE_SECRET` missing or shorter than 32 characters. The script generates a good one; do not hand-edit it down.        |
| `apply-definitions` exits 3                                          | `SHOPIFY_ALLOWED_STORES` does not list the store, or the Admin token is not set in the shell.                                      |
| You see an offers-paused message at checkout in a production build   | A production build treats missing `OFFER_CONFIG_JSON` as a configuration fault. Set `OFFERS_ENABLED=false` (`--no-offers`) for an offers-free demo build. |

## Turning the real services on later

Each one is its own task with client-supplied accounts and approvals; this page does not enable any of them. Extend: [EXTEND.md](../integrations/EXTEND.md). All variables, who sets them and what fails closed: [DEPLOYMENT.md](DEPLOYMENT.md#environment-variables). Test and e2e setup against the mock store: [DEV_DATA.md](../../storefront/DEV_DATA.md).
