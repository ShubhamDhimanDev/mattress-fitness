# Newsletter signups as Shopify customers (tag `subscribe`)

Owner request 2026-11-06 (REQ-ANL-003, CR-34, DEC-150). Code: `storefront/app/lib/signup/shopify-customer.ts`,
`combined-subscriber.ts`, wired in `handler.ts`.

## What happens on a signup

After the usual checks (same origin, rate limit, honeypot, explicit unticked consent), the server:

1. looks the address up (`customerByIdentifier`);
2. **new address:** `customerCreate` with `tags: ["subscribe"]` and `emailMarketingConsent` (SUBSCRIBED, SINGLE_OPT_IN, now);
3. **known address:** `tagsAdd` with `subscribe`, then `customerEmailMarketingConsentUpdate` to SUBSCRIBED (the shopper just
   ticked the consent box). If a create races another request, it looks the address up again and tags that customer.

The signup's other destination (Klaviyo, or the SMTP email to the team) still runs. The shopper sees "thank you" when either
took the signup; the one that failed is logged (`signup.destination_failed`, reason code only).

## Setup (owner / developer)

1. In the Shopify Dev Dashboard create an app (legacy custom apps can no longer be created), release a version and install it on
   the store. Its Admin API scopes must cover everything the server does with one credential: `write_customers` and
   `read_customers` (this sync), plus `read_orders` (order lookup, Extend sync) and `read_products`, `read_discounts`,
   `read_metaobjects` (offers and gifts). The server's token carries every scope its app has, so do not reuse the setup app, which
   can also write products and discounts.
2. Put the app's **client id and secret** in the server environment as `ADMIN_CLIENT_ID` and `ADMIN_CLIENT_SECRET` (names only
   in `storefront/.env.example`; never in a file or a log), and set `PUBLIC_STORE_DOMAIN` to the `<shop>.myshopify.com` domain.
   The server fetches its own Admin token from them (`app/lib/shopify/admin-token.ts`, the client credentials grant, about
   24 hours), keeps it in memory, renews it five minutes early, and retries once with a new one if Shopify answers 401. Nothing
   to copy by hand and nothing to renew. The same credential serves every Admin call the server makes (`adminConfigFromEnv`); a
   fixed `SHOPIFY_ADMIN_API_ACCESS_TOKEN` still wins if one is set. All server fetches use `redirect: 'manual'`, because Node's
   fetch throws on `'error'` (that was why signups, offers and order reads failed on Node).
3. Filter in Shopify admin: Customers, then "Tagged with" `subscribe`.

Without the token no customer is created and nothing is faked; with only the token set the signup form still shows.

## Status

**Unverified against the client's store and API version 2026-10.** Run one signup on the development store and check: a new
customer with the tag and "Subscribed" email marketing; the same address again adds no duplicate; a wrong token shows "try again
later" and a warning in the logs. Record the result in `progress/TEST_RESULTS.md`.

## Welcome email with a promo code (owner request 2026-11-06)

Every signup is also emailed its own message with a promo code for up to 15% off (`storefront/app/lib/signup/welcome-email.ts`,
a third destination next to the Shopify customer and the main one). It runs after the same checks, and the shopper sees
"thank you" if any destination took the signup.

- **The code** is one shared Shopify discount code, 15% off all products, once per customer, combinable with product discounts.
  `scripts/setup/newsletter-promo-code.mjs` creates it (dry run by default, `--live` to create; the name `WELCOME15` is ours: change it in both places if the owner prefers another). The email only carries the name; Shopify applies the saving.
  `PROMO_PERCENT` in `signup/shared.ts` is the wording ("15%") and must equal the discount.
- **Setup:** no environment variable for the code: its name, `WELCOME15`, is `PROMO_CODE` in `signup/shared.ts` and must match the Shopify
  discount. The email goes out over the `SMTP_*` settings and `SMTP_FROM`, which works on the plain-Node VPS only (not Oxygen or
  `npm run dev`). Without the SMTP settings there is no welcome email, and the pop-up, footer and home form promise no code (the
  server tells them through `promo` in the public config).
- **Team email:** when the welcome email is on, the team's signup email no longer asks them to send a coupon by hand.
- **Not delivered by Shopify:** this does not use Shopify Email or Flow. The email is plain text from our own server.

**Status: UNVERIFIED end to end.** Unit tests cover the recipient (the shopper only), header-injection refusal, the
destination logic and the config flag. Not yet run: a real SMTP send, and checking out with the code on the store.
